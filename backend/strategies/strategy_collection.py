"""
All 21 trading strategies for binary options.
Each strategy implements generate_signal(candles) → (Signal, confidence).
"""
import numpy as np
import pandas as pd
from typing import Tuple

from .base import BaseStrategy, Signal


# ── Helpers ───────────────────────────────────────────────────────────────────

def _ema(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(span=n, adjust=False).mean()

def _rsi(c: pd.Series, n: int = 14) -> pd.Series:
    d = c.diff()
    g = d.clip(lower=0).rolling(n).mean()
    l = (-d.clip(upper=0)).rolling(n).mean()
    return 100 - 100 / (1 + g / l.replace(0, np.nan))

def _atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    tr = pd.concat([
        df["high"] - df["low"],
        abs(df["high"] - df["close"].shift(1)),
        abs(df["low"]  - df["close"].shift(1)),
    ], axis=1).max(axis=1)
    return tr.rolling(n).mean()


# ─────────────────────────────────────────────────────────────────────────────
# 1. Colors Trading Strategy
# ─────────────────────────────────────────────────────────────────────────────
class ColorsStrategy(BaseStrategy):
    """
    Trade reversals after N consecutive same-color candles.
    3 reds → call, 3 greens → put.
    """
    def __init__(self, n: int = 3):
        super().__init__("Colors")
        self.n = n

    def generate_signal(self, candles: pd.DataFrame) -> Tuple[Signal, float]:
        if len(candles) < self.n + 3:
            return "neutral", 0.0
        recent  = candles.tail(self.n)
        bullish = (recent["close"] > recent["open"]).all()
        bearish = (recent["close"] <= recent["open"]).all()
        if bullish:
            return "put",  round(min(0.85, 0.58 + self.n * 0.04), 3)
        if bearish:
            return "call", round(min(0.85, 0.58 + self.n * 0.04), 3)
        return "neutral", 0.0


# ─────────────────────────────────────────────────────────────────────────────
# 2. RSI Law Strategy
# ─────────────────────────────────────────────────────────────────────────────
class RSILawStrategy(BaseStrategy):
    """
    Strict RSI laws: extreme zones (< 20 / > 80) for reversal signals.
    Stronger than standard RSI.
    """
    def __init__(self, period: int = 14, extreme_low: float = 20,
                 extreme_high: float = 80):
        super().__init__("RSI_Law")
        self.period       = period
        self.extreme_low  = extreme_low
        self.extreme_high = extreme_high

    def generate_signal(self, candles: pd.DataFrame) -> Tuple[Signal, float]:
        if len(candles) < self.period + 5:
            return "neutral", 0.0
        rsi  = _rsi(candles["close"], self.period)
        val  = rsi.iloc[-1]
        prev = rsi.iloc[-2]
        if prev <= self.extreme_low and val > self.extreme_low:
            return "call", round(0.60 + (self.extreme_low - min(val, self.extreme_low)) / 20, 3)
        if prev >= self.extreme_high and val < self.extreme_high:
            return "put",  round(0.60 + (max(val, self.extreme_high) - self.extreme_high) / 20, 3)
        if val < self.extreme_low:
            return "call", 0.62
        if val > self.extreme_high:
            return "put",  0.62
        return "neutral", 0.0


# ─────────────────────────────────────────────────────────────────────────────
# 3. EMA + RSI + Engulfing Pattern
# ─────────────────────────────────────────────────────────────────────────────
class EMAEngulfingStrategy(BaseStrategy):
    """
    Three-layer confirmation:
    1. EMA9 > EMA21 (uptrend) or EMA9 < EMA21 (downtrend)
    2. RSI 40–65 zone (not extreme)
    3. Engulfing candle in the trend direction
    """
    def __init__(self):
        super().__init__("EMA_RSI_Engulfing")

    def generate_signal(self, candles: pd.DataFrame) -> Tuple[Signal, float]:
        if len(candles) < 30:
            return "neutral", 0.0
        c    = candles["close"]
        o    = candles["open"]
        e9   = _ema(c, 9)
        e21  = _ema(c, 21)
        rsi  = _rsi(c, 14)
        trend_up   = e9.iloc[-1] > e21.iloc[-1]
        trend_down = e9.iloc[-1] < e21.iloc[-1]
        rsi_val    = rsi.iloc[-1]
        rsi_ok     = 35 <= rsi_val <= 65
        # Bullish engulfing: current green candle engulfs previous red
        prev_red    = o.iloc[-2] > c.iloc[-2]
        curr_green  = c.iloc[-1] > o.iloc[-1]
        engulf_bull = (prev_red and curr_green and
                       c.iloc[-1] > o.iloc[-2] and o.iloc[-1] < c.iloc[-2])
        # Bearish engulfing
        prev_green  = c.iloc[-2] > o.iloc[-2]
        curr_red    = o.iloc[-1] > c.iloc[-1]
        engulf_bear = (prev_green and curr_red and
                       o.iloc[-1] > c.iloc[-2] and c.iloc[-1] < o.iloc[-2])
        if trend_up and rsi_ok and engulf_bull:
            return "call", 0.72
        if trend_down and rsi_ok and engulf_bear:
            return "put",  0.72
        return "neutral", 0.0


# ─────────────────────────────────────────────────────────────────────────────
# 4. Moving Average Crossover Strategy
# ─────────────────────────────────────────────────────────────────────────────
class MACrossoverStrategy(BaseStrategy):
    """
    Triple MA crossover: fast (5) / medium (14) / slow (21).
    All aligned = strong signal.
    """
    def __init__(self):
        super().__init__("MA_Crossover")

    def generate_signal(self, candles: pd.DataFrame) -> Tuple[Signal, float]:
        if len(candles) < 30:
            return "neutral", 0.0
        c   = candles["close"]
        m5  = c.rolling(5).mean()
        m14 = c.rolling(14).mean()
        m21 = c.rolling(21).mean()
        v5, pv5   = m5.iloc[-1],  m5.iloc[-2]
        v14, pv14 = m14.iloc[-1], m14.iloc[-2]
        v21       = m21.iloc[-1]
        # Golden cross: fast crosses above medium
        if pv5 < pv14 and v5 > v14 and v14 > v21:
            return "call", 0.67
        # Death cross: fast crosses below medium
        if pv5 > pv14 and v5 < v14 and v14 < v21:
            return "put",  0.67
        # All aligned bullish/bearish
        if v5 > v14 > v21 and c.iloc[-1] > v5:
            return "call", 0.60
        if v5 < v14 < v21 and c.iloc[-1] < v5:
            return "put",  0.60
        return "neutral", 0.0


# ─────────────────────────────────────────────────────────────────────────────
# 5. Price Action Trading Strategy
# ─────────────────────────────────────────────────────────────────────────────
class PriceActionStrategy(BaseStrategy):
    """
    Pure price action: detects doji, hammer, shooting star, spinning top,
    and morning/evening star patterns.
    """
    def __init__(self):
        super().__init__("PriceAction")

    def generate_signal(self, candles: pd.DataFrame) -> Tuple[Signal, float]:
        if len(candles) < 5:
            return "neutral", 0.0
        df = candles.tail(3).copy()
        c  = df.iloc[-1]
        rng = c["high"] - c["low"]
        if rng == 0:
            return "neutral", 0.0
        body       = abs(c["close"] - c["open"])
        upper_wick = c["high"] - max(c["open"], c["close"])
        lower_wick = min(c["open"], c["close"]) - c["low"]
        body_ratio = body / rng
        # Hammer: small body at top, long lower wick
        if lower_wick > body * 2 and upper_wick < body * 0.5 and body_ratio < 0.4:
            return "call", 0.68
        # Shooting star: small body at bottom, long upper wick
        if upper_wick > body * 2 and lower_wick < body * 0.5 and body_ratio < 0.4:
            return "put",  0.68
        # Doji: very small body → reversal
        if body_ratio < 0.1:
            prev_trend = candles["close"].diff().tail(5).mean()
            return ("put" if prev_trend > 0 else "call"), 0.58
        # Spinning top: small body, balanced wicks
        if body_ratio < 0.25 and upper_wick > body and lower_wick > body:
            prev_trend = candles["close"].diff().tail(3).mean()
            return ("put" if prev_trend > 0 else "call"), 0.57
        return "neutral", 0.0


# ─────────────────────────────────────────────────────────────────────────────
# 6. Support and Resistance Strategy
# ─────────────────────────────────────────────────────────────────────────────
class SupportResistanceStrategy(BaseStrategy):
    """
    Detect horizontal S&R levels (touched ≥ 2 times).
    Trade breakouts and bounces.
    """
    def __init__(self, lookback: int = 50, cluster_pct: float = 0.002):
        super().__init__("Support_Resistance")
        self.lookback    = lookback
        self.cluster_pct = cluster_pct

    def _find_levels(self, df: pd.DataFrame):
        cands = []
        h, l = df["high"].values, df["low"].values
        for i in range(2, len(df) - 2):
            if h[i] > h[i-1] and h[i] > h[i+1]:
                cands.append(h[i])
            if l[i] < l[i-1] and l[i] < l[i+1]:
                cands.append(l[i])
        cands.sort()
        clusters = []
        for c in cands:
            merged = False
            for j, cl in enumerate(clusters):
                if abs(c - cl) / cl < self.cluster_pct:
                    clusters[j] = (cl + c) / 2
                    merged = True
                    break
            if not merged:
                clusters.append(c)
        return [lv for lv in clusters
                if sum(1 for p in cands if abs(p - lv) / lv < self.cluster_pct * 2) >= 2]

    def generate_signal(self, candles: pd.DataFrame) -> Tuple[Signal, float]:
        if len(candles) < self.lookback:
            return "neutral", 0.0
        levels  = self._find_levels(candles.iloc[-self.lookback:])
        price   = candles["close"].iloc[-1]
        prev    = candles["close"].iloc[-2]
        for lv in levels:
            prox = abs(price - lv) / lv
            if prox < self.cluster_pct * 3:
                conf = round(0.60 + (1 - prox / (self.cluster_pct * 3)) * 0.2, 3)
                if prev <= lv < price:
                    return "call", min(conf + 0.05, 0.88)
                if prev >= lv > price:
                    return "put",  min(conf + 0.05, 0.88)
                if price > lv:
                    return "call", conf
                return "put", conf
        return "neutral", 0.0


# ─────────────────────────────────────────────────────────────────────────────
# 7. Fibonacci Retracement and Extension
# ─────────────────────────────────────────────────────────────────────────────
class FibonacciStrategy(BaseStrategy):
    """
    Golden-ratio retracement (0.382, 0.618) and extension (1.618) levels.
    Trades bounces from key Fibonacci prices.
    """
    def __init__(self, swing_period: int = 30, proximity_pct: float = 0.002):
        super().__init__("Fibonacci")
        self.swing_period  = swing_period
        self.proximity_pct = proximity_pct

    def generate_signal(self, candles: pd.DataFrame) -> Tuple[Signal, float]:
        if len(candles) < self.swing_period + 5:
            return "neutral", 0.0
        recent     = candles.iloc[-self.swing_period:]
        swing_high = recent["high"].max()
        swing_low  = recent["low"].min()
        span       = swing_high - swing_low
        if span < 1e-8:
            return "neutral", 0.0
        price      = candles["close"].iloc[-1]
        prev       = candles["close"].iloc[-2]
        key_levels = [swing_high - span * r for r in (0.382, 0.500, 0.618)]
        for lv in key_levels:
            prox = abs(price - lv) / lv
            if prox < self.proximity_pct:
                conf = round(0.60 + (self.proximity_pct - prox) / self.proximity_pct * 0.2, 3)
                if prev < lv <= price:
                    return "call", min(conf, 0.85)
                if prev > lv >= price:
                    return "put",  min(conf, 0.85)
        # Extension breakout
        if price > swing_high + span * 0.618 and prev <= swing_high + span * 0.618:
            return "call", 0.62
        if price < swing_low - span * 0.618 and prev >= swing_low - span * 0.618:
            return "put",  0.62
        return "neutral", 0.0


# ─────────────────────────────────────────────────────────────────────────────
# 8. Momentum Trading Strategy
# ─────────────────────────────────────────────────────────────────────────────
class MomentumStrategy(BaseStrategy):
    """
    Price velocity + acceleration (physics analogy).
    Strong momentum with increasing acceleration = directional trade.
    """
    def __init__(self, period: int = 5):
        super().__init__("Momentum")
        self.period = period

    def generate_signal(self, candles: pd.DataFrame) -> Tuple[Signal, float]:
        if len(candles) < self.period * 3:
            return "neutral", 0.0
        c       = candles["close"]
        vel     = c.diff(self.period)
        accel   = vel.diff(self.period)
        v, a    = vel.iloc[-1], accel.iloc[-1]
        v_std   = vel.rolling(20).std().iloc[-1]
        if v_std == 0 or np.isnan(v_std):
            return "neutral", 0.0
        v_norm = v / v_std
        if v_norm > 0.6 and a > 0:
            return "call", round(min(0.85, 0.58 + abs(v_norm) / 5), 3)
        if v_norm < -0.6 and a < 0:
            return "put",  round(min(0.85, 0.58 + abs(v_norm) / 5), 3)
        return "neutral", 0.0


# ─────────────────────────────────────────────────────────────────────────────
# 9. Pullback Trading Strategy
# ─────────────────────────────────────────────────────────────────────────────
class PullbackStrategy(BaseStrategy):
    """
    Identify main trend via EMA50, wait for a pullback toward EMA,
    then enter in the original trend direction when price resumes.
    """
    def __init__(self):
        super().__init__("Pullback")

    def generate_signal(self, candles: pd.DataFrame) -> Tuple[Signal, float]:
        if len(candles) < 55:
            return "neutral", 0.0
        c   = candles["close"]
        e50 = _ema(c, 50)
        e20 = _ema(c, 20)
        price     = c.iloc[-1]
        ema50_val = e50.iloc[-1]
        ema20_val = e20.iloc[-1]
        # Uptrend: EMA20 > EMA50
        if ema20_val > ema50_val:
            # Pullback: price dipped toward EMA20 and is now bouncing
            recently_below_e20 = (c.iloc[-5:-1] < ema20_val * 1.002).any()
            if recently_below_e20 and price > ema20_val:
                return "call", 0.68
        # Downtrend: EMA20 < EMA50
        if ema20_val < ema50_val:
            recently_above_e20 = (c.iloc[-5:-1] > ema20_val * 0.998).any()
            if recently_above_e20 and price < ema20_val:
                return "put", 0.68
        return "neutral", 0.0


# ─────────────────────────────────────────────────────────────────────────────
# 10. Scalping Strategy
# ─────────────────────────────────────────────────────────────────────────────
class ScalpingStrategy(BaseStrategy):
    """
    High-frequency scalping: RSI + Stochastic + MACD all must agree.
    Very selective, requires strong multi-indicator alignment.
    """
    def __init__(self):
        super().__init__("Scalping")

    def generate_signal(self, candles: pd.DataFrame) -> Tuple[Signal, float]:
        if len(candles) < 35:
            return "neutral", 0.0
        c       = candles["close"]
        rsi     = _rsi(c, 9)
        lo      = candles["low"].rolling(9).min()
        hi      = candles["high"].rolling(9).max()
        denom   = (hi - lo).replace(0, np.nan)
        stoch_k = 100 * (c - lo) / denom
        stoch_d = stoch_k.rolling(3).mean()
        ema_f   = _ema(c, 8)
        ema_s   = _ema(c, 17)
        macd    = ema_f - ema_s
        signal  = _ema(macd, 5)
        hist    = macd - signal
        r_val   = rsi.iloc[-1]
        k_val   = stoch_k.iloc[-1]
        h_val   = hist.iloc[-1]
        h_prev  = hist.iloc[-2]
        # All bullish
        if r_val < 45 and k_val < 50 and h_val > h_prev and h_val > 0:
            return "call", 0.70
        # All bearish
        if r_val > 55 and k_val > 50 and h_val < h_prev and h_val < 0:
            return "put",  0.70
        return "neutral", 0.0


# ─────────────────────────────────────────────────────────────────────────────
# 11. Breakout Trading Strategy
# ─────────────────────────────────────────────────────────────────────────────
class BreakoutStrategy(BaseStrategy):
    """
    Bollinger Bands + volume breakout.
    Price exits bands with volume spike → strong directional signal.
    """
    def __init__(self, period: int = 20, std_dev: float = 2.0):
        super().__init__("Breakout")
        self.period  = period
        self.std_dev = std_dev

    def generate_signal(self, candles: pd.DataFrame) -> Tuple[Signal, float]:
        if len(candles) < self.period + 5:
            return "neutral", 0.0
        c   = candles["close"]
        ma  = c.rolling(self.period).mean()
        std = c.rolling(self.period).std()
        upper = (ma + self.std_dev * std).iloc[-1]
        lower = (ma - self.std_dev * std).iloc[-1]
        price = c.iloc[-1]
        prev  = c.iloc[-2]
        # Volume spike
        vol_ratio = 1.0
        if "volume" in candles.columns:
            vol_ma    = candles["volume"].rolling(self.period).mean().iloc[-1]
            vol_now   = candles["volume"].iloc[-1]
            vol_ratio = vol_now / vol_ma if vol_ma > 0 else 1.0
        conf_boost = min(0.10, (vol_ratio - 1) * 0.05) if vol_ratio > 1.2 else 0
        if prev < upper <= price:
            return "call", round(0.63 + conf_boost, 3)
        if prev > lower >= price:
            return "put",  round(0.63 + conf_boost, 3)
        return "neutral", 0.0


# ─────────────────────────────────────────────────────────────────────────────
# 12. News Trading Strategy
# ─────────────────────────────────────────────────────────────────────────────
class NewsTradingStrategy(BaseStrategy):
    """
    Detects large candle bars that suggest news-driven movement.
    Follows the news impulse direction.
    """
    def __init__(self, atr_multiplier: float = 2.5):
        super().__init__("News")
        self.atr_multiplier = atr_multiplier

    def generate_signal(self, candles: pd.DataFrame) -> Tuple[Signal, float]:
        if len(candles) < 20:
            return "neutral", 0.0
        atr_val = _atr(candles, 14).iloc[-1]
        if atr_val == 0 or np.isnan(atr_val):
            return "neutral", 0.0
        curr        = candles.iloc[-1]
        body        = abs(curr["close"] - curr["open"])
        body_thresh = atr_val * self.atr_multiplier
        if body > body_thresh:
            if curr["close"] > curr["open"]:
                return "call", round(min(0.80, 0.62 + body / body_thresh * 0.05), 3)
            else:
                return "put",  round(min(0.80, 0.62 + body / body_thresh * 0.05), 3)
        return "neutral", 0.0


# ─────────────────────────────────────────────────────────────────────────────
# 13. Swing Trading Strategy
# ─────────────────────────────────────────────────────────────────────────────
class SwingTradingStrategy(BaseStrategy):
    """
    Identify swing highs/lows. Trade reversal at new swing extreme
    confirmed by RSI divergence.
    """
    def __init__(self, swing_period: int = 10):
        super().__init__("Swing")
        self.swing_period = swing_period

    def generate_signal(self, candles: pd.DataFrame) -> Tuple[Signal, float]:
        if len(candles) < self.swing_period * 3:
            return "neutral", 0.0
        c     = candles["close"]
        h     = candles["high"]
        l     = candles["low"]
        price = c.iloc[-1]
        rsi   = _rsi(c, 14)
        # Swing high: price at local high and RSI lower than prev high
        recent_h = h.iloc[-self.swing_period:]
        recent_l = l.iloc[-self.swing_period:]
        is_high  = price >= recent_h.max() * 0.998
        is_low   = price <= recent_l.min() * 1.002
        rsi_val  = rsi.iloc[-1]
        rsi_prev = rsi.iloc[-self.swing_period]
        if is_high and rsi_val < rsi_prev:
            return "put",  0.66
        if is_low and rsi_val > rsi_prev:
            return "call", 0.66
        return "neutral", 0.0


# ─────────────────────────────────────────────────────────────────────────────
# 14. RSI Divergence Strategy
# ─────────────────────────────────────────────────────────────────────────────
class RSIDivergenceStrategy(BaseStrategy):
    """
    Bullish divergence: price makes lower low but RSI makes higher low.
    Bearish divergence: price makes higher high but RSI makes lower high.
    """
    def __init__(self, lookback: int = 20):
        super().__init__("RSI_Divergence")
        self.lookback = lookback

    def generate_signal(self, candles: pd.DataFrame) -> Tuple[Signal, float]:
        if len(candles) < self.lookback + 15:
            return "neutral", 0.0
        c       = candles["close"].iloc[-self.lookback:]
        rsi_ser = _rsi(candles["close"], 14).iloc[-self.lookback:]
        p_low   = c.min()
        p_high  = c.max()
        r_low   = rsi_ser.min()
        r_high  = rsi_ser.max()
        curr_p  = c.iloc[-1]
        curr_r  = rsi_ser.iloc[-1]
        prev_p  = c.iloc[-self.lookback // 2]
        prev_r  = rsi_ser.iloc[-self.lookback // 2]
        # Bullish: price lower but RSI higher
        if curr_p < prev_p * 0.999 and curr_r > prev_r * 1.01:
            return "call", 0.70
        # Bearish: price higher but RSI lower
        if curr_p > prev_p * 1.001 and curr_r < prev_r * 0.99:
            return "put",  0.70
        return "neutral", 0.0


# ─────────────────────────────────────────────────────────────────────────────
# 15. Trend-Following Strategy
# ─────────────────────────────────────────────────────────────────────────────
class TrendFollowingStrategy(BaseStrategy):
    """
    EMA alignment (8 > 21 > 50) + ADX > 25 (strong trend).
    Trades in direction of confirmed trend.
    """
    def __init__(self):
        super().__init__("Trend_Following")

    def generate_signal(self, candles: pd.DataFrame) -> Tuple[Signal, float]:
        if len(candles) < 55:
            return "neutral", 0.0
        c     = candles["close"]
        e8    = _ema(c, 8)
        e21   = _ema(c, 21)
        e50   = _ema(c, 50)
        # Simple ADX proxy: ratio of directional movement
        hi    = candles["high"]
        lo    = candles["low"]
        dm_p  = (hi.diff()).clip(lower=0)
        dm_n  = (-lo.diff()).clip(lower=0)
        di_p  = dm_p.rolling(14).mean()
        di_n  = dm_n.rolling(14).mean()
        denom = (di_p + di_n).replace(0, np.nan)
        adx   = abs(di_p - di_n) / denom * 100
        adx_val = adx.rolling(14).mean().iloc[-1]
        if np.isnan(adx_val):
            adx_val = 0
        if e8.iloc[-1] > e21.iloc[-1] > e50.iloc[-1] and adx_val > 20:
            return "call", round(min(0.80, 0.60 + adx_val / 200), 3)
        if e8.iloc[-1] < e21.iloc[-1] < e50.iloc[-1] and adx_val > 20:
            return "put",  round(min(0.80, 0.60 + adx_val / 200), 3)
        return "neutral", 0.0


# ─────────────────────────────────────────────────────────────────────────────
# 16. Rejection Candle Strategy (Pin Bar)
# ─────────────────────────────────────────────────────────────────────────────
class RejectionCandleStrategy(BaseStrategy):
    """
    Pin bar / rejection candle: long wick relative to body, at key level.
    Bull pin bar (long lower wick) → call.
    Bear pin bar (long upper wick) → put.
    """
    def __init__(self, wick_ratio: float = 2.5):
        super().__init__("Rejection_Candle")
        self.wick_ratio = wick_ratio

    def generate_signal(self, candles: pd.DataFrame) -> Tuple[Signal, float]:
        if len(candles) < 15:
            return "neutral", 0.0
        c = candles.iloc[-1]
        body        = abs(c["close"] - c["open"])
        upper_wick  = c["high"] - max(c["open"], c["close"])
        lower_wick  = min(c["open"], c["close"]) - c["low"]
        atr_val     = _atr(candles, 14).iloc[-1]
        rng         = c["high"] - c["low"]
        if rng < atr_val * 0.5 or body < 1e-8:
            return "neutral", 0.0
        conf_base   = round(min(0.82, 0.60 + rng / atr_val * 0.05), 3)
        # Bull pin: long lower wick, small body near top
        if lower_wick >= body * self.wick_ratio and upper_wick < body:
            return "call", conf_base
        # Bear pin: long upper wick, small body near bottom
        if upper_wick >= body * self.wick_ratio and lower_wick < body:
            return "put",  conf_base
        return "neutral", 0.0


# ─────────────────────────────────────────────────────────────────────────────
# 17. Ladder Pattern (Patrón Escalera)
# ─────────────────────────────────────────────────────────────────────────────
class LadderPatternStrategy(BaseStrategy):
    """
    Staircase pattern: consistently higher highs & higher lows (up ladder)
    or lower lows & lower highs (down ladder) over N candles.
    """
    def __init__(self, n: int = 5):
        super().__init__("Ladder_Pattern")
        self.n = n

    def generate_signal(self, candles: pd.DataFrame) -> Tuple[Signal, float]:
        if len(candles) < self.n + 3:
            return "neutral", 0.0
        recent = candles.tail(self.n)
        highs  = recent["high"].values
        lows   = recent["low"].values
        closes = recent["close"].values
        up_ladder   = all(highs[i] > highs[i-1] and lows[i] > lows[i-1]
                          for i in range(1, len(highs)))
        down_ladder = all(highs[i] < highs[i-1] and lows[i] < lows[i-1]
                          for i in range(1, len(highs)))
        if up_ladder:
            return "call", round(min(0.80, 0.60 + self.n * 0.03), 3)
        if down_ladder:
            return "put",  round(min(0.80, 0.60 + self.n * 0.03), 3)
        return "neutral", 0.0


# ─────────────────────────────────────────────────────────────────────────────
# 18. Retracement Pattern (Patrón de Retroceso)
# ─────────────────────────────────────────────────────────────────────────────
class RetracementPatternStrategy(BaseStrategy):
    """
    Identify a strong impulse move, then wait for price to retrace
    30–60% of that move, then re-enter in the impulse direction.
    """
    def __init__(self, impulse_bars: int = 8, retrace_min: float = 0.30,
                 retrace_max: float = 0.65):
        super().__init__("Retracement")
        self.impulse_bars = impulse_bars
        self.retrace_min  = retrace_min
        self.retrace_max  = retrace_max

    def generate_signal(self, candles: pd.DataFrame) -> Tuple[Signal, float]:
        if len(candles) < self.impulse_bars * 2 + 5:
            return "neutral", 0.0
        c       = candles["close"]
        impulse = c.iloc[-self.impulse_bars * 2 : -self.impulse_bars]
        i_start = impulse.iloc[0]
        i_end   = impulse.iloc[-1]
        i_move  = i_end - i_start
        if abs(i_move) < c.std() * 0.5:
            return "neutral", 0.0
        retrace_price = c.iloc[-1]
        retrace_pct   = (i_end - retrace_price) / i_move if i_move != 0 else 0
        if self.retrace_min <= retrace_pct <= self.retrace_max:
            if i_move > 0:
                return "call", 0.68
            return "put", 0.68
        return "neutral", 0.0


# ─────────────────────────────────────────────────────────────────────────────
# 19. Candle Parity (Paridad de Vela)
# ─────────────────────────────────────────────────────────────────────────────
class CandleParityStrategy(BaseStrategy):
    """
    Alternating candle color parity. After a run of N candles
    with alternating colors (BRBR or RBRB), predicts which comes next.
    Also uses even/odd positioning for the current candle.
    """
    def __init__(self, n: int = 6):
        super().__init__("Candle_Parity")
        self.n = n

    def generate_signal(self, candles: pd.DataFrame) -> Tuple[Signal, float]:
        if len(candles) < self.n + 2:
            return "neutral", 0.0
        recent = candles.tail(self.n)
        colors = [1 if r["close"] > r["open"] else 0
                  for _, r in recent.iterrows()]
        # Check alternating pattern
        alternating = all(colors[i] != colors[i+1] for i in range(len(colors)-1))
        if alternating:
            next_expected = 1 - colors[-1]
            return ("call" if next_expected == 1 else "put"), 0.62
        # Even/odd parity: count green candles in last N
        green_count = sum(colors)
        if green_count <= self.n // 3:       # mostly red → call
            return "call", 0.59
        if green_count >= self.n * 2 // 3:  # mostly green → put
            return "put",  0.59
        return "neutral", 0.0


# ─────────────────────────────────────────────────────────────────────────────
# 20. Operating based on Microstructures
# ─────────────────────────────────────────────────────────────────────────────
class MicrostructureStrategy(BaseStrategy):
    """
    Approximates order flow via OHLC microstructure:
    - Spread: high-low relative to close
    - Body/wick balance (buying vs selling pressure)
    - Volume-weighted directional bias
    """
    def __init__(self, window: int = 10):
        super().__init__("Microstructure")
        self.window = window

    def generate_signal(self, candles: pd.DataFrame) -> Tuple[Signal, float]:
        if len(candles) < self.window + 5:
            return "neutral", 0.0
        df = candles.tail(self.window).copy()
        c  = df["close"]
        # Buying pressure: (close - low) / range
        rng = (df["high"] - df["low"]).replace(0, np.nan)
        buy_pressure  = ((c - df["low"]) / rng).mean()
        sell_pressure = 1.0 - buy_pressure
        # Volume-weighted close direction
        if "volume" in df.columns:
            vol = df["volume"]
            vw_direction = ((c.diff() * vol).sum() /
                            (vol.sum() + 1e-9))
        else:
            vw_direction = c.diff().mean()
        score = (buy_pressure - 0.5) * 2   # -1 to 1
        conf  = round(min(0.82, 0.55 + abs(score) * 0.25), 3)
        if buy_pressure > 0.60 and vw_direction > 0:
            return "call", conf
        if sell_pressure > 0.60 and vw_direction < 0:
            return "put",  conf
        return "neutral", 0.0


# ─────────────────────────────────────────────────────────────────────────────
# 21. Change Points and Continuities
# ─────────────────────────────────────────────────────────────────────────────
class ChangePointStrategy(BaseStrategy):
    """
    Detects structural breaks in price series using rolling statistics.
    Change point → predict reversal.
    Continuity → follow the trend.
    """
    def __init__(self, window: int = 15, sensitivity: float = 2.0):
        super().__init__("Change_Points")
        self.window      = window
        self.sensitivity = sensitivity

    def generate_signal(self, candles: pd.DataFrame) -> Tuple[Signal, float]:
        if len(candles) < self.window * 2 + 5:
            return "neutral", 0.0
        c       = candles["close"]
        # Split series into two halves, compare means
        left    = c.iloc[-self.window * 2 : -self.window]
        right   = c.iloc[-self.window:]
        l_mean, r_mean = left.mean(), right.mean()
        l_std          = left.std()
        z_score        = abs(r_mean - l_mean) / (l_std + 1e-10)
        # Change point: significant mean shift
        if z_score > self.sensitivity:
            if r_mean > l_mean:
                return "call", round(min(0.82, 0.58 + z_score * 0.03), 3)
            return "put",  round(min(0.82, 0.58 + z_score * 0.03), 3)
        # Continuity: stable trend, small variance
        trend     = c.iloc[-self.window:].diff().mean()
        stability = l_std / abs(l_mean) if abs(l_mean) > 0 else 1.0
        if stability < 0.001 and abs(trend) > 0:
            return ("call" if trend > 0 else "put"), 0.60
        return "neutral", 0.0
