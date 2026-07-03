"""
Data fetcher: converts raw IQ Option candle dicts to pandas DataFrames
and provides timing utilities for precise candle-close execution.
"""
import math
import time
import logging
from typing import List, Dict, Optional

import pandas as pd
import numpy as np

from connection.iq_client import IQClient

logger = logging.getLogger(__name__)


# ── Candle data ───────────────────────────────────────────────────────────────

def fetch_candles(client: IQClient, asset: str,
                  timeframe: int, count: int) -> pd.DataFrame:
    """Return a clean OHLCV DataFrame sorted oldest→newest."""
    raw = client.get_candles(asset, timeframe, count, time.time())
    if not raw:
        return pd.DataFrame()
    return _raw_to_df(raw)


def _raw_to_df(raw: List[Dict]) -> pd.DataFrame:
    records = []
    for c in raw:
        records.append({
            "timestamp": c.get("from", c.get("at", 0)),
            "open":   float(c.get("open",  0)),
            "high":   float(c.get("max",   c.get("high", 0))),
            "low":    float(c.get("min",   c.get("low",  0))),
            "close":  float(c.get("close", 0)),
            "volume": float(c.get("volume", 0)),
        })
    df = pd.DataFrame(records)
    df.sort_values("timestamp", inplace=True)
    df.reset_index(drop=True, inplace=True)
    df["datetime"] = pd.to_datetime(df["timestamp"], unit="s")
    return df


# ── Timing utilities ──────────────────────────────────────────────────────────

def seconds_until_next_candle_close(timeframe: int,
                                    server_time: Optional[float] = None) -> float:
    """How many seconds remain until the current candle closes."""
    t = server_time if server_time is not None else time.time()
    next_close = math.ceil(t / timeframe) * timeframe
    return max(0.0, next_close - t)


def wait_for_candle_close(timeframe: int, client: IQClient,
                           pre_close_offset: float = 2.0) -> None:
    """
    Sleep until `pre_close_offset` seconds before the candle closes.
    Uses the IQ Option server timestamp for precision.
    """
    server_time = client.get_server_timestamp()
    remaining = seconds_until_next_candle_close(timeframe, server_time)
    wait = remaining - pre_close_offset
    if wait > 0:
        logger.debug("Waiting %.2f s for candle close (timeframe=%d)", wait, timeframe)
        time.sleep(wait)


def current_candle_open_time(timeframe: int,
                              server_time: Optional[float] = None) -> float:
    t = server_time if server_time is not None else time.time()
    return math.floor(t / timeframe) * timeframe


# ── Feature engineering (shared by strategies) ───────────────────────────────

def add_base_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    c = df["close"]
    df["returns"]       = c.pct_change()
    df["log_returns"]   = np.log(c / c.shift(1))
    df["range"]         = df["high"] - df["low"]
    df["body"]          = abs(df["close"] - df["open"])
    df["upper_shadow"]  = df["high"] - df[["open", "close"]].max(axis=1)
    df["lower_shadow"]  = df[["open", "close"]].min(axis=1) - df["low"]
    df["body_ratio"]    = df["body"] / df["range"].replace(0, np.nan)
    df["vol_ma20"]      = df["volume"].rolling(20).mean()
    df["vol_ratio"]     = df["volume"] / df["vol_ma20"].replace(0, np.nan)
    return df
