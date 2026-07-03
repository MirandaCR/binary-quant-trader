"use client";

import { useState } from "react";
import { useBot } from "@/hooks/useBot";
import Header from "@/components/Header";
import StatsCards from "@/components/StatsCards";
import BotConfigPanel from "@/components/BotConfigPanel";
import TradeHistory from "@/components/TradeHistory";
import StrategyPerformance from "@/components/StrategyPerformance";
import PortfolioPanel from "@/components/PortfolioPanel";
import PnLCalendar from "@/components/PnLCalendar";
import NewsPanel from "@/components/NewsPanel";
import LiveTicker from "@/components/LiveTicker";
import ConsolePanel from "@/components/ConsolePanel";
import AgentFlow from "@/components/AgentFlow";
import TradeBlockedModal from "@/components/TradeBlockedModal";
import InfoModal from "@/components/InfoModal";

type Tab = "overview" | "agents" | "strategies" | "calendar" | "news" | "console";

const TAB_LABELS: Record<Tab, string> = {
  overview:   "Overview",
  agents:     "AI Agents",
  strategies: "Strategies",
  calendar:   "Calendar",
  news:       "News",
  console:    "Console",
};

export default function DashboardPage() {
  const {
    state, trades, pnl, news, logs,
    agentsState, agentActivityLog, agentCycle,
    tradeBlockedReason, setTradeBlockedReason,
    riskWarning, setRiskWarning,
    loading, startBot, stopBot, restartBot, resumeBot,
    refreshNews, refreshPnl, deletePnLDate, testLogin, clearHistory, overrideRisk,
  } = useBot();

  const [activeTab, setActiveTab] = useState<Tab>("overview");

  const winningTrades = trades.filter(t => t.win === true).length;
  const totalClosed   = trades.filter(t => t.win !== null).length;
  const totalProfit   = trades.reduce((s, t) => s + (t.profit ?? 0), 0);
  const winRate       = totalClosed > 0 ? winningTrades / totalClosed : 0;

  const hasAgents = Object.keys(agentsState).length > 0;

  return (
    <div className="min-h-screen bg-bg-base flex flex-col">
      <Header status={state.status} balance={state.balance} />

      {/* Live ticker bar */}
      <LiveTicker bestCombo={state.best_combo} openTrades={state.open_trades} risk={state.risk} />

      <main className="flex-1 p-4 lg:p-6 max-w-[1800px] mx-auto w-full">

        {/* Risk warning banner — shown when soft risk limits are hit */}
        {riskWarning && state.status === "running" && (
          <div className="mb-3 flex items-center gap-3 bg-yellow-950/60 border border-yellow-600/40 rounded-xl px-4 py-2.5 text-sm">
            <span className="text-yellow-400 text-base shrink-0">⚠</span>
            <div className="flex-1 min-w-0">
              <span className="text-yellow-300 font-semibold">Risk warning — position size halved. </span>
              <span className="text-yellow-500 text-xs">{riskWarning}</span>
            </div>
            <button
              onClick={() => setRiskWarning(null)}
              className="shrink-0 text-yellow-600 hover:text-yellow-300 text-xs px-2 py-1 rounded border border-yellow-700/40 hover:border-yellow-500/60 transition-colors"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Stats row */}
        <StatsCards
          balance={state.balance}
          totalProfit={totalProfit}
          winRate={winRate}
          totalTrades={totalClosed}
          consecutiveLosses={state.risk.consecutive_losses}
          dailyProfit={state.risk.daily_profit}
          maxDailyLoss={state.risk.max_daily_loss}
          openTrades={state.open_trades}
        />

        {/* Main grid */}
        <div className="mt-4 grid grid-cols-12 gap-4">

          {/* Left: Config panel */}
          <div className="col-span-12 lg:col-span-3 flex flex-col gap-4">
            <BotConfigPanel
              status={state.status}
              loading={loading}
              onStart={startBot}
              onStop={stopBot}
              onTest={testLogin}
            />
          </div>

          {/* Right: Tabs area */}
          <div className="col-span-12 lg:col-span-9 flex flex-col gap-4">

            {/* Tab navigation + info button */}
            <div className="flex items-center gap-2 flex-wrap">
            <InfoModal />
            <div className="flex gap-1 p-1 bg-bg-surface rounded-lg border border-bg-border w-fit flex-wrap">
              {(Object.keys(TAB_LABELS) as Tab[]).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all relative ${
                    activeTab === tab
                      ? "bg-bg-raised text-brand shadow-sm border border-bg-border"
                      : "text-gray-400 hover:text-gray-200"
                  }`}
                >
                  {TAB_LABELS[tab]}
                  {/* Dot indicator on Agents tab when system is active */}
                  {tab === "agents" && hasAgents && activeTab !== "agents" && (
                    <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-brand animate-pulse" />
                  )}
                </button>
              ))}
            </div>
            </div>

            {/* Tab content */}
            {activeTab === "overview" && (
              <>
                <PortfolioPanel
                  portfolio={state.portfolio}
                  mlScorer={state.ml_scorer}
                  status={state.status}
                />
                <TradeHistory trades={trades} balance={state.balance} onClearHistory={clearHistory} />
              </>
            )}

            {activeTab === "agents" && (
              <AgentFlow
                agentsState={agentsState}
                activityLog={agentActivityLog}
                cycle={agentCycle}
              />
            )}

            {activeTab === "strategies" && (
              <StrategyPerformance
                results={state.all_results}
                best={state.best_combo}
              />
            )}

            {activeTab === "calendar" && (
              <PnLCalendar data={pnl} onDeleteDate={deletePnLDate} onRefresh={refreshPnl} />
            )}

            {activeTab === "news" && (
              <NewsPanel articles={news} onRefresh={refreshNews} />
            )}

            {activeTab === "console" && (
              <ConsolePanel logs={logs} />
            )}
          </div>
        </div>
      </main>

      {tradeBlockedReason && (
        <TradeBlockedModal
          reason={tradeBlockedReason}
          loading={loading}
          onRestart={async () => {
            setTradeBlockedReason(null);
            await restartBot();
          }}
          onContinue={async () => {
            await resumeBot();
            setTradeBlockedReason(null);
          }}
          onDismiss={() => setTradeBlockedReason(null)}
        />
      )}
    </div>
  );
}
