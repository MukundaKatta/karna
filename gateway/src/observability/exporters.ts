// ─── Structured Trace Export to External Backends ───────────────────────────
//
// Issue #581 "Structured trace export to external backends".
//
// Serializes the vendor-neutral `SpanData` model (spans.ts) into the wire
// shapes expected by common tracing/observability backends and ships them over
// an INJECTED HTTP `post` function. No vendor SDKs, no real network in this
// module — only pure serialization plus a thin transport seam that a real
// fetch-based poster can implement later.
//
// Provided serializers:
//   - OTLP/JSON     — OpenTelemetry OTLP-over-HTTP JSON (ResourceSpans shape).
//   - Langfuse      — Langfuse public ingestion "batch" events (trace + spans).
//   - Phoenix (OTLP)— Arize Phoenix ingests OTLP/JSON; reuses the OTLP encoder.
//
// All three implement a single `ExternalSpanExporter` interface so the gateway
// can fan spans out to any enabled backend via config. Note this is distinct
// from spans.ts's local `SpanExporter` (an in-process sink); the names are kept
// separate on purpose — a `SpanExporterAdapter` bridges this module's async,
// network-bound exporters into that synchronous in-process sink interface.
//
// ──────────────────────────────────────────────────────────────────────────

import pino from "pino";
import type { SpanData, SpanExporter as LocalSpanExporter } from "./spans.js";

const logger = pino({ name: "trace-exporters" });

// ─── Transport seam ──────────────────────────────────────────────────────────

export interface HttpPostRequest {
  url: string;
  /** Already-serialized JSON body. */
  body: string;
  headers: Record<string, string>;
}

export interface HttpPostResponse {
  status: number;
  body?: string;
}

/**
 * Injected HTTP transport. A real implementation wraps `fetch`; tests pass a
 * mock. MUST resolve (not throw) for HTTP errors — surface them via `status`.
 */
export type HttpPostFn = (req: HttpPostRequest) => Promise<HttpPostResponse>;

// ─── External exporter interface ─────────────────────────────────────────────

export interface SpanExportResult {
  /** True if all spans were accepted (2xx). */
  ok: boolean;
  /** Number of spans submitted. */
  count: number;
  /** HTTP status from the backend, when a request was made. */
  status?: number;
  error?: string;
}

/**
 * An exporter that ships spans to an external backend. Concrete adapters
 * (OTLP, Langfuse, Phoenix) implement this; all are config-driven and use the
 * injected `HttpPostFn` for transport.
 */
export interface ExternalSpanExporter {
  /** Stable backend identifier (e.g. "otlp", "langfuse", "phoenix"). */
  readonly backend: string;
  /** Whether this exporter is enabled (config-driven). */
  readonly enabled: boolean;
  /** Serialize `spans` to this backend's wire shape (pure, no I/O). */
  serialize(spans: SpanData[]): unknown;
  /** Serialize then ship via the injected transport. */
  export(spans: SpanData[]): Promise<SpanExportResult>;
}

// ─── Shared config ───────────────────────────────────────────────────────────

export interface ExporterConfig {
  enabled?: boolean;
  /** Ingestion endpoint. */
  url: string;
  /** Extra headers (auth, etc.); merged over computed defaults. */
  headers?: Record<string, string>;
  /** Service / resource name attached to exported spans. */
  serviceName?: string;
}

// ─── OTLP/JSON encoding ──────────────────────────────────────────────────────
//
// OTLP/JSON requires nanosecond string timestamps and a typed `attributes`
// array of { key, value: { stringValue | intValue | boolValue | doubleValue } }.
// SpanStatusCode maps: unset->0, ok->1, error->2. SpanKind name -> OTLP int.

const OTLP_STATUS_CODE: Record<string, number> = { unset: 0, ok: 1, error: 2 };
const OTLP_SPAN_KIND: Record<string, number> = {
  internal: 1,
  server: 2,
  client: 3,
  producer: 4,
  consumer: 5,
};

function msToNanoStr(ms: number): string {
  // Avoid float precision loss: multiply via BigInt.
  return (BigInt(Math.round(ms)) * 1_000_000n).toString();
}

function otlpAttrValue(value: string | number | boolean): Record<string, unknown> {
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "string") return { stringValue: value };
  return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
}

function otlpAttributes(attrs: Record<string, string | number | boolean>): unknown[] {
  return Object.entries(attrs).map(([key, value]) => ({ key, value: otlpAttrValue(value) }));
}

