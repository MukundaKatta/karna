"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Calendar,
  Coins,
  Hash,
  MessageSquare,
  RefreshCw,
  Users,
} from "lucide-react";
import { BarChart, LineChart, PieChart } from "@/components/Chart";
import { StatsCard } from "@/components/StatsCard";
import { Badge } from "@/components/Badge";
import { cn, formatCost, formatDate, formatTokens } from "@/lib/utils";

type RangeKey = "24h" | "7d" | "30d" | "90d";

interface UsageResponse {
  range?: {
    from?: number;
    to?: number;
    granularity?: "hour" | "day" | "week";
  };
  summary?: {
    totalTokens?: number;
    totalInputTokens?: number;
    totalOutputTokens?: number;
    totalCostUsd?: number;
    totalMessages?: number;
    activeUsers?: number;
  };
  timeSeries?: Array<{
    timestamp: number;
    tokens: number;
    costUsd: number;
    messages: number;
  }>;
  byModel?: Array<{ model: string; tokens: number; costUsd: number; messages: number }>;
  byUser?: Array<{ userId: string; tokens: number; costUsd: number; messages: number }>;
  byChannel?: Array<{ channel: string; tokens: number; costUsd: number; messages: number }>;
}

const RANGE_MS: Record<RangeKey, number> = {
  "24h": 86_400_000,
  "7d": 604_800_000,
  "30d": 2_592_000_000,
  "90d": 7_776_000_000,
};

const RANGE_GRANULARITY: Record<RangeKey, "hour" | "day" | "week"> = {
  "24h": "hour",
  "7d": "day",
  "30d": "day",
  "90d": "week",
};

const RANGE_LABELS: Record<RangeKey, string> = {
  "24h": "24 Hours",
  "7d": "7 Days",
  "30d": "30 Days",
  "90d": "90 Days",
};

function emptyUsage(): UsageResponse {
  return {
    range: { from: 0, to: 0, granularity: "day" },
    summary: {
      totalTokens: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
      totalMessages: 0,
      activeUsers: 0,
    },
    timeSeries: [],
    byModel: [],
    byUser: [],
    byChannel: [],
  };
}

