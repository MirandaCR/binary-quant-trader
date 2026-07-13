"""
Traditional ML layer (meta-labeling) that complements the Gen-AI strategies.

The LLM (agents/orchestrator.py) designs and improves the trading rules themselves.
This module learns, from actual trade history, which (strategy, asset, hour, weekday,
confidence) combinations tend to WIN — independent of what the strategy's own
confidence claims — and returns a probability used to adjust the final trade
confidence. Classic quant "meta-labeling": a secondary classifier that filters/sizes
the primary signal instead of generating it.

Model choice is configurable via `model_type`:
  • "logistic" — logistic regression. The right default for small accounts: with the
    dozens–hundreds of trades a single account produces, a linear model generalizes
    far better than anything heavier.
  • "xgboost"  — gradient-boosted trees. Only worth it once you have a lot of data;
    on small samples it overfits. Falls back to logistic if xgboost isn't installed.
  • "auto"     — logistic until enough data accumulates, then xgboost automatically.

Note on "per-asset models": we deliberately use ONE model with `asset` as a feature
rather than a separate model per asset. A retail account can't feed dozens of separate
models enough data each — they'd all starve. One shared model still learns per-asset
behaviour through the asset feature, with far more data behind every prediction.
"""
import logging
import threading
from datetime import datetime
from typing import Any, Dict, List, Optional

import numpy as np

logger = logging.getLogger(__name__)

MIN_TRAINING_SAMPLES = 30      # below this, the model stays off (confidence untouched)
MIN_SAMPLES_FOR_METRICS = 40   # below this, we can't measure performance reliably
XGBOOST_MIN_SAMPLES = 150      # "auto" only upgrades to xgboost above this

FEATURE_COLUMNS_CAT = ["strategy_name", "asset"]
FEATURE_COLUMNS_NUM = ["confidence", "hour", "weekday"]
FEATURE_COLUMNS = FEATURE_COLUMNS_CAT + FEATURE_COLUMNS_NUM

VALID_MODEL_TYPES = ("auto", "logistic", "xgboost")


