// ─── Per-LLM-Call Trace Capture ─────────────────────────────────────────────
//
// Issue #577 "Per-LLM-call trace capture".
//
// Captures the full context of each individual model call — the prompt
// (system + messages), generation params, exposed tools, and the response
// (text, tool calls, token usage) — keyed by user / session / trace so an
// operator can later inspect or *replay* the exact context that produced a
// given model output.
//
// Design notes:
//   - Capture flows through an injectable `LlmCaptureSink`, so the in-memory
//     default can be swapped for a DB / file / remote sink without touching
//     call sites. The default sink is an in-memory ring buffer.
//   - A `RedactionHook` is injected (NOT hardcoded) and applied to every
//     captured record before it reaches the sink, so secrets / PII never land
//     in storage. A conservative default hook redacts common secret-bearing
//     param/header keys and obvious token-shaped strings.
//   - Each capture is associated with a vendor-neutral span (see spans.ts) when
//     a tracer is provided: the recorder opens a "llm.call" span, stamps it with
//     non-sensitive attributes, and links it to the captured record via
//     traceId / spanId. This keeps #577 consistent with the #576 span model.
//   - `replay(captureId)` returns the exact captured request context (the same
//     shape you'd feed back to a model client) — the "replay hook".
//
// Pure and dependency-free beyond pino + the local span model.
//
// ──────────────────────────────────────────────────────────────────────────

import pino from "pino";
import { randomUUID } from "node:crypto";
import type { Attributes, SpanContext } from "./spans.js";
import { Tracer, Span } from "./spans.js";

const logger = pino({ name: "llm-trace" });

// ─── Captured shapes ──────────────────────────────────────────────────────

/** A single chat message in the captured prompt. */
export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  /**
   * Message content. Either plain text or an opaque structured block array
   * (e.g. Anthropic content blocks). Kept as `unknown` so capture is faithful
   * to whatever the caller passed without coupling to a specific SDK shape.
   */
  content: string | unknown[];
  /** Optional name (e.g. tool name for role:"tool"). */
  name?: string;
}

/** A tool/function definition exposed to the model for this call. */
export interface LlmToolDef {
  name: string;
  description?: string;
  /** JSON-schema-ish parameter definition; opaque to this module. */
  parameters?: Record<string, unknown>;
}

/** Generation parameters for the call. */
export interface LlmParams {
  model: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stopSequences?: string[];
  /** Any other provider-specific knobs, captured verbatim. */
  extra?: Record<string, unknown>;
}

/** Token / cost accounting for a completed call. */
export interface LlmUsage {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

/** A tool call requested by the model in its response. */
export interface LlmToolCall {
  id?: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** The model's response. */
export interface LlmResponse {
  /** Final assistant text, if any. */
  text?: string;
  /** Tool calls the model requested, if any. */
  toolCalls?: LlmToolCall[];
  /** Stop / finish reason as reported by the provider. */
  stopReason?: string;
  usage?: LlmUsage;
}

/** The request context — everything needed to (re)issue the call. */
export interface LlmRequestContext {
  params: LlmParams;
  system?: string;
  messages: LlmMessage[];
  tools?: LlmToolDef[];
}

/** A fully captured LLM call record (request + response + correlation keys). */
export interface LlmCallRecord {
  /** Unique id for this capture. */
  captureId: string;
  /** Correlation keys. */
  userId?: string;
  sessionId?: string;
  /** Vendor-neutral trace/span correlation (see spans.ts). */
  traceId?: string;
  spanId?: string;
  /** Unix epoch ms when the call started / ended. */
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  /** Ordinal of this call within its session (0-based). */
  callIndex: number;
  request: LlmRequestContext;
  response?: LlmResponse;
  error?: string;
  /** True once the redaction hook has been applied. */
  redacted: boolean;
}

// ─── Redaction ──────────────────────────────────────────────────────────────

/**
 * A redaction hook receives a *draft* record and returns a sanitized copy
 * (or mutates and returns it). It MUST NOT throw for normal input — a throwing
 * hook is caught and the record is dropped fail-closed (never stored raw).
 */
export type RedactionHook = (record: LlmCallRecord) => LlmCallRecord;

/** Identity hook — captures everything verbatim (use only in trusted/test envs). */
export const noRedaction: RedactionHook = (record) => record;

const SECRET_KEY_PATTERN =
  /(api[_-]?key|secret|token|password|passwd|authorization|auth|bearer|cookie|session[_-]?id|access[_-]?key|private[_-]?key|client[_-]?secret)/i;

/** Replacement marker for redacted values. */
export const REDACTED = "[REDACTED]";

// Token-shaped strings: long high-entropy-ish runs, or known prefixes.
const TOKEN_VALUE_PATTERN =
  /\b(sk-[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{12,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,})\b/g;

function redactString(value: string): string {
  return value.replace(TOKEN_VALUE_PATTERN, REDACTED);
}

function redactDeep(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_PATTERN.test(k) ? REDACTED : redactDeep(v);
    }
    return out;
  }
  return value;
}

/**
 * A conservative default redaction hook: removes secret-bearing keys anywhere
 * in the request/response and masks obvious token-shaped substrings in strings.
 * Returns a deep-cloned, redacted copy (the input is left untouched).
 */
export const defaultRedaction: RedactionHook = (record) => {
  const clone: LlmCallRecord = {
    ...record,
    request: redactDeep(record.request) as LlmRequestContext,
    response: record.response
      ? (redactDeep(record.response) as LlmResponse)
      : undefined,
    redacted: true,
  };
  return clone;
};

// ─── Sink ─────────────────────────────────────────────────────────────────

/** Pluggable storage for captured records. Mirrors AuditBackend's spirit. */
export interface LlmCaptureSink {
  /** Persist a (already-redacted) record. */
  write(record: LlmCallRecord): void;
  /** Fetch a single record by capture id. */
  get(captureId: string): LlmCallRecord | undefined;
  /** Query records by correlation keys. */
  query(params: LlmCaptureQuery): LlmCallRecord[];
}

export interface LlmCaptureQuery {
  userId?: string;
  sessionId?: string;
  traceId?: string;
  since?: number;
  limit?: number;
}

/** Default in-memory ring-buffer sink. */
export class InMemoryLlmCaptureSink implements LlmCaptureSink {
  private readonly records: LlmCallRecord[] = [];
  private readonly byId = new Map<string, LlmCallRecord>();
  private readonly maxRecords: number;

