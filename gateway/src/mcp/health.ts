/**
 * MCP health probing, reconnection & circuit breaking (#553).
 *
 * Wraps a connection lifecycle so an MCP server can be probed for liveness,
 * automatically reconnected with exponential backoff, and short-circuited via
 * a simple circuit breaker when it stays down. While a server is unavailable,
 * an optional callback lets the registry bridge mark the server's tools
 * unavailable (and re-enable them on recovery).
 *
 * Time is injectable (`now`) and there is no real timer dependency in the core
 * logic, so the breaker/backoff are fully unit-testable. The probe/connect
 * functions are also injected, so no real network/process/SDK is required.
 */
import type { Logger } from 'pino';

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  /** Consecutive failures before opening. Default 3. */
  failureThreshold?: number;
  /** Cooldown (ms) before a half-open probe is allowed. Default 30_000. */
  cooldownMs?: number;
  /** Injectable clock. Default `Date.now`. */
  now?: () => number;
}

/** Minimal circuit breaker mirroring the agent's model-side breaker. */
export class McpCircuitBreaker {
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private state: CircuitState = 'closed';
  private failures = 0;
  private openedAt = 0;

  constructor(config: CircuitBreakerConfig = {}) {
    this.failureThreshold = config.failureThreshold ?? 3;
    this.cooldownMs = config.cooldownMs ?? 30_000;
    this.now = config.now ?? Date.now;
  }

  getState(): CircuitState {
    return this.state;
  }

  /** Whether a request/probe may proceed. Transitions open→half-open. */
  canRequest(): boolean {
    if (this.state === 'open') {
      if (this.now() - this.openedAt >= this.cooldownMs) {
        this.state = 'half-open';
        return true;
      }
      return false;
    }
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  recordFailure(): void {
    if (this.state === 'half-open') {
      this.state = 'open';
      this.openedAt = this.now();
      return;
    }
    this.failures += 1;
    if (this.failures >= this.failureThreshold) {
      this.state = 'open';
      this.openedAt = this.now();
    }
  }
}

// ---------------------------------------------------------------------------
// Backoff
// ---------------------------------------------------------------------------

export interface BackoffConfig {
  /** Initial delay (ms). Default 500. */
  initialMs?: number;
  /** Multiplier per attempt. Default 2. */
  factor?: number;
  /** Maximum delay (ms). Default 30_000. */
  maxMs?: number;
  /** Jitter ratio 0..1 applied +/-. Default 0 (deterministic). */
  jitter?: number;
  /** Injectable RNG returning 0..1. Default `Math.random`. */
  random?: () => number;
}

/** Pure exponential backoff calculator. */
export class ExponentialBackoff {
  private readonly initialMs: number;
  private readonly factor: number;
  private readonly maxMs: number;
  private readonly jitter: number;
  private readonly random: () => number;
  private attempt = 0;

  constructor(config: BackoffConfig = {}) {
    this.initialMs = config.initialMs ?? 500;
    this.factor = config.factor ?? 2;
    this.maxMs = config.maxMs ?? 30_000;
    this.jitter = config.jitter ?? 0;
    this.random = config.random ?? Math.random;
  }

  get attempts(): number {
    return this.attempt;
  }

  reset(): void {
    this.attempt = 0;
  }

  /** Compute the next delay (ms) and advance the attempt counter. */
  next(): number {
    const base = Math.min(
      this.maxMs,
      this.initialMs * Math.pow(this.factor, this.attempt),
    );
    this.attempt += 1;
    if (this.jitter <= 0) return Math.round(base);
    const delta = base * this.jitter;
    const offset = (this.random() * 2 - 1) * delta;
    return Math.max(0, Math.round(base + offset));
  }
}

// ---------------------------------------------------------------------------
// Health monitor
// ---------------------------------------------------------------------------

export type HealthStatus = 'healthy' | 'unhealthy' | 'unknown';

export interface HealthMonitorOptions {
  /** Probe the server (e.g. an MCP `ping`). Resolves truthy when healthy. */
  probe: () => Promise<boolean>;
  /** Reconnect the server. Resolves when reconnected. */
  reconnect: () => Promise<void>;
  /** Called whenever availability changes (true=up, false=down). */
  onAvailabilityChange?: (available: boolean) => void;
  breaker?: McpCircuitBreaker;
  backoff?: ExponentialBackoff;
  logger?: Logger;
}

/**
 * Orchestrates a single probe→(maybe reconnect) cycle and reports availability
 * transitions. Callers drive the cadence (e.g. an interval or test loop); this
 * keeps the class free of real timers so reconnection logic stays testable.
 */
export class McpHealthMonitor {
  private readonly probe: () => Promise<boolean>;
  private readonly reconnect: () => Promise<void>;
  private readonly onAvailabilityChange?: (available: boolean) => void;
  private readonly breaker: McpCircuitBreaker;
  private readonly backoff: ExponentialBackoff;
  private readonly logger?: Logger;

  private status: HealthStatus = 'unknown';
  private available = true;

  constructor(options: HealthMonitorOptions) {
    this.probe = options.probe;
    this.reconnect = options.reconnect;
    this.onAvailabilityChange = options.onAvailabilityChange;
    this.breaker = options.breaker ?? new McpCircuitBreaker();
    this.backoff = options.backoff ?? new ExponentialBackoff();
    this.logger = options.logger;
  }

  getStatus(): HealthStatus {
    return this.status;
  }

  isAvailable(): boolean {
    return this.available;
  }

  getCircuitState(): CircuitState {
    return this.breaker.getState();
  }

  /**
   * Run one health check. If the probe fails, attempts a single reconnect
   * (subject to the circuit breaker). Returns the resulting availability.
   */
  async check(): Promise<boolean> {
    let healthy = false;
    try {
      healthy = await this.probe();
    } catch (err) {
      this.logger?.debug({ err }, 'mcp health probe threw');
      healthy = false;
    }

    if (healthy) {
      this.markHealthy();
      return true;
    }

    this.markUnhealthy();
    await this.attemptReconnect();
    return this.available;
  }

  /**
   * Compute the delay (ms) before the next reconnect attempt should occur.
   * Returns `null` when the circuit is open and still cooling down.
   */
  nextReconnectDelay(): number | null {
    if (!this.breaker.canRequest()) return null;
    return this.backoff.next();
  }

  // -------------------------------------------------------------------------

  private async attemptReconnect(): Promise<void> {
    if (!this.breaker.canRequest()) {
      this.logger?.debug('mcp reconnect skipped — circuit open');
      return;
    }
    try {
      await this.reconnect();
      this.breaker.recordSuccess();
      this.backoff.reset();
      this.markHealthy();
    } catch (err) {
      this.breaker.recordFailure();
      this.logger?.warn({ err }, 'mcp reconnect failed');
    }
  }

  private markHealthy(): void {
    this.status = 'healthy';
    this.breaker.recordSuccess();
    this.backoff.reset();
    this.setAvailable(true);
  }

  private markUnhealthy(): void {
    this.status = 'unhealthy';
    this.breaker.recordFailure();
    this.setAvailable(false);
  }

  private setAvailable(available: boolean): void {
    if (this.available === available) return;
    this.available = available;
    this.onAvailabilityChange?.(available);
  }
}
