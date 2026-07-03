"use client";

import type { StrategyResult, RiskSummary } from "@/types";
import { TrendingUp, TrendingDown, Activity, ShieldAlert } from "lucide-react";

interface Props {
  bestCombo: StrategyResult | null;
  openTrades: number;
  risk: RiskSummary;
}

const n = (v: number | undefined | null, d = 2) => (v ?? 0).toFixed(d);

export default function LiveTicker({ bestCombo, openTrades, risk }: Props) {
  const dailyProfit = risk?.daily_profit ?? 0;
  const consLosses  = risk?.consecutive_losses ?? 0;

  const items = [
    bestCombo && {
      icon:   <Activity className="w-3 h-3 text-brand" />,
      label:  "Strategy",
      value:  `${bestCombo.strategy_name} / ${bestCombo.asset}`,
      accent: "text-brand",
    },
    bestCombo && {
      icon:   <TrendingUp className="w-3 h-3 text-profit" />,
      label:  "Win Rate",
      value:  `${n(bestCombo.win_rate * 100, 1)}%`,
      accent: (bestCombo.win_rate ?? 0) >= 0.55 ? "text-profit" : "text-loss",
    },
    bestCombo && {
      icon:   <TrendingUp className="w-3 h-3 text-profit" />,
      label:  "Score",
      value:  n(bestCombo.composite_score, 4),
      accent: "text-gray-300",
    },
    openTrades > 0 && {
      icon:   <Activity className="w-3 h-3 text-neutral-DEFAULT" />,
      label:  "Open",
      value:  `${openTrades} trade${openTrades > 1 ? "s" : ""}`,
      accent: "text-neutral-DEFAULT",
    },
    {
      icon:   dailyProfit >= 0
        ? <TrendingUp  className="w-3 h-3 text-profit" />
        : <TrendingDown className="w-3 h-3 text-loss" />,
      label:  "Daily P&L",
      value:  `${dailyProfit >= 0 ? "+" : ""}$${n(dailyProfit)}`,
      accent: dailyProfit >= 0 ? "text-profit" : "text-loss",
    },
    consLosses >= 3 && {
      icon:   <ShieldAlert className="w-3 h-3 text-loss" />,
      label:  "Streak",
      value:  `${consLosses} losses`,
      accent: "text-loss",
    },
  ].filter(Boolean) as Array<{ icon: React.ReactNode; label: string; value: string; accent: string }>;

  if (items.length === 0) return null;

  return (
    <div className="bg-bg-surface border-b border-bg-border">
      <div className="max-w-[1800px] mx-auto px-4 lg:px-6 h-9 flex items-center gap-6 overflow-x-auto scrollbar-none">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-1.5 shrink-0">
            {item.icon}
            <span className="text-xs text-gray-500">{item.label}:</span>
            <span className={`text-xs font-mono font-medium ${item.accent}`}>{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
