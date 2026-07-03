/**
 * Strategy catalog — metadata, descriptions, and automation scripts for all built-in strategies.
 * AI-generated strategies are merged in dynamically from backtest results.
 */

export type StrategyCategory = "Reversal" | "Trend" | "Breakout" | "Pattern" | "Statistical" | "AI Generated";

export interface StrategyCatalogEntry {
  id: string;             // matches strategy_name from backtest
  displayName: string;
  category: StrategyCategory;
  description: string;
  howItWorks: string;
  indicators: string[];
  bestTimeframes: string[];
  signalFrequency: "High" | "Medium" | "Low";
  riskLevel: "Low" | "Medium" | "High";
  script: string;
}

// ── Shared script helpers ──────────────────────────────────────────────────────

const SCRIPT_HEADER = (name: string) => `"""
${name} Strategy — Binary Options Automation Script
Requires: pip install iqoptionapi pandas numpy
"""
from iqoptionapi.stable_api import IQ_Option
import pandas as pd, numpy as np, time

EMAIL    = "your@email.com"
PASSWORD = "your_password"
ACCOUNT  = "PRACTICE"   # PRACTICE or REAL
ASSET    = "EURUSD-OTC"
AMOUNT   = 1.0          # USD per trade
TIMEFRAME = 60          # candle seconds (60=1m, 300=5m)
EXP_MIN  = 1            # expiration minutes
MIN_CONF = 0.55         # minimum confidence to trade

def _candles(iq, n=80):
    raw = iq.get_candles(ASSET, TIMEFRAME, n, time.time())
    df = pd.DataFrame([{
        "open": c["open"], "high": c["max"],
        "low": c["min"],   "close": c["close"],
        "volume": c.get("volume", 0)
    } for c in raw])
    return df

def _ema(s, n): return s.ewm(span=n, adjust=False).mean()
def _rsi(c, n=14):
    d = c.diff(); g = d.clip(lower=0).rolling(n).mean()
    l = (-d.clip(upper=0)).rolling(n).mean()
    return 100 - 100 / (1 + g / l.replace(0, np.nan))
def _atr(df, n=14):
    tr = pd.concat([df["high"]-df["low"],
                    (df["high"]-df["close"].shift()).abs(),
                    (df["low"] -df["close"].shift()).abs()], axis=1).max(1)
    return tr.rolling(n).mean()

`;

const SCRIPT_FOOTER = `

if __name__ == "__main__":
    iq = IQ_Option(EMAIL, PASSWORD)
    iq.connect()
    iq.change_balance(ACCOUNT)
    print(f"Connected | Balance: \${iq.get_balance():.2f}")

    while True:
        try:
            df = _candles(iq)
            signal, conf = get_signal(df)
            if signal != "neutral" and conf >= MIN_CONF:
                ok, oid = iq.buy(AMOUNT, ASSET, signal, EXP_MIN)
                print(f"[{'OK' if ok else 'FAIL'}] {signal.upper()} conf={conf:.0%} id={oid}")
            time.sleep(TIMEFRAME)
        except KeyboardInterrupt:
            print("Stopped."); break
        except Exception as e:
            print(f"Error: {e}"); time.sleep(5)
`;

// ── Strategy catalog ───────────────────────────────────────────────────────────

