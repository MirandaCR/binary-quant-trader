"use client";

import type { StrategyResult, MLScorerStatus } from "@/types";
import { Layers, BrainCircuit, TrendingUp } from "lucide-react";

interface Props {
  portfolio?: StrategyResult[];
  mlScorer?: MLScorerStatus;
  status: string;
}

const ML_MIN_SAMPLES = 30;  // must match backend ml/signal_scorer.py MIN_TRAINING_SAMPLES

export default function PortfolioPanel({ portfolio, mlScorer, status }: Props) {
  const combos = portfolio ?? [];
  const isActive = status === "running" || status === "evaluating";

  // Don't take up space before the bot is doing anything
  if (!isActive && combos.length === 0) return null;

  const ready = mlScorer?.ready ?? false;
  const trainedOn = mlScorer?.trained_on ?? 0;

  return (
    <div className="bg-bg-surface border border-bg-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-brand" />
          <h3 className="text-sm font-semibold text-gray-200">Active Portfolio</h3>
          <span className="text-[11px] text-gray-600">
            {combos.length} asset{combos.length !== 1 ? "s" : ""} traded concurrently
          </span>
        </div>

        {/* ML scorer status badge */}
        <div className="flex items-center gap-1.5" title="Traditional ML layer that adjusts each signal's confidence from your real trade history.">
          <BrainCircuit className={`w-3.5 h-3.5 ${ready ? "text-profit" : "text-gray-600"}`} />
          {ready ? (
            <span className="text-[11px] font-mono text-profit">
              ML active · {trainedOn} trades
            </span>
          ) : (
            <span className="text-[11px] font-mono text-gray-500">
              ML learning · {trainedOn}/{ML_MIN_SAMPLES}
            </span>
          )}
        </div>
      </div>

      {combos.length === 0 ? (
        <p className="text-xs text-gray-600 py-2">
          Evaluating strategies… the portfolio appears once the first ranking completes.
        </p>
      ) : (
        <div className="space-y-2">
          {combos.map((c, i) => {
            const alloc = c.allocation ?? (1 / combos.length);
            const wr = (c.win_rate ?? 0) * 100;
            return (
              <div key={`${c.strategy_name}/${c.asset}/${i}`} className="flex items-center gap-3">
                {/* Asset + strategy */}
                <div className="w-44 shrink-0">
                  <div className="text-xs font-medium text-gray-200 truncate">{c.asset}</div>
                  <div className="text-[10px] text-gray-500 truncate">{c.strategy_name}</div>
                </div>

                {/* Allocation bar */}
                <div className="flex-1 min-w-0">
                  <div className="h-2 bg-bg-raised rounded-full overflow-hidden">
                    <div
                      className="h-full bg-brand/70 rounded-full transition-all"
                      style={{ width: `${Math.round(alloc * 100)}%` }}
                    />
                  </div>
                </div>

                {/* Allocation % */}
                <div className="w-12 shrink-0 text-right">
                  <span className="text-xs font-mono text-brand">{Math.round(alloc * 100)}%</span>
                </div>

                {/* Backtest WR */}
                <div className="w-20 shrink-0 flex items-center justify-end gap-1">
                  <TrendingUp className={`w-3 h-3 ${wr >= 55 ? "text-profit" : "text-loss"}`} />
                  <span className={`text-xs font-mono ${wr >= 55 ? "text-profit" : "text-loss"}`}>
                    {wr.toFixed(0)}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-3 pt-2 border-t border-bg-border text-[10px] text-gray-600 leading-relaxed">
        Capital is split across these combos by backtest score (bars above) — not multiplied — so total
        risk per cycle stays comparable to a single trade. WR shown is the backtest win rate; treat it
        as directional, not a profit guarantee.
      </p>
    </div>
  );
}
