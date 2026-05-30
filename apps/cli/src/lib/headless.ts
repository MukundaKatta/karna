/**
 * Headless (non-interactive) execution for the Karna CLI.
 *
 * Powers the `karna run` command (issue #613): take a single prompt, execute it
 * against an abstracted runtime client (so it can be tested without a live
 * gateway), and emit a STABLE JSON envelope to stdout with a deterministic
 * shape and proper exit codes.
 *
 * The runtime client is injected so callers (and tests) can supply either a
 * real WebSocket-backed client or a fake one.
 */

// ─── Stable Envelope ──────────────────────────────────────────────────────────

/** Schema version of the JSON envelope. Bump only on breaking changes. */
export const HEADLESS_ENVELOPE_VERSION = 1 as const;

/** Process exit codes for the headless run path. Stable contract. */
export const HEADLESS_EXIT_CODES = {
  success: 0,
  /** The agent ran but reported an error finish/explicit error. */
  agentError: 1,
  /** Bad CLI usage (e.g. empty prompt). */
  usage: 2,
  /** Connection / transport failure before a response was produced. */
  connection: 3,
  /** The run exceeded the configured timeout. */
  timeout: 4,
} as const;

export type HeadlessStatus = "ok" | "error" | "timeout";

export interface HeadlessToolEvent {
  toolName: string;
  isError: boolean;
  durationMs?: number;
}

export interface HeadlessUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface HeadlessEnvelope {
  /** Always present so consumers can branch on schema changes. */
  version: typeof HEADLESS_ENVELOPE_VERSION;
  status: HeadlessStatus;
  /** Assistant text output (empty string on error/timeout). */
  output: string;
  /** Finish reason reported by the agent, when available. */
  finishReason: string | null;
  sessionId: string;
  /** Tools that were executed during the run, in order. */
  tools: HeadlessToolEvent[];
  usage: HeadlessUsage | null;
  /** Human-readable error message when status !== "ok". */
  error: string | null;
  /** Wall-clock duration of the run in milliseconds. */
  durationMs: number;
}

// ─── Runtime Client Abstraction ──────────────────────────────────────────────

/**
 * Result of a single headless prompt execution as produced by a runtime client.
 * Transport-agnostic: a WebSocket client and an in-memory fake both produce this.
 */
export interface HeadlessRunResult {
  output: string;
  finishReason: string | null;
  tools: HeadlessToolEvent[];
  usage: HeadlessUsage | null;
  /** When set, the run is considered an agent-level error. */
  error?: string | null;
}

export interface HeadlessRuntimeClient {
  /** The session id used for this run (stable for the envelope). */
  readonly sessionId: string;
  /** Execute a single prompt and resolve with the aggregated result. */
  run(prompt: string, signal?: AbortSignal): Promise<HeadlessRunResult>;
  /** Release any held resources (sockets, timers). Safe to call multiple times. */
  close(): void;
}

// ─── Options ──────────────────────────────────────────────────────────────────

export interface RunHeadlessOptions {
  prompt: string;
  client: HeadlessRuntimeClient;
  /** Overall timeout in milliseconds. Defaults to 120_000. */
  timeoutMs?: number;
  /** Injected clock for testability. Defaults to Date.now. */
  now?: () => number;
}

export interface RunHeadlessResult {
  envelope: HeadlessEnvelope;
  exitCode: number;
}

// ─── Core Logic ───────────────────────────────────────────────────────────────

export const DEFAULT_HEADLESS_TIMEOUT_MS = 120_000;

/**
 * Validate a prompt for headless use. Returns a trimmed prompt or an error
 * message describing why it is unusable.
 */
export function validatePrompt(prompt: string | undefined | null): { ok: true; prompt: string } | { ok: false; error: string } {
  if (prompt == null) {
    return { ok: false, error: "No prompt provided" };
  }
  const trimmed = prompt.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Prompt is empty" };
  }
  const MAX_INPUT_LENGTH = 32_000;
  if (trimmed.length > MAX_INPUT_LENGTH) {
    return { ok: false, error: `Prompt too long (${trimmed.length} chars). Maximum is ${MAX_INPUT_LENGTH}.` };
  }
  return { ok: true, prompt: trimmed };
}

