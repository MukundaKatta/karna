"use client";

import { useState, useMemo } from "react";
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
  usageCount: number;
  lastUsedAt?: number;
}

interface AuditEntry {
  id: string;
  toolName: string;
  sessionId: string;
  status: "completed" | "failed" | "approved" | "rejected";
  arguments: Record<string, unknown>;
  durationMs: number;
  timestamp: number;
}

const demoTools: Tool[] = [
  { name: "file_read", description: "Read contents of a file", riskLevel: "low", requiresApproval: false, enabled: true, usageCount: 432, lastUsedAt: Date.now() - 60000 },
  { name: "file_write", description: "Write or modify file contents", riskLevel: "medium", requiresApproval: true, enabled: true, usageCount: 156, lastUsedAt: Date.now() - 300000 },
  { name: "web_search", description: "Search the internet", riskLevel: "low", requiresApproval: false, enabled: true, usageCount: 289, lastUsedAt: Date.now() - 120000 },
  { name: "code_execute", description: "Execute code in a sandbox", riskLevel: "high", requiresApproval: true, enabled: true, usageCount: 87, lastUsedAt: Date.now() - 600000 },
  { name: "shell_exec", description: "Execute shell commands", riskLevel: "critical", requiresApproval: true, enabled: false, usageCount: 12, lastUsedAt: Date.now() - 86400000 },
  { name: "git_commit", description: "Create git commits", riskLevel: "medium", requiresApproval: true, enabled: true, usageCount: 45, lastUsedAt: Date.now() - 1800000 },
  { name: "db_query", description: "Execute database queries", riskLevel: "high", requiresApproval: true, enabled: true, usageCount: 67, lastUsedAt: Date.now() - 3600000 },
  { name: "web_scrape", description: "Scrape web page content", riskLevel: "low", requiresApproval: false, enabled: true, usageCount: 134, lastUsedAt: Date.now() - 900000 },
];

const demoAuditLog: AuditEntry[] = Array.from({ length: 25 }, (_, i) => ({
  id: `audit-${i}`,
  toolName: demoTools[i % demoTools.length].name,
  sessionId: `sess-${1000 + (i % 8)}`,
  status: (["completed", "failed", "approved", "rejected"] as const)[i % 4],
  arguments: { path: `/tmp/file-${i}.txt` },
  durationMs: Math.floor(50 + Math.random() * 2000),
  timestamp: Date.now() - (i * 180000),
}));

export default function ToolsPage() {
  const [tools, setTools] = useState<Tool[]>(demoTools);
  const [search, setSearch] = useState("");
  const [auditFilter, setAuditFilter] = useState({ tool: "", status: "" });

  const filteredTools = useMemo(() => {
    if (!search) return tools;
    const q = search.toLowerCase();
    return tools.filter(
      (t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
    );
  }, [tools, search]);

  const filteredAudit = useMemo(() => {
    return demoAuditLog.filter((e) => {
      if (auditFilter.tool && e.toolName !== auditFilter.tool) return false;
      if (auditFilter.status && e.status !== auditFilter.status) return false;
      return true;
    });
  }, [auditFilter]);

  const toggleApproval = (name: string) => {
    setTools(
      tools.map((t) =>
        t.name === name ? { ...t, requiresApproval: !t.requiresApproval } : t,
      ),
    );
  };

  const toggleEnabled = (name: string) => {
    setTools(
      tools.map((t) =>
        t.name === name ? { ...t, enabled: !t.enabled } : t,
      ),
    );
  };

  const riskIcon = (level: string) => {
    switch (level) {
      case "critical": return <ShieldAlert size={16} className="text-red-400" />;
      case "high": return <ShieldAlert size={16} className="text-danger-400" />;
      case "medium": return <Shield size={16} className="text-warning-400" />;
      default: return <ShieldCheck size={16} className="text-success-400" />;
    }
  };

  const auditColumns: Column<AuditEntry>[] = [
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
        const variant = s === "completed" ? "success" : s === "failed" ? "danger" : s === "approved" ? "info" : "warning";
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
    <div className="p-6 space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-white">Tools</h1>
        <p className="text-sm text-dark-400 mt-1">Manage tool permissions and view audit log</p>
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

        <div className="rounded-xl border border-dark-700 bg-dark-800 divide-y divide-dark-700/50">
          {filteredTools.map((tool) => (
            <div
              key={tool.name}
              className={cn(
                "flex items-center gap-4 px-5 py-3.5 transition-opacity",
                !tool.enabled && "opacity-50",
              )}
            >
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-dark-700">
                {riskIcon(tool.riskLevel)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <code className="text-sm font-medium text-dark-100">{tool.name}</code>
                  <span className={cn("px-1.5 py-0.5 text-xs rounded", riskBgColor(tool.riskLevel))}>
                    {tool.riskLevel}
                  </span>
                </div>
                <p className="text-xs text-dark-400 mt-0.5">{tool.description}</p>
              </div>
              <div className="flex items-center gap-4 text-xs text-dark-400 shrink-0">
                <span>{tool.usageCount} uses</span>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={tool.requiresApproval}
                    onChange={() => toggleApproval(tool.name)}
                    className="w-3.5 h-3.5 rounded border-dark-600 bg-dark-700 text-accent-600 focus:ring-accent-500"
                  />
                  <span>Approval</span>
                </label>
                <button
                  onClick={() => toggleEnabled(tool.name)}
                  className={cn(
                    "relative w-9 h-5 rounded-full transition-colors",
                    tool.enabled ? "bg-accent-600" : "bg-dark-600",
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform",
                      tool.enabled ? "left-4.5" : "left-0.5",
                    )}
                  />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Audit log */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-medium text-white">Audit Log</h2>
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
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
        </div>

        <DataTable
          columns={auditColumns}
          data={filteredAudit}
          keyField="id"
          pageSize={8}
        />
      </div>
    </div>
  );
}
