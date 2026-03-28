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
import { formatCost, formatTokens, formatRelativeTime, statusColor } from "@/lib/utils";

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

// Demo data for development
function getDemoData(): DashboardData {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return {
    stats: {
      totalMessages: 12847,
      activeSessions: 23,
      tokensUsed: 4_523_100,
      totalCost: 34.56,
      messageTrend: 12.5,
      sessionTrend: -3.2,
      tokenTrend: 8.1,
      costTrend: 5.4,
    },
    messageVolume: days.map((d, i) => ({
      date: d,
      messages: Math.floor(800 + Math.random() * 1200 + i * 100),
    })),
    activeChannels: [
      { name: "Web Chat", type: "web", status: "active", sessions: 12 },
      { name: "CLI", type: "cli", status: "active", sessions: 8 },
      { name: "Slack", type: "slack", status: "active", sessions: 3 },
      { name: "Discord", type: "discord", status: "inactive", sessions: 0 },
    ],
    recentActivity: [
      { id: "1", type: "session", description: "New web chat session started", timestamp: Date.now() - 60000 },
      { id: "2", type: "tool", description: "file_read tool executed in session #42", timestamp: Date.now() - 180000 },
      { id: "3", type: "memory", description: "15 new memories stored from conversation", timestamp: Date.now() - 300000 },
      { id: "4", type: "agent", description: "Agent model switched to claude-sonnet-4-20250514", timestamp: Date.now() - 600000 },
      { id: "5", type: "skill", description: "code-review skill triggered", timestamp: Date.now() - 900000 },
    ],
  };
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [isDemo, setIsDemo] = useState(false);

  useEffect(() => {
    // Fetch live data from gateway, fall back to demo data
    async function fetchData() {
      try {
        const res = await fetch("/api/analytics", { cache: "no-store" });
        if (res.ok) {
          const analytics = await res.json();
          const overview = analytics.overview ?? {};
          setIsDemo(false);
          setData({
            stats: {
              totalMessages: overview.totalMessages ?? 0,
              activeSessions: overview.activeSessions ?? 0,
              tokensUsed: (overview.totalInputTokens ?? 0) + (overview.totalOutputTokens ?? 0),
              totalCost: overview.totalCostUsd ?? 0,
              messageTrend: 0,
              sessionTrend: 0,
              tokenTrend: 0,
              costTrend: 0,
            },
            messageVolume: getDemoData().messageVolume, // Chart data still from local until history API is built
            activeChannels: Object.entries(analytics.sessionsByChannel ?? {}).map(
              ([type, count]) => ({
                name: type.charAt(0).toUpperCase() + type.slice(1),
                type,
                status: "active",
                sessions: count as number,
              }),
            ),
            recentActivity: getDemoData().recentActivity,
          });
          return;
        }
      } catch {
        // Gateway not available, use demo data
      }
      setIsDemo(true);
      setData(getDemoData());
    }
    fetchData();
  }, []);

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full text-dark-400">
        Loading dashboard...
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-y-auto h-full">
      {isDemo && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-3 sm:px-4 py-2.5 sm:py-3 flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-3">
          <span className="text-yellow-400 text-sm font-medium">Demo Mode</span>
          <span className="text-yellow-400/70 text-xs sm:text-sm">
            Gateway not connected. Start with{" "}
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
          <LineChart
            data={data.messageVolume}
            xKey="date"
            yKeys={[{ key: "messages", name: "Messages", color: "#6366f1" }]}
            height={260}
          />
        </div>

        {/* Active channels */}
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-5">
          <h3 className="text-sm font-medium text-white mb-4">Active Channels</h3>
          <div className="space-y-3">
            {data.activeChannels.map((ch) => (
              <div
                key={ch.name}
                className="flex items-center justify-between py-2 px-3 rounded-lg bg-dark-700/40"
              >
                <div>
                  <p className="text-sm font-medium text-dark-200">{ch.name}</p>
                  <p className="text-xs text-dark-500">{ch.type}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-dark-400">{ch.sessions} sessions</span>
                  <Badge
                    variant={ch.status === "active" ? "success" : "default"}
                  >
                    {ch.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent activity */}
      <div className="rounded-xl border border-dark-700 bg-dark-800 p-5">
        <h3 className="text-sm font-medium text-white mb-4">Recent Activity</h3>
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
      </div>
    </div>
  );
}
