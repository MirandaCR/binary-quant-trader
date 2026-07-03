"use client";

import type { DailyPnL } from "@/types";
import { cn } from "@/lib/utils";
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, getDay } from "date-fns";
import { BarChart2, TrendingUp, TrendingDown, Trash2 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from "recharts";

interface Props {
  data: DailyPnL[];
  onDeleteDate?: (date: string) => Promise<void>;
  onRefresh?: () => void;
}

const n = (v: number | undefined | null, d = 2) => (v ?? 0).toFixed(d);

export default function PnLCalendar({ data, onDeleteDate, onRefresh }: Props) {
  const pnlByDate  = Object.fromEntries(data.map(d => [d.date, d]));
  const totalProfit = data.reduce((s, d) => s + (d.total_profit ?? 0), 0);
  const tradingDays = data.filter(d => (d.total_trades ?? 0) > 0);
  const profitDays  = tradingDays.filter(d => (d.total_profit ?? 0) > 0);
  const avgDaily    = tradingDays.length ? totalProfit / tradingDays.length : 0;
  const barData     = data.slice(-30);

  const today      = new Date();
  const monthStart = startOfMonth(today);
  const monthEnd   = endOfMonth(today);
  const days       = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startDay   = getDay(monthStart);
  const WEEKDAYS   = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

  return (
    <div className="flex flex-col gap-4">

      {/* Summary row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: "Total P&L",
            value: `${totalProfit >= 0 ? "+" : ""}$${n(totalProfit)}`,
            icon:  totalProfit >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />,
            color: totalProfit >= 0 ? "text-profit" : "text-loss",
          },
          {
            label: "Trading Days",
            value: tradingDays.length,
            icon:  <BarChart2 className="w-4 h-4" />,
            color: "text-brand",
          },
          {
            label: "Profit Days",
            value: `${profitDays.length} / ${tradingDays.length}`,
            icon:  <TrendingUp className="w-4 h-4" />,
            color: "text-profit",
          },
          {
            label: "Avg Daily",
            value: `${avgDaily >= 0 ? "+" : ""}$${n(avgDaily)}`,
            icon:  <BarChart2 className="w-4 h-4" />,
            color: avgDaily >= 0 ? "text-profit" : "text-loss",
          },
        ].map(c => (
          <div key={c.label} className="bg-bg-surface border border-bg-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-500">{c.label}</span>
              <span className={cn("opacity-60", c.color)}>{c.icon}</span>
            </div>
            <span className={cn("text-xl font-mono font-bold", c.color)}>{c.value}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Bar chart */}
        <div className="bg-bg-surface border border-bg-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-gray-300">Daily P&L (Last 30 days)</p>
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                className="text-xs text-gray-500 hover:text-brand transition-colors"
              >
                Refresh
              </button>
            )}
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={barData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 9, fill: "#6b7280" }}
                tickFormatter={d => { try { return format(parseISO(d), "dd"); } catch { return d; } }}
                interval="preserveStartEnd"
              />
              <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} width={40} />
              <Tooltip
                contentStyle={{ background: "#111827", border: "1px solid #1f2937", fontSize: 12 }}
                formatter={(v: number) => [`$${(v ?? 0).toFixed(2)}`, "P&L"]}
                labelFormatter={(l) => { try { return format(parseISO(l), "MMM dd, yyyy"); } catch { return l; } }}
              />
              <ReferenceLine y={0} stroke="#374151" strokeDasharray="3 3" />
              <Bar dataKey="total_profit" radius={[2, 2, 0, 0]}>
                {barData.map((entry, i) => (
                  <Cell key={i} fill={(entry.total_profit ?? 0) >= 0 ? "#10b981" : "#ef4444"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Calendar heatmap */}
        <div className="bg-bg-surface border border-bg-border rounded-xl p-4">
          <p className="text-sm font-medium text-gray-300 mb-3">
            {format(today, "MMMM yyyy")} — Calendar
          </p>
          <p className="text-[10px] text-gray-600 mb-2">Click trash on a day to delete its PnL.</p>

          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAYS.map(d => (
              <div key={d} className="text-center text-xs text-gray-600 font-medium py-0.5">{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: startDay }).map((_, i) => <div key={`e-${i}`} />)}
            {days.map(day => {
              const key    = format(day, "yyyy-MM-dd");
              const pnl    = pnlByDate[key];
              const profit = pnl?.total_profit ?? 0;
              const isToday = key === format(today, "yyyy-MM-dd");

              return (
                <div
                  key={key}
                  title={pnl
                    ? `$${n(profit)} (${pnl.total_trades ?? 0} trades). Click trash to delete.`
                    : "No trades"}
                  className={cn(
                    "aspect-square rounded flex flex-col items-center justify-center cursor-default transition-transform hover:scale-105 relative group",
                    !pnl            && "bg-bg-raised",
                    profit > 0      && "bg-profit/40 border border-profit/30",
                    profit < 0      && "bg-loss/40 border border-loss/30",
                    profit === 0 && pnl && "bg-bg-border",
                    isToday && "ring-2 ring-brand ring-offset-1 ring-offset-bg-base",
                  )}
                >
                  {pnl && onDeleteDate && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onDeleteDate(key).then(() => onRefresh?.()); }}
                      className="absolute top-0.5 right-0.5 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-loss/30 text-loss transition-opacity"
                      aria-label={`Delete ${key}`}
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  )}
                  <span className={cn(
                    "text-xs font-mono",
                    profit > 0 ? "text-profit font-semibold"
                    : profit < 0 ? "text-loss font-semibold"
                    : "text-gray-500"
                  )}>
                    {format(day, "d")}
                  </span>
                  {pnl && (
                    <span className="text-[8px] font-mono opacity-70 text-white">
                      {profit > 0 ? "+" : ""}{n(profit, 1)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-3 mt-3 text-xs text-gray-600">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-profit/40 border border-profit/30" /> Profit
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-loss/40 border border-loss/30" /> Loss
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded bg-bg-raised" /> No trades
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
