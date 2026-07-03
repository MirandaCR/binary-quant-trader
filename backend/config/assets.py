"""
Canonical list of available assets for the suggestions/analysis API.
Matches the frontend ASSET_GROUPS structure.
"""

ASSET_GROUPS = [
    {
        "label": "Forex OTC",
        "assets": [
            "EURUSD-OTC", "GBPUSD-OTC", "EURJPY-OTC", "USDJPY-OTC",
            "AUDUSD-OTC", "USDCAD-OTC", "EURGBP-OTC", "AUDCAD-OTC", "NZDUSD-OTC",
        ],
    },
    {
        "label": "Forex",
        "assets": ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "EURGBP"],
    },
    {
        "label": "Crypto OTC",
        "assets": ["BTCUSD-OTC", "ETHUSD-OTC", "LTCUSD-OTC", "XRPUSD-OTC"],
    },
    {
        "label": "Crypto",
        "assets": ["BTCUSD", "ETHUSD", "BNBUSD", "SOLUSD"],
    },
    {
        "label": "Stocks OTC",
        "assets": ["AAPL-OTC", "GOOG-OTC", "MSFT-OTC", "AMZN-OTC", "TSLA-OTC", "META-OTC"],
    },
    {
        "label": "Commodities",
        "assets": ["XAUUSD", "XAGUSD", "XAUUSD-OTC"],
    },
]


def all_assets_flat() -> list:
    return [a for g in ASSET_GROUPS for a in g["assets"]]


# Timeframe in seconds → prefer OTC for short timeframes (1m–5m), include regular for longer
TIMEFRAME_ASSET_MAP = {
    5: ["EURUSD-OTC", "GBPUSD-OTC", "EURJPY-OTC", "USDJPY-OTC", "AUDUSD-OTC", "AAPL-OTC", "TSLA-OTC", "BTCUSD-OTC", "ETHUSD-OTC"],
    10: ["EURUSD-OTC", "GBPUSD-OTC", "EURJPY-OTC", "USDJPY-OTC", "AUDUSD-OTC", "AAPL-OTC", "TSLA-OTC", "BTCUSD-OTC", "ETHUSD-OTC"],
    15: ["EURUSD-OTC", "GBPUSD-OTC", "EURJPY-OTC", "USDJPY-OTC", "AUDUSD-OTC", "USDCAD-OTC", "AAPL-OTC", "TSLA-OTC", "MSFT-OTC", "BTCUSD-OTC", "ETHUSD-OTC"],
    30: ["EURUSD-OTC", "GBPUSD-OTC", "EURJPY-OTC", "USDJPY-OTC", "AUDUSD-OTC", "USDCAD-OTC", "EURGBP-OTC", "AAPL-OTC", "TSLA-OTC", "MSFT-OTC", "AMZN-OTC", "BTCUSD-OTC", "ETHUSD-OTC", "XAUUSD-OTC"],
    60: ["EURUSD-OTC", "GBPUSD-OTC", "EURJPY-OTC", "USDJPY-OTC", "AUDUSD-OTC", "USDCAD-OTC", "EURGBP-OTC", "NZDUSD-OTC", "AAPL-OTC", "GOOG-OTC", "MSFT-OTC", "AMZN-OTC", "TSLA-OTC", "META-OTC", "BTCUSD-OTC", "ETHUSD-OTC", "XAUUSD", "XAUUSD-OTC"],
    120: ["EURUSD-OTC", "GBPUSD-OTC", "EURJPY-OTC", "USDJPY-OTC", "AUDUSD-OTC", "USDCAD-OTC", "EURGBP-OTC", "AAPL-OTC", "MSFT-OTC", "TSLA-OTC", "BTCUSD-OTC", "ETHUSD-OTC", "XAUUSD", "XAUUSD-OTC"],
    180: ["EURUSD-OTC", "GBPUSD-OTC", "EURJPY-OTC", "USDJPY-OTC", "AUDUSD-OTC", "AAPL-OTC", "TSLA-OTC", "BTCUSD-OTC", "ETHUSD-OTC", "XAUUSD-OTC"],
    300: ["EURUSD-OTC", "GBPUSD-OTC", "EURJPY-OTC", "USDJPY-OTC", "AUDUSD-OTC", "AAPL-OTC", "TSLA-OTC", "BTCUSD-OTC", "ETHUSD-OTC", "XAUUSD", "XAUUSD-OTC"],
    600: ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "EURUSD-OTC", "GBPUSD-OTC", "AAPL-OTC", "TSLA-OTC", "BTCUSD", "ETHUSD", "XAUUSD"],
    900: ["EURUSD", "GBPUSD", "USDJPY", "EURUSD-OTC", "GBPUSD-OTC", "BTCUSD", "ETHUSD", "XAUUSD"],
    1800: ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "EURUSD-OTC", "GBPUSD-OTC", "BTCUSD", "XAUUSD"],
    3600: ["EURUSD", "GBPUSD", "USDJPY", "EURUSD-OTC", "GBPUSD-OTC", "BTCUSD", "XAUUSD"],
}


def assets_for_timeframe(timeframe_seconds: int) -> list:
    """Return assets that are typically available for this timeframe (OTC for short TF)."""
    return TIMEFRAME_ASSET_MAP.get(timeframe_seconds, all_assets_flat())

