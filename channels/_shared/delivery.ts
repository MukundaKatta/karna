/**
 * Issue #609 — Delivery retries & dead-letter queue.
 *
 * Provides:
 *  - {@link withRetry}: retry-with-exponential-backoff wrapper for an outbound
 *    send function, with jitter and a configurable retry predicate.
 *  - {@link DeadLetterQueue}: an in-memory DLQ for messages that exhausted all
 *    retries, supporting inspect / replay / drain.
 *  - {@link DeliveryPipeline}: composition that attempts a send with retries and
 *    routes terminal failures to the DLQ.
 *
 * Pure/testable: no external dependencies. Timers and randomness are injectable.
 */

export interface RetryOptions {
  /** Maximum number of attempts (including the first). Must be >= 1. */
  maxAttempts: number;
  /** Base delay in ms for the first backoff. */
  baseDelayMs: number;
  /** Upper bound on any single backoff delay. */
  maxDelayMs?: number;
  /** Exponential growth factor between attempts. Defaults to 2. */
  factor?: number;
  /** Jitter ratio in [0,1]; randomizes delay by +/- (ratio * delay). Default 0. */
  jitter?: number;
  /**
   * Predicate deciding whether a given error is retryable. Defaults to "all
   * errors are retryable".
   */
  isRetryable?: (err: unknown) => boolean;
  /** Called before each retry sleep (useful for logging/metrics/tests). */
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
  /** Injectable sleep (ms). Defaults to setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable RNG in [0,1). Defaults to Math.random. */
  random?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Error thrown when all retry attempts are exhausted. Wraps the last error. */
export class RetriesExhaustedError extends Error {
  readonly attempts: number;
  readonly lastError: unknown;
  constructor(attempts: number, lastError: unknown) {
    super(
      `Delivery failed after ${attempts} attempt(s): ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
    this.name = 'RetriesExhaustedError';
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

/** Compute the backoff delay (ms) for a given zero-based retry index. */
export function computeBackoff(retryIndex: number, opts: RetryOptions): number {
  const factor = opts.factor ?? 2;
  const base = opts.baseDelayMs * Math.pow(factor, retryIndex);
  const capped = Math.min(base, opts.maxDelayMs ?? Number.MAX_SAFE_INTEGER);
  const jitter = opts.jitter ?? 0;
  if (jitter <= 0) return Math.round(capped);
  const rnd = (opts.random ?? Math.random)();
  // +/- jitter around the capped value, clamped to >= 0.
  const delta = capped * jitter * (rnd * 2 - 1);
  return Math.max(0, Math.round(capped + delta));
}

/**
 * Execute `fn` with retry-and-backoff. Resolves with the function's result, or
 * rejects with {@link RetriesExhaustedError} once attempts are exhausted (or
 * immediately if the error is deemed non-retryable).
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T> | T,
  opts: RetryOptions,
): Promise<T> {
  if (opts.maxAttempts < 1) throw new Error('maxAttempts must be >= 1');
  const sleep = opts.sleep ?? defaultSleep;
  const isRetryable = opts.isRetryable ?? (() => true);

  let lastError: unknown;
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      const hasMore = attempt < opts.maxAttempts;
      if (!hasMore || !isRetryable(err)) {
        throw new RetriesExhaustedError(attempt, err);
      }
      const delayMs = computeBackoff(attempt - 1, opts);
      opts.onRetry?.({ attempt, delayMs, error: err });
      await sleep(delayMs);
    }
  }
  // Unreachable, but keeps TS happy.
  throw new RetriesExhaustedError(opts.maxAttempts, lastError);
}

/** An entry parked in the dead-letter queue. */
export interface DeadLetter<T> {
  /** Stable identifier for inspect/replay. */
  id: string;
  /** The original payload that failed to deliver. */
  payload: T;
  /** Number of delivery attempts made before giving up. */
  attempts: number;
  /** The last error encountered, normalized to a string message. */
  error: string;
  /** Epoch ms when the message was dead-lettered. */
  timestamp: number;
}

export interface DeadLetterQueueOptions {
  /** Maximum entries retained; oldest are evicted past this. Default 1000. */
  maxSize?: number;
  /** Injectable id generator. Defaults to a monotonic counter. */
  idFactory?: () => string;
  /** Injectable clock (ms). Defaults to Date.now. */
  now?: () => number;
}

/**
 * In-memory dead-letter queue. Holds messages that exhausted delivery retries
 * so they can be inspected and replayed later. Bounded to avoid unbounded
 * memory growth.
 */
export class DeadLetterQueue<T> {
  private readonly entries: DeadLetter<T>[] = [];
  private readonly maxSize: number;
  private readonly idFactory: () => string;
  private readonly now: () => number;
  private counter = 0;

  constructor(opts: DeadLetterQueueOptions = {}) {
    this.maxSize = opts.maxSize ?? 1000;
    this.now = opts.now ?? Date.now;
    this.idFactory =
      opts.idFactory ?? (() => `dlq_${++this.counter}_${this.now()}`);
  }

  /** Add a failed message to the DLQ; returns the created entry. */
  add(payload: T, attempts: number, error: unknown): DeadLetter<T> {
    const entry: DeadLetter<T> = {
      id: this.idFactory(),
      payload,
      attempts,
      error: error instanceof Error ? error.message : String(error),
      timestamp: this.now(),
    };
    this.entries.push(entry);
    if (this.entries.length > this.maxSize) {
      this.entries.shift();
    }
    return entry;
  }

  /** Number of entries currently held. */
  size(): number {
    return this.entries.length;
  }

  /** Read-only snapshot of all entries (most-recently-added last). */
  inspect(): ReadonlyArray<DeadLetter<T>> {
    return this.entries.map((e) => ({ ...e }));
  }

  /** Find a single entry by id. */
  peek(id: string): DeadLetter<T> | undefined {
    const found = this.entries.find((e) => e.id === id);
    return found ? { ...found } : undefined;
  }

  /** Remove and return an entry by id, or undefined if not present. */
  remove(id: string): DeadLetter<T> | undefined {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx === -1) return undefined;
    const [removed] = this.entries.splice(idx, 1);
    return removed;
  }

  /** Empty the queue, returning everything that was held. */
  drain(): DeadLetter<T>[] {
    return this.entries.splice(0, this.entries.length);
  }

  /**
   * Replay a single dead-lettered message through `send`. On success the entry
   * is removed and true is returned. On failure the entry is kept (its error /
   * attempt count are refreshed) and false is returned.
   */
  async replay(
    id: string,
    send: (payload: T) => Promise<void> | void,
  ): Promise<boolean> {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return false;
    try {
      await send(entry.payload);
      this.remove(id);
      return true;
    } catch (err) {
      entry.attempts += 1;
      entry.error = err instanceof Error ? err.message : String(err);
      entry.timestamp = this.now();
      return false;
    }
  }

  /**
   * Replay every entry. Returns counts of successes/failures. Entries that
   * succeed are removed; failures remain for later inspection.
   */
  async replayAll(
    send: (payload: T) => Promise<void> | void,
  ): Promise<{ succeeded: number; failed: number }> {
    let succeeded = 0;
    let failed = 0;
    // Snapshot ids first since the array mutates during replay.
    const ids = this.entries.map((e) => e.id);
    for (const id of ids) {
      const ok = await this.replay(id, send);
      if (ok) succeeded++;
      else failed++;
    }
    return { succeeded, failed };
  }
}

export interface DeliveryPipelineOptions<T> {
  /** The outbound send function to wrap. */
  send: (payload: T) => Promise<void> | void;
  retry: RetryOptions;
  /** DLQ to receive terminal failures. Created if omitted. */
  dlq?: DeadLetterQueue<T>;
}

/**
 * Composition of retry + DLQ: attempts delivery with backoff and, on terminal
 * failure, parks the payload in the dead-letter queue instead of throwing.
 */
export class DeliveryPipeline<T> {
  readonly dlq: DeadLetterQueue<T>;
  private readonly send: (payload: T) => Promise<void> | void;
  private readonly retry: RetryOptions;

  constructor(opts: DeliveryPipelineOptions<T>) {
    this.send = opts.send;
    this.retry = opts.retry;
    this.dlq = opts.dlq ?? new DeadLetterQueue<T>();
  }

  /**
   * Deliver a payload. Returns true if delivered, false if it was dead-lettered.
   */
  async deliver(payload: T): Promise<boolean> {
    try {
      await withRetry(() => this.send(payload), this.retry);
      return true;
    } catch (err) {
      const attempts =
        err instanceof RetriesExhaustedError
          ? err.attempts
          : this.retry.maxAttempts;
      const cause =
        err instanceof RetriesExhaustedError ? err.lastError : err;
      this.dlq.add(payload, attempts, cause);
      return false;
    }
  }
}