/**
 * Execute a prompt headlessly against an injected runtime client and produce a
 * stable envelope plus a process exit code. Never throws for expected failure
 * modes (connection/timeout/agent error) — they are encoded in the envelope.
 */
export async function runHeadless(options: RunHeadlessOptions): Promise<RunHeadlessResult> {
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? DEFAULT_HEADLESS_TIMEOUT_MS;
  const start = now();

  const validation = validatePrompt(options.prompt);
  if (!validation.ok) {
    options.client.close();
    return {
      envelope: makeEnvelope({
        status: "error",
        sessionId: options.client.sessionId,
        error: validation.error,
        durationMs: 0,
      }),
      exitCode: HEADLESS_EXIT_CODES.usage,
    };
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  // Don't keep the event loop alive solely for this timer.
  if (typeof timer === "object" && timer && "unref" in timer) {
    (timer as { unref: () => void }).unref();
  }

  try {
    const result = await options.client.run(validation.prompt, controller.signal);

    if (timedOut) {
      return finishTimeout(options.client.sessionId, now() - start);
    }

    const isError = Boolean(result.error);
    return {
      envelope: makeEnvelope({
        status: isError ? "error" : "ok",
        output: isError ? "" : result.output,
        finishReason: result.finishReason,
        sessionId: options.client.sessionId,
        tools: result.tools,
        usage: result.usage,
        error: result.error ?? null,
        durationMs: now() - start,
      }),
      exitCode: isError ? HEADLESS_EXIT_CODES.agentError : HEADLESS_EXIT_CODES.success,
    };
  } catch (error) {
    if (timedOut) {
      return finishTimeout(options.client.sessionId, now() - start);
    }
    return {
      envelope: makeEnvelope({
        status: "error",
        sessionId: options.client.sessionId,
        error: error instanceof Error ? error.message : String(error),
        durationMs: now() - start,
      }),
      exitCode: HEADLESS_EXIT_CODES.connection,
    };
  } finally {
    clearTimeout(timer);
    options.client.close();
  }
}

function finishTimeout(sessionId: string, durationMs: number): RunHeadlessResult {
  return {
    envelope: makeEnvelope({
      status: "timeout",
      sessionId,
      error: "Run timed out before the agent responded",
      durationMs,
    }),
    exitCode: HEADLESS_EXIT_CODES.timeout,
  };
}

/** Build a complete, deterministically-ordered envelope from partial fields. */
export function makeEnvelope(partial: {
  status: HeadlessStatus;
  sessionId: string;
  output?: string;
  finishReason?: string | null;
  tools?: HeadlessToolEvent[];
  usage?: HeadlessUsage | null;
  error?: string | null;
  durationMs: number;
}): HeadlessEnvelope {
  return {
    version: HEADLESS_ENVELOPE_VERSION,
    status: partial.status,
    output: partial.output ?? "",
    finishReason: partial.finishReason ?? null,
    sessionId: partial.sessionId,
    tools: partial.tools ?? [],
    usage: partial.usage ?? null,
    error: partial.error ?? null,
    durationMs: partial.durationMs,
  };
}

/** Serialize an envelope as a single-line stable JSON string (sorted keys). */
export function serializeEnvelope(envelope: HeadlessEnvelope, pretty = false): string {
  // Key order is fixed by construction below so output is stable across runs.
  const ordered = {
    version: envelope.version,
    status: envelope.status,
    output: envelope.output,
    finishReason: envelope.finishReason,
    sessionId: envelope.sessionId,
    tools: envelope.tools.map((t) => ({
      toolName: t.toolName,
      isError: t.isError,
      ...(t.durationMs !== undefined ? { durationMs: t.durationMs } : {}),
    })),
    usage: envelope.usage
      ? { inputTokens: envelope.usage.inputTokens, outputTokens: envelope.usage.outputTokens }
      : null,
    error: envelope.error,
    durationMs: envelope.durationMs,
  };
  return pretty ? JSON.stringify(ordered, null, 2) : JSON.stringify(ordered);
}
