"use client";

import { useState, useMemo } from "react";
import { Calendar } from "lucide-react";
import { LineChart, BarChart, PieChart } from "@/components/Chart";
import { StatsCard } from "@/components/StatsCard";
import { formatCost, formatTokens } from "@/lib/utils";
import { MessageSquare, Hash, Coins, TrendingUp } from "lucide-react";

type Granularity = "day" | "week" | "month";

function generateTimeSeries(days: number) {
  const data = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now - i * 86400000);
    data.push({
      date: `${date.getMonth() + 1}/${date.getDate()}`,
      messages: Math.floor(200 + Math.random() * 800 + (days - i) * 10),
      tokens: Math.floor(10000 + Math.random() * 50000 + (days - i) * 500),
      cost: +(0.5 + Math.random() * 3 + (days - i) * 0.05).toFixed(2),
    });
  }
  return data;
}

const topToolsData = [
  { name: "file_read", count: 432 },
  { name: "web_search", count: 289 },
  { name: "file_write", count: 156 },
  { name: "web_scrape", count: 134 },
  { name: "code_execute", count: 87 },
  { name: "db_query", count: 67 },
  { name: "git_commit", count: 45 },
];

const channelData = [
  { channel: "Web", count: 5420 },
  { channel: "CLI", count: 3890 },
  { channel: "Slack", count: 2134 },
  { channel: "Discord", count: 1403 },
];

const modelData = [
  { model: "Claude Sonnet 4", tokens: 3200000, cost: 22.4 },
  { model: "Claude Opus 4", tokens: 890000, cost: 18.7 },
  { model: "GPT-4o", tokens: 433100, cost: 6.5 },
];

export default function AnalyticsPage() {
  const [dateRange, setDateRange] = useState<"7d" | "14d" | "30d">("7d");

  const days = dateRange === "7d" ? 7 : dateRange === "14d" ? 14 : 30;
  const timeSeries = useMemo(() => generateTimeSeries(days), [days]);

  const totals = useMemo(() => {
    return timeSeries.reduce(
      (acc, d) => ({
        messages: acc.messages + d.messages,
        tokens: acc.tokens + d.tokens,
        cost: acc.cost + d.cost,
      }),
      { messages: 0, tokens: 0, cost: 0 },
    );
  }, [timeSeries]);

  const projectedMonthlyCost = (totals.cost / days) * 30;

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Analytics</h1>
          <p className="text-sm text-dark-400 mt-1">Usage analytics and cost tracking</p>
        </div>
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-dark-400" />
          {(["7d", "14d", "30d"] as const).map((range) => (
            <button
              key={range}
              onClick={() => setDateRange(range)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                dateRange === range
                  ? "bg-accent-600 text-white"
                  : "bg-dark-700 text-dark-400 hover:text-white"
              }`}
            >
              {range === "7d" ? "7 Days" : range === "14d" ? "14 Days" : "30 Days"}
            </button>
          ))}
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Total Messages"
          value={totals.messages.toLocaleString()}
          icon={<MessageSquare size={20} />}
        />
        <StatsCard
          title="Total Tokens"
          value={formatTokens(totals.tokens)}
          icon={<Hash size={20} />}
        />
        <StatsCard
          title="Total Cost"
          value={formatCost(totals.cost)}
          icon={<Coins size={20} />}
        />
        <StatsCard
          title="Projected Monthly"
          value={formatCost(projectedMonthlyCost)}
          icon={<TrendingUp size={20} />}
        />
      </div>

      {/* Messages per day */}
      <div className="rounded-xl border border-dark-700 bg-dark-800 p-5">
        <h3 className="text-sm font-medium text-white mb-4">Messages per Day</h3>
        <LineChart
          data={timeSeries}
          xKey="date"
          yKeys={[{ key: "messages", name: "Messages", color: "#6366f1" }]}
          height={280}
        />
      </div>

      {/* Tokens & Cost per day */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-5">
          <h3 className="text-sm font-medium text-white mb-4">Tokens per Day</h3>
          <LineChart
            data={timeSeries}
            xKey="date"
            yKeys={[{ key: "tokens", name: "Tokens", color: "#22c55e" }]}
            height={250}
          />
        </div>
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-5">
          <h3 className="text-sm font-medium text-white mb-4">Cost per Day (USD)</h3>
          <LineChart
            data={timeSeries}
            xKey="date"
            yKeys={[{ key: "cost", name: "Cost ($)", color: "#f59e0b" }]}
            height={250}
          />
        </div>
      </div>

      {/* Tool usage & Channel breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-5">
          <h3 className="text-sm font-medium text-white mb-4">Top Tools Used</h3>
          <BarChart
            data={topToolsData}
            xKey="name"
            yKeys={[{ key: "count", name: "Executions", color: "#6366f1" }]}
            height={280}
          />
        </div>
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-5">
          <h3 className="text-sm font-medium text-white mb-4">Channel Breakdown</h3>
          <PieChart
            data={channelData}
            dataKey="count"
            nameKey="channel"
            height={280}
          />
        </div>
      </div>

      {/* Model usage */}
      <div className="rounded-xl border border-dark-700 bg-dark-800 p-5">
        <h3 className="text-sm font-medium text-white mb-4">Model Usage Comparison</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-700">
                <th className="px-4 py-3 text-left text-xs font-medium text-dark-400 uppercase">Model</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-dark-400 uppercase">Tokens</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-dark-400 uppercase">Cost</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-dark-400 uppercase">Distribution</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-700/50">
              {modelData.map((m) => {
                const totalTokens = modelData.reduce((s, d) => s + d.tokens, 0);
                const pct = ((m.tokens / totalTokens) * 100).toFixed(1);
                return (
                  <tr key={m.model}>
                    <td className="px-4 py-3 text-dark-200 font-medium">{m.model}</td>
                    <td className="px-4 py-3 text-right text-dark-300">{formatTokens(m.tokens)}</td>
                    <td className="px-4 py-3 text-right text-dark-300">{formatCost(m.cost)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-dark-700">
                          <div
                            className="h-2 rounded-full bg-accent-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs text-dark-400 w-12 text-right">{pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
