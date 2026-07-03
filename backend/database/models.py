from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, Text
from sqlalchemy.orm import DeclarativeBase
from datetime import datetime


class Base(DeclarativeBase):
    pass


class Trade(Base):
    __tablename__ = "trades"

    id = Column(Integer, primary_key=True, autoincrement=True)
    order_id = Column(String(64), unique=True, nullable=True)
    asset = Column(String(32), nullable=False)
    direction = Column(String(8), nullable=False)   # call | put
    amount = Column(Float, nullable=False)
    expiration_minutes = Column(Integer, nullable=False)
    strategy_name = Column(String(64), nullable=False)
    confidence = Column(Float, nullable=False, default=0.0)
    open_price = Column(Float, nullable=True)
    close_price = Column(Float, nullable=True)
    profit = Column(Float, nullable=True)
    win = Column(Boolean, nullable=True)
    opened_at = Column(DateTime, default=datetime.utcnow)
    closed_at = Column(DateTime, nullable=True)
    timeframe = Column(Integer, nullable=False, default=60)
    account_type = Column(String(16), nullable=False, default="PRACTICE")
    balance_before = Column(Float, nullable=True)
    balance_after = Column(Float, nullable=True)


class StrategyEvaluation(Base):
    __tablename__ = "strategy_evaluations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    strategy_name = Column(String(64), nullable=False)
    asset = Column(String(32), nullable=False)
    win_rate = Column(Float, nullable=False)
    profit_factor = Column(Float, nullable=False)
    max_drawdown = Column(Float, nullable=False)
    total_trades = Column(Integer, nullable=False)
    composite_score = Column(Float, nullable=False)
    evaluated_at = Column(DateTime, default=datetime.utcnow)


class DailyPnL(Base):
    __tablename__ = "daily_pnl"

    id = Column(Integer, primary_key=True, autoincrement=True)
    date = Column(String(10), unique=True, nullable=False)   # YYYY-MM-DD
    total_profit = Column(Float, nullable=False, default=0.0)
    total_trades = Column(Integer, nullable=False, default=0)
    winning_trades = Column(Integer, nullable=False, default=0)
    starting_balance = Column(Float, nullable=True)
    ending_balance = Column(Float, nullable=True)
