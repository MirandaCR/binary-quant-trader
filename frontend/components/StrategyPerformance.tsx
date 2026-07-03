"use client";

import { useState, useMemo } from "react";
import type { StrategyResult } from "@/types";
import {
  Trophy, BarChart2, BookOpen, Search, ChevronDown, ChevronUp,
  Copy, Check, Filter, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, BarChart, Bar, RadarChart,
  Radar, PolarGrid, PolarAngleAxis, ReferenceLine,
} from "recharts";
import {
  STRATEGY_CATALOG, CATEGORY_COLORS, RISK_COLORS, FREQ_COLORS,
  findCatalogEntry, type StrategyCategory, type StrategyCatalogEntry,
} from "@/lib/strategy-catalog";

interface Props {
  results: StrategyResult[];
  best: StrategyResult | null;
}

const n = (v: number | undefined | null, d = 2) => (v ?? 0).toFixed(d);

// ── Palette for chart dots ────────────────────────────────────────────────────
const PALETTE = ["#b026ff","#10b981","#f59e0b","#3b82f6","#ef4444",
                 "#06b6d4","#a78bfa","#34d399","#fbbf24","#60a5fa","#f87171"];

function dotColor(i: number) { return PALETTE[i % PALETTE.length]; }

// ─────────────────────────────────────────────────────────────────────────────
// RANKINGS TAB
// ─────────────────────────────────────────────────────────────────────────────

type SortKey = "composite_score" | "win_rate" | "profit_factor" | "max_drawdown" | "total_trades";
type SortDir = "asc" | "desc";

