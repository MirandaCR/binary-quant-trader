"""
Multi-Agent Orchestrator for Binary Trader.
Architecture:
  OrchestratorAgent  ─ master coordinator (runs all sub-agents in sequence)
  NewsAgent          ─ fetches & summarizes high-impact market news
  ResearchAgent      ─ uses LLM to discover new strategy ideas from news + data
  BacktestAgent      ─ backtests newly discovered strategies on live candle data
  TradeAnalysisAgent ─ analyses current trades, integrates approved strategies
  ParameterOptimizer ─ reviews stats, suggests timeframe/asset/strategy adjustments
"""
import time
import threading
import logging
from typing import Callable, Any, Dict, List, Optional
from datetime import datetime

import pandas as pd
import numpy as np

from config.settings import BotConfig
from agents.llm_providers import create_llm_provider
from news.news_fetcher import NewsFetcher
from strategies.base import BaseStrategy

logger = logging.getLogger(__name__)

# ─── Agent names ──────────────────────────────────────────────────────────────
AGENTS = [
    "OrchestratorAgent",
    "NewsAgent",
    "ResearchAgent",
    "BacktestAgent",
    "TradeAnalysisAgent",
    "ParameterOptimizer",
]


def _now() -> str:
    return datetime.utcnow().isoformat(timespec="seconds")


