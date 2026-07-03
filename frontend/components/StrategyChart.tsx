"use client";

import { useState, useEffect, useCallback } from "react";
import type { AnalysisData, StrategyResult } from "@/types";
import {
  ComposedChart, Area, Line, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Cell, ReferenceLine,
} from "recharts";
import {
  RefreshCw, TrendingUp, TrendingDown, Activity,
  BarChart2, Target, AlertTriangle, Award, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Props { best: StrategyResult | null; }
const API = "http://localhost:8100";

export default function StrategyChart({ best }: Props) {
  const [data, setData]       = useState<AnalysisData | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView]       = useState<"line" | "candles">("line");

  const fetchAnalysis = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/analysis`);
      if (r.ok) setData(await r.json());
    } catch { /* not ready */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchAnalysis();
    const id = setInterval(fetchAnalysis, 60_000);
    return () => clearInterval(id);
  }, [fetchAnalysis]);

  // ── Chart data ──────────────────────────────────────────────────────────────
  const chartData = (data?.candles ?? []).map((c, i) => {
    const sig  = (data?.signals ?? [])[i] ?? "neutral";
    const bull = c.close >= c.open;
    const dt   = c.datetime
      ? new Date(c.datetime).toLocaleTimeString("en-US",
          { hour12: false, hour: "2-digit", minute: "2-digit" })
      : new Date(c.timestamp * 1000).toLocaleTimeString("en-US",
          { hour12: false, hour: "2-digit", minute: "2-digit" });
    return {
      t:         dt,
      close:     +c.close.toFixed(5),
      open:      +c.open.toFixed(5),
      high:      +c.high.toFixed(5),
      low:       +c.low.toFixed(5),
      vol:       c.volume ?? 0,
      signal:    sig,
      bull,
      // For signal dots ON the price line
      callY:     sig === "call" ? +c.close.toFixed(5) : null,
      putY:      sig === "put"  ? +c.close.toFixed(5) : null,
      // Candle body: use bar stacking trick
      bodyLow:   +Math.min(c.open, c.close).toFixed(5),
      bodyHigh:  +Math.max(c.open, c.close).toFixed(5),
      bodySize:  +Math.abs(c.close - c.open).toFixed(5) || 0.00001,
      wickLow:   +c.low.toFixed(5),
      wickHigh:  +c.high.toFixed(5),
    };
  });

  // ── Stats ────────────────────────────────────────────────────────────────────
  const s = data as any;
  const winRate  = +(s?.win_rate       ?? best?.win_rate       ?? 0);
  const pf       = +(s?.profit_factor  ?? best?.profit_factor  ?? 0);
  const dd       = +(s?.max_drawdown   ?? best?.max_drawdown   ?? 0);
  const total    =  (s?.total_trades   ?? best?.total_trades   ?? 0);
  const wins     =  (s?.winning_trades ?? best?.winning_trades ?? 0);
  const score    = +(s?.composite_score ?? best?.composite_score ?? 0);
  const signals  = data?.signals ?? [];
  const callN    = signals.filter(x => x === "call").length;
  const putN     = signals.filter(x => x === "put").length;
  const neuN     = signals.filter(x => x === "neutral").length;
  const sigTotal = callN + putN || 1;

  const stats = [
    { label:"Win Rate",      value:`${(winRate*100).toFixed(1)}%`,
      color: winRate>=0.55?"text-profit":"text-loss",
      border: winRate>=0.55?"border-profit/20":"border-loss/20",
      bar: winRate*100, barColor: winRate>=0.55?"bg-profit":"bg-loss",
      icon:<Target className="w-3.5 h-3.5"/> },
    { label:"Profit Factor", value:pf.toFixed(2),
      color: pf>=1.2?"text-profit":"text-loss",
      border: pf>=1.2?"border-profit/20":"border-loss/20",
      icon:<TrendingUp className="w-3.5 h-3.5"/> },
    { label:"Max Drawdown",  value:`${(dd*100).toFixed(1)}%`,
      color: dd<0.15?"text-profit":"text-loss",
      border: dd<0.15?"border-profit/20":"border-loss/20",
      icon:<AlertTriangle className="w-3.5 h-3.5"/> },
    { label:"Trades",        value:`${total}`,
      color:"text-brand", border:"border-brand/20",
      sub:`${wins} wins / ${total-wins} losses`,
      icon:<BarChart2 className="w-3.5 h-3.5"/> },
    { label:"Score",         value:score.toFixed(4),
      color: score>=0.3?"text-brand":"text-gray-400",
      border:"border-brand/20",
      icon:<Award className="w-3.5 h-3.5"/> },
    { label:"↑ CALL",        value:`${callN} (${((callN/sigTotal)*100).toFixed(0)}%)`,
      color:"text-profit", border:"border-profit/20",
      icon:<TrendingUp className="w-3.5 h-3.5"/> },
    { label:"↓ PUT",         value:`${putN} (${((putN/sigTotal)*100).toFixed(0)}%)`,
      color:"text-loss",   border:"border-loss/20",
      icon:<TrendingDown className="w-3.5 h-3.5"/> },
    { label:"Neutral",       value:`${neuN}`,
      color:"text-gray-500", border:"border-bg-border",
      icon:<Activity className="w-3.5 h-3.5"/> },
  ];

  if (!best) {
    return (
      <div className="bg-bg-surface border border-bg-border rounded-xl p-10 text-center">
        <Zap className="w-8 h-8 text-gray-700 mx-auto mb-3" />
        <p className="text-gray-500 text-sm">Start the bot to see strategy analysis.</p>
      </div>
    );
  }

  // ── Tooltip ─────────────────────────────────────────────────────────────────
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    return (
      <div className="bg-bg-raised border border-bg-border rounded-lg p-2.5 text-xs font-mono shadow-lg">
        <p className="text-gray-500 mb-1">{d.t}</p>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
          <span className="text-gray-600">O</span><span className="text-white">{d.open}</span>
          <span className="text-gray-600">H</span><span className="text-white">{d.high}</span>
          <span className="text-gray-600">L</span><span className="text-white">{d.low}</span>
          <span className="text-gray-600">C</span>
          <span className={d.bull ? "text-profit font-bold" : "text-loss font-bold"}>{d.close}</span>
        </div>
        {d.signal !== "neutral" && (
          <div className={cn(
            "mt-1.5 px-1.5 py-0.5 rounded text-center font-bold",
            d.signal === "call" ? "bg-profit/20 text-profit" : "bg-loss/20 text-loss"
          )}>
            {d.signal === "call" ? "▲ CALL" : "▼ PUT"}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">

      {/* Header */}
      <div className="bg-bg-surface border border-brand/20 rounded-xl p-3 flex items-center justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          <Award className="w-4 h-4 text-brand shrink-0" />
          <span className="text-sm font-semibold text-white">
            {(s?.strategy ?? best.strategy_name ?? "").replace(/_/g, " ")}
          </span>
          <span className="text-xs font-mono text-brand border border-brand/30 bg-brand/10 px-2 py-0.5 rounded">
            {s?.asset ?? best.asset}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-bg-raised border border-bg-border overflow-hidden text-xs">
            {(["line","candles"] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={cn("px-2.5 py-1 capitalize",
                  view===v ? "bg-brand/15 text-brand" : "text-gray-500 hover:text-gray-300")}>
                {v}
              </button>
            ))}
          </div>
          <button onClick={fetchAnalysis} disabled={loading}
            className="p-1.5 rounded hover:bg-bg-raised text-gray-500 hover:text-brand transition-all">
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 lg:grid-cols-8 gap-2">
        {stats.map(s => (
          <div key={s.label}
               className={cn("bg-bg-surface border rounded-lg p-2.5 flex flex-col gap-1", s.border)}>
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] text-gray-600 font-medium uppercase tracking-wide truncate">{s.label}</span>
              <span className={cn("opacity-60 shrink-0", s.color)}>{s.icon}</span>
            </div>
            <span className={cn("text-sm font-mono font-bold", s.color)}>{s.value}</span>
            {s.bar !== undefined && (
              <div className="h-0.5 bg-bg-border rounded-full mt-0.5">
                <div className={cn("h-full rounded-full", s.barColor)} style={{ width:`${s.bar}%` }} />
              </div>
            )}
            {s.sub && <span className="text-[9px] text-gray-600 leading-tight">{s.sub}</span>}
          </div>
        ))}
      </div>

      {/* Main chart */}
      <div className="bg-bg-surface border border-bg-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-gray-500 font-mono">
            {view === "line" ? "Price line + signal markers" : "OHLC bars + signals"} — {chartData.length} candles
          </p>
          <div className="flex items-center gap-3 text-[10px] text-gray-600">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-profit" />CALL signal
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-loss" />PUT signal
            </span>
          </div>
        </div>

        {chartData.length === 0 ? (
          <div className="flex items-center justify-center h-56 text-gray-600 text-sm gap-2">
            {loading
              ? <><RefreshCw className="w-4 h-4 animate-spin" />Loading chart…</>
              : "No data yet — waiting for evaluation to complete…"}
          </div>
        ) : view === "line" ? (
          <LineChartView data={chartData} tooltip={<CustomTooltip />} />
        ) : (
          <CandleChartView data={chartData} tooltip={<CustomTooltip />} />
        )}
      </div>

      {/* Volume */}
      {chartData.length > 0 && chartData.some(d => d.vol > 0) && (
        <div className="bg-bg-surface border border-bg-border rounded-xl p-4">
          <p className="text-xs text-gray-600 mb-2 font-mono">Volume</p>
          <ResponsiveContainer width="100%" height={50}>
            <ComposedChart data={chartData} margin={{ top:0, right:8, left:0, bottom:0 }}>
              <XAxis dataKey="t" hide />
              <YAxis hide />
              <Bar dataKey="vol" maxBarSize={6}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill={d.bull ? "#10b981" : "#ef4444"} opacity={0.5} />
                ))}
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ── Line chart view ────────────────────────────────────────────────────────────
function LineChartView({ data, tooltip }: { data: any[]; tooltip: any }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top:4, right:8, left:0, bottom:0 }}>
        <CartesianGrid strokeDasharray="2 6" stroke="#1f2937" vertical={false} />
        <XAxis dataKey="t" tick={{ fontSize:8, fill:"#6b7280", fontFamily:"monospace" }}
               interval={Math.max(1, Math.floor(data.length/8))} />
        <YAxis tick={{ fontSize:9, fill:"#6b7280", fontFamily:"monospace" }} width={62}
               tickFormatter={v => v.toFixed(4)} domain={["auto","auto"]} />
        <Tooltip content={tooltip} />

        {/* Price area */}
        <defs>
          <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#00d4ff" stopOpacity={0.15} />
            <stop offset="95%" stopColor="#00d4ff" stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="close" stroke="#00d4ff" strokeWidth={1.5}
              fill="url(#priceGrad)" dot={false} />

        {/* CALL signal dots — green dots ON the price line */}
        <Line type="monotone" dataKey="callY" stroke="transparent" strokeWidth={0}
              dot={(props: any) => {
                if (props.payload?.callY == null) return <g key={props.key} />;
                return (
                  <g key={props.key}>
                    <circle cx={props.cx} cy={props.cy - 10} r={5}
                            fill="#10b981" stroke="#065f46" strokeWidth={1} opacity={0.9} />
                    <polygon
                      points={`${props.cx},${props.cy-17} ${props.cx-4},${props.cy-11} ${props.cx+4},${props.cy-11}`}
                      fill="#10b981" opacity={0.9}
                    />
                  </g>
                );
              }}
              activeDot={false}
              connectNulls={false}
        />

        {/* PUT signal dots — red dots below the price line */}
        <Line type="monotone" dataKey="putY" stroke="transparent" strokeWidth={0}
              dot={(props: any) => {
                if (props.payload?.putY == null) return <g key={props.key} />;
                return (
                  <g key={props.key}>
                    <circle cx={props.cx} cy={props.cy + 10} r={5}
                            fill="#ef4444" stroke="#7f1d1d" strokeWidth={1} opacity={0.9} />
                    <polygon
                      points={`${props.cx},${props.cy+17} ${props.cx-4},${props.cy+11} ${props.cx+4},${props.cy+11}`}
                      fill="#ef4444" opacity={0.9}
                    />
                  </g>
                );
              }}
              activeDot={false}
              connectNulls={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── Candle (OHLC bar) chart view ───────────────────────────────────────────────
function CandleChartView({ data, tooltip }: { data: any[]; tooltip: any }) {
  // Transform data: use stacked bars to draw candle bodies
  // Bottom invisible bar + visible body + invisible top filler
  const yMin = Math.min(...data.map(d => d.low))  * 0.9999;
  const yMax = Math.max(...data.map(d => d.high)) * 1.0001;

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top:4, right:8, left:0, bottom:0 }}>
        <CartesianGrid strokeDasharray="2 6" stroke="#1f2937" vertical={false} />
        <XAxis dataKey="t" tick={{ fontSize:8, fill:"#6b7280", fontFamily:"monospace" }}
               interval={Math.max(1, Math.floor(data.length/8))} />
        <YAxis tick={{ fontSize:9, fill:"#6b7280", fontFamily:"monospace" }} width={62}
               tickFormatter={v => v.toFixed(4)} domain={[yMin, yMax]} />
        <Tooltip content={tooltip} />

        {/* Wick line: high-low range */}
        <Bar dataKey="wickLow"    stackId="candle" fill="transparent" />
        <Bar dataKey="bodySize"   stackId="candle" maxBarSize={8}
             radius={[1,1,1,1]}>
          {data.map((d, i) => (
            <Cell key={i}
              fill={d.bull ? "#10b981" : "#ef4444"}
              opacity={0.85}
            />
          ))}
        </Bar>

        {/* Signal dots overlay (close line, invisible, only dots visible) */}
        <Line type="monotone" dataKey="callY" stroke="transparent"
              dot={(props: any) => {
                if (props.payload?.callY == null) return <g key={props.key} />;
                return (
                  <g key={props.key}>
                    <circle cx={props.cx} cy={props.cy} r={6}
                            fill="#10b981" stroke="#fff" strokeWidth={1.5} opacity={0.95} />
                    <text x={props.cx} y={props.cy+1} textAnchor="middle"
                          fill="#fff" fontSize={7} fontWeight="bold">▲</text>
                  </g>
                );
              }}
              activeDot={false} connectNulls={false}
        />
        <Line type="monotone" dataKey="putY" stroke="transparent"
              dot={(props: any) => {
                if (props.payload?.putY == null) return <g key={props.key} />;
                return (
                  <g key={props.key}>
                    <circle cx={props.cx} cy={props.cy} r={6}
                            fill="#ef4444" stroke="#fff" strokeWidth={1.5} opacity={0.95} />
                    <text x={props.cx} y={props.cy+1} textAnchor="middle"
                          fill="#fff" fontSize={7} fontWeight="bold">▼</text>
                  </g>
                );
              }}
              activeDot={false} connectNulls={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
