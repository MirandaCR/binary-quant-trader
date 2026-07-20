"use client";

import React from "react";
import type { BotState } from "@/types";
import { API_URL } from "@/lib/config";

const STATUS_LABELS: Record<BotState["status"], string> = {
  idle:        "Idle",
  connecting:  "Connecting…",
  evaluating:  "Evaluating…",
  running:     "Live Trading",
  stopped:     "Stopped",
  error:       "Error",
};

interface Props {
  status: BotState["status"];
  balance: number;
}

export default function Header({ status, balance }: Props) {
  const [backendOk, setBackendOk] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    const check = () =>
      fetch(`${API_URL}/health`)
        .then(r => r.ok ? setBackendOk(true) : setBackendOk(false))
        .catch(() => setBackendOk(false));
    check();
    const id = setInterval(check, 10_000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="sticky top-0 z-50 bg-bg-surface border-b border-bg-border backdrop-blur-sm">
      <div className="max-w-[1800px] mx-auto px-4 lg:px-6 h-14 flex items-center justify-between">

        {/* Logo — "♠ BINARY TRADER" neon brand */}
        <div className="flex items-center gap-2.5">
          <span
            className="text-2xl leading-none select-none"
            style={{
              color: "#b026ff",
              textShadow: "0 0 12px rgba(176,38,255,0.8), 0 0 24px rgba(176,38,255,0.4)",
            }}
          >
            ♠
          </span>
          <div className="flex items-baseline gap-2">
            <span
              className="font-bold text-sm tracking-[0.18em] uppercase"
              style={{
                color: "#b026ff",
                textShadow: "0 0 10px rgba(176,38,255,0.6), 0 0 20px rgba(176,38,255,0.3)",
                letterSpacing: "0.18em",
              }}
            >
              Binary Trader
            </span>
            <span className="text-gray-700 text-[10px] tracking-widest uppercase hidden sm:inline">
              AI · Algorithmic
            </span>
          </div>
        </div>

        {/* Center: clock */}
        <LiveClock />

        {/* Right: connectivity + status + balance */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-xs">
            <span className={`status-dot ${backendOk === null ? "idle" : backendOk ? "running" : "error"}`} />
            <span className="text-gray-600 hidden sm:inline">
              {backendOk === null ? "Checking…" : backendOk ? "API connected" : (
                <a href="http://localhost:8100/health" target="_blank" className="text-loss hover:underline">
                  API offline — click here
                </a>
              )}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`status-dot ${status}`} />
            <span className="text-xs text-gray-400 hidden sm:inline">{STATUS_LABELS[status]}</span>
          </div>
          {balance > 0 && (
            <div className="bg-bg-raised border border-bg-border rounded-lg px-3 py-1.5">
              <span className="text-xs text-gray-500 mr-1">Balance</span>
              <span className="font-mono font-semibold text-brand">${balance.toFixed(2)}</span>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function LiveClock() {
  const [mounted, setMounted] = React.useState(false);
  const [time, setTime]       = React.useState<Date | null>(null);

  React.useEffect(() => {
    setMounted(true);
    setTime(new Date());
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!mounted || !time) {
    return (
      <div className="hidden md:flex flex-col items-center opacity-0 select-none">
        <span className="font-mono text-sm font-medium tabular-nums">00:00:00</span>
        <span className="text-xs">--- --- --</span>
      </div>
    );
  }

  return (
    <div className="hidden md:flex flex-col items-center">
      <span className="font-mono text-sm font-medium text-white tabular-nums">
        {time.toLocaleTimeString("en-US", { hour12: false })}
      </span>
      <span className="text-xs text-gray-500">
        {time.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
      </span>
    </div>
  );
}
