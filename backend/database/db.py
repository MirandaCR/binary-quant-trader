import csv
import io
from sqlalchemy import create_engine, select, func, delete, text
from sqlalchemy.orm import Session
from datetime import datetime, date, timedelta
from typing import List, Optional, Dict, Any

from .models import Base, Trade, StrategyEvaluation, DailyPnL

_engine = None


def init_db(db_path: str = "trades.db") -> None:
    global _engine
    _engine = create_engine(
        f"sqlite:///{db_path}",
        echo=False,
        connect_args={"check_same_thread": False, "timeout": 30},
        pool_pre_ping=True,
    )
    Base.metadata.create_all(_engine)
    _migrate_add_columns()


def _migrate_add_columns() -> None:
    """Add new columns to existing tables without dropping data."""
    migrations = [
        "ALTER TABLE trades ADD COLUMN balance_before REAL",
        "ALTER TABLE trades ADD COLUMN balance_after REAL",
    ]
    with _engine.connect() as conn:
        for sql in migrations:
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception:
                pass  # Column already exists — SQLite raises OperationalError


def get_session() -> Session:
    if _engine is None:
        init_db()
    return Session(_engine)


# ── Trade operations ─────────────────────────────────────────────────────────

def save_trade(trade_data: Dict[str, Any]) -> Trade:
    with get_session() as session:
        trade = Trade(**trade_data)
        session.add(trade)
        session.commit()
        session.refresh(trade)
        return trade


def update_trade_result(order_id: str, profit: float, win: bool,
                        close_price: float, closed_at: datetime,
                        balance_after: Optional[float] = None) -> None:
    with get_session() as session:
        trade = session.execute(
            select(Trade).where(Trade.order_id == order_id)
        ).scalar_one_or_none()
        if trade:
            trade.profit = profit
            trade.win = win
            trade.close_price = close_price
            trade.closed_at = closed_at
            if balance_after is not None:
                trade.balance_after = balance_after
            session.commit()


def get_trades(limit: int = 100, offset: int = 0,
               asset: Optional[str] = None) -> List[Dict]:
    with get_session() as session:
        q = select(Trade).order_by(Trade.opened_at.desc()).limit(limit).offset(offset)
        if asset:
            q = q.where(Trade.asset == asset)
        rows = session.execute(q).scalars().all()
        return [_trade_to_dict(t) for t in rows]


def get_trades_filtered(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    asset: Optional[str] = None,
    result: Optional[str] = None,   # "win" | "loss" | "open"
    strategy: Optional[str] = None,
) -> List[Dict]:
    """Return trades filtered by any combination of date range, asset, result, strategy."""
    with get_session() as session:
        q = select(Trade).order_by(Trade.opened_at.asc())
        if start_date:
            q = q.where(func.date(Trade.opened_at) >= start_date)
        if end_date:
            q = q.where(func.date(Trade.opened_at) <= end_date)
        if asset:
            q = q.where(Trade.asset == asset)
        if strategy:
            q = q.where(Trade.strategy_name == strategy)
        if result == "win":
            q = q.where(Trade.win == True)
        elif result == "loss":
            q = q.where(Trade.win == False)
        elif result == "open":
            q = q.where(Trade.win == None)
        rows = session.execute(q).scalars().all()
        return [_trade_to_dict(t) for t in rows]


