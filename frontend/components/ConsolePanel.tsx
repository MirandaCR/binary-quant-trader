"use client";

import { useEffect, useRef } from "react";
import type { LogMessage } from "@/types";
import { Terminal, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";

interface Props {
  logs: LogMessage[];
  onClear?: () => void;
}

const LEVEL_STYLE: Record<LogMessage["level"], string> = {
  info:    "text-gray-400",
  success: "text-profit",
  warning: "text-neutral-DEFAULT",
  error:   "text-loss",
  trade:   "text-brand",
};

const LEVEL_PREFIX: Record<LogMessage["level"], string> = {
  info:    "INFO ",
  success: "OK   ",
  warning: "WARN ",
  error:   "ERR  ",
  trade:   "TRADE",
};

export default function ConsolePanel({ logs, onClear }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom only when near bottom
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom || logs.length <= 3) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  return (
    <div className="bg-bg-surface border border-bg-border rounded-xl overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-bg-border bg-bg-raised">
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-brand" />
          <span className="text-xs font-medium text-gray-300 font-mono">Bot Console</span>
          {logs.length > 0 && (
            <span className="text-xs text-gray-600 font-mono">
              ({logs.length})
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Live indicator */}
          <span className="flex items-center gap-1 text-xs text-gray-600">
            <span className="w-1.5 h-1.5 rounded-full bg-profit animate-pulse" />
            live
          </span>
          {onClear && (
            <button
              onClick={onClear}
              className="p-1 rounded text-gray-600 hover:text-gray-400 transition-colors"
              title="Clear console"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Log entries */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto font-mono text-xs leading-relaxed p-2 space-y-0.5"
        style={{ minHeight: 200, maxHeight: 320 }}
      >
        {logs.length === 0 ? (
          <div className="text-gray-700 text-center py-6 flex flex-col items-center gap-2">
            <Terminal className="w-6 h-6" />
            <span>Waiting for bot activity…</span>
            <span className="text-gray-800 text-[10px]">Click Start Bot to begin</span>
          </div>
        ) : (
          [...logs].reverse().map(log => (
            <div
              key={log.id}
              className={cn(
                "flex gap-2 px-1 py-0.5 rounded hover:bg-bg-raised transition-colors",
                LEVEL_STYLE[log.level]
              )}
            >
              <span className="shrink-0 text-gray-700">
                {format(parseISO(log.timestamp), "HH:mm:ss")}
              </span>
              <span className="shrink-0 opacity-60">
                {LEVEL_PREFIX[log.level]}
              </span>
              <span className="break-all">{log.message}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
