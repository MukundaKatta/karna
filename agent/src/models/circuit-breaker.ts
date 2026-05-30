// ─── Provider Circuit Breaker (Issue #594) ───────────────────────────────────
//
// Hardens the model failover chain: a per-provider circuit breaker that opens
// after repeated failures, short-circuits while open (so failover moves on
// immediately instead of waiting on a known-bad provider), then half-opens
// after a cooldown to probe recovery. Pure + deterministic via an injectable
// clock. Wrapping a provider is opt-in; default failover behavior is unchanged.
//
// Providers signal failure by throwing (there is no error StreamEvent), so a
// `chat()` generator that completes without throwing counts as a success.

import type { ModelProvider, ChatParams, StreamEvent } from "./provider.js";

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  /** Consecutive failures before the circuit opens. Default 5. */
  failureThreshold?: number;
  /** How long (ms) to stay open before allowing a probe. Default 30s. */
  cooldownMs?: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

export class CircuitOpenError extends Error {
  constructor(public readonly provider: string) {
    super(`Circuit breaker is open for provider "${provider}"`);
    this.name = "CircuitOpenError";
  }
}

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private openedAt = 0;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  /** Whether a request may proceed. Transitions open→half-open after cooldown. */
  canRequest(): boolean {
    if (this.state === "open") {
      if (this.now() - this.openedAt >= this.cooldownMs) {
        this.state = "half-open";
        return true;
      }
      return false;
    }
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = "closed";
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.state === "half-open" || this.failures >= this.failureThreshold) {
      this.state = "open";
      this.openedAt = this.now();
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  /** Force-reset to closed (e.g. on manual recovery). */
  reset(): void {
    this.state = "closed";
    this.failures = 0;
    this.openedAt = 0;
  }
}

/**
 * Wraps a `ModelProvider` with a `CircuitBreaker`. When the circuit is open the
 * `chat()` generator throws `CircuitOpenError` immediately (which the failover
 * loop treats like any other provider error, moving to the next provider).
 */
export class CircuitBreakerProvider implements ModelProvider {
  public readonly name: string;
  public readonly countTokens?: (text: string) => number;

  constructor(
    private readonly inner: ModelProvider,
    private readonly breaker: CircuitBreaker = new CircuitBreaker(),
  ) {
    this.name = inner.name;
    if (inner.countTokens) {
      const fn = inner.countTokens.bind(inner);
      this.countTokens = (text: string) => fn(text);
    }
  }

  async *chat(params: ChatParams): AsyncGenerator<StreamEvent> {
    if (!this.breaker.canRequest()) {
      throw new CircuitOpenError(this.inner.name);
    }
    try {
      for await (const event of this.inner.chat(params)) {
        yield event;
      }
    } catch (err) {
      this.breaker.recordFailure();
      throw err;
    }
    this.breaker.recordSuccess();
  }

  /** Exposed for metrics/inspection. */
  getState(): CircuitState {
    return this.breaker.getState();
  }
}
