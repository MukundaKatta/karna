// ─── Trace Collector ──────────────────────────────────────────────────────
//
// OpenTelemetry-compatible structured traces for agent operations.
// Each agent turn becomes a trace with spans for context building,
// model calls, tool executions, and memory operations.
//
// ──────────────────────────────────────────────────────────────────────────

import pino from "pino";
import { randomUUID } from "crypto";

const logger = pino({ name: "trace-collector" });

export type SpanKind = "context" | "model" | "tool" | "memory" | "skill" | "handoff" | "custom";
export type SpanStatus = "ok" | "error" | "cancelled";

export interface TraceSpan {
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: SpanKind;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  status: SpanStatus;
  attributes: Record<string, string | number | boolean>;
  events: SpanEvent[];
}

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, string | number | boolean>;
}

export interface Trace {
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

export interface TraceStats {
  totalTraces: number;
  avgDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  totalTokens: number;
  totalCostUsd: number;
  toolSuccessRate: number;
  errorRate: number;
  tracesPerMinute: number;
}

export interface TraceQueryOptions {
  sessionId?: string;
  agentId?: string;
  limit?: number;
  offset?: number;
  since?: number;
  includeActive?: boolean;
  success?: boolean;
  minDurationMs?: number;
  hasErrors?: boolean;
  toolName?: string;
}

export interface TraceQueryResult {
  traces: Trace[];
  total: number;
}

/**
 * Collects and stores structured traces for agent operations.
 * Uses an in-memory ring buffer with optional persistence.
 */
export class TraceCollector {
  private readonly traces: Trace[] = [];
  private readonly maxTraces: number;
  private activeTraces = new Map<string, Trace>();

  constructor(maxTraces = 1000) {
    this.maxTraces = maxTraces;
  }

  // ─── Trace Lifecycle ─────────────────────────────────────────────────

  startTrace(sessionId: string, agentId = "pending"): string {
    const traceId = randomUUID();
    const trace: Trace = {
      traceId,
      sessionId,
      agentId,
      startedAt: Date.now(),
      model: "",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      toolCalls: 0,
      success: false,
      spans: [],
    };
    this.activeTraces.set(traceId, trace);
    logger.debug({ traceId, sessionId, agentId }, "Trace started");
    return traceId;
  }

  endTrace(traceId: string, result: {
    success: boolean;
    agentId?: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd?: number;
    error?: string;
  }): Trace | null {
    const trace = this.activeTraces.get(traceId);
    if (!trace) return null;

    trace.endedAt = Date.now();
    trace.durationMs = trace.endedAt - trace.startedAt;
    trace.success = result.success;
    if (result.agentId) {
      trace.agentId = result.agentId;
    }
    trace.model = result.model;
    trace.inputTokens = result.inputTokens;
    trace.outputTokens = result.outputTokens;
    trace.costUsd = result.costUsd ?? 0;
    trace.error = result.error;
    trace.toolCalls = trace.spans.filter((s) => s.kind === "tool").length;

    // End any open spans
    for (const span of trace.spans) {
      if (!span.endedAt) {
        span.endedAt = trace.endedAt;
        span.durationMs = span.endedAt - span.startedAt;
        span.status = "cancelled";
      }
    }

    this.activeTraces.delete(traceId);
    this.addTrace(trace);

    logger.debug(
      { traceId, durationMs: trace.durationMs, toolCalls: trace.toolCalls },
      "Trace ended"
    );
    return trace;
  }

  // ─── Span Operations ─────────────────────────────────────────────────

  startSpan(traceId: string, name: string, kind: SpanKind, parentSpanId?: string): string {
    const trace = this.activeTraces.get(traceId);
    if (!trace) return "";

    const spanId = randomUUID();
    const span: TraceSpan = {
      spanId,
      parentSpanId,
      name,
      kind,
      startedAt: Date.now(),
      status: "ok",
      attributes: {},
      events: [],
    };
    trace.spans.push(span);
    return spanId;
  }

  endSpan(traceId: string, spanId: string, attributes?: Record<string, string | number | boolean>): void {
    const trace = this.activeTraces.get(traceId);
    if (!trace) return;

    const span = trace.spans.find((s) => s.spanId === spanId);
    if (!span) return;

    span.endedAt = Date.now();
    span.durationMs = span.endedAt - span.startedAt;
    if (attributes) Object.assign(span.attributes, attributes);
  }

  setSpanError(traceId: string, spanId: string, error: string): void {
    const trace = this.activeTraces.get(traceId);
    if (!trace) return;

    const span = trace.spans.find((s) => s.spanId === spanId);
    if (!span) return;

    span.status = "error";
    span.attributes["error"] = error;
  }

