// ─── Per-Tool Rate Limiting & Concurrency (Issue #552) ───────────────────────
//
// Token-bucket rate limiter combined with a concurrency gate, keyed by tool
// name. Both are configurable per tool; the default is fully unlimited so that
// no behavior changes unless a tool is explicitly configured.
//
// Usage:
//   const limiter = new ToolRateLimiter({ shell_exec: { ratePerSec: 5, burst: 5, maxConcurrent: 2 } });
//   const lease = await limiter.acquire("shell_exec", signal);
//   try { ... } finally { lease.release(); }

import pino from "pino";

const logger = pino({ name: "tool-rate-limiter" });

/** Per-tool limiter configuration. Any omitted field means "unlimited". */
export interface ToolLimitConfig {
  /** Sustained token refill rate, in tokens per second. Omit for no rate limit. */
  ratePerSec?: number;
  /** Maximum bucket size (burst capacity). Defaults to `ratePerSec` when omitted. */
  burst?: number;
  /** Maximum simultaneous executions. Omit for unlimited concurrency. */
  maxConcurrent?: number;
  /**
   * Maximum time (ms) to wait for a token / concurrency slot before failing.
   * Omit/0 to wait indefinitely (subject to the abort signal).
   */
  maxWaitMs?: number;
}

/** A handle returned by `acquire`; call `release()` exactly once when done. */
export interface ToolLease {
  release(): void;
}

/** Thrown when an acquire times out or is aborted. */
export class RateLimitTimeoutError extends Error {
  constructor(public readonly toolName: string) {
    super(`Timed out waiting for rate-limit/concurrency slot for tool "${toolName}"`);
    this.name = "RateLimitTimeoutError";
  }
}

interface BucketState {
  /** Current available tokens (fractional). */
  tokens: number;
  /** Timestamp (ms) of the last refill. */
  lastRefill: number;
  /** Number of currently in-flight executions. */
  active: number;
  /** FIFO queue of waiters to wake when capacity frees up. */
  waiters: Array<() => void>;
}

const NOOP_LEASE: ToolLease = { release() {} };

export class ToolRateLimiter {
  private readonly config: Map<string, ToolLimitConfig>;
  private readonly state = new Map<string, BucketState>();
  private readonly now: () => number;

  constructor(
    config: Record<string, ToolLimitConfig> = {},
    options: { now?: () => number } = {}
  ) {
    this.config = new Map(Object.entries(config));
    this.now = options.now ?? Date.now;
  }

  /** Set or replace the limit configuration for a tool. */
  configure(toolName: string, config: ToolLimitConfig): void {
    this.config.set(toolName, config);
  }

  /** Whether a tool has any active limits configured. */
  isLimited(toolName: string): boolean {
    const c = this.config.get(toolName);
    return !!c && (c.ratePerSec !== undefined || c.maxConcurrent !== undefined);
  }

  /**
   * Acquire a rate-limit token and a concurrency slot for `toolName`.
   *
   * If the tool is not limited this returns immediately with a no-op lease so
   * unconfigured tools incur effectively zero overhead. Otherwise it waits
   * (respecting `maxWaitMs` and the optional abort signal) until both a token
   * and a free slot are available.
   */
  async acquire(toolName: string, signal?: AbortSignal): Promise<ToolLease> {
    const config = this.config.get(toolName);
    if (!config || (config.ratePerSec === undefined && config.maxConcurrent === undefined)) {
      return NOOP_LEASE;
    }

    const deadline = config.maxWaitMs && config.maxWaitMs > 0 ? this.now() + config.maxWaitMs : undefined;

    // Wait until we can both take a token and grab a concurrency slot.
    while (true) {
      if (signal?.aborted) {
        throw new RateLimitTimeoutError(toolName);
      }

      const state = this.getState(toolName);
      this.refill(toolName, config, state);

      const tokenOk = config.ratePerSec === undefined || state.tokens >= 1;
      const slotOk = config.maxConcurrent === undefined || state.active < config.maxConcurrent;

      if (tokenOk && slotOk) {
        if (config.ratePerSec !== undefined) {
          state.tokens -= 1;
        }
        state.active += 1;
        return this.makeLease(toolName, config);
      }

      // Compute how long to wait before re-checking.
      const waitMs = this.computeWait(config, state, deadline);
      if (waitMs === null) {
        throw new RateLimitTimeoutError(toolName);
      }

      await this.sleep(toolName, waitMs, signal);
    }
  }

  /** Snapshot of current limiter state, for metrics/tests. */
  stats(toolName: string): { active: number; tokens: number; waiting: number } {
    const s = this.state.get(toolName);
    if (!s) return { active: 0, tokens: 0, waiting: 0 };
    return { active: s.active, tokens: s.tokens, waiting: s.waiters.length };
  }

  private makeLease(toolName: string, config: ToolLimitConfig): ToolLease {
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        const state = this.state.get(toolName);
        if (!state) return;
        // `acquire` always increments `active`, so always release it here
        // (regardless of whether a concurrency cap is configured).
        if (state.active > 0) {
          state.active -= 1;
        }
        // Wake the next waiter so it can re-evaluate capacity.
        const next = state.waiters.shift();
        if (next) next();
      },
    };
  }

  private getState(toolName: string): BucketState {
    let s = this.state.get(toolName);
    if (!s) {
      const config = this.config.get(toolName);
      const burst = config?.burst ?? config?.ratePerSec ?? 0;
      s = { tokens: burst, lastRefill: this.now(), active: 0, waiters: [] };
      this.state.set(toolName, s);
    }
    return s;
  }

  private refill(toolName: string, config: ToolLimitConfig, state: BucketState): void {
    if (config.ratePerSec === undefined) return;
    const now = this.now();
    const elapsedSec = (now - state.lastRefill) / 1000;
    if (elapsedSec <= 0) return;
    const burst = config.burst ?? config.ratePerSec;
    state.tokens = Math.min(burst, state.tokens + elapsedSec * config.ratePerSec);
    state.lastRefill = now;
  }

  private computeWait(
    config: ToolLimitConfig,
    state: BucketState,
    deadline: number | undefined
  ): number | null {
    // Default poll interval when blocked only on concurrency.
    let waitMs = 25;
    if (config.ratePerSec !== undefined && state.tokens < 1) {
      const needed = 1 - state.tokens;
      waitMs = Math.max(1, Math.ceil((needed / config.ratePerSec) * 1000));
    }

    if (deadline !== undefined) {
      const remaining = deadline - this.now();
      if (remaining <= 0) return null;
      waitMs = Math.min(waitMs, remaining);
    }
    return waitMs;
  }

  private sleep(toolName: string, ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const state = this.getState(toolName);
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
        const idx = state.waiters.indexOf(wake);
        if (idx >= 0) state.waiters.splice(idx, 1);
      };

      const wake = () => {
        finish();
        resolve();
      };

      const onAbort = () => {
        finish();
        reject(new RateLimitTimeoutError(toolName));
      };

      const timer = setTimeout(wake, ms);
      // Register as a waiter so a `release()` can wake us early.
      state.waiters.push(wake);
      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }
}

logger.debug("Tool rate limiter module loaded");
