"""
FastAPI backend — Binary Options Bot
REST API + WebSocket for the Next.js dashboard.
"""
import asyncio
import json
import logging
from contextlib import asynccontextmanager
from typing import Optional, List
from fastapi.responses import StreamingResponse

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from config.settings import BotConfig, app_settings
from config.assets import ASSET_GROUPS, all_assets_flat
from engine.trading_engine import TradingEngine
from database import db as DB
from news.news_fetcher import NewsFetcher

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ── Module-level state ────────────────────────────────────────────────────────

_loop:    Optional[asyncio.AbstractEventLoop] = None
_engine:  Optional[TradingEngine]             = None
_news:    Optional[NewsFetcher]               = None
_clients: List[WebSocket]                     = []


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _broadcast(data: dict) -> None:
    msg  = json.dumps(data, default=str)
    dead = []
    for ws in list(_clients):
        try:
            await ws.send_text(msg)
        except Exception:
            dead.append(ws)
    for ws in dead:
        if ws in _clients:
            _clients.remove(ws)


def _sync_broadcast(data: dict) -> None:
    """Thread-safe broadcast — called from sync worker threads."""
    if _loop and not _loop.is_closed():
        asyncio.run_coroutine_threadsafe(_broadcast(data), _loop)


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _loop
    _loop = asyncio.get_running_loop()
    DB.init_db(app_settings.DB_PATH)
    logger.info("Backend ready — DB initialised at %s", app_settings.DB_PATH)
    yield
    logger.info("Backend shutting down")


# ── App + CORS ────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Binary Options Bot API",
    version="2.0.0",
    lifespan=lifespan,
)

# Allow all origins so the frontend can connect on any port (3000, 3010, etc.)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── WebSocket ─────────────────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    _clients.append(ws)
    logger.info("WebSocket client connected (%d total)", len(_clients))
    try:
        # Send current state immediately on connect
        if _engine:
            await ws.send_text(json.dumps(
                {"type": "state", **_engine.get_state()}, default=str
            ))
        while True:
            await ws.receive_text()   # keep-alive
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        if ws in _clients:
            _clients.remove(ws)
        logger.info("WebSocket client disconnected (%d total)", len(_clients))


# ── Bot endpoints ─────────────────────────────────────────────────────────────

_IDLE_STATUSES = {"idle", "stopped", "error"}

@app.post("/api/bot/start")
async def start_bot(config: BotConfig):
    global _engine, _news

    if _engine and _engine._status not in _IDLE_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Bot is already active (status: {_engine._status}). Stop it first."
        )

    logger.info("► START BOT  user=%s  account=%s  assets=%s",
                config.email, config.account_type, config.assets)

    _news   = NewsFetcher(config.news_api_key)
    _engine = TradingEngine(config, broadcast=_sync_broadcast)

    loop = asyncio.get_running_loop()
    ok, reason = await loop.run_in_executor(None, _engine.start)

    if not ok:
        _engine = None
        logger.error("Bot start FAILED: %s", reason)
        raise HTTPException(status_code=500, detail=reason)

    logger.info("Bot started successfully")
    return {"status": "started", "message": "Bot started successfully"}


@app.post("/api/bot/stop")
async def stop_bot():
    global _engine
    if not _engine:
        raise HTTPException(status_code=400, detail="Bot is not running")
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, _engine.stop)
    _engine = None
    return {"status": "stopped"}


class LiveConfigPatch(BaseModel):
    investment_amount:         Optional[float] = None
    investment_mode:           Optional[str]   = None   # "fixed" | "percent"
    investment_pct:            Optional[float] = None   # % of balance per trade
    use_compound_interest:     Optional[bool]  = None
    compound_factor:           Optional[float] = None
    min_win_rate_for_compound: Optional[float] = None


