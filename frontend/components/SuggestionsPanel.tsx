"use client";

import { useState, useEffect } from "react";
import { getSuggestions, askStrategySuggestions, runSuggestionsPipeline, type SuggestionsResponse } from "@/lib/api";
import type { StrategyResult } from "@/types";
import { Lightbulb, RefreshCw, TrendingUp, Layers, Sparkles, Play, Bot } from "lucide-react";
import { cn } from "@/lib/utils";

const n = (v: number | undefined | null, d = 2) => (v ?? 0).toFixed(d);

const ASSET_GROUPS_FALLBACK: { label: string; assets: string[] }[] = [
  { label: "Forex OTC", assets: ["EURUSD-OTC", "GBPUSD-OTC", "EURJPY-OTC"] },
  { label: "Stocks OTC", assets: ["AAPL-OTC", "GOOG-OTC", "MSFT-OTC", "TSLA-OTC"] },
];

const TIMEFRAMES = [60, 120, 300, 600];

export default function SuggestionsPanel() {
  const [data, setData] = useState<SuggestionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<number>(60);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [pipelineLoading, setPipelineLoading] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [pipelineResult, setPipelineResult] = useState<{
    steps: { agent: string; status: string; message: string }[];
    new_strategies_added: string[];
    pruned: string[];
  } | null>(null);

  const fetchSuggestions = (tf?: number) => {
    setLoading(true);
    setError(null);
    getSuggestions(tf ?? timeframe)
      .then(setData)
      .catch((e: Error) => {
        setError(e.message ?? "Failed to load. Is the backend running on port 8100?");
        setData(null);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchSuggestions(timeframe);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeframe]);

  const askAi = () => {
    setAiLoading(true);
    setAiError(null);
    askStrategySuggestions()
      .then((r) => {
        setAiSuggestions(r.suggestions ?? []);
        if (r.raw_response) setAiSuggestions((prev) => (prev.length ? prev : r.raw_response.split("\n").filter(Boolean)));
      })
      .catch((e: Error) => setAiError(e.message ?? "AI request failed"))
      .finally(() => setAiLoading(false));
  };

  const runPipeline = () => {
    setPipelineLoading(true);
    setPipelineError(null);
    setPipelineResult(null);
    runSuggestionsPipeline()
      .then((r) => setPipelineResult(r))
      .then(() => fetchSuggestions(timeframe))
      .catch((e: Error) => setPipelineError(e.message ?? "Pipeline failed (is the bot running?)"))
      .finally(() => setPipelineLoading(false));
  };

  if (loading && !data && !error) {
    return (
      <div className="bg-bg-surface border border-bg-border rounded-xl p-8 text-center">
        <RefreshCw className="w-8 h-8 text-gray-600 mx-auto mb-3 animate-spin" />
        <p className="text-gray-500 text-sm">Loading assets and strategies…</p>
      </div>
    );
  }

  const suggestions: StrategyResult[] = data?.suggestions ?? [];
  const assetGroups = data?.asset_groups ?? ASSET_GROUPS_FALLBACK;
  const strategies = data?.strategies ?? [];

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="bg-loss/10 border border-loss/30 rounded-lg px-4 py-2 flex items-center justify-between gap-2">
          <p className="text-loss text-sm">{error}</p>
          <button onClick={() => fetchSuggestions()} className="px-2 py-1 rounded bg-bg-raised text-xs hover:bg-bg-border">
            Retry
          </button>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-brand" />
          <span className="text-sm font-medium text-gray-300">Suggestions</span>
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(Number(e.target.value))}
            className="ml-2 bg-bg-raised border border-bg-border rounded px-2 py-0.5 text-xs text-white"
          >
            {TIMEFRAMES.map((tf) => (
              <option key={tf} value={tf}>{tf}s</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => fetchSuggestions()}
          disabled={loading}
          className="p-1.5 rounded-lg hover:bg-bg-raised text-gray-500 hover:text-gray-300 transition-all"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
        </button>
      </div>

      {/* Multi-Agent Pipeline: Review data → Create strategy → Test → Prune */}
      <div className="bg-bg-surface border border-bg-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-bg-border flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-brand" />
            <span className="text-sm font-medium text-gray-300">Multi-Agent Pipeline</span>
            <span className="text-xs text-gray-600">(News → Data → Research → Test → Add/Remove strategies)</span>
          </div>
          <button
            onClick={runPipeline}
            disabled={pipelineLoading}
            className="px-3 py-1.5 rounded-lg bg-brand/20 text-brand text-xs font-medium hover:bg-brand/30 transition-all inline-flex items-center gap-1.5"
          >
            {pipelineLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {pipelineLoading ? "Running…" : "Run pipeline"}
          </button>
        </div>
        {pipelineError && <p className="px-4 py-2 text-loss text-xs">{pipelineError}</p>}
        {pipelineResult && (
          <div className="p-4 space-y-3">
            <div className="space-y-1.5">
              {pipelineResult.steps.map((s, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className={cn(
                    "shrink-0 font-mono font-medium",
                    s.status === "Done" || s.status === "Deployed" ? "text-profit" : s.status === "Error" ? "text-loss" : "text-brand"
                  )}>
                    [{s.agent}]
                  </span>
                  <span className="text-gray-400">{s.message}</span>
                </div>
              ))}
            </div>
            {(pipelineResult.new_strategies_added.length > 0 || pipelineResult.pruned.length > 0) && (
              <div className="flex gap-4 pt-2 border-t border-bg-border text-xs">
                {pipelineResult.new_strategies_added.length > 0 && (
                  <span className="text-profit">Added: {pipelineResult.new_strategies_added.join(", ")}</span>
                )}
                {pipelineResult.pruned.length > 0 && (
                  <span className="text-loss">Pruned: {pipelineResult.pruned.join(", ")}</span>
                )}
              </div>
            )}
          </div>
        )}
        {!pipelineLoading && !pipelineResult && !pipelineError && (
          <p className="px-4 py-3 text-gray-600 text-xs">Start the bot, then run the pipeline. Agents: NewsReviewer (news), DataReviewer (backtest data), StrategyCreator (new strategies), StrategyTester (backtest & add good ones), StrategyCleaner (remove underperforming). New strategies are included in the next analysis run.</p>
        )}
      </div>

      {/* Ask AI for new strategies (OpenAI/Flexi) */}
      <div className="bg-bg-surface border border-bg-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-bg-border flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-brand" />
            <span className="text-sm font-medium text-gray-300">Ask AI for new strategies</span>
          </div>
          <button
            onClick={askAi}
            disabled={aiLoading}
            className="px-3 py-1.5 rounded-lg bg-brand/20 text-brand text-xs font-medium hover:bg-brand/30 transition-all"
          >
            {aiLoading ? "Asking…" : "Ask & test"}
          </button>
        </div>
        {aiError && <p className="px-4 py-2 text-loss text-xs">{aiError}</p>}
        {aiSuggestions.length > 0 && (
          <ul className="p-4 space-y-1.5 text-xs text-gray-300 font-mono max-h-48 overflow-y-auto">
            {aiSuggestions.map((line, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-gray-600 shrink-0">{i + 1}.</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        )}
        {!aiLoading && aiSuggestions.length === 0 && !aiError && (
          <p className="px-4 py-3 text-gray-600 text-xs">Click &quot;Ask & test&quot; to get AI-suggested strategies (uses OpenAI/Flexi API). The bot will keep analysing best strategies in parallel.</p>
        )}
      </div>

      {/* Top suggestions (from last bot evaluation) */}
      <div className="bg-bg-surface border border-bg-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-bg-border flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-brand" />
          <span className="text-sm font-medium text-gray-300">Top strategy × asset combos</span>
          <span className="text-xs text-gray-600">(from last bot run)</span>
        </div>
        {suggestions.length === 0 ? (
          <div className="p-6 text-center text-gray-600 text-sm">
            No evaluations yet. Start the bot to analyze assets with all strategies and see suggestions here.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Asset</th>
                  <th>Strategy</th>
                  <th>Win Rate</th>
                  <th>Profit Factor</th>
                  <th>Score</th>
                  <th>Trades</th>
                </tr>
              </thead>
              <tbody>
                {suggestions.slice(0, 25).map((s, i) => (
                  <tr key={`${s.asset}-${s.strategy_name}-${i}`} className="border-t border-bg-border">
                    <td className="text-gray-600 font-mono text-xs">{i + 1}</td>
                    <td className="font-mono text-xs font-medium text-white">{s.asset}</td>
                    <td className="text-xs text-gray-400 max-w-32 truncate" title={s.strategy_name}>
                      {(s.strategy_name ?? "").replace(/_/g, " ")}
                    </td>
                    <td className={cn("font-mono text-xs font-semibold", (s.win_rate ?? 0) >= 0.55 ? "text-profit" : "text-loss")}>
                      {n((s.win_rate ?? 0) * 100, 1)}%
                    </td>
                    <td className="font-mono text-xs text-gray-300">{n(s.profit_factor, 2)}</td>
                    <td className="font-mono text-xs text-brand">{n(s.composite_score, 4)}</td>
                    <td className="font-mono text-xs text-gray-500">{s.total_trades ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Available assets by group (filtered by timeframe) */}
      <div className="bg-bg-surface border border-bg-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-bg-border flex items-center gap-2">
          <Layers className="w-4 h-4 text-brand" />
          <span className="text-sm font-medium text-gray-300">Available assets</span>
          <span className="text-xs text-gray-600">(timeframe {timeframe}s)</span>
        </div>
        <div className="p-4 flex flex-wrap gap-2">
          {assetGroups.map((g) => (
            <div key={g.label} className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] uppercase text-gray-600 font-medium">{g.label}:</span>
              {g.assets.map((a) => (
                <span key={a} className="px-1.5 py-0.5 rounded bg-bg-raised border border-bg-border text-[11px] font-mono text-gray-400">
                  {a}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Available strategies */}
      <div className="bg-bg-surface border border-bg-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-bg-border">
          <span className="text-sm font-medium text-gray-300">Available strategies</span>
          <span className="text-xs text-gray-600 ml-2">({strategies.length})</span>
        </div>
        <div className="p-4 flex flex-wrap gap-1.5">
          {strategies.map((name) => (
            <span
              key={name}
              className="px-2 py-0.5 rounded bg-bg-raised border border-bg-border text-[11px] text-gray-400"
            >
              {name.replace(/_/g, " ")}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
