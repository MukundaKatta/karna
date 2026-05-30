// ─── Vendor-Neutral Span Model ────────────────────────────────────────────
//
// Issue #576 "Tracing across the agent loop".
//
// A lightweight, dependency-free span/tracer model that mirrors the core
// OpenTelemetry concepts (traceId / spanId / parentSpanId, attributes,
// events, status) WITHOUT pulling in any @opentelemetry/* package.
//
// The shapes here are intentionally close to the OTLP/JSON wire format so a
// real OTLP exporter can be bolted on later by translating `SpanData` into
// the protobuf-equivalent JSON — no rewrite of instrumentation required.
//
// This is additive and independent of the existing `TraceCollector`; both can
// run side-by-side. `TraceCollector` is the rich, query-oriented in-memory
// store for the dashboard; this module is the portable, export-oriented
// tracing primitive intended to feed external collectors.
//
// ──────────────────────────────────────────────────────────────────────────

import pino from "pino";
import { randomBytes } from "node:crypto";

const logger = pino({ name: "spans" });

// ─── Types ────────────────────────────────────────────────────────────────

export type AttributeValue = string | number | boolean;
export type Attributes = Record<string, AttributeValue>;

/** OTel span status codes (UNSET=0, OK=1, ERROR=2). */
export type SpanStatusCode = "unset" | "ok" | "error";

export interface SpanStatusData {
  code: SpanStatusCode;
  message?: string;
}

export interface SpanEventData {
  name: string;
  /** Unix epoch milliseconds. */
  timeUnixMs: number;
  attributes: Attributes;
}

/**
 * Immutable, exported representation of a finished (or in-flight) span.
 * Mirrors the OTLP span object closely enough for a thin translation layer.
 */
export interface SpanData {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  /** OTel SpanKind, lowercased. Defaults to "internal". */
  kind: string;
  startTimeUnixMs: number;
  endTimeUnixMs?: number;
  durationMs?: number;
  attributes: Attributes;
  events: SpanEventData[];
  status: SpanStatusData;
}

export interface SpanContext {
  traceId: string;
  spanId: string;
}

/** Pluggable sink for finished spans. */
export interface SpanExporter {
  export(spans: SpanData[]): void;
  shutdown?(): void;
}

// ─── ID generation ──────────────────────────────────────────────────────────

/** 16-byte (32 hex char) trace id, per W3C trace-context / OTel. */
export function generateTraceId(): string {
  return randomBytes(16).toString("hex");
}

/** 8-byte (16 hex char) span id, per W3C trace-context / OTel. */
export function generateSpanId(): string {
  return randomBytes(8).toString("hex");
}

function now(): number {
  return Date.now();
}

// ─── Span ─────────────────────────────────────────────────────────────────

/**
 * A single span. Created via `Tracer.startSpan` (or `Span.startChild`).
 * Mutable while in-flight; produces an immutable `SpanData` snapshot on
 * `toData()` / when ended.
 */
export class Span {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind: string;
  readonly startTimeUnixMs: number;

  private endTimeUnixMs?: number;
  private readonly attributes: Attributes = {};
  private readonly events: SpanEventData[] = [];
  private status: SpanStatusData = { code: "unset" };
  private ended = false;

  /** Called by the owning tracer when this span ends. */
  private readonly onEnd?: (span: Span) => void;

  constructor(opts: {
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    name: string;
    kind?: string;
    startTimeUnixMs?: number;
    attributes?: Attributes;
    onEnd?: (span: Span) => void;
  }) {
    this.traceId = opts.traceId;
    this.spanId = opts.spanId;
    this.parentSpanId = opts.parentSpanId;
    this.name = opts.name;
    this.kind = opts.kind ?? "internal";
    this.startTimeUnixMs = opts.startTimeUnixMs ?? now();
    this.onEnd = opts.onEnd;
    if (opts.attributes) Object.assign(this.attributes, opts.attributes);
  }

  get context(): SpanContext {
    return { traceId: this.traceId, spanId: this.spanId };
  }

