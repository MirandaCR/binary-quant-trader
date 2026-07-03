"""Statistical strategies: RSI, Bollinger Bands, MACD, Stochastic."""
import numpy as np
import pandas as pd
from typing import Tuple

from .base import BaseStrategy, Signal


class RSIStrategy(BaseStrategy):
    def __init__(self, period: int = 14, overbought: float = 70,
                 oversold: float = 30):
        super().__init__("RSI")
        self.period = period
        self.overbought = overbought
        self.oversold = oversold

    def generate_signal(self, candles: pd.DataFrame) -> Tuple[Signal, float]:
        if len(candles) < self.period + 5:
            return "neutral", 0.0
        rsi = self._rsi(candles["close"], self.period)
        val = rsi.iloc[-1]
        prev = rsi.iloc[-2]

        if val < self.oversold and prev >= self.oversold:
            conf = min(1.0, (self.oversold - val) / self.oversold)
            return "call", round(0.55 + conf * 0.3, 3)
        if val > self.overbought and prev <= self.overbought:
            conf = min(1.0, (val - self.overbought) / (100 - self.overbought))
            return "put", round(0.55 + conf * 0.3, 3)
        # Trend continuation when RSI crosses 50
        if prev < 50 < val:
            return "call", 0.58
        if prev > 50 > val:
            return "put", 0.58
        return "neutral", 0.0


class BollingerBandsStrategy(BaseStrategy):
    def __init__(self, period: int = 20, std_dev: float = 2.0):
        super().__init__("BollingerBands")
        self.period = period
        self.std_dev = std_dev

    def generate_signal(self, candles: pd.DataFrame) -> Tuple[Signal, float]:
        if len(candles) < self.period + 5:
            return "neutral", 0.0
        close = candles["close"]
        ma = close.rolling(self.period).mean()
        std = close.rolling(self.period).std()
        upper = ma + self.std_dev * std
        lower = ma - self.std_dev * std

        price = close.iloc[-1]
        prev  = close.iloc[-2]
        up    = upper.iloc[-1]
        lo    = lower.iloc[-1]
        mid   = ma.iloc[-1]

        bandwidth = (up - lo) / mid if mid != 0 else 0

        if prev <= lo.iloc[-1] if hasattr(lo, "iloc") else lo and price > lo:
            conf = min(1.0, abs(price - lo) / (up - lo + 1e-9))
            return "call", round(0.57 + conf * 0.25, 3)
        if prev >= up and price < up:
            conf = min(1.0, abs(up - price) / (up - lo + 1e-9))
            return "put", round(0.57 + conf * 0.25, 3)
        # Squeeze breakout
        if bandwidth < 0.01:
            if price > mid:
                return "call", 0.56
            return "put", 0.56
        return "neutral", 0.0


class MACDStrategy(BaseStrategy):
    def __init__(self, fast: int = 12, slow: int = 26, signal: int = 9):
        super().__init__("MACD")
        self.fast = fast
        self.slow = slow
        self.signal_period = signal

    def generate_signal(self, candles: pd.DataFrame) -> Tuple[Signal, float]:
        if len(candles) < self.slow + self.signal_period + 5:
            return "neutral", 0.0
        close = candles["close"]
        ema_fast = self._ema(close, self.fast)
        ema_slow = self._ema(close, self.slow)
        macd_line = ema_fast - ema_slow
        signal_line = self._ema(macd_line, self.signal_period)
        histogram = macd_line - signal_line

        h_now  = histogram.iloc[-1]
        h_prev = histogram.iloc[-2]
        m_now  = macd_line.iloc[-1]

        # Histogram zero-cross
        if h_prev < 0 < h_now:
            conf = min(1.0, abs(h_now) / (abs(candles["close"].std()) + 1e-9) * 10)
            return "call", round(0.56 + min(conf, 0.3), 3)
        if h_prev > 0 > h_now:
            conf = min(1.0, abs(h_now) / (abs(candles["close"].std()) + 1e-9) * 10)
            return "put", round(0.56 + min(conf, 0.3), 3)
        # MACD above/below zero line with momentum
        if m_now > 0 and h_now > h_prev:
            return "call", 0.54
        if m_now < 0 and h_now < h_prev:
            return "put", 0.54
        return "neutral", 0.0


class StochasticStrategy(BaseStrategy):
    def __init__(self, k_period: int = 14, d_period: int = 3,
                 overbought: float = 80, oversold: float = 20):
        super().__init__("Stochastic")
        self.k_period = k_period
        self.d_period = d_period
        self.overbought = overbought
        self.oversold = oversold

    def generate_signal(self, candles: pd.DataFrame) -> Tuple[Signal, float]:
        if len(candles) < self.k_period + self.d_period + 5:
            return "neutral", 0.0
        low_min  = candles["low"].rolling(self.k_period).min()
        high_max = candles["high"].rolling(self.k_period).max()
        denom    = (high_max - low_min).replace(0, np.nan)
        k = 100 * (candles["close"] - low_min) / denom
        d = k.rolling(self.d_period).mean()

        k_now  = k.iloc[-1]
        k_prev = k.iloc[-2]
        d_now  = d.iloc[-1]

        # Bullish cross in oversold zone
        if k_prev < d.iloc[-2] and k_now > d_now and k_now < self.oversold + 10:
            conf = min(1.0, (self.oversold - k_now + 10) / 30)
            return "call", round(0.58 + max(conf, 0) * 0.25, 3)
        # Bearish cross in overbought zone
        if k_prev > d.iloc[-2] and k_now < d_now and k_now > self.overbought - 10:
            conf = min(1.0, (k_now - (self.overbought - 10)) / 30)
            return "put", round(0.58 + max(conf, 0) * 0.25, 3)
        return "neutral", 0.0
