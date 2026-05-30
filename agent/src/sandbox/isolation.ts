// ─── Container-based Tool Sandbox Isolation ───────────────────────────────
//
// Routes tool executions to an appropriate runtime based on the tool's risk
// level: high-risk / critical tools run in an isolated sandbox runtime
// (Docker, Firecracker, …) while low / medium-risk tools run in-process for
// speed.
//
// The runtime is abstracted behind the `SandboxRuntime` interface so adapters
// are pluggable and so tests can inject a fake runtime — no Docker required.
//
// Tool I/O is marshalled (serialized) across the runtime boundary so an
// isolated runtime can transport it as text.
//
// ──────────────────────────────────────────────────────────────────────────

import pino from "pino";
import type { ToolRiskLevel } from "@karna/shared/types/tool.js";
import {
  DEFAULT_RESOURCE_LIMITS,
  enforceWallClock,
  resolveLimits,
  type BreachCounter,
  type ResourceLimits,
} from "./limits.js";

const logger = pino({ name: "sandbox-isolation" });

// ─── Runtime Contract ─────────────────────────────────────────────────────

export type IsolationKind = "in-process" | "docker" | "firecracker" | "fake";

/**
 * A single unit of work submitted to a runtime. Inputs and outputs are
 * serialized so they can cross a process / container boundary.
 */
export interface SandboxExecutionSpec {
  /** Tool name (used for logging / routing). */
  toolName: string;
  /** Risk level of the tool being executed. */
  riskLevel: ToolRiskLevel;
  /** Marshalled tool input (JSON string). */
  payload: string;
  /** Resource limits to apply to this execution. */
  limits: ResourceLimits;
}

export interface SandboxExecutionResult {
  /** Marshalled tool output (JSON string), if successful. */
  output: string;
  /** Which runtime handled the execution. */
  runtime: IsolationKind;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
}

/**
 * Pluggable execution backend. Adapters (Docker, Firecracker, in-process,
 * fakes) implement this. Implementations receive already-marshalled input and
 * return marshalled output, and must respect the AbortSignal for wall-clock
 * cancellation.
 */
export interface SandboxRuntime {
  readonly kind: IsolationKind;
  /**
   * Whether this runtime is usable in the current environment (e.g. Docker
   * daemon reachable). Selectors fall back when unavailable.
   */
  isAvailable(): Promise<boolean>;
  /**
   * Execute marshalled work. `signal` aborts on wall-clock breach.
   */
  run(spec: SandboxExecutionSpec, signal: AbortSignal): Promise<string>;
}

// ─── Marshalling ──────────────────────────────────────────────────────────

/** Serialize an arbitrary tool input/output to a transport string. */
export function marshal(value: unknown): string {
  return JSON.stringify({ v: 1, data: value ?? null });
}

