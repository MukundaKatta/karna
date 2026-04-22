"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ChevronRight,
  Clock,
  RefreshCw,
  Search,
  Sparkles,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/Badge";
import { StatsCard } from "@/components/StatsCard";
import { cn, formatCost, formatDate, formatRelativeTime, formatTokens } from "@/lib/utils";

type StatusFilter = "all" | "ok" | "error" | "active";
type TraceRange = "1h" | "24h" | "7d";

interface TraceSpan {
  spanId: string;
  name: string;
  kind: "context" | "model" | "tool" | "memory" | "skill" | "handoff" | "custom";
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  status: "ok" | "error" | "cancelled";
}

interface Trace {
  traceId: string;
  sessionId: string;
  agentId: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  toolCalls: number;
  success: boolean;
  error?: string;
  spans: TraceSpan[];
}

interface TraceListResponse {
  traces?: Trace[];
  total?: number;
  active?: number;
}

interface TraceDetailResponse {
  trace?: Trace;
  active?: boolean;
}

interface TraceStatsResponse {
  stats?: {
    totalTraces?: number;
    avgDurationMs?: number;
    p50DurationMs?: number;
    p95DurationMs?: number;
    p99DurationMs?: number;
    totalTokens?: number;
    totalCostUsd?: number;
    toolSuccessRate?: number;
    errorRate?: number;
    tracesPerMinute?: number;
  };
  activeTraces?: number;
  storedTraces?: number;
}

const kindColors: Record<TraceSpan["kind"], string> = {
  context: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  model: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  tool: "bg-green-500/20 text-green-400 border-green-500/30",
  memory: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  skill: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  handoff: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  custom: "bg-dark-700 text-dark-300 border-dark-600",
};

const traceRanges: Record<TraceRange, number> = {
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 604_800_000,
};

