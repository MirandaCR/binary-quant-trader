"use client";

import type { NewsArticle } from "@/types";
import { ExternalLink, RefreshCw, Newspaper, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";
import { useState } from "react";

interface Props {
  articles: NewsArticle[];
  onRefresh: () => void;
}

const SENTIMENT_CONFIG = {
  positive: { icon: <TrendingUp  className="w-3 h-3" />, color: "text-profit", bg: "bg-profit/10 border-profit/20" },
  negative: { icon: <TrendingDown className="w-3 h-3" />, color: "text-loss",   bg: "bg-loss/10 border-loss/20"   },
  neutral:  { icon: <Minus       className="w-3 h-3" />, color: "text-gray-400", bg: "bg-bg-raised border-bg-border" },
};

export default function NewsPanel({ articles, onRefresh }: Props) {
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    onRefresh();
    setTimeout(() => setRefreshing(false), 1500);
  };

  if (articles.length === 0) {
    return (
      <div className="bg-bg-surface border border-bg-border rounded-xl p-8 text-center">
        <Newspaper className="w-8 h-8 text-gray-700 mx-auto mb-3" />
        <p className="text-gray-500 text-sm">No news loaded.</p>
        <p className="text-gray-700 text-xs mt-1">Add a NewsAPI key in the bot config to enable market news.</p>
        <p className="text-gray-700 text-xs mt-1">
          Get a free key at{" "}
          <a href="https://newsapi.org" target="_blank" rel="noreferrer" className="text-brand hover:underline">
            newsapi.org
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="bg-bg-surface border border-bg-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-bg-border">
        <div className="flex items-center gap-2">
          <Newspaper className="w-4 h-4 text-brand" />
          <span className="text-sm font-medium text-gray-300">Market News</span>
          <span className="text-xs text-gray-600">({articles.length} articles)</span>
        </div>
        <button
          onClick={handleRefresh}
          className="p-1.5 rounded-lg hover:bg-bg-raised text-gray-500 hover:text-gray-300 transition-all"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
        </button>
      </div>

      <div className="divide-y divide-bg-border">
        {articles.map((a, i) => {
          const s = SENTIMENT_CONFIG[a.sentiment];
          return (
            <div
              key={i}
              className="px-4 py-3 hover:bg-bg-raised transition-colors group flex gap-3"
            >
              {/* Sentiment badge */}
              <div className={cn(
                "mt-0.5 shrink-0 w-5 h-5 rounded flex items-center justify-center border",
                s.bg, s.color
              )}>
                {s.icon}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-gray-200 group-hover:text-white transition-colors leading-snug line-clamp-2">
                    {a.title}
                  </p>
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 p-1 text-gray-600 hover:text-brand transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
                {a.description && (
                  <p className="text-xs text-gray-600 mt-0.5 line-clamp-1">{a.description}</p>
                )}
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-xs text-gray-600">{a.source}</span>
                  {a.asset && (
                    <span className="text-xs font-mono text-brand/70">{a.asset}</span>
                  )}
                  <span className="text-xs text-gray-700">{timeAgo(a.published_at)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
