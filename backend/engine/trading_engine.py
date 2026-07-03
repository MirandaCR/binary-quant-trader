"""
Main trading engine.

Thread architecture:
  - _eval_thread   : periodically re-evaluates all strategy×asset combos
  - _trade_thread  : waits for candle close, places trades with best combo
  - _result_thread : polls for open trade results and records them
"""
import logging
import random
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, date
from typing import Optional, List, Dict, Any, Callable

import pandas as pd

from config.settings import BotConfig
from connection.iq_client import IQClient
from fetcher.data_fetcher import fetch_candles, wait_for_candle_close
from strategies import ALL_STRATEGIES
from strategies.base import BacktestResult
from backtesting.backtester import backtest_strategy, rank_results
from risk.risk_manager import RiskManager
from news.news_fetcher import NewsFetcher
from database import db as DB
from agents.orchestrator import MultiAgentOrchestrator
from ml.signal_scorer import SignalScorer

logger = logging.getLogger(__name__)


class TradingEngine:
    def __init__(self, config: BotConfig, broadcast: Optional[Callable] = None):
        self.config    = config
        self.broadcast = broadcast or (lambda data: None)

        self.client    = IQClient(config.email, config.password, config.account_type)
        self.news      = NewsFetcher(config.news_api_key)
        self.risk: Optional[RiskManager] = None

        self._stop_event    = threading.Event()
        self._eval_lock     = threading.Lock()
        self._live_lock     = threading.Lock()
        self._best_combo: Optional[BacktestResult] = None
        self._all_results: List[BacktestResult]    = []
        self._open_trades:   Dict[int, Dict]       = {}   # order_id → trade info
        self._checking_ids:  set                   = set()  # prevent double-checking
        self._balance:       float                 = 0.0
        self._status:        str                   = "idle"
        self._strategies = [s.__class__() for s in ALL_STRATEGIES]

        # Candle guard: track the open-time of the last candle we executed a trade on,
        # per asset — a portfolio can trade several assets within the same candle.
        self._last_executed_candle: Dict[str, float] = {}

        # Combos temporarily excluded from the portfolio after a live losing streak
        # (cleared on the next full re-evaluation). See _check_live_performance.
        self._excluded_combos: set = set()

        # Live performance tracking per "strategy/asset" key
        # Stores the most recent N boolean results (True=win, False=loss)
        self._live_results: Dict[str, List[bool]] = {}
        self._live_consecutive_losses: Dict[str, int] = {}

        # Session start time — used to close orphaned trades from previous sessions
        self._session_start: datetime = datetime.utcnow()

        # Asset availability — set at startup and updated dynamically
        # Starts as a copy of config.assets; bad assets are removed when buy() keeps failing
        self._active_assets: List[str] = list(config.assets)
        # Per-asset consecutive buy failures; when >= threshold the asset is blacklisted
        self._buy_failures: Dict[str, int] = {}

        self.orchestrator = MultiAgentOrchestrator(config, broadcast_cb=self.broadcast, engine_ref=self)

        # Traditional ML layer (meta-labeling): learns from trade history which
        # strategy/asset/time/confidence combos actually win, to complement the
        # Gen-AI-designed strategies rather than replace them.
        self.ml_scorer = SignalScorer()

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def _log(self, level: str, message: str) -> None:
        """Broadcast a log message to all WebSocket clients."""
        logger.info("[%s] %s", level.upper(), message)
        self.broadcast({
            "type":      "log",
            "level":     level,
            "message":   message,
            "timestamp": datetime.utcnow().isoformat(),
        })

    def start(self) -> tuple[bool, str]:
        self._stop_event.clear()
        self._status = "connecting"
        self._broadcast_status()
        self._log("info", f"Connecting to IQ Option as {self.config.email}…")

        ok, reason = self.client.connect()
        if not ok:
            self._status = "error"
            self._broadcast_status()
            self._log("error", f"Connection failed: {reason}")
            return False, reason

        return self._post_connect_start()

    def _post_connect_start(self) -> tuple[bool, str]:
        """Called after a successful connect."""
        self._session_start = datetime.utcnow()
        self._last_executed_candle = {}
        self._excluded_combos = set()
        self._live_results.clear()
        self._live_consecutive_losses.clear()

        self._balance = self.client.get_balance()
        self._log("success", f"Connected! Balance: ${self._balance:.2f} [{self.config.account_type}]")

        # Close any trades that were left open from a previous session
        orphans = DB.mark_orphaned_trades_expired(before=self._session_start)
        if orphans:
            self._log("warning", f"Closed {orphans} orphaned open trade(s) from previous session(s).")

        self.risk = RiskManager(
            starting_balance=self._balance,
            investment_amount=self.config.investment_amount,
            investment_mode=getattr(self.config, "investment_mode", "fixed"),
            investment_pct=getattr(self.config, "investment_pct", 5.0),
            max_daily_loss_pct=self.config.max_daily_loss_pct,
            max_consecutive_losses=self.config.max_consecutive_losses,
            min_win_rate=self.config.min_win_rate,
            use_compound_interest=getattr(self.config, "use_compound_interest", False),
            compound_factor=getattr(self.config, "compound_factor", 1.0),
            min_win_rate_for_compound=getattr(self.config, "min_win_rate_for_compound", 0.55),
            hard_stop_pct=getattr(self.config, "hard_stop_pct", 75.0),
        )

        # Probe all configured assets before evaluating — discard ones that return no data
        self._log("info", f"Probing {len(self.config.assets)} assets for availability…")
        self._active_assets = self.client.get_available_assets(
            self.config.assets, timeframe=self.config.timeframe
        )
        dead = [a for a in self.config.assets if a not in self._active_assets]
        if dead:
            self._log("warning",
                f"⚠ Removed {len(dead)} unavailable asset(s): {', '.join(dead)}. "
                f"Active: {', '.join(self._active_assets)}"
            )
        else:
            self._log("success", f"All {len(self._active_assets)} assets are available.")

        if not self._active_assets:
            self._status = "error"
            self._broadcast_status()
            self._log("error", "No tradeable assets found — check market hours or asset list.")
            return False, "No tradeable assets found"

        self._status = "evaluating"
        self._broadcast_status()
        n_strategies = len(self._strategies)
        n_assets     = len(self._active_assets)
        self._log("info", f"Evaluating {n_strategies} strategies × {n_assets} assets ({self.config.backtest_periods} candles each)…")
        self._run_evaluation()
        self._retrain_ml_scorer()

        if not self._best_combo:
            self._status = "error"
            self._broadcast_status()
            self._log("error", "No valid strategy found — not enough candle data or all assets closed")
            return False, "No valid strategy found (not enough candle data?)"

        b = self._best_combo
        self._log("success",
            f"Best: {b.strategy_name} / {b.asset}  "
            f"WR={b.win_rate*100:.1f}%  PF={b.profit_factor:.2f}  score={b.composite_score:.4f}")

        portfolio = self._select_portfolio()
        if len(portfolio) > 1:
            combos_str = " | ".join(f"{r.strategy_name}/{r.asset}" for r in portfolio)
            self._log("info", f"📦 Trading portfolio ({len(portfolio)} combos): {combos_str}")

        threading.Thread(target=self._eval_loop,   daemon=True, name="eval").start()
        threading.Thread(target=self._trade_loop,  daemon=True, name="trade").start()
        threading.Thread(target=self._result_loop, daemon=True, name="results").start()

        self.orchestrator.start()

        self._status = "running"
        self._broadcast_status()
        self._log("success", "Bot is RUNNING — waiting for next candle close…")
        return True, "OK"

    def stop(self) -> None:
        self._stop_event.set()
        self.orchestrator.stop()
        self.client.disconnect()
        self._status = "stopped"
        self._broadcast_status()
        logger.info("Engine stopped")

    def update_live_config(
        self,
        investment_amount: float | None = None,
        investment_mode: str | None = None,
        investment_pct: float | None = None,
        use_compound_interest: bool | None = None,
        compound_factor: float | None = None,
        min_win_rate_for_compound: float | None = None,
    ) -> None:
        """Hot-update position-sizing params. Takes effect on the next trade.
        Propagates to both self.config and the live RiskManager instance.
        """
        if investment_amount is not None:
            self.config.investment_amount = investment_amount
        if investment_mode is not None:
            self.config.investment_mode = investment_mode
        if investment_pct is not None:
            self.config.investment_pct = investment_pct
        if use_compound_interest is not None:
            self.config.use_compound_interest = use_compound_interest
        if compound_factor is not None:
            self.config.compound_factor = compound_factor
        if min_win_rate_for_compound is not None:
            self.config.min_win_rate_for_compound = min_win_rate_for_compound

        if self.risk:
            self.risk.update_live_params(
                investment_amount=investment_amount,
                investment_mode=investment_mode,
                investment_pct=investment_pct,
                use_compound_interest=use_compound_interest,
                compound_factor=compound_factor,
                min_win_rate_for_compound=min_win_rate_for_compound,
            )

    # ── Evaluation loop ───────────────────────────────────────────────────────

    def _eval_loop(self) -> None:
        interval = self.config.strategy_eval_interval
        while not self._stop_event.wait(timeout=interval):
            self._log("info", f"Re-evaluating strategies (every {interval}s)…")
            self._run_evaluation()
            self._retrain_ml_scorer()

    def _retrain_ml_scorer(self) -> None:
        try:
            trades = DB.get_trades(limit=2000)
            trained = self.ml_scorer.train(trades)
            if trained:
                self._log("info", f"ML scorer retrained on {self.ml_scorer._trained_on} closed trades.")
        except Exception as e:
            logger.debug("ML scorer retrain skipped: %s", e)

    def _select_portfolio(self) -> List[BacktestResult]:
        """
        Pick up to config.portfolio_size distinct-asset combos to trade concurrently,
        skipping any combo excluded for a recent live losing streak. `_all_results` is
        already ranked best-first, so the first occurrence per asset is that asset's
        best-scoring strategy.
        """
        with self._eval_lock:
            ranked = list(self._all_results)
            excluded = set(self._excluded_combos)

        size = max(1, int(getattr(self.config, "portfolio_size", 1) or 1))
        seen_assets = set()
        portfolio: List[BacktestResult] = []
        for r in ranked:
            if (r.strategy_name, r.asset) in excluded:
                continue
            if r.asset in seen_assets:
                continue
            seen_assets.add(r.asset)
            portfolio.append(r)
            if len(portfolio) >= size:
                break
        return portfolio

    def _portfolio_with_allocation(self) -> List[Dict[str, Any]]:
        """Portfolio combos as dicts, each with its score-proportional capital allocation."""
        portfolio = self._select_portfolio()
        scores = [max(r.composite_score, 0.01) for r in portfolio]
        total  = sum(scores) or 1.0
        out: List[Dict[str, Any]] = []
        for r, s in zip(portfolio, scores):
            d = r.to_dict()
            d["allocation"] = round(s / total, 4)
            out.append(d)
        return out

    def _run_evaluation(self) -> None:
        """Run all strategies × all assets in a thread pool."""
        # Fresh cycle: give previously-excluded combos another chance now that
        # backtest scores (and the ML scorer) have been recomputed.
        with self._eval_lock:
            self._excluded_combos.clear()

        assets  = list(self._active_assets) if self._active_assets else self.config.assets
        tasks   = []
        results = []

        with ThreadPoolExecutor(max_workers=min(8, len(assets) * len(self._strategies))) as ex:
            for asset in assets:
                candles = fetch_candles(
                    self.client, asset, self.config.timeframe,
                    self.config.backtest_periods + 10
                )
                if candles.empty:
                    logger.warning("No candles for %s, skipping", asset)
                    continue
                payout = self.client.get_payout(asset) / 100

                for strat in self._strategies:
                    future = ex.submit(
                        backtest_strategy, strat, candles, asset,
                        payout, 0.55
                    )
                    tasks.append((future, strat.name, asset))

            for future, sname, asset in tasks:
                try:
                    r = future.result(timeout=60)
                    results.append(r)
                    DB.save_strategy_evaluation(r.to_dict())
                except Exception as exc:
                    logger.warning("Eval error [%s/%s]: %s — %r", sname, asset, exc, exc, exc_info=False)

        # Try progressively looser thresholds so there's always a best combo
        ranked = rank_results(results, min_trades=10)
        if not ranked:
            ranked = rank_results(results, min_trades=5)
        if not ranked:
            ranked = rank_results(results, min_trades=3)
        if not ranked:
            # Last resort: take any result with at least 1 trade
            ranked = sorted(
                [r for r in results if r.total_trades >= 1],
                key=lambda r: r.composite_score,
                reverse=True,
            )

        with self._eval_lock:
            prev_best = self._best_combo
            self._all_results = ranked
            if ranked:
                self._best_combo = ranked[0]
                # Log if the best combo changed
                if prev_best is None or prev_best.strategy_name != ranked[0].strategy_name or prev_best.asset != ranked[0].asset:
                    b = ranked[0]
                    self._log("success",
                        f"🔄 Best strategy updated: {b.strategy_name} / {b.asset}  "
                        f"WR={b.win_rate*100:.1f}%  PF={b.profit_factor:.2f}  score={b.composite_score:.4f}"
                    )
                # Log top 3 and any low-scorers for transparency
                if ranked:
                    top3 = " | ".join(f"{r.strategy_name}/{r.asset} WR={r.win_rate*100:.1f}%" for r in ranked[:3])
                    self._log("info", f"📊 Top strategies: {top3}")
                low_scorers = [r for r in ranked if r.composite_score < 0.10]
                if low_scorers:
                    names = ", ".join(f"{r.strategy_name}/{r.asset}({r.composite_score:.3f})" for r in low_scorers[:5])
                    self._log("warning", f"⚠ Low-scoring strategies (score<0.10): {names}")
            else:
                self._log("warning", "⚠ No valid strategy found in evaluation — check candle data / assets")

        self.broadcast({
            "type":      "evaluation_update",
            "results":   [r.to_dict() for r in ranked[:20]],
            "best":      self._best_combo.to_dict() if self._best_combo else None,
            "portfolio": self._portfolio_with_allocation(),
        })

    # ── Trade loop ────────────────────────────────────────────────────────────
    #
    # Strategy: pre-compute the signal BEFORE the candle closes so the buy()
    # call is placed IMMEDIATELY after close, never triggering IQ Option's
    # "buy late 5 sec" rejection.
    #
    # Timeline per cycle:
    #   T - PREFETCH_SECS  →  wake up, fetch candles, generate signal
    #   T - 0              →  candle closes, buy immediately (< 1s latency)
    #   T + 2              →  brief guard pause before next cycle

    _PREFETCH_SECS = 10  # seconds before close to start signal computation

    @property
    def _prefetch_secs(self) -> float:
        """Pre-fetch window capped at 60% of timeframe so it always fits."""
        return min(self._PREFETCH_SECS, self.config.timeframe * 0.6)

    def _trade_loop(self) -> None:
        from fetcher.data_fetcher import seconds_until_next_candle_close
        while not self._stop_event.is_set():
            # Log remaining time to next close
            try:
                server_t = self.client.get_server_timestamp()
                secs = seconds_until_next_candle_close(self.config.timeframe, server_t)
                if secs > self._prefetch_secs + 1:
                    self._log(
                        "info",
                        f"⏱ Waiting {secs:.0f}s for next {self.config.timeframe}s candle close "
                        f"[{self.config.assets[0] if self.config.assets else '?'}…]",
                    )
            except Exception:
                pass

            # Phase 1: wake up _prefetch_secs before close to compute signal
            wait_for_candle_close(
                self.config.timeframe, self.client,
                pre_close_offset=self._prefetch_secs,
            )
            if self._stop_event.is_set():
                break

            # Phase 2: pre-compute signals for the whole portfolio (candle fetch + indicator math)
            cached_trades = self._prepare_trades()

            # Phase 3: wait for the candle to actually close.
            # Entry offset is randomized (not a fixed ~100ms) — a perfectly consistent
            # sub-second entry timing across thousands of trades is a classic bot
            # fingerprint for broker fraud/detection systems.
            entry_offset = random.uniform(0.15, 0.9)
            try:
                server_t = self.client.get_server_timestamp()
                secs_left = seconds_until_next_candle_close(self.config.timeframe, server_t)
                if secs_left > entry_offset + 0.05:
                    time.sleep(secs_left - entry_offset)
            except Exception:
                time.sleep(0.5)

            if self._stop_event.is_set():
                break

            # Phase 4: execute buys immediately at candle close, one per portfolio slot
            for cached_trade in cached_trades:
                self._execute_trade(cached_trade)

            # Guard pause so we don't re-enter the same candle — randomized so the
            # bot's cadence doesn't look perfectly periodic to the millisecond.
            time.sleep(random.uniform(1.5, 3.5))

    def _prepare_trades(self) -> List[Dict]:
        """
        Fetch candles + generate signals for every combo in the current portfolio
        (up to config.portfolio_size distinct assets). Capital is allocated across
        the portfolio proportional to each combo's composite backtest score, so the
        total capital risked per cycle stays comparable to a single full-size trade
        instead of multiplying with portfolio_size.
        """
        portfolio = self._select_portfolio()
        if not portfolio:
            self._log("warning", "⚠ No best combo yet — skipping (still evaluating strategies)")
            return []

        self._balance = self.client.get_balance()
        allowed, reason = self.risk.can_trade(self._balance, portfolio[0].win_rate)
        if not allowed:
            # Hard stop — bot must halt
            self._log("error", f"🛑 HARD STOP: {reason}")
            self.broadcast({"type": "trade_blocked", "reason": reason})
            return []
        if reason.startswith("WARNING:"):
            # Soft limit — continue with reduced position size (handled in get_position_size)
            warn_text = reason[9:].strip()
            self._log("warning", f"⚠ Risk warning (size halved): {warn_text}")
            # Emit dedicated risk_warning event — rate-limited to once per candle
            try:
                from fetcher.data_fetcher import current_candle_open_time
                current_candle = current_candle_open_time(self.config.timeframe, self.client.get_server_timestamp())
            except Exception:
                current_candle = 0.0
            if current_candle != getattr(self, "_last_risk_warn_candle", -1.0):
                self._last_risk_warn_candle = current_candle
                self.broadcast({
                    "type":    "risk_warning",
                    "message": warn_text,
                    "risk":    self.risk.summary(),
                })

        # Capital allocation weight per combo, proportional to composite score
        scores  = [max(r.composite_score, 0.01) for r in portfolio]
        total   = sum(scores)
        weights = [s / total for s in scores]

        live_candle_count = max(60, min(80, self.config.backtest_periods))
        prepared: List[Dict] = []

        for combo, weight in zip(portfolio, weights):
            candles = fetch_candles(
                self.client, combo.asset, self.config.timeframe, live_candle_count
            )
            if candles.empty:
                self._log("warning", f"⚠ No candles for {combo.asset} — skipping")
                continue

            strategy = next((s for s in self._strategies if s.name == combo.strategy_name), None)
            if strategy is None:
                self._log("warning", f"⚠ Strategy '{combo.strategy_name}' not in pool — skipping")
                continue

            signal, confidence = strategy.generate_signal(candles)
            if signal == "neutral" or confidence < 0.55:
                self._log("info", f"Signal: NEUTRAL on {combo.asset} (conf={confidence:.0%}) — skipping")
                continue

            # Traditional ML layer: blend the strategy's confidence with the historical
            # win-probability for this strategy/asset/time combo (no-op until enough
            # closed trades exist to train on).
            blended_confidence, ml_score = self.ml_scorer.blend_confidence(
                combo.strategy_name, combo.asset, confidence
            )
            ml_note = f"  ml={ml_score:.0%}" if ml_score is not None else ""
            self._log("trade",
                f"Signal: {signal.upper()} on {combo.asset}  conf={confidence:.0%}{ml_note}  "
                f"alloc={weight:.0%}  [{combo.strategy_name}]"
            )

            prepared.append({
                "signal":     signal,
                "confidence": blended_confidence,
                "combo":      combo,
                "candles":    candles,
                "balance":    self._balance,
                "weight":     weight,
                "ml_score":   ml_score,
                "raw_confidence": confidence,
            })

        return prepared

    def _execute_trade(self, cached: Dict) -> None:
        """Place the buy order using a pre-computed signal dict."""
        from fetcher.data_fetcher import current_candle_open_time

        signal     = cached["signal"]
        confidence = cached["confidence"]
        combo      = cached["combo"]
        candles    = cached["candles"]
        weight     = cached.get("weight", 1.0)

        # Candle guard: never trade the same asset twice on the same candle
        # (a portfolio can hold several assets, so this is tracked per-asset).
        try:
            server_t = self.client.get_server_timestamp()
            candle_open = current_candle_open_time(self.config.timeframe, server_t)
        except Exception:
            candle_open = 0.0

        last_for_asset = self._last_executed_candle.get(combo.asset, 0.0)
        if candle_open > 0 and candle_open <= last_for_asset:
            self._log("warning", f"⚠ Skipping duplicate signal on {combo.asset} — already traded candle at t={candle_open:.0f}")
            return

        # Position size is the full risk-based stake scaled by this combo's share of
        # the portfolio, so total capital deployed per cycle stays in line with what
        # a single full-size trade would risk instead of stacking with portfolio_size.
        amount = round(max(self.risk.get_position_size(self._balance, confidence) * weight, 0.01), 2)
        open_price = float(candles["close"].iloc[-1])

        exp_seconds = getattr(self.config, "expiration_seconds", None)
        ok, order_id = self.client.buy(
            amount, combo.asset, signal, self.config.expiration_minutes,
            expiration_seconds=exp_seconds,
        )
        if not ok or order_id is None:
            logger.error("buy() failed for %s", combo.asset)
            # Track consecutive buy failures per asset
            self._buy_failures[combo.asset] = self._buy_failures.get(combo.asset, 0) + 1
            if self._buy_failures[combo.asset] >= 2:
                if combo.asset in self._active_assets:
                    self._active_assets.remove(combo.asset)
                    self._log("warning",
                        f"🚫 Asset {combo.asset} removed from pool after "
                        f"{self._buy_failures[combo.asset]} consecutive buy failures. "
                        f"Remaining: {', '.join(self._active_assets)}"
                    )
                    # Force a re-evaluation without the removed asset
                    threading.Thread(
                        target=self._run_evaluation,
                        daemon=True,
                        name="eval-asset-removed",
                    ).start()
            return

        # Reset failure counter on successful buy
        self._buy_failures[combo.asset] = 0

        now = datetime.utcnow()
        balance_before = self._balance
        trade_data = {
            "order_id":           str(order_id),
            "asset":              combo.asset,
            "direction":          signal,
            "amount":             amount,
            "expiration_minutes": self.config.expiration_minutes,
            "strategy_name":      combo.strategy_name,
            "confidence":         confidence,
            "open_price":         open_price,
            "opened_at":          now,
            "timeframe":          self.config.timeframe,
            "account_type":       self.config.account_type,
            "balance_before":     balance_before,
        }
        DB.save_trade(trade_data)
        trade_data["expiration_seconds"] = exp_seconds
        # Extra (non-DB) fields for the live UI: the raw ML win-probability and the
        # strategy's own pre-blend confidence, so the dashboard can show how much the
        # ML layer nudged the final confidence.
        trade_data["ml_score"] = cached.get("ml_score")
        trade_data["raw_confidence"] = cached.get("raw_confidence")
        trade_data["allocation"] = weight
        self._open_trades[order_id] = trade_data

        # Mark this candle as used for this asset — prevents double-trading it
        if candle_open > 0:
            self._last_executed_candle[combo.asset] = candle_open

        self._log("trade", f"✓ Trade placed: {signal.upper()} {combo.asset} @ {open_price:.5f}  ${amount:.2f}  exp={self.config.expiration_minutes}m")
        logger.info("TRADE → %s %s @ %.5f | $%.2f | conf=%.2f | strategy=%s",
                    signal.upper(), combo.asset, open_price, amount,
                    confidence, combo.strategy_name)

        self.broadcast({
                "type":           "trade_opened",
                "trade":          {**trade_data, "opened_at": now.isoformat(),
                                   "balance_before": self._balance},
                "balance":        self._balance,
                "balance_before": self._balance,
            })

    # ── Result loop ───────────────────────────────────────────────────────────

    def _result_loop(self) -> None:
        """Spawn one daemon thread per open trade so check_win never blocks others."""
        while not self._stop_event.is_set():
            time.sleep(1)
            for oid in list(self._open_trades.keys()):
                if oid not in self._checking_ids:
                    self._checking_ids.add(oid)
                    threading.Thread(
                        target=self._check_single_trade,
                        args=(oid,),
                        daemon=True,
                        name=f"result-{oid}",
                    ).start()

    def _check_single_trade(self, oid: int) -> None:
        """
        Blocks in its own thread until the trade settles.
        IMPORTANT: only removes the trade from _open_trades when result is
        definitively known (win/loss). If check_win returns None (timeout),
        the trade stays in _open_trades so it can be retried.
        """
        info = self._open_trades.get(oid)
        if info is None:
            self._checking_ids.discard(oid)
            return

        profit = None
        try:
            exp_sec = info.get("expiration_seconds")
            profit = self.client.check_win(
                oid,
                amount=float(info.get("amount", self.config.investment_amount)),
                expiration_minutes=int(info.get("expiration_minutes",
                                                self.config.expiration_minutes)),
                expiration_seconds=int(exp_sec) if exp_sec is not None else None,
            )
        except Exception as exc:
            logger.error("check_win exception for order %s: %s", oid, exc)

        if profit is None:
            # Prevent infinite waiting: after expiration + buffer, settle using balance change or force loss
            opened_at_val = info.get("opened_at")
            if isinstance(opened_at_val, str):
                opened_at = datetime.fromisoformat(opened_at_val)
            elif isinstance(opened_at_val, datetime):
                opened_at = opened_at_val
            else:
                opened_at = datetime.utcnow()

            exp_sec = info.get("expiration_seconds")
            if exp_sec is not None:
                exp_sec = int(exp_sec)
            else:
                exp_sec = info.get("expiration_minutes", 1) * 60
            elapsed = (datetime.utcnow() - opened_at).total_seconds()

            if elapsed > exp_sec + 90:
                amount = float(info.get("amount", self.config.investment_amount))
                balance_before = info.get("balance_before")
                try:
                    balance_now = self.client.get_balance()
                    if balance_before is not None:
                        balance_before = float(balance_before)
                        change = balance_now - balance_before
                        payout_ratio = self.client.get_payout(info.get("asset", "")) / 100.0 if self.client.get_payout(info.get("asset", "")) > 1 else self.client.get_payout(info.get("asset", ""))
                        expected_win = amount * payout_ratio
                        if change >= expected_win * 0.5:
                            profit = change
                            logger.warning("Trade %s timeout: inferred WIN from balance change +%.2f", oid, change)
                        else:
                            profit = -amount
                            logger.error("Trade %s stuck in waiting, marking as loss (balance change %.2f)", oid, change)
                    else:
                        profit = -amount
                        logger.error("Trade %s stuck in waiting, marking as loss", oid)
                except Exception as e:
                    logger.error("Trade %s stuck in waiting, marking as loss: %s", oid, e)
                    profit = -amount
            else:
                self._checking_ids.discard(oid)
                return

        # ── Trade has settled ─────────────────────────────────────────────────
        won = profit > 0
        now = datetime.utcnow()
        strategy_name = info.get("strategy_name", "unknown")
        asset         = info.get("asset", "unknown")
        try:
            raw      = self.client.get_candles(asset, self.config.timeframe, 1)
            close_px = float(raw[-1]["close"]) if raw else info.get("open_price", 0.0)

            self._balance = self.client.get_balance()
            DB.update_trade_result(str(oid), profit, won, close_px, now, balance_after=self._balance)
            DB.upsert_daily_pnl(
                date.today().isoformat(), profit, won, self._balance
            )
            self.risk.record_result(profit, won)

            result_str = "WIN" if won else "LOSS"
            sign       = "+" if profit > 0 else ""
            self._log(
                "success" if won else "error",
                f"{result_str}  {sign}${profit:.2f}  |  {asset}  |  Balance: ${self._balance:.2f}"
            )
            logger.info("RESULT %s | %s | profit=%.2f | balance=%.2f",
                        result_str, asset, profit, self._balance)
            self.broadcast({
                "type":          "trade_closed",
                "order_id":      str(oid),
                "profit":        profit,
                "win":           won,
                "balance":       self._balance,
                "balance_after": self._balance,
                "risk":          self.risk.summary(),
            })

            # Update live performance tracker
            self._record_live_result(strategy_name, asset, won)

        except Exception as exc:
            logger.error("Result processing error for order %s: %s", oid, exc)
        finally:
            # Only reach here when trade settled — safe to remove permanently
            self._open_trades.pop(oid, None)
            self._checking_ids.discard(oid)

    # ── Live performance tracking ─────────────────────────────────────────────

    _LIVE_WINDOW    = 10   # how many recent results to keep per combo
    _MAX_CONSEC_LOSS = 3   # consecutive live losses before forcing rotation
    _MIN_LIVE_WR    = 0.40  # minimum live win rate over the window before rotation

    def _record_live_result(self, strategy_name: str, asset: str, won: bool) -> None:
        """Record a live trade result and trigger performance checks."""
        key = f"{strategy_name}/{asset}"
        with self._live_lock:
            bucket = self._live_results.setdefault(key, [])
            bucket.insert(0, won)          # newest first
            if len(bucket) > self._LIVE_WINDOW:
                bucket.pop()

            # Consecutive losses from the top of the list
            consec = 0
            for r in bucket:
                if not r:
                    consec += 1
                else:
                    break
            self._live_consecutive_losses[key] = consec

        self._check_live_performance(strategy_name, asset, consec, len(bucket))

    def _check_live_performance(
        self, strategy_name: str, asset: str, consec_losses: int, sample: int
    ) -> None:
        """Exclude a losing combo from the active portfolio and force re-evaluation."""
        portfolio = self._select_portfolio()
        is_active = any(r.strategy_name == strategy_name and r.asset == asset for r in portfolio)
        if not is_active:
            return  # only act on combos currently executing trades

        # Compute live win rate
        with self._live_lock:
            bucket = self._live_results.get(f"{strategy_name}/{asset}", [])
        live_wr = sum(bucket) / len(bucket) if bucket else 1.0

        trigger_msg = None
        if consec_losses >= self._MAX_CONSEC_LOSS:
            trigger_msg = (
                f"🔴 {consec_losses} consecutive LIVE losses with "
                f"{strategy_name}/{asset} — excluding from portfolio & re-evaluating…"
            )
        elif sample >= 5 and live_wr < self._MIN_LIVE_WR:
            trigger_msg = (
                f"⚠ Live WR={live_wr:.0%} ({sample} trades) for "
                f"{strategy_name}/{asset} — excluding from portfolio…"
            )

        if trigger_msg:
            self._log("warning", trigger_msg)

            # Exclude this combo from the portfolio until the next full re-evaluation,
            # and promote the next-best distinct-asset combo to fill its slot.
            with self._eval_lock:
                self._excluded_combos.add((strategy_name, asset))
                if self._best_combo and self._best_combo.strategy_name == strategy_name and self._best_combo.asset == asset:
                    alternatives = [
                        r for r in self._all_results
                        if not (r.strategy_name == strategy_name and r.asset == asset)
                    ]
                    if alternatives:
                        self._best_combo = alternatives[0]

            new_portfolio = self._select_portfolio()
            if new_portfolio:
                combos_str = " | ".join(f"{r.strategy_name}/{r.asset}" for r in new_portfolio)
                self._log("success", f"↪ Active portfolio now: {combos_str}")

            # Notify orchestrator to run an express improvement cycle
            self.orchestrator.report_live_loss(strategy_name, asset, consec_losses, live_wr)

    # ── State helpers ─────────────────────────────────────────────────────────

    def _broadcast_status(self) -> None:
        self.broadcast({"type": "status_change", "status": self._status})

    def get_state(self) -> Dict[str, Any]:
        with self._eval_lock:
            best = self._best_combo.to_dict() if self._best_combo else None
            all_r = [r.to_dict() for r in self._all_results[:20]]
        return {
            "status":        self._status,
            "balance":       self._balance,
            "best_combo":    best,
            "all_results":   all_r,
            "portfolio":     self._portfolio_with_allocation(),
            "ml_scorer":     {
                "ready":       self.ml_scorer.is_ready,
                "trained_on":  self.ml_scorer._trained_on,
            },
            "open_trades":   len(self._open_trades),
            "risk":          self.risk.summary() if self.risk else {},
        }
