// ─── Provider Rate-Limit-Aware Backoff & Queuing (#597) ─────────────────────
// Pure/testable utilities for handling provider rate limits:
//   1. Parse rate-limit / Retry-After headers from a headers-like object.
//   2. Compute adaptive exponential backoff with jitter, honoring any
//      server-provided retry hint.
//   3. A per-provider bounded request queue with a concurrency limit that
//      preserves submission order (FIFO) for queued work.
//
// Time is fully injectable (clock + sleep) so behavior is deterministic in
// tests. Nothing here performs real I/O or constructs providers.

// ─── Header parsing ─────────────────────────────────────────────────────────

/**
 * A minimal headers-like shape. Supports both a plain record and anything with
 * a `get(name)` method (e.g. the Fetch `Headers` class). Header lookups are
 * case-insensitive.
 */
export type HeadersLike =
  | Record<string, string | string[] | number | undefined>
  | { get(name: string): string | null };

export interface ParsedRateLimit {
  /**
   * Recommended wait time in milliseconds before retrying, derived from
   * `Retry-After` (seconds or HTTP-date) or a reset header. Undefined when no
   * hint is present.
   */
  retryAfterMs?: number;
  /** Remaining requests in the current window, if advertised. */
  remaining?: number;
  /** Total request limit for the current window, if advertised. */
  limit?: number;
  /** Absolute epoch ms when the window resets, if derivable. */
  resetAtMs?: number;
  /** True when headers indicate the request was/should be rate limited. */
  limited: boolean;
}

function headerGet(headers: HeadersLike, name: string): string | undefined {
  if (typeof (headers as { get?: unknown }).get === "function") {
    const v = (headers as { get(n: string): string | null }).get(name);
    return v == null ? undefined : v;
  }
  const rec = headers as Record<string, string | string[] | number | undefined>;
  const lower = name.toLowerCase();
  for (const key of Object.keys(rec)) {
    if (key.toLowerCase() === lower) {
      const val = rec[key];
      if (val === undefined) return undefined;
      if (Array.isArray(val)) return val[0];
      return String(val);
    }
  }
  return undefined;
}

function parseNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parse rate-limit related headers. Recognizes (case-insensitively):
 *   - `retry-after`            (seconds, or HTTP-date)
 *   - `x-ratelimit-remaining`  / `ratelimit-remaining`
 *   - `x-ratelimit-limit`      / `ratelimit-limit`
 *   - `x-ratelimit-reset`      / `ratelimit-reset` (epoch seconds or delta secs)
 *
 * @param headers headers-like object
 * @param nowMs   current epoch ms (injected for determinism / date math)
 */
export function parseRateLimitHeaders(
  headers: HeadersLike,
  nowMs: number = Date.now(),
): ParsedRateLimit {
  const result: ParsedRateLimit = { limited: false };

  // ── Retry-After: either a number of seconds or an HTTP date. ──
  const retryAfter = headerGet(headers, "retry-after");
  if (retryAfter !== undefined) {
    const asSeconds = parseNumber(retryAfter);
    if (asSeconds !== undefined) {
      result.retryAfterMs = Math.max(0, Math.round(asSeconds * 1000));
    } else {
      const dateMs = Date.parse(retryAfter);
      if (Number.isFinite(dateMs)) {
        result.retryAfterMs = Math.max(0, dateMs - nowMs);
        result.resetAtMs = dateMs;
      }
    }
  }

  const remaining =
    parseNumber(headerGet(headers, "x-ratelimit-remaining")) ??
    parseNumber(headerGet(headers, "ratelimit-remaining"));
  if (remaining !== undefined) result.remaining = remaining;

  const limit =
    parseNumber(headerGet(headers, "x-ratelimit-limit")) ??
    parseNumber(headerGet(headers, "ratelimit-limit"));
  if (limit !== undefined) result.limit = limit;

  const reset =
    parseNumber(headerGet(headers, "x-ratelimit-reset")) ??
    parseNumber(headerGet(headers, "ratelimit-reset"));
  if (reset !== undefined && result.resetAtMs === undefined) {
    // Heuristic: a small value is a delta in seconds; a large value is an
    // absolute epoch (seconds). Threshold ~ year 2001 in epoch seconds.
    if (reset > 1_000_000_000) {
      result.resetAtMs = Math.round(reset * 1000);
    } else {
      result.resetAtMs = nowMs + Math.round(reset * 1000);
    }
    if (result.retryAfterMs === undefined) {
      result.retryAfterMs = Math.max(0, result.resetAtMs - nowMs);
    }
  }

  result.limited =
    result.retryAfterMs !== undefined ||
    (result.remaining !== undefined && result.remaining <= 0);

  return result;
}

// ─── Adaptive backoff ───────────────────────────────────────────────────────

export interface BackoffOptions {
  /** Base delay in ms for attempt 0. Default 1000. */
  baseMs?: number;
  /** Multiplier per attempt. Default 2 (exponential). */
  factor?: number;
  /** Maximum delay in ms (cap). Default 30_000. */
  maxMs?: number;
  /**
   * Jitter strategy. Default "full".
   *  - "none": deterministic `min(cap, base*factor^attempt)`.
   *  - "full": uniform random in [0, computed].
   *  - "equal": computed/2 + uniform random in [0, computed/2].
   */
  jitter?: "none" | "full" | "equal";
  /**
   * If set, the backoff never drops below the server-provided retry hint
   * (e.g. parsed `retryAfterMs`). The hint is treated as a floor.
   */
  retryAfterMs?: number;
  /** Random source in [0,1). Injectable for deterministic tests. */
  random?: () => number;
}