function toOtlpSpan(span: SpanData): Record<string, unknown> {
  const out: Record<string, unknown> = {
    traceId: span.traceId,
    spanId: span.spanId,
    name: span.name,
    kind: OTLP_SPAN_KIND[span.kind] ?? OTLP_SPAN_KIND.internal,
    startTimeUnixNano: msToNanoStr(span.startTimeUnixMs),
    endTimeUnixNano: msToNanoStr(span.endTimeUnixMs ?? span.startTimeUnixMs),
    attributes: otlpAttributes(span.attributes),
    events: span.events.map((e) => ({
      name: e.name,
      timeUnixNano: msToNanoStr(e.timeUnixMs),
      attributes: otlpAttributes(e.attributes),
    })),
    status: {
      code: OTLP_STATUS_CODE[span.status.code] ?? 0,
      ...(span.status.message ? { message: span.status.message } : {}),
    },
  };
  if (span.parentSpanId) out.parentSpanId = span.parentSpanId;
  return out;
}

/** Encode spans as an OTLP/JSON `ExportTraceServiceRequest` (ResourceSpans). */
export function encodeOtlpJson(spans: SpanData[], serviceName = "karna-gateway"): Record<string, unknown> {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: otlpAttributes({ "service.name": serviceName }),
        },
        scopeSpans: [
          {
            scope: { name: "karna.observability", version: "1" },
            spans: spans.map(toOtlpSpan),
          },
        ],
      },
    ],
  };
}

// ─── Langfuse encoding ───────────────────────────────────────────────────────
//
// Langfuse's public ingestion API accepts a `{ batch: Event[] }` payload where
// each Event is `{ id, type, timestamp, body }`. We map each trace (group of
// spans sharing traceId) to a "trace-create" event and each span to an
// "observation" ("span"-type) event referencing that trace.

function isoFromMs(ms: number): string {
  return new Date(ms).toISOString();
}

function langfuseObservation(span: SpanData): Record<string, unknown> {
  return {
    id: span.spanId,
    type: "observation-create",
    timestamp: isoFromMs(span.startTimeUnixMs),
    body: {
      id: span.spanId,
      traceId: span.traceId,
      type: "SPAN",
      name: span.name,
      parentObservationId: span.parentSpanId,
      startTime: isoFromMs(span.startTimeUnixMs),
      endTime: span.endTimeUnixMs !== undefined ? isoFromMs(span.endTimeUnixMs) : undefined,
      metadata: { ...span.attributes, kind: span.kind },
      level: span.status.code === "error" ? "ERROR" : "DEFAULT",
      statusMessage: span.status.message,
    },
  };
}

function langfuseTraceEvent(traceId: string, rootName: string, startMs: number): Record<string, unknown> {
  return {
    id: `trace-${traceId}`,
    type: "trace-create",
    timestamp: isoFromMs(startMs),
    body: { id: traceId, name: rootName, timestamp: isoFromMs(startMs) },
  };
}

/** Encode spans as a Langfuse ingestion `{ batch: [...] }` payload. */
export function encodeLangfuse(spans: SpanData[]): Record<string, unknown> {
  const batch: Record<string, unknown>[] = [];
  // One trace-create per distinct traceId, seeded from its earliest span.
  const seen = new Map<string, SpanData>();
  for (const span of spans) {
    const existing = seen.get(span.traceId);
    if (!existing || span.startTimeUnixMs < existing.startTimeUnixMs) {
      seen.set(span.traceId, span);
    }
  }
  for (const [traceId, root] of seen) {
    batch.push(langfuseTraceEvent(traceId, root.name, root.startTimeUnixMs));
  }
  for (const span of spans) {
    batch.push(langfuseObservation(span));
  }
  return { batch };
}

// ─── Concrete adapters ───────────────────────────────────────────────────────

abstract class BaseExporter implements ExternalSpanExporter {
  abstract readonly backend: string;
  readonly enabled: boolean;
  protected readonly url: string;
  protected readonly serviceName: string;
  protected readonly extraHeaders: Record<string, string>;
  protected readonly post: HttpPostFn;

  constructor(config: ExporterConfig, post: HttpPostFn) {
    this.enabled = config.enabled ?? true;
    this.url = config.url;
    this.serviceName = config.serviceName ?? "karna-gateway";
    this.extraHeaders = config.headers ?? {};
    this.post = post;
  }

  abstract serialize(spans: SpanData[]): unknown;
  protected abstract headers(): Record<string, string>;

