"use client";

import React from "react";
import { cn } from "@/lib/utils";
import type { AgentInfo, AgentActivityEntry } from "@/types";

// ── Agent metadata ─────────────────────────────────────────────────────────────

const AGENT_META: Record<string, {
  label: string;
  icon: string;
  color: string;          // Tailwind border/text colour
  bgGlow: string;         // Tailwind bg glow
  description: string;
  role: string;
}> = {
  OrchestratorAgent: {
    label: "Orchestrator",
    icon: "◈",
    color: "border-brand text-brand",
    bgGlow: "bg-brand/5",
    description: "Master controller",
    role: "Coordinates all sub-agents and manages execution cycles",
  },
  NewsAgent: {
    label: "News Agent",
    icon: "◎",
    color: "border-neutral text-neutral",
    bgGlow: "bg-neutral/5",
    description: "Market intelligence",
    role: "Fetches & analyses high-impact news, computes market sentiment",
  },
  ResearchAgent: {
    label: "Research Agent",
    icon: "◇",
    color: "border-blue-400 text-blue-400",
    bgGlow: "bg-blue-400/5",
    description: "Strategy discovery",
    role: "Uses LLM to design new trading strategies from news + live data",
  },
  BacktestAgent: {
    label: "Backtest Agent",
    icon: "◻",
    color: "border-profit text-profit",
    bgGlow: "bg-profit/5",
    description: "Historical validation",
    role: "Backtests new strategies on historical candles, approves or rejects",
  },
  TradeAnalysisAgent: {
    label: "Trade Analysis",
    icon: "◆",
    color: "border-purple-400 text-purple-400",
    bgGlow: "bg-purple-400/5",
    description: "Performance monitor",
    role: "Analyses active trades, integrates approved strategies into live engine",
  },
  ParameterOptimizer: {
    label: "Optimizer",
    icon: "◉",
    color: "border-loss text-loss",
    bgGlow: "bg-loss/5",
    description: "Parameter tuning",
    role: "Reviews stats, prunes underperformers, suggests timeframe/asset changes",
  },
};

// ── Status badge ───────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const cfg =
    s === "running"   ? "bg-brand/20 text-brand border-brand/30" :
    s === "done" || s === "approved" || s === "completed" || s === "deployed" || s === "optimized" || s === "pruned"
                      ? "bg-profit/20 text-profit border-profit/30" :
    s === "error" || s === "failed" || s === "rejected"
                      ? "bg-loss/20 text-loss border-loss/30" :
    s === "waiting" || s === "idle" || s === "skipped" || s === "stopped"
                      ? "bg-gray-700/50 text-gray-500 border-gray-700" :
    s === "no data"   ? "bg-neutral/20 text-neutral border-neutral/30" :
                        "bg-bg-raised text-gray-400 border-bg-border";

  const isActive = s === "running";

  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border", cfg)}>
      {isActive && <span className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" />}
      {status}
    </span>
  );
}

// ── Flow arrow ─────────────────────────────────────────────────────────────────

