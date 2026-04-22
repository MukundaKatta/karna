"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Calendar,
  Coins,
  Gauge,
  Hash,
  MessageSquare,
  TriangleAlert,
  Users,
  Wrench,
} from "lucide-react";
import { BarChart, LineChart, PieChart } from "@/components/Chart";
import { StatsCard } from "@/components/StatsCard";
import { formatCost, formatTokens } from "@/lib/utils";
import { Badge } from "@/components/Badge";

type DateRange = "7d" | "14d" | "30d";

interface AnalyticsResponse {
  overview?: {
    activeSessions?: number;
    activeConnections?: number;
    totalMessages?: number;
    totalInputTokens?: number;
    totalOutputTokens?: number;
    totalCostUsd?: number;
  };
  sessionsByChannel?: Record<string, number>;
  window?: {
    period?: DateRange;
    since?: number;
    messages?: number;
    tokens?: number;
    costUsd?: number;
    toolCalls?: number;
    errors?: number;
    sessionsCreated?: number;
    activeAgents?: number;
  };
  latency?: {
    totalTraces?: number;
    avgDurationMs?: number;
    p50DurationMs?: number;
    p95DurationMs?: number;
    p99DurationMs?: number;
    toolSuccessRate?: number;
    errorRate?: number;
  };
  topTools?: Array<{
    name: string;
    count: number;
    failed: number;
    avgDurationMs: number;
    lastUsedAt?: number;
  }>;
  models?: Array<{
    model: string;
    traces: number;
    tokens: number;
    costUsd: number;
    avgDurationMs: number;
    errors: number;
  }>;
  agents?: Array<{
    agentId: string;
    traces: number;
    tokens: number;
    costUsd: number;
    avgDurationMs: number;
    errors: number;
  }>;
}

interface AnalyticsHistoryResponse {
  history?: Array<{
    date: string;
    messages: number;
    tokens: number;
    cost: number;
    sessions: number;
    toolCalls: number;
    errors: number;
  }>;
}

function emptyAnalytics(): AnalyticsResponse {
  return {
    overview: {
      activeSessions: 0,
      activeConnections: 0,
      totalMessages: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
    },
    sessionsByChannel: {},
    window: {
      period: "7d",
      since: 0,
      messages: 0,
      tokens: 0,
      costUsd: 0,
      toolCalls: 0,
      errors: 0,
      sessionsCreated: 0,
      activeAgents: 0,
    },
    latency: {
      totalTraces: 0,
      avgDurationMs: 0,
      p50DurationMs: 0,
      p95DurationMs: 0,
      p99DurationMs: 0,
      toolSuccessRate: 1,
      errorRate: 0,
    },
    topTools: [],
    models: [],
    agents: [],
  };
}

