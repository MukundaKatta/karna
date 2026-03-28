"use client";

import { useState, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Activity, Clock, Zap, AlertTriangle, DollarSign, Cpu, ChevronRight, Search } from "lucide-react";

// Demo trace data
function generateDemoTraces() {
  const models = ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "gpt-4o"];
  const tools = ["file_read", "file_write", "web_search", "code_exec", "shell_exec", "memory_search"];
  const agents = ["karna-default", "code-reviewer", "research-assistant"];
  const statuses: ("ok" | "error")[] = ["ok", "ok", "ok", "ok", "error"];

  return Array.from({ length: 50 }, (_, i) => {
    const startedAt = Date.now() - (i * 180000) - Math.random() * 60000;
    const durationMs = 200 + Math.random() * 5000;
    const model = models[Math.floor(Math.random() * models.length)];
    const numTools = Math.floor(Math.random() * 4);
    const inputTokens = 500 + Math.floor(Math.random() * 3000);
    const outputTokens = 100 + Math.floor(Math.random() * 2000);
    const status = statuses[Math.floor(Math.random() * statuses.length)];

    const spans = [
      {
        spanId: `span-${i}-ctx`,
        name: "build_context",
        kind: "context" as const,
        startedAt,
        durationMs: 20 + Math.random() * 50,
        status: "ok" as const,
      },
      {
        spanId: `span-${i}-model`,
        name: `${model}`,
        kind: "model" as const,
        startedAt: startedAt + 50,
        durationMs: durationMs * 0.6,
        status: status,
      },
      ...Array.from({ length: numTools }, (_, j) => ({
        spanId: `span-${i}-tool-${j}`,
        name: tools[Math.floor(Math.random() * tools.length)],
        kind: "tool" as const,
        startedAt: startedAt + durationMs * 0.6 + j * 300,
        durationMs: 50 + Math.random() * 1500,
        status: (Math.random() > 0.85 ? "error" : "ok") as "ok" | "error",
      })),
    ];

    return {
      traceId: `trace-${1000 + i}`,
      sessionId: `sess-${1000 + Math.floor(i / 3)}`,
      agentId: agents[Math.floor(Math.random() * agents.length)],
      startedAt,
      durationMs,
      model,
      inputTokens,
      outputTokens,
      costUsd: (inputTokens * 0.003 + outputTokens * 0.015) / 1000,
      toolCalls: numTools,
      success: status === "ok",
      error: status === "error" ? "Tool execution failed" : undefined,
      spans,
    };
  });
}

const kindColors: Record<string, string> = {
  context: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  model: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  tool: "bg-green-500/20 text-green-400 border-green-500/30",
  memory: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  skill: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  handoff: "bg-pink-500/20 text-pink-400 border-pink-500/30",
};