@app.patch("/api/bot/config/live")
async def patch_live_config(patch: LiveConfigPatch):
    """Update investment amount / compound settings without stopping the bot.
    Changes apply on the next trade cycle.
    """
    if not _engine:
        raise HTTPException(status_code=400, detail="Bot is not running")
    _engine.update_live_config(
        investment_amount=patch.investment_amount,
        investment_mode=patch.investment_mode,
        investment_pct=patch.investment_pct,
        use_compound_interest=patch.use_compound_interest,
        compound_factor=patch.compound_factor,
        min_win_rate_for_compound=patch.min_win_rate_for_compound,
    )
    return {
        "status": "ok",
        "message": "Parameters updated — will apply on the next trade.",
        "investment_amount": _engine.config.investment_amount,
        "investment_mode": _engine.config.investment_mode,
        "investment_pct": _engine.config.investment_pct,
        "use_compound_interest": _engine.config.use_compound_interest,
        "compound_factor": _engine.config.compound_factor,
        "min_win_rate_for_compound": _engine.config.min_win_rate_for_compound,
    }


@app.post("/api/bot/override-risk")
async def override_risk():
    """Reset consecutive loss counter so the bot can continue trading after user confirms."""
    if not _engine:
        raise HTTPException(status_code=400, detail="Bot is not running")
    if not hasattr(_engine, "risk") or _engine.risk is None:
        raise HTTPException(status_code=400, detail="Risk manager not initialized")
    _engine.risk.reset_consecutive_losses()
    return {"status": "ok", "message": "Consecutive losses reset. Bot will try to trade on next candle."}


@app.post("/api/bot/resume")
async def resume_bot():
    """Clear ALL risk blocks (consecutive losses, daily loss limit, win-rate guard).
    The bot will attempt to trade on the very next candle close.
    """
    if not _engine:
        raise HTTPException(status_code=400, detail="Bot is not running")
    if not hasattr(_engine, "risk") or _engine.risk is None:
        raise HTTPException(status_code=400, detail="Risk manager not initialized")
    _engine.risk.resume_all()
    return {"status": "ok", "message": "All risk blocks cleared. Bot will resume on next candle."}


@app.get("/api/bot/status")
async def get_status():
    if not _engine:
        return {
            "status": "idle", "balance": 0,
            "best_combo": None, "all_results": [], "open_trades": 0,
            "risk": {
                "daily_profit": 0, "consecutive_losses": 0,
                "total_trades": 0, "total_wins": 0,
                "overall_win_rate": 0, "max_daily_loss": 0,
            },
        }
    return _engine.get_state()


# ── Test-login (credential check without starting the bot) ────────────────────

class LoginTest(BaseModel):
    email:    str
    password: str
    account_type: str = "PRACTICE"


@app.post("/api/bot/test-login")
async def test_login(req: LoginTest):
    """Quick credential check — does NOT start the trading engine."""
    from connection.iq_client import IQClient
    client = IQClient(req.email, req.password, req.account_type)
    loop   = asyncio.get_running_loop()
    ok, reason = await loop.run_in_executor(None, client.connect)
    if ok:
        balance = client.get_balance()
        client.disconnect()
        return {"status": "ok", "balance": balance,
                "message": f"Login successful! Balance: ${balance:.2f}"}
    raise HTTPException(status_code=401, detail=reason)


# ── Trade history ─────────────────────────────────────────────────────────────

@app.get("/api/trades")
async def get_trades(limit: int = 50, offset: int = 0,
                     asset: Optional[str] = None):
    return {
        "trades": DB.get_trades(limit=limit, offset=offset, asset=asset),
        "stats":  DB.get_trade_stats(),
    }


@app.get("/api/trades/today")
async def get_today_trades():
    return {"trades": DB.get_today_trades()}


