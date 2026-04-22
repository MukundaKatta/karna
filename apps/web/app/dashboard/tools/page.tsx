"use client";

import { useEffect, useMemo, useState } from "react";
import { Wrench, Search, ShieldAlert, ShieldCheck, Shield } from "lucide-react";
import { cn, riskBgColor, formatDate } from "@/lib/utils";
import { Badge } from "@/components/Badge";
import { DataTable, type Column } from "@/components/DataTable";

interface Tool {
  name: string;
  description: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  requiresApproval: boolean;
  enabled: boolean;
  totalCalls: number;
  failedCalls: number;
  tags: string[];
  lastUsedAt?: number;
}

interface TraceResponse {
  traces?: Array<{
    traceId: string;
    sessionId: string;
    spans: Array<{
      spanId: string;
      name: string;
      kind: string;
      status: "ok" | "error" | "cancelled";
      startedAt: number;
      endedAt?: number;
      durationMs?: number;
    }>;
  }>;
}

interface ExecutionEntry {
  id: string;
  toolName: string;
  sessionId: string;
  status: "completed" | "failed";
  durationMs: number;
  timestamp: number;
}

export default function ToolsPage() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [executions, setExecutions] = useState<ExecutionEntry[]>([]);
  const [search, setSearch] = useState("");
  const [auditFilter, setAuditFilter] = useState({ tool: "", status: "" });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchTools() {
      setIsLoading(true);
      setError(null);

      try {
        const [toolsResponse, tracesResponse] = await Promise.all([
          fetch("/api/tools", { cache: "no-store" }),
          fetch("/api/traces?limit=100", { cache: "no-store" }),
        ]);

        if (!toolsResponse.ok) {
          throw new Error(`Tool request failed with ${toolsResponse.status}`);
        }

        const toolPayload = (await toolsResponse.json()) as { tools?: Tool[] };
        const tracePayload = tracesResponse.ok
          ? ((await tracesResponse.json()) as TraceResponse)
          : { traces: [] };

        if (cancelled) return;

        setTools(toolPayload.tools ?? []);
        setExecutions(
          (tracePayload.traces ?? [])
            .flatMap((trace) =>
              trace.spans
                .filter((span) => span.kind === "tool")
                .map<ExecutionEntry>((span) => {
                  const status: ExecutionEntry["status"] =
                    span.status === "error" ? "failed" : "completed";

                  return {
                    id: `${trace.traceId}:${span.spanId}`,
                    toolName: span.name,
                    sessionId: trace.sessionId,
                    status,
                    durationMs:
                      span.durationMs ??
                      Math.max((span.endedAt ?? span.startedAt) - span.startedAt, 0),
                    timestamp: span.endedAt ?? span.startedAt,
                  };
                }),
            )
            .sort((left, right) => right.timestamp - left.timestamp),
        );
      } catch (fetchError) {
        if (cancelled) return;
        setTools([]);
        setExecutions([]);
        setError(fetchError instanceof Error ? fetchError.message : "Failed to load live tools");
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchTools();

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredTools = useMemo(() => {
    if (!search) return tools;
    const q = search.toLowerCase();
    return tools.filter(
      (tool) =>
        tool.name.toLowerCase().includes(q) ||
        tool.description.toLowerCase().includes(q) ||
        tool.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  }, [tools, search]);

  const filteredAudit = useMemo(() => {
    return executions.filter((e) => {
      if (auditFilter.tool && e.toolName !== auditFilter.tool) return false;
      if (auditFilter.status && e.status !== auditFilter.status) return false;
      return true;
    });
  }, [auditFilter, executions]);

  const riskIcon = (level: string) => {
    switch (level) {
      case "critical": return <ShieldAlert size={16} className="text-red-400" />;
      case "high": return <ShieldAlert size={16} className="text-danger-400" />;
      case "medium": return <Shield size={16} className="text-warning-400" />;
      default: return <ShieldCheck size={16} className="text-success-400" />;
    }
  };

  const auditColumns: Column<ExecutionEntry>[] = [
    {
      key: "toolName",
      label: "Tool",
      sortable: true,
      render: (val) => <code className="text-xs text-accent-400">{val as string}</code>,
    },
    {
      key: "sessionId",
      label: "Session",
      render: (val) => <span className="font-mono text-xs">{val as string}</span>,
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (val) => {
        const s = val as string;
        const variant = s === "completed" ? "success" : "danger";
        return <Badge variant={variant}>{s}</Badge>;
      },
    },
    {
      key: "durationMs",
      label: "Duration",
      sortable: true,
      className: "text-right",
      render: (val) => `${val as number}ms`,
    },
    {
      key: "timestamp",
      label: "Time",
      sortable: true,
      render: (val) => <span className="text-xs text-dark-400">{formatDate(val as number, "HH:mm:ss")}</span>,
    },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-6 sm:space-y-8 overflow-y-auto h-full">
      {error && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-300">
          {error}
        </div>
      )}

      <div>
        <h1 className="text-xl font-semibold text-white">Tools</h1>
        <p className="text-sm text-dark-400 mt-1">Inspect live tool inventory and recent executions</p>
      </div>

      {/* Tool list */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-medium text-white">Registered Tools</h2>
          <div className="relative w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500" />
            <input
              type="text"
              placeholder="Search tools..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-sm bg-dark-800 border border-dark-700 rounded-lg text-dark-200 placeholder:text-dark-500 focus:outline-none focus:border-accent-500"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="rounded-xl border border-dark-700 bg-dark-800 px-5 py-12 text-center text-sm text-dark-400">
            Loading tool inventory...
          </div>
        ) : filteredTools.length > 0 ? (
          <div className="rounded-xl border border-dark-700 bg-dark-800 divide-y divide-dark-700/50">
            {filteredTools.map((tool) => (
              <div
                key={tool.name}
                className={cn(
                  "flex items-start gap-4 px-5 py-3.5 transition-opacity",
                  !tool.enabled && "opacity-50",
                )}
              >
                <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-dark-700">
                  {riskIcon(tool.riskLevel)}
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="text-sm font-medium text-dark-100">{tool.name}</code>
                    <span className={cn("px-1.5 py-0.5 text-xs rounded", riskBgColor(tool.riskLevel))}>
                      {tool.riskLevel}
                    </span>
                    <Badge variant={tool.requiresApproval ? "warning" : "success"}>
                      {tool.requiresApproval ? "approval required" : "self-serve"}
                    </Badge>
                    <Badge variant={tool.enabled ? "success" : "default"}>
                      {tool.enabled ? "enabled" : "disabled"}
                    </Badge>
                  </div>
                  <p className="text-xs text-dark-400">{tool.description}</p>
                  {tool.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {tool.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 text-xs bg-dark-700 text-dark-300 rounded-md"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-4 text-xs text-dark-400 shrink-0">
                  <div className="text-right">
                    <p>Total Calls</p>
                    <p className="text-sm font-semibold text-white">{tool.totalCalls}</p>
                  </div>
                  <div className="text-right">
                    <p>Failures</p>
                    <p className="text-sm font-semibold text-white">{tool.failedCalls}</p>
                  </div>
                  <div className="text-right">
                    <p>Last Used</p>
                    <p className="text-sm font-semibold text-white">
                      {tool.lastUsedAt ? formatDate(tool.lastUsedAt, "MMM d") : "Never"}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dark-700 bg-dark-800 px-5 py-12 text-center text-sm text-dark-400">
            No tools matched your search.
          </div>
        )}
      </div>

      {/* Audit log */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-medium text-white">Recent Executions</h2>
          <div className="flex gap-2">
            <select
              value={auditFilter.tool}
              onChange={(e) => setAuditFilter({ ...auditFilter, tool: e.target.value })}
              className="px-2 py-1.5 text-xs bg-dark-800 border border-dark-700 rounded-lg text-dark-200 focus:outline-none focus:border-accent-500"
            >
              <option value="">All Tools</option>
              {tools.map((t) => (
                <option key={t.name} value={t.name}>{t.name}</option>
              ))}
            </select>
            <select
              value={auditFilter.status}
              onChange={(e) => setAuditFilter({ ...auditFilter, status: e.target.value })}
              className="px-2 py-1.5 text-xs bg-dark-800 border border-dark-700 rounded-lg text-dark-200 focus:outline-none focus:border-accent-500"
            >
              <option value="">All Statuses</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </div>

        <DataTable
          columns={auditColumns}
          data={filteredAudit}
          keyField="id"
          pageSize={8}
          emptyMessage={isLoading ? "Loading executions..." : "No executions captured yet"}
        />
      </div>
    </div>
  );
}