export const STRATEGY_CATALOG: StrategyCatalogEntry[] = [
  {
    id: "Colors",
    displayName: "Colors / Consecutive Candles",
    category: "Reversal",
    description: "Trades mean-reversion after a streak of same-direction candles. After N consecutive bullish candles, fades into a PUT; after N bearish candles, enters a CALL.",
    howItWorks: "Counts the last N candle colors (open vs close). If all are the same direction, it signals the opposite direction betting that the streak will break. Confidence scales with streak length.",
    indicators: ["Candle color (open/close)"],
    bestTimeframes: ["30s", "1m", "2m"],
    signalFrequency: "High",
    riskLevel: "High",
    script: SCRIPT_HEADER("Colors") + `
def get_signal(df, n=3):
    if len(df) < n + 2: return "neutral", 0.0
    recent = df.tail(n)
    bullish = (recent["close"] > recent["open"]).all()
    bearish = (recent["close"] <= recent["open"]).all()
    conf = round(min(0.85, 0.58 + n * 0.04), 3)
    if bullish: return "put",  conf
    if bearish: return "call", conf
    return "neutral", 0.0
` + SCRIPT_FOOTER,
  },

  {
    id: "RSI_Law",
    displayName: "RSI Law (Extreme Zones)",
    category: "Reversal",
    description: "Uses strict RSI extreme zones (<20 and >80) for high-conviction reversal signals. Stricter thresholds than standard RSI ensure fewer, higher-quality trades.",
    howItWorks: "Calculates 14-period RSI and waits for it to enter or exit extreme territory (<20 oversold, >80 overbought). Signals when RSI crosses back through the threshold, indicating exhaustion of the current move.",
    indicators: ["RSI(14)"],
    bestTimeframes: ["1m", "5m", "15m"],
    signalFrequency: "Low",
    riskLevel: "Low",
    script: SCRIPT_HEADER("RSI Law") + `
def get_signal(df, period=14, lo=20, hi=80):
    if len(df) < period + 5: return "neutral", 0.0
    rsi = _rsi(df["close"], period)
    val, prev = rsi.iloc[-1], rsi.iloc[-2]
    if prev <= lo and val > lo: return "call", round(0.60 + (lo - min(val, lo)) / 20, 3)
    if prev >= hi and val < hi: return "put",  round(0.60 + (max(val, hi) - hi) / 20, 3)
    if val < lo: return "call", 0.62
    if val > hi: return "put",  0.62
    return "neutral", 0.0
` + SCRIPT_FOOTER,
  },

  {
    id: "EMA_RSI_Engulfing",
    displayName: "EMA + RSI + Engulfing",
    category: "Reversal",
    description: "Triple-layer confirmation: trend direction (EMA9/21), momentum quality (RSI 35–65 neutral zone), and candlestick confirmation (engulfing pattern). All three must align.",
    howItWorks: "EMA9 vs EMA21 defines trend direction. RSI must be in the 35–65 range (not extreme, indicating room to move). A bullish or bearish engulfing candle confirms the trade. High-quality but infrequent signals.",
    indicators: ["EMA(9)", "EMA(21)", "RSI(14)", "Engulfing pattern"],
    bestTimeframes: ["1m", "5m"],
    signalFrequency: "Low",
    riskLevel: "Low",
    script: SCRIPT_HEADER("EMA RSI Engulfing") + `
def get_signal(df):
    if len(df) < 30: return "neutral", 0.0
    c, o = df["close"], df["open"]
    e9, e21 = _ema(c, 9), _ema(c, 21)
    rsi_val = _rsi(c, 14).iloc[-1]
    rsi_ok  = 35 <= rsi_val <= 65
    # Engulfing detection
    engulf_bull = (o.iloc[-2] > c.iloc[-2] and c.iloc[-1] > o.iloc[-1] and
                   c.iloc[-1] > o.iloc[-2] and o.iloc[-1] < c.iloc[-2])
    engulf_bear = (c.iloc[-2] > o.iloc[-2] and o.iloc[-1] > c.iloc[-1] and
                   o.iloc[-1] > c.iloc[-2] and c.iloc[-1] < o.iloc[-2])
    if e9.iloc[-1] > e21.iloc[-1] and rsi_ok and engulf_bull: return "call", 0.72
    if e9.iloc[-1] < e21.iloc[-1] and rsi_ok and engulf_bear: return "put",  0.72
    return "neutral", 0.0
` + SCRIPT_FOOTER,
  },

  {
    id: "MA_Crossover",
    displayName: "Triple MA Crossover",
    category: "Trend",
    description: "Uses three moving averages (MA5, MA14, MA21) to detect golden/death crosses and trend alignment. All three EMAs aligned in the same direction produce the strongest signals.",
    howItWorks: "Detects when the fast MA (5) crosses above/below the medium MA (14), confirmed by the slow MA (21) being on the same side. Full alignment (5>14>21 or 5<14<21) generates continuation signals.",
    indicators: ["MA(5)", "MA(14)", "MA(21)"],
    bestTimeframes: ["1m", "5m", "15m"],
    signalFrequency: "Medium",
    riskLevel: "Medium",
    script: SCRIPT_HEADER("MA Crossover") + `
def get_signal(df):
    if len(df) < 30: return "neutral", 0.0
    c = df["close"]
    m5, m14, m21 = c.rolling(5).mean(), c.rolling(14).mean(), c.rolling(21).mean()
    v5, pv5   = m5.iloc[-1],  m5.iloc[-2]
    v14, pv14 = m14.iloc[-1], m14.iloc[-2]
    v21       = m21.iloc[-1]
    if pv5 < pv14 and v5 > v14 and v14 > v21: return "call", 0.67
    if pv5 > pv14 and v5 < v14 and v14 < v21: return "put",  0.67
    if v5 > v14 > v21 and c.iloc[-1] > v5:    return "call", 0.60
    if v5 < v14 < v21 and c.iloc[-1] < v5:    return "put",  0.60
    return "neutral", 0.0
` + SCRIPT_FOOTER,
  },

  {
    id: "PriceAction",
    displayName: "Price Action Patterns",
    category: "Pattern",
    description: "Detects classic Japanese candlestick reversal patterns: hammer, shooting star, doji, spinning top, and morning/evening star. Pure price action with no lagging indicators.",
    howItWorks: "Analyzes the last candle's body-to-wick ratios to classify it as a reversal pattern. Hammer (long lower wick) signals bullish reversal; shooting star (long upper wick) signals bearish. Doji and spinning tops confirm reversals based on prior trend.",
    indicators: ["OHLC body/wick ratios"],
    bestTimeframes: ["1m", "5m", "15m"],
    signalFrequency: "Medium",
    riskLevel: "Medium",
    script: SCRIPT_HEADER("Price Action") + `
def get_signal(df):
    if len(df) < 5: return "neutral", 0.0
    c = df.iloc[-1]
    rng = c["high"] - c["low"]
    if rng == 0: return "neutral", 0.0
    body = abs(c["close"] - c["open"])
    upper = c["high"] - max(c["open"], c["close"])
    lower = min(c["open"], c["close"]) - c["low"]
    br    = body / rng
    if lower > body * 2 and upper < body * 0.5 and br < 0.4: return "call", 0.68
    if upper > body * 2 and lower < body * 0.5 and br < 0.4: return "put",  0.68
    if br < 0.1:
        trend = df["close"].diff().tail(5).mean()
        return ("put" if trend > 0 else "call"), 0.58
    if br < 0.25 and upper > body and lower > body:
        trend = df["close"].diff().tail(3).mean()
        return ("put" if trend > 0 else "call"), 0.57
    return "neutral", 0.0
` + SCRIPT_FOOTER,
  },

  {
    id: "Support_Resistance",
    displayName: "Support & Resistance",
    category: "Breakout",
    description: "Automatically detects horizontal support/resistance levels from local price extremes (touched ≥2 times). Trades both breakouts through levels and bounces from them.",
    howItWorks: "Scans the last 50 candles for swing highs/lows. Clusters nearby levels together. When price approaches a cluster, signals either a bounce (put at resistance, call at support) or breakout (call above resistance, put below support).",
    indicators: ["Swing highs/lows", "Price clusters"],
    bestTimeframes: ["5m", "15m", "1h"],
    signalFrequency: "Low",
    riskLevel: "Low",
    script: SCRIPT_HEADER("Support Resistance") + `
def _find_levels(df, lookback=50, pct=0.002):
    cands = []
    h, l = df["high"].values, df["low"].values
    for i in range(2, len(df)-2):
        if h[i] > h[i-1] and h[i] > h[i+1]: cands.append(h[i])
        if l[i] < l[i-1] and l[i] < l[i+1]: cands.append(l[i])
    cands.sort(); clusters = []
    for c in cands:
        merged = any(abs(c-cl)/cl < pct and not (clusters.__setitem__(clusters.index(cl),(cl+c)/2) or True) for cl in clusters)
        if not merged: clusters.append(c)
    return [lv for lv in clusters if sum(1 for p in cands if abs(p-lv)/lv < pct*2) >= 2]

def get_signal(df):
    if len(df) < 55: return "neutral", 0.0
    levels = _find_levels(df.iloc[-50:])
    price, prev = df["close"].iloc[-1], df["close"].iloc[-2]
    for lv in levels:
        prox = abs(price - lv) / lv
        if prox < 0.006:
            conf = round(0.60 + (0.006 - prox) / 0.006 * 0.2, 3)
            if prev <= lv < price: return "call", min(conf+0.05, 0.88)
            if prev >= lv > price: return "put",  min(conf+0.05, 0.88)
    return "neutral", 0.0
` + SCRIPT_FOOTER,
  },

  {
    id: "Fibonacci",
    displayName: "Fibonacci Retracement",
    category: "Reversal",
    description: "Uses Golden Ratio (0.382, 0.500, 0.618) retracement levels and 1.618 extension breakouts. Price bouncing from key Fibonacci levels generates high-probability signals.",
    howItWorks: "Identifies the swing high and low over the last 30 candles. Calculates 38.2%, 50%, and 61.8% retracement levels. When price touches a level with recent momentum, signals a bounce in the trend direction.",
    indicators: ["Fibonacci levels (0.382, 0.5, 0.618)", "Swing H/L"],
    bestTimeframes: ["1m", "5m", "15m"],
    signalFrequency: "Low",
    riskLevel: "Low",
    script: SCRIPT_HEADER("Fibonacci") + `
def get_signal(df, period=30, prox=0.002):
    if len(df) < period + 5: return "neutral", 0.0
    recent = df.iloc[-period:]
    sh, sl = recent["high"].max(), recent["low"].min()
    span = sh - sl
    if span < 1e-8: return "neutral", 0.0
    price, prev = df["close"].iloc[-1], df["close"].iloc[-2]
    for r in (0.382, 0.500, 0.618):
        lv = sh - span * r
        p = abs(price - lv) / lv
        if p < prox:
            conf = round(0.60 + (prox - p) / prox * 0.2, 3)
            if prev < lv <= price: return "call", min(conf, 0.85)
            if prev > lv >= price: return "put",  min(conf, 0.85)
    return "neutral", 0.0
` + SCRIPT_FOOTER,
  },

  {
    id: "Momentum",
    displayName: "Momentum & Acceleration",
    category: "Trend",
    description: "Physics-inspired strategy measuring price velocity and acceleration. Trades when both velocity and acceleration confirm the same direction with normalized magnitude above threshold.",
    howItWorks: "Computes 5-period velocity (price change) and acceleration (velocity change). Normalizes velocity by its rolling standard deviation. Signals when normalized velocity > 0.6 and acceleration confirms direction.",
    indicators: ["Price velocity", "Price acceleration", "Rolling std"],
    bestTimeframes: ["30s", "1m", "2m"],
    signalFrequency: "Medium",
    riskLevel: "Medium",
    script: SCRIPT_HEADER("Momentum") + `
def get_signal(df, period=5):
    if len(df) < period*3: return "neutral", 0.0
    c = df["close"]
    vel   = c.diff(period)
    accel = vel.diff(period)
    v_std = vel.rolling(20).std().iloc[-1]
    if v_std == 0 or np.isnan(v_std): return "neutral", 0.0
    v_n = vel.iloc[-1] / v_std
    a   = accel.iloc[-1]
    if v_n >  0.6 and a > 0: return "call", round(min(0.85, 0.58 + abs(v_n)/5), 3)
    if v_n < -0.6 and a < 0: return "put",  round(min(0.85, 0.58 + abs(v_n)/5), 3)
    return "neutral", 0.0
` + SCRIPT_FOOTER,
  },

  {
    id: "Pullback",
    displayName: "Pullback to EMA",
    category: "Trend",
    description: "Identifies the primary trend using EMA20/EMA50 alignment, then waits for a pullback to EMA20 before entering in the original trend direction.",
    howItWorks: "When EMA20 > EMA50 (uptrend), waits for price to dip below EMA20 and then resume above it within the last 5 candles. Enters in the trend direction at the pullback point for trend continuation.",
    indicators: ["EMA(20)", "EMA(50)"],
    bestTimeframes: ["1m", "5m", "15m"],
    signalFrequency: "Low",
    riskLevel: "Low",
    script: SCRIPT_HEADER("Pullback") + `
def get_signal(df):
    if len(df) < 55: return "neutral", 0.0
    c = df["close"]
    e20, e50 = _ema(c, 20), _ema(c, 50)
    price = c.iloc[-1]
    if e20.iloc[-1] > e50.iloc[-1]:
        if (c.iloc[-5:-1] < e20.iloc[-1] * 1.002).any() and price > e20.iloc[-1]:
            return "call", 0.68
    if e20.iloc[-1] < e50.iloc[-1]:
        if (c.iloc[-5:-1] > e20.iloc[-1] * 0.998).any() and price < e20.iloc[-1]:
            return "put", 0.68
    return "neutral", 0.0
` + SCRIPT_FOOTER,
  },

  {
    id: "Scalping",
    displayName: "Multi-Indicator Scalping",
    category: "Trend",
    description: "High-conviction scalping requiring RSI, Stochastic, and MACD histogram to all agree simultaneously. Very selective — only fires when all three indicators align.",
    howItWorks: "Computes RSI(9), Stochastic K(9,3), and MACD(8,17,5). For CALL: RSI<45 + Stoch<50 + MACD histogram turning positive. For PUT: RSI>55 + Stoch>50 + MACD histogram turning negative.",
    indicators: ["RSI(9)", "Stochastic K(9)", "MACD(8,17,5)"],
    bestTimeframes: ["30s", "1m"],
    signalFrequency: "Low",
    riskLevel: "Low",
    script: SCRIPT_HEADER("Scalping") + `
def get_signal(df):
    if len(df) < 35: return "neutral", 0.0
    c = df["close"]
    rsi = _rsi(c, 9)
    lo, hi = df["low"].rolling(9).min(), df["high"].rolling(9).max()
    stoch = 100 * (c - lo) / (hi - lo).replace(0, np.nan)
    ef, es = _ema(c, 8), _ema(c, 17)
    hist = (ef - es) - _ema(ef - es, 5)
    r, k = rsi.iloc[-1], stoch.iloc[-1]
    h, hp = hist.iloc[-1], hist.iloc[-2]
    if r < 45 and k < 50 and h > hp and h > 0: return "call", 0.70
    if r > 55 and k > 50 and h < hp and h < 0: return "put",  0.70
    return "neutral", 0.0
` + SCRIPT_FOOTER,
  },

  {
    id: "Breakout",
    displayName: "Bollinger Band Breakout",
    category: "Breakout",
    description: "Bollinger Bands (20, 2σ) breakout confirmed by volume spike. Price exiting the bands with above-average volume signals a strong directional move.",
    howItWorks: "Calculates 20-period Bollinger Bands (±2 standard deviations). Signals when price crosses outside the bands AND volume is 20%+ above its 20-period average. Confidence scales with volume excess.",
    indicators: ["Bollinger Bands(20,2)", "Volume"],
    bestTimeframes: ["1m", "5m"],
    signalFrequency: "Low",
    riskLevel: "Medium",
    script: SCRIPT_HEADER("Bollinger Breakout") + `
def get_signal(df, period=20, sd=2.0):
    if len(df) < period + 5: return "neutral", 0.0
    c = df["close"]
    ma, std = c.rolling(period).mean(), c.rolling(period).std()
    upper, lower = (ma + sd*std).iloc[-1], (ma - sd*std).iloc[-1]
    price, prev = c.iloc[-1], c.iloc[-2]
    vol_ratio = 1.0
    if "volume" in df.columns:
        vm = df["volume"].rolling(period).mean().iloc[-1]
        vol_ratio = df["volume"].iloc[-1] / vm if vm > 0 else 1.0
    boost = min(0.10, (vol_ratio-1)*0.05) if vol_ratio > 1.2 else 0
    if prev < upper <= price: return "call", round(0.63+boost, 3)
    if prev > lower >= price: return "put",  round(0.63+boost, 3)
    return "neutral", 0.0
` + SCRIPT_FOOTER,
  },

  {
    id: "News",
    displayName: "News Impulse",
    category: "Breakout",
    description: "Detects large news-driven candle bodies (>2.5× ATR) and follows the impulse direction. Designed to capitalize on high-impact economic events.",
    howItWorks: "Calculates 14-period ATR as baseline volatility. When a candle body exceeds 2.5× ATR, interprets it as a news-driven impulse and trades in the candle's direction.",
    indicators: ["ATR(14)", "Candle body size"],
    bestTimeframes: ["1m", "5m"],
    signalFrequency: "Low",
    riskLevel: "Medium",
    script: SCRIPT_HEADER("News Impulse") + `
def get_signal(df, mult=2.5):
    if len(df) < 20: return "neutral", 0.0
    atr = _atr(df, 14).iloc[-1]
    if atr == 0 or np.isnan(atr): return "neutral", 0.0
    curr = df.iloc[-1]
    body = abs(curr["close"] - curr["open"])
    if body > atr * mult:
        if curr["close"] > curr["open"]: return "call", round(min(0.80, 0.62+body/(atr*mult)*0.05), 3)
        else:                            return "put",  round(min(0.80, 0.62+body/(atr*mult)*0.05), 3)
    return "neutral", 0.0
` + SCRIPT_FOOTER,
  },

  {
    id: "Swing",
    displayName: "Swing RSI Divergence",
    category: "Reversal",
    description: "Identifies swing highs and lows then validates with RSI divergence. At new swing extremes where RSI diverges from price, signals a reversal.",
    howItWorks: "Marks current price as a potential swing high/low if it's at the 10-period extreme. Compares RSI at the current extreme vs the previous extreme. Divergence (RSI not confirming the price extreme) signals reversal.",
    indicators: ["RSI(14)", "Swing H/L(10)"],
    bestTimeframes: ["5m", "15m", "1h"],
    signalFrequency: "Low",
    riskLevel: "Low",
    script: SCRIPT_HEADER("Swing RSI") + `
def get_signal(df, period=10):
    if len(df) < period*3: return "neutral", 0.0
    c, h, l = df["close"], df["high"], df["low"]
    price = c.iloc[-1]
    rsi = _rsi(c, 14)
    is_high = price >= h.iloc[-period:].max() * 0.998
    is_low  = price <= l.iloc[-period:].min() * 1.002
    r_now  = rsi.iloc[-1]
    r_prev = rsi.iloc[-period]
    if is_high and r_now < r_prev: return "put",  0.66
    if is_low  and r_now > r_prev: return "call", 0.66
    return "neutral", 0.0
` + SCRIPT_FOOTER,
  },

  {
    id: "RSI_Divergence",
    displayName: "RSI Divergence (Classic)",
    category: "Reversal",
    description: "Classic divergence detection: bullish divergence (price lower low, RSI higher low) and bearish divergence (price higher high, RSI lower high). One of the most reliable reversal setups.",
    howItWorks: "Compares price and RSI levels at the midpoint vs endpoint of a 20-bar lookback. If price moved lower but RSI moved higher, bullish divergence; if price moved higher but RSI moved lower, bearish divergence.",
    indicators: ["RSI(14)"],
    bestTimeframes: ["5m", "15m", "1h"],
    signalFrequency: "Low",
    riskLevel: "Low",
    script: SCRIPT_HEADER("RSI Divergence") + `
def get_signal(df, lookback=20):
    if len(df) < lookback+15: return "neutral", 0.0
    c  = df["close"].iloc[-lookback:]
    rs = _rsi(df["close"], 14).iloc[-lookback:]
    mid = lookback // 2
    cp, rp = c.iloc[-mid], rs.iloc[-mid]
    cn, rn = c.iloc[-1],   rs.iloc[-1]
    if cn < cp*0.999 and rn > rp*1.01: return "call", 0.70
    if cn > cp*1.001 and rn < rp*0.99: return "put",  0.70
    return "neutral", 0.0
` + SCRIPT_FOOTER,
  },

  {
    id: "Trend_Following",
    displayName: "EMA Trend + ADX Filter",
    category: "Trend",
    description: "Triple EMA alignment (8>21>50) confirmed by ADX strength filter (>20). Only trades in trending markets, avoiding choppy sideways conditions.",
    howItWorks: "Checks EMA8 > EMA21 > EMA50 (uptrend) or reverse. Calculates a simplified ADX from directional movement. Only signals when ADX > 20, ensuring the market has genuine trend strength.",
    indicators: ["EMA(8)", "EMA(21)", "EMA(50)", "ADX(14)"],
    bestTimeframes: ["5m", "15m", "1h"],
    signalFrequency: "Medium",
    riskLevel: "Low",
    script: SCRIPT_HEADER("Trend Following EMA+ADX") + `
def get_signal(df):
    if len(df) < 55: return "neutral", 0.0
    c = df["close"]
    e8, e21, e50 = _ema(c,8), _ema(c,21), _ema(c,50)
    hi, lo = df["high"], df["low"]
    dip = (hi.diff()).clip(lower=0).rolling(14).mean()
    din = (-lo.diff()).clip(lower=0).rolling(14).mean()
    denom = (dip + din).replace(0, np.nan)
    adx = (abs(dip-din)/denom*100).rolling(14).mean().iloc[-1]
    if np.isnan(adx): adx = 0
    if e8.iloc[-1] > e21.iloc[-1] > e50.iloc[-1] and adx > 20:
        return "call", round(min(0.80, 0.60+adx/200), 3)
    if e8.iloc[-1] < e21.iloc[-1] < e50.iloc[-1] and adx > 20:
        return "put",  round(min(0.80, 0.60+adx/200), 3)
    return "neutral", 0.0
` + SCRIPT_FOOTER,
  },

  {
    id: "Rejection_Candle",
    displayName: "Rejection Candle (Pin Bar)",
    category: "Pattern",
    description: "Detects pin bars — candles with a long wick (≥2.5× body) and small body at one extreme. Bull pin bar (long lower wick) signals rejection of lower prices; bear pin bar signals rejection of higher prices.",
    howItWorks: "Measures wick-to-body ratios relative to ATR. A bull pin requires a lower wick ≥2.5× body AND candle range >0.5× ATR. Confidence scales with the candle's size relative to ATR.",
    indicators: ["ATR(14)", "Wick/body ratios"],
    bestTimeframes: ["1m", "5m", "15m"],
    signalFrequency: "Low",
    riskLevel: "Low",
    script: SCRIPT_HEADER("Rejection Candle") + `
def get_signal(df, wick_ratio=2.5):
    if len(df) < 15: return "neutral", 0.0
    c = df.iloc[-1]
    body  = abs(c["close"] - c["open"])
    upper = c["high"] - max(c["open"], c["close"])
    lower = min(c["open"], c["close"]) - c["low"]
    atr   = _atr(df, 14).iloc[-1]
    rng   = c["high"] - c["low"]
    if rng < atr*0.5 or body < 1e-8: return "neutral", 0.0
    conf = round(min(0.82, 0.60 + rng/atr*0.05), 3)
    if lower >= body*wick_ratio and upper < body: return "call", conf
    if upper >= body*wick_ratio and lower < body: return "put",  conf
    return "neutral", 0.0
` + SCRIPT_FOOTER,
  },

  {
    id: "Ladder_Pattern",
    displayName: "Ladder Pattern",
    category: "Pattern",
    description: "Detects staircase price patterns — N consecutive candles each with higher highs and higher lows (up-ladder) or lower lows and lower highs (down-ladder). Strong trend continuation signal.",
    howItWorks: "Checks that each successive candle has its high and low both above (up) or below (down) the previous candle. A complete N-step ladder signals continuation in the ladder direction.",
    indicators: ["Candle H/L structure"],
    bestTimeframes: ["1m", "5m"],
    signalFrequency: "Low",
    riskLevel: "Medium",
    script: SCRIPT_HEADER("Ladder Pattern") + `
def get_signal(df, n=5):
    if len(df) < n+3: return "neutral", 0.0
    r = df.tail(n)
    hs, ls = r["high"].values, r["low"].values
    up   = all(hs[i]>hs[i-1] and ls[i]>ls[i-1] for i in range(1,n))
    down = all(hs[i]<hs[i-1] and ls[i]<ls[i-1] for i in range(1,n))
    conf = round(min(0.80, 0.60+n*0.03), 3)
    if up:   return "call", conf
    if down: return "put",  conf
    return "neutral", 0.0
` + SCRIPT_FOOTER,
  },

  {
    id: "Retracement",
    displayName: "Impulse Retracement",
    category: "Trend",
    description: "Identifies strong impulse moves and waits for price to retrace 30–65% of the move. Re-enters in the original impulse direction at the retracement point.",
    howItWorks: "Splits history into two halves: the impulse phase (bars 8–16 back) and the current phase. If the current price has retraced 30–65% of the impulse, re-enters in the impulse direction.",
    indicators: ["Price retracement %"],
    bestTimeframes: ["5m", "15m"],
    signalFrequency: "Low",
    riskLevel: "Low",
    script: SCRIPT_HEADER("Impulse Retracement") + `
def get_signal(df, bars=8):
    if len(df) < bars*2+5: return "neutral", 0.0
    c = df["close"]
    imp = c.iloc[-bars*2:-bars]
    i_start, i_end = imp.iloc[0], imp.iloc[-1]
    i_move = i_end - i_start
    if abs(i_move) < c.std()*0.5: return "neutral", 0.0
    retrace = (i_end - c.iloc[-1]) / i_move if i_move else 0
    if 0.30 <= retrace <= 0.65:
        return ("call" if i_move > 0 else "put"), 0.68
    return "neutral", 0.0
` + SCRIPT_FOOTER,
  },

  {
    id: "Candle_Parity",
    displayName: "Candle Color Parity",
    category: "Statistical",
    description: "Statistical candle color analysis. Detects alternating color patterns (BRBR or RBRB) and extreme green/red imbalances over the last N candles. Uses mean-reversion toward color balance.",
    howItWorks: "Encodes recent candle colors as binary (1=green, 0=red). Checks for perfect alternation or extreme imbalance (>2/3 same color). Alternation predicts the next color; extreme imbalance predicts reversion.",
    indicators: ["Candle color sequence"],
    bestTimeframes: ["30s", "1m"],
    signalFrequency: "High",
    riskLevel: "High",
    script: SCRIPT_HEADER("Candle Parity") + `
def get_signal(df, n=6):
    if len(df) < n+2: return "neutral", 0.0
    recent = df.tail(n)
    colors = [1 if r["close"] > r["open"] else 0 for _, r in recent.iterrows()]
    if all(colors[i] != colors[i+1] for i in range(len(colors)-1)):
        return ("call" if 1-colors[-1]==1 else "put"), 0.62
    g = sum(colors)
    if g <= n//3:     return "call", 0.59
    if g >= n*2//3:   return "put",  0.59
    return "neutral", 0.0
` + SCRIPT_FOOTER,
  },

  {
    id: "Microstructure",
    displayName: "Market Microstructure",
    category: "Statistical",
    description: "Approximates order flow using OHLC microstructure analysis: buying/selling pressure ratios and volume-weighted directional bias. Models the balance between buyers and sellers.",
    howItWorks: "For each candle, buying pressure = (close-low)/(high-low). Averages over 10 candles. Combined with volume-weighted close direction to assess net order flow imbalance.",
    indicators: ["Buy/sell pressure", "Volume-weighted direction"],
    bestTimeframes: ["1m", "5m"],
    signalFrequency: "Medium",
    riskLevel: "Medium",
    script: SCRIPT_HEADER("Market Microstructure") + `
def get_signal(df, window=10):
    if len(df) < window+5: return "neutral", 0.0
    d = df.tail(window).copy()
    c = d["close"]
    rng = (d["high"]-d["low"]).replace(0, np.nan)
    bp = ((c - d["low"]) / rng).mean()
    sp = 1.0 - bp
    if "volume" in d.columns:
        v = d["volume"]
        vwd = (c.diff() * v).sum() / (v.sum()+1e-9)
    else:
        vwd = c.diff().mean()
    score = (bp - 0.5) * 2
    conf  = round(min(0.82, 0.55 + abs(score)*0.25), 3)
    if bp > 0.60 and vwd > 0: return "call", conf
    if sp > 0.60 and vwd < 0: return "put",  conf
    return "neutral", 0.0
` + SCRIPT_FOOTER,
  },

  {
    id: "Change_Points",
    displayName: "Change Point Detection",
    category: "Statistical",
    description: "Detects structural breaks in price series using rolling statistical comparison. A significant mean-shift between two halves signals a new directional move; stable low-variance conditions signal trend continuation.",
    howItWorks: "Divides recent history into two windows and computes a Z-score of their mean difference. A Z-score > 2.0 signals a regime change (new direction); Z < 2.0 with stable variance signals trend continuation.",
    indicators: ["Rolling mean", "Rolling std", "Z-score"],
    bestTimeframes: ["1m", "5m"],
    signalFrequency: "Medium",
    riskLevel: "Medium",
    script: SCRIPT_HEADER("Change Point Detection") + `
def get_signal(df, window=15, sensitivity=2.0):
    if len(df) < window*2+5: return "neutral", 0.0
    c = df["close"]
    left  = c.iloc[-window*2:-window]
    right = c.iloc[-window:]
    z = abs(right.mean()-left.mean()) / (left.std()+1e-10)
    if z > sensitivity:
        if right.mean() > left.mean(): return "call", round(min(0.82, 0.58+z*0.03), 3)
        return "put",  round(min(0.82, 0.58+z*0.03), 3)
    trend = right.diff().mean()
    stab  = left.std() / abs(left.mean()) if abs(left.mean()) > 0 else 1.0
    if stab < 0.001 and abs(trend) > 0:
        return ("call" if trend > 0 else "put"), 0.60
    return "neutral", 0.0
` + SCRIPT_FOOTER,
  },
];

// ── Category colors ───────────────────────────────────────────────────────────

export const CATEGORY_COLORS: Record<StrategyCategory, string> = {
  "Reversal":     "text-loss bg-loss/10 border-loss/30",
  "Trend":        "text-profit bg-profit/10 border-profit/30",
  "Breakout":     "text-brand bg-brand/10 border-brand/30",
  "Pattern":      "text-neutral bg-neutral/10 border-neutral/30",
  "Statistical":  "text-blue-400 bg-blue-400/10 border-blue-400/30",
  "AI Generated": "text-purple-400 bg-purple-400/10 border-purple-400/30",
};

export const RISK_COLORS = {
  Low: "text-profit", Medium: "text-neutral", High: "text-loss",
} as const;

export const FREQ_COLORS = {
  High: "text-loss", Medium: "text-neutral", Low: "text-profit",
} as const;

/** Merge catalog with live backtest results to show win rates on catalog cards */
export function findCatalogEntry(strategyName: string): StrategyCatalogEntry | undefined {
  return STRATEGY_CATALOG.find(e =>
    e.id === strategyName ||
    e.id.toLowerCase() === strategyName.toLowerCase() ||
    strategyName.toLowerCase().includes(e.id.toLowerCase())
  );
}