export default function AnalyticsPage() {
  const [dateRange, setDateRange] = useState<DateRange>("7d");
  const [analytics, setAnalytics] = useState<AnalyticsResponse>(emptyAnalytics);
  const [history, setHistory] = useState<AnalyticsHistoryResponse>({ history: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchAnalytics() {
      setIsLoading(true);
      setError(null);

      try {
        const [analyticsRes, historyRes] = await Promise.all([
          fetch(`/api/analytics?period=${dateRange}`, { cache: "no-store" }),
          fetch(`/api/analytics/history?period=${dateRange}`, { cache: "no-store" }),
        ]);

        if (!analyticsRes.ok) {
          throw new Error(`Analytics request failed with ${analyticsRes.status}`);
        }
        if (!historyRes.ok) {
          throw new Error(`Analytics history request failed with ${historyRes.status}`);
        }

        const analyticsPayload = (await analyticsRes.json()) as AnalyticsResponse;
        const historyPayload = (await historyRes.json()) as AnalyticsHistoryResponse;

        if (cancelled) return;
        setAnalytics(analyticsPayload);
        setHistory(historyPayload);
      } catch (fetchError) {
        if (cancelled) return;
        setAnalytics(emptyAnalytics());
        setHistory({ history: [] });
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : "Failed to load live analytics",
        );
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchAnalytics();

    return () => {
      cancelled = true;
    };
  }, [dateRange]);

  const historyPoints = history.history ?? [];
  const windowStats = analytics.window ?? emptyAnalytics().window!;
  const latency = analytics.latency ?? emptyAnalytics().latency!;
  const overview = analytics.overview ?? emptyAnalytics().overview!;
  const days = dateRange === "7d" ? 7 : dateRange === "14d" ? 14 : 30;

  const chartData = useMemo(
    () =>
      historyPoints.map((point) => ({
        ...point,
        date: formatHistoryLabel(point.date),
      })),
    [historyPoints],
  );

  const projectedMonthlyCost = days > 0 ? (windowStats.costUsd ?? 0) / days * 30 : 0;
  const topToolsData = (analytics.topTools ?? []).map((tool) => ({
    name: tool.name,
    executions: tool.count,
    failures: tool.failed,
  }));
  const channelData = Object.entries(analytics.sessionsByChannel ?? {})
    .filter(([, count]) => count > 0)
    .map(([channel, count]) => ({
      channel: humanizeKey(channel),
      count,
    }))
    .sort((left, right) => right.count - left.count);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-dark-400">
        Loading analytics...
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-y-auto h-full">
      {error && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Analytics</h1>
          <p className="text-sm text-dark-400 mt-1">
            Live trace-backed usage, cost, and latency insights
          </p>
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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Messages"
          value={(windowStats.messages ?? 0).toLocaleString()}
          icon={<MessageSquare size={20} />}
          trend={{
            value: computeTrend(historyPoints.map((point) => point.messages)),
            label: "vs prior window",
          }}
        />
        <StatsCard
          title="Tokens"
          value={formatTokens(windowStats.tokens ?? 0)}
          icon={<Hash size={20} />}
          trend={{
            value: computeTrend(historyPoints.map((point) => point.tokens)),
            label: "vs prior window",
          }}
        />
        <StatsCard
          title="Cost"
          value={formatCost(windowStats.costUsd ?? 0)}
          icon={<Coins size={20} />}
          trend={{
            value: computeTrend(historyPoints.map((point) => point.cost)),
            label: "vs prior window",
          }}
        />
        <StatsCard
          title="Projected Monthly"
          value={formatCost(projectedMonthlyCost)}
          icon={<Activity size={20} />}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricPanel
          title="Active Sessions"
          value={(overview.activeSessions ?? 0).toString()}
          subtitle={`${overview.activeConnections ?? 0} live connections`}
          icon={<Users size={16} />}
        />
        <MetricPanel
          title="Sessions Created"
          value={(windowStats.sessionsCreated ?? 0).toString()}
          subtitle={`during the last ${dateRange}`}
          icon={<Users size={16} />}
        />
        <MetricPanel
          title="P95 Latency"
          value={`${Math.round(latency.p95DurationMs ?? 0)}ms`}
          subtitle={`avg ${Math.round(latency.avgDurationMs ?? 0)}ms`}
          icon={<Gauge size={16} />}
        />
        <MetricPanel
          title="Error Rate"
          value={`${((latency.errorRate ?? 0) * 100).toFixed(1)}%`}
          subtitle={`${windowStats.errors ?? 0} failing traces`}
          icon={<TriangleAlert size={16} />}
        />
      </div>

      <div className="rounded-xl border border-dark-700 bg-dark-800 p-5">
        <h3 className="text-sm font-medium text-white mb-4">Messages per Day</h3>
        {chartData.length > 0 ? (
          <LineChart
            data={chartData}
            xKey="date"
            yKeys={[{ key: "messages", name: "Messages", color: "#6366f1" }]}
            height={280}
          />
        ) : (
          <EmptyChart label="No message history for this range yet." />
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-5">
          <h3 className="text-sm font-medium text-white mb-4">Tokens per Day</h3>
          {chartData.length > 0 ? (
            <LineChart
              data={chartData}
              xKey="date"
              yKeys={[{ key: "tokens", name: "Tokens", color: "#22c55e" }]}
              height={250}
            />
          ) : (
            <EmptyChart label="No token usage recorded in this window." />
          )}
        </div>
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-5">
          <h3 className="text-sm font-medium text-white mb-4">Cost per Day</h3>
          {chartData.length > 0 ? (
            <LineChart
              data={chartData}
              xKey="date"
              yKeys={[{ key: "cost", name: "Cost ($)", color: "#f59e0b" }]}
              height={250}
            />
          ) : (
            <EmptyChart label="No cost data recorded in this window." />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-white">Top Tools Used</h3>
            <Badge variant="accent">{windowStats.toolCalls ?? 0} calls</Badge>
          </div>
          {topToolsData.length > 0 ? (
            <BarChart
              data={topToolsData}
              xKey="name"
              yKeys={[
                { key: "executions", name: "Executions", color: "#6366f1" },
                { key: "failures", name: "Failures", color: "#ef4444" },
              ]}
              height={280}
            />
          ) : (
            <EmptyChart label="No tool activity in this range yet." />
          )}
        </div>
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-white">Active Channel Mix</h3>
            <Badge variant="info">{overview.activeSessions ?? 0} sessions</Badge>
          </div>
          {channelData.length > 0 ? (
            <PieChart
              data={channelData}
              dataKey="count"
              nameKey="channel"
              height={280}
            />
          ) : (
            <EmptyChart label="No active channels are connected right now." />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-5">
          <h3 className="text-sm font-medium text-white mb-4">Model Usage</h3>
          {(analytics.models ?? []).length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-dark-700">
                    <th className="px-4 py-3 text-left text-xs font-medium text-dark-400 uppercase">Model</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-dark-400 uppercase">Traces</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-dark-400 uppercase">Tokens</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-dark-400 uppercase">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-700/50">
                  {(analytics.models ?? []).map((model) => (
                    <tr key={model.model}>
                      <td className="px-4 py-3 text-dark-200 font-medium">{model.model}</td>
                      <td className="px-4 py-3 text-right text-dark-300">{model.traces}</td>
                      <td className="px-4 py-3 text-right text-dark-300">{formatTokens(model.tokens)}</td>
                      <td className="px-4 py-3 text-right text-dark-300">{formatCost(model.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyChart label="No model activity recorded in this range." />
          )}
        </div>

        <div className="rounded-xl border border-dark-700 bg-dark-800 p-5">
          <h3 className="text-sm font-medium text-white mb-4">Most Active Agents</h3>
          {(analytics.agents ?? []).length > 0 ? (
            <div className="space-y-3">
              {(analytics.agents ?? []).map((agent) => (
                <div
                  key={agent.agentId}
                  className="flex items-center justify-between rounded-lg border border-dark-700 bg-dark-900/40 px-4 py-3"
                >
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-white">{agent.agentId}</p>
                    <p className="text-xs text-dark-400">
                      {agent.traces} traces • {formatTokens(agent.tokens)} • avg {agent.avgDurationMs}ms
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-dark-200">{formatCost(agent.costUsd)}</p>
                    <p className="text-xs text-dark-500">{agent.errors} errors</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyChart label="No agent activity recorded in this range." />
          )}
        </div>
      </div>

      <div className="rounded-xl border border-dark-700 bg-dark-800 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-white">Trace Health</h3>
          <Badge variant={(latency.errorRate ?? 0) > 0.1 ? "warning" : "success"}>
            {((latency.toolSuccessRate ?? 1) * 100).toFixed(1)}% tool success
          </Badge>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <MetricPanel
            title="P50"
            value={`${Math.round(latency.p50DurationMs ?? 0)}ms`}
            subtitle="median trace duration"
            icon={<Gauge size={16} />}
          />
          <MetricPanel
            title="P99"
            value={`${Math.round(latency.p99DurationMs ?? 0)}ms`}
            subtitle="tail latency"
            icon={<Gauge size={16} />}
          />
          <MetricPanel
            title="Agents Active"
            value={(windowStats.activeAgents ?? 0).toString()}
            subtitle={`${latency.totalTraces ?? 0} traces observed`}
            icon={<Wrench size={16} />}
          />
        </div>
      </div>
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center h-[250px] rounded-lg bg-dark-700/30 text-sm text-dark-400">
      {label}
    </div>
  );
}

function MetricPanel({
  title,
  value,
  subtitle,
  icon,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ReactElement;
}) {
  return (
    <div className="rounded-xl border border-dark-700 bg-dark-800 p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-dark-400">{title}</p>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-dark-700 text-dark-300">
          {icon}
        </div>
      </div>
      <p className="mt-3 text-2xl font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs text-dark-500">{subtitle}</p>
    </div>
  );
}

function formatHistoryLabel(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function humanizeKey(value: string): string {
  return value
    .split(/[_-]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function computeTrend(values: number[]): number {
  if (values.length < 2) return 0;
  const midpoint = Math.floor(values.length / 2);
  const previous = average(values.slice(0, midpoint));
  const current = average(values.slice(midpoint));

  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }

  return Math.round(((current - previous) / previous) * 100);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
