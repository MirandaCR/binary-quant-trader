"use client";

import { useState } from "react";
import type { Trade } from "@/types";
import { TrendingUp, TrendingDown, Clock, Trash2, Download, Filter } from "lucide-react";
import { cn, timeAgo, formatDateTime } from "@/lib/utils";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const API_URL = "http://localhost:8100";

interface Props {
  trades: Trade[];
  balance: number;
  onClearHistory?: () => void;
}

const n = (v: number | undefined | null, d = 2) => (v ?? 0).toFixed(d);

// ── Export panel ───────────────────────────────────────────────────────────────

function ExportPanel({ trades }: { trades: Trade[] }) {
  const [open, setOpen]         = useState(false);
  const [startDate, setStart]   = useState("");
  const [endDate, setEnd]       = useState("");
  const [asset, setAsset]       = useState("");
  const [result, setResult]     = useState("");
  const [strategy, setStrategy] = useState("");
  const [loading, setLoading]   = useState(false);

  // Unique values from loaded trades for filter suggestions
  const assets     = [...new Set(trades.map(t => t.asset))].sort();
  const strategies = [...new Set(trades.map(t => t.strategy_name).filter(Boolean))].sort();

  const download = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (startDate) params.set("start_date", startDate);
      if (endDate)   params.set("end_date", endDate);
      if (asset)     params.set("asset", asset);
      if (result)    params.set("result", result);
      if (strategy)  params.set("strategy", strategy);

      const res = await fetch(`${API_URL}/api/trades/export?${params}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `binary_trader_${startDate || "all"}_${endDate || "now"}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Export failed — is the backend running?");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-brand hover:bg-brand/10 border border-brand/30 transition-all"
      >
        <Download className="w-3 h-3" />
        Export CSV
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 w-72 bg-bg-surface border border-bg-border rounded-xl shadow-xl p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 mb-1">
            <Filter className="w-3.5 h-3.5 text-brand" />
            <span className="text-xs font-semibold text-gray-300">Export Filters</span>
            <button onClick={() => setOpen(false)} className="ml-auto text-gray-600 hover:text-gray-300 text-xs">✕</button>
          </div>

          {/* Date range */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-gray-600 uppercase tracking-wide">From</label>
              <input type="date" value={startDate} onChange={e => setStart(e.target.value)}
                className="w-full mt-0.5 bg-bg-raised border border-bg-border rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-brand/50" />
            </div>
            <div>
              <label className="text-[10px] text-gray-600 uppercase tracking-wide">To</label>
              <input type="date" value={endDate} onChange={e => setEnd(e.target.value)}
                className="w-full mt-0.5 bg-bg-raised border border-bg-border rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-brand/50" />
            </div>
          </div>

          {/* Asset */}
          <div>
            <label className="text-[10px] text-gray-600 uppercase tracking-wide">Asset</label>
            <select value={asset} onChange={e => setAsset(e.target.value)}
              className="w-full mt-0.5 bg-bg-raised border border-bg-border rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-brand/50">
              <option value="">All assets</option>
              {assets.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>

          {/* Result */}
          <div>
            <label className="text-[10px] text-gray-600 uppercase tracking-wide">Result</label>
            <select value={result} onChange={e => setResult(e.target.value)}
              className="w-full mt-0.5 bg-bg-raised border border-bg-border rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-brand/50">
              <option value="">All results</option>
              <option value="win">Wins only</option>
              <option value="loss">Losses only</option>
              <option value="open">Open only</option>
            </select>
          </div>

          {/* Strategy */}
          <div>
            <label className="text-[10px] text-gray-600 uppercase tracking-wide">Strategy</label>
            <select value={strategy} onChange={e => setStrategy(e.target.value)}
              className="w-full mt-0.5 bg-bg-raised border border-bg-border rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-brand/50">
              <option value="">All strategies</option>
              {strategies.map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
            </select>
          </div>

          <button
            onClick={download}
            disabled={loading}
            className="w-full py-2 rounded-lg bg-brand/20 text-brand text-xs font-medium hover:bg-brand/30 transition-all inline-flex items-center justify-center gap-1.5 border border-brand/30"
          >
            {loading
              ? <><span className="w-3 h-3 border-2 border-brand border-t-transparent rounded-full animate-spin" /> Generating…</>
              : <><Download className="w-3 h-3" /> Download CSV</>
            }
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function TradeHistory({ trades, balance, onClearHistory }: Props) {
  const [filter, setFilter] = useState<"all" | "win" | "loss" | "open">("all");

  const filtered = trades.filter(t => {
    if (filter === "win")  return t.win === true;
    if (filter === "loss") return t.win === false;
    if (filter === "open") return t.win == null;
    return true;
  });

  // Equity curve from closed trades
  const closedTrades = [...trades]
    .filter(t => t.win != null && t.profit != null)
    .sort((a, b) => new Date(a.opened_at).getTime() - new Date(b.opened_at).getTime());

  let cumPnL = 0;
  const pnlCurve = closedTrades.map(t => {
    cumPnL += t.profit ?? 0;
    return {
      x:   new Date(t.opened_at).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" }),
      pnl: parseFloat(n(cumPnL)),
    };
  });

  const wins   = closedTrades.filter(t => t.win).length;
  const losses = closedTrades.filter(t => !t.win).length;
  const wr     = closedTrades.length > 0 ? wins / closedTrades.length : 0;
  const open   = trades.filter(t => t.win == null).length;
  const totalProfit = closedTrades.reduce((s, t) => s + (t.profit ?? 0), 0);

  return (
    <div className="flex flex-col gap-4">

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {[
          { label: "Balance",     value: balance > 0 ? `$${n(balance)}` : "—",                          color: "text-brand" },
          { label: "Session P&L", value: `${totalProfit >= 0 ? "+" : ""}$${n(totalProfit)}`,             color: totalProfit >= 0 ? "text-profit" : "text-loss" },
          { label: "Win Rate",    value: closedTrades.length > 0 ? `${(wr * 100).toFixed(1)}%` : "—",    color: wr >= 0.55 ? "text-profit" : wr > 0 ? "text-loss" : "text-gray-500" },
          { label: "W / L",       value: `${wins} / ${losses}`,                                          color: wins > losses ? "text-profit" : wins < losses ? "text-loss" : "text-gray-400" },
          { label: "Open",        value: `${open} trade${open !== 1 ? "s" : ""}`,                        color: open > 0 ? "text-neutral" : "text-gray-600" },
        ].map(s => (
          <div key={s.label} className="bg-bg-surface border border-bg-border rounded-lg px-3 py-2">
            <p className="text-[10px] text-gray-600 uppercase tracking-wide">{s.label}</p>
            <p className={cn("text-sm font-mono font-bold", s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Equity curve */}
      {pnlCurve.length > 1 && (
        <div className="bg-bg-surface border border-bg-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-gray-400">Equity Curve ({closedTrades.length} trades)</span>
            <span className={cn("text-sm font-mono font-bold", totalProfit >= 0 ? "text-profit" : "text-loss")}>
              {totalProfit >= 0 ? "+" : ""}${n(totalProfit)}
            </span>
          </div>
          <ResponsiveContainer width="100%" height={100}>
            <AreaChart data={pnlCurve} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={totalProfit >= 0 ? "#10b981" : "#ef4444"} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={totalProfit >= 0 ? "#10b981" : "#ef4444"} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="x" hide />
              <YAxis hide />
              <Tooltip
                contentStyle={{ background: "#111827", border: "1px solid #1f2937", borderRadius: 8, fontSize: 11 }}
                formatter={(v: number) => [`$${(v ?? 0).toFixed(2)}`, "Cumulative P&L"]}
              />
              <Area type="monotone" dataKey="pnl"
                stroke={totalProfit >= 0 ? "#10b981" : "#ef4444"}
                strokeWidth={2} fill="url(#pnlGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Trade table */}
      <div className="bg-bg-surface border border-bg-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-bg-border flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-300">Trade History</span>
            <span className="text-xs text-gray-600">{trades.length} total</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Export CSV */}
            <ExportPanel trades={trades} />

            {onClearHistory && (
              <button
                onClick={onClearHistory}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-loss hover:bg-loss/20 border border-loss/30 transition-all"
              >
                <Trash2 className="w-3 h-3" />
                Delete
              </button>
            )}
            <div className="flex gap-1">
              {(["all", "win", "loss", "open"] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className={cn(
                    "px-2.5 py-1 rounded-md text-xs font-medium capitalize transition-all",
                    filter === f
                      ? f === "win"  ? "bg-profit/20 text-profit border border-profit/30"
                      : f === "loss" ? "bg-loss/20   text-loss   border border-loss/30"
                      : f === "open" ? "bg-brand/20  text-brand  border border-brand/30"
                      :                "bg-bg-raised  text-gray-300 border border-bg-border"
                      : "text-gray-500 hover:text-gray-300"
                  )}>
                  {f}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Asset</th>
                <th>Dir.</th>
                <th>Strategy</th>
                <th>Conf.</th>
                <th>Amount</th>
                <th>Profit</th>
                <th>Result</th>
                <th>Balance after</th>
                <th>Opened</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-8 text-gray-600 text-sm">
                    No trades yet
                  </td>
                </tr>
              ) : (
                filtered.slice(0, 100).map((t, i) => (
                  <TradeRow key={`${t.order_id ?? t.id ?? i}-${t.win}`}
                            trade={t} index={filtered.length - i} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Single trade row ───────────────────────────────────────────────────────────

function TradeRow({ trade: t, index }: { trade: Trade; index: number }) {
  const isOpen         = t.win == null;
  const displayBalance = t.balance_after ?? (isOpen ? t.balance_before : null) ?? null;

  return (
    <tr className={cn(
      "transition-colors",
      isOpen          && "bg-brand/5",
      t.win === true  && "bg-profit/5",
      t.win === false && "bg-loss/5",
    )}>
      <td className="text-gray-600 font-mono text-xs">{index}</td>

      <td className="font-mono text-xs font-medium text-white">{t.asset}</td>

      <td>
        <span className={cn(
          "inline-flex items-center gap-1 text-xs font-medium",
          t.direction === "call" ? "text-profit" : "text-loss"
        )}>
          {t.direction === "call"
            ? <TrendingUp className="w-3 h-3" />
            : <TrendingDown className="w-3 h-3" />}
          {(t.direction ?? "").toUpperCase()}
        </span>
      </td>

      <td className="text-xs text-gray-400 max-w-24 truncate" title={t.strategy_name}>
        {(t.strategy_name ?? "").replace(/_/g, " ")}
      </td>

      <td className="font-mono text-xs text-gray-500">
        <div>{n((t.confidence ?? 0) * 100, 0)}%</div>
        {t.ml_score != null && (
          <div
            className={cn(
              "text-[9px] leading-tight",
              t.ml_score >= 0.55 ? "text-profit/80" : "text-loss/80"
            )}
            title={`ML win-probability estimate for this trade${
              t.raw_confidence != null
                ? ` (strategy said ${n(t.raw_confidence * 100, 0)}%, blended to ${n((t.confidence ?? 0) * 100, 0)}%)`
                : ""
            }`}
          >
            ML {n(t.ml_score * 100, 0)}%
          </div>
        )}
      </td>

      <td className="font-mono text-xs text-gray-300">${n(t.amount)}</td>

      {/* Profit */}
      <td className={cn(
        "font-mono text-xs font-semibold",
        t.profit == null  ? "text-gray-600"
        : t.profit > 0    ? "text-profit"
        : "text-loss"
      )}>
        {t.profit == null
          ? <span className="text-gray-700 italic text-[10px] font-normal">—</span>
          : `${t.profit > 0 ? "+" : ""}$${n(t.profit)}`
        }
      </td>

      {/* Result badge */}
      <td>
        {isOpen ? (
          <span className="inline-flex items-center gap-1 text-xs text-neutral">
            <Clock className="w-3 h-3 animate-pulse" />
            <span className="text-[10px]">Waiting</span>
          </span>
        ) : t.win ? (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-profit/20 text-profit text-xs font-bold border border-profit/20">
            ✓ WIN
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-loss/20 text-loss text-xs font-bold border border-loss/20">
            ✗ LOSS
          </span>
        )}
      </td>

      {/* Balance after trade */}
      <td className="font-mono text-xs">
        {displayBalance != null ? (
          <span className={cn(
            "font-semibold",
            isOpen    ? "text-gray-500"
            : t.win   ? "text-profit"
            : "text-loss"
          )}>
            ${n(displayBalance)}
          </span>
        ) : (
          <span className="text-gray-700 text-[10px]">—</span>
        )}
      </td>

      {/* Time */}
      <td className="text-xs text-gray-600 font-mono whitespace-nowrap">
        {timeAgo(t.opened_at)}
      </td>
    </tr>
  );
}