function RankingsTab({ results, best }: { results: StrategyResult[]; best: StrategyResult | null }) {
  const [filterStrategy, setFilterStrategy] = useState("");
  const [filterAsset,    setFilterAsset]    = useState("");
  const [minWR,          setMinWR]          = useState(0);
  const [minPF,          setMinPF]          = useState(0);
  const [maxDD,          setMaxDD]          = useState(100);
  const [sortKey,        setSortKey]        = useState<SortKey>("composite_score");
  const [sortDir,        setSortDir]        = useState<SortDir>("desc");
  const [showFilters,    setShowFilters]    = useState(false);

  const strategies = useMemo(() => [...new Set(results.map(r => r.strategy_name).filter(Boolean))].sort(), [results]);
  const assets     = useMemo(() => [...new Set(results.map(r => r.asset).filter(Boolean))].sort(), [results]);

  const filtered = useMemo(() => {
    let r = results;
    if (filterStrategy) r = r.filter(x => x.strategy_name === filterStrategy);
    if (filterAsset)    r = r.filter(x => x.asset === filterAsset);
    if (minWR > 0)      r = r.filter(x => (x.win_rate ?? 0) * 100 >= minWR);
    if (minPF > 0)      r = r.filter(x => (x.profit_factor ?? 0) >= minPF);
    if (maxDD < 100)    r = r.filter(x => (x.max_drawdown ?? 0) * 100 <= maxDD);
    return [...r].sort((a, b) => {
      const va = (a[sortKey] ?? 0) as number;
      const vb = (b[sortKey] ?? 0) as number;
      return sortDir === "desc" ? vb - va : va - vb;
    });
  }, [results, filterStrategy, filterAsset, minWR, minPF, maxDD, sortKey, sortDir]);

  const clearFilters = () => {
    setFilterStrategy(""); setFilterAsset(""); setMinWR(0); setMinPF(0); setMaxDD(100);
  };

  const hasFilters = filterStrategy || filterAsset || minWR > 0 || minPF > 0 || maxDD < 100;

  // Chart data — scatter win rate vs profit factor
  const scatterData = useMemo(() => filtered.slice(0, 40).map((r, i) => {
    const wr = typeof r.win_rate === "number" ? r.win_rate : parseFloat(String(r.win_rate ?? 0));
    const pf = typeof r.profit_factor === "number" ? r.profit_factor : parseFloat(String(r.profit_factor ?? 0));
    const sc = typeof r.composite_score === "number" ? r.composite_score : parseFloat(String(r.composite_score ?? 0));
    return {
      x:      Math.round(wr * 1000) / 10,           // WR as % e.g. 0.79 → 79.0
      y:      Math.round(Math.min(pf, 8) * 1000) / 1000, // PF e.g. 1.234 (keep 3dp)
      z:      Math.max(50, Math.round(sc * 500)),    // bubble area for ZAxis
      name:   `${r.strategy_name} / ${r.asset?.replace("-OTC", "")}`,
      wr:     `${(wr * 100).toFixed(1)}%`,
      pf:     pf.toFixed(3),
      sc:     sc.toFixed(4),
      trades: r.total_trades ?? 0,
      i,
      isBest: best?.strategy_name === r.strategy_name && best?.asset === r.asset,
    };
  }), [filtered, best]);

  // Explicit axis domains computed from the data to avoid Recharts "auto" quirks
  const scatterXMax = useMemo(() =>
    Math.max(100, ...scatterData.map(d => d.x + 5)), [scatterData]);
  const scatterYMax = useMemo(() => {
    const maxPF = scatterData.reduce((m, d) => Math.max(m, d.y), 0);
    return parseFloat(Math.max(2, maxPF * 1.25).toFixed(2)); // at least 0–2 range
  }, [scatterData]);

  // Bar chart top 10 by composite score
  const barData = filtered.slice(0, 10).map(r => ({
    name:  `${(r.strategy_name ?? "").substring(0,10)}`,
    asset: (r.asset ?? "").replace("-OTC",""),
    score: parseFloat(n((r.composite_score ?? 0) * 100, 1)),
    wr:    parseFloat(n((r.win_rate ?? 0) * 100, 1)),
    full:  r.strategy_name ?? "",
  }));

  // Radar for best
  const radarData = best ? [
    { m: "Win Rate",    v: parseFloat(n((best.win_rate ?? 0) * 100, 1)) },
    { m: "Profit F.",  v: parseFloat(n(Math.min((best.profit_factor ?? 0) * 33, 100), 1)) },
    { m: "Score",      v: parseFloat(n((best.composite_score ?? 0) * 100, 1)) },
    { m: "Low DD",     v: parseFloat(n((1 - (best.max_drawdown ?? 0)) * 100, 1)) },
    { m: "Activity",   v: Math.min((best.total_trades ?? 0) * 2, 100) },
  ] : [];

  const sortBtn = (key: SortKey, label: string) => (
    <button
      onClick={() => { if (sortKey === key) setSortDir(d => d === "desc" ? "asc" : "desc"); else { setSortKey(key); setSortDir("desc"); } }}
      className={cn("flex items-center gap-0.5 hover:text-white transition-colors", sortKey === key ? "text-brand" : "text-gray-500")}
    >
      {label}
      {sortKey === key ? (sortDir === "desc" ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />) : null}
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Best combo card */}
      {best && (
        <div className="bg-bg-surface border border-brand/30 rounded-xl p-4 shadow-glow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Trophy className="w-4 h-4 text-brand" />
            <span className="text-sm font-semibold text-brand">Active Best Strategy</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { l: "Strategy",   v: best.strategy_name ?? "—",                         c: "text-white" },
              { l: "Asset",      v: best.asset ?? "—",                                  c: "text-brand" },
              { l: "Win Rate",   v: `${n(best.win_rate * 100, 1)}%`,                    c: (best.win_rate ?? 0) >= 0.55 ? "text-profit" : "text-loss" },
              { l: "Score",      v: n(best.composite_score, 4),                         c: "text-gray-300" },
              { l: "Profit Fct", v: n(best.profit_factor, 2),                           c: "text-gray-300" },
              { l: "Max DD",     v: `${n((best.max_drawdown ?? 0) * 100, 1)}%`,         c: "text-loss" },
              { l: "Backtest",   v: `${best.total_trades ?? 0} trades`,                c: "text-gray-400" },
              { l: "Wins",       v: `${best.winning_trades ?? 0} / ${best.total_trades ?? 0}`, c: "text-profit" },
            ].map(c => (
              <div key={c.l} className="bg-bg-raised rounded-lg px-3 py-2">
                <p className="text-[10px] text-gray-600 uppercase tracking-wide">{c.l}</p>
                <p className={cn("text-sm font-mono font-semibold truncate", c.c)}>{c.v}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Scatter: WR vs PF */}
        <div className="lg:col-span-2 bg-bg-surface border border-bg-border rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-400 mb-1">
            Win Rate vs Profit Factor{" "}
            <span className="text-gray-700 font-normal">(bubble size = composite score)</span>
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <ScatterChart margin={{ top: 12, right: 20, bottom: 28, left: 10 }}>
              <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
              <XAxis
                type="number" dataKey="x" name="Win Rate %"
                domain={[0, 100]}
                tickCount={6}
                tickFormatter={v => `${v}%`}
                tick={{ fontSize: 10, fill: "#6b7280" }}
                label={{ value: "Win Rate %", position: "insideBottom", offset: -12, fill: "#6b7280", fontSize: 10 }}
              />
              <YAxis
                type="number" dataKey="y" name="Profit Factor"
                domain={[0, scatterYMax]}
                tickCount={6}
                tickFormatter={v => Number(v).toFixed(2)}
                tick={{ fontSize: 10, fill: "#6b7280" }}
                label={{ value: "Profit Factor", angle: -90, position: "insideLeft", offset: 10, fill: "#6b7280", fontSize: 10 }}
              />
              {/* ZAxis controls bubble size; no dataKey on Scatter */}
              <ZAxis dataKey="z" range={[30, 350]} />
              {/* Reference lines: min win-rate threshold (55%) and PF = 1 break-even */}
              <ReferenceLine x={55} stroke="#f59e0b" strokeDasharray="4 2" strokeOpacity={0.5}
                label={{ value: "Min WR", position: "top", fill: "#f59e0b", fontSize: 9 }} />
              <ReferenceLine y={1} stroke="#6b7280" strokeDasharray="4 2" strokeOpacity={0.5}
                label={{ value: "BE", position: "right", fill: "#6b7280", fontSize: 9 }} />
              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                content={({ payload }) => {
                  if (!payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="bg-gray-900 border border-gray-700 rounded-lg p-2 text-xs shadow-lg">
                      <p className="text-white font-semibold mb-1">{d.name}</p>
                      <p className="text-gray-400">Win Rate: <span className="text-emerald-400 font-mono">{d.wr}</span></p>
                      <p className="text-gray-400">Prof. Factor: <span className="text-brand font-mono">{d.pf}</span></p>
                      <p className="text-gray-400">Score: <span className="text-yellow-400 font-mono">{d.sc}</span></p>
                      <p className="text-gray-400">Trades: <span className="text-gray-300 font-mono">{d.trades}</span></p>
                    </div>
                  );
                }}
              />
              <Scatter data={scatterData}>
                {scatterData.map((d, i) => (
                  <Cell
                    key={i}
                    fill={d.isBest ? "#b026ff" : dotColor(d.i)}
                    opacity={d.isBest ? 1 : 0.75}
                    stroke={d.isBest ? "#e040ff" : "none"}
                    strokeWidth={d.isBest ? 2 : 0}
                  />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
          {scatterData.length === 0 && (
            <p className="text-center text-gray-700 text-xs -mt-10">Run the bot to populate strategy data</p>
          )}
        </div>

        {/* Radar for best */}
        {radarData.length > 0 ? (
          <div className="bg-bg-surface border border-bg-border rounded-xl p-4">
            <p className="text-xs font-semibold text-gray-400 mb-1">Best Strategy Profile</p>
            <ResponsiveContainer width="100%" height={200}>
              <RadarChart data={radarData} margin={{ top: 10, right: 20, bottom: 10, left: 20 }}>
                <PolarGrid stroke="#1f2937" />
                <PolarAngleAxis dataKey="m" tick={{ fontSize: 9, fill: "#9ca3af" }} />
                <Radar dataKey="v" stroke="#b026ff" fill="#b026ff" fillOpacity={0.15} strokeWidth={2} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="bg-bg-surface border border-bg-border rounded-xl p-4 flex items-center justify-center">
            <p className="text-gray-700 text-xs">Start bot for profile chart</p>
          </div>
        )}
      </div>

      {/* Top 10 bar */}
      {barData.length > 0 && (
        <div className="bg-bg-surface border border-bg-border rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-400 mb-3">Top 10 — Composite Score</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={barData} layout="vertical" margin={{ left: 0, right: 24, top: 0, bottom: 0 }}>
              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: "#6b7280" }} />
              <YAxis dataKey="name" type="category" tick={{ fontSize: 9, fill: "#9ca3af" }} width={90} />
              <Tooltip
                contentStyle={{ background: "#111827", border: "1px solid #1f2937", fontSize: 11 }}
                formatter={(v: number, _: string, p: any) => [
                  `${v}% score | WR ${p.payload.wr}%`,
                  `${p.payload.full} / ${p.payload.asset}`,
                ]}
              />
              <Bar dataKey="score" radius={[0, 4, 4, 0]}>
                {barData.map((_, i) => <Cell key={i} fill={dotColor(i)} opacity={0.8} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Filter bar */}
      <div className="bg-bg-surface border border-bg-border rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-bg-border flex-wrap">
          <button
            onClick={() => setShowFilters(f => !f)}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors"
          >
            <Filter className="w-3.5 h-3.5" />
            Filters
            {hasFilters && <span className="w-1.5 h-1.5 rounded-full bg-brand" />}
          </button>
          <span className="text-gray-700 text-xs ml-auto">{filtered.length} / {results.length} results</span>
          {hasFilters && (
            <button onClick={clearFilters} className="text-[10px] text-gray-600 hover:text-loss flex items-center gap-0.5">
              <X className="w-3 h-3" /> Clear
            </button>
          )}
        </div>

        {showFilters && (
          <div className="px-4 py-3 border-b border-bg-border flex flex-wrap gap-3">
            <select value={filterStrategy} onChange={e => setFilterStrategy(e.target.value)}
              className="bg-bg-raised border border-bg-border rounded px-2 py-1 text-xs text-white min-w-[140px] focus:outline-none focus:border-brand/50">
              <option value="">All strategies</option>
              {strategies.map(s => <option key={s} value={s}>{s.replace(/_/g," ")}</option>)}
            </select>
            <select value={filterAsset} onChange={e => setFilterAsset(e.target.value)}
              className="bg-bg-raised border border-bg-border rounded px-2 py-1 text-xs text-white min-w-[120px] focus:outline-none focus:border-brand/50">
              <option value="">All assets</option>
              {assets.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] text-gray-600">Min WR%</label>
              <input type="number" value={minWR} onChange={e => setMinWR(Number(e.target.value))}
                min={0} max={100} step={5}
                className="w-14 bg-bg-raised border border-bg-border rounded px-1.5 py-1 text-xs text-white text-right focus:outline-none focus:border-brand/50" />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] text-gray-600">Min PF</label>
              <input type="number" value={minPF} onChange={e => setMinPF(Number(e.target.value))}
                min={0} max={5} step={0.1}
                className="w-14 bg-bg-raised border border-bg-border rounded px-1.5 py-1 text-xs text-white text-right focus:outline-none focus:border-brand/50" />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] text-gray-600">Max DD%</label>
              <input type="number" value={maxDD} onChange={e => setMaxDD(Number(e.target.value))}
                min={0} max={100} step={5}
                className="w-14 bg-bg-raised border border-bg-border rounded px-1.5 py-1 text-xs text-white text-right focus:outline-none focus:border-brand/50" />
            </div>
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Strategy</th>
                <th>Asset</th>
                <th className="cursor-pointer">{sortBtn("win_rate", "Win Rate")}</th>
                <th className="cursor-pointer">{sortBtn("profit_factor", "Prof. Fct")}</th>
                <th className="cursor-pointer">{sortBtn("max_drawdown", "Max DD")}</th>
                <th className="cursor-pointer">{sortBtn("total_trades", "Trades")}</th>
                <th>W / L</th>
                <th className="cursor-pointer">{sortBtn("composite_score", "Score")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-8 text-gray-600 text-sm">No results match filters</td></tr>
              ) : (
                filtered.map((r, i) => {
                  const isBest = best?.strategy_name === r.strategy_name && best?.asset === r.asset;
                  return (
                    <tr key={`${r.strategy_name}-${r.asset}-${i}`}
                        className={cn("transition-colors", isBest && "bg-brand/5")}>
                      <td className="text-gray-500 text-xs font-mono">#{i+1}</td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          {isBest && <Trophy className="w-3 h-3 text-brand shrink-0" />}
                          <span className="text-xs font-medium text-gray-300">{r.strategy_name}</span>
                        </div>
                      </td>
                      <td className="text-xs font-mono text-gray-400">{r.asset}</td>
                      <td className={cn("text-xs font-mono font-semibold",
                        (r.win_rate ?? 0) >= 0.55 ? "text-profit" : "text-loss")}>
                        {n((r.win_rate ?? 0)*100,1)}%
                      </td>
                      <td className={cn("text-xs font-mono",
                        (r.profit_factor ?? 0) >= 1 ? "text-profit" : "text-loss")}>
                        {n(r.profit_factor, 2)}
                      </td>
                      <td className="text-xs font-mono text-loss">{n((r.max_drawdown ?? 0)*100,1)}%</td>
                      <td className="text-xs font-mono text-gray-400">{r.total_trades ?? 0}</td>
                      <td className="text-xs font-mono">
                        <span className="text-profit">{r.winning_trades ?? 0}</span>
                        <span className="text-gray-700 mx-0.5">/</span>
                        <span className="text-loss">{r.losing_trades ?? 0}</span>
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-bg-border rounded-full overflow-hidden max-w-12">
                            <div className="h-full rounded-full bg-brand"
                              style={{ width: `${(r.composite_score ?? 0)*100}%` }} />
                          </div>
                          <span className="text-xs font-mono text-brand">{n(r.composite_score, 3)}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CATALOG TAB
// ─────────────────────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button onClick={copy}
      className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] border border-bg-border hover:border-brand/40 text-gray-500 hover:text-brand transition-all">
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function CatalogCard({
  entry,
  liveResult,
}: {
  entry: StrategyCatalogEntry;
  liveResult?: StrategyResult;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showScript, setShowScript] = useState(false);

  const catClass = CATEGORY_COLORS[entry.category] ?? "text-gray-400 bg-gray-800 border-gray-700";

  return (
    <div className={cn(
      "bg-bg-surface border border-bg-border rounded-xl overflow-hidden transition-all",
      expanded && "border-brand/20"
    )}>
      {/* Header */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-start justify-between p-4 text-left hover:bg-bg-raised transition-colors gap-3"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-sm font-semibold text-white">{entry.displayName}</span>
            <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full border uppercase tracking-wider", catClass)}>
              {entry.category}
            </span>
            {liveResult && (
              <span className={cn("text-[10px] font-mono px-1.5 py-0.5 rounded border",
                (liveResult.win_rate ?? 0) >= 0.55
                  ? "text-profit border-profit/30 bg-profit/10"
                  : "text-loss border-loss/30 bg-loss/10")}>
                WR {n((liveResult.win_rate ?? 0)*100,1)}% live
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 line-clamp-2">{entry.description}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="hidden sm:flex flex-col items-end gap-1">
            <span className={cn("text-[10px]", RISK_COLORS[entry.riskLevel])}>Risk: {entry.riskLevel}</span>
            <span className={cn("text-[10px]", FREQ_COLORS[entry.signalFrequency])}>Freq: {entry.signalFrequency}</span>
          </div>
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 flex flex-col gap-3 border-t border-bg-border">

          {/* Details grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3">
            <div>
              <p className="text-[10px] text-gray-600 uppercase tracking-wide mb-1">Indicators</p>
              <div className="flex flex-wrap gap-1">
                {entry.indicators.map(ind => (
                  <span key={ind} className="text-[10px] px-1.5 py-0.5 rounded bg-bg-raised border border-bg-border text-gray-400">{ind}</span>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] text-gray-600 uppercase tracking-wide mb-1">Best Timeframes</p>
              <div className="flex flex-wrap gap-1">
                {entry.bestTimeframes.map(tf => (
                  <span key={tf} className="text-[10px] px-1.5 py-0.5 rounded bg-brand/10 border border-brand/20 text-brand">{tf}</span>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] text-gray-600 uppercase tracking-wide mb-1">Signal Freq.</p>
              <span className={cn("text-xs font-semibold", FREQ_COLORS[entry.signalFrequency])}>{entry.signalFrequency}</span>
            </div>
            <div>
              <p className="text-[10px] text-gray-600 uppercase tracking-wide mb-1">Risk Level</p>
              <span className={cn("text-xs font-semibold", RISK_COLORS[entry.riskLevel])}>{entry.riskLevel}</span>
            </div>
          </div>

          {/* How it works */}
          <div className="bg-bg-raised rounded-lg p-3">
            <p className="text-[10px] text-gray-600 uppercase tracking-wide mb-1">How It Works</p>
            <p className="text-xs text-gray-400 leading-relaxed">{entry.howItWorks}</p>
          </div>

          {/* Live backtest stats if available */}
          {liveResult && (
            <div className="grid grid-cols-4 gap-2">
              {[
                { l: "Win Rate",   v: `${n((liveResult.win_rate??0)*100,1)}%`,    c: (liveResult.win_rate??0)>=0.55?"text-profit":"text-loss" },
                { l: "Prof. Fct.", v: n(liveResult.profit_factor,2),               c: (liveResult.profit_factor??0)>=1?"text-profit":"text-loss" },
                { l: "Max DD",     v: `${n((liveResult.max_drawdown??0)*100,1)}%`, c: "text-loss" },
                { l: "Score",      v: n(liveResult.composite_score,4),             c: "text-brand" },
              ].map(s => (
                <div key={s.l} className="bg-bg-base rounded px-2 py-1.5 text-center">
                  <p className="text-[9px] text-gray-700">{s.l}</p>
                  <p className={cn("text-xs font-mono font-bold", s.c)}>{s.v}</p>
                </div>
              ))}
            </div>
          )}

          {/* Python script toggle */}
          <div>
            <button
              onClick={() => setShowScript(s => !s)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-raised border border-bg-border text-xs text-gray-300 hover:border-brand/40 hover:text-brand transition-all"
            >
              <BookOpen className="w-3.5 h-3.5" />
              {showScript ? "Hide Python Script" : "View Automation Script (Python)"}
            </button>

            {showScript && (
              <div className="mt-2 relative">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-gray-600 font-mono">Python — requires: pip install iqoptionapi pandas numpy</span>
                  <CopyButton text={entry.script} />
                </div>
                <pre className="bg-black rounded-xl p-4 text-[11px] text-gray-300 font-mono overflow-x-auto max-h-[420px] overflow-y-auto leading-relaxed border border-bg-border whitespace-pre">
                  {entry.script}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CatalogTab({ results }: { results: StrategyResult[] }) {
  const [search,   setSearch]   = useState("");
  const [catFilter, setCat]     = useState<StrategyCategory | "">("");

  const categories: StrategyCategory[] = ["Reversal","Trend","Breakout","Pattern","Statistical","AI Generated"];

  // Build live result map (best score per strategy)
  const liveMap = useMemo(() => {
    const m: Record<string, StrategyResult> = {};
    for (const r of results) {
      const key = r.strategy_name ?? "";
      if (!m[key] || (r.composite_score ?? 0) > (m[key].composite_score ?? 0)) m[key] = r;
    }
    return m;
  }, [results]);

  // Get AI-generated entries from live results not in catalog
  const aiEntries = useMemo(() => {
    const catalogIds = new Set(STRATEGY_CATALOG.map(e => e.id));
    return [...new Set(results.map(r => r.strategy_name).filter(n => n && !catalogIds.has(n)))];
  }, [results]);

  const allEntries = [
    ...STRATEGY_CATALOG,
    ...aiEntries.map(name => ({
      id: name ?? "",
      displayName: (name ?? "").replace(/_/g, " "),
      category: "AI Generated" as StrategyCategory,
      description: "Dynamically generated strategy created by the AI Research Agent based on live market analysis.",
      howItWorks: "This strategy was autonomously designed by the ResearchAgent using LLM analysis of news, backtest data, and market conditions. Its exact logic is defined by the AI-generated Python class.",
      indicators: ["AI-defined"],
      bestTimeframes: ["1m"],
      signalFrequency: "Medium" as const,
      riskLevel: "Medium" as const,
      script: `# AI-Generated Strategy: ${name}\n# This strategy was created by the ResearchAgent.\n# The full source code is injected at runtime into the trading engine.\n# Restart the bot with AI API key configured to regenerate.`,
    })),
  ];

  const filtered = allEntries.filter(e => {
    const q = search.toLowerCase();
    const matchSearch = !q || e.displayName.toLowerCase().includes(q) || e.description.toLowerCase().includes(q) || e.category.toLowerCase().includes(q);
    const matchCat = !catFilter || e.category === catFilter;
    return matchSearch && matchCat;
  });

  return (
    <div className="flex flex-col gap-4">
      {/* Search + category filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-600" />
          <input
            type="text"
            placeholder="Search strategies…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 bg-bg-surface border border-bg-border rounded-lg text-xs text-white placeholder-gray-600 focus:outline-none focus:border-brand/50"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          <button onClick={() => setCat("")}
            className={cn("px-2.5 py-1 rounded-md text-xs border transition-all", !catFilter ? "bg-brand/20 border-brand/40 text-brand" : "border-bg-border text-gray-500 hover:text-gray-300")}>
            All
          </button>
          {categories.map(c => (
            <button key={c} onClick={() => setCat(c === catFilter ? "" : c)}
              className={cn("px-2.5 py-1 rounded-md text-xs border transition-all",
                catFilter === c ? CATEGORY_COLORS[c] : "border-bg-border text-gray-500 hover:text-gray-300")}>
              {c}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-gray-700 ml-auto shrink-0">{filtered.length} strategies</span>
      </div>

      <div className="flex flex-col gap-2">
        {filtered.map(entry => (
          <CatalogCard
            key={entry.id}
            entry={entry as any}
            liveResult={liveMap[entry.id]}
          />
        ))}
        {filtered.length === 0 && (
          <div className="bg-bg-surface border border-bg-border rounded-xl p-8 text-center">
            <p className="text-gray-600 text-sm">No strategies match your search.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function StrategyPerformance({ results, best }: Props) {
  const [tab, setTab] = useState<"rankings" | "catalog">("rankings");

  if (results.length === 0 && tab === "rankings") {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex gap-1 p-1 bg-bg-surface rounded-lg border border-bg-border w-fit">
          {(["rankings", "catalog"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={cn("px-4 py-1.5 rounded-md text-sm font-medium transition-all capitalize",
                tab === t ? "bg-bg-raised text-brand border border-bg-border shadow-sm" : "text-gray-400 hover:text-gray-200")}>
              {t === "rankings" ? "Rankings" : "Strategy Catalog"}
            </button>
          ))}
        </div>
        {tab === "rankings" ? (
          <div className="bg-bg-surface border border-bg-border rounded-xl p-8 text-center">
            <BarChart2 className="w-8 h-8 text-gray-700 mx-auto mb-3" />
            <p className="text-gray-600 text-sm">No evaluations yet.</p>
            <p className="text-gray-700 text-xs mt-1">Start the bot to run backtests across all strategies and assets.</p>
          </div>
        ) : (
          <CatalogTab results={results} />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Tab switcher */}
      <div className="flex gap-1 p-1 bg-bg-surface rounded-lg border border-bg-border w-fit">
        {(["rankings", "catalog"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cn("px-4 py-1.5 rounded-md text-sm font-medium transition-all",
              tab === t ? "bg-bg-raised text-brand border border-bg-border shadow-sm" : "text-gray-400 hover:text-gray-200")}>
            {t === "rankings" ? `Rankings (${results.length})` : "Strategy Catalog"}
          </button>
        ))}
      </div>

      {tab === "rankings" && <RankingsTab results={results} best={best} />}
      {tab === "catalog"  && <CatalogTab  results={results} />}
    </div>
  );
}
