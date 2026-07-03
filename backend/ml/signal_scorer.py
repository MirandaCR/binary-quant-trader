"""
Traditional ML layer (meta-labeling) that complements the Gen-AI strategies.

The LLM (agents/orchestrator.py, suggestions_pipeline.py) designs and improves the
trading rules themselves. This module learns, from actual trade history, which
(strategy, asset, hour, confidence) combinations tend to WIN — independent of what
the strategy's own confidence claims — and returns a probability used to adjust the
final trade confidence. Classic quant "meta-labeling": a secondary classifier that
filters/sizes the primary signal instead of generating it.

Deliberately simple (logistic regression over a handful of features): with the
sample sizes a single retail account produces (dozens-hundreds of trades), a small
linear model generalizes far better than a deep or heavily-tuned one.
"""
import logging
import threading
from datetime import datetime
from typing import Any, Dict, List, Optional

import numpy as np

logger = logging.getLogger(__name__)

MIN_TRAINING_SAMPLES = 30
FEATURE_COLUMNS_CAT = ["strategy_name", "asset"]
FEATURE_COLUMNS_NUM = ["confidence", "hour", "weekday"]


def _row_features(trade: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    opened_at = trade.get("opened_at")
    if not opened_at:
        return None
    try:
        dt = datetime.fromisoformat(opened_at.replace("Z", "+00:00"))
    except Exception:
        return None
    return {
        "strategy_name": trade.get("strategy_name") or "unknown",
        "asset": trade.get("asset") or "unknown",
        "confidence": float(trade.get("confidence") or 0.55),
        "hour": dt.hour,
        "weekday": dt.weekday(),
    }


class SignalScorer:
    """Thread-safe wrapper around a scikit-learn pipeline, retrained periodically."""

    def __init__(self):
        self._lock = threading.Lock()
        self._pipeline = None
        self._trained_on = 0
        self._last_train_error: Optional[str] = None

    @property
    def is_ready(self) -> bool:
        return self._pipeline is not None

    def train(self, trades: List[Dict[str, Any]]) -> bool:
        """Fit on closed trades (win is not None). Returns True if a model was (re)trained."""
        closed = [t for t in trades if t.get("win") is not None]
        rows = [_row_features(t) for t in closed]
        rows = [r for r, t in zip(rows, closed) if r is not None]
        labels = [1 if t.get("win") else 0 for t, r in zip(closed, rows) if r is not None]

        if len(rows) < MIN_TRAINING_SAMPLES:
            return False

        # Need both classes present to fit a classifier
        if len(set(labels)) < 2:
            return False

        try:
            from sklearn.compose import ColumnTransformer
            from sklearn.linear_model import LogisticRegression
            from sklearn.pipeline import Pipeline
            from sklearn.preprocessing import OneHotEncoder
            import pandas as pd

            X = pd.DataFrame(rows)
            y = np.array(labels)

            pipeline = Pipeline([
                ("prep", ColumnTransformer([
                    ("cat", OneHotEncoder(handle_unknown="ignore"), FEATURE_COLUMNS_CAT),
                ], remainder="passthrough")),
                ("clf", LogisticRegression(max_iter=500, class_weight="balanced")),
            ])
            pipeline.fit(X[FEATURE_COLUMNS_CAT + FEATURE_COLUMNS_NUM], y)

            with self._lock:
                self._pipeline = pipeline
                self._trained_on = len(rows)
                self._last_train_error = None
            logger.info("SignalScorer: trained on %d closed trades", len(rows))
            return True
        except Exception as e:
            logger.warning("SignalScorer: training failed: %s", e)
            with self._lock:
                self._last_train_error = str(e)
            return False

    def score(
        self,
        strategy_name: str,
        asset: str,
        confidence: float,
        when: Optional[datetime] = None,
    ) -> Optional[float]:
        """Return predicted win probability in [0,1], or None if not trained yet."""
        with self._lock:
            pipeline = self._pipeline
        if pipeline is None:
            return None

        when = when or datetime.utcnow()
        try:
            import pandas as pd
            row = pd.DataFrame([{
                "strategy_name": strategy_name,
                "asset": asset,
                "confidence": confidence,
                "hour": when.hour,
                "weekday": when.weekday(),
            }])
            proba = pipeline.predict_proba(row[FEATURE_COLUMNS_CAT + FEATURE_COLUMNS_NUM])[0]
            classes = list(pipeline.named_steps["clf"].classes_)
            return float(proba[classes.index(1)])
        except Exception as e:
            logger.debug("SignalScorer.score error: %s", e)
            return None

    def blend_confidence(
        self,
        strategy_name: str,
        asset: str,
        confidence: float,
        when: Optional[datetime] = None,
        ml_weight: float = 0.3,
    ) -> tuple[float, Optional[float]]:
        """
        Blend the strategy's own confidence with the ML win-probability estimate.
        Returns (adjusted_confidence, raw_ml_score). If the model isn't ready yet,
        returns the original confidence unchanged and ml_score=None.
        """
        ml_score = self.score(strategy_name, asset, confidence, when)
        if ml_score is None:
            return confidence, None
        adjusted = (1 - ml_weight) * confidence + ml_weight * ml_score
        return max(0.0, min(1.0, adjusted)), ml_score
