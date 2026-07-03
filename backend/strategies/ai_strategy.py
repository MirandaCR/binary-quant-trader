"""
AI strategies: Random Forest and Gradient Boosting classifiers.
Models are trained on each asset's recent candles and retrained periodically.
"""
import logging
from typing import Tuple, Optional

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import cross_val_score

from .base import BaseStrategy, Signal

logger = logging.getLogger(__name__)


def _build_features(df: pd.DataFrame) -> pd.DataFrame:
    """Engineer features from OHLCV data."""
    c = df["close"]
    feat = pd.DataFrame(index=df.index)

    # Price-based returns at multiple lags
    for lag in (1, 2, 3, 5):
        feat[f"ret_{lag}"] = c.pct_change(lag)

    # Candlestick body / range ratios
    rng = (df["high"] - df["low"]).replace(0, np.nan)
    feat["body_ratio"]   = abs(df["close"] - df["open"]) / rng
    feat["upper_shadow"] = (df["high"] - df[["open", "close"]].max(axis=1)) / rng
    feat["lower_shadow"] = (df[["open", "close"]].min(axis=1) - df["low"]) / rng

    # Simple moving averages
    for w in (5, 10, 20):
        feat[f"ma{w}_dist"] = (c - c.rolling(w).mean()) / c

    # Volatility
    feat["vol_5"]  = c.pct_change().rolling(5).std()
    feat["vol_20"] = c.pct_change().rolling(20).std()

    # RSI
    delta = c.diff()
    gain = delta.clip(lower=0).rolling(14).mean()
    loss = (-delta.clip(upper=0)).rolling(14).mean()
    rs   = gain / loss.replace(0, np.nan)
    feat["rsi"] = 100 - 100 / (1 + rs)

    # Volume ratio
    if "volume" in df.columns:
        vol_ma = df["volume"].rolling(10).mean().replace(0, np.nan)
        feat["vol_ratio"] = df["volume"] / vol_ma

    # Trend direction (EMA cross)
    ema5  = c.ewm(span=5,  adjust=False).mean()
    ema20 = c.ewm(span=20, adjust=False).mean()
    feat["ema_cross"] = (ema5 - ema20) / c

    return feat


def _prepare_dataset(df: pd.DataFrame, lookahead: int = 1):
    features = _build_features(df)
    # Target: 1 if next close is higher (call), 0 otherwise (put)
    future_ret = df["close"].shift(-lookahead) / df["close"] - 1
    target = (future_ret > 0).astype(int)

    combined = pd.concat([features, target.rename("target")], axis=1).dropna()
    X = combined.drop("target", axis=1).values
    y = combined["target"].values
    return X, y


class _MLStrategy(BaseStrategy):
    def __init__(self, name: str, model_cls, **model_kwargs):
        super().__init__(name)
        self._model_cls  = model_cls
        self._model_kwargs = model_kwargs
        self._model: Optional[object]  = None
        self._scaler: Optional[StandardScaler] = None
        self._trained = False
        self._min_samples = 60

    def _train(self, df: pd.DataFrame) -> None:
        X, y = _prepare_dataset(df)
        if len(X) < self._min_samples:
            return
        # Keep only the last 300 samples to stay fast
        if len(X) > 300:
            X, y = X[-300:], y[-300:]
        self._scaler = StandardScaler()
        X_scaled = self._scaler.fit_transform(X)
        self._model = self._model_cls(**self._model_kwargs)
        self._model.fit(X_scaled, y)
        self._trained = True
        logger.debug("[%s] model trained on %d samples", self.name, len(X))

    def generate_signal(self, candles: pd.DataFrame) -> Tuple[Signal, float]:
        if len(candles) < self._min_samples:
            return "neutral", 0.0

        # Retrain if not trained or on every call (online learning with small cost)
        if not self._trained:
            self._train(candles)

        if not self._trained or self._model is None:
            return "neutral", 0.0

        feat = _build_features(candles.iloc[:-1])  # exclude current open candle
        row  = feat.iloc[[-1]].dropna(axis=1)
        if row.empty or row.shape[1] == 0:
            return "neutral", 0.0

        # Align columns
        try:
            all_feat = _build_features(candles).dropna(axis=1)
            row = all_feat.iloc[[-1]]
            X_scaled = self._scaler.transform(row.values)
            proba = self._model.predict_proba(X_scaled)[0]
        except Exception as exc:
            logger.debug("[%s] predict error: %s", self.name, exc)
            return "neutral", 0.0

        call_prob = float(proba[1]) if len(proba) > 1 else 0.5
        put_prob  = float(proba[0]) if len(proba) > 0 else 0.5

        if call_prob > 0.60:
            return "call", round(call_prob, 3)
        if put_prob > 0.60:
            return "put", round(put_prob, 3)
        return "neutral", 0.0


class RandomForestStrategy(_MLStrategy):
    def __init__(self):
        super().__init__(
            "RandomForest",
            RandomForestClassifier,
            n_estimators=100,
            max_depth=6,
            random_state=42,
            n_jobs=-1,
        )


class GradientBoostingStrategy(_MLStrategy):
    def __init__(self):
        super().__init__(
            "GradientBoosting",
            GradientBoostingClassifier,
            n_estimators=80,
            max_depth=4,
            learning_rate=0.1,
            random_state=42,
        )
