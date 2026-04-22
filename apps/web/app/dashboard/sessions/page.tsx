"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { DataTable, type Column } from "@/components/DataTable";
import { Badge } from "@/components/Badge";
import { formatDate, formatCost, formatTokens } from "@/lib/utils";

interface SessionRow {
  id: string;
  channelType: string;
  channelId: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  tokens: number;
  cost: number;
}

export default function SessionsPage() {
  const router = useRouter();
  const [channelFilter, setChannelFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchSessions() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/sessions", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Session request failed with ${response.status}`);
        }

        const payload = (await response.json()) as {
          sessions?: Array<{
            id: string;
            channelType: string;
            channelId: string;
            status: string;
            createdAt: number;
            updatedAt: number;
            stats?: {
              messageCount?: number;
              totalInputTokens?: number;
              totalOutputTokens?: number;
              totalCostUsd?: number;
            };
          }>;
        };

        if (cancelled) return;

        setSessions(
          (payload.sessions ?? []).map((session) => ({
            id: session.id,
            channelType: session.channelType,
            channelId: session.channelId,
            status: session.status,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            messageCount: session.stats?.messageCount ?? 0,
            tokens: (session.stats?.totalInputTokens ?? 0) + (session.stats?.totalOutputTokens ?? 0),
            cost: session.stats?.totalCostUsd ?? 0,
          })),
        );
      } catch (fetchError) {
        if (cancelled) return;
        setSessions([]);
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : "Failed to load live sessions",
        );
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchSessions();

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => {
      if (channelFilter && s.channelType !== channelFilter) return false;
      if (statusFilter && s.status !== statusFilter) return false;
      if (search) {
        const query = search.toLowerCase();
        if (!s.id.toLowerCase().includes(query) && !s.channelId.toLowerCase().includes(query)) {
          return false;
        }
      }
      return true;
    });
  }, [channelFilter, sessions, statusFilter, search]);

  const channelOptions = useMemo(
    () => Array.from(new Set(sessions.map((session) => session.channelType))).sort(),
    [sessions],
  );
  const statusOptions = useMemo(
    () => Array.from(new Set(sessions.map((session) => session.status))).sort(),
    [sessions],
  );

  const columns: Column<SessionRow>[] = [
    {
      key: "id",
      label: "Session ID",
      sortable: true,
      render: (val) => <span className="font-mono text-xs text-accent-400">{val as string}</span>,
    },
    {
      key: "channelType",
      label: "Channel",
      sortable: true,
      render: (val) => <Badge variant="info">{val as string}</Badge>,
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (val) => {
        const s = val as string;
        const variant = s === "active" ? "success" : s === "idle" ? "warning" : s === "terminated" ? "danger" : "default";
        return <Badge variant={variant}>{s}</Badge>;
      },
    },
    {
      key: "messageCount",
      label: "Messages",
      sortable: true,
      className: "text-right",
    },
    {
      key: "tokens",
      label: "Tokens",
      sortable: true,
      className: "text-right",
      render: (val) => formatTokens(val as number),
    },
    {
      key: "cost",
      label: "Cost",
      sortable: true,
      className: "text-right",
      render: (val) => formatCost(val as number),
    },
    {
      key: "createdAt",
      label: "Created",
      sortable: true,
      render: (val) => (
        <span className="text-xs text-dark-400">{formatDate(val as number)}</span>
      ),
    },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-y-auto h-full">
      {error && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300">
          {error}
        </div>
      )}

      <div>
        <h1 className="text-xl font-semibold text-white">Sessions</h1>
        <p className="text-sm text-dark-400 mt-1">Browse and manage conversation sessions</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500" />
          <input
            type="text"
            placeholder="Search sessions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-sm bg-dark-800 border border-dark-700 rounded-lg text-dark-200 placeholder:text-dark-500 focus:outline-none focus:border-accent-500"
          />
        </div>
        <select
          value={channelFilter}
          onChange={(e) => setChannelFilter(e.target.value)}
          className="px-3 py-2 text-sm bg-dark-800 border border-dark-700 rounded-lg text-dark-200 focus:outline-none focus:border-accent-500"
        >
          <option value="">All Channels</option>
          {channelOptions.map((channel) => (
            <option key={channel} value={channel}>
              {channel}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-sm bg-dark-800 border border-dark-700 rounded-lg text-dark-200 focus:outline-none focus:border-accent-500"
        >
          <option value="">All Statuses</option>
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </div>

      <DataTable
        columns={columns}
        data={filteredSessions}
        keyField="id"
        pageSize={10}
        onRowClick={(row) => router.push(`/dashboard/sessions/${row.id}`)}
        emptyMessage={isLoading ? "Loading sessions..." : "No sessions found"}
      />
    </div>
  );
}