  async export(spans: SpanData[]): Promise<SpanExportResult> {
    if (!this.enabled) {
      return { ok: true, count: 0 };
    }
    if (spans.length === 0) {
      return { ok: true, count: 0 };
    }
    const body = JSON.stringify(this.serialize(spans));
    try {
      const res = await this.post({
        url: this.url,
        body,
        headers: { "content-type": "application/json", ...this.headers(), ...this.extraHeaders },
      });
      const ok = res.status >= 200 && res.status < 300;
      if (!ok) {
        logger.warn(
          { backend: this.backend, status: res.status, count: spans.length },
          "Trace export rejected by backend",
        );
      }
      return {
        ok,
        count: spans.length,
        status: res.status,
        error: ok ? undefined : `HTTP ${res.status}`,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error({ backend: this.backend, error }, "Trace export transport failed");
      return { ok: false, count: spans.length, error };
    }
  }
}

/** OTLP/JSON-over-HTTP exporter (the OpenTelemetry standard). */
export class OtlpJsonExporter extends BaseExporter {
  readonly backend = "otlp";
  serialize(spans: SpanData[]): unknown {
    return encodeOtlpJson(spans, this.serviceName);
  }
  protected headers(): Record<string, string> {
    return {};
  }
}

/**
 * Arize Phoenix exporter. Phoenix ingests OTLP/JSON, so the encoding is shared
 * with `OtlpJsonExporter`; only the backend id differs (so config and routing
 * can target Phoenix distinctly).
 */
export class PhoenixExporter extends BaseExporter {
  readonly backend = "phoenix";
  serialize(spans: SpanData[]): unknown {
    return encodeOtlpJson(spans, this.serviceName);
  }
  protected headers(): Record<string, string> {
    return {};
  }
}

export interface LangfuseExporterConfig extends ExporterConfig {
  /** Langfuse public key (sent as basic-auth username). */
  publicKey?: string;
  /** Langfuse secret key (sent as basic-auth password). */
  secretKey?: string;
}

/** Langfuse ingestion exporter (`{ batch: [...] }` shape, basic-auth header). */
export class LangfuseExporter extends BaseExporter {
  readonly backend = "langfuse";
  private readonly authHeader?: string;

  constructor(config: LangfuseExporterConfig, post: HttpPostFn) {
    super(config, post);
    if (config.publicKey && config.secretKey) {
      const token = Buffer.from(`${config.publicKey}:${config.secretKey}`).toString("base64");
      this.authHeader = `Basic ${token}`;
    }
  }

  serialize(spans: SpanData[]): unknown {
    return encodeLangfuse(spans);
  }

  protected headers(): Record<string, string> {
    return this.authHeader ? { authorization: this.authHeader } : {};
  }
}

// ─── Config-driven construction & multiplexing ───────────────────────────────

export interface ExportersConfig {
  otlp?: ExporterConfig;
  phoenix?: ExporterConfig;
  langfuse?: LangfuseExporterConfig;
}

/**
 * Build the set of enabled exporters from config. An entry is included only if
 * present and not explicitly disabled (`enabled !== false`).
 */
export function createExporters(config: ExportersConfig, post: HttpPostFn): ExternalSpanExporter[] {
  const exporters: ExternalSpanExporter[] = [];
  if (config.otlp && config.otlp.enabled !== false) {
    exporters.push(new OtlpJsonExporter(config.otlp, post));
  }
  if (config.phoenix && config.phoenix.enabled !== false) {
    exporters.push(new PhoenixExporter(config.phoenix, post));
  }
  if (config.langfuse && config.langfuse.enabled !== false) {
    exporters.push(new LangfuseExporter(config.langfuse, post));
  }
  return exporters;
}

/** Fan a batch of spans out to multiple external exporters concurrently. */
export class MultiSpanExporter {
  private readonly exporters: ExternalSpanExporter[];

  constructor(exporters: ExternalSpanExporter[]) {
    this.exporters = exporters;
  }

  get backends(): string[] {
    return this.exporters.map((e) => e.backend);
  }

  async export(spans: SpanData[]): Promise<SpanExportResult[]> {
    return Promise.all(this.exporters.map((e) => e.export(spans)));
  }
}

// ─── Bridge to the in-process SpanExporter sink ───────────────────────────────

/**
 * Adapts an async `ExternalSpanExporter` into spans.ts's synchronous, in-process
 * `SpanExporter` sink so a `Tracer` can stream spans straight to an external
 * backend. The async export is fired-and-logged (errors are swallowed into the
 * logger so the hot path never rejects); call `flush()` to await in-flight
 * exports (e.g. on shutdown).
 */
export class SpanExporterAdapter implements LocalSpanExporter {
  private readonly inner: ExternalSpanExporter;
  private pending = new Set<Promise<unknown>>();

  constructor(inner: ExternalSpanExporter) {
    this.inner = inner;
  }

  export(spans: SpanData[]): void {
    const p = this.inner
      .export(spans)
      .catch((err) =>
        logger.error(
          { backend: this.inner.backend, err: err instanceof Error ? err.message : String(err) },
          "Background span export failed",
        ),
      )
      .finally(() => {
        this.pending.delete(p);
      });
    this.pending.add(p);
  }

  /** Await all in-flight background exports. */
  async flush(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }

  shutdown(): void {
    void this.flush();
  }
}
