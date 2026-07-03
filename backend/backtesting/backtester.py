"""
Walk-forward backtester.
Runs each strategy on historical candles, skipping the last candle (current open).
Uses a configurable payout to calculate profit/loss.
"""
import logging
from typing import List, Dict, Any

import numpy as np
import pandas as pd

from strategies.base import BaseStrategy, BacktestResult, Signal

logger = logging.getLogger(__name__)

DEFAULT_PAYOUT = 0.80   # 80 % payout on win


def backtest_strategy(
    strategy: BaseStrategy,
    candles: pd.DataFrame,
    asset: str,
    payout: float = DEFAULT_PAYOUT,
    min_confidence: float = 0.55,
    min_candles: int = 50,
    slippage: float = 0.0,
) -> BacktestResult:
    """
    Walk-forward simulation.
    At each bar T we use candles[0..T-1] to generate a signal,
    then check if candles[T] moved in the predicted direction.
    Only trades with confidence ≥ min_confidence are counted.

    Realism notes:
      • Exact ties (next_close == curr_close) are treated as REFUNDS, not losses —
        matching how brokers settle a draw (stake returned). Refunds don't count as
        trades so they don't pollute win rate / profit factor.
      • `slippage` (in absolute price units) models entry latency + spread: moves
        smaller than this band are unreliable, so they're also settled as refunds
        instead of counted as marginal wins. Default 0.0 → only exact ties refund.
    """
    if len(candles) < min_candles + 5:
        return BacktestResult.empty(strategy.name, asset)

    wins    = 0
    losses  = 0
    trades  = 0
    refunds = 0
    gross_profit = 0.0
    gross_loss   = 0.0
    balance      = 100.0
    peak_balance = 100.0
    max_drawdown = 0.0
    signals      = []

    # Walk-forward: start after enough history, stop before last candle
    start = min(min_candles, len(candles) - 10)

    for i in range(start, len(candles) - 1):
        hist = candles.iloc[:i]
        try:
            signal, conf = strategy.generate_signal(hist)
        except Exception as exc:
            logger.debug("[%s] signal error at bar %d: %s", strategy.name, i, exc)
            continue

        if signal == "neutral" or conf < min_confidence:
            signals.append("neutral")
            continue

        # The outcome: did the next candle close higher or lower?
        next_close = candles["close"].iloc[i + 1]
        curr_close = candles["close"].iloc[i]
        move       = next_close - curr_close

        # Refund zone: exact ties (and moves within the slippage band) are settled
        # as a draw — stake returned, no win/loss. Excluded from trade stats so they
        # don't inflate or deflate the win rate.
        if abs(move) <= slippage:
            signals.append("neutral")
            refunds += 1
            continue

        direction  = "call" if move > 0 else "put"
        win        = signal == direction

        signals.append(signal)
        trades += 1
        if win:
            wins         += 1
            profit        = payout
            gross_profit += profit
            balance      += profit
        else:
            losses       += 1
            gross_loss   += 1.0
            balance      -= 1.0

        # Track drawdown
        if balance > peak_balance:
            peak_balance = balance
        dd = (peak_balance - balance) / peak_balance
        if dd > max_drawdown:
            max_drawdown = dd

    if trades == 0:
        return BacktestResult.empty(strategy.name, asset)

    win_rate      = wins / trades
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else gross_profit
    
    total_eval_periods = max(1, len(candles) - 1 - start)
    composite     = _composite_score(win_rate, profit_factor, max_drawdown, trades, total_eval_periods)

    return BacktestResult(
        strategy_name=strategy.name,
        asset=asset,
        total_trades=trades,
        winning_trades=wins,
        losing_trades=losses,
        win_rate=win_rate,
        profit_factor=profit_factor,
        max_drawdown=max_drawdown,
        composite_score=composite,
        signals=signals[-50:],   # keep last 50 for display
    )


def _composite_score(win_rate: float, profit_factor: float,
                     max_drawdown: float, trades: int = 1, total_periods: int = 1) -> float:
    """
    Composite ranking score emphasising win-rate above 50 %,
    penalising drawdown, and favouring higher trade frequency (less hold).
    """
    wr_above = max(0.0, win_rate - 0.50) * 2   # 0→1 when wr goes 50→100%
    pf_score = min(profit_factor / 3.0, 1.0)
    dd_penalty = 1.0 - min(max_drawdown, 1.0)
    
    # Activity score: favors strategies that generate more signals (Buy/Sell) over Hold
    activity_ratio = trades / max(total_periods, 1)
    activity_score = min(activity_ratio / 0.15, 1.0)  # Max score if it trades at least 15% of the time
    
    return round(wr_above * 0.40 + pf_score * 0.25 + dd_penalty * 0.15 + activity_score * 0.20, 4)


def rank_results(results: List[BacktestResult],
                 min_trades: int = 10) -> List[BacktestResult]:
    """Return results sorted best→worst, filtered by min_trades."""
    valid = [r for r in results if r.total_trades >= min_trades]
    return sorted(valid, key=lambda r: r.composite_score, reverse=True)
