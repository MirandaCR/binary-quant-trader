"use client";

import { useState, useCallback, useEffect } from "react";
import { useWebSocket } from "./useWebSocket";
import * as api from "@/lib/api";
import type {
  BotState, Trade, StrategyResult, DailyPnL,
  NewsArticle, WsMessage, BotConfig, LogMessage,
  AgentInfo, AgentActivityEntry,
} from "@/types";
import toast from "react-hot-toast";

const INITIAL_STATE: BotState = {
  status:      "idle",
  balance:     0,
  best_combo:  null,
  all_results: [],
  portfolio:   [],
  ml_scorer:   { ready: false, trained_on: 0 },
  ai_provider: null,
  open_trades: 0,
  risk: {
    daily_profit: 0, consecutive_losses: 0,
    total_trades: 0, total_wins: 0,
    overall_win_rate: 0, max_daily_loss: 0,
  },
};

export function useBot() {
  const [state, setState]     = useState<BotState>(INITIAL_STATE);
  const [trades, setTrades]   = useState<Trade[]>([]);
  const [pnl, setPnl]         = useState<DailyPnL[]>([]);
  const [news, setNews]       = useState<NewsArticle[]>([]);
  const [logs, setLogs]       = useState<LogMessage[]>([]);
  const [agentsState, setAgentsState] = useState<Record<string, AgentInfo>>({});
  const [agentActivityLog, setAgentActivityLog] = useState<AgentActivityEntry[]>([]);
  const [agentCycle, setAgentCycle] = useState<number>(0);
  const [tradeBlockedReason, setTradeBlockedReason] = useState<string | null>(null);
  const [riskWarning, setRiskWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastConfig, setLastConfig] = useState<BotConfig | null>(null);

  const pushLog = useCallback((level: LogMessage["level"], message: string) => {
    setLogs(prev => [
      { id: Date.now().toString(), timestamp: new Date().toISOString(), level, message },
      ...prev.slice(0, 149),
    ]);
  }, []);

  // ── Initial data load ───────────────────────────────────────────────────

  useEffect(() => {
    api.getBotStatus().then(setState).catch(() => {});
    api.getTrades(100).then(r => setTrades(r.trades)).catch(() => {});
    api.getPnL(90).then(r => setPnl(r.pnl)).catch(() => {});
    api.getNews().then(r => setNews(r.articles)).catch(() => {});
  }, []);

  // ── Periodic balance + trade refresh: server is source of truth so "Waiting" updates ───
  const mergeTrades = useCallback((prev: Trade[], r: { trades: Trade[] }) => {
    const serverById = new Map<string, Trade>();
    for (const t of r.trades) {
      const oid = t.order_id != null ? String(t.order_id) : null;
      if (oid) serverById.set(oid, t);
    }
    const merged = new Map<string, Trade>();
    for (const t of prev) {
      const oid = t.order_id != null ? String(t.order_id) : null;
      if (oid) merged.set(oid, serverById.get(oid) ?? t);
    }
    for (const t of r.trades) {
      const oid = t.order_id != null ? String(t.order_id) : null;
      if (oid && !merged.has(oid)) merged.set(oid, t);
    }
    return [...merged.values()].sort((a, b) =>
      new Date(b.opened_at).getTime() - new Date(a.opened_at).getTime()
    );
  }, []);

  useEffect(() => {
    const refresh = () => {
      api.getBotStatus()
        .then(s => setState(prev => ({
          ...prev,
          balance:     s.balance     ?? prev.balance,
          open_trades: s.open_trades ?? prev.open_trades,
          risk:        s.risk        ?? prev.risk,
          status:      s.status      ?? prev.status,
          portfolio:   (s as any).portfolio ?? prev.portfolio,
          ml_scorer:   (s as any).ml_scorer ?? prev.ml_scorer,
          ai_provider: (s as any).ai_provider ?? prev.ai_provider,
        })))
        .catch(() => {});
      api.getTrades(100)
        .then(r => setTrades(prev => mergeTrades(prev, r)))
        .catch(() => {});
    };
    refresh();
    const intervalMs = state.open_trades > 0 ? 1_000 : 8_000;
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [mergeTrades, state.open_trades]);

  // ── WebSocket handler ───────────────────────────────────────────────────

  const handleWsMessage = useCallback((msg: WsMessage) => {
    switch (msg.type) {
      case "state":
        setState({
          status:      (msg as any).status      ?? "idle",
          balance:     (msg as any).balance     ?? 0,
          best_combo:  (msg as any).best_combo  ?? null,
          all_results: (msg as any).all_results ?? [],
          portfolio:   (msg as any).portfolio   ?? [],
          ml_scorer:   (msg as any).ml_scorer   ?? INITIAL_STATE.ml_scorer,
          ai_provider: (msg as any).ai_provider ?? null,
          open_trades: (msg as any).open_trades ?? 0,
          risk:        (msg as any).risk        ?? INITIAL_STATE.risk,
        });
        break;

      case "status_change":
        setState(prev => ({ ...prev, status: msg.status }));
        break;

      case "trade_opened": {
        const newTrade: Trade = {
          ...msg.trade,
          win:            msg.trade.win            ?? null,
          profit:         msg.trade.profit         ?? null,
          close_price:    msg.trade.close_price    ?? null,
          closed_at:      msg.trade.closed_at      ?? null,
          balance_before: msg.trade.balance_before ?? msg.balance,
          balance_after:  msg.trade.balance_after  ?? null,
        };
        setState(prev => ({
          ...prev,
          balance:     msg.balance,
          open_trades: prev.open_trades + 1,
        }));
        setTrades(prev => [newTrade, ...prev.slice(0, 199)]);
        pushLog("trade", `▶ ${msg.trade.direction.toUpperCase()} ${msg.trade.asset}  $${msg.trade.amount?.toFixed(2)}  conf=${((msg.trade.confidence ?? 0) * 100).toFixed(0)}%`);
        toast.success(`${msg.trade.direction.toUpperCase()} ${msg.trade.asset}`, { icon: "📈" });
        break;
      }

      case "trade_closed": {
        const closedOrderId = msg.order_id != null ? String(msg.order_id) : "";
        setState(prev => ({
          ...prev,
          balance:     msg.balance,
          open_trades: Math.max(0, prev.open_trades - 1),
          risk:        msg.risk,
        }));
        setTrades(prev =>
          prev.map(t =>
            (t.order_id != null ? String(t.order_id) : "") === closedOrderId
              ? { ...t,
                  profit:        msg.profit,
                  win:           msg.win,
                  closed_at:     new Date().toISOString(),
                  balance_after: (msg as any).balance_after ?? msg.balance,
                }
              : t
          )
        );
        if (msg.win) {
          pushLog("success", `✅ WIN  +$${(msg.profit ?? 0).toFixed(2)}  |  Balance: $${msg.balance.toFixed(2)}`);
          toast.success(`WIN +$${(msg.profit ?? 0).toFixed(2)}`, { icon: "✅" });
        } else {
          pushLog("error", `❌ LOSS  -$${Math.abs(msg.profit ?? 0).toFixed(2)}  |  Balance: $${msg.balance.toFixed(2)}`);
          toast.error(`LOSS -$${Math.abs(msg.profit ?? 0).toFixed(2)}`, { icon: "❌" });
        }
        api.getPnL(90).then(r => setPnl(r.pnl)).catch(() => {});
        // Aggressive refetch so Trade History shows the server result as fast as possible
        const refetchTrades = () =>
          api.getTrades(100).then(r => setTrades(prev => mergeTrades(prev, r))).catch(() => {});
        refetchTrades();
        setTimeout(refetchTrades, 150);
        setTimeout(refetchTrades, 500);
        setTimeout(refetchTrades, 1500);
        break;
      }

      case "evaluation_update":
        setState(prev => ({
          ...prev,
          all_results: msg.results,
          best_combo:  msg.best,
          portfolio:   (msg as any).portfolio ?? prev.portfolio,
        }));
        if (msg.best) {
          pushLog("success", `🏆 Best: ${msg.best.strategy_name} / ${msg.best.asset}  WR=${((msg.best.win_rate ?? 0) * 100).toFixed(1)}%  score=${(msg.best.composite_score ?? 0).toFixed(3)}`);
        }
        break;

      case "risk_warning": {
        const warnMsg = (msg as any).message ?? "Risk limit reached";
        setRiskWarning(warnMsg);
        setState(prev => ({ ...prev, risk: (msg as any).risk ?? prev.risk }));
        // Show toast only if we haven't shown it very recently (avoid spam)
        pushLog("warning", `⚠ Risk warning (size ×0.5): ${warnMsg}`);
        toast(`⚠ Risk warning: ${warnMsg.split("|")[0].trim()}`, {
          icon: "⚠️",
          style: { background: "#1c1500", border: "1px solid #92400e", color: "#fbbf24" },
          duration: 6000,
        });
        break;
      }

      case "trade_blocked":
        setRiskWarning(null); // Clear soft warning when hard stop fires
        pushLog("warning", `⚠ Trade blocked: ${msg.reason}`);
        setTradeBlockedReason(msg.reason);
        toast(`Trade blocked: ${msg.reason}`, { icon: "⚠️" });
        break;

      case "log":
        pushLog((msg as any).level ?? "info", (msg as any).message ?? "");
        break;

      case "agent_orchestrator_update":
        setAgentsState(msg.agents);
        setAgentActivityLog(msg.activity_log ?? []);
        setAgentCycle(msg.cycle ?? 0);
        // Log important agent outputs
        if (msg.activity_log && msg.activity_log.length > 0) {
          const latest = msg.activity_log[0];
          if (latest && latest.message) {
            pushLog("info", `[${latest.agent}] ${latest.message}`);
          }
        }
        break;
    }
  }, [pushLog, mergeTrades]);

  useWebSocket(handleWsMessage);

  // ── Actions ─────────────────────────────────────────────────────────────

  const startBot = useCallback(async (config: BotConfig) => {
    if (loading) return;   // guard against accidental double-click
    setLoading(true);
    setLogs([]);  // clear console on new session
    pushLog("info", `Connecting to IQ Option as ${config.email}…`);
    pushLog("info", `Account: ${config.account_type}  |  Assets: ${config.assets.join(", ")}`);
    try {
      await api.startBot(config);
      setLastConfig(config);
      toast.success("Bot started!");
      setState(prev => ({ ...prev, status: "connecting" }));
    } catch (e: any) {
      pushLog("error", `Start failed: ${e.message}`);
      toast.error(e.message ?? "Failed to start bot");
    } finally {
      setLoading(false);
    }
  }, [loading, pushLog]);

  const stopBot = useCallback(async () => {
    setLoading(true);
    try {
      await api.stopBot();
      setState(prev => ({ ...prev, status: "stopped" }));
      setRiskWarning(null);
      toast("Bot stopped", { icon: "🛑" });
    } catch (e: any) {
      toast.error(e.message ?? "Failed to stop bot");
    } finally {
      setLoading(false);
    }
  }, []);

  const testLogin = useCallback(async (email: string, password: string) => {
    setLoading(true);
    try {
      const res = await api.testLogin(email, password);
      toast.success(res.message ?? "Login OK!");
    } catch (e: any) {
      toast.error(e.message ?? "Login test failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshNews = useCallback(() => {
    api.getNews().then(r => setNews(r.articles)).catch(() => {});
  }, []);

  const refreshPnl = useCallback(() => {
    api.getPnL(90).then(r => setPnl(r.pnl)).catch(() => {});
  }, []);

  const deletePnLDate = useCallback(async (dateStr: string) => {
    await api.deletePnLByDate(dateStr);
    await refreshPnl();
  }, [refreshPnl]);

  const clearHistory = useCallback(async () => {
    try {
      const res = await api.clearTradeHistory();
      setTrades([]);
      toast.success(res.message ?? "History cleared");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to clear history");
    }
  }, []);

  const overrideRisk = useCallback(async () => {
    try {
      await api.overrideRisk();
      toast.success("Consecutive losses reset — resuming on next candle.");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to override risk");
    }
  }, []);

  /** Clear ALL risk blocks (daily loss, consecutive, win-rate guard). */
  const resumeBot = useCallback(async () => {
    try {
      const res = await api.resumeBot();
      setRiskWarning(null);
      toast.success(res.message ?? "All blocks cleared — resuming on next candle.");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to resume bot");
    }
  }, []);

  /** Stop the bot then immediately restart it with the last used configuration. */
  const restartBot = useCallback(async () => {
    if (!lastConfig) {
      toast.error("No previous config found — please start the bot manually.");
      return;
    }
    setLoading(true);
    pushLog("info", "Restarting bot…");
    try {
      // Stop (ignore error if already stopped)
      try { await api.stopBot(); } catch { /* already stopped */ }
      setState(prev => ({ ...prev, status: "stopped" }));

      // Poll until backend confirms idle (up to 8 seconds)
      for (let i = 0; i < 8; i++) {
        await new Promise(r => setTimeout(r, 1000));
        try {
          const s = await api.getBotStatus();
          if (!s.status || s.status === "stopped" || s.status === "idle" || s.status === "error") break;
        } catch { break; }
      }

      await api.startBot(lastConfig);
      toast.success("Bot restarted!");
      pushLog("info", `Reconnected as ${lastConfig.email}  |  ${lastConfig.account_type}`);
    } catch (e: any) {
      pushLog("error", `Restart failed: ${e.message}`);
      toast.error(e.message ?? "Failed to restart bot");
    } finally {
      setLoading(false);
    }
  }, [lastConfig, pushLog]);

  return {
    state, trades, pnl, news, logs,
    agentsState, agentActivityLog, agentCycle,
    tradeBlockedReason, setTradeBlockedReason,
    riskWarning, setRiskWarning,
    loading, startBot, stopBot, restartBot, resumeBot,
    testLogin, refreshNews, refreshPnl, deletePnLDate, clearHistory, overrideRisk,
  };
}