def export_trades_csv(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    asset: Optional[str] = None,
    result: Optional[str] = None,
    strategy: Optional[str] = None,
) -> str:
    """Return filtered trades as a CSV string."""
    trades = get_trades_filtered(start_date, end_date, asset, result, strategy)
    out = io.StringIO()
    fieldnames = [
        "id", "opened_at", "closed_at", "asset", "direction", "strategy_name",
        "confidence", "amount", "profit", "win", "balance_before", "balance_after",
        "timeframe", "account_type", "open_price", "close_price",
    ]
    writer = csv.DictWriter(out, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    for t in trades:
        writer.writerow(t)
    return out.getvalue()


def mark_orphaned_trades_expired(before: Optional[datetime] = None) -> int:
    """
    Close all open trades (win=None) opened before *before* (defaults to 'now').
    These are leftover from a previous session that never settled.
    """
    with get_session() as session:
        q = select(Trade).where(Trade.win == None).where(Trade.profit == None)
        if before:
            q = q.where(Trade.opened_at < before)
        trades = session.execute(q).scalars().all()
        now = datetime.utcnow()
        for t in trades:
            t.win = False
            t.profit = 0.0
            t.close_price = t.open_price
            t.closed_at = now
        session.commit()
        return len(trades)


def get_recent_live_performance(limit: int = 100) -> List[Dict]:
    """Return the most recent closed trades for live performance analysis."""
    with get_session() as session:
        q = (
            select(Trade)
            .where(Trade.win != None)
            .order_by(Trade.closed_at.desc())
            .limit(limit)
        )
        rows = session.execute(q).scalars().all()
        return [_trade_to_dict(t) for t in rows]


def get_live_performance_by_strategy(limit_per_combo: int = 20) -> Dict[str, Any]:
    """
    Return per-strategy live stats: win rate, consecutive losses, recent profit.
    Key format: "strategy_name/asset".
    """
    with get_session() as session:
        q = (
            select(Trade)
            .where(Trade.win != None)
            .order_by(Trade.opened_at.desc())
            .limit(500)
        )
        rows = session.execute(q).scalars().all()

    stats: Dict[str, Any] = {}
    for t in rows:
        key = f"{t.strategy_name}/{t.asset}"
        if key not in stats:
            stats[key] = {"wins": 0, "losses": 0, "profits": [], "recent": []}
        entry = stats[key]
        won = bool(t.win)
        entry["recent"].append(won)
        entry["profits"].append(t.profit or 0.0)
        if won:
            entry["wins"] += 1
        else:
            entry["losses"] += 1

    result: Dict[str, Any] = {}
    for key, d in stats.items():
        total = d["wins"] + d["losses"]
        recent = d["recent"][:limit_per_combo]
        # consecutive losses from the latest result
        consec = 0
        for r in recent:
            if not r:
                consec += 1
            else:
                break
        result[key] = {
            "win_rate": d["wins"] / total if total else 0.0,
            "total": total,
            "wins": d["wins"],
            "losses": d["losses"],
            "total_profit": sum(d["profits"]),
            "consecutive_losses": consec,
        }
    return result


def get_today_trades() -> List[Dict]:
    today = date.today().isoformat()
    with get_session() as session:
        q = select(Trade).where(
            func.date(Trade.opened_at) == today
        ).order_by(Trade.opened_at.asc())
        rows = session.execute(q).scalars().all()
        return [_trade_to_dict(t) for t in rows]


def delete_all_trades() -> int:
    """Delete all trades from the database. Returns the number of rows deleted."""
    with get_session() as session:
        result = session.execute(delete(Trade))
        session.commit()
        return result.rowcount or 0


def get_trade_stats() -> Dict[str, Any]:
    with get_session() as session:
        total = session.execute(select(func.count(Trade.id))).scalar()
        wins = session.execute(
            select(func.count(Trade.id)).where(Trade.win == True)
        ).scalar()
        total_profit = session.execute(
            select(func.sum(Trade.profit)).where(Trade.profit.isnot(None))
        ).scalar() or 0.0
        return {
            "total_trades": total,
            "winning_trades": wins or 0,
            "win_rate": round((wins / total * 100) if total else 0, 2),
            "total_profit": round(total_profit, 2),
        }


# ── Strategy evaluation ───────────────────────────────────────────────────────

def save_strategy_evaluation(data: Dict[str, Any]) -> None:
    # Only pass fields that exist on the model — ignore extras like winning_trades
    valid = {c.name for c in StrategyEvaluation.__table__.columns}
    filtered = {k: v for k, v in data.items() if k in valid}
    with get_session() as session:
        ev = StrategyEvaluation(**filtered)
        session.add(ev)
        session.commit()


def get_latest_evaluations() -> List[Dict]:
    with get_session() as session:
        subq = (
            select(
                StrategyEvaluation.strategy_name,
                StrategyEvaluation.asset,
                func.max(StrategyEvaluation.evaluated_at).label("max_at"),
            )
            .group_by(StrategyEvaluation.strategy_name, StrategyEvaluation.asset)
            .subquery()
        )
        rows = session.execute(
            select(StrategyEvaluation).join(
                subq,
                (StrategyEvaluation.strategy_name == subq.c.strategy_name)
                & (StrategyEvaluation.asset == subq.c.asset)
                & (StrategyEvaluation.evaluated_at == subq.c.max_at),
            )
        ).scalars().all()
        return [
            {
                "strategy_name": r.strategy_name,
                "asset": r.asset,
                "win_rate": r.win_rate,
                "profit_factor": r.profit_factor,
                "max_drawdown": r.max_drawdown,
                "total_trades": r.total_trades,
                "composite_score": r.composite_score,
                "evaluated_at": r.evaluated_at.isoformat(),
            }
            for r in rows
        ]


# ── Daily P&L ─────────────────────────────────────────────────────────────────

def upsert_daily_pnl(date_str: str, profit_delta: float, won: bool,
                     balance: Optional[float] = None) -> None:
    with get_session() as session:
        row = session.execute(
            select(DailyPnL).where(DailyPnL.date == date_str)
        ).scalar_one_or_none()
        if row:
            row.total_profit += profit_delta
            row.total_trades += 1
            if won:
                row.winning_trades += 1
            if balance is not None:
                row.ending_balance = balance
        else:
            row = DailyPnL(
                date=date_str,
                total_profit=profit_delta,
                total_trades=1,
                winning_trades=1 if won else 0,
                ending_balance=balance,
            )
            session.add(row)
        session.commit()


def get_daily_pnl(days: int = 60) -> List[Dict]:
    since = (date.today() - timedelta(days=days)).isoformat()
    with get_session() as session:
        rows = session.execute(
            select(DailyPnL)
            .where(DailyPnL.date >= since)
            .order_by(DailyPnL.date.asc())
        ).scalars().all()
        return [
            {
                "date": r.date,
                "total_profit": r.total_profit,
                "total_trades": r.total_trades,
                "winning_trades": r.winning_trades,
                "win_rate": round(r.winning_trades / r.total_trades * 100, 1)
                if r.total_trades else 0,
            }
            for r in rows
        ]


def delete_daily_pnl(date_str: str) -> bool:
    """Delete PnL record for a given date (YYYY-MM-DD). Returns True if deleted."""
    with get_session() as session:
        result = session.execute(delete(DailyPnL).where(DailyPnL.date == date_str))
        session.commit()
        return (result.rowcount or 0) > 0


# ── Helpers ───────────────────────────────────────────────────────────────────

def _trade_to_dict(t: Trade) -> Dict:
    def _utc(dt) -> Optional[str]:
        if dt is None:
            return None
        iso = dt.isoformat()
        # Ensure UTC marker so JavaScript parses correctly (avoids -17000s ago bug)
        return iso + "Z" if not iso.endswith("Z") and "+" not in iso else iso

    return {
        "id": t.id,
        "order_id": t.order_id,
        "asset": t.asset,
        "direction": t.direction,
        "amount": t.amount,
        "expiration_minutes": t.expiration_minutes,
        "strategy_name": t.strategy_name,
        "confidence": t.confidence,
        "open_price": t.open_price,
        "close_price": t.close_price,
        "profit": t.profit,
        "win": t.win,
        "opened_at": _utc(t.opened_at),
        "closed_at": _utc(t.closed_at),
        "timeframe": t.timeframe,
        "account_type": t.account_type,
        "balance_before": getattr(t, "balance_before", None),
        "balance_after": getattr(t, "balance_after", None),
    }
