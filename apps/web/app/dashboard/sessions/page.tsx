"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Search, Filter } from "lucide-react";
import { DataTable, type Column } from "@/components/DataTable";
import { Badge } from "@/components/Badge";
import { formatDate, formatCost, formatTokens, statusColor } from "@/lib/utils";

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

const demoSessions: SessionRow[] = Array.from({ length: 35 }, (_, i) => ({
  id: `sess-${1000 + i}`,
  channelType: ["web", "cli", "slack", "discord"][i % 4],
  channelId: `ch-${i}`,
  status: ["active", "idle", "terminated", "suspended"][i % 4],
  createdAt: Date.now() - (i * 3600000 + Math.random() * 3600000),
  updatedAt: Date.now() - (i * 1800000),
  messageCount: Math.floor(5 + Math.random() * 100),
  tokens: Math.floor(1000 + Math.random() * 50000),
  cost: Math.random() * 2,
}));

export default function SessionsPage() {
  const router = useRouter();
  const [channelFilter, setChannelFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");

  const filteredSessions = useMemo(() => {
    return demoSessions.filter((s) => {
      if (channelFilter && s.channelType !== channelFilter) return false;
      if (statusFilter && s.status !== statusFilter) return false;
      if (search && !s.id.includes(search) && !s.channelId.includes(search)) return false;
      return true;
    });
  }, [channelFilter, statusFilter, search]);

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
    <div className="p-6 space-y-6">
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
          <option value="web">Web</option>
          <option value="cli">CLI</option>
          <option value="slack">Slack</option>
          <option value="discord">Discord</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-sm bg-dark-800 border border-dark-700 rounded-lg text-dark-200 focus:outline-none focus:border-accent-500"
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="idle">Idle</option>
          <option value="suspended">Suspended</option>
          <option value="terminated">Terminated</option>
        </select>
      </div>

      <DataTable
        columns={columns}
        data={filteredSessions}
        keyField="id"
        pageSize={10}
        onRowClick={(row) => router.push(`/dashboard/sessions/${row.id}`)}
      />
    </div>
  );
}