  constructor(maxRecords = 10_000) {
    this.maxRecords = maxRecords;
  }

  write(record: LlmCallRecord): void {
    this.records.push(record);
    this.byId.set(record.captureId, record);
    if (this.records.length > this.maxRecords) {
      const evicted = this.records.shift();
      if (evicted) this.byId.delete(evicted.captureId);
    }
  }

  get(captureId: string): LlmCallRecord | undefined {
    return this.byId.get(captureId);
  }

  query(params: LlmCaptureQuery): LlmCallRecord[] {
    let results = [...this.records];
    if (params.userId) results = results.filter((r) => r.userId === params.userId);
    if (params.sessionId) results = results.filter((r) => r.sessionId === params.sessionId);
    if (params.traceId) results = results.filter((r) => r.traceId === params.traceId);
    if (params.since !== undefined) {
      const since = params.since;
      results = results.filter((r) => r.startedAt >= since);
    }
    results.sort((a, b) => b.startedAt - a.startedAt);
    return results.slice(0, params.limit ?? 100);
  }

  get size(): number {
    return this.records.length;
  }

  reset(): void {
    this.records.length = 0;
    this.byId.clear();
  }
}

// ─── Recorder ────────────────────────────────────────────────────────────────

export interface LlmTraceRecorderOptions {
  sink?: LlmCaptureSink;
  /** Injected redaction hook. Defaults to `defaultRedaction`. */
  redact?: RedactionHook;
  /**
   * Optional tracer. When provided, each capture opens (and ends) a
   * vendor-neutral "llm.call" span correlated to the record.
   */
  tracer?: Tracer;
}

/** A handle returned by `beginCall`; complete it with a response or error. */
export interface LlmCallHandle {
  readonly captureId: string;
  readonly traceId?: string;
  readonly spanId?: string;
  /** Finish the call with a successful response, persisting the record. */
  complete(response: LlmResponse): LlmCallRecord;
  /** Finish the call with an error, persisting the record. */
  fail(error: unknown): LlmCallRecord;
}

/**
 * Captures per-LLM-call context and persists redacted records to a sink.
 *
 * Usage:
 *   const h = recorder.beginCall({ sessionId, request });
 *   try { const resp = await client.call(...); h.complete(resp); }
 *   catch (e) { h.fail(e); throw e; }
 *
 * Or, for a fully-formed call, `capture(...)` records request+response in one
 * shot.
 */
export class LlmTraceRecorder {
  private readonly sink: LlmCaptureSink;
  private readonly redact: RedactionHook;
  private readonly tracer?: Tracer;
  /** Per-session monotonic call counter for `callIndex`. */
  private readonly sessionCounters = new Map<string, number>();

  constructor(opts: LlmTraceRecorderOptions = {}) {
    this.sink = opts.sink ?? new InMemoryLlmCaptureSink();
    this.redact = opts.redact ?? defaultRedaction;
    this.tracer = opts.tracer;
  }