  addSpanEvent(traceId: string, spanId: string, name: string, attrs?: Record<string, string | number | boolean>): void {
    const trace = this.activeTraces.get(traceId);
    if (!trace) return;

    const span = trace.spans.find((s) => s.spanId === spanId);
    if (!span) return;

    span.events.push({ name, timestamp: Date.now(), attributes: attrs });
  }

  // ─── Storage ──────────────────────────────────────────────────────────

  private addTrace(trace: Trace): void {
    this.traces.push(trace);
    if (this.traces.length > this.maxTraces) {
      this.traces.shift();
    }
  }

  // ─── Queries ──────────────────────────────────────────────────────────

  getTrace(traceId: string): Trace | undefined {
    return this.traces.find((t) => t.traceId === traceId) ?? this.activeTraces.get(traceId);
  }

  getTraces(options?: TraceQueryOptions): Trace[] {
    return this.queryTraces(options).traces;
  }

  queryTraces(options: TraceQueryOptions = {}): TraceQueryResult {
    let result = [
      ...this.traces,
      ...(options.includeActive ? Array.from(this.activeTraces.values()) : []),
    ];

    if (options.sessionId) result = result.filter((t) => t.sessionId === options.sessionId);
    if (options.agentId) result = result.filter((t) => t.agentId === options.agentId);
    if (options.since !== undefined) {
      const since = options.since;
      result = result.filter((t) => t.startedAt >= since);
    }
    if (typeof options.success === "boolean") {
      result = result.filter((t) => t.endedAt !== undefined && t.success === options.success);
    }
    if (typeof options.minDurationMs === "number") {
      const minDurationMs = options.minDurationMs;
      result = result.filter((t) => this.resolveDurationMs(t) >= minDurationMs);
    }
    if (options.hasErrors) {
      result = result.filter(
        (t) => !t.success || t.spans.some((span) => span.status === "error"),
      );
    }
    if (options.toolName) {
      result = result.filter((t) =>
        t.spans.some((span) => span.kind === "tool" && span.name === options.toolName),
      );
    }

    result.sort((a, b) => b.startedAt - a.startedAt);
    const total = result.length;

    const offset = options.offset ?? 0;
    const limit = options.limit ?? 50;
    return {
      traces: result.slice(offset, offset + limit),
      total,
    };
  }

  getStats(periodMs = 3600000): TraceStats {
    const since = Date.now() - periodMs;
    const recent = this.traces.filter((t) => t.startedAt >= since);

    if (recent.length === 0) {
      return {
        totalTraces: 0,
        avgDurationMs: 0,
        p50DurationMs: 0,
        p95DurationMs: 0,
        p99DurationMs: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        toolSuccessRate: 1,
        errorRate: 0,
        tracesPerMinute: 0,
      };
    }

    const durations = recent
      .map((t) => t.durationMs ?? 0)
      .filter((d) => d >= 0)
      .sort((a, b) => a - b);

    const percentile = (arr: number[], p: number) => {
      if (arr.length === 0) return 0;
      const idx = Math.ceil(arr.length * p) - 1;
      return arr[Math.max(0, idx)];
    };

    const totalToolSpans = recent.reduce(
      (acc, t) => acc + t.spans.filter((s) => s.kind === "tool").length,
      0
    );
    const failedToolSpans = recent.reduce(
      (acc, t) => acc + t.spans.filter((s) => s.kind === "tool" && s.status === "error").length,
      0
    );

    const periodMinutes = periodMs / 60000;

    return {
      totalTraces: recent.length,
      avgDurationMs: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
      p50DurationMs: percentile(durations, 0.5),
      p95DurationMs: percentile(durations, 0.95),
      p99DurationMs: percentile(durations, 0.99),
      totalTokens: recent.reduce((a, t) => a + t.inputTokens + t.outputTokens, 0),
      totalCostUsd: recent.reduce((a, t) => a + t.costUsd, 0),
      toolSuccessRate: totalToolSpans > 0 ? 1 - failedToolSpans / totalToolSpans : 1,
      errorRate: recent.filter((t) => !t.success).length / recent.length,
      tracesPerMinute: recent.length / periodMinutes,
    };
  }

  get size(): number {
    return this.traces.length;
  }

  get activeCount(): number {
    return this.activeTraces.size;
  }

  private resolveDurationMs(trace: Trace): number {
    if (typeof trace.durationMs === "number") {
      return trace.durationMs;
    }

    return Math.max(0, Date.now() - trace.startedAt);
  }
}
