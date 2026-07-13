export interface BotConfig {
  email: string;
  password: string;
  account_type: "PRACTICE" | "REAL";
  timeframe: number;
  assets: string[];
  investment_amount: number;
  investment_mode:   "fixed" | "percent";
  investment_pct:    number;
  max_daily_loss_pct: number;
  max_consecutive_losses: number;
  min_win_rate: number;
  backtest_periods: number;
  strategy_eval_interval: number;
  portfolio_size?: number;
  ml_model_type?: "auto" | "logistic" | "xgboost";
  news_api_key?: string;
  ai_provider?: "deepseek" | "openai" | "gemini" | "anthropic";
  ai_api_key?: string;
  ai_base_url?: string;
  ai_model?: string;
  expiration_minutes: number;
  expiration_seconds?: number;
  // Compound interest
  use_compound_interest: boolean;
  compound_factor: number;
  min_win_rate_for_compound: number;
  // Hard stop (only true kill-switch; daily/consec loss are now soft warnings)
  hard_stop_pct: number;
}

export interface Trade {
  id: number;
  order_id: string | null;
  asset: string;
  direction: "call" | "put";
  amount: number;
  expiration_minutes: number;
  strategy_name: string;
  confidence: number;
  open_price: number | null;
  close_price: number | null;
  profit: number | null;
  win: boolean | null;
  opened_at: string;
  closed_at: string | null;
  timeframe: number;
  account_type: string;
  balance_before?: number | null;   // balance when trade was placed
  balance_after?: number | null;    // balance after result settled
  ml_score?: number | null;         // ML win-probability estimate (0-1), if model was ready
  raw_confidence?: number | null;   // strategy's own confidence before ML blending
  allocation?: number | null;       // capital share (0-1) within the portfolio
}

export interface StrategyResult {
  strategy_name: string;
  asset: string;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  profit_factor: number;
  max_drawdown: number;
  composite_score: number;
  evaluated_at?: string;
  signals?: string[];   // "call" | "put" | "neutral"
  allocation?: number;  // 0-1 share of capital when part of the active portfolio
}

export interface MLMetrics {
  reliable?: boolean;
  reason?: string;
  model?: string;
  trained_on?: number;
  test_size?: number;
  accuracy?: number;              // 0-1, held-out accuracy
  baseline_accuracy?: number;     // 0-1, accuracy of always guessing the majority outcome
  edge_over_guessing?: number;    // accuracy - baseline
  auc?: number | null;            // 0.5 = coin flip, 1.0 = perfect
  summary?: string;
}

export interface MLScorerStatus {
  ready: boolean;
  trained_on: number;
  model_type?: "auto" | "logistic" | "xgboost";
  active_model?: "logistic" | "xgboost" | null;
  metrics?: MLMetrics;
}

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  datetime?: string;
}

export interface AnalysisData {
  asset: string | null;
  strategy: string | null;
  win_rate: number;
  candles: Candle[];
  signals: string[];
}

export interface DailyPnL {
  date: string;
  total_profit: number;
  total_trades: number;
  winning_trades: number;
  win_rate: number;
}

export interface NewsArticle {
  title: string;
  description: string;
  url: string;
  source: string;
  published_at: string;
  sentiment: "positive" | "negative" | "neutral";
  asset?: string;
}

export interface RiskSummary {
  daily_profit: number;
  consecutive_losses: number;
  total_trades: number;
  total_wins: number;
  overall_win_rate: number;
  max_daily_loss: number;
  hard_stop_floor?: number;
  risk_level?: "normal" | "warning" | "halted";
  warning_reasons?: string[];
}

export interface BotState {
  status: "idle" | "connecting" | "evaluating" | "running" | "stopped" | "error";
  balance: number;
  best_combo: StrategyResult | null;
  all_results: StrategyResult[];
  portfolio?: StrategyResult[];
  ml_scorer?: MLScorerStatus;
  open_trades: number;
  risk: RiskSummary;
}

export interface TradeStats {
  total_trades: number;
  winning_trades: number;
  win_rate: number;
  total_profit: number;
}

export interface LogMessage {
  id: string;
  timestamp: string;
  level: "info" | "success" | "warning" | "error" | "trade";
  message: string;
}

export interface AgentInfo {
  status: string;
  task: string;
  last_output: string;
  cycle: number;
  last_run: string;
}

export interface AgentActivityEntry {
  agent: string;
  status: string;
  message: string;
  time: string;
}

export type WsMessage =
  | { type: "status_change"; status: BotState["status"] }
  | { type: "trade_opened"; trade: Trade; balance: number }
  | { type: "trade_closed"; order_id: string; profit: number; win: boolean; balance: number; risk: RiskSummary }
  | { type: "trade_blocked"; reason: string }
  | { type: "risk_warning"; message: string; risk: RiskSummary }
  | { type: "evaluation_update"; results: StrategyResult[]; best: StrategyResult | null; portfolio?: StrategyResult[] }
  | { type: "state" } & BotState
  | { type: "agent_orchestrator_update"; agents: Record<string, AgentInfo>; activity_log: AgentActivityEntry[]; cycle: number; timestamp: string }
  | { type: "log"; level: LogMessage["level"]; message: string; timestamp: string };