def _xgboost_available() -> bool:
    try:
        import xgboost  # noqa: F401
        return True
    except Exception:
        return False


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

    def __init__(self, model_type: str = "auto"):
        self.model_type = (model_type or "auto").lower().strip()
        if self.model_type not in VALID_MODEL_TYPES:
            self.model_type = "auto"
        self._lock = threading.Lock()
        self._pipeline = None
        self._trained_on = 0
        self._active_model = None          # which model actually got used
        self._metrics: Dict[str, Any] = {}  # held-out performance, plain-language ready
        self._last_train_error: Optional[str] = None

    @property
    def is_ready(self) -> bool:
        return self._pipeline is not None

    # ── Model construction ────────────────────────────────────────────────────

    def _resolve_model(self, n_samples: int) -> str:
        """Decide which concrete model to use for this many samples."""
        if self.model_type == "logistic":
            return "logistic"
        if self.model_type == "xgboost":
            return "xgboost" if _xgboost_available() else "logistic"
        # auto: logistic until there's enough data to justify (and afford) xgboost
        if n_samples >= XGBOOST_MIN_SAMPLES and _xgboost_available():
            return "xgboost"
        return "logistic"

    def _build_pipeline(self, model_name: str):
        from sklearn.compose import ColumnTransformer
        from sklearn.pipeline import Pipeline
        from sklearn.preprocessing import OneHotEncoder

        prep = ColumnTransformer(
            [("cat", OneHotEncoder(handle_unknown="ignore"), FEATURE_COLUMNS_CAT)],
            remainder="passthrough",
        )
        if model_name == "xgboost":
            from xgboost import XGBClassifier
            clf = XGBClassifier(
                n_estimators=120, max_depth=3, learning_rate=0.1,
                subsample=0.9, colsample_bytree=0.9,
                eval_metric="logloss", n_jobs=2, verbosity=0,
            )
        else:
            from sklearn.linear_model import LogisticRegression
            clf = LogisticRegression(max_iter=500, class_weight="balanced")
        return Pipeline([("prep", prep), ("clf", clf)])

    # ── Training ──────────────────────────────────────────────────────────────

    def train(self, trades: List[Dict[str, Any]]) -> bool:
        """Fit on closed trades (win is not None). Returns True if a model was (re)trained."""
        closed = [t for t in trades if t.get("win") is not None]
        paired = [(r, t) for t, r in ((t, _row_features(t)) for t in closed) if r is not None]
        rows = [r for r, _ in paired]
        labels = [1 if t.get("win") else 0 for _, t in paired]

        if len(rows) < MIN_TRAINING_SAMPLES:
            return False
        if len(set(labels)) < 2:  # need both wins and losses to learn anything
            return False

        try:
            import pandas as pd

            X = pd.DataFrame(rows)[FEATURE_COLUMNS]
            y = np.array(labels)
            model_name = self._resolve_model(len(rows))

            metrics = self._evaluate(X, y, model_name)

            # Final production model is always fit on ALL available data
            pipeline = self._build_pipeline(model_name)
            pipeline.fit(X, y)

            with self._lock:
                self._pipeline = pipeline
                self._trained_on = len(rows)
                self._active_model = model_name
                self._metrics = metrics
                self._last_train_error = None
            logger.info("SignalScorer: trained %s on %d trades (%s)",
                        model_name, len(rows), metrics.get("summary", ""))
            return True
        except Exception as e:
            logger.warning("SignalScorer: training failed: %s", e)
            with self._lock:
                self._last_train_error = str(e)
            return False

    def _evaluate(self, X, y, model_name: str) -> Dict[str, Any]:
        """
        Honest held-out performance so the dashboard can show whether the model is
        actually learning. Returns plain-language-ready numbers.
        """
        n = len(y)
        # Baseline = accuracy of always guessing the most common outcome
        win_rate = float(np.mean(y))
        baseline = max(win_rate, 1.0 - win_rate)

        if n < MIN_SAMPLES_FOR_METRICS:
            return {
                "reliable": False,
                "reason": f"Need {MIN_SAMPLES_FOR_METRICS}+ closed trades to measure reliably.",
                "trained_on": n,
                "baseline_accuracy": round(baseline, 3),
                "model": model_name,
            }

        try:
            from sklearn.model_selection import train_test_split
            from sklearn.metrics import accuracy_score, roc_auc_score

            X_tr, X_te, y_tr, y_te = train_test_split(
                X, y, test_size=0.25, random_state=42, stratify=y
            )
            pipe = self._build_pipeline(model_name)
            pipe.fit(X_tr, y_tr)

            classes = list(pipe.named_steps["clf"].classes_)
            proba = pipe.predict_proba(X_te)[:, classes.index(1)]
            preds = (proba >= 0.5).astype(int)

            accuracy = float(accuracy_score(y_te, preds))
            try:
                auc = float(roc_auc_score(y_te, proba))
            except Exception:
                auc = None  # undefined if test set is single-class

            edge = accuracy - baseline
            return {
                "reliable": True,
                "model": model_name,
                "trained_on": n,
                "test_size": int(len(y_te)),
                "accuracy": round(accuracy, 3),
                "baseline_accuracy": round(baseline, 3),
                "edge_over_guessing": round(edge, 3),
                "auc": round(auc, 3) if auc is not None else None,
                "summary": f"acc={accuracy:.0%} vs baseline {baseline:.0%}",
            }
        except Exception as e:
            logger.debug("SignalScorer._evaluate failed: %s", e)
            return {"reliable": False, "reason": str(e), "trained_on": n, "model": model_name}

    # ── Inference ─────────────────────────────────────────────────────────────

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
            }])[FEATURE_COLUMNS]
            classes = list(pipeline.named_steps["clf"].classes_)
            proba = pipeline.predict_proba(row)[0]
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

    # ── Status (for the dashboard) ────────────────────────────────────────────

    def status(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "ready": self._pipeline is not None,
                "trained_on": self._trained_on,
                "model_type": self.model_type,
                "active_model": self._active_model,
                "metrics": dict(self._metrics),
            }