  /** Begin capturing a call. Returns a handle to complete or fail. */
  beginCall(input: {
    request: LlmRequestContext;
    userId?: string;
    sessionId?: string;
    /** Parent span to nest the llm.call span under. */
    parent?: SpanContext | Span;
    /** Override the start time (defaults to now). */
    startedAt?: number;
  }): LlmCallHandle {
    const captureId = randomUUID();
    const startedAt = input.startedAt ?? Date.now();
    const callIndex = this.nextCallIndex(input.sessionId);

    let span: Span | undefined;
    if (this.tracer) {
      span = this.tracer.startSpan("llm.call", {
        parent: input.parent,
        kind: "client",
        attributes: this.spanAttributes(input.request, input.userId, input.sessionId, callIndex),
      });
    }
    const traceId = span?.traceId;
    const spanId = span?.spanId;

    const base: Omit<LlmCallRecord, "response" | "error" | "endedAt" | "durationMs"> = {
      captureId,
      userId: input.userId,
      sessionId: input.sessionId,
      traceId,
      spanId,
      startedAt,
      callIndex,
      request: input.request,
      redacted: false,
    };

    const finish = (
      result: { response?: LlmResponse; error?: string },
    ): LlmCallRecord => {
      const endedAt = Date.now();
      const draft: LlmCallRecord = {
        ...base,
        endedAt,
        durationMs: endedAt - startedAt,
        response: result.response,
        error: result.error,
      };
      if (span) {
        if (result.response?.usage) {
          const u = result.response.usage;
          if (typeof u.inputTokens === "number") span.setAttribute("llm.usage.input_tokens", u.inputTokens);
          if (typeof u.outputTokens === "number") span.setAttribute("llm.usage.output_tokens", u.outputTokens);
          if (typeof u.costUsd === "number") span.setAttribute("llm.usage.cost_usd", u.costUsd);
        }
        if (result.error) span.setStatus("error", result.error);
        span.setAttribute("karna.capture_id", captureId);
        span.end();
      }
      // Returns the persisted (redacted) record so callers never see raw data;
      // falls back to the draft if the record was dropped (redaction threw).
      return this.persist(draft) ?? draft;
    };

    return {
      captureId,
      traceId,
      spanId,
      complete: (response) => finish({ response }),
      fail: (error) =>
        finish({ error: error instanceof Error ? error.message : String(error) }),
    };
  }

  /** Capture a fully-formed request+response in one call. */
  capture(input: {
    request: LlmRequestContext;
    response: LlmResponse;
    userId?: string;
    sessionId?: string;
    parent?: SpanContext | Span;
    startedAt?: number;
  }): LlmCallRecord {
    const handle = this.beginCall(input);
    return handle.complete(input.response);
  }

  /**
   * Replay hook: return the EXACT captured request context for a capture id,
   * suitable for re-issuing the call. Returns undefined for unknown ids.
   *
   * Note: the returned context reflects what was stored (i.e. post-redaction if
   * a redacting hook was used) — this is intentional so replay never leaks
   * secrets. Inject `noRedaction` if you need byte-exact replay in a trusted env.
   */
  replay(captureId: string): LlmRequestContext | undefined {
    const record = this.sink.get(captureId);
    if (!record) return undefined;
    // Deep clone so callers can mutate freely without corrupting the store.
    return structuredClone(record.request);
  }

  /** Fetch the full captured record (request + response). */
  getRecord(captureId: string): LlmCallRecord | undefined {
    return this.sink.get(captureId);
  }

  /** Query captured records by correlation keys. */
  query(params: LlmCaptureQuery): LlmCallRecord[] {
    return this.sink.query(params);
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private persist(draft: LlmCallRecord): LlmCallRecord | undefined {
    let redacted: LlmCallRecord;
    try {
      redacted = this.redact(draft);
    } catch (err) {
      // Fail closed: never store an un-redacted record if the hook throws.
      logger.error(
        { captureId: draft.captureId, err: err instanceof Error ? err.message : String(err) },
        "Redaction hook threw; dropping capture",
      );
      return undefined;
    }
    if (!redacted.redacted) {
      // Defensive: mark redacted even if a custom hook forgot to.
      redacted = { ...redacted, redacted: true };
    }
    this.sink.write(redacted);
    logger.debug(
      { captureId: redacted.captureId, sessionId: redacted.sessionId, traceId: redacted.traceId },
      "Captured LLM call",
    );
    return redacted;
  }

  private nextCallIndex(sessionId?: string): number {
    if (!sessionId) return 0;
    const next = this.sessionCounters.get(sessionId) ?? 0;
    this.sessionCounters.set(sessionId, next + 1);
    return next;
  }

  private spanAttributes(
    request: LlmRequestContext,
    userId: string | undefined,
    sessionId: string | undefined,
    callIndex: number,
  ): Attributes {
    const attrs: Attributes = {
      "llm.model": request.params.model,
      "llm.message_count": request.messages.length,
      "llm.tool_count": request.tools?.length ?? 0,
      "karna.call_index": callIndex,
    };
    if (typeof request.params.temperature === "number") attrs["llm.temperature"] = request.params.temperature;
    if (typeof request.params.maxTokens === "number") attrs["llm.max_tokens"] = request.params.maxTokens;
    if (userId) attrs["karna.user_id"] = userId;
    if (sessionId) attrs["karna.session_id"] = sessionId;
    return attrs;
  }
}
