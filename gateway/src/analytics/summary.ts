import type { Session } from "@karna/shared/types/session.js";
import type { Trace, TraceSpan } from "../observability/trace-collector.js";

export interface AnalyticsOverview {
  activeSessions: number;
  activeConnections: number;
  totalMessages: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
}

export interface AnalyticsLatencySummary {
  totalTraces: number;
  avgDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  toolSuccessRate: number;
  errorRate: number;
}

export interface AnalyticsWindowSummary {
  period: "7d" | "14d" | "30d";
  since: number;
  messages: number;
  tokens: number;
  costUsd: number;
  toolCalls: number;
  errors: number;
  sessionsCreated: number;
  activeAgents: number;
}

export interface AnalyticsToolSummary {
  name: string;
  count: number;
  failed: number;
  avgDurationMs: number;
  lastUsedAt?: number;
}

export interface AnalyticsModelSummary {
  model: string;
  traces: number;
  tokens: number;
  costUsd: number;
  avgDurationMs: number;
  errors: number;
}

export interface AnalyticsAgentSummary {
  agentId: string;
  traces: number;
  tokens: number;
  costUsd: number;
  avgDurationMs: number;
  errors: number;
}

export interface AnalyticsSummary {
  overview: AnalyticsOverview;
  metrics: unknown;
  sessionsByChannel: Record<string, number>;
  window: AnalyticsWindowSummary;
  latency: AnalyticsLatencySummary;
  topTools: AnalyticsToolSummary[];
  models: AnalyticsModelSummary[];
  agents: AnalyticsAgentSummary[];
}

interface BuildAnalyticsSummaryOptions {
  sessions: Session[];
  connectedClients: number;
  metrics: unknown;
  traces: Trace[];
  sessionsCreated: number;
  periodDays: 7 | 14 | 30;
  now?: number;
}

export function parseAnalyticsPeriod(period: string | undefined): 7 | 14 | 30 | null {
  if (!period || period === "7d") return 7;
  if (period === "14d") return 14;
  if (period === "30d") return 30;
  return null;
}

export function getAnalyticsWindowStart(periodDays: 7 | 14 | 30, now = Date.now()): number {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  return startOfToday.getTime() - (periodDays - 1) * 86_400_000;
}

export function buildAnalyticsSummary(
  options: BuildAnalyticsSummaryOptions,
): AnalyticsSummary {
  const {
    sessions,
    connectedClients,
    metrics,
    traces,
    sessionsCreated,
    periodDays,
    now,
  } = options;
  const windowStart = getAnalyticsWindowStart(periodDays, now);

  let totalMessages = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd = 0;

  for (const session of sessions) {
    if (!session.stats) continue;
    totalMessages += session.stats.messageCount;
    totalInputTokens += session.stats.totalInputTokens;
    totalOutputTokens += session.stats.totalOutputTokens;
    totalCostUsd += session.stats.totalCostUsd;
  }

  const sessionsByChannel = sessions.reduce<Record<string, number>>((acc, session) => {
    acc[session.channelType] = (acc[session.channelType] ?? 0) + 1;
    return acc;
  }, {});

  const durations = traces
    .map((trace) => trace.durationMs ?? 0)
    .filter((duration) => duration >= 0)
    .sort((left, right) => left - right);

  const toolSpans = traces.flatMap((trace) =>
    trace.spans.filter((span) => span.kind === "tool"),
  );
  const failedToolSpans = toolSpans.filter((span) => span.status === "error");
  const totalTokens = traces.reduce(
    (sum, trace) => sum + trace.inputTokens + trace.outputTokens,
    0,
  );
  const totalCost = traces.reduce((sum, trace) => sum + trace.costUsd, 0);
  const totalToolCalls = traces.reduce((sum, trace) => sum + trace.toolCalls, 0);
  const totalErrors = traces.filter((trace) => !trace.success).length;

  return {
    overview: {
      activeSessions: sessions.length,
      activeConnections: connectedClients,
      totalMessages,
      totalInputTokens,
      totalOutputTokens,
      totalCostUsd: roundUsd(totalCostUsd),
    },
    metrics,
    sessionsByChannel,
    window: {
      period: `${periodDays}d`,
      since: windowStart,
      messages: traces.length,
      tokens: totalTokens,
      costUsd: roundUsd(totalCost),
      toolCalls: totalToolCalls,
      errors: totalErrors,
      sessionsCreated,
      activeAgents: new Set(traces.map((trace) => trace.agentId)).size,
    },
    latency: {
      totalTraces: traces.length,
      avgDurationMs: Math.round(average(durations)),
      p50DurationMs: percentile(durations, 0.5),
      p95DurationMs: percentile(durations, 0.95),
      p99DurationMs: percentile(durations, 0.99),
      toolSuccessRate: toolSpans.length === 0 ? 1 : 1 - failedToolSpans.length / toolSpans.length,
      errorRate: traces.length === 0 ? 0 : totalErrors / traces.length,
    },
    topTools: summarizeTools(toolSpans),
    models: summarizeModels(traces),
    agents: summarizeAgents(traces),
  };
}

