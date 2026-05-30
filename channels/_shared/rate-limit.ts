/**
 * Issue #607 — Channel rate limiting & backpressure.
 *
 * Provides:
 *  - {@link TokenBucket}: a classic token-bucket limiter for outbound sends.
 *  - {@link BoundedQueue}: a bounded async work queue that applies backpressure
 *    (rejects or blocks when full) and emits metrics.
 *  - {@link RateLimitedQueue}: convenience composition of the two for per-channel
 *    outbound traffic shaping.
 *
 * Pure/testable: no external dependencies. Time is injectable for deterministic
 * tests via the `now` option.
 */

export interface TokenBucketOptions {
  /** Maximum number of tokens the bucket can hold. */
  capacity: number;
  /** Tokens added per second. */
  refillPerSecond: number;
  /** Injectable clock (ms). Defaults to Date.now. */
  now?: () => number;
  /** Initial token count. Defaults to `capacity` (full bucket). */
  initialTokens?: number;
}

/**
 * Token-bucket rate limiter. Call {@link tryRemove} for non-blocking checks or
 * {@link removeToken} to await capacity.
 */
export class TokenBucket {
  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private readonly now: () => number;
  private tokens: number;
  private lastRefill: number;

  constructor(opts: TokenBucketOptions) {
    if (opts.capacity <= 0) throw new Error('TokenBucket capacity must be > 0');
    if (opts.refillPerSecond <= 0)
      throw new Error('TokenBucket refillPerSecond must be > 0');
    this.capacity = opts.capacity;
    this.refillPerSecond = opts.refillPerSecond;
    this.now = opts.now ?? Date.now;
    this.tokens = opts.initialTokens ?? opts.capacity;
    this.lastRefill = this.now();
  }

