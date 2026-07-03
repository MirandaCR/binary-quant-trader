from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Literal, List, Tuple

import pandas as pd
import numpy as np

Signal = Literal["call", "put", "neutral"]


@dataclass
class BacktestResult:
    strategy_name: str
    asset: str
    total_trades: int
    winning_trades: int
    losing_trades: int
    win_rate: float
    profit_factor: float
    max_drawdown: float
    composite_score: float
    signals: List[str] = field(default_factory=list)

    @classmethod
    def empty(cls, strategy_name: str, asset: str) -> "BacktestResult":
        return cls(
            strategy_name=strategy_name,
            asset=asset,
            total_trades=0,
            winning_trades=0,
            losing_trades=0,
            win_rate=0.0,
            profit_factor=0.0,
            max_drawdown=0.0,
            composite_score=0.0,
        )

    def to_dict(self) -> dict:
        return {
            "strategy_name": self.strategy_name,
            "asset": self.asset,
            "total_trades": self.total_trades,
            "winning_trades": self.winning_trades,
            "losing_trades": self.losing_trades,
            "win_rate": round(self.win_rate, 4),
            "profit_factor": round(self.profit_factor, 4),
            "max_drawdown": round(self.max_drawdown, 4),
            "composite_score": round(self.composite_score, 4),
        }


class BaseStrategy(ABC):
    """All strategies must inherit from this class."""

    def __init__(self, name: str):
        self.name = name

    @abstractmethod
    def generate_signal(self, candles: pd.DataFrame) -> Tuple[Signal, float]:
        """
        Analyse the last N closed candles and return (signal, confidence).
        confidence ∈ [0, 1].
        """
        pass

    # ── Shared helpers ────────────────────────────────────────────────────────

    @staticmethod
    def _ema(series: pd.Series, period: int) -> pd.Series:
        return series.ewm(span=period, adjust=False).mean()

    @staticmethod
    def _rsi(close: pd.Series, period: int = 14) -> pd.Series:
        delta = close.diff()
        gain = delta.clip(lower=0).rolling(period).mean()
        loss = (-delta.clip(upper=0)).rolling(period).mean()
        rs = gain / loss.replace(0, np.nan)
        return 100 - 100 / (1 + rs)

    @staticmethod
    def _atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
        tr = pd.concat([
            df["high"] - df["low"],
            abs(df["high"] - df["close"].shift(1)),
            abs(df["low"]  - df["close"].shift(1)),
        ], axis=1).max(axis=1)
        return tr.rolling(period).mean()

    @staticmethod
    def _sma(series: pd.Series, period: int) -> pd.Series:
        return series.rolling(period).mean()

    @staticmethod
    def _macd(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9):
        """Returns (macd_line, signal_line, histogram)."""
        ema_fast = close.ewm(span=fast, adjust=False).mean()
        ema_slow = close.ewm(span=slow, adjust=False).mean()
        macd_line = ema_fast - ema_slow
        signal_line = macd_line.ewm(span=signal, adjust=False).mean()
        histogram = macd_line - signal_line
        return macd_line, signal_line, histogram

    @staticmethod
    def _bollinger(close: pd.Series, period: int = 20, std_dev: float = 2.0):
        """Returns (upper, middle, lower) Bollinger Bands."""
        middle = close.rolling(period).mean()
        std = close.rolling(period).std()
        upper = middle + std_dev * std
        lower = middle - std_dev * std
        return upper, middle, lower

    @staticmethod
    def _stoch(df: pd.DataFrame, k_period: int = 14, d_period: int = 3):
        """Returns (stoch_k, stoch_d) Stochastic Oscillator."""
        lo = df["low"].rolling(k_period).min()
        hi = df["high"].rolling(k_period).max()
        stoch_k = 100 * (df["close"] - lo) / (hi - lo).replace(0, np.nan)
        stoch_d = stoch_k.rolling(d_period).mean()
        return stoch_k, stoch_d

    @staticmethod
    def _adx(df: pd.DataFrame, period: int = 14) -> pd.Series:
        """Simplified ADX (average directional index)."""
        dm_p = (df["high"].diff()).clip(lower=0)
        dm_n = (-df["low"].diff()).clip(lower=0)
        di_p = dm_p.rolling(period).mean()
        di_n = dm_n.rolling(period).mean()
        denom = (di_p + di_n).replace(0, np.nan)
        adx = (abs(di_p - di_n) / denom * 100).rolling(period).mean()
        return adx.fillna(0)

    @staticmethod
    def _stddev(series: pd.Series, period: int = 20) -> pd.Series:
        return series.rolling(period).std()

    @staticmethod
    def _momentum(close: pd.Series, period: int = 10) -> pd.Series:
        return close.diff(period)

    @staticmethod
    def _williams_r(df: pd.DataFrame, period: int = 14) -> pd.Series:
        hi = df["high"].rolling(period).max()
        lo = df["low"].rolling(period).min()
        return -100 * (hi - df["close"]) / (hi - lo).replace(0, np.nan)

    @staticmethod
    def _cci(df: pd.DataFrame, period: int = 20) -> pd.Series:
        tp = (df["high"] + df["low"] + df["close"]) / 3
        mean_tp = tp.rolling(period).mean()
        mad = tp.rolling(period).apply(lambda x: np.abs(x - x.mean()).mean(), raw=True)
        return (tp - mean_tp) / (0.015 * mad.replace(0, np.nan))