function FlowArrow({ active }: { active: boolean }) {
  return (
    <div className={cn(
      "flex items-center justify-center mx-0.5 transition-all duration-500",
      active ? "text-brand" : "text-gray-700"
    )}>
      <svg width="24" height="12" viewBox="0 0 24 12" fill="none">
        <path d="M0 6 H20" stroke="currentColor" strokeWidth="1.5" strokeDasharray={active ? "none" : "3 2"} />
        <path d="M16 2 L22 6 L16 10" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

// ── Single agent card ─────────────────────────────────────────────────────────

function AgentCard({ name, info }: { name: string; info: AgentInfo }) {
  const meta = AGENT_META[name];
  if (!meta) return null;

  const isRunning = info.status.toLowerCase() === "running";
  const hasOutput = !!info.last_output;

  return (
    <div className={cn(
      "flex flex-col border rounded-xl p-3 gap-2 min-w-0 transition-all duration-500",
      meta.color,
      meta.bgGlow,
      isRunning ? "shadow-glow-sm" : "opacity-80 hover:opacity-100"
    )}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn("text-xl leading-none shrink-0", isRunning && "animate-pulse")}>{meta.icon}</span>
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-widest truncate">{meta.label}</div>
            <div className="text-[10px] text-gray-600 truncate">{meta.description}</div>
          </div>
        </div>
        <StatusBadge status={info.status} />
      </div>

      {/* Current task */}
      {info.task && (
        <div className="bg-black/30 rounded-lg px-2.5 py-1.5">
          <div className="text-[10px] text-gray-600 mb-0.5 uppercase tracking-wider">Task</div>
          <p className="text-[11px] text-gray-300 leading-relaxed line-clamp-2">{info.task}</p>
        </div>
      )}

      {/* Last output */}
      {hasOutput && (
        <div className="bg-black/20 rounded-lg px-2.5 py-1.5">
          <div className="text-[10px] text-gray-600 mb-0.5 uppercase tracking-wider">Output</div>
          <p className="text-[11px] text-gray-400 leading-relaxed line-clamp-3">{info.last_output}</p>
        </div>
      )}

      {/* Footer: cycle + last run */}
      <div className="flex items-center justify-between text-[10px] text-gray-700 pt-0.5 border-t border-white/5">
        <span>Cycle #{info.cycle}</span>
        {info.last_run && (
          <span className="font-mono">{info.last_run.replace("T", " ").slice(0, 19)}</span>
        )}
      </div>
    </div>
  );
}

// ── Orchestrator (top-level special card) ─────────────────────────────────────

function OrchestratorCard({ info, cycle }: { info: AgentInfo; cycle: number }) {
  const isRunning = info.status.toLowerCase() === "running";
  return (
    <div className={cn(
      "border rounded-xl p-4 flex items-start gap-4 transition-all duration-500",
      "border-brand/40 bg-brand/5",
      isRunning && "shadow-glow"
    )}>
      <div className={cn(
        "w-10 h-10 rounded-xl bg-brand/10 border border-brand/30 flex items-center justify-center shrink-0 text-brand text-xl",
        isRunning && "animate-pulse"
      )}>
        ◈
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 flex-wrap mb-1">
          <span className="text-sm font-bold text-brand uppercase tracking-widest">Orchestrator Agent</span>
          <StatusBadge status={info.status} />
          <span className="text-[10px] text-gray-600 font-mono">Cycle #{cycle}</span>
        </div>
        <p className="text-xs text-gray-400 mb-1">{info.task || "Waiting…"}</p>
        {info.last_output && (
          <p className="text-[11px] text-gray-600 line-clamp-1">{info.last_output}</p>
        )}
      </div>
    </div>
  );
}

// ── Activity log ───────────────────────────────────────────────────────────────

function ActivityLog({ entries }: { entries: AgentActivityEntry[] }) {
  if (entries.length === 0) return null;

  return (
    <div className="bg-bg-surface border border-bg-border rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-bg-border flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" />
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Activity Log</span>
        <span className="text-[10px] text-gray-700 ml-auto">latest events</span>
      </div>
      <div className="divide-y divide-bg-border max-h-52 overflow-y-auto">
        {entries.map((entry, i) => {
          const meta = AGENT_META[entry.agent];
          const colorClass = meta ? meta.color.split(" ")[1] : "text-gray-400";
          const s = entry.status.toLowerCase();
          const msgColor =
            s === "approved" || s === "done" || s === "deployed" || s === "completed" || s === "optimized"
              ? "text-profit" :
            s === "error" || s === "failed" || s === "rejected"
              ? "text-loss" :
            s === "running"
              ? "text-brand" :
              "text-gray-400";

          return (
            <div key={i} className="flex items-start gap-3 px-4 py-2 hover:bg-bg-raised transition-colors">
              <span className={cn("text-[10px] font-mono shrink-0 mt-0.5 w-24 truncate", colorClass)}>
                {meta?.label ?? entry.agent}
              </span>
              <span className={cn("text-[10px] font-semibold shrink-0 w-14 truncate", msgColor)}>
                [{entry.status}]
              </span>
              <span className="text-[11px] text-gray-500 flex-1 line-clamp-1">{entry.message}</span>
              <span className="text-[10px] text-gray-700 font-mono shrink-0 hidden lg:block">
                {entry.time?.slice(11, 19) ?? ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Flow legend ────────────────────────────────────────────────────────────────

function FlowLegend() {
  return (
    <div className="flex flex-wrap gap-4 px-1 text-[10px] text-gray-600">
      {Object.entries(AGENT_META).map(([name, meta]) => (
        <div key={name} className="flex items-center gap-1.5">
          <span className={meta.color.split(" ")[1]}>{meta.icon}</span>
          <span>{meta.label}</span>
          <span className="text-gray-700">—</span>
          <span className="text-gray-700">{meta.role}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface AgentFlowProps {
  agentsState: Record<string, AgentInfo>;
  activityLog: AgentActivityEntry[];
  cycle: number;
  activeProvider?: string | null;
}

const PROVIDER_LABEL: Record<string, string> = {
  deepseek: "DeepSeek",
  openai: "ChatGPT (OpenAI)",
  gemini: "Gemini (Google)",
  anthropic: "Claude (Anthropic)",
};

const SUB_AGENT_ORDER = [
  "NewsAgent",
  "ResearchAgent",
  "BacktestAgent",
  "TradeAnalysisAgent",
  "ParameterOptimizer",
];

export default function AgentFlow({ agentsState, activityLog, cycle, activeProvider }: AgentFlowProps) {
  const orchestrator = agentsState["OrchestratorAgent"];
  const subAgents = SUB_AGENT_ORDER.filter(n => agentsState[n]);
  const hasData = orchestrator || subAgents.length > 0;

  if (!hasData) {
    return (
      <div className="bg-bg-surface border border-bg-border rounded-xl p-8 text-center">
        <div className="text-4xl mb-3 text-gray-700">◈</div>
        <p className="text-sm text-gray-500 font-medium">Multi-Agent System</p>
        <p className="text-xs text-gray-700 mt-1">
          Start the bot to activate the AI orchestration system.
          Requires an AI API key in the configuration panel.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">

      {/* Orchestrator master card */}
      <div className="bg-bg-surface border border-bg-border rounded-xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-2 h-2 rounded-full bg-brand animate-pulse" />
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
            Multi-Agent Orchestration System
          </span>
          {activeProvider && (
            <span className="text-[10px] font-mono text-brand bg-brand/10 border border-brand/20 px-2 py-0.5 rounded-full">
              🧠 {PROVIDER_LABEL[activeProvider] ?? activeProvider}
            </span>
          )}
          {cycle > 0 && (
            <span className="ml-auto text-[10px] font-mono text-gray-600 bg-bg-raised border border-bg-border px-2 py-0.5 rounded-full">
              Total cycles: {cycle}
            </span>
          )}
        </div>

        {/* Clarify what these agents do — and what they DON'T do */}
        <p className="text-[11px] text-gray-600 mb-3 leading-relaxed">
          These agents are the <span className="text-gray-400">R&amp;D team</span>: they research news and
          <span className="text-gray-400"> write, test, and prune trading strategies</span>. They do
          <span className="text-gray-400 font-medium"> not place trades themselves</span> — the trading
          engine executes the best strategies they produce.
        </p>

        {orchestrator && (
          <OrchestratorCard info={orchestrator} cycle={cycle} />
        )}
      </div>

      {/* Flow diagram: sub-agents connected by arrows */}
      <div className="bg-bg-surface border border-bg-border rounded-xl p-4">
        <div className="text-[10px] text-gray-700 uppercase tracking-widest mb-3 font-semibold">
          Agent Pipeline Flow
        </div>

        {/* Desktop: horizontal flow */}
        <div className="hidden lg:flex items-stretch gap-1">
          {subAgents.map((name, i) => {
            const info = agentsState[name];
            const isActive = info.status.toLowerCase() === "running";
            const prevActive = i > 0 && agentsState[subAgents[i - 1]]?.status.toLowerCase() === "done";
            return (
              <React.Fragment key={name}>
                {i > 0 && (
                  <div className="flex items-center shrink-0 self-center">
                    <FlowArrow active={isActive || prevActive} />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <AgentCard name={name} info={info} />
                </div>
              </React.Fragment>
            );
          })}
        </div>

        {/* Mobile: vertical stack */}
        <div className="lg:hidden flex flex-col gap-3">
          {subAgents.map((name, i) => {
            const info = agentsState[name];
            return (
              <React.Fragment key={name}>
                {i > 0 && (
                  <div className="flex justify-center text-gray-700">
                    <svg width="12" height="20" viewBox="0 0 12 20" fill="none">
                      <path d="M6 0 V16" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" />
                      <path d="M2 12 L6 18 L10 12" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                    </svg>
                  </div>
                )}
                <AgentCard name={name} info={info} />
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Activity log */}
      <ActivityLog entries={activityLog} />

      {/* Legend */}
      <div className="bg-bg-surface border border-bg-border rounded-xl p-3">
        <div className="text-[10px] text-gray-700 uppercase tracking-widest font-semibold mb-2">Agent Roles</div>
        <FlowLegend />
      </div>
    </div>
  );
}
