import os
from pydantic import BaseModel, field_validator
from typing import List, Optional
from dotenv import load_dotenv

load_dotenv()

AI_PROVIDERS = ("deepseek", "openai", "gemini", "anthropic")


class BotConfig(BaseModel):
    email: str = os.environ.get("IQ_EMAIL", "")
    password: str = os.environ.get("IQ_PASSWORD", "")
    account_type: str = "PRACTICE"          # PRACTICE | REAL
    timeframe: int = 60                      # candle duration in seconds
    assets: List[str] = ["EURUSD-OTC", "GBPUSD-OTC", "EURJPY-OTC", "AAPL-OTC", "TSLA-OTC", "MSFT-OTC"]
    investment_amount: float = 1.0           # USD per trade (used when investment_mode="fixed")
    investment_mode: str = "fixed"           # "fixed" | "percent"
    investment_pct: float = 5.0             # % of current balance per trade (used when investment_mode="percent")
    max_daily_loss_pct: float = 5.0          # % of starting balance
    max_consecutive_losses: int = 5
    min_win_rate: float = 0.55               # minimum required win-rate to trade
    backtest_periods: int = 150              # candles for initial backtesting
    strategy_eval_interval: int = 300       # seconds between background re-evaluations
    portfolio_size: int = 3                 # concurrent distinct-asset combos traded per cycle;
                                             # capital is split across them by composite score, not multiplied
    news_api_key: Optional[str] = os.environ.get("NEWSAPI_KEY")
    ai_provider: str = os.environ.get("AI_PROVIDER", "deepseek")  # "deepseek" | "openai" | "gemini" | "anthropic"
    ai_api_key: Optional[str] = os.environ.get("AI_API_KEY")
    ai_base_url: Optional[str] = os.environ.get("AI_BASE_URL")   # override; else provider default
    ai_model: Optional[str] = os.environ.get("AI_MODEL")         # override; else provider default
    expiration_minutes: int = 1             # binary option expiration in minutes (used if expiration_seconds not set)
    expiration_seconds: Optional[int] = None  # if set, use direct binary: wait candle close → enter → result after this many seconds (e.g. 30)

    # Compound interest
    use_compound_interest: bool = False     # scale position size with balance growth
    compound_factor: float = 1.0           # 0=no compound, 1=linear, 2=aggressive
    min_win_rate_for_compound: float = 0.55 # only compound when session win rate ≥ this

    # Hard stop: only stop ALL trading when balance loss reaches this % of starting balance
    # (daily-loss and consecutive-losses become soft warnings + risk reduction instead)
    hard_stop_pct: float = 75.0            # e.g. 75 → stop when 75% of starting balance is lost


    @field_validator("account_type")
    @classmethod
    def validate_account(cls, v: str) -> str:
        if v.upper() not in ("PRACTICE", "REAL"):
            raise ValueError("account_type must be PRACTICE or REAL")
        return v.upper()

    @field_validator("timeframe")
    @classmethod
    def validate_timeframe(cls, v: int) -> int:
        allowed = [5, 10, 15, 30, 60, 120, 180, 300, 600, 900, 1800, 3600]
        if v not in allowed:
            raise ValueError(f"timeframe must be one of {allowed}")
        return v

    @field_validator("ai_provider")
    @classmethod
    def validate_ai_provider(cls, v: str) -> str:
        v = (v or "deepseek").lower().strip()
        if v not in AI_PROVIDERS:
            raise ValueError(f"ai_provider must be one of {AI_PROVIDERS}")
        return v

    @field_validator("portfolio_size")
    @classmethod
    def validate_portfolio_size(cls, v: int) -> int:
        return max(1, min(v, 10))


class AppSettings:
    HOST: str = "0.0.0.0"
    PORT: int = 8100          # Changed from 8000 to avoid Anaconda/Jupyter conflicts
    DB_PATH: str = "trades.db"
    CORS_ORIGINS: List[str] = ["*"]
    # OpenAI-compatible API (Flexi/OpenAI) for dynamic strategy suggestions
    OPENAI_API_KEY: Optional[str] = os.environ.get("OPENAI_API_KEY")  # Or pass in request
    OPENAI_BASE_URL: Optional[str] = os.environ.get("OPENAI_BASE_URL")


app_settings = AppSettings()
