"""
News fetcher using NewsAPI (https://newsapi.org).
Returns market-moving headlines for active assets.
Falls back gracefully if no API key is provided.
"""
import logging
import time
import threading
from typing import List, Dict, Optional

import httpx

logger = logging.getLogger(__name__)

_NEWSAPI_BASE = "https://newsapi.org/v2/everything"

# Currency / asset → search keywords
ASSET_KEYWORDS: Dict[str, List[str]] = {
    "EURUSD":     ["EUR/USD", "Euro dollar", "ECB", "Federal Reserve"],
    "EURUSD-OTC": ["EUR/USD", "Euro dollar", "ECB", "Federal Reserve"],
    "GBPUSD":     ["GBP/USD", "pound dollar", "Bank of England"],
    "GBPUSD-OTC": ["GBP/USD", "pound dollar", "Bank of England"],
    "USDJPY":     ["USD/JPY", "dollar yen", "Bank of Japan"],
    "USDJPY-OTC": ["USD/JPY", "dollar yen", "Bank of Japan"],
    "EURJPY":     ["EUR/JPY", "euro yen"],
    "EURJPY-OTC": ["EUR/JPY", "euro yen"],
    "AUDCAD":     ["AUD/CAD", "Australian dollar", "Canadian dollar"],
    "AUDCAD-OTC": ["AUD/CAD", "Australian dollar", "Canadian dollar"],
    "XAUUSD":     ["gold price", "XAUUSD", "gold market"],
    "XAGUSD":     ["silver price", "XAGUSD"],
}

_DEFAULT_KEYWORDS = ["forex", "currency", "financial markets"]


class NewsFetcher:
    def __init__(self, api_key: Optional[str] = None, cache_ttl: int = 300):
        self.api_key   = api_key
        self.cache_ttl = cache_ttl
        self._cache: Dict[str, tuple] = {}   # key → (articles, ts)
        self._lock = threading.Lock()

    def get_news(self, asset: str, limit: int = 5) -> List[Dict]:
        """Return recent news articles relevant to the asset."""
        key = (self.api_key or "").strip()
        if not key:
            logger.debug("NewsAPI: no API key configured")
            return []

        with self._lock:
            cached = self._cache.get(asset)
            if cached and time.time() - cached[1] < self.cache_ttl:
                return cached[0][:limit]

        keywords = ASSET_KEYWORDS.get(asset.upper(), _DEFAULT_KEYWORDS)
        query    = " OR ".join(f'"{k}"' for k in keywords[:3])

        try:
            resp = httpx.get(
                _NEWSAPI_BASE,
                params={
                    "q":        query,
                    "language": "en",
                    "sortBy":   "publishedAt",
                    "pageSize": 10,
                    "apiKey":   key,
                },
                timeout=10,
            )
            resp.raise_for_status()
            articles_raw = resp.json().get("articles", [])
            articles = [
                {
                    "title":       a.get("title", ""),
                    "description": a.get("description", ""),
                    "url":         a.get("url", ""),
                    "source":      a.get("source", {}).get("name", ""),
                    "published_at": a.get("publishedAt", ""),
                    "sentiment":   _simple_sentiment(a.get("title", "")),
                }
                for a in articles_raw
            ]
            with self._lock:
                self._cache[asset] = (articles, time.time())
            return articles[:limit]
        except httpx.HTTPStatusError as e:
            logger.warning("NewsAPI HTTP error for %s: %s %s", asset, e.response.status_code, e.response.text[:200])
            return []
        except Exception as exc:
            logger.debug("News fetch error for %s: %s", asset, exc)
            return []

    def get_all_news(self, assets: List[str], limit_each: int = 3) -> List[Dict]:
        """Aggregate news for multiple assets, deduplicated by URL."""
        seen_urls: set = set()
        results: List[Dict] = []
        for asset in assets:
            for art in self.get_news(asset, limit_each):
                if art["url"] not in seen_urls:
                    art["asset"] = asset
                    results.append(art)
                    seen_urls.add(art["url"])
        results.sort(key=lambda a: a.get("published_at", ""), reverse=True)
        return results


def _simple_sentiment(text: str) -> str:
    """Naive keyword-based sentiment: positive / negative / neutral."""
    t = text.lower()
    pos = ["rise", "gain", "bull", "surge", "rally", "high", "strong", "up",
           "growth", "positive", "improve"]
    neg = ["fall", "drop", "bear", "crash", "slump", "low", "weak", "down",
           "decline", "negative", "warn", "risk"]
    score = sum(1 for w in pos if w in t) - sum(1 for w in neg if w in t)
    if score > 0:
        return "positive"
    if score < 0:
        return "negative"
    return "neutral"
