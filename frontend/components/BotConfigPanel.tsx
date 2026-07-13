"use client";

import { useState } from "react";
import type { BotConfig, BotState } from "@/types";
import { Play, StopCircle, Settings, ChevronDown, ChevronUp, Eye, EyeOff, Zap, Check, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { patchLiveConfig } from "@/lib/api";

const TIMEFRAMES = [
  { label: "5s",  value: 5,    hint: "Ultra scalp" },
  { label: "15s", value: 15,   hint: "Scalping" },
  { label: "30s", value: 30,   hint: "Scalping" },
  { label: "1m",  value: 60,   hint: "Day trade ★" },
  { label: "2m",  value: 120,  hint: "Day trade" },
  { label: "5m",  value: 300,  hint: "Swing" },
  { label: "15m", value: 900,  hint: "Swing" },
  { label: "1h",  value: 3600, hint: "Position" },
];

const ASSET_GROUPS = [
  {
    label: "Forex OTC",
    assets: ["EURUSD-OTC","GBPUSD-OTC","EURJPY-OTC","USDJPY-OTC",
             "AUDUSD-OTC","USDCAD-OTC","EURGBP-OTC","AUDCAD-OTC","NZDUSD-OTC"],
  },
  {
    label: "Forex",
    assets: ["EURUSD","GBPUSD","USDJPY","AUDUSD","USDCAD","EURGBP"],
  },
  {
    label: "Crypto OTC",
    assets: ["BTCUSD-OTC","ETHUSD-OTC","LTCUSD-OTC","XRPUSD-OTC"],
  },
  {
    label: "Crypto",
    assets: ["BTCUSD","ETHUSD","BNBUSD","SOLUSD"],
  },
  {
    label: "Stocks OTC",
    assets: ["AAPL-OTC","GOOG-OTC","MSFT-OTC","AMZN-OTC","TSLA-OTC","META-OTC"],
  },
  {
    label: "Commodities",
    assets: ["XAUUSD","XAGUSD","XAUUSD-OTC"],
  },
];

const AI_PROVIDERS: { value: NonNullable<BotConfig["ai_provider"]>; label: string; model: string }[] = [
  { value: "deepseek",  label: "DeepSeek (default)", model: "deepseek-chat" },
  { value: "openai",    label: "ChatGPT (OpenAI)",   model: "gpt-4o-mini" },
  { value: "gemini",    label: "Gemini (Google)",    model: "gemini-2.0-flash" },
  { value: "anthropic", label: "Claude (Anthropic)", model: "claude-sonnet-4-5" },
];

const DEFAULT_CONFIG: BotConfig = {
  email: "",
  password: "",
  account_type: "PRACTICE",
  timeframe: 60,
  assets: ["EURUSD-OTC", "GBPUSD-OTC", "EURJPY-OTC"],
  investment_amount: 1,
  investment_mode: "fixed",
  investment_pct: 5,
  max_daily_loss_pct: 5,
  max_consecutive_losses: 5,
  min_win_rate: 0.55,
  hard_stop_pct: 75,
  backtest_periods: 150,
  strategy_eval_interval: 300,
  portfolio_size: 3,
  ml_model_type: "auto",
  news_api_key: "",
  ai_provider: "deepseek",
  ai_api_key: "",
  ai_base_url: "",
  ai_model: "",
  expiration_minutes: 1,
  expiration_seconds: undefined as number | undefined,
  use_compound_interest: false,
  compound_factor: 1.0,
  min_win_rate_for_compound: 0.55,
};

interface Props {
  status: BotState["status"];
  loading: boolean;
  onStart: (config: BotConfig) => void;
  onStop: () => void;
  onTest?: (email: string, password: string) => void;
}

export default function BotConfigPanel({ status, loading, onStart, onStop, onTest }: Props) {
  const [config, setConfig]         = useState<BotConfig>(DEFAULT_CONFIG);
  const [expanded, setExpanded]     = useState(true);
  const [showPass, setShowPass]     = useState(false);
  const [assetInput, setAssetInput] = useState("");

  // Live-patch state (investment + compound, editable while bot is running)
  const [liveAmt,        setLiveAmt]        = useState<string>("");
  const [liveCompound,   setLiveCompound]   = useState<boolean | null>(null);
  const [liveFactor,     setLiveFactor]     = useState<string>("");
  const [liveMinWR,      setLiveMinWR]      = useState<string>("");
  const [patchStatus,    setPatchStatus]    = useState<"idle" | "saving" | "ok" | "error">("idle");
  const [patchMsg,       setPatchMsg]       = useState<string>("");

  const isRunning = status === "running" || status === "connecting" || status === "evaluating";

  const set = <K extends keyof BotConfig>(k: K, v: BotConfig[K]) =>
    setConfig(prev => ({ ...prev, [k]: v }));

  const toggleAsset = (a: string) =>
    set("assets", config.assets.includes(a)
      ? config.assets.filter(x => x !== a)
      : [...config.assets, a]
    );

  const addCustomAsset = () => {
    const a = assetInput.trim().toUpperCase();
    if (a && !config.assets.includes(a)) {
      set("assets", [...config.assets, a]);
    }
    setAssetInput("");
  };

  return (
    <div className="bg-bg-surface border border-bg-border rounded-xl overflow-hidden">

      {/* Header */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-bg-raised transition-colors"
      >
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-brand" />
          <span className="font-medium text-sm">Bot Configuration</span>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 flex flex-col gap-4">
          <hr className="border-bg-border" />

          {/* Credentials */}
          <section>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2 font-medium">Credentials</p>
            <div className="flex flex-col gap-2">
              <input
                type="email"
                placeholder="IQ Option email"
                value={config.email}
                onChange={e => set("email", e.target.value)}
                disabled={isRunning}
                className="w-full bg-bg-raised border border-bg-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand/50 disabled:opacity-50"
              />
              <div className="relative">
                <input
                  type={showPass ? "text" : "password"}
                  placeholder="Password"
                  value={config.password}
                  onChange={e => set("password", e.target.value)}
                  disabled={isRunning}
                  className="w-full bg-bg-raised border border-bg-border rounded-lg px-3 py-2 pr-9 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand/50 disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                >
                  {showPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </section>

          {/* Account type */}
          <section>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2 font-medium">Account</p>
            <div className="flex gap-2">
              {(["PRACTICE", "REAL"] as const).map(t => (
                <button
                  key={t}
                  onClick={() => set("account_type", t)}
                  disabled={isRunning}
                  className={cn(
                    "flex-1 py-1.5 rounded-lg text-xs font-medium border transition-all",
                    config.account_type === t
                      ? t === "REAL"
                        ? "bg-loss/20 border-loss/50 text-loss"
                        : "bg-profit/20 border-profit/50 text-profit"
                      : "bg-bg-raised border-bg-border text-gray-500 hover:text-gray-300"
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </section>

          {/* Timeframe */}
          <section>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2 font-medium">
              Timeframe
            </p>
            <div className="grid grid-cols-4 gap-1">
              {TIMEFRAMES.map(tf => (
                <button
                  key={tf.value}
                  onClick={() => set("timeframe", tf.value)}
                  disabled={isRunning}
                  title={tf.hint}
                  className={cn(
                    "py-1.5 px-1 rounded-lg text-xs font-mono font-medium border transition-all flex flex-col items-center",
                    config.timeframe === tf.value
                      ? "bg-brand/15 border-brand/40 text-brand"
                      : "bg-bg-raised border-bg-border text-gray-500 hover:text-gray-300"
                  )}
                >
                  <span>{tf.label}</span>
                  <span className="text-[8px] opacity-60 font-sans normal-case">{tf.hint}</span>
                </button>
              ))}
            </div>
          </section>

          {/* Assets */}
          <section>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2 font-medium">
              Assets ({config.assets.length} selected)
            </p>
            <div className="flex flex-col gap-2 mb-2">
              {ASSET_GROUPS.map(grp => (
                <div key={grp.label}>
                  <p className="text-[9px] text-gray-700 uppercase tracking-wider mb-1">{grp.label}</p>
                  <div className="flex flex-wrap gap-1">
                    {grp.assets.map(a => (
                      <button
                        key={a}
                        onClick={() => toggleAsset(a)}
                        disabled={isRunning}
                        className={cn(
                          "px-1.5 py-0.5 rounded text-[10px] font-mono border transition-all",
                          config.assets.includes(a)
                            ? "bg-brand/15 border-brand/40 text-brand"
                            : "bg-bg-raised border-bg-border text-gray-600 hover:text-gray-400"
                        )}
                      >
                        {a.replace("-OTC", "†")}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="text-[9px] text-gray-700 mb-2">† = OTC (available 24/7)</div>
            <div className="flex gap-2">
              <input
                value={assetInput}
                onChange={e => setAssetInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addCustomAsset()}
                placeholder="Custom asset (e.g. XAUUSD-OTC)"
                disabled={isRunning}
                className="flex-1 bg-bg-raised border border-bg-border rounded-lg px-2 py-1 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-brand/50"
              />
              <button
                onClick={addCustomAsset}
                disabled={isRunning}
                className="px-2 py-1 rounded-lg bg-bg-raised border border-bg-border text-xs text-gray-400 hover:text-white"
              >
                Add
              </button>
            </div>
          </section>

          {/* Risk params */}
          <section>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2 font-medium">Risk / Size</p>
            <div className="flex flex-col gap-2">

              {/* Investment mode toggle */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-gray-500">Investment mode</label>
                  <div className="flex gap-1">
                    {(["fixed", "percent"] as const).map(m => (
                      <button
                        key={m}
                        onClick={() => set("investment_mode", m)}
                        disabled={isRunning}
                        className={cn(
                          "px-2.5 py-1 rounded text-xs font-medium border transition-all",
                          config.investment_mode === m
                            ? "bg-brand/20 border-brand/40 text-brand"
                            : "bg-bg-raised border-bg-border text-gray-500 hover:text-gray-300 disabled:opacity-50"
                        )}
                      >
                        {m === "fixed" ? "Fixed $" : "% Balance"}
                      </button>
                    ))}
                  </div>
                </div>

                {config.investment_mode === "fixed" ? (
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs text-gray-500 shrink-0 w-32">Amount per trade ($)</label>
                    <input
                      type="number"
                      value={config.investment_amount}
                      onChange={e => set("investment_amount", parseFloat(e.target.value))}
                      min={0.01} step={0.5}
                      disabled={isRunning}
                      className="w-20 bg-bg-raised border border-bg-border rounded px-2 py-1 text-xs font-mono text-right text-white focus:outline-none focus:border-brand/50 disabled:opacity-50"
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs text-gray-500 shrink-0 w-32">% of balance</label>
                    <input
                      type="number"
                      value={config.investment_pct}
                      onChange={e => set("investment_pct", parseFloat(e.target.value))}
                      min={0.1} max={50} step={0.5}
                      disabled={isRunning}
                      className="w-20 bg-bg-raised border border-bg-border rounded px-2 py-1 text-xs font-mono text-right text-white focus:outline-none focus:border-brand/50 disabled:opacity-50"
                    />
                  </div>
                )}
                <p className="text-[10px] text-gray-700">
                  {config.investment_mode === "fixed"
                    ? "Trades a fixed dollar amount regardless of balance."
                    : "Trades a percentage of your current balance each time."}
                </p>
              </div>

              {/* Soft-limit row label with indicator */}
              <p className="text-[10px] text-yellow-500/80 mb-1">
                ⚠ Soft limits — position size halved, bot keeps running
              </p>
              {[
                { label: "Daily loss warn (%)",   key: "max_daily_loss_pct",     min: 1,    step: 0.5,  max: 100   },
                { label: "Consec. loss warn",     key: "max_consecutive_losses", min: 1,    step: 1,    max: 20    },
                { label: "Min win rate warn",     key: "min_win_rate",           min: 0.5,  step: 0.01, max: 1     },
              ].map(f => (
                <div key={f.key} className="flex items-center justify-between gap-2">
                  <label className="text-xs text-gray-500 shrink-0 w-32">{f.label}</label>
                  <input
                    type="number"
                    value={config[f.key as keyof BotConfig] as number}
                    onChange={e => set(f.key as keyof BotConfig, parseFloat(e.target.value) as any)}
                    min={f.min} step={f.step} max={f.max}
                    disabled={isRunning}
                    className="w-20 bg-bg-raised border border-bg-border rounded px-2 py-1 text-xs font-mono text-right text-white focus:outline-none focus:border-brand/50 disabled:opacity-50"
                  />
                </div>
              ))}
              {/* Hard stop — the only real kill-switch */}
              <p className="text-[10px] text-red-400/80 mt-2 mb-1">
                🛑 Hard stop — bot halts completely when triggered
              </p>
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs text-gray-500 shrink-0 w-32">Hard stop loss (%)</label>
                <input
                  type="number"
                  value={config.hard_stop_pct}
                  onChange={e => set("hard_stop_pct", parseFloat(e.target.value))}
                  min={10} max={99} step={5}
                  disabled={isRunning}
                  className="w-20 bg-bg-raised border border-red-500/30 rounded px-2 py-1 text-xs font-mono text-right text-red-300 focus:outline-none focus:border-red-500/60 disabled:opacity-50"
                />
              </div>
              <p className="text-[10px] text-gray-700">Stop ALL trading when balance drops by this % of session start.</p>
              {[
                { label: "Backtest candles",      key: "backtest_periods",       min: 50,   step: 25,   max: 500   },
                { label: "Portfolio size",         key: "portfolio_size",         min: 1,    step: 1,    max: 8     },
              ].map(f => (
                <div key={f.key} className="flex items-center justify-between gap-2">
                  <label className="text-xs text-gray-500 shrink-0 w-32">{f.label}</label>
                  <input
                    type="number"
                    value={config[f.key as keyof BotConfig] as number}
                    onChange={e => set(f.key as keyof BotConfig, parseFloat(e.target.value) as any)}
                    min={f.min} step={f.step} max={f.max}
                    disabled={isRunning}
                    className="w-20 bg-bg-raised border border-bg-border rounded px-2 py-1 text-xs font-mono text-right text-white focus:outline-none focus:border-brand/50 disabled:opacity-50"
                  />
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2 mt-2">
              <label className="text-xs text-gray-500 shrink-0 w-32">Expiration (sec)</label>
              <input
                type="number"
                placeholder="e.g. 30"
                value={config.expiration_seconds ?? ""}
                onChange={e => {
                  const v = e.target.value;
                  set("expiration_seconds", v === "" ? undefined : (parseInt(v, 10) || undefined));
                }}
                min={15} max={300} step={15}
                disabled={isRunning}
                className="w-20 bg-bg-raised border border-bg-border rounded px-2 py-1 text-xs font-mono text-right text-white placeholder-gray-600 focus:outline-none focus:border-brand/50 disabled:opacity-50"
              />
            </div>
            <p className="text-[10px] text-gray-600 mt-0.5">Optional: 30 = wait candle close → enter → result in 30s. Empty = use expiration (min).</p>
          </section>

          {/* Compound Interest */}
          <section>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2 font-medium">Compound Interest</p>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-xs text-gray-400">Enable compound interest</label>
                <button
                  onClick={() => set("use_compound_interest", !config.use_compound_interest)}
                  disabled={isRunning}
                  className={cn(
                    "relative inline-flex h-5 w-9 items-center rounded-full transition-colors border",
                    config.use_compound_interest
                      ? "bg-brand/30 border-brand/50"
                      : "bg-bg-raised border-bg-border"
                  )}
                >
                  <span className={cn(
                    "inline-block h-3.5 w-3.5 transform rounded-full transition-transform mx-0.5",
                    config.use_compound_interest ? "translate-x-4 bg-brand" : "translate-x-0 bg-gray-600"
                  )} />
                </button>
              </div>
              {config.use_compound_interest && (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs text-gray-500 shrink-0 w-32">Growth factor</label>
                    <input
                      type="number" value={config.compound_factor}
                      onChange={e => set("compound_factor", parseFloat(e.target.value))}
                      min={0} step={0.1} max={3}
                      disabled={isRunning}
                      className="w-20 bg-bg-raised border border-bg-border rounded px-2 py-1 text-xs font-mono text-right text-white focus:outline-none focus:border-brand/50 disabled:opacity-50"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs text-gray-500 shrink-0 w-32">Min WR to compound</label>
                    <input
                      type="number" value={config.min_win_rate_for_compound}
                      onChange={e => set("min_win_rate_for_compound", parseFloat(e.target.value))}
                      min={0.5} step={0.01} max={1}
                      disabled={isRunning}
                      className="w-20 bg-bg-raised border border-bg-border rounded px-2 py-1 text-xs font-mono text-right text-white focus:outline-none focus:border-brand/50 disabled:opacity-50"
                    />
                  </div>
                  <p className="text-[10px] text-gray-600 leading-relaxed">
                    Factor 0=fixed · 1=linear growth · 2=aggressive. Position = base × (balance/start)^factor.
                    Compounds only when session win rate ≥ min WR.
                  </p>
                </>
              )}
            </div>
          </section>

          {/* News API */}
          <section>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2 font-medium">News API (optional)</p>
            <input
              type="text"
              placeholder="NewsAPI.org key"
              value={config.news_api_key ?? ""}
              onChange={e => set("news_api_key", e.target.value)}
              disabled={isRunning}
              className="w-full bg-bg-raised border border-bg-border rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-brand/50 disabled:opacity-50 font-mono"
            />
          </section>

          {/* AI Settings */}
          <section className="space-y-3">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2 font-medium">Generative AI (optional)</p>
            <select
              value={config.ai_provider ?? "deepseek"}
              onChange={e => set("ai_provider", e.target.value as BotConfig["ai_provider"])}
              disabled={isRunning}
              className="w-full bg-bg-raised border border-bg-border rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-brand/50 disabled:opacity-50 font-mono"
            >
              {AI_PROVIDERS.map(p => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder={`${AI_PROVIDERS.find(p => p.value === (config.ai_provider ?? "deepseek"))?.label} API Key`}
              value={config.ai_api_key ?? ""}
              onChange={e => set("ai_api_key", e.target.value)}
              disabled={isRunning}
              className="w-full bg-bg-raised border border-bg-border rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-brand/50 disabled:opacity-50 font-mono"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                placeholder="Base URL (optional override)"
                value={config.ai_base_url ?? ""}
                onChange={e => set("ai_base_url", e.target.value)}
                disabled={isRunning}
                className="w-full bg-bg-raised border border-bg-border rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-brand/50 disabled:opacity-50 font-mono"
              />
              <input
                type="text"
                placeholder={`Model (default: ${AI_PROVIDERS.find(p => p.value === (config.ai_provider ?? "deepseek"))?.model})`}
                value={config.ai_model ?? ""}
                onChange={e => set("ai_model", e.target.value)}
                disabled={isRunning}
                className="w-full bg-bg-raised border border-bg-border rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-brand/50 disabled:opacity-50 font-mono"
              />
            </div>
          </section>

          {/* ML model (meta-labeling) */}
          <section className="space-y-2">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1 font-medium">Learning model (ML)</p>
            <select
              value={config.ml_model_type ?? "auto"}
              onChange={e => set("ml_model_type", e.target.value as BotConfig["ml_model_type"])}
              disabled={isRunning}
              className="w-full bg-bg-raised border border-bg-border rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-brand/50 disabled:opacity-50 font-mono"
            >
              <option value="auto">Auto — logistic now, XGBoost once there's data (recommended)</option>
              <option value="logistic">Logistic Regression — simple & stable</option>
              <option value="xgboost">XGBoost — advanced, needs lots of trades</option>
            </select>
            <p className="text-[10px] text-gray-700 leading-relaxed">
              The model that learns from your trade history and adjusts each signal's confidence.
              One shared model uses <span className="text-gray-500">asset</span> as a feature — better than
              starving a separate model per asset.
            </p>
          </section>

          {/* Test credentials button */}
          {!isRunning && onTest && config.email && config.password && (
            <button
              onClick={() => onTest(config.email, config.password)}
              disabled={loading}
              className="w-full py-2 rounded-lg text-xs font-medium border border-bg-border text-gray-500 hover:text-gray-300 hover:border-gray-500 transition-all"
            >
              Test Credentials
            </button>
          )}

          {/* ── Live Controls (visible only while bot is running) ── */}
          {isRunning && (
            <section className="border border-brand/20 bg-brand/5 rounded-xl p-3 flex flex-col gap-2">
              <div className="flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-brand" />
                <p className="text-xs font-semibold text-brand">Live Controls</p>
                <span className="text-[9px] text-gray-600 ml-1">applies on next trade — no restart needed</span>
              </div>

              {/* Investment mode + amount */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs text-gray-400 shrink-0 w-32">
                    {liveAmt.startsWith("%") ? "% of balance" : "Investment ($)"}
                  </label>
                  <div className="flex items-center gap-1">
                    <button
                      onMouseDown={e => { e.preventDefault(); setLiveAmt(v => v.startsWith("%") ? v.slice(1) : "%"); }}
                      className={cn("px-1.5 py-0.5 rounded text-[10px] border transition-all",
                        liveAmt.startsWith("%")
                          ? "bg-brand/20 border-brand/40 text-brand"
                          : "border-bg-border text-gray-600 hover:text-gray-300")}
                    >
                      {liveAmt.startsWith("%") ? "%" : "$"}
                    </button>
                    <input
                      type="number"
                      placeholder={liveAmt.startsWith("%") ? String(config.investment_pct) : String(config.investment_amount)}
                      value={liveAmt.replace("%", "")}
                      onChange={e => setLiveAmt((liveAmt.startsWith("%") ? "%" : "") + e.target.value)}
                      min={0.01} step={0.5}
                      className="w-20 bg-bg-raised border border-brand/20 rounded px-2 py-1 text-xs font-mono text-right text-white focus:outline-none focus:border-brand/50"
                    />
                  </div>
                </div>
              </div>

              {/* Compound toggle */}
              <div className="flex items-center justify-between">
                <label className="text-xs text-gray-400">Compound interest</label>
                <button
                  onClick={() => setLiveCompound(v => v === null ? !config.use_compound_interest : !v)}
                  className={cn(
                    "relative inline-flex h-5 w-9 items-center rounded-full transition-colors border",
                    (liveCompound ?? config.use_compound_interest)
                      ? "bg-brand/30 border-brand/50"
                      : "bg-bg-raised border-bg-border"
                  )}
                >
                  <span className={cn(
                    "inline-block h-3.5 w-3.5 transform rounded-full transition-transform mx-0.5",
                    (liveCompound ?? config.use_compound_interest) ? "translate-x-4 bg-brand" : "translate-x-0 bg-gray-600"
                  )} />
                </button>
              </div>

              {(liveCompound ?? config.use_compound_interest) && (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs text-gray-400 shrink-0 w-32">Growth factor</label>
                    <input
                      type="number"
                      placeholder={String(config.compound_factor)}
                      value={liveFactor}
                      onChange={e => setLiveFactor(e.target.value)}
                      min={0} step={0.1} max={3}
                      className="w-24 bg-bg-raised border border-brand/20 rounded px-2 py-1 text-xs font-mono text-right text-white focus:outline-none focus:border-brand/50"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs text-gray-400 shrink-0 w-32">Min WR to compound</label>
                    <input
                      type="number"
                      placeholder={String(config.min_win_rate_for_compound)}
                      value={liveMinWR}
                      onChange={e => setLiveMinWR(e.target.value)}
                      min={0.5} step={0.01} max={1}
                      className="w-24 bg-bg-raised border border-brand/20 rounded px-2 py-1 text-xs font-mono text-right text-white focus:outline-none focus:border-brand/50"
                    />
                  </div>
                </>
              )}

              {/* Feedback */}
              {patchStatus !== "idle" && (
                <div className={cn("flex items-center gap-1.5 text-xs rounded px-2 py-1",
                  patchStatus === "ok"    && "text-profit bg-profit/10",
                  patchStatus === "error" && "text-loss bg-loss/10",
                  patchStatus === "saving"&& "text-gray-400 bg-bg-raised",
                )}>
                  {patchStatus === "ok"    && <Check className="w-3 h-3 shrink-0" />}
                  {patchStatus === "error" && <AlertCircle className="w-3 h-3 shrink-0" />}
                  {patchStatus === "saving"&& <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin shrink-0" />}
                  <span>{patchMsg}</span>
                </div>
              )}

              <button
                disabled={patchStatus === "saving"}
                onClick={async () => {
                  const patch: Parameters<typeof patchLiveConfig>[0] = {};
                  if (liveAmt !== "" && liveAmt !== "%") {
                    const numVal = parseFloat(liveAmt.replace("%",""));
                    if (!isNaN(numVal)) {
                      if (liveAmt.startsWith("%")) {
                        patch.investment_mode = "percent";
                        patch.investment_pct  = numVal;
                      } else {
                        patch.investment_mode   = "fixed";
                        patch.investment_amount = numVal;
                      }
                    }
                  }
                  if (liveCompound !== null) patch.use_compound_interest = liveCompound;
                  if (liveFactor !== "") patch.compound_factor           = parseFloat(liveFactor);
                  if (liveMinWR !== "")  patch.min_win_rate_for_compound = parseFloat(liveMinWR);
                  if (!Object.keys(patch).length) { setPatchStatus("error"); setPatchMsg("Nothing to apply."); return; }
                  setPatchStatus("saving");
                  try {
                    const res = await patchLiveConfig(patch);
                    // Reflect confirmed values back into local config
                    setConfig(prev => ({
                      ...prev,
                      ...(res.investment_amount         != null && { investment_amount: res.investment_amount }),
                      ...(res.use_compound_interest     != null && { use_compound_interest: res.use_compound_interest }),
                      ...(res.compound_factor           != null && { compound_factor: res.compound_factor }),
                      ...(res.min_win_rate_for_compound != null && { min_win_rate_for_compound: res.min_win_rate_for_compound }),
                    }));
                    setLiveAmt(""); setLiveCompound(null); setLiveFactor(""); setLiveMinWR("");
                    setPatchStatus("ok");
                    setPatchMsg(res.message ?? "Applied successfully.");
                    setTimeout(() => setPatchStatus("idle"), 3000);
                  } catch (err: any) {
                    setPatchStatus("error");
                    setPatchMsg(err.message ?? "Failed to apply.");
                    setTimeout(() => setPatchStatus("idle"), 4000);
                  }
                }}
                className="w-full py-1.5 rounded-lg bg-brand/15 hover:bg-brand/25 border border-brand/40 text-brand text-xs font-semibold transition-all disabled:opacity-40"
              >
                Apply to next trade
              </button>
            </section>
          )}

          {/* Action button */}
          <button
            onClick={() => isRunning ? onStop() : onStart(config)}
            disabled={loading || (!isRunning && (!config.email || !config.password))}
            className={cn(
              "w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all",
              isRunning
                ? "bg-loss/20 hover:bg-loss/30 border border-loss/50 text-loss"
                : "bg-brand/15 hover:bg-brand/25 border border-brand/40 text-brand shadow-glow-sm",
              (loading || (!isRunning && (!config.email || !config.password))) && "opacity-40 cursor-not-allowed"
            )}
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : isRunning ? (
              <><StopCircle className="w-4 h-4" /> Stop Bot</>
            ) : (
              <><Play className="w-4 h-4" /> Start Bot</>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
