"use client";

import { useEffect, useState } from "react";
import {
  MessageSquare,
  Users,
  Coins,
  Hash,
  Activity,
} from "lucide-react";
import { StatsCard } from "@/components/StatsCard";
import { LineChart } from "@/components/Chart";
import { Badge } from "@/components/Badge";
import { formatCost, formatTokens, formatRelativeTime } from "@/lib/utils";

interface DashboardData {
  stats: {
    totalMessages: number;
    activeSessions: number;
    tokensUsed: number;
    totalCost: number;
    messageTrend: number;
    sessionTrend: number;
    tokenTrend: number;
    costTrend: number;
  };
  messageVolume: Array<{ date: string; messages: number }>;
  activeChannels: Array<{ name: string; type: string; status: string; sessions: number }>;
  recentActivity: Array<{ id: string; type: string; description: string; timestamp: number }>;
}

interface AnalyticsResponse {
  overview?: {
    totalMessages?: number;
    activeSessions?: number;
    totalInputTokens?: number;
    totalOutputTokens?: number;
    totalCostUsd?: number;
  };
  sessionsByChannel?: Record<string, number>;
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

interface ActivityResponse {
  events?: Array<{
    id: string;
    timestamp: number;
    eventType: string;
    action: string;
    success: boolean;
    resourceType?: string;
    resourceId?: string;
    sessionId?: string;
  }>;
}

const CHANNEL_LABELS: Record<string, string> = {
  cli: "CLI",
  discord: "Discord",
  google_chat: "Google Chat",
  imessage: "iMessage",
  irc: "IRC",
  line: "LINE",
  matrix: "Matrix",
  signal: "Signal",
  slack: "Slack",
  sms: "SMS",
  teams: "Teams",
  telegram: "Telegram",
  web: "Web",
  webchat: "Web Chat",
  whatsapp: "WhatsApp",
};

function emptyDashboardData(): DashboardData {
  return {
    stats: {
      totalMessages: 0,
      activeSessions: 0,
      tokensUsed: 0,
      totalCost: 0,
      messageTrend: 0,
      sessionTrend: 0,
      tokenTrend: 0,
      costTrend: 0,
    },
    messageVolume: [],
    activeChannels: [],
    recentActivity: [],
  };
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData>(emptyDashboardData());
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setIsLoading(true);
      setError(null);

      try {
        const [analyticsRes, historyRes, activityRes] = await Promise.all([
          fetch("/api/analytics", { cache: "no-store" }),
          fetch("/api/analytics/history?period=7d", { cache: "no-store" }),
          fetch("/api/activity?limit=6", { cache: "no-store" }),
        ]);

        if (!analyticsRes.ok) {
          throw new Error(`Analytics request failed with ${analyticsRes.status}`);
        }

        const analytics = (await analyticsRes.json()) as AnalyticsResponse;
        const history = historyRes.ok
          ? ((await historyRes.json()) as AnalyticsHistoryResponse)
          : { history: [] };
        const activity = activityRes.ok
          ? ((await activityRes.json()) as ActivityResponse)
          : { events: [] };

        const historyPoints = history.history ?? [];
        const overview = analytics.overview ?? {};

        if (cancelled) return;

        setData({
          stats: {
            totalMessages: overview.totalMessages ?? 0,
            activeSessions: overview.activeSessions ?? 0,
            tokensUsed: (overview.totalInputTokens ?? 0) + (overview.totalOutputTokens ?? 0),
            totalCost: overview.totalCostUsd ?? 0,
            messageTrend: computeTrend(historyPoints.map((item) => item.messages)),
            sessionTrend: computeTrend(historyPoints.map((item) => item.sessions)),
            tokenTrend: computeTrend(historyPoints.map((item) => item.tokens)),
            costTrend: computeTrend(historyPoints.map((item) => item.cost)),
          },
          messageVolume: historyPoints.map((item) => ({
            date: formatHistoryLabel(item.date),
            messages: item.messages,
          })),
          activeChannels: Object.entries(analytics.sessionsByChannel ?? {})
            .map(([type, sessions]) => ({
              name: CHANNEL_LABELS[type] ?? humanizeKey(type),
              type,
              status: sessions > 0 ? "active" : "inactive",
              sessions,
            }))
            .sort((left, right) => right.sessions - left.sessions),
          recentActivity: (activity.events ?? []).map((event) => ({
            id: event.id,
            type: event.resourceType ?? event.eventType.split(".")[0] ?? "system",
            description: describeActivity(event),
            timestamp: event.timestamp,
          })),
        });
      } catch (fetchError) {
        if (cancelled) return;
        setData(emptyDashboardData());
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : "Failed to load live dashboard data",
        );
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchData();

    return () => {
      cancelled = true;
    };
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-dark-400">
        Loading dashboard...
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-y-auto h-full">
      {error && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-3 sm:px-4 py-2.5 sm:py-3 flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3">
          <span className="text-yellow-400 text-sm font-medium">Live Data Unavailable</span>
          <span className="text-yellow-400/70 text-xs sm:text-sm">
            {error}. Start the gateway with{" "}
            <code className="bg-dark-700 px-1.5 py-0.5 rounded text-xs">pnpm gateway:dev</code>
          </span>
        </div>
      )}
      <div className="pl-10 md:pl-0">
        <h1 className="text-lg sm:text-xl font-semibold text-white">Dashboard</h1>
        <p className="text-xs sm:text-sm text-dark-400 mt-1">Overview of your Karna instance</p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Total Messages"
          value={data.stats.totalMessages.toLocaleString()}
          icon={<MessageSquare size={20} />}
          trend={{ value: data.stats.messageTrend, label: "vs last week" }}
        />
        <StatsCard
          title="Active Sessions"
          value={data.stats.activeSessions}
          icon={<Users size={20} />}
          trend={{ value: data.stats.sessionTrend, label: "vs last week" }}
        />
        <StatsCard
          title="Tokens Used"
          value={formatTokens(data.stats.tokensUsed)}
          icon={<Hash size={20} />}
          trend={{ value: data.stats.tokenTrend, label: "vs last week" }}
        />
        <StatsCard
          title="Total Cost"
          value={formatCost(data.stats.totalCost)}
          icon={<Coins size={20} />}
          trend={{ value: data.stats.costTrend, label: "vs last week" }}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Message volume chart */}
        <div className="lg:col-span-2 rounded-xl border border-dark-700 bg-dark-800 p-5">
          <h3 className="text-sm font-medium text-white mb-4">Message Volume (Last 7 Days)</h3>
          {data.messageVolume.length > 0 ? (
            <LineChart
              data={data.messageVolume}
              xKey="date"
              yKeys={[{ key: "messages", name: "Messages", color: "#6366f1" }]}
              height={260}
            />
          ) : (
            <div className="flex items-center justify-center h-[260px] rounded-lg bg-dark-700/30 text-sm text-dark-400">
              No message history yet.
            </div>
          )}
        </div>

        {/* Active channels */}
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-5">
          <h3 className="text-sm font-medium text-white mb-4">Active Channels</h3>
          {data.activeChannels.length > 0 ? (
            <div className="space-y-3">
              {data.activeChannels.map((ch) => (
                <div
                  key={ch.type}
                  className="flex items-center justify-between py-2 px-3 rounded-lg bg-dark-700/40"
                >
                  <div>
                    <p className="text-sm font-medium text-dark-200">{ch.name}</p>
                    <p className="text-xs text-dark-500">{ch.type}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-dark-400">{ch.sessions} sessions</span>
                    <Badge variant={ch.status === "active" ? "success" : "default"}>
                      {ch.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg bg-dark-700/30 px-3 py-8 text-center text-sm text-dark-400">
              No active channels yet.
            </div>
          )}
        </div>
      </div>

      {/* Recent activity */}
      <div className="rounded-xl border border-dark-700 bg-dark-800 p-5">
        <h3 className="text-sm font-medium text-white mb-4">Recent Activity</h3>
        {data.recentActivity.length > 0 ? (
          <div className="space-y-2">
            {data.recentActivity.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-dark-700/40 transition-colors"
              >
                <Activity size={14} className="text-dark-500 shrink-0" />
                <p className="text-sm text-dark-300 flex-1">{item.description}</p>
                <span className="text-xs text-dark-500 shrink-0">
                  {formatRelativeTime(item.timestamp)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg bg-dark-700/30 px-3 py-8 text-center text-sm text-dark-400">
            No recent activity captured yet.
          </div>
        )}
      </div>
    </div>
  );
}

function humanizeKey(value: string): string {
  return value
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function computeTrend(values: number[]): number {
  if (values.length < 2) {
    return 0;
  }

  const midpoint = Math.ceil(values.length / 2);
  const previous = values.slice(0, midpoint).reduce((sum, value) => sum + value, 0);
  const current = values.slice(midpoint).reduce((sum, value) => sum + value, 0);

  if (previous === 0) {
    return current === 0 ? 0 : 100;
  }

  return Number((((current - previous) / previous) * 100).toFixed(1));
}

function formatHistoryLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function describeActivity(event: NonNullable<ActivityResponse["events"]>[number]): string {
  switch (event.eventType) {
    case "session.created":
      return `Session ${event.sessionId ?? event.resourceId ?? "unknown"} started`;
    case "session.terminated":
      return `Session ${event.sessionId ?? event.resourceId ?? "unknown"} terminated`;
    case "session.expired":
      return `Session ${event.sessionId ?? event.resourceId ?? "unknown"} expired`;
    case "tool.executed":
      return `Tool ${event.resourceId ?? "unknown"} executed`;
    case "tool.failed":
      return `Tool ${event.resourceId ?? "unknown"} failed`;
    case "tool.approved":
      return `Tool ${event.resourceId ?? "unknown"} approved`;
    case "tool.rejected":
      return `Tool ${event.resourceId ?? "unknown"} rejected`;
    case "skill.invoked":
      return `Skill ${event.resourceId ?? "unknown"} invoked`;
    default:
      return `${humanizeKey(event.resourceType ?? event.eventType)} ${event.action}`;
  }
}