export default function ObservabilityPage() {
  const [traces, setTraces] = useState<Trace[]>([]);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [selectedTraceDetail, setSelectedTraceDetail] = useState<Trace | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [range, setRange] = useState<TraceRange>("24h");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [traceStats, setTraceStats] = useState<TraceStatsResponse["stats"]>();
  const [activeTraces, setActiveTraces] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const periodMs = traceRanges[range];
    const since = Date.now() - periodMs;

    async function fetchObservability() {
      setIsLoading(true);
      setError(null);

      try {
        const [listRes, statsRes] = await Promise.all([
          fetch(`/api/traces?includeActive=true&limit=80&since=${since}`, {
            cache: "no-store",
          }),
          fetch(`/api/traces/stats?periodMs=${periodMs}`, {
            cache: "no-store",
          }),
        ]);

        if (!listRes.ok) {
          throw new Error(`Trace list request failed with ${listRes.status}`);
        }
        if (!statsRes.ok) {
          throw new Error(`Trace stats request failed with ${statsRes.status}`);
        }

        const listPayload = (await listRes.json()) as TraceListResponse;
        const statsPayload = (await statsRes.json()) as TraceStatsResponse;

        if (cancelled) return;

        const nextTraces = listPayload.traces ?? [];
        setTraces(nextTraces);
        setTraceStats(statsPayload.stats);
        setActiveTraces(statsPayload.activeTraces ?? listPayload.active ?? 0);

        const hasSelectedTrace = selectedTraceId
          ? nextTraces.some((trace) => trace.traceId === selectedTraceId)
          : false;
        if (!hasSelectedTrace) {
          setSelectedTraceId(nextTraces[0]?.traceId ?? null);
        }
      } catch (fetchError) {
        if (cancelled) return;
        setTraces([]);
        setTraceStats(undefined);
        setActiveTraces(0);
        setSelectedTraceDetail(null);
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : "Failed to load live traces",
        );
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    }

    fetchObservability();

    return () => {
      cancelled = true;
    };
  }, [range, refreshKey]);

  useEffect(() => {
    if (!selectedTraceId) {
      setSelectedTraceDetail(null);
      return;
    }

    let cancelled = false;

    async function fetchTraceDetail() {
      try {
        const response = await fetch(`/api/traces/${selectedTraceId}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`Trace detail request failed with ${response.status}`);
        }

        const payload = (await response.json()) as TraceDetailResponse;
        if (!cancelled) {
          setSelectedTraceDetail(payload.trace ?? null);
        }
      } catch {
        if (!cancelled) {
          const fallback = traces.find((trace) => trace.traceId === selectedTraceId) ?? null;
          setSelectedTraceDetail(fallback);
        }
      }
    }

    fetchTraceDetail();

    return () => {
      cancelled = true;
    };
  }, [selectedTraceId, traces]);

  const filteredTraces = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return traces.filter((trace) => {
      if (query) {
        const haystack = [
          trace.traceId,
          trace.sessionId,
          trace.agentId,
          trace.model,
          ...trace.spans.map((span) => span.name),
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(query)) {
          return false;
        }
      }

      if (statusFilter === "ok") return Boolean(trace.endedAt) && trace.success;
      if (statusFilter === "error") return Boolean(trace.endedAt) && !trace.success;
      if (statusFilter === "active") return trace.endedAt === undefined;
      return true;
    });
  }, [searchQuery, statusFilter, traces]);

  const selectedTrace =
    selectedTraceDetail ??
    traces.find((trace) => trace.traceId === selectedTraceId) ??
    filteredTraces[0] ??
    null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-dark-400">
        Loading traces...
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
          <h1 className="text-xl font-semibold text-white">Observability</h1>
          <p className="text-sm text-dark-400 mt-1">
            Live trace explorer for agent runs, spans, and failures
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(["1h", "24h", "7d"] as const).map((option) => (
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
              {option}
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

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-4">
        <StatsCard
          title="Traces"
          value={(traceStats?.totalTraces ?? 0).toLocaleString()}
          icon={<Activity size={18} />}
        />
        <StatsCard
          title="Active"
          value={activeTraces}
          icon={<Sparkles size={18} />}
        />
        <StatsCard
          title="Avg Duration"
          value={`${Math.round(traceStats?.avgDurationMs ?? 0)}ms`}
          icon={<Clock size={18} />}
        />
        <StatsCard
          title="P95"
          value={`${Math.round(traceStats?.p95DurationMs ?? 0)}ms`}
          icon={<Zap size={18} />}
        />
        <StatsCard
          title="Tokens"
          value={formatTokens(traceStats?.totalTokens ?? 0)}
          icon={<Sparkles size={18} />}
        />
        <StatsCard
          title="Error Rate"
          value={`${((traceStats?.errorRate ?? 0) * 100).toFixed(1)}%`}
          icon={<AlertTriangle size={18} />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6">
        <div className="space-y-4">
          <div className="rounded-xl border border-dark-700 bg-dark-800 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="relative flex-1 max-w-xl">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500"
                />
                <input
                  type="text"
                  placeholder="Search traces, sessions, agents, tools..."
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="w-full rounded-lg border border-dark-700 bg-dark-900 pl-9 pr-3 py-2 text-sm text-dark-100 placeholder:text-dark-500 focus:outline-none focus:border-accent-500"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                className="rounded-lg border border-dark-700 bg-dark-900 px-3 py-2 text-sm text-dark-200"
              >
                <option value="all">All Statuses</option>
                <option value="active">Active</option>
                <option value="ok">Success</option>
                <option value="error">Error</option>
              </select>
            </div>
          </div>

          {filteredTraces.length > 0 ? (
            <div className="space-y-2">
              {filteredTraces.map((trace) => {
                const isSelected = selectedTrace?.traceId === trace.traceId;
                return (
                  <button
                    key={trace.traceId}
                    onClick={() => setSelectedTraceId(trace.traceId)}
                    className={cn(
                      "w-full rounded-xl border p-4 text-left transition-colors",
                      isSelected
                        ? "border-accent-500 bg-accent-600/10"
                        : "border-dark-700 bg-dark-800 hover:border-dark-600",
                    )}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={trace.endedAt === undefined ? "info" : trace.success ? "success" : "danger"}>
                            {trace.endedAt === undefined ? "active" : trace.success ? "ok" : "error"}
                          </Badge>
                          <code className="text-xs text-dark-200">{trace.traceId}</code>
                          <span className="text-xs text-dark-500">
                            {formatRelativeTime(trace.startedAt)}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-white">
                          {trace.agentId} on {trace.model || "unknown model"}
                        </p>
                        <div className="flex flex-wrap items-center gap-4 text-xs text-dark-400">
                          <span>session {trace.sessionId}</span>
                          <span>{Math.round(trace.durationMs ?? 0)}ms</span>
                          <span>{trace.toolCalls} tools</span>
                          <span>{formatTokens(trace.inputTokens + trace.outputTokens)}</span>
                          <span>{formatCost(trace.costUsd)}</span>
                        </div>
                      </div>
                      <ChevronRight size={16} className="text-dark-500 shrink-0" />
                    </div>

                    <div className="mt-3 h-6 relative overflow-hidden rounded bg-dark-900">
                      {trace.spans.map((span) => {
                        const totalDuration = Math.max(trace.durationMs ?? 0, 1);
                        const offset = ((span.startedAt - trace.startedAt) / totalDuration) * 100;
                        const width = Math.max(
                          2,
                          (((span.durationMs ?? 0) || 1) / totalDuration) * 100,
                        );
                        const color =
                          span.kind === "tool"
                            ? span.status === "error"
                              ? "bg-red-500/60"
                              : "bg-green-500/60"
                            : span.kind === "model"
                              ? "bg-purple-500/60"
                              : "bg-blue-500/60";

                        return (
                          <div
                            key={span.spanId}
                            className={cn("absolute top-1 h-4 rounded-sm", color)}
                            style={{ left: `${offset}%`, width: `${width}%` }}
                            title={`${span.name}: ${Math.round(span.durationMs ?? 0)}ms`}
                          />
                        );
                      })}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-dark-700 bg-dark-800 px-5 py-12 text-center text-sm text-dark-400">
              No traces matched the current filters.
            </div>
          )}
        </div>

        <div className="rounded-xl border border-dark-700 bg-dark-800 p-4 space-y-4 h-fit lg:sticky lg:top-4">
          {selectedTrace ? (
            <>
              <div>
                <h3 className="text-base font-semibold text-white">Trace Detail</h3>
                <p className="text-xs text-dark-400 mt-1">
                  {selectedTrace.traceId} • started {formatDate(selectedTrace.startedAt)}
                </p>
              </div>

              <div className="space-y-2 text-sm">
                <DetailRow label="Agent" value={selectedTrace.agentId} />
                <DetailRow label="Model" value={selectedTrace.model || "unknown"} />
                <DetailRow label="Session" value={selectedTrace.sessionId} mono />
                <DetailRow
                  label="Duration"
                  value={`${Math.round(selectedTrace.durationMs ?? 0)}ms`}
                />
                <DetailRow
                  label="Tokens"
                  value={`${selectedTrace.inputTokens} in / ${selectedTrace.outputTokens} out`}
                />
                <DetailRow label="Cost" value={formatCost(selectedTrace.costUsd)} />
                <DetailRow
                  label="Status"
                  value={
                    selectedTrace.endedAt === undefined
                      ? "active"
                      : selectedTrace.success
                        ? "success"
                        : "error"
                  }
                  valueClassName={
                    selectedTrace.endedAt === undefined
                      ? "text-blue-400"
                      : selectedTrace.success
                        ? "text-green-400"
                        : "text-red-400"
                  }
                />
              </div>

              {selectedTrace.error && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-3 text-sm text-red-300">
                  {selectedTrace.error}
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-medium text-white">Spans</h4>
                  <Badge variant="default">{selectedTrace.spans.length}</Badge>
                </div>
                <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
                  {selectedTrace.spans.map((span) => (
                    <div
                      key={span.spanId}
                      className={cn(
                        "rounded-lg border px-3 py-2",
                        kindColors[span.kind] ?? kindColors.custom,
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-semibold uppercase tracking-wide">
                              {span.kind}
                            </span>
                            <span className="truncate text-sm">{span.name}</span>
                          </div>
                          <p className="mt-1 text-[11px] opacity-75">
                            {formatDate(span.startedAt, "HH:mm:ss.SSS")}
                          </p>
                        </div>
                        <div className="text-right text-xs opacity-80">
                          <p>{Math.round(span.durationMs ?? 0)}ms</p>
                          <p>{span.status}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="flex min-h-[320px] items-center justify-center text-sm text-dark-400">
              Select a trace to inspect span-level details.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
  valueClassName,
}: {
  label: string;
  value: string;
  mono?: boolean;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-dark-400">{label}</span>
      <span
        className={cn(
          "text-right text-dark-200",
          mono && "font-mono text-xs",
          valueClassName,
        )}
      >
        {value}
      </span>
    </div>
  );
}
