"use client";

import type { MLScorerStatus } from "@/types";
import { BrainCircuit, HelpCircle } from "lucide-react";

interface Props {
  mlScorer?: MLScorerStatus;
  status: string;
}

const ML_MIN = 30;   // matches backend MIN_TRAINING_SAMPLES
const ML_METRICS_MIN = 40;  // matches backend MIN_SAMPLES_FOR_METRICS

const MODEL_LABEL: Record<string, string> = {
  logistic: "Logistic Regression — simple & stable",
  xgboost: "XGBoost — advanced, needs lots of data",
};

const pct = (v?: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);

export default function MLPerformancePanel({ mlScorer, status }: Props) {
  const isActive = status === "running" || status === "evaluating";
  if (!isActive && !mlScorer?.ready) return null;

  const ready = mlScorer?.ready ?? false;
  const trainedOn = mlScorer?.trained_on ?? 0;
  const activeModel = mlScorer?.active_model ?? null;
  const m = mlScorer?.metrics ?? {};

  return (
    <div className="bg-bg-surface border border-bg-border rounded-xl p-4">
      <div className="flex items-center gap-2 mb-1">
        <BrainCircuit className="w-4 h-4 text-brand" />
        <h3 className="text-sm font-semibold text-gray-200">How good is the AI, really?</h3>
      </div>
      <p className="text-[11px] text-gray-600 mb-4">
        Plain-English report card for the machine-learning layer that grades each trade signal.
      </p>

      {/* STATE 1 — still learning */}
      {!ready && (
        <LearningState trainedOn={trainedOn} />
      )}

      {/* STATE 2 — active but not enough data to measure honestly */}
      {ready && !m.reliable && (
        <div className="space-y-3">
          <ActiveModelRow activeModel={activeModel} />
          <div className="bg-bg-raised rounded-lg p-3">
            <p className="text-xs text-gray-300">
              The AI is <span className="text-profit font-medium">active</span> and adjusting your
              trades — but it has only <span className="font-mono text-white">{trainedOn}</span> completed
              trades to learn from. We need <span className="font-mono text-white">{ML_METRICS_MIN}+</span> before
              we can <em>honestly</em> tell you how good it is. Anything sooner would be guessing.
            </p>
          </div>
          <Progress value={trainedOn} target={ML_METRICS_MIN} label="Trades until we can grade it" />
        </div>
      )}

      {/* STATE 3 — we have real, held-out metrics */}
      {ready && m.reliable && (
        <div className="space-y-4">
          <ActiveModelRow activeModel={activeModel} />

          {/* The one number that matters, in plain words */}
          <div className="bg-bg-raised rounded-lg p-4">
            <p className="text-xs text-gray-400 mb-3">
              On <span className="font-mono text-white">{m.test_size}</span> trades it had
              <span className="text-white font-medium"> never seen before</span>, the AI guessed
              win-or-lose correctly:
            </p>

            {/* AI vs coin-flip bars */}
            <Bar label="🤖 The AI" value={m.accuracy} color="var(--profit, #10b981)" highlight />
            <Bar label="🪙 Just guessing" value={m.baseline_accuracy} color="#525252" />

            <div className="mt-3 pt-3 border-t border-bg-border">
              <Verdict edge={m.edge_over_guessing} />
            </div>
          </div>

          {/* Skill score (AUC) translated */}
          {m.auc != null && (
            <div className="flex items-start gap-2 text-[11px] text-gray-500">
              <HelpCircle className="w-3.5 h-3.5 shrink-0 mt-px text-gray-600" />
              <span>
                <span className="text-gray-300 font-medium">Skill score: {m.auc.toFixed(2)} / 1.00.</span>{" "}
                Think of it like a grade: <span className="font-mono">0.50</span> = pure luck (coin flip),{" "}
                <span className="font-mono">1.00</span> = magically perfect. Real, honest models usually
                live between <span className="font-mono">0.55</span> and <span className="font-mono">0.65</span>.
              </span>
            </div>
          )}
        </div>
      )}

      <p className="mt-4 pt-3 border-t border-bg-border text-[10px] text-gray-600 leading-relaxed">
        These numbers are measured on trades the AI was <em>not</em> trained on — the honest way. A model
        that beats guessing here is genuinely learning; one that doesn't is being kept humble on purpose.
      </p>
    </div>
  );
}

// ── sub-components ─────────────────────────────────────────────────────────────

function LearningState({ trainedOn }: { trainedOn: number }) {
  return (
    <div className="space-y-3">
      <div className="bg-bg-raised rounded-lg p-3">
        <p className="text-xs text-gray-300">
          The AI is <span className="text-neutral font-medium">still learning</span>. It stays out of the
          way until it has watched <span className="font-mono text-white">{ML_MIN}</span> completed trades —
          no point forming opinions with no experience.
        </p>
      </div>
      <Progress value={trainedOn} target={ML_MIN} label="Trades until the AI switches on" />
    </div>
  );
}

function ActiveModelRow({ activeModel }: { activeModel: string | null }) {
  if (!activeModel) return null;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-wide text-gray-600">Model in use</span>
      <span className="text-xs font-mono text-brand px-2 py-0.5 rounded bg-brand/10 border border-brand/20">
        {MODEL_LABEL[activeModel] ?? activeModel}
      </span>
    </div>
  );
}

function Bar({ label, value, color, highlight }: { label: string; value?: number; color: string; highlight?: boolean }) {
  const w = Math.round((value ?? 0) * 100);
  return (
    <div className="flex items-center gap-3 mb-2">
      <span className="w-28 shrink-0 text-xs text-gray-400">{label}</span>
      <div className="flex-1 h-5 bg-bg-surface rounded-md overflow-hidden">
        <div className="h-full rounded-md transition-all flex items-center justify-end pr-2"
             style={{ width: `${Math.max(w, 8)}%`, background: color, opacity: highlight ? 1 : 0.6 }}>
          <span className="text-[10px] font-mono font-bold text-black/80">{pct(value)}</span>
        </div>
      </div>
    </div>
  );
}

function Progress({ value, target, label }: { value: number; target: number; label: string }) {
  const w = Math.min(100, Math.round((value / target) * 100));
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-gray-600">{label}</span>
        <span className="text-[10px] font-mono text-gray-400">{value}/{target}</span>
      </div>
      <div className="h-2 bg-bg-raised rounded-full overflow-hidden">
        <div className="h-full bg-brand/70 rounded-full transition-all" style={{ width: `${w}%` }} />
      </div>
    </div>
  );
}

function Verdict({ edge }: { edge?: number }) {
  const e = edge ?? 0;
  let text: string, color: string, emoji: string;
  if (e >= 0.03) {
    emoji = "✅"; color = "text-profit";
    text = `It's beating a coin flip by ${Math.round(e * 100)} points — genuinely learning something.`;
  } else if (e > -0.02) {
    emoji = "😐"; color = "text-neutral";
    text = "It's roughly tied with guessing right now — no real edge yet, but no harm either.";
  } else {
    emoji = "⚠️"; color = "text-loss";
    text = "It's actually doing worse than guessing — more data (or different features) needed. No smoke here.";
  }
  return (
    <p className={`text-xs font-medium ${color}`}>
      <span className="mr-1">{emoji}</span>{text}
    </p>
  );
}