  get isRecording(): boolean {
    return !this.ended;
  }

  setAttribute(key: string, value: AttributeValue): this {
    if (this.ended) return this;
    this.attributes[key] = value;
    return this;
  }

  setAttributes(attrs: Attributes): this {
    if (this.ended) return this;
    Object.assign(this.attributes, attrs);
    return this;
  }

  addEvent(name: string, attributes: Attributes = {}, timeUnixMs?: number): this {
    if (this.ended) return this;
    this.events.push({ name, timeUnixMs: timeUnixMs ?? now(), attributes });
    return this;
  }

  setStatus(code: SpanStatusCode, message?: string): this {
    if (this.ended) return this;
    this.status = { code, message };
    return this;
  }

  /**
   * Convenience: record an error onto the span (sets status ERROR and adds an
   * "exception" event mirroring OTel semantic conventions).
   */
  recordException(error: unknown): this {
    if (this.ended) return this;
    const message = error instanceof Error ? error.message : String(error);
    const type = error instanceof Error ? error.name : "Error";
    this.addEvent("exception", {
      "exception.type": type,
      "exception.message": message,
    });
    this.setStatus("error", message);
    return this;
  }

  /**
   * Start a child span sharing this span's trace, parented to this span.
   * The child is registered with the same tracer (via the inherited onEnd).
   */
  startChild(name: string, opts: { kind?: string; attributes?: Attributes } = {}): Span {
    return new Span({
      traceId: this.traceId,
      spanId: generateSpanId(),
      parentSpanId: this.spanId,
      name,
      kind: opts.kind,
      attributes: opts.attributes,
      onEnd: this.onEnd,
    });
  }

  /** End the span. Idempotent. */
  end(endTimeUnixMs?: number): void {
    if (this.ended) return;
    this.ended = true;
    this.endTimeUnixMs = endTimeUnixMs ?? now();
    // If no explicit status was set, mark as OK on a clean end.
    if (this.status.code === "unset") {
      this.status = { code: "ok" };
    }
    this.onEnd?.(this);
  }

  /** Immutable snapshot of the current state. */
  toData(): SpanData {
    const duration =
      this.endTimeUnixMs !== undefined
        ? this.endTimeUnixMs - this.startTimeUnixMs
        : undefined;
    return {
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      name: this.name,
      kind: this.kind,
      startTimeUnixMs: this.startTimeUnixMs,
      endTimeUnixMs: this.endTimeUnixMs,
      durationMs: duration,
      attributes: { ...this.attributes },
      events: this.events.map((e) => ({ ...e, attributes: { ...e.attributes } })),
      status: { ...this.status },
    };
  }
}

// ─── In-Memory Exporter ─────────────────────────────────────────────────────

/**
 * Collects finished spans in memory. Useful for tests, debugging, and as the
 * default sink until a real OTLP exporter is wired up.
 */
export class InMemorySpanExporter implements SpanExporter {
  private readonly spans: SpanData[] = [];
  private readonly maxSpans: number;

  constructor(maxSpans = 50_000) {
    this.maxSpans = maxSpans;
  }

  export(spans: SpanData[]): void {
    for (const span of spans) {
      this.spans.push(span);
      if (this.spans.length > this.maxSpans) this.spans.shift();
    }
  }

  /** All collected spans (snapshot copy). */
  getSpans(): SpanData[] {
    return [...this.spans];
  }

  /** All spans belonging to a single trace. */
  getTrace(traceId: string): SpanData[] {
    return this.spans.filter((s) => s.traceId === traceId);
  }

  reset(): void {
    this.spans.length = 0;
  }

  get size(): number {
    return this.spans.length;
  }

  shutdown(): void {
    this.reset();
  }
}

// ─── Tracer ──────────────────────────────────────────────────────────────────

/**
 * Creates spans and forwards finished spans to its exporter.
 * Mirrors OTel `Tracer.startSpan` semantics: pass a parent context to nest
 * spans, omit it to start a new trace (root span).
 */