/** Deserialize a transport string back to a value. Throws on malformed input. */
export function unmarshal<T = unknown>(serialized: string): T {
  let parsed: { v?: number; data?: unknown };
  try {
    parsed = JSON.parse(serialized) as { v?: number; data?: unknown };
  } catch (err) {
    throw new Error(`Failed to unmarshal sandbox payload: ${(err as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null || parsed.v !== 1) {
    throw new Error("Unsupported sandbox payload envelope");
  }
  return parsed.data as T;
}

// ─── Adapters ─────────────────────────────────────────────────────────────

/**
 * Executes work directly in the host process. Used for low-risk tools where
 * isolation overhead is not warranted. The handler computes the result from
 * the marshalled input.
 */
export class InProcessRuntime implements SandboxRuntime {
  readonly kind: IsolationKind = "in-process";

  constructor(
    private readonly handler: (input: unknown, signal: AbortSignal) => Promise<unknown> | unknown
  ) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async run(spec: SandboxExecutionSpec, signal: AbortSignal): Promise<string> {
    const input = unmarshal(spec.payload);
    const output = await this.handler(input, signal);
    return marshal(output);
  }
}

/**
 * In-memory fake runtime for tests. Records every spec it receives and either
 * delegates to a supplied handler or echoes the input back. Can simulate
 * unavailability and slow / hanging executions (which trips wall-clock
 * enforcement).
 */
export class FakeRuntime implements SandboxRuntime {
  readonly kind: IsolationKind;
  readonly calls: SandboxExecutionSpec[] = [];
  available = true;

  constructor(
    private readonly handler?: (input: unknown, signal: AbortSignal) => Promise<unknown> | unknown,
    kind: IsolationKind = "fake"
  ) {
    this.kind = kind;
  }

  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  async run(spec: SandboxExecutionSpec, signal: AbortSignal): Promise<string> {
    this.calls.push(spec);
    const input = unmarshal(spec.payload);
    if (this.handler) {
      const output = await this.handler(input, signal);
      return marshal(output);
    }
    // Default: echo input back as output.
    return marshal(input);
  }
}

// ─── Selector ─────────────────────────────────────────────────────────────

export interface SandboxSelectorOptions {
  /** Runtime for high-risk / critical tools. */
  isolatedRuntime: SandboxRuntime;
  /** Runtime for low / medium-risk tools. */
  inProcessRuntime: SandboxRuntime;
  /** Risk levels that must run in the isolated runtime. */
  isolateRiskLevels?: ToolRiskLevel[];
  /** Default limits applied when a spec doesn't override them. */
  defaultLimits?: ResourceLimits;
  /** Counter incremented on wall-clock breaches. */
  breachCounter?: BreachCounter;
}

const DEFAULT_ISOLATE_LEVELS: ToolRiskLevel[] = ["high", "critical"];

export interface ExecuteOptions {
  /** Per-execution limit overrides. */
  limits?: Partial<ResourceLimits>;
  /** External cancellation signal. */
  signal?: AbortSignal;
}

/**
 * Routes tool executions to the correct runtime by risk level and enforces
 * per-execution wall-clock limits. Pure with respect to runtimes: all
 * execution is delegated to the injected `SandboxRuntime` instances.
 */
export class SandboxSelector {
  private readonly isolated: SandboxRuntime;
  private readonly inProcess: SandboxRuntime;
  private readonly isolateLevels: Set<ToolRiskLevel>;
  private readonly defaultLimits: ResourceLimits;
  private readonly breachCounter?: BreachCounter;

  constructor(options: SandboxSelectorOptions) {
    this.isolated = options.isolatedRuntime;
    this.inProcess = options.inProcessRuntime;
    this.isolateLevels = new Set(options.isolateRiskLevels ?? DEFAULT_ISOLATE_LEVELS);
    this.defaultLimits = options.defaultLimits ?? DEFAULT_RESOURCE_LIMITS;
    this.breachCounter = options.breachCounter;
  }

  /** True if a tool of the given risk level should be isolated. */
  requiresIsolation(riskLevel: ToolRiskLevel): boolean {
    return this.isolateLevels.has(riskLevel);
  }

  /** Pick (without executing) the runtime that would handle this risk level. */
  selectRuntime(riskLevel: ToolRiskLevel): SandboxRuntime {
    return this.requiresIsolation(riskLevel) ? this.isolated : this.inProcess;
  }

  /**
   * Execute a tool call. Marshals the input, routes to the appropriate
   * runtime, enforces the wall-clock limit, and unmarshals the output.
   */
  async execute<TOut = unknown>(
    toolName: string,
    riskLevel: ToolRiskLevel,
    input: unknown,
    options: ExecuteOptions = {}
  ): Promise<{ output: TOut; runtime: IsolationKind; durationMs: number }> {
    const limits = resolveLimits(options.limits, this.defaultLimits);
    let runtime = this.selectRuntime(riskLevel);

    // Fall back to in-process if the isolated runtime is unavailable.
    if (runtime !== this.inProcess && !(await runtime.isAvailable())) {
      logger.warn(
        { toolName, riskLevel, requested: runtime.kind },
        "isolated runtime unavailable — falling back to in-process"
      );
      runtime = this.inProcess;
    }

    const spec: SandboxExecutionSpec = {
      toolName,
      riskLevel,
      payload: marshal(input),
      limits,
    };

    const startTime = Date.now();
    const serializedOutput = await enforceWallClock((signal) => runtime.run(spec, signal), {
      wallClockMs: limits.wallClockMs,
      counter: this.breachCounter,
      signal: options.signal,
    });

    return {
      output: unmarshal<TOut>(serializedOutput),
      runtime: runtime.kind,
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Convenience factory wiring an isolated runtime with an in-process runtime
 * for low-risk handling.
 */
export function createSelector(
  isolatedRuntime: SandboxRuntime,
  inProcessHandler: (input: unknown, signal: AbortSignal) => Promise<unknown> | unknown,
  options?: Omit<SandboxSelectorOptions, "isolatedRuntime" | "inProcessRuntime">
): SandboxSelector {
  return new SandboxSelector({
    isolatedRuntime,
    inProcessRuntime: new InProcessRuntime(inProcessHandler),
    ...options,
  });
}