@app.get("/api/trades/export")
async def export_trades(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    asset: Optional[str] = None,
    result: Optional[str] = None,
    strategy: Optional[str] = None,
):
    """Download trade history as CSV. Filters: start_date, end_date (YYYY-MM-DD), asset, result (win/loss/open), strategy."""
    csv_content = DB.export_trades_csv(
        start_date=start_date,
        end_date=end_date,
        asset=asset,
        result=result,
        strategy=strategy,
    )
    filename = f"binary_trader_report_{start_date or 'all'}_{end_date or 'now'}.csv"
    return StreamingResponse(
        iter([csv_content]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.delete("/api/trades")
async def clear_trade_history():
    """Delete all trade history. Returns count of deleted trades."""
    count = DB.delete_all_trades()
    return {"deleted": count, "message": f"Deleted {count} trade(s)"}


# ── Analytics ─────────────────────────────────────────────────────────────────

@app.get("/api/analytics/pnl")
async def get_pnl(days: int = 60):
    return {"pnl": DB.get_daily_pnl(days=days)}


@app.delete("/api/analytics/pnl/{date_str:path}")
async def delete_pnl(date_str: str):
    """Delete PnL record for a single date (YYYY-MM-DD)."""
    deleted = DB.delete_daily_pnl(date_str)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"No PnL record for date {date_str}")
    return {"deleted": True, "date": date_str}


@app.get("/api/analytics/strategies")
async def get_strategy_evals():
    return {"evaluations": DB.get_latest_evaluations()}


# ── News ──────────────────────────────────────────────────────────────────────

@app.get("/api/news")
async def get_news(asset: Optional[str] = None):
    if not _news:
        return {"articles": []}
    assets = [asset] if asset else (
        _engine.config.assets if _engine else ["EURUSD"]
    )
    loop     = asyncio.get_running_loop()
    articles = await loop.run_in_executor(None, _news.get_all_news, assets, 5)
    return {"articles": articles}


# ── Strategy analysis (chart data) ───────────────────────────────────────────

@app.get("/api/analysis")
async def get_analysis():
    if not _engine or not _engine._best_combo:
        return {"asset": None, "strategy": None, "win_rate": 0,
                "profit_factor": 0, "max_drawdown": 0, "total_trades": 0,
                "winning_trades": 0, "composite_score": 0,
                "candles": [], "signals": []}
    best = _engine._best_combo
    loop = asyncio.get_running_loop()
    raw  = await loop.run_in_executor(
        None, _engine.client.get_candles,
        best.asset, _engine.config.timeframe, 60, None,
    )
    from fetcher.data_fetcher import _raw_to_df
    candles_list = []
    if raw:
        df = _raw_to_df(raw)
        for _, row in df.iterrows():
            candles_list.append({
                "timestamp": row["timestamp"],
                "open":      row["open"],
                "high":      row["high"],
                "low":       row["low"],
                "close":     row["close"],
                "volume":    row["volume"],
                "datetime":  row["datetime"].isoformat()
                             if hasattr(row["datetime"], "isoformat")
                             else str(row["datetime"]),
            })
    signals = getattr(best, "signals", None) or []
    n_c = len(candles_list)
    n_s = len(signals)
    if n_c > n_s:
        signals = (["neutral"] * (n_c - n_s)) + list(signals)
    else:
        signals = list(signals[-n_c:]) if n_c else []
    return {
        "asset":           best.asset,
        "strategy":        best.strategy_name,
        "win_rate":        round(best.win_rate, 4),
        "profit_factor":   round(best.profit_factor, 4),
        "max_drawdown":    round(best.max_drawdown, 4),
        "total_trades":    best.total_trades,
        "winning_trades":  best.winning_trades,
        "losing_trades":   best.losing_trades,
        "composite_score": round(best.composite_score, 4),
        "candles":         candles_list,
        "signals":         signals,
    }


# ── AI strategy suggestions (OpenAI/Flexi) ─────────────────────────────────────

class StrategyAskRequest(BaseModel):
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    provider: Optional[str] = None
    model: Optional[str] = None


@app.post("/api/strategies/ask")
async def ask_strategy_suggestions(body: Optional[StrategyAskRequest] = None):
    """Ask LLM for new profitable strategies to test. Runs in parallel (non-blocking)."""
    from services.strategy_suggester import get_strategy_suggestions
    api_key = body.api_key if body and body.api_key else None
    base_url = body.base_url if body and body.base_url else None
    provider = body.provider if body and body.provider else None
    model = body.model if body and body.model else None
    existing = []
    try:
        from strategies import ALL_STRATEGIES
        existing = [getattr(s, "name", "") for s in ALL_STRATEGIES]
    except Exception:
        pass
    assets = all_assets_flat()[:20] if callable(all_assets_flat) else []
    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(
        None,
        lambda: get_strategy_suggestions(
            api_key=api_key,
            base_url=base_url,
            provider=provider,
            model=model,
            existing_strategies=existing,
            assets_hint=assets,
        ),
    )
    if result.get("error"):
        raise HTTPException(status_code=502, detail=result["error"])
    return result


# ── Suggestions (assets, strategies, evaluated combos) ─────────────────────────

@app.get("/api/suggestions")
async def get_suggestions(timeframe: Optional[int] = None):
    """Return available assets (filtered by timeframe), strategy names, and latest evaluations."""
    try:
        from strategies import ALL_STRATEGIES
        strategy_names = [getattr(s, "name", str(s.__class__.__name__)) for s in ALL_STRATEGIES]
    except Exception:
        strategy_names = []
    try:
        from config.assets import assets_for_timeframe, ASSET_GROUPS, all_assets_flat
        tf = timeframe if timeframe is not None else (getattr(_engine.config, "timeframe", 60) if _engine else 60)
        assets_flat = assets_for_timeframe(tf)
        # Build asset_groups from flat list for display (single group "Available" for this timeframe)
        asset_groups = [{"label": f"Timeframe {tf}s", "assets": assets_flat}] if assets_flat else []
        if not asset_groups and all_assets_flat:
            asset_groups = ASSET_GROUPS
            assets_flat = all_assets_flat()
    except Exception:
        from config.assets import ASSET_GROUPS, all_assets_flat
        assets_flat = all_assets_flat()
        asset_groups = ASSET_GROUPS
    try:
        evaluations = DB.get_latest_evaluations()
        suggestions = sorted(
            evaluations,
            key=lambda x: float(x.get("composite_score") or 0),
            reverse=True,
        )[:50]
    except Exception:
        suggestions = []
    return {
        "asset_groups": asset_groups,
        "assets": assets_flat,
        "strategies": strategy_names,
        "suggestions": suggestions,
        "timeframe": timeframe,
    }


@app.get("/api/assets/live")
async def get_live_assets(timeframe: int = 60):
    """
    Probe the broker for which assets are ACTUALLY open right now, across the full
    catalog (not just the ones currently configured on the bot). Requires an active,
    connected session — falls back to the static catalog (live=False) otherwise.
    """
    if not _engine or not _engine.client or not _engine.client.check_connect():
        return {
            "live": False,
            "reason": "Bot not connected — start the bot to probe live asset availability.",
            "asset_groups": ASSET_GROUPS,
        }

    loop = asyncio.get_running_loop()

    def _probe():
        groups = []
        for group in ASSET_GROUPS:
            open_assets = _engine.client.get_available_assets(group["assets"], timeframe=timeframe)
            groups.append({
                "label": group["label"],
                "assets": open_assets,
                "closed": [a for a in group["assets"] if a not in open_assets],
            })
        return groups

    asset_groups = await loop.run_in_executor(None, _probe)
    return {"live": True, "timeframe": timeframe, "asset_groups": asset_groups}


@app.post("/api/suggestions/pipeline")
async def run_suggestions_pipeline_endpoint():
    """Run the multi-agent suggestions pipeline (DataReviewer → Creator → Tester → Cleaner). Bot must be running."""
    if not _engine or getattr(_engine, "_status", None) != "running":
        raise HTTPException(status_code=400, detail="Bot must be running to execute the pipeline (needs live candle data).")
    from agents.suggestions_pipeline import run_suggestions_pipeline
    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(
        None,
        lambda: run_suggestions_pipeline(_engine.config, _engine, on_step=None),
    )
    return result


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "ok":      True,
        "engine":  _engine._status if _engine is not None else "idle",
        "clients": len(_clients),
    }


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=app_settings.HOST, port=app_settings.PORT, reload=False)