/**
 * Compute the backoff delay (ms) for a given zero-based attempt number.
 * Deterministic when `jitter` is "none" or when a fixed `random` is supplied.
 */
export function computeBackoff(attempt: number, options: BackoffOptions = {}): number {
  const base = options.baseMs ?? 1000;
  const factor = options.factor ?? 2;
  const cap = options.maxMs ?? 30_000;
  const jitter = options.jitter ?? "full";
  const rand = options.random ?? Math.random;

  const safeAttempt = attempt < 0 ? 0 : attempt;
  const exp = Math.min(cap, base * Math.pow(factor, safeAttempt));

  let delay: number;
  switch (jitter) {
    case "none":
      delay = exp;
      break;
    case "equal":
      delay = exp / 2 + rand() * (exp / 2);
      break;
    case "full":
    default:
      delay = rand() * exp;
      break;
  }

  // Honor a server-provided floor (Retry-After) if present.
  if (options.retryAfterMs !== undefined) {
    delay = Math.max(delay, options.retryAfterMs);
  }

  // Never exceed the cap unless the server floor demands it.
  const ceiling = Math.max(cap, options.retryAfterMs ?? 0);
  return Math.min(Math.round(delay), ceiling);
}

// ─── Bounded per-provider request queue ─────────────────────────────────────

export interface QueueOptions {
  /** Max concurrently-running tasks. Default 1. */
  concurrency?: number;
  /**
   * Max number of tasks allowed to wait in the queue (excludes running). When
   * exceeded, `enqueue` rejects with a `QueueFullError`. Default Infinity.
   */
  maxQueueDepth?: number;
}

export class QueueFullError extends Error {
  constructor(maxQueueDepth: number) {
    super(`Request queue is full (maxQueueDepth=${maxQueueDepth})`);
    this.name = "QueueFullError";
  }
}

interface QueuedItem<T> {
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

/**
 * A bounded FIFO request queue with a concurrency limit. Intended to be created
 * per-provider so each provider's in-flight requests are independently capped.
 *
 * Pure with respect to timing: it does not introduce delays itself. Combine
 * with {@link computeBackoff} and an injected sleep when scheduling retries.
 */
export class RequestQueue {
  private readonly concurrency: number;
  private readonly maxQueueDepth: number;
  private active = 0;
  private readonly waiting: Array<QueuedItem<unknown>> = [];

  constructor(options: QueueOptions = {}) {
    this.concurrency = Math.max(1, options.concurrency ?? 1);
    this.maxQueueDepth = options.maxQueueDepth ?? Number.POSITIVE_INFINITY;
  }

  /** Number of tasks currently running. */
  get activeCount(): number {
    return this.active;
  }

  /** Number of tasks waiting to start. */
  get pendingCount(): number {
    return this.waiting.length;
  }

  /**
   * Enqueue a task. Runs immediately if under the concurrency limit, otherwise
   * waits its turn (FIFO). Resolves/rejects with the task's outcome.
   */
  enqueue<T>(task: () => Promise<T>): Promise<T> {
    if (this.waiting.length >= this.maxQueueDepth) {
      return Promise.reject(new QueueFullError(this.maxQueueDepth));
    }
    return new Promise<T>((resolve, reject) => {
      this.waiting.push({
        task: task as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.pump();
    });
  }

  private pump(): void {
    while (this.active < this.concurrency && this.waiting.length > 0) {
      const item = this.waiting.shift()!;
      this.active++;
      // Run asynchronously; settle the caller's promise then pump again.
      void Promise.resolve()
        .then(() => item.task())
        .then(
          (value) => item.resolve(value),
          (err) => item.reject(err),
        )
        .finally(() => {
          this.active--;
          this.pump();
        });
    }
  }

  /** Resolves when all active + waiting tasks have settled. */
  async onIdle(): Promise<void> {
    while (this.active > 0 || this.waiting.length > 0) {
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }
}

// ─── Retry orchestration (pure, injectable clock/sleep) ─────────────────────

export type SleepFn = (ms: number) => Promise<void>;

export interface RetryWithBackoffOptions extends BackoffOptions {
  /** Max attempts (including the first). Default 3. */
  maxAttempts?: number;
  /** Injectable sleep. Default a real `setTimeout` sleep. */
  sleep?: SleepFn;
  /**
   * Predicate deciding whether an error is retryable. If it returns parsed
   * rate-limit info, the `retryAfterMs` floor is applied to the next backoff.
   * Returning `false` aborts immediately.
   */
  shouldRetry?: (error: unknown, attempt: number) => boolean | ParsedRateLimit;
}

const defaultSleep: SleepFn = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Execute a task with adaptive, rate-limit-aware backoff. Deterministic given
 * an injected `random` and `sleep`. Rethrows the last error when attempts are
 * exhausted.
 */
export async function retryWithBackoff<T>(
  task: () => Promise<T>,
  options: RetryWithBackoffOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts - 1) break;

      let retryAfterMs = options.retryAfterMs;
      if (options.shouldRetry) {
        const decision = options.shouldRetry(error, attempt);
        if (decision === false) break;
        if (decision !== true && typeof decision === "object") {
          if (decision.retryAfterMs !== undefined) {
            retryAfterMs = decision.retryAfterMs;
          }
        }
      }

      const delay = computeBackoff(attempt, { ...options, retryAfterMs });
      await sleep(delay);
    }
  }
  throw lastError;
}