function humanizeKey(value: string): string {
  return value
    .split(/[_-]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function UsagePage() {
  const [range, setRange] = useState<RangeKey>("7d");
  const [usage, setUsage] = useState<UsageResponse>(emptyUsage);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const to = Date.now();
    const from = to - RANGE_MS[range];
    const granularity = RANGE_GRANULARITY[range];

    async function fetchUsage() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/usage?from=${from}&to=${to}&granularity=${granularity}`,
          { cache: "no-store" },
        );

        if (!response.ok) {
          throw new Error(`Usage request failed with ${response.status}`);
        }

        const payload = (await response.json()) as UsageResponse;
        if (cancelled) return;
        setUsage(payload);
      } catch (fetchError) {
        if (cancelled) return;
        setUsage(emptyUsage());
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : "Failed to load usage data",
        );
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    }

    fetchUsage();

    return () => {
      cancelled = true;
    };
  }, [range, refreshKey]);

  const summary = usage.summary ?? emptyUsage().summary!;
  const granularity = usage.range?.granularity ?? RANGE_GRANULARITY[range];

  const seriesData = useMemo(() => {
    const pattern = granularity === "hour" ? "MMM d HH:mm" : granularity === "week" ? "MMM d" : "MMM d";
    return (usage.timeSeries ?? []).map((point) => ({
      label: formatDate(point.timestamp, pattern),
      tokens: point.tokens,
      cost: Number(point.costUsd.toFixed(4)),
      messages: point.messages,
    }));
  }, [usage.timeSeries, granularity]);

  const byModelData = (usage.byModel ?? [])
    .map((row) => ({
      model: row.model,
      tokens: row.tokens,
      cost: Number(row.costUsd.toFixed(4)),
      messages: row.messages,
    }))
    .sort((a, b) => b.tokens - a.tokens);

  const byChannelData = (usage.byChannel ?? [])
    .filter((row) => row.tokens > 0 || row.messages > 0)
    .map((row) => ({
      channel: humanizeKey(row.channel),
      tokens: row.tokens,
    }))
    .sort((a, b) => b.tokens - a.tokens);

  const byUserData = (usage.byUser ?? [])
    .map((row) => ({ ...row }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 10);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-dark-400">
        Loading usage...
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

      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Token &amp; Cost Usage</h1>
          <p className="text-sm text-dark-400 mt-1">
            Token and cost breakdown by model, channel, user, and time
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Calendar size={16} className="text-dark-400" />
          {(Object.keys(RANGE_LABELS) as RangeKey[]).map((option) => (
            <button
              key={option}
              onClick={() => setRange(option)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-lg transition-colors",
                range === option
                  ? "bg-accent-600 text-white"
                  : "bg-dark-700 text-dark-400 hover:text-white",
              )}
            >
              {RANGE_LABELS[option]}
            </button>
          ))}
          <button
            onClick={() => {
              setIsRefreshing(true);
              setRefreshKey((value) => value + 1);
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-dark-700 px-3 py-1.5 text-xs font-medium text-dark-200 transition-colors hover:bg-dark-600"
          >
            <RefreshCw size={14} className={cn(isRefreshing && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Total Tokens"
          value={formatTokens(summary.totalTokens ?? 0)}
          icon={<Hash size={20} />}
        />
        <StatsCard
          title="Total Cost"
          value={formatCost(summary.totalCostUsd ?? 0)}
          icon={<Coins size={20} />}
        />
        <StatsCard
          title="Messages"
          value={(summary.totalMessages ?? 0).toLocaleString()}
          icon={<MessageSquare size={20} />}
        />
        <StatsCard
          title="Active Users"
          value={(summary.activeUsers ?? 0).toLocaleString()}
          icon={<Users size={20} />}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-4">
          <p className="text-sm text-dark-400">Input Tokens</p>
          <p className="mt-2 text-xl font-semibold text-white">
            {formatTokens(summary.totalInputTokens ?? 0)}
          </p>
        </div>
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-4">
          <p className="text-sm text-dark-400">Output Tokens</p>
          <p className="mt-2 text-xl font-semibold text-white">
            {formatTokens(summary.totalOutputTokens ?? 0)}
          </p>
        </div>
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-4">
          <p className="text-sm text-dark-400">Granularity</p>
          <p className="mt-2 text-xl font-semibold text-white capitalize">{granularity}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-5">
          <h3 className="text-sm font-medium text-white mb-4">Tokens over Time</h3>
          {seriesData.length > 0 ? (
            <LineChart
              data={seriesData}
              xKey="label"
              yKeys={[{ key: "tokens", name: "Tokens", color: "#22c55e" }]}
              height={280}
            />
          ) : (
            <EmptyChart label="No token usage recorded in this window." />
          )}
        </div>
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-5">
          <h3 className="text-sm font-medium text-white mb-4">Cost over Time</h3>
          {seriesData.length > 0 ? (
            <LineChart
              data={seriesData}
              xKey="label"
              yKeys={[{ key: "cost", name: "Cost ($)", color: "#f59e0b" }]}
              height={280}
            />
          ) : (
            <EmptyChart label="No cost data recorded in this window." />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-white">Tokens by Model</h3>
            <Badge variant="accent">{byModelData.length} models</Badge>
          </div>
          {byModelData.length > 0 ? (
            <BarChart
              data={byModelData}
              xKey="model"
              yKeys={[{ key: "tokens", name: "Tokens", color: "#6366f1" }]}
              height={280}
            />
          ) : (
            <EmptyChart label="No per-model usage in this range." />
          )}
        </div>
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-white">Tokens by Channel</h3>
            <Badge variant="info">{byChannelData.length} channels</Badge>
          </div>
          {byChannelData.length > 0 ? (
            <PieChart
              data={byChannelData}
              dataKey="tokens"
              nameKey="channel"
              height={280}
            />
          ) : (
            <EmptyChart label="No per-channel usage in this range." />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-5">
          <h3 className="text-sm font-medium text-white mb-4">Cost by Model</h3>
          {byModelData.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-dark-700">
                    <th className="px-4 py-3 text-left text-xs font-medium text-dark-400 uppercase">Model</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-dark-400 uppercase">Tokens</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-dark-400 uppercase">Messages</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-dark-400 uppercase">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-700/50">
                  {byModelData.map((row) => (
                    <tr key={row.model}>
                      <td className="px-4 py-3 text-dark-200 font-medium">{row.model}</td>
                      <td className="px-4 py-3 text-right text-dark-300">{formatTokens(row.tokens)}</td>
                      <td className="px-4 py-3 text-right text-dark-300">{row.messages.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-dark-300">{formatCost(row.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyChart label="No per-model cost in this range." />
          )}
        </div>

        <div className="rounded-xl border border-dark-700 bg-dark-800 p-5">
          <h3 className="text-sm font-medium text-white mb-4">Top Users</h3>
          {byUserData.length > 0 ? (
            <div className="space-y-3">
              {byUserData.map((user) => (
                <div
                  key={user.userId}
                  className="flex items-center justify-between rounded-lg border border-dark-700 bg-dark-900/40 px-4 py-3"
                >
                  <div className="space-y-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate font-mono">{user.userId}</p>
                    <p className="text-xs text-dark-400">
                      {formatTokens(user.tokens)} tokens • {user.messages.toLocaleString()} messages
                    </p>
                  </div>
                  <p className="text-sm text-dark-200 shrink-0">{formatCost(user.costUsd)}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyChart label="No per-user usage in this range." />
          )}
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