export class Tracer {
  private readonly exporter: SpanExporter;
  /** Buffer of finished spans not yet flushed. */
  private readonly finished: SpanData[] = [];
  private readonly autoFlush: boolean;

  constructor(exporter?: SpanExporter, opts: { autoFlush?: boolean } = {}) {
    this.exporter = exporter ?? new InMemorySpanExporter();
    // When autoFlush is true (default) each ended span is exported immediately.
    this.autoFlush = opts.autoFlush ?? true;
  }

  /**
   * Start a span. If `opts.parent` is provided, the new span joins that trace
   * as a child; otherwise a fresh trace id is generated (root span).
   */
  startSpan(
    name: string,
    opts: {
      parent?: SpanContext | Span;
      kind?: string;
      attributes?: Attributes;
      traceId?: string;
    } = {},
  ): Span {
    const parentCtx = this.resolveParent(opts.parent);
    const traceId = opts.traceId ?? parentCtx?.traceId ?? generateTraceId();
    return new Span({
      traceId,
      spanId: generateSpanId(),
      parentSpanId: parentCtx?.spanId,
      name,
      kind: opts.kind,
      attributes: opts.attributes,
      onEnd: (span) => this.handleEnd(span),
    });
  }

  /**
   * Run `fn` inside a span, ending it automatically (and recording exceptions).
   * Returns whatever `fn` returns. Works for sync and async functions.
   */
  withSpan<T>(
    name: string,
    fn: (span: Span) => T,
    opts: { parent?: SpanContext | Span; kind?: string; attributes?: Attributes } = {},
  ): T {
    const span = this.startSpan(name, opts);
    try {
      const result = fn(span);
      if (result instanceof Promise) {
        return result
          .then((v) => {
            span.end();
            return v;
          })
          .catch((err) => {
            span.recordException(err);
            span.end();
            throw err;
          }) as unknown as T;
      }
      span.end();
      return result;
    } catch (err) {
      span.recordException(err);
      span.end();
      throw err;
    }
  }

  /** Flush buffered finished spans to the exporter. No-op when autoFlush. */
  flush(): void {
    if (this.finished.length === 0) return;
    this.exporter.export(this.finished.splice(0, this.finished.length));
  }

  shutdown(): void {
    this.flush();
    this.exporter.shutdown?.();
  }

  private handleEnd(span: Span): void {
    const data = span.toData();
    if (this.autoFlush) {
      this.exporter.export([data]);
    } else {
      this.finished.push(data);
    }
    logger.debug(
      { traceId: data.traceId, spanId: data.spanId, durationMs: data.durationMs },
      "Span ended",
    );
  }

  private resolveParent(parent?: SpanContext | Span): SpanContext | undefined {
    if (!parent) return undefined;
    if (parent instanceof Span) return parent.context;
    return parent;
  }
}

// ─── Span-tree helpers (export to JSON) ─────────────────────────────────────

export interface SpanTreeNode extends SpanData {
  children: SpanTreeNode[];
}

/**
 * Build a parent/child tree from a flat list of spans (e.g. one trace).
 * Spans whose parent is not present in the list are treated as roots.
 */
export function buildSpanTree(spans: SpanData[]): SpanTreeNode[] {
  const nodes = new Map<string, SpanTreeNode>();
  for (const s of spans) {
    nodes.set(s.spanId, { ...s, children: [] });
  }
  const roots: SpanTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentSpanId ? nodes.get(node.parentSpanId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  // Stable ordering by start time at each level.
  const sortRec = (list: SpanTreeNode[]) => {
    list.sort((a, b) => a.startTimeUnixMs - b.startTimeUnixMs);
    for (const n of list) sortRec(n.children);
  };
  sortRec(roots);
  return roots;
}

/** Serialize a list of spans as a span-tree JSON string. */
export function exportSpanTreeJson(spans: SpanData[], pretty = false): string {
  const tree = buildSpanTree(spans);
  return JSON.stringify(tree, null, pretty ? 2 : undefined);
}
