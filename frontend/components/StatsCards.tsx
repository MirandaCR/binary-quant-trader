"use client";

import { TrendingUp, TrendingDown, Percent, Activity, ShieldCheck, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  balance: number;
  totalProfit: number;
  winRate: number;
  totalTrades: number;
  consecutiveLosses: number;
  dailyProfit: number;
  maxDailyLoss: number;
  openTrades: number;
}

const n = (v: number | undefined | null, d = 2) => (v ?? 0).toFixed(d);

export default function StatsCards(props: Props) {
  const balance      = props.balance      ?? 0;
  const totalProfit  = props.totalProfit  ?? 0;
  const winRate      = props.winRate      ?? 0;
  const dailyProfit  = props.dailyProfit  ?? 0;
  const maxDailyLoss = props.maxDailyLoss ?? 0;
  const consLosses   = props.consecutiveLosses ?? 0;
  const openTrades   = props.openTrades   ?? 0;
  const totalTrades  = props.totalTrades  ?? 0;

  const dailyLossUsed = maxDailyLoss > 0
    ? Math.min(100, Math.abs(Math.min(0, dailyProfit)) / maxDailyLoss * 100)
    : 0;

  const cards = [
    {
      label: "Account Balance",
      value: `$${n(balance)}`,
      icon:  <DollarSign className="w-4 h-4" />,
      color: "text-brand",
      bg:    "border-brand/20",
      sub:   `${openTrades} open trade${openTrades !== 1 ? "s" : ""}`,
    },
    {
      label: "Total P&L",
      value: `${totalProfit >= 0 ? "+" : ""}$${n(totalProfit)}`,
      icon:  totalProfit >= 0
        ? <TrendingUp  className="w-4 h-4" />
        : <TrendingDown className="w-4 h-4" />,
      color: totalProfit >= 0 ? "text-profit" : "text-loss",
      bg:    totalProfit >= 0 ? "border-profit/20" : "border-loss/20",
      sub:   `${totalTrades} trades`,
    },
    {
      label: "Win Rate",
      value: `${n(winRate * 100, 1)}%`,
      icon:  <Percent className="w-4 h-4" />,
      color: winRate >= 0.55 ? "text-profit" : "text-loss",
      bg:    winRate >= 0.55 ? "border-profit/20" : "border-loss/20",
      sub:   winRate >= 0.55 ? "Above threshold" : "Below threshold",
      bar:   { value: winRate * 100, target: 55, max: 100 },
    },
    {
      label: "Daily P&L",
      value: `${dailyProfit >= 0 ? "+" : ""}$${n(dailyProfit)}`,
      icon:  <Activity className="w-4 h-4" />,
      color: dailyProfit >= 0 ? "text-profit" : "text-loss",
      bg:    dailyProfit >= 0 ? "border-profit/20" : "border-loss/20",
      sub:   `Max loss: $${n(maxDailyLoss)}`,
      bar:   { value: dailyLossUsed, target: 80, max: 100, danger: true },
    },
    {
      label: "Consec. Losses",
      value: String(consLosses),
      icon:  <ShieldCheck className="w-4 h-4" />,
      color: consLosses >= 3 ? "text-loss" : "text-gray-300",
      bg:    consLosses >= 3 ? "border-loss/20" : "border-bg-border",
      sub:   consLosses >= 3 ? "Risk alert" : "Within limits",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
      {cards.map((c) => (
        <div
          key={c.label}
          className={cn(
            "bg-bg-surface border rounded-xl p-4 flex flex-col gap-2 hover:bg-bg-raised transition-colors",
            c.bg
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500 font-medium">{c.label}</span>
            <span className={cn("opacity-70", c.color)}>{c.icon}</span>
          </div>
          <span className={cn("text-2xl font-mono font-bold", c.color)}>{c.value}</span>
          {c.bar && (
            <div className="w-full h-1 bg-bg-border rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  c.bar.danger
                    ? c.bar.value > c.bar.target ? "bg-loss" : "bg-profit"
                    : c.bar.value >= c.bar.target ? "bg-profit" : "bg-neutral-DEFAULT"
                )}
                style={{ width: `${c.bar.value}%` }}
              />
            </div>
          )}
          <span className="text-xs text-gray-600">{c.sub}</span>
        </div>
      ))}
    </div>
  );
}