export default function ObservabilityPage() {
  const [traces] = useState(generateDemoTraces);
  const [selectedTrace, setSelectedTrace] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "ok" | "error">("all");

  const filteredTraces = useMemo(() => {
    let result = traces;
    if (searchQuery) {
      result = result.filter(
        (t) =>
          t.traceId.includes(searchQuery) ||
          t.sessionId.includes(searchQuery) ||
          t.agentId.includes(searchQuery) ||
          t.model.includes(searchQuery)
      );
    }
    if (statusFilter !== "all") {
      result = result.filter((t) => (statusFilter === "ok" ? t.success : !t.success));
    }
    return result;
  }, [traces, searchQuery, statusFilter]);

  const stats = useMemo(() => {
    const durations = traces.map((t) => t.durationMs).sort((a, b) => a - b);
    const p = (arr: number[], pct: number) => arr[Math.ceil(arr.length * pct) - 1] || 0;
    const errorCount = traces.filter((t) => !t.success).length;
    const toolSpans = traces.flatMap((t) => t.spans.filter((s) => s.kind === "tool"));
    const failedTools = toolSpans.filter((s) => s.status === "error").length;

    return {
      totalTraces: traces.length,
      avgDuration: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
      p50: Math.round(p(durations, 0.5)),
      p95: Math.round(p(durations, 0.95)),
      p99: Math.round(p(durations, 0.99)),
      errorRate: ((errorCount / traces.length) * 100).toFixed(1),
      toolSuccessRate: toolSpans.length > 0
        ? (((toolSpans.length - failedTools) / toolSpans.length) * 100).toFixed(1)
        : "100.0",
      totalCost: traces.reduce((a, t) => a + t.costUsd, 0).toFixed(2),
      totalTokens: traces.reduce((a, t) => a + t.inputTokens + t.outputTokens, 0),
    };
  }, [traces]);

  const selected = selectedTrace ? traces.find((t) => t.traceId === selectedTrace) : null;

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-y-auto h-full">
      <div>
        <h1 className="text-2xl font-bold text-white">Observability</h1>
        <p className="text-dark-400 mt-1">Real-time agent traces and performance metrics</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Traces", value: stats.totalTraces, icon: Activity },
          { label: "Avg Latency", value: `${stats.avgDuration}ms`, icon: Clock },
          { label: "P95 Latency", value: `${stats.p95}ms`, icon: Zap },
          { label: "Error Rate", value: `${stats.errorRate}%`, icon: AlertTriangle },
          { label: "Tool Success", value: `${stats.toolSuccessRate}%`, icon: Cpu },
          { label: "P99 Latency", value: `${stats.p99}ms`, icon: Clock },
          { label: "Total Tokens", value: stats.totalTokens.toLocaleString(), icon: Zap },
          { label: "Total Cost", value: `$${stats.totalCost}`, icon: DollarSign },
        ].map(({ label, value, icon: Icon }) => (
          <div
            key={label}
            className="rounded-xl border border-dark-700 bg-dark-800 p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-dark-400">{label}</p>
              <Icon size={14} className="text-dark-500" />
            </div>
            <p className="text-lg font-bold text-white">{value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 items-center">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-400" />
          <input
            type="text"
            placeholder="Search traces..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-lg bg-dark-800 border border-dark-700 text-dark-200 text-sm focus:outline-none focus:border-accent-500"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "all" | "ok" | "error")}
          className="px-3 py-2 rounded-lg bg-dark-800 border border-dark-700 text-dark-200 text-sm"
        >
          <option value="all">All Status</option>
          <option value="ok">Success</option>
          <option value="error">Error</option>
        </select>
      </div>

      <div className="flex gap-4">
        {/* Trace List */}
        <div className="flex-1 space-y-2">
          {filteredTraces.slice(0, 20).map((trace) => (
            <button
              key={trace.traceId}
              onClick={() => setSelectedTrace(trace.traceId === selectedTrace ? null : trace.traceId)}
              className={cn(
                "w-full text-left rounded-xl border p-4 transition-colors",
                selectedTrace === trace.traceId
                  ? "border-accent-500 bg-accent-600/10"
                  : "border-dark-700 bg-dark-800 hover:border-dark-600"
              )}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "w-2 h-2 rounded-full",
                    trace.success ? "bg-green-400" : "bg-red-400"
                  )} />
                  <span className="text-sm font-mono text-dark-200">{trace.traceId}</span>
                </div>
                <ChevronRight size={14} className="text-dark-500" />
              </div>
              <div className="flex items-center gap-4 text-xs text-dark-400">
                <span>{trace.agentId}</span>
                <span>{Math.round(trace.durationMs)}ms</span>
                <span>{trace.toolCalls} tools</span>
                <span>{(trace.inputTokens + trace.outputTokens).toLocaleString()} tokens</span>
                <span>${trace.costUsd.toFixed(4)}</span>
              </div>

              {/* Mini span waterfall */}
              <div className="mt-3 h-6 relative bg-dark-900 rounded overflow-hidden">
                {trace.spans.map((span) => {
                  const offset = ((span.startedAt - trace.startedAt) / trace.durationMs) * 100;
                  const width = Math.max(2, ((span.durationMs ?? 0) / trace.durationMs) * 100);
                  const colors: Record<string, string> = {
                    context: "bg-blue-500/60",
                    model: "bg-purple-500/60",
                    tool: span.status === "error" ? "bg-red-500/60" : "bg-green-500/60",
                  };
                  return (
                    <div
                      key={span.spanId}
                      className={cn("absolute top-1 h-4 rounded-sm", colors[span.kind] ?? "bg-dark-500/60")}
                      style={{ left: `${offset}%`, width: `${width}%` }}
                      title={`${span.name}: ${Math.round(span.durationMs ?? 0)}ms`}
                    />
                  );
                })}
              </div>
            </button>
          ))}
        </div>

        {/* Detail Panel */}
        {selected && (
          <div className="w-96 shrink-0 rounded-xl border border-dark-700 bg-dark-800 p-4 space-y-4 sticky top-0">
            <h3 className="font-semibold text-white">Trace Detail</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-dark-400">Trace ID</span>
                <span className="font-mono text-dark-200">{selected.traceId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dark-400">Session</span>
                <span className="font-mono text-dark-200">{selected.sessionId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dark-400">Agent</span>
                <span className="text-dark-200">{selected.agentId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dark-400">Model</span>
                <span className="text-dark-200">{selected.model}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dark-400">Duration</span>
                <span className="text-dark-200">{Math.round(selected.durationMs)}ms</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dark-400">Tokens</span>
                <span className="text-dark-200">{selected.inputTokens} in / {selected.outputTokens} out</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dark-400">Cost</span>
                <span className="text-dark-200">${selected.costUsd.toFixed(4)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-dark-400">Status</span>
                <span className={selected.success ? "text-green-400" : "text-red-400"}>
                  {selected.success ? "Success" : "Error"}
                </span>
              </div>
            </div>

            <h4 className="font-medium text-white mt-4">Spans ({selected.spans.length})</h4>
            <div className="space-y-2">
              {selected.spans.map((span) => (
                <div
                  key={span.spanId}
                  className={cn(
                    "rounded-lg border px-3 py-2",
                    kindColors[span.kind] ?? "bg-dark-700 text-dark-300 border-dark-600"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium uppercase">{span.kind}</span>
                      <span className="text-sm">{span.name}</span>
                    </div>
                    <span className="text-xs opacity-70">{Math.round(span.durationMs ?? 0)}ms</span>
                  </div>
                  {span.status === "error" && (
                    <p className="text-xs text-red-400 mt-1">Error during execution</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
