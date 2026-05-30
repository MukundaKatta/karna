// ─── Vendor-Neutral Error Reporting ───────────────────────────────────────
//
// Issue #584 "Error tracking integration".
//
// A minimal, dependency-free error-reporting interface that mirrors the shape
// of services like Sentry (captureException / captureMessage with structured
// context) WITHOUT pulling in any @sentry/* package. A real adapter can later
// `implements ErrorReporter` and translate `ErrorEvent` into the vendor SDK.
//
// Ships with:
//   - `NoopErrorReporter`     — default, does nothing (zero overhead),
//   - `InMemoryErrorReporter` — buffers scrubbed events (tests / dashboards),
//   - `ConsoleErrorReporter`  — logs scrubbed events via pino,
//   - PII scrubbing applied to every payload before it leaves the process,
//   - `createErrorReporter(config)` — config-gated factory (off by default).
//
// ──────────────────────────────────────────────────────────────────────────

import pino from "pino";

const logger = pino({ name: "error-reporter" });

// ─── Types ────────────────────────────────────────────────────────────────

export type Severity = "fatal" | "error" | "warning" | "info" | "debug";

/** Structured context attached to a captured event. */
export interface ErrorContext {
  /** Originating session id, if any (scrubbed-through, not treated as PII). */
  sessionId?: string;
  /** Trace id correlating with the tracing subsystem. */
  traceId?: string;
  spanId?: string;
  /** Deploy/release identifier (e.g. git sha or semver). */
  release?: string;
  /** Logical environment (production / staging / dev). */
  environment?: string;
  /** Coarse component/module that raised the event. */
  component?: string;
  /** Free-form, structured extra data. Scrubbed before reporting. */
  extra?: Record<string, unknown>;
  /** Indexed key/value tags. Values are scrubbed. */
  tags?: Record<string, string>;
}

export interface ExceptionInfo {
  type: string;
  message: string;
  stack?: string;
}

/** Normalized, scrubbed event handed to reporters. */
export interface ErrorEvent {
  eventId: string;
  timestamp: number;
  severity: Severity;
  message: string;
  exception?: ExceptionInfo;
  context: ErrorContext;
}

/** The pluggable reporting surface a backend adapter implements. */
export interface ErrorReporter {
  captureException(error: unknown, context?: ErrorContext): string;
  captureMessage(message: string, severity?: Severity, context?: ErrorContext): string;
  /** Optional flush for buffered/async backends. */
  flush?(): void | Promise<void>;
}

// ─── PII Scrubbing ──────────────────────────────────────────────────────────

/** Keys whose values are always redacted (case-insensitive substring match). */
export const DEFAULT_SCRUB_KEYS = [
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "api_key",
  "authorization",
  "auth",
  "cookie",
  "session_token",
  "credential",
  "private_key",
  "access_token",
  "refresh_token",
  "ssn",
  "card",
  "cvv",
];

export const REDACTED = "[REDACTED]";

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Card-like: 13-19 digits, optionally separated by single space/hyphen between
// digits (separators are never trailing — they only sit between digits).
const CARD_RE = /\b\d(?:[ -]?\d){12,18}\b/g;
// Bearer / api-key-ish tokens embedded in free text.
const BEARER_RE = /\b[Bb]earer\s+[A-Za-z0-9._\-]+/g;

export interface ScrubOptions {
  /** Additional substring key matches to redact. */
  extraKeys?: string[];
  /** Maximum recursion depth (guards against cycles / deep payloads). */
  maxDepth?: number;
}

/** Redact PII patterns from a free-text string. */
export function scrubString(value: string): string {
  return value
    .replace(BEARER_RE, "Bearer " + REDACTED)
    .replace(EMAIL_RE, REDACTED)
    .replace(CARD_RE, REDACTED);
}

function keyIsSensitive(key: string, scrubKeys: string[]): boolean {
  const lower = key.toLowerCase();
  return scrubKeys.some((k) => lower.includes(k));
}

/**
 * Deep-scrub an arbitrary value: redact sensitive-keyed fields wholesale and
 * apply pattern scrubbing to all remaining strings. Returns a new structure;
 * the input is never mutated. Handles cycles via a seen-set.
 */
export function scrubValue(value: unknown, options: ScrubOptions = {}): unknown {
  const scrubKeys = [...DEFAULT_SCRUB_KEYS, ...(options.extraKeys ?? []).map((k) => k.toLowerCase())];
  const maxDepth = options.maxDepth ?? 8;
  const seen = new WeakSet<object>();

  const walk = (v: unknown, depth: number): unknown => {
    if (v === null || v === undefined) return v;
    if (typeof v === "string") return scrubString(v);
    if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return v;
    if (depth >= maxDepth) return "[TRUNCATED]";

    if (Array.isArray(v)) {
      if (seen.has(v)) return "[CIRCULAR]";
      seen.add(v);
      return v.map((item) => walk(item, depth + 1));
    }
    if (typeof v === "object") {
      if (seen.has(v as object)) return "[CIRCULAR]";
      seen.add(v as object);
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        out[k] = keyIsSensitive(k, scrubKeys) ? REDACTED : walk(val, depth + 1);
      }
      return out;
    }
    // Functions, symbols, etc. — drop to a stable placeholder.
    return "[UNSERIALIZABLE]";
  };

  return walk(value, 0);
}