  /** Refill tokens based on elapsed wall-clock time. */
  private refill(): void {
    const t = this.now();
    const elapsedMs = t - this.lastRefill;
    if (elapsedMs <= 0) return;
    const added = (elapsedMs / 1000) * this.refillPerSecond;
    if (added > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + added);
      this.lastRefill = t;
    }
  }

  /** Current (refilled) token count. Primarily for metrics/tests. */
  available(): number {
    this.refill();
    return this.tokens;
  }

  /**
   * Attempt to remove `count` tokens without waiting.
   * Returns true if successful, false if insufficient tokens.
   */
  tryRemove(count = 1): boolean {
    this.refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  }

  /** Milliseconds until `count` tokens will be available. 0 if already available. */
  msUntilAvailable(count = 1): number {
    this.refill();
    if (this.tokens >= count) return 0;
    const deficit = count - this.tokens;
    return Math.ceil((deficit / this.refillPerSecond) * 1000);
  }

  /**
   * Remove `count` tokens, waiting (via real timers) until they are available.
   * Uses `msUntilAvailable` to sleep the minimum required time, then retries.
   */
  async removeToken(count = 1): Promise<void> {
    if (count > this.capacity)
      throw new Error('Cannot remove more tokens than bucket capacity');
    // Loop guards against scheduling jitter / fractional refills.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (this.tryRemove(count)) return;
      const wait = this.msUntilAvailable(count);
      await sleep(Math.max(1, wait));
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Metrics snapshot for a {@link BoundedQueue}. */
export interface QueueMetrics {
  /** Items currently waiting in the queue. */
  depth: number;
  /** Configured maximum depth. */
  maxDepth: number;
  /** Total items successfully enqueued. */
  enqueued: number;
  /** Total items processed to completion (resolved or rejected by the worker). */
  processed: number;
  /** Total items rejected because the queue was full ('reject' policy). */
  dropped: number;
  /** Highest queue depth observed. */
  highWaterMark: number;
  /** Whether a worker drain loop is currently running. */
  running: boolean;
}

export type OverflowPolicy = 'reject' | 'block' | 'drop-oldest';

export interface BoundedQueueOptions<T> {
  /** Maximum number of items allowed to wait in the queue. */
  maxDepth: number;
  /** Async worker invoked for each item, in FIFO order, one at a time. */
  worker: (item: T) => Promise<void> | void;
  /**
   * What to do when enqueueing into a full queue:
   *  - 'reject'      : throw QueueFullError immediately (default).
   *  - 'block'       : await until space is available.
   *  - 'drop-oldest' : evict the oldest queued item to make room.
   */
  overflow?: OverflowPolicy;
}

export class QueueFullError extends Error {
  constructor(maxDepth: number) {
    super(`Queue is full (maxDepth=${maxDepth})`);
    this.name = 'QueueFullError';
  }
}

interface QueueEntry<T> {
  item: T;
  resolve: () => void;
  reject: (err: unknown) => void;
}

/**
 * A bounded FIFO async queue that drains through a single worker, applying
 * backpressure when full. Each {@link enqueue} resolves when its item has been
 * processed by the worker (or rejects if the worker throws / it was dropped).
 */
export class BoundedQueue<T> {
  private readonly maxDepth: number;
  private readonly worker: (item: T) => Promise<void> | void;
  private readonly overflow: OverflowPolicy;
  private readonly buffer: QueueEntry<T>[] = [];
  private readonly waiters: Array<() => void> = [];
  private draining = false;

  private metrics: QueueMetrics;

  constructor(opts: BoundedQueueOptions<T>) {
    if (opts.maxDepth <= 0) throw new Error('maxDepth must be > 0');
    this.maxDepth = opts.maxDepth;
    this.worker = opts.worker;
    this.overflow = opts.overflow ?? 'reject';
    this.metrics = {
      depth: 0,
      maxDepth: opts.maxDepth,
      enqueued: 0,
      processed: 0,
      dropped: 0,
      highWaterMark: 0,
      running: false,
    };
  }

  /** Returns a copy of current metrics. */
  getMetrics(): QueueMetrics {
    return { ...this.metrics, depth: this.buffer.length, running: this.draining };
  }

  /** Current queue depth. */
  size(): number {
    return this.buffer.length;
  }

  /**
   * Enqueue an item. The returned promise resolves once the worker has
   * processed the item. Behavior on a full queue depends on overflow policy.
   */
  async enqueue(item: T): Promise<void> {
    if (this.buffer.length >= this.maxDepth) {
      if (this.overflow === 'reject') {
        throw new QueueFullError(this.maxDepth);
      } else if (this.overflow === 'drop-oldest') {
        const oldest = this.buffer.shift();
        if (oldest) {
          this.metrics.dropped++;
          oldest.reject(new QueueFullError(this.maxDepth));
        }
      } else {
        // 'block' — wait for space.
        await new Promise<void>((resolve) => this.waiters.push(resolve));
      }
    }

    return new Promise<void>((resolve, reject) => {
      this.buffer.push({ item, resolve, reject });
      this.metrics.enqueued++;
      this.metrics.highWaterMark = Math.max(
        this.metrics.highWaterMark,
        this.buffer.length,
      );
      void this.drain();
    });
  }

  /** Internal single-flight drain loop. */
  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.buffer.length > 0) {
        const entry = this.buffer.shift()!;
        // A freed slot can unblock a 'block'-policy waiter.
        const waiter = this.waiters.shift();
        if (waiter) waiter();
        try {
          await this.worker(entry.item);
          this.metrics.processed++;
          entry.resolve();
        } catch (err) {
          this.metrics.processed++;
          entry.reject(err);
        }
      }
    } finally {
      this.draining = false;
      // If a 'block' waiter is still pending and there is now room, release it.
      while (this.waiters.length > 0 && this.buffer.length < this.maxDepth) {
        const w = this.waiters.shift();
        if (w) w();
      }
    }
  }
}

export interface RateLimitedQueueOptions<T> {
  bucket: TokenBucketOptions;
  /** Maximum number of items allowed to wait. */
  maxDepth: number;
  /** Async send function invoked for each item once a token is acquired. */
  send: (item: T) => Promise<void> | void;
  /** Tokens consumed per item. Defaults to 1. */
  costPerItem?: number;
  overflow?: OverflowPolicy;
}

/**
 * Convenience composition: a {@link BoundedQueue} whose worker waits on a
 * {@link TokenBucket} before invoking `send`. Provides per-channel outbound
 * traffic shaping with both rate limiting and backpressure.
 */
export class RateLimitedQueue<T> {
  readonly bucket: TokenBucket;
  readonly queue: BoundedQueue<T>;

  constructor(opts: RateLimitedQueueOptions<T>) {
    this.bucket = new TokenBucket(opts.bucket);
    const cost = opts.costPerItem ?? 1;
    this.queue = new BoundedQueue<T>({
      maxDepth: opts.maxDepth,
      overflow: opts.overflow,
      worker: async (item) => {
        await this.bucket.removeToken(cost);
        await opts.send(item);
      },
    });
  }

  /** Enqueue an outbound item; resolves when it has been sent. */
  send(item: T): Promise<void> {
    return this.queue.enqueue(item);
  }

  getMetrics(): QueueMetrics {
    return this.queue.getMetrics();
  }
}
