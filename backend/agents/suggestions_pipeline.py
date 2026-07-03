"""
Suggestions multi-agent pipeline: quantitative + agentic.
Flow: NewsReviewer → DataReviewer → StrategyCreator → StrategyTester → StrategyCleaner.
Agents analyze data, review news, research strategies, test and add/remove strategies for the next run.
"""
import time
import logging
from typing import Any, Dict, List, Optional, Callable

import pandas as pd
import numpy as np

from config.settings import BotConfig
from config.assets import assets_for_timeframe
from agents.llm_providers import create_llm_provider
from strategies.base import BaseStrategy
from backtesting.backtester import backtest_strategy
from fetcher.data_fetcher import fetch_candles

logger = logging.getLogger(__name__)

STEP_MIN_SCORE = 0.15
MIN_STRATEGIES_KEEP = 5


def run_suggestions_pipeline(
    config: BotConfig,
    engine_ref: Any,
    on_step: Optional[Callable[[str, str, str], None]] = None,
) -> Dict[str, Any]:
    """
    Run the full multi-agent pipeline. engine_ref must have: _strategies, _all_results, _eval_lock,
    config, client, news (NewsFetcher). Agents: NewsReviewer, DataReviewer, StrategyCreator, StrategyTester, StrategyCleaner.
    """
    steps: List[Dict[str, Any]] = []
    new_strategies_added: List[str] = []
    pruned: List[str] = []

    def step(agent: str, status: str, message: str):
        steps.append({"agent": agent, "status": status, "message": message})
        if on_step:
            on_step(agent, status, message)
        logger.info("[SuggestionsPipeline][%s] %s: %s", agent, status, message)

    if not config.ai_api_key:
        step("Pipeline", "Error", "No AI API key configured.")
        return {"steps": steps, "new_strategies_added": [], "pruned": [], "error": "No API key"}

    llm = create_llm_provider(config)
    timeframe = getattr(config, "timeframe", 60)
    assets = assets_for_timeframe(timeframe)
    news_context = ""

    # ── 0. News Reviewer Agent ─────────────────────────────────────────────────
    step("NewsReviewer", "Running", "Fetching and summarizing market news…")
    try:
        news_fetcher = getattr(engine_ref, "news", None)
        if news_fetcher and getattr(config, "news_api_key", None):
            news_list = news_fetcher.get_all_news(assets[:8], 5)
            if news_list:
                titles = [n.get("title", "")[:80] for n in news_list[:10]]
                news_context = "Recent headlines: " + " | ".join(titles)
                step("NewsReviewer", "Done", f"Processed {len(news_list)} articles.")
            else:
                step("NewsReviewer", "Skipped", "No news API key or no results.")
        else:
            step("NewsReviewer", "Skipped", "No news fetcher or API key.")
    except Exception as e:
        logger.debug("NewsReviewer: %s", e)
        step("NewsReviewer", "Skipped", "News unavailable.")
    if not news_context:
        news_context = "No news data."

    # ── 1. Data Reviewer Agent ─────────────────────────────────────────────────
    step("DataReviewer", "Running", "Reviewing backtest and market data…")
    try:
        with engine_ref._eval_lock:
            results_summary = []
            for r in (engine_ref._all_results or [])[:30]:
                results_summary.append(
                    f"{r.strategy_name} / {r.asset}: WR={r.win_rate:.2f} PF={r.profit_factor:.2f} score={r.composite_score:.2f} trades={r.total_trades}"
                )
        summary_text = "\n".join(results_summary) if results_summary else "No evaluations yet."
        data_context = f"Timeframe: {timeframe}s. Assets: {', '.join(assets[:15])}.\n{news_context}\nCurrent top evaluations:\n{summary_text}"
        step("DataReviewer", "Done", f"Reviewed {len(results_summary)} combos for {len(assets)} assets.")
    except Exception as e:
        step("DataReviewer", "Error", str(e))
        data_context = f"Assets: {', '.join(assets[:15])}."

    # ── 2. Strategy Creator Agent ──────────────────────────────────────────────
    step("StrategyCreator", "Running", "Researching new strategy from data + news…")
    class_name = f"AIGen_{int(time.time())}"
    prompt = f"""Context (news + backtest data):
{data_context}

Write a Python class named '{class_name}' that inherits from BaseStrategy.
Implement: def generate_signal(self, candles: pd.DataFrame) -> tuple[str, float]:
Return ('call', conf), ('put', conf) or ('neutral', 0.0). conf in [0,1].
Use self._rsi(candles['close'], 14) and/or self._ema(candles['close'], 9). Prefer strategies that generate signals often (not only neutral).
Output ONLY valid Python code, no markdown."""
    try:
        code = llm.chat_completion([
            {"role": "system", "content": "You are a Python algo-trading developer. Output only code."},
            {"role": "user", "content": prompt},
        ])
        if not code or "def generate_signal" not in code:
            step("StrategyCreator", "Error", "LLM did not return valid strategy code.")
            return {"steps": steps, "new_strategies_added": [], "pruned": pruned}
        code = code.replace("```python", "").replace("```", "").strip()
        step("StrategyCreator", "Done", "New strategy code generated.")
    except Exception as e:
        step("StrategyCreator", "Error", str(e))
        return {"steps": steps, "new_strategies_added": [], "pruned": pruned}

    # ── 3. Strategy Tester Agent ───────────────────────────────────────────────
    step("StrategyTester", "Running", "Backtesting new strategy on assets…")
    try:
        local_env = {}
        global_env = {"BaseStrategy": BaseStrategy, "pd": pd, "np": np}
        exec(code, global_env, local_env)
        new_strat = None
        for name, obj in local_env.items():
            if isinstance(obj, type) and issubclass(obj, BaseStrategy) and obj is not BaseStrategy:
                new_strat = obj(name=name)
                break
        if not new_strat:
            step("StrategyTester", "Error", "Could not instantiate strategy class.")
            return {"steps": steps, "new_strategies_added": [], "pruned": pruned}

        backtest_results = []
        for asset in assets[:10]:
            try:
                candles = fetch_candles(engine_ref.client, asset, timeframe, config.backtest_periods + 10)
                if candles.empty or len(candles) < 60:
                    continue
                payout = getattr(engine_ref.client, "get_payout", lambda a: 0.80)(asset)
                if not isinstance(payout, (int, float)):
                    payout = 0.80
                payout = float(payout) / 100.0 if payout > 1 else float(payout)
                res = backtest_strategy(new_strat, candles, asset, payout=payout, min_confidence=0.55)
                if res.total_trades >= 5:
                    backtest_results.append(res)
            except Exception as e:
                logger.debug("Backtest %s %s: %s", new_strat.name, asset, e)
                continue

        if not backtest_results:
            step("StrategyTester", "Skipped", "Not enough candle data or no valid backtests.")
            return {"steps": steps, "new_strategies_added": [], "pruned": pruned}

        best = max(backtest_results, key=lambda r: r.composite_score)
        step("StrategyTester", "Done", f"Best: {best.asset} WR={best.win_rate:.2f} score={best.composite_score:.2f} (n={len(backtest_results)} assets).")

        if best.composite_score >= STEP_MIN_SCORE:
            with engine_ref._eval_lock:
                engine_ref._strategies.append(new_strat)
            new_strategies_added.append(new_strat.name)
            step("StrategyTester", "Deployed", f"Included '{new_strat.name}' for next analysis run.")
        else:
            step("StrategyTester", "Rejected", f"Score {best.composite_score:.2f} below threshold {STEP_MIN_SCORE}.")
    except Exception as e:
        logger.exception("StrategyTester failed")
        step("StrategyTester", "Error", str(e))
        return {"steps": steps, "new_strategies_added": new_strategies_added, "pruned": pruned}

    # ── 4. Strategy Cleaner Agent ─────────────────────────────────────────────
    step("StrategyCleaner", "Running", "Pruning underperforming strategies…")
    try:
        with engine_ref._eval_lock:
            strat_scores = {}
            for r in (engine_ref._all_results or []):
                sname = r.strategy_name
                if sname not in strat_scores or r.composite_score > strat_scores[sname]:
                    strat_scores[sname] = r.composite_score
            to_remove = []
            for s in engine_ref._strategies:
                score = strat_scores.get(s.name, 1.0)
                if score < STEP_MIN_SCORE and (len(engine_ref._strategies) - len(to_remove)) > MIN_STRATEGIES_KEEP:
                    to_remove.append(s)
            for s in to_remove:
                engine_ref._strategies.remove(s)
                pruned.append(s.name)
            if pruned:
                step("StrategyCleaner", "Done", f"Removed {len(pruned)} underperforming: {', '.join(pruned[:5])}{'…' if len(pruned) > 5 else ''}.")
            else:
                step("StrategyCleaner", "Done", "All current strategies above threshold.")
    except Exception as e:
        step("StrategyCleaner", "Error", str(e))

    return {"steps": steps, "new_strategies_added": new_strategies_added, "pruned": pruned}
