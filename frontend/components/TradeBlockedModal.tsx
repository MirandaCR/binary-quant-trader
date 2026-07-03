"use client";

import { AlertTriangle, RefreshCw, Play, ShieldOff, TrendingDown, Clock } from "lucide-react";

type BlockType = "consecutive" | "daily" | "winrate" | "balance" | "unknown";

function detectBlockType(reason: string): BlockType {
  const r = reason.toLowerCase();
  if (r.includes("consecutive"))          return "consecutive";
  if (r.includes("daily"))                return "daily";
  if (r.includes("win") || r.includes("rate") || r.includes("tasa")) return "winrate";
  if (r.includes("balance") || r.includes("insufficient")) return "balance";
  return "unknown";
}

const BLOCK_META: Record<BlockType, {
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  title: string;
  detail: string;
  canContinue: boolean;
  continueLabel: string;
  continueHint: string;
}> = {
  consecutive: {
    icon: AlertTriangle,
    color: "text-neutral-DEFAULT",
    title: "Consecutive loss limit reached",
    detail: "The bot stopped to protect your capital after too many losses in a row. You can reset the counter and let it try again on the next candle, or do a full restart for a clean state.",
    canContinue: true,
    continueLabel: "Continue (reset counter)",
    continueHint: "Resets only the consecutive-loss counter. Daily P&L is preserved.",
  },
  daily: {
    icon: TrendingDown,
    color: "text-loss",
    title: "Daily loss limit reached",
    detail: "The bot reached its maximum daily loss threshold. Continuing will clear today's loss accumulator and the bot will resume — use this carefully.",
    canContinue: true,
    continueLabel: "Override & continue",
    continueHint: "Clears daily loss accumulator + all counters. Not recommended unless you accept the risk.",
  },
  winrate: {
    icon: ShieldOff,
    color: "text-loss",
    title: "Win rate below minimum threshold",
    detail: "The current strategy's live win rate fell below your configured minimum. Continuing will clear the trade statistics so the bot re-evaluates from scratch.",
    canContinue: true,
    continueLabel: "Override & continue",
    continueHint: "Clears win-rate history so the bot can trade again. Strategy re-evaluation will run on the next cycle.",
  },
  balance: {
    icon: AlertTriangle,
    color: "text-loss",
    title: "Insufficient balance",
    detail: "Your account balance is too low for the configured investment amount. Deposit funds or reduce the investment amount in Live Controls.",
    canContinue: false,
    continueLabel: "Continue",
    continueHint: "",
  },
  unknown: {
    icon: AlertTriangle,
    color: "text-neutral-DEFAULT",
    title: "Trade blocked",
    detail: "The bot blocked a trade due to a risk rule. You can override all risk blocks and let the bot continue, or restart it for a clean state.",
    canContinue: true,
    continueLabel: "Override & continue",
    continueHint: "Clears all risk counters.",
  },
};

interface Props {
  reason: string;
  loading?: boolean;
  onRestart:  () => void;
  onContinue: () => void;
  onDismiss:  () => void;
}

export default function TradeBlockedModal({ reason, loading, onRestart, onContinue, onDismiss }: Props) {
  const type = detectBlockType(reason);
  const meta = BLOCK_META[type];
  const Icon = meta.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-bg-surface border border-bg-border rounded-xl shadow-2xl max-w-md w-full p-6 flex flex-col gap-4">

        {/* Header */}
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 ${meta.color}`}>
            <Icon className="w-7 h-7 shrink-0" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">{meta.title}</h3>
            <p className="text-xs text-gray-500 mt-0.5 font-mono">{reason}</p>
          </div>
        </div>

        {/* Explanation */}
        <p className="text-sm text-gray-400 leading-relaxed bg-bg-raised rounded-lg px-3 py-2.5 border border-bg-border">
          {meta.detail}
        </p>

        {/* Action buttons */}
        <div className="flex flex-col gap-2">

          {/* Restart — always available */}
          <button
            onClick={onRestart}
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg bg-brand/15 hover:bg-brand/25 border border-brand/40 text-brand text-sm font-semibold transition-all disabled:opacity-40"
          >
            {loading
              ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              : <RefreshCw className="w-4 h-4" />
            }
            Restart bot (auto)
          </button>
          <p className="text-[10px] text-gray-700 text-center -mt-1">
            Stops the bot and immediately reconnects with your last configuration.
          </p>

          {/* Continue — only when applicable */}
          {meta.canContinue && (
            <>
              <button
                onClick={onContinue}
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg bg-bg-raised border border-bg-border hover:border-gray-600 text-gray-300 text-sm font-medium transition-all disabled:opacity-40"
              >
                <Play className="w-4 h-4" />
                {meta.continueLabel}
              </button>
              {meta.continueHint && (
                <p className="text-[10px] text-gray-700 text-center -mt-1">{meta.continueHint}</p>
              )}
            </>
          )}

          {/* Dismiss */}
          <button
            onClick={onDismiss}
            className="w-full py-2 rounded-lg text-xs text-gray-600 hover:text-gray-400 transition-colors"
          >
            Dismiss (bot remains stopped)
          </button>
        </div>
      </div>
    </div>
  );
}