function summarizeTools(spans: TraceSpan[]): AnalyticsToolSummary[] {
  const grouped = new Map<string, { count: number; failed: number; durations: number[]; lastUsedAt?: number }>();

  for (const span of spans) {
    const entry = grouped.get(span.name) ?? {
      count: 0,
      failed: 0,
      durations: [],
      lastUsedAt: undefined,
    };
    entry.count += 1;
    if (span.status === "error") {
      entry.failed += 1;
    }
    if (typeof span.durationMs === "number") {
      entry.durations.push(span.durationMs);
    }
    entry.lastUsedAt = Math.max(entry.lastUsedAt ?? 0, span.endedAt ?? span.startedAt);
    grouped.set(span.name, entry);
  }

  return Array.from(grouped.entries())
    .map(([name, entry]) => ({
      name,
      count: entry.count,
      failed: entry.failed,
      avgDurationMs: Math.round(average(entry.durations)),
      lastUsedAt: entry.lastUsedAt,
    }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, 8);
}

function summarizeModels(traces: Trace[]): AnalyticsModelSummary[] {
  const grouped = new Map<string, { traces: number; tokens: number; costUsd: number; durations: number[]; errors: number }>();

  for (const trace of traces) {
    const key = trace.model || "unknown";
    const entry = grouped.get(key) ?? {
      traces: 0,
      tokens: 0,
      costUsd: 0,
      durations: [],
      errors: 0,
    };
    entry.traces += 1;
    entry.tokens += trace.inputTokens + trace.outputTokens;
    entry.costUsd += trace.costUsd;
    entry.errors += trace.success ? 0 : 1;
    if (typeof trace.durationMs === "number") {
      entry.durations.push(trace.durationMs);
    }
    grouped.set(key, entry);
  }

  return Array.from(grouped.entries())
    .map(([model, entry]) => ({
      model,
      traces: entry.traces,
      tokens: entry.tokens,
      costUsd: roundUsd(entry.costUsd),
      avgDurationMs: Math.round(average(entry.durations)),
      errors: entry.errors,
    }))
    .sort((left, right) => right.tokens - left.tokens || right.traces - left.traces)
    .slice(0, 8);
}

function summarizeAgents(traces: Trace[]): AnalyticsAgentSummary[] {
  const grouped = new Map<string, { traces: number; tokens: number; costUsd: number; durations: number[]; errors: number }>();

  for (const trace of traces) {
    const key = trace.agentId || "unknown";
    const entry = grouped.get(key) ?? {
      traces: 0,
      tokens: 0,
      costUsd: 0,
      durations: [],
      errors: 0,
    };
    entry.traces += 1;
    entry.tokens += trace.inputTokens + trace.outputTokens;
    entry.costUsd += trace.costUsd;
    entry.errors += trace.success ? 0 : 1;
    if (typeof trace.durationMs === "number") {
      entry.durations.push(trace.durationMs);
    }
    grouped.set(key, entry);
  }

  return Array.from(grouped.entries())
    .map(([agentId, entry]) => ({
      agentId,
      traces: entry.traces,
      tokens: entry.tokens,
      costUsd: roundUsd(entry.costUsd),
      avgDurationMs: Math.round(average(entry.durations)),
      errors: entry.errors,
    }))
    .sort((left, right) => right.traces - left.traces || right.tokens - left.tokens)
    .slice(0, 8);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const index = Math.ceil(values.length * ratio) - 1;
  return values[Math.max(0, index)];
}

function roundUsd(value: number): number {
  return Number(value.toFixed(4));
}
