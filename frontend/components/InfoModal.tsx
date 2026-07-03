"use client";

import { useState } from "react";
import { HelpCircle, X, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Collapsible section ────────────────────────────────────────────────────────

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-bg-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-bg-raised hover:bg-bg-border transition-colors text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-gray-200">
          <span>{icon}</span> {title}
        </span>
        {open ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
      </button>
      {open && (
        <div className="px-4 py-3 text-xs text-gray-400 leading-relaxed space-y-2 bg-bg-surface">
          {children}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-brand shrink-0 w-36">{label}</span>
      <span className="text-gray-400">{value}</span>
    </div>
  );
}

// ── Modal ──────────────────────────────────────────────────────────────────────

export default function InfoModal() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="How it works"
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-bg-border text-gray-500 hover:text-gray-300 hover:border-brand/40 transition-all text-xs"
      >
        <HelpCircle className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">How it works</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={e => e.target === e.currentTarget && setOpen(false)}
        >
          <div className="bg-bg-surface border border-bg-border rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-glow">

            {/* Header */}
            <div className="sticky top-0 flex items-center justify-between px-6 py-4 border-b border-bg-border bg-bg-surface z-10">
              <div className="flex items-center gap-3">
                <span className="text-2xl" style={{ color: "#b026ff", textShadow: "0 0 12px rgba(176,38,255,0.7)" }}>♠</span>
                <div>
                  <h2 className="text-base font-bold text-white">Binary Trader — How It Works</h2>
                  <p className="text-xs text-gray-500">AI-powered algorithmic binary options bot</p>
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-4 space-y-3">

              {/* Quick overview */}
              <div className="bg-brand/5 border border-brand/20 rounded-xl p-4">
                <p className="text-sm text-gray-300 leading-relaxed">
                  Binary Trader is a self-improving automated trading bot that connects to IQ Option,
                  evaluates 21+ strategies across your selected assets, picks the best combination using
                  walk-forward backtesting, and places trades automatically. An AI multi-agent system
                  runs in parallel to research new strategies, test them, and optimise parameters.
                </p>
              </div>

              <Section title="Complete Trading Flow" icon="🔄">
                <ol className="list-decimal list-inside space-y-1.5 pl-1">
                  <li><strong className="text-gray-200">Configure</strong> — Enter IQ Option credentials, select assets, timeframe and risk limits in the left panel.</li>
                  <li><strong className="text-gray-200">Start Bot</strong> — Connects to IQ Option, fetches 150 historical candles per asset.</li>
                  <li><strong className="text-gray-200">Strategy Evaluation</strong> — Runs all 21 strategies × all assets in parallel via walk-forward backtesting. Ranks by composite score (win rate 40%, profit factor 25%, drawdown 15%, activity 20%).</li>
                  <li><strong className="text-gray-200">Best Combo Selected</strong> — The highest-scoring strategy × asset pair becomes the active combination. Displayed in the live ticker bar.</li>
                  <li><strong className="text-gray-200">Trade Loop</strong> — Every candle close: fetches 60 fresh candles → generates signal (CALL/PUT/NEUTRAL) → checks risk limits → places trade if confidence ≥ 55%.</li>
                  <li><strong className="text-gray-200">Result Loop</strong> — Polls IQ Option for WIN/LOSS → records profit/loss → updates balance, P&L calendar and risk counters.</li>
                  <li><strong className="text-gray-200">Re-evaluation</strong> — Every 5 minutes (configurable), all strategies are re-ranked and the best combo is updated automatically.</li>
                </ol>
              </Section>

              <Section title="Risk Management" icon="🛡️">
                <Row label="Max Daily Loss (%)" value="Bot stops if daily P&L drops below this % of starting balance." />
                <Row label="Max Consecutive Losses" value="Bot pauses after N losses in a row. You approve to continue." />
                <Row label="Min Win Rate" value="Enforced after 20 live trades. Blocks trading if session WR is too low." />
                <Row label="Investment Amount" value="Base trade size. Scaled by confidence (high confidence = slightly larger)." />
                <Row label="Compound Interest (OFF)" value="Fixed trade size every trade." />
                <Row label="Compound Interest (ON)" value="Position = base × (balance/start)^factor. Factor 1 = linear, 2 = aggressive. Only compounds when session WR ≥ Min WR for compound." />
                <p className="pt-1 border-t border-bg-border text-gray-600">When risk limits are hit, a modal appears asking you to stop or override and continue.</p>
              </Section>

              <Section title="Multi-Agent AI System" icon="🤖">
                <p>Runs in parallel — never blocks trading. Requires an AI API key (DeepSeek, ChatGPT, Gemini or Claude).</p>
                <div className="space-y-1.5 mt-1">
                  <Row label="OrchestratorAgent" value="Master controller. Coordinates all agents each cycle (~60s)." />
                  <Row label="NewsAgent" value="Fetches market news via NewsAPI, computes bullish/bearish/mixed sentiment." />
                  <Row label="ResearchAgent" value="Uses LLM to design a new Python trading strategy based on news + live backtest results." />
                  <Row label="BacktestAgent" value="Compiles AI-generated code, backtests it on live candles. Approves or rejects (threshold: score ≥ 0.15)." />
                  <Row label="TradeAnalysisAgent" value="Injects approved strategies into the live engine. Asks LLM for a concise trade recommendation." />
                  <Row label="ParameterOptimizer" value="Reviews stats, prunes consistently low-scoring strategies, identifies best assets." />
                  <Row label="ML Signal Scorer" value="Traditional ML (logistic regression), not the LLM — learns from your closed trades which strategy/asset/time combos actually win, and adjusts each signal's confidence accordingly. Needs 30+ closed trades to activate." />
                </div>
              </Section>

              <Section title="Reading the Dashboard" icon="📊">
                <Row label="Overview tab" value="Trade history table, equity curve, session P&L, win/loss counts." />
                <Row label="AI Agents tab" value="Live orchestration flow: all 6 agents with status, current task, last output, activity log." />
                <Row label="Strategies tab" value="Leaderboard of all strategy × asset combos sorted by composite score." />
                <Row label="Calendar tab" value="Daily P&L calendar — click any date to delete that record." />
                <Row label="News tab" value="Market headlines for your selected assets (requires NewsAPI key)." />
                <Row label="Console tab" value="Live log stream — all events: signals, trades, agent actions, strategy changes." />
              </Section>

              <Section title="Configuration Parameters" icon="⚙️">
                <Row label="Timeframe" value="Candle duration. Shorter = more trades, more noise. 1m is the recommended default." />
                <Row label="Backtest Candles" value="Historical data depth. More = slower init but better evaluation (default 150)." />
                <Row label="Portfolio Size" value="How many distinct assets the bot trades concurrently each candle (default 3), picking the best strategy per asset. Capital is split across them by score — not multiplied — so total risk per cycle stays similar to trading just one. Set to 1 for the old single-strategy behavior." />
                <Row label="Expiration (sec)" value="Optional: if set, enters trade at candle close and waits this many seconds for result (e.g. 30s). Leave empty to use expiration minutes." />
                <Row label="AI Provider" value="Default: DeepSeek. Switch to ChatGPT (OpenAI), Gemini (Google) or Claude (Anthropic) from the dropdown." />
                <Row label="AI Base URL / Model" value="Optional overrides — leave empty to use the selected provider's default endpoint and model." />
              </Section>

              <Section title="Approving Trades & Credentials" icon="🔑">
                <p>Your IQ Option credentials are sent directly from your browser to the local backend running on <code className="text-brand">localhost:8100</code> — they never leave your computer.</p>
                <p>The <strong className="text-gray-200">Test Credentials</strong> button verifies login without starting the bot.</p>
                <p>When risk limits are hit (consecutive losses, daily loss cap), a modal appears. You must explicitly click <strong className="text-gray-200">Continue</strong> to override — the bot will not resume automatically.</p>
                <p>Use <strong className="text-gray-200">PRACTICE</strong> account first to validate behaviour before switching to REAL.</p>
              </Section>

              <Section title="Exporting Reports" icon="📥">
                <p>Click <strong className="text-gray-200">Export CSV</strong> in the Trade History tab to download a report.</p>
                <p>Available filters: <strong className="text-gray-200">date range, asset, result (win/loss/open), strategy</strong>.</p>
                <p>The CSV includes: date, asset, direction, strategy, confidence, amount, profit, balance before/after, timeframe, account type.</p>
              </Section>

            </div>
          </div>
        </div>
      )}
    </>
  );
}
