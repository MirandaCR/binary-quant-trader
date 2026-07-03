import type { BotConfig, Trade, TradeStats, StrategyResult, DailyPnL, NewsArticle, BotState } from "@/types";

// Hardcoded to avoid env-var resolution issues in Windows/Anaconda environments
const BASE = "http://localhost:8100";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "API error");
  }
  return res.json();
}

// ── Bot control ───────────────────────────────────────────────────────────────

export const startBot = (config: BotConfig) =>
  request<{ status: string; message: string }>("/api/bot/start", {
    method: "POST",
    body: JSON.stringify(config),
  });

export const testLogin = (email: string, password: string) =>
  request<{ status: string; balance?: number; message: string }>("/api/bot/test-login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

export const submit2FA = (code: string) =>
  request<{ status: string; message: string }>("/api/bot/2fa", {
    method: "POST",
    body: JSON.stringify({ code }),
  });

export const stopBot = () =>
  request<{ status: string }>("/api/bot/stop", { method: "POST" });

export const overrideRisk = () =>
  request<{ status: string; message: string }>("/api/bot/override-risk", { method: "POST" });

export const resumeBot = () =>
  request<{ status: string; message: string }>("/api/bot/resume", { method: "POST" });

export interface LiveConfigPatch {
  investment_amount?:         number;
  investment_mode?:           "fixed" | "percent";
  investment_pct?:            number;
  use_compound_interest?:     boolean;
  compound_factor?:           number;
  min_win_rate_for_compound?: number;
}

export const patchLiveConfig = (patch: LiveConfigPatch) =>
  request<{ status: string; message: string } & LiveConfigPatch>("/api/bot/config/live", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

export const getBotStatus = () => request<BotState>("/api/bot/status");

// ── Trades ────────────────────────────────────────────────────────────────────

export const getTrades = (limit = 50, offset = 0, asset?: string) => {
  const qs = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    ...(asset ? { asset } : {}),
  });
  return request<{ trades: Trade[]; stats: TradeStats }>(`/api/trades?${qs}`);
};

export const getTodayTrades = () =>
  request<{ trades: Trade[] }>("/api/trades/today");

export const clearTradeHistory = () =>
  request<{ deleted: number; message: string }>("/api/trades", { method: "DELETE" });

// ── Analytics ─────────────────────────────────────────────────────────────────

export const getPnL = (days = 60) =>
  request<{ pnl: DailyPnL[] }>(`/api/analytics/pnl?days=${days}`);

export const deletePnLByDate = (dateStr: string) =>
  request<{ deleted: boolean; date: string }>(`/api/analytics/pnl/${dateStr}`, { method: "DELETE" });

export const getStrategyEvals = () =>
  request<{ evaluations: StrategyResult[] }>("/api/analytics/strategies");

// ── News ──────────────────────────────────────────────────────────────────────

export const getNews = (asset?: string) => {
  const qs = asset ? `?asset=${asset}` : "";
  return request<{ articles: NewsArticle[] }>(`/api/news${qs}`);
};

// ── Suggestions ───────────────────────────────────────────────────────────────

export interface SuggestionsResponse {
  asset_groups: { label: string; assets: string[] }[];
  assets: string[];
  strategies: string[];
  suggestions: StrategyResult[];
  timeframe?: number;
}

export const getSuggestions = (timeframe?: number) => {
  const qs = timeframe != null ? `?timeframe=${timeframe}` : "";
  return request<SuggestionsResponse>(`/api/suggestions${qs}`);
};

export const runSuggestionsPipeline = () =>
  request<{ steps: { agent: string; status: string; message: string }[]; new_strategies_added: string[]; pruned: string[] }>(
    "/api/suggestions/pipeline",
    { method: "POST" }
  );

// Ask LLM (OpenAI/Flexi) for new strategies to test
export const askStrategySuggestions = (body?: { api_key?: string; base_url?: string }) =>
  request<{ suggestions: string[]; raw_response: string; error: string | null }>(
    "/api/strategies/ask",
    { method: "POST", body: JSON.stringify(body ?? {}) }
  );
