"""
Mathematical strategies:
  - FibonacciStrategy       : detect price near golden-ratio retracement levels
  - SupportResistanceStrategy: detect breakouts / bounces from key price levels
"""
import numpy as np
import pandas as pd
from typing import Tuple, List

from .base import BaseStrategy, Signal


FIB_LEVELS = [0.0, 0.236, 0.382, 0.500, 0.618, 0.786, 1.0]


class FibonacciStrategy(BaseStrategy):
    """
    Computes Fibonacci retracement levels over recent swing high/low.
    If current price is near a golden-ratio level (0.382, 0.618) and
    showing reversal, enters in the rebound direction.
    """

    def __init__(self, swing_period: int = 30, proximity_pct: float = 0.0015):
        super().__init__("Fibonacci")
        self.swing_period   = swing_period
        self.proximity_pct  = proximity_pct   # within 0.15% of level

    def generate_signal(self, candles: pd.DataFrame) -> Tuple[Signal, float]:
        if len(candles) < self.swing_period + 5:
            return "neutral", 0.0

        recent = candles.iloc[-self.swing_period:]
        swing_high = recent["high"].max()
        swing_low  = recent["low"].min()
        span       = swing_high - swing_low

        if span < 1e-8:
            return "neutral", 0.0

        price  = candles["close"].iloc[-1]
        prev   = candles["close"].iloc[-2]
        trend  = (candles["close"].iloc[-1] - candles["close"].iloc[-10]) / span

        key_levels = [swing_high - span * r for r in (0.382, 0.500, 0.618)]

        for level in key_levels:
            proximity = abs(price - level) / level
            if proximity < self.proximity_pct:
                conf = round(0.58 + (self.proximity_pct - proximity) / self.proximity_pct * 0.25, 3)
                # Bounce from below → call, from above → put
                if prev < level and price >= level:
                    return "call", min(conf, 0.85)
                if prev > level and price <= level:
                    return "put", min(conf, 0.85)

        # Extension levels breakout
        ext_up   = swing_high + span * 0.618
        ext_down = swing_low  - span * 0.618
        if price > ext_up and prev <= ext_up:
            return "call", 0.60
        if price < ext_down and prev >= ext_down:
            return "put", 0.60

        return "neutral", 0.0


class SupportResistanceStrategy(BaseStrategy):
    """
    Identifies horizontal support/resistance levels as clusters of price
    turning points. Trades breakouts and bounces.
    """

    def __init__(self, lookback: int = 50, cluster_pct: float = 0.002,
                 min_touches: int = 2):
        super().__init__("SupportResistance")
        self.lookback     = lookback
        self.cluster_pct  = cluster_pct
        self.min_touches  = min_touches

    def _find_levels(self, df: pd.DataFrame) -> List[float]:
        """Find price levels touched multiple times (swing points)."""
        highs  = df["high"].values
        lows   = df["low"].values
        closes = df["close"].values

        candidates: List[float] = []
        for i in range(2, len(df) - 2):
            # Local high
            if highs[i] > highs[i-1] and highs[i] > highs[i+1]:
                candidates.append(highs[i])
            # Local low
            if lows[i] < lows[i-1] and lows[i] < lows[i+1]:
                candidates.append(lows[i])

        if not candidates:
            return []

        # Cluster nearby candidates
        candidates.sort()
        clusters: List[float] = []
        for c in candidates:
            merged = False
            for j, cl in enumerate(clusters):
                if abs(c - cl) / cl < self.cluster_pct:
                    clusters[j] = (cl + c) / 2  # merge
                    merged = True
                    break
            if not merged:
                clusters.append(c)

        # Keep only levels touched ≥ min_touches
        strong = []
        for lvl in clusters:
            touches = sum(
                1 for p in candidates
                if abs(p - lvl) / lvl < self.cluster_pct * 2
            )
            if touches >= self.min_touches:
                strong.append(lvl)
        return strong

    def generate_signal(self, candles: pd.DataFrame) -> Tuple[Signal, float]:
        if len(candles) < self.lookback + 5:
            return "neutral", 0.0

        df     = candles.iloc[-self.lookback:]
        levels = self._find_levels(df)
        if not levels:
            return "neutral", 0.0

        price  = candles["close"].iloc[-1]
        prev   = candles["close"].iloc[-2]

        for lvl in levels:
            proximity = abs(price - lvl) / lvl
            if proximity < self.cluster_pct * 3:
                conf = round(0.56 + (1 - proximity / (self.cluster_pct * 3)) * 0.25, 3)
                # Breakout above resistance
                if prev <= lvl < price:
                    return "call", min(conf + 0.05, 0.88)
                # Breakdown below support
                if prev >= lvl > price:
                    return "put", min(conf + 0.05, 0.88)
                # Bounce (price near level, moving away)
                if price > lvl and price - prev > 0:
                    return "call", conf
                if price < lvl and prev - price > 0:
                    return "put", conf

        return "neutral", 0.0