class MultiAgentOrchestrator:
    def __init__(
        self,
        config: BotConfig,
        broadcast_cb: Callable[[Dict[str, Any]], None],
        engine_ref=None,
    ):
        self.config = config
        self.broadcast = broadcast_cb
        self.engine_ref = engine_ref
        self.llm = create_llm_provider(config)
        self.news_fetcher = NewsFetcher(config.news_api_key)
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._cycle = 0

        # Rich per-agent state
        self.agents_state: Dict[str, Dict[str, Any]] = {
            name: {
                "status": "Idle",
                "task": "Waiting for orchestrator to start…",
                "last_output": "",
                "cycle": 0,
                "last_run": "",
            }
            for name in AGENTS
        }

        # Shared rolling activity log (latest first)
        self._activity_log: List[Dict[str, str]] = []

        # Live loss event: set by the engine when a strategy has too many live losses
        self._live_loss_event = threading.Event()
        self._live_loss_data: Optional[Dict[str, Any]] = None  # {strategy, asset, losses, win_rate}

    # ── State helpers ─────────────────────────────────────────────────────────

    def _set(
        self,
        agent: str,
        status: str,
        task: str = "",
        output: str = "",
        log: bool = True,
    ):
        self.agents_state[agent]["status"] = status
        if task:
            self.agents_state[agent]["task"] = task
        if output:
            self.agents_state[agent]["last_output"] = output
        self.agents_state[agent]["last_run"] = _now()
        self.agents_state[agent]["cycle"] = self._cycle

        if log and (task or output):
            entry = {
                "agent": agent,
                "status": status,
                "message": output or task,
                "time": _now(),
            }
            self._activity_log = [entry] + self._activity_log[:49]  # keep last 50

        self._broadcast()

    def _broadcast(self):
        self.broadcast(
            {
                "type": "agent_orchestrator_update",
                "agents": self.agents_state,
                "activity_log": self._activity_log[:20],
                "cycle": self._cycle,
                "timestamp": _now(),
            }
        )

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run, daemon=True, name="agent-orchestrator"
        )
        self._thread.start()
        self._set(
            "OrchestratorAgent",
            "Starting",
            "Initializing multi-agent system…",
            "All agents online. First cycle begins in 10 s.",
        )

    def stop(self):
        self._stop_event.set()
        for agent in AGENTS:
            self.agents_state[agent]["status"] = "Stopped"
        self._broadcast()

    def report_live_loss(
        self,
        strategy_name: str,
        asset: str,
        consecutive_losses: int,
        win_rate: float,
    ) -> None:
        """Called by the engine when a strategy has too many consecutive live losses."""
        self._live_loss_data = {
            "strategy": strategy_name,
            "asset": asset,
            "consecutive_losses": consecutive_losses,
            "win_rate": win_rate,
        }
        self._live_loss_event.set()
        logger.info(
            "Live-loss event signalled: %s/%s  consec=%d  wr=%.0f%%",
            strategy_name, asset, consecutive_losses, win_rate * 100,
        )

    # ── Main loop ─────────────────────────────────────────────────────────────

    def _run(self):
        time.sleep(10)
        while not self._stop_event.is_set():
            self._cycle += 1

            if not self.config.ai_api_key:
                self._set(
                    "OrchestratorAgent",
                    "Waiting",
                    "No AI API key — configure one in the settings panel.",
                    "",
                )
                # Still check for live loss events even without AI key
                self._live_loss_event.wait(timeout=15)
                self._live_loss_event.clear()
                continue

            # Check if this cycle is triggered by a live loss emergency
            is_express = self._live_loss_event.is_set()
            self._live_loss_event.clear()
            loss_ctx = self._live_loss_data
            self._live_loss_data = None

            cycle_type = "🚨 EXPRESS (live-loss)" if is_express else f"Cycle #{self._cycle}"

            # ── Orchestrator kicks off cycle ──────────────────────────────────
            self._set(
                "OrchestratorAgent",
                "Running",
                f"{cycle_type} — dispatching all agents…",
                f"Dispatching NewsAgent → ResearchAgent → BacktestAgent → TradeAnalysisAgent → ParameterOptimizer",
            )

            news_context = self._run_news_agent()
            if self._stop_event.is_set():
                break

            # For express cycles, include loss context in the research prompt
            research_hint = ""
            if is_express and loss_ctx:
                research_hint = (
                    f"URGENT: Strategy '{loss_ctx['strategy']}' on {loss_ctx['asset']} "
                    f"has {loss_ctx['consecutive_losses']} consecutive LIVE losses "
                    f"(live WR={loss_ctx['win_rate']:.0%}). "
                    f"Design a replacement strategy that avoids its weaknesses."
                )

            strategy_code, class_name = self._run_research_agent(news_context, extra_hint=research_hint)
            if self._stop_event.is_set():
                break

            new_strat_added = self._run_backtest_agent(strategy_code, class_name)
            if self._stop_event.is_set():
                break

            self._run_trade_analysis_agent(new_strat_added, loss_ctx=loss_ctx)
            if self._stop_event.is_set():
                break

            self._run_parameter_optimizer()
            if self._stop_event.is_set():
                break

            # ── Cycle complete ────────────────────────────────────────────────
            wait_secs = 20 if is_express else 60
            self._set(
                "OrchestratorAgent",
                "Completed",
                f"{cycle_type} finished. Next cycle in ~{wait_secs} s.",
                f"Cycle complete. Agents processed: news, research, backtest, analysis, optimization.",
            )
            # During wait, a new live-loss event can interrupt the sleep
            self._live_loss_event.wait(timeout=wait_secs)
            self._live_loss_event.clear()

    # ── Agent implementations ─────────────────────────────────────────────────

    def _run_news_agent(self) -> str:
        self._set(
            "NewsAgent",
            "Running",
            "Fetching high-impact market news from all configured sources…",
        )
        try:
            assets = getattr(self.config, "assets", []) or ["EURUSD-OTC"]
            news_data = self.news_fetcher.get_all_news(assets[:8], limit_each=3)
            if news_data:
                titles = [n.get("title", "") for n in news_data[:5]]
                context = " | ".join(titles)
                sentiment_summary = self._summarize_news_sentiment(news_data)
                self._set(
                    "NewsAgent",
                    "Done",
                    f"Analysed {len(news_data)} articles.",
                    f"{sentiment_summary} Headlines: {', '.join(t[:60] for t in titles[:3])}",
                )
                return context
            else:
                self._set(
                    "NewsAgent",
                    "No Data",
                    "No news API key configured or no results returned.",
                    "Continuing cycle without news context.",
                )
                return "No recent news available."
        except Exception as e:
            logger.warning("NewsAgent error: %s", e)
            self._set("NewsAgent", "Error", "News fetch failed.", str(e))
            return "News unavailable."

    def _summarize_news_sentiment(self, news_data: list) -> str:
        pos = sum(1 for n in news_data if n.get("sentiment") == "positive")
        neg = sum(1 for n in news_data if n.get("sentiment") == "negative")
        if pos > neg:
            return f"Market sentiment: BULLISH ({pos}/{len(news_data)} positive)."
        elif neg > pos:
            return f"Market sentiment: BEARISH ({neg}/{len(news_data)} negative)."
        return f"Market sentiment: MIXED ({len(news_data)} articles)."

    def _run_research_agent(self, news_context: str, extra_hint: str = ""):
        self._set(
            "ResearchAgent",
            "Running",
            "Researching new strategy ideas from news context and live performance data…",
        )
        best_combo_str = "None"
        balance = 0.0
        top_results_str = "No evaluations yet."
        live_perf_str = ""

        if self.engine_ref:
            balance = getattr(self.engine_ref, "_balance", 0.0)
            best = getattr(self.engine_ref, "_best_combo", None)
            if best:
                best_combo_str = (
                    f"{best.strategy_name} / {best.asset}  "
                    f"WR={best.win_rate:.2%}  score={best.composite_score:.3f}"
                )
            all_results = getattr(self.engine_ref, "_all_results", [])
            top = sorted(all_results, key=lambda r: r.composite_score, reverse=True)[:5]
            top_results_str = "; ".join(
                f"{r.strategy_name}/{r.asset} WR={r.win_rate:.2%}"
                for r in top
            ) or top_results_str

            # Include live performance data
            live_data = getattr(self.engine_ref, "_live_consecutive_losses", {})
            live_high_loss = [
                f"{k} ({v} consec losses)"
                for k, v in live_data.items() if v >= 2
            ]
            if live_high_loss:
                live_perf_str = f"Live losing strategies: {', '.join(live_high_loss[:5])}."

        fallback_class = f"AIGen_{int(time.time())}"

        urgent_block = f"\n{extra_hint}\n" if extra_hint else ""
        live_block = f"\nLive performance issues: {live_perf_str}\n" if live_perf_str else ""

        prompt = (
            f"Market context: {news_context}\n"
            f"Current balance: ${balance:.2f}. Best active strategy: {best_combo_str}.\n"
            f"Top 5 evaluated combos: {top_results_str}\n"
            f"{urgent_block}{live_block}\n"
            f"TASK: Design a NEW binary-options strategy and implement it as a Python class.\n\n"
            f"RULES — follow exactly:\n"
            f"1. First line MUST be: # STRATEGY_NAME: <YourDescriptiveName>\n"
            f"   The name must be 2-4 words joined with underscore, e.g. RSI_EMA_Divergence or Bollinger_Momentum_Breakout.\n"
            f"   Choose a name that reflects the indicators and logic used.\n"
            f"2. Output ONLY raw Python code. No markdown, no ``` fences, no imports, no explanations.\n"
            f"3. The class MUST inherit from BaseStrategy and MUST have def __init__(self) calling super().__init__(\"StrategyName\").\n"
            f"4. Available built-in helpers (call as self.method): "
            f"_rsi(close, period), _ema(close, n), _sma(close, n), _atr(df, n), "
            f"_macd(close, fast, slow, signal) → (macd, signal, hist), "
            f"_bollinger(close, period, std_dev) → (upper, mid, lower), "
            f"_stoch(df, k_period, d_period) → (stoch_k, stoch_d), "
            f"_adx(df, period), _stddev(close, period), _momentum(close, period), "
            f"_williams_r(df, period), _cci(df, period). "
            f"DO NOT call any other helper methods. DO NOT use imports.\n"
            f"5. candles DataFrame has columns: open, high, low, close, volume.\n"
            f"6. Return ('call', confidence), ('put', confidence), or ('neutral', 0.0). "
            f"confidence must be a float between 0.50 and 0.90.\n\n"
            f"Example output format (replace with your real implementation):\n"
            f"# STRATEGY_NAME: RSI_Momentum_Reversal\n"
            f"class RSI_Momentum_Reversal(BaseStrategy):\n"
            f"    def __init__(self):\n"
            f"        super().__init__('RSI_Momentum_Reversal')\n"
            f"    def generate_signal(self, candles):\n"
            f"        if len(candles) < 20: return 'neutral', 0.0\n"
            f"        rsi = self._rsi(candles['close'], 14)\n"
            f"        if rsi.iloc[-1] < 30: return 'call', 0.68\n"
            f"        if rsi.iloc[-1] > 70: return 'put', 0.68\n"
            f"        return 'neutral', 0.0\n"
        )

        try:
            code = self.llm.chat_completion([
                {
                    "role": "system",
                    "content": (
                        "You are an expert algorithmic trader and Python developer. "
                        "Output ONLY raw Python code — no markdown, no ``` fences, no imports, no comments except "
                        "the required # STRATEGY_NAME: line on the very first line. "
                        "The class must have a def generate_signal method."
                    ),
                },
                {"role": "user", "content": prompt},
            ])

            if not code:
                self._set("ResearchAgent", "Failed", "LLM returned empty response.", "No code received from AI.")
                return None, None

            # Strip any markdown fences the LLM may have added anyway
            code = code.replace("```python", "").replace("```", "").strip()

            # Extract descriptive name from first line comment "# STRATEGY_NAME: XYZ"
            class_name = fallback_class
            lines = code.splitlines()
            if lines and lines[0].strip().startswith("# STRATEGY_NAME:"):
                raw_name = lines[0].split(":", 1)[1].strip()
                # Sanitise: only alnum + underscores, no spaces
                import re as _re
                safe = _re.sub(r"[^A-Za-z0-9_]", "_", raw_name).strip("_")
                if safe:
                    class_name = safe
                # Remove the comment line from code before further processing
                code = "\n".join(lines[1:]).strip()

            if "def generate_signal" not in code:
                logger.warning("ResearchAgent: no generate_signal in response.")
                self._set(
                    "ResearchAgent",
                    "Failed",
                    "LLM did not include 'generate_signal' method.",
                    f"Response snippet: {code[:120]}",
                )
                return None, None

            # Ensure class definition is present with the resolved name
            if f"class {class_name}" not in code:
                # Try to find any class definition and rename it, otherwise wrap
                import re as _re2
                class_match = _re2.search(r"class\s+(\w+)\s*\(", code)
                if class_match:
                    code = _re2.sub(r"class\s+\w+\s*\(", f"class {class_name}(", code, count=1)
                else:
                    code = f"class {class_name}(BaseStrategy):\n" + "\n".join(
                        "    " + line if line.strip() else line
                        for line in code.splitlines()
                    )

            self._set(
                "ResearchAgent",
                "Done",
                f"Generated strategy '{class_name}' from market context.",
                f"Strategy '{class_name}' ({len(code)} chars) ready for backtesting.",
            )
            return code, class_name
        except Exception as e:
            logger.warning("ResearchAgent error: %s", e)
            self._set("ResearchAgent", "Error", "LLM call failed.", str(e))
            return None, None

    def _run_backtest_agent(self, strategy_code: Optional[str], class_name: Optional[str]) -> Optional[object]:
        if not strategy_code or not class_name:
            self._set(
                "BacktestAgent",
                "Skipped",
                "No new strategy to backtest — ResearchAgent produced no code.",
                "Waiting for valid strategy from ResearchAgent.",
            )
            return None

        self._set(
            "BacktestAgent",
            "Running",
            f"Compiling and backtesting '{class_name}' on historical candle data…",
        )

        try:
            local_env: Dict[str, Any] = {}
            global_env: Dict[str, Any] = {"BaseStrategy": BaseStrategy, "pd": pd, "np": np}
            exec(strategy_code, global_env, local_env)

            new_strat = None
            for _cls_name, obj in {**global_env, **local_env}.items():
                if isinstance(obj, type) and issubclass(obj, BaseStrategy) and obj is not BaseStrategy:
                    # Try multiple instantiation signatures the AI might have generated
                    for _args, _kwargs in [
                        ([], {}),                         # __init__(self) with super().__init__("name")
                        ([_cls_name], {}),                # __init__(self, name)
                        ([], {"name": _cls_name}),        # __init__(self, name=...)
                    ]:
                        try:
                            new_strat = obj(*_args, **_kwargs)
                            break
                        except TypeError:
                            continue
                    if new_strat is not None:
                        break

            if not new_strat:
                self._set(
                    "BacktestAgent",
                    "Failed",
                    "Could not find a valid BaseStrategy subclass in generated code.",
                    "Code compiled but no valid class found.",
                )
                return None

            # Quick signal test on engine data
            backtest_passed = False
            best_score = 0.0
            best_asset = "N/A"

            if self.engine_ref:
                from backtesting.backtester import backtest_strategy
                from fetcher.data_fetcher import fetch_candles

                config = self.config
                timeframe = getattr(config, "timeframe", 60)
                # Prefer the engine's live active asset list (avoids known-bad assets)
                active = getattr(self.engine_ref, "_active_assets", None)
                all_cfg = getattr(self.config, "assets", [])
                assets = (list(active) if active else all_cfg)[:6]

                for asset in assets:
                    try:
                        candles = fetch_candles(
                            self.engine_ref.client,
                            asset,
                            timeframe,
                            getattr(config, "backtest_periods", 100) + 10,
                        )
                        if candles.empty or len(candles) < 50:
                            continue
                        payout = 0.80
                        try:
                            p = self.engine_ref.client.get_payout(asset)
                            if isinstance(p, (int, float)) and p > 0:
                                payout = float(p) / 100.0 if p > 1 else float(p)
                        except Exception:
                            pass
                        res = backtest_strategy(
                            new_strat, candles, asset, payout=payout, min_confidence=0.55
                        )
                        if res.total_trades >= 5 and res.composite_score > best_score:
                            best_score = res.composite_score
                            best_asset = asset
                            if res.composite_score >= 0.15:
                                backtest_passed = True
                    except Exception as be:
                        logger.debug("BacktestAgent %s/%s: %r", new_strat.name, asset, be, exc_info=True)

            if backtest_passed:
                self._set(
                    "BacktestAgent",
                    "Approved",
                    f"Strategy '{new_strat.name}' APPROVED — best score {best_score:.3f} on {best_asset}.",
                    f"Composite score {best_score:.3f} ≥ 0.15 threshold. Forwarding to TradeAnalysisAgent.",
                )
                return new_strat
            else:
                self._set(
                    "BacktestAgent",
                    "Rejected",
                    f"Strategy '{new_strat.name}' REJECTED — best score {best_score:.3f} below threshold 0.15.",
                    f"Score {best_score:.3f} insufficient. Strategy discarded.",
                )
                return None

        except Exception as e:
            logger.error("BacktestAgent error: %s", e)
            self._set("BacktestAgent", "Error", "Backtest execution failed.", str(e))
            return None

    def _run_trade_analysis_agent(self, new_strat: Optional[object], loss_ctx: Optional[Dict] = None):
        self._set(
            "TradeAnalysisAgent",
            "Running",
            "Analysing current trade performance and integrating approved strategies…",
        )

        if not self.engine_ref:
            self._set(
                "TradeAnalysisAgent",
                "Waiting",
                "Engine not available — bot must be running.",
                "Will retry when bot is active.",
            )
            return

        # Inject approved strategy and immediately re-evaluate to rank it
        if new_strat:
            try:
                with self.engine_ref._eval_lock:
                    # Avoid duplicates by name
                    existing_names = {s.name for s in self.engine_ref._strategies}
                    if new_strat.name not in existing_names:
                        self.engine_ref._strategies.append(new_strat)
                self._set(
                    "TradeAnalysisAgent",
                    "Deployed",
                    f"Strategy '{new_strat.name}' injected — triggering immediate evaluation…",
                    f"'{new_strat.name}' added to strategy pool. Running fast evaluation now.",
                )
                # Trigger an immediate re-evaluation in a background thread so
                # the new strategy can be ranked and potentially promoted to best combo
                import threading as _th
                _th.Thread(
                    target=self.engine_ref._run_evaluation,
                    daemon=True,
                    name=f"eval-inject-{new_strat.name}",
                ).start()
            except Exception as e:
                self._set("TradeAnalysisAgent", "Error", "Failed to inject strategy.", str(e))
                return

        # Analyse recent performance using REAL live trades + backtest data
        try:
            from database import db as _DB
            all_results = getattr(self.engine_ref, "_all_results", [])
            balance = getattr(self.engine_ref, "_balance", 0.0)
            best = getattr(self.engine_ref, "_best_combo", None)

            # Get real live trade stats per strategy
            live_perf = _DB.get_live_performance_by_strategy(limit_per_combo=20)

            if not all_results and not live_perf:
                self._set(
                    "TradeAnalysisAgent",
                    "Monitoring",
                    "No evaluations yet — waiting for first strategy eval cycle.",
                    "Bot is live but no strategy results available yet.",
                )
                return

            # Build a rich context combining backtest + live data
            top5 = sorted(all_results, key=lambda r: r.composite_score, reverse=True)[:5]
            bottom5 = sorted(all_results, key=lambda r: r.composite_score)[:5]
            top_str = "; ".join(f"{r.strategy_name}/{r.asset} WR={r.win_rate:.2%}" for r in top5)
            bot_str = "; ".join(f"{r.strategy_name}/{r.asset} score={r.composite_score:.3f}" for r in bottom5)
            best_str = f"{best.strategy_name}/{best.asset} WR={best.win_rate:.2%}" if best else "None"

            # Live stats summary (top 5 worst by consecutive losses)
            live_issues = sorted(
                live_perf.items(),
                key=lambda kv: (-kv[1]["consecutive_losses"], kv[1]["win_rate"])
            )[:5]
            live_str = "; ".join(
                f"{k} live-WR={v['win_rate']:.0%} consec_loss={v['consecutive_losses']} ({v['total']} trades)"
                for k, v in live_issues
            ) if live_issues else "No live data yet."

            # Loss context from express cycle
            loss_warning = ""
            if loss_ctx:
                loss_warning = (
                    f"\n⚠ URGENT: '{loss_ctx['strategy']}/{loss_ctx['asset']}' triggered live-loss alert "
                    f"({loss_ctx['consecutive_losses']} losses, WR={loss_ctx['win_rate']:.0%}). "
                    f"Recommend immediate strategy rotation or parameter adjustment.\n"
                )

            analysis_prompt = (
                f"Binary options trading bot — current session:\n"
                f"Balance: ${balance:.2f}. Active strategy: {best_str}.\n"
                f"Backtest top 5: {top_str}\n"
                f"Backtest bottom 5: {bot_str}\n"
                f"Live performance: {live_str}\n"
                f"{loss_warning}"
                f"Provide one concise action recommendation. Focus on live data over backtest when available. "
                f"Should the bot switch strategy, switch assets, adjust risk, or stay the course? Max 2 sentences."
            )
            advice = self.llm.chat_completion([
                {"role": "system", "content": "You are a concise binary options trading analyst specializing in live performance."},
                {"role": "user", "content": analysis_prompt},
            ])

            output = advice[:300] if advice else "Analysis complete. Monitor live win rate closely."
            self._set(
                "TradeAnalysisAgent",
                "Done",
                "Trade analysis complete.",
                output,
            )
        except Exception as e:
            logger.error("TradeAnalysisAgent error: %s", e)
            self._set("TradeAnalysisAgent", "Error", "Analysis failed.", str(e))

    def _run_parameter_optimizer(self):
        self._set(
            "ParameterOptimizer",
            "Running",
            "Reviewing statistics to suggest optimal timeframe, assets, and strategy pool…",
        )

        if not self.engine_ref:
            self._set(
                "ParameterOptimizer",
                "Waiting",
                "Engine not running — parameters cannot be reviewed.",
                "Waiting for active bot session.",
            )
            return

        try:
            from database import db as _DB
            all_results = getattr(self.engine_ref, "_all_results", [])
            strategies = getattr(self.engine_ref, "_strategies", [])

            if not all_results:
                self._set(
                    "ParameterOptimizer",
                    "Monitoring",
                    "Collecting baseline data…",
                    f"Strategy pool has {len(strategies)} strategies. Waiting for first backtest results.",
                )
                return

            # Live performance data to augment backtest scores
            live_perf = _DB.get_live_performance_by_strategy(limit_per_combo=20)

            # Score each strategy (best score across all assets), penalised by live losses
            with self.engine_ref._eval_lock:
                strat_best_scores: Dict[str, float] = {}
                strat_best_result: Dict[str, Any] = {}
                for res in all_results:
                    sname = res.strategy_name
                    # Penalise backtest score by live loss rate if we have live data
                    live_key = f"{sname}/{res.asset}"
                    live_wr = live_perf.get(live_key, {}).get("win_rate", None)
                    adjusted_score = res.composite_score
                    if live_wr is not None and live_perf[live_key]["total"] >= 3:
                        # Blend: 60% backtest, 40% live
                        adjusted_score = 0.6 * res.composite_score + 0.4 * live_wr
                    if sname not in strat_best_scores or adjusted_score > strat_best_scores[sname]:
                        strat_best_scores[sname] = adjusted_score
                        strat_best_result[sname] = res

                # Separate strategies into "poor" (candidates for improvement) and "keep"
                # A strategy is "poor" if BOTH its backtest score AND live score are low
                poor_candidates = []
                kept = []
                existing_names = {s.name for s in strategies}
                for strat in strategies:
                    score = strat_best_scores.get(strat.name, 1.0)
                    # Only mark as poor if we have enough kept strategies and score is very low
                    if score < 0.12 and len(kept) >= 5:
                        poor_candidates.append(strat)
                    else:
                        kept.append(strat)
                self.engine_ref._strategies = kept

            # Analyse asset performance distribution (blend backtest + live)
            asset_scores: Dict[str, List[float]] = {}
            for r in all_results:
                live_key = f"{r.strategy_name}/{r.asset}"
                live_wr = live_perf.get(live_key, {}).get("win_rate", None)
                score = (0.6 * r.composite_score + 0.4 * live_wr
                         if live_wr is not None and live_perf[live_key]["total"] >= 3
                         else r.composite_score)
                asset_scores.setdefault(r.asset, []).append(score)
            best_assets = sorted(
                asset_scores.items(),
                key=lambda kv: sum(kv[1]) / len(kv[1]),
                reverse=True,
            )[:3]
            best_asset_names = [a for a, _ in best_assets]

            timeframe = getattr(self.config, "timeframe", 60)
            summary_parts = [
                f"Active strategies: {len(kept)}.",
                f"Top assets: {', '.join(best_asset_names)}.",
                f"Timeframe: {timeframe}s.",
            ]

            # ── Priority 1: Improve current best combo if losing LIVE ──────────
            best_combo = getattr(self.engine_ref, "_best_combo", None)
            improve_queue = []

            if best_combo:
                live_key = f"{best_combo.strategy_name}/{best_combo.asset}"
                lp = live_perf.get(live_key, {})
                consec = lp.get("consecutive_losses", 0)
                live_wr = lp.get("win_rate", 1.0)
                live_n  = lp.get("total", 0)

                # Improve the BEST combo if it's clearly losing live
                if consec >= 2 or (live_n >= 5 and live_wr < 0.45):
                    best_strat_obj = next(
                        (s for s in strategies if s.name == best_combo.strategy_name), None
                    )
                    if best_strat_obj:
                        improve_queue.append((best_strat_obj, f"live WR={live_wr:.0%} consec_loss={consec}"))
                        summary_parts.append(
                            f"⚡ Best combo '{best_combo.strategy_name}' is losing live "
                            f"(WR={live_wr:.0%}, {consec} consec) — queued for improvement."
                        )

            # ── Priority 2: Improve low-backtest strategies ────────────────────
            for poor_strat in poor_candidates[:2]:
                if poor_strat not in [t[0] for t in improve_queue]:
                    improve_queue.append((poor_strat, "low backtest score"))

            # Run improvements
            improved = []
            for strat_obj, reason in improve_queue[:3]:  # max 3 per cycle
                v_name = self._improve_strategy(
                    strat_obj, strat_best_result.get(strat_obj.name), existing_names, reason
                )
                if v_name:
                    improved.append(v_name)
                    existing_names.add(v_name)

            if poor_candidates:
                summary_parts.append(
                    f"Low-score strategies queued: {', '.join(p.name for p in poor_candidates[:5])}."
                )
            if improved:
                summary_parts.append(f"Improved versions: {', '.join(improved)}.")

            self._set(
                "ParameterOptimizer",
                "Done",
                f"Optimization: {len(improve_queue)} strategies queued for improvement.",
                " ".join(summary_parts),
            )
        except Exception as e:
            logger.error("ParameterOptimizer error: %s", e)
            self._set("ParameterOptimizer", "Error", "Optimization step failed.", str(e))

    def _improve_strategy(
        self,
        poor_strat: Any,
        best_result: Any,
        existing_names: set,
        reason: str = "",
    ) -> Optional[str]:
        """Ask the AI to generate an improved version of a poorly-performing strategy."""
        if not self.llm:
            return None

        # Compute a versioned name (StratName_v2, _v3, …)
        base_name = poor_strat.name.rstrip("0123456789").rstrip("_v")
        version = 2
        while f"{base_name}_v{version}" in existing_names:
            version += 1
        new_name = f"{base_name}_v{version}"

        wr_str  = f"{best_result.win_rate:.2%}" if best_result else "unknown"
        sc_str  = f"{best_result.composite_score:.3f}" if best_result else "unknown"
        dd_str  = f"{best_result.max_drawdown:.2%}" if best_result else "unknown"
        pf_str  = f"{best_result.profit_factor:.2f}" if best_result else "unknown"

        # Get source code of the original strategy if available
        import inspect
        src = ""
        try:
            src = inspect.getsource(type(poor_strat))
            src = src[:1200]  # cap length
        except Exception:
            pass

        reason_line = f"Reason for improvement: {reason}\n" if reason else ""
        prompt = (
            f"TASK: You are improving a FAILING binary-options strategy. Study its weaknesses carefully.\n"
            f"  Backtest — Win Rate={wr_str}  Score={sc_str}  Max Drawdown={dd_str}  Profit Factor={pf_str}\n"
            f"  {reason_line}\n"
            f"Original source:\n{src if src else '(source unavailable)'}\n\n"
            f"Create a significantly improved version named '{new_name}'.\n"
            f"Focus on: better entry conditions, stronger confirmation signals, adaptive thresholds,\n"
            f"or combining complementary indicators to reduce false signals.\n\n"
            f"RULES:\n"
            f"1. First line: # STRATEGY_NAME: {new_name}\n"
            f"2. Raw Python only — no markdown, no imports, no explanations.\n"
            f"3. Class must inherit BaseStrategy with def __init__(self): super().__init__('{new_name}')\n"
            f"4. Use only these helpers: _rsi, _ema, _sma, _atr, _macd, _bollinger, _stoch, _adx, "
            f"_stddev, _momentum, _williams_r, _cci.\n"
            f"5. candles has columns: open, high, low, close, volume.\n"
            f"6. Return ('call', conf), ('put', conf), or ('neutral', 0.0). conf ∈ [0.50, 0.90].\n"
            f"7. Aim for win rate > 60% by requiring multiple confirming signals before entry."
        )

        try:
            self._set(
                "ParameterOptimizer",
                "Running",
                f"Improving poor strategy '{poor_strat.name}' → '{new_name}'…",
            )
            code = self.llm.chat_completion([
                {"role": "system", "content": (
                    "You are an expert algo-trader. Output ONLY raw Python code. "
                    "No markdown, no ``` fences, no imports, no comments except the # STRATEGY_NAME line."
                )},
                {"role": "user", "content": prompt},
            ])
            if not code or "def generate_signal" not in code:
                return None

            code = code.replace("```python", "").replace("```", "").strip()

            # Extract name from first line comment
            import re as _re
            lines = code.splitlines()
            if lines and lines[0].strip().startswith("# STRATEGY_NAME:"):
                raw = lines[0].split(":", 1)[1].strip()
                safe = _re.sub(r"[^A-Za-z0-9_]", "_", raw).strip("_")
                if safe:
                    new_name = safe
                code = "\n".join(lines[1:]).strip()

            # Ensure correct class name
            if f"class {new_name}" not in code:
                class_match = _re.search(r"class\s+(\w+)\s*\(", code)
                if class_match:
                    code = _re.sub(r"class\s+\w+\s*\(", f"class {new_name}(", code, count=1)
                else:
                    code = (f"class {new_name}(BaseStrategy):\n"
                            f"    def __init__(self): super().__init__('{new_name}')\n"
                            + "\n".join("    " + l if l.strip() else l for l in code.splitlines()))

            # Compile and inject into the engine's strategy pool
            local_env: Dict[str, Any] = {}
            global_env: Dict[str, Any] = {"BaseStrategy": BaseStrategy, "pd": pd, "np": np}
            exec(code, global_env, local_env)

            new_strat = None
            for _cls_name, obj in {**global_env, **local_env}.items():
                if isinstance(obj, type) and issubclass(obj, BaseStrategy) and obj is not BaseStrategy:
                    for _args, _kwargs in [([], {}), ([_cls_name], {}), ([], {"name": _cls_name})]:
                        try:
                            new_strat = obj(*_args, **_kwargs)
                            break
                        except TypeError:
                            continue
                    if new_strat:
                        break

            if new_strat and self.engine_ref:
                with self.engine_ref._eval_lock:
                    self.engine_ref._strategies.append(new_strat)
                logger.info("ParameterOptimizer: injected improved strategy '%s'", new_name)
                return new_name

        except Exception as e:
            logger.warning("_improve_strategy error for %s: %r", poor_strat.name, e)
        return None

    # ── Legacy compatibility ───────────────────────────────────────────────────

    @property
    def agents_state_simple(self) -> Dict[str, str]:
        """Backward-compatible flat status dict."""
        return {name: info["status"] for name, info in self.agents_state.items()}
