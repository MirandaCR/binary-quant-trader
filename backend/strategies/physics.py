"""
Physics-inspired strategies:
  - MomentumStrategy  : price velocity + acceleration (kinematic analogy)
  - EntropyStrategy   : Shannon entropy of return distribution
  - HurstStrategy     : Hurst exponent (mean-reverting vs trending market)
"""
import numpy as np
import pandas as pd
from typing import Tuple

from .base import BaseStrategy, Signal


class MomentumStrategy(BaseStrategy):
    """
    Treats price as a particle with velocity = rate of change and
    acceleration = change in velocity. Trades in the direction of
    positive momentum confirmed by increasing acceleration.
    """

    def __init__(self, velocity_period: int = 5, accel_period: int = 3):
        super().__init__("Momentum")
        self.velocity_period = velocity_period
        self.accel_period    = accel_period

    def generate_signal(self, candles: pd.DataFrame) -> Tuple[Signal, float]:
        if len(candles) < self.velocity_period + self.accel_period + 5:
            return "neutral", 0.0

        close = candles["close"]
        # velocity = price change per unit time
        velocity   = close.diff(self.velocity_period) / self.velocity_period
        # acceleration = change in velocity
        accel      = velocity.diff(self.accel_period) / self.accel_period

        v = velocity.iloc[-1]
        a = accel.iloc[-1]
        v_std = velocity.rolling(20).std().iloc[-1]

        if v_std == 0 or np.isnan(v_std):
            return "neutral", 0.0

        v_norm = v / v_std   # normalised velocity

        # Strong upward momentum with positive acceleration
        if v_norm > 0.5 and a > 0:
            conf = min(1.0, abs(v_norm) / 3)
            return "call", round(0.56 + conf * 0.3, 3)
        # Strong downward momentum with negative acceleration
        if v_norm < -0.5 and a < 0:
            conf = min(1.0, abs(v_norm) / 3)
            return "put", round(0.56 + conf * 0.3, 3)
        # Reversal: large velocity but decelerating
        if v_norm > 1.0 and a < -abs(a) * 0.5:
            return "put", 0.55
        if v_norm < -1.0 and a > abs(a) * 0.5:
            return "call", 0.55
        return "neutral", 0.0


class EntropyStrategy(BaseStrategy):
    """
    Computes Shannon entropy of the return distribution over a rolling window.
    Low entropy → concentrated distribution → clearer trend.
    High entropy → random market → stay neutral.
    """

    def __init__(self, window: int = 20, bins: int = 8):
        super().__init__("Entropy")
        self.window = window
        self.bins   = bins

    @staticmethod
    def _shannon_entropy(data: np.ndarray, bins: int) -> float:
        counts, _ = np.histogram(data, bins=bins)
        probs = counts / counts.sum()
        probs = probs[probs > 0]
        return float(-np.sum(probs * np.log2(probs)))

    def generate_signal(self, candles: pd.DataFrame) -> Tuple[Signal, float]:
        if len(candles) < self.window + 5:
            return "neutral", 0.0

        returns = candles["close"].pct_change().dropna().values
        recent  = returns[-self.window:]
        entropy = self._shannon_entropy(recent, self.bins)
        max_entropy = np.log2(self.bins)

        # Normalise [0, 1]
        norm_entropy = entropy / max_entropy

        # Low entropy = directional market
        if norm_entropy < 0.5:
            trend = np.mean(recent[-5:])
            conf  = round(0.55 + (0.5 - norm_entropy) * 0.5, 3)
            if trend > 0:
                return "call", min(conf, 0.85)
            return "put", min(conf, 0.85)
        return "neutral", 0.0


class HurstStrategy(BaseStrategy):
    """
    Hurst exponent classifier:
      H > 0.55 → trending market   → follow the trend
      H < 0.45 → mean-reverting   → counter-trend
      0.45 ≤ H ≤ 0.55 → random walk → neutral
    """

    def __init__(self, min_window: int = 10, max_window: int = 50):
        super().__init__("Hurst")
        self.min_window = min_window
        self.max_window = max_window

    @staticmethod
    def _hurst_exponent(series: np.ndarray) -> float:
        """Rescaled range (R/S) analysis for Hurst exponent."""
        n = len(series)
        if n < 20:
            return 0.5
        lags   = list(range(2, min(20, n // 2)))
        rs_arr = []
        for lag in lags:
            chunks = [series[i:i+lag] for i in range(0, n - lag + 1, lag)]
            rs_per = []
            for chunk in chunks:
                if len(chunk) < 2:
                    continue
                mean  = np.mean(chunk)
                dev   = np.cumsum(chunk - mean)
                r     = np.max(dev) - np.min(dev)
                s     = np.std(chunk, ddof=1)
                if s > 0:
                    rs_per.append(r / s)
            if rs_per:
                rs_arr.append((lag, np.mean(rs_per)))

        if len(rs_arr) < 2:
            return 0.5
        lags_log = np.log([x[0] for x in rs_arr])
        rs_log   = np.log([x[1] for x in rs_arr])
        hurst    = np.polyfit(lags_log, rs_log, 1)[0]
        return float(np.clip(hurst, 0.0, 1.0))

    def generate_signal(self, candles: pd.DataFrame) -> Tuple[Signal, float]:
        if len(candles) < self.max_window + 5:
            return "neutral", 0.0

        prices = candles["close"].values[-self.max_window:]
        returns = np.diff(np.log(prices))
        H = self._hurst_exponent(returns)

        last_ret = float(np.mean(returns[-5:]))

        if H > 0.55:   # trending
            conf = round(0.55 + (H - 0.55) * 1.5, 3)
            if last_ret > 0:
                return "call", min(conf, 0.85)
            return "put", min(conf, 0.85)

        if H < 0.45:   # mean-reverting: go opposite direction
            conf = round(0.55 + (0.45 - H) * 1.5, 3)
            if last_ret > 0:
                return "put", min(conf, 0.85)
            return "call", min(conf, 0.85)

        return "neutral", 0.0
