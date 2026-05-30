// ─── Sandbox Resource Limits ──────────────────────────────────────────────
//
// Configurable CPU / memory / wall-clock limits applied per sandbox
// execution. Wall-clock enforcement is performed in-process via an
// AbortController + timer so it works regardless of the underlying runtime
// (Docker, Firecracker, in-process, or a test fake). Breaches surface a
// structured error and increment a metric counter.
//
// This module is pure where the runtime is injected: callers pass the work
// to perform as a function that receives an AbortSignal.
//
// ──────────────────────────────────────────────────────────────────────────

import pino from "pino";

const logger = pino({ name: "sandbox-limits" });

// ─── Resource Limits ──────────────────────────────────────────────────────

export interface ResourceLimits {
  /** CPU limit expressed as fractional cores (e.g. 1.0 == one core). */
  cpuCores: number;
  /** Memory limit in megabytes. */
  memoryMb: number;
  /** Wall-clock execution limit in milliseconds. */
  wallClockMs: number;
}

export const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  cpuCores: 1.0,
  memoryMb: 256,
  wallClockMs: 30_000,
};

/**
 * Merge a partial override onto a base set of limits. Pure.
 */
export function resolveLimits(
  override?: Partial<ResourceLimits>,
  base: ResourceLimits = DEFAULT_RESOURCE_LIMITS
): ResourceLimits {
  return { ...base, ...(override ?? {}) };
}

/**
 * Translate fractional cores / megabytes into the string forms expected by
 * the Docker CLI (`--cpus`, `--memory`). Pure helper for adapters.
 */
export function limitsToDocker(limits: ResourceLimits): { cpus: string; memory: string } {
  return {
    cpus: String(limits.cpuCores),
    memory: `${Math.round(limits.memoryMb)}m`,
  };
}

// ─── Breach Error ─────────────────────────────────────────────────────────

export type LimitBreachKind = "wall-clock" | "memory" | "cpu";

/**
 * Structured error thrown when a resource limit is exceeded.
 */
export class ResourceLimitBreachError extends Error {
  readonly kind: LimitBreachKind;
  readonly limitValue: number;
  readonly observedValue?: number;

  constructor(kind: LimitBreachKind, limitValue: number, observedValue?: number) {
    const observed = observedValue !== undefined ? ` (observed ${observedValue})` : "";
    super(`Sandbox resource limit breached: ${kind} exceeded ${limitValue}${observed}`);
    this.name = "ResourceLimitBreachError";
    this.kind = kind;
    this.limitValue = limitValue;
    this.observedValue = observedValue;
  }
}

export function isResourceLimitBreach(err: unknown): err is ResourceLimitBreachError {
  return err instanceof ResourceLimitBreachError;
}

// ─── Metrics ──────────────────────────────────────────────────────────────

/**
 * Minimal counter abstraction so we don't pull in a Prometheus dependency
 * here. Compatible with prom-client's Counter `inc()` shape.
 */
export interface BreachCounter {
  inc(labels?: Record<string, string>, value?: number): void;
}

/**
 * In-memory breach counter. Tracks total and per-kind breach counts. Used as
 * the default sink and as a testable target.
 */
export class InMemoryBreachCounter implements BreachCounter {
  private total = 0;
  private readonly byKind = new Map<string, number>();

  inc(labels?: Record<string, string>, value = 1): void {
    this.total += value;
    const kind = labels?.kind ?? "unknown";
    this.byKind.set(kind, (this.byKind.get(kind) ?? 0) + value);
  }

  get count(): number {
    return this.total;
  }

  countFor(kind: LimitBreachKind): number {
    return this.byKind.get(kind) ?? 0;
  }

  reset(): void {
    this.total = 0;
    this.byKind.clear();
  }
}

/** Shared default counter so callers can observe breaches without wiring. */
export const defaultBreachCounter = new InMemoryBreachCounter();

// ─── Wall-clock Enforcement ───────────────────────────────────────────────

export interface EnforceWallClockOptions {
  /** Limit in milliseconds. */
  wallClockMs: number;
  /** Counter incremented on breach. Defaults to the shared counter. */
  counter?: BreachCounter;
  /**
   * Optional external signal. If it aborts, the work is aborted but NOT
   * counted as a limit breach (it is a caller-initiated cancellation).
   */
  signal?: AbortSignal;
}

/**
 * Run injected work under a wall-clock limit. The work function receives an
 * AbortSignal that fires when the limit is reached (or the external signal
 * aborts). If the work does not settle by the limit, a
 * `ResourceLimitBreachError` is thrown and the breach counter is incremented.
 *
 * Pure with respect to the runtime: the actual execution is supplied by
 * `work`, so this is unit-testable without any real sandbox.
 */
export async function enforceWallClock<T>(
  work: (signal: AbortSignal) => Promise<T>,
  options: EnforceWallClockOptions
): Promise<T> {
  const { wallClockMs, signal: externalSignal } = options;
  const counter = options.counter ?? defaultBreachCounter;

  const controller = new AbortController();
  let timedOut = false;

  const onExternalAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort(externalSignal.reason);
    else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, wallClockMs);
  // Do not keep the event loop alive solely for this timer.
  if (typeof timer === "object" && timer && "unref" in timer) {
    (timer as { unref: () => void }).unref();
  }

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      const onAbort = () => {
        if (timedOut) {
          reject(new ResourceLimitBreachError("wall-clock", wallClockMs));
        }
      };
      if (controller.signal.aborted) onAbort();
      else controller.signal.addEventListener("abort", onAbort, { once: true });
    });

    return await Promise.race([work(controller.signal), timeoutPromise]);
  } catch (err) {
    if (isResourceLimitBreach(err) && err.kind === "wall-clock") {
      counter.inc({ kind: "wall-clock" });
      logger.warn({ wallClockMs }, "sandbox wall-clock limit breached");
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
  }
}