/** Scrub a full error context (extra + tags + free-text-bearing fields). */
export function scrubContext(context: ErrorContext, options: ScrubOptions = {}): ErrorContext {
  const scrubbed: ErrorContext = { ...context };
  if (context.extra) {
    scrubbed.extra = scrubValue(context.extra, options) as Record<string, unknown>;
  }
  if (context.tags) {
    const tags: Record<string, string> = {};
    for (const [k, val] of Object.entries(context.tags)) {
      tags[k] = keyIsSensitive(k, [...DEFAULT_SCRUB_KEYS, ...(options.extraKeys ?? [])])
        ? REDACTED
        : scrubString(val);
    }
    scrubbed.tags = tags;
  }
  return scrubbed;
}

// ─── Event construction ──────────────────────────────────────────────────────

function eventId(): string {
  // 32 hex chars (Sentry-style), dependency-free.
  let id = "";
  for (let i = 0; i < 32; i++) id += Math.floor(Math.random() * 16).toString(16);
  return id;
}

function toException(error: unknown): ExceptionInfo {
  if (error instanceof Error) {
    return {
      type: error.name || "Error",
      message: scrubString(error.message),
      stack: error.stack ? scrubString(error.stack) : undefined,
    };
  }
  return { type: "Error", message: scrubString(String(error)) };
}

/** Build a normalized, scrubbed `ErrorEvent` (exported for reuse/testing). */
export function buildErrorEvent(
  params: { message: string; severity: Severity; error?: unknown; context?: ErrorContext },
  options: ScrubOptions = {},
): ErrorEvent {
  const context = scrubContext(params.context ?? {}, options);
  return {
    eventId: eventId(),
    timestamp: Date.now(),
    severity: params.severity,
    message: scrubString(params.message),
    exception: params.error !== undefined ? toException(params.error) : undefined,
    context,
  };
}

// ─── Reporters ───────────────────────────────────────────────────────────────

/** Default reporter: discards everything. Always safe, zero overhead. */
export class NoopErrorReporter implements ErrorReporter {
  captureException(_error: unknown, _context?: ErrorContext): string {
    return "";
  }
  captureMessage(_message: string, _severity?: Severity, _context?: ErrorContext): string {
    return "";
  }
}

/** Buffers scrubbed events in memory. Useful for tests and a debug dashboard. */
export class InMemoryErrorReporter implements ErrorReporter {
  private readonly events: ErrorEvent[] = [];
  private readonly maxEvents: number;
  private readonly scrubOptions: ScrubOptions;

  constructor(opts: { maxEvents?: number; scrubOptions?: ScrubOptions } = {}) {
    this.maxEvents = opts.maxEvents ?? 1_000;
    this.scrubOptions = opts.scrubOptions ?? {};
  }

  captureException(error: unknown, context?: ErrorContext): string {
    const message = error instanceof Error ? error.message : String(error);
    return this.push(buildErrorEvent({ message, severity: "error", error, context }, this.scrubOptions));
  }

  captureMessage(message: string, severity: Severity = "info", context?: ErrorContext): string {
    return this.push(buildErrorEvent({ message, severity, context }, this.scrubOptions));
  }

  private push(event: ErrorEvent): string {
    this.events.push(event);
    if (this.events.length > this.maxEvents) this.events.shift();
    return event.eventId;
  }

  getEvents(): ErrorEvent[] {
    return [...this.events];
  }

  reset(): void {
    this.events.length = 0;
  }

  get size(): number {
    return this.events.length;
  }
}

/** Logs scrubbed events through pino. */
export class ConsoleErrorReporter implements ErrorReporter {
  private readonly scrubOptions: ScrubOptions;

  constructor(opts: { scrubOptions?: ScrubOptions } = {}) {
    this.scrubOptions = opts.scrubOptions ?? {};
  }

  captureException(error: unknown, context?: ErrorContext): string {
    const message = error instanceof Error ? error.message : String(error);
    const event = buildErrorEvent({ message, severity: "error", error, context }, this.scrubOptions);
    logger.error({ event }, "captured exception");
    return event.eventId;
  }

  captureMessage(message: string, severity: Severity = "info", context?: ErrorContext): string {
    const event = buildErrorEvent({ message, severity, context }, this.scrubOptions);
    logger.info({ event }, "captured message");
    return event.eventId;
  }
}

// ─── Config-gated factory ────────────────────────────────────────────────────

export type ErrorReporterBackend = "noop" | "console" | "memory";

export interface ErrorReporterConfig {
  /** Master switch — when false (default) a `NoopErrorReporter` is returned. */
  enabled?: boolean;
  backend?: ErrorReporterBackend;
  /** Default context merged into every event (e.g. release/environment). */
  scrubOptions?: ScrubOptions;
  maxEvents?: number;
}

/**
 * Build a reporter from config. Disabled by default so wiring this in is a
 * non-breaking, opt-in change. Unknown backends fall back to no-op.
 */
export function createErrorReporter(config: ErrorReporterConfig = {}): ErrorReporter {
  if (!config.enabled) return new NoopErrorReporter();
  switch (config.backend ?? "console") {
    case "memory":
      return new InMemoryErrorReporter({ maxEvents: config.maxEvents, scrubOptions: config.scrubOptions });
    case "console":
      return new ConsoleErrorReporter({ scrubOptions: config.scrubOptions });
    case "noop":
    default:
      return new NoopErrorReporter();
  }
}
