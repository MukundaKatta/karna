// ─── Tool Executor ─────────────────────────────────────────────────────────

import pino from "pino";
import type { ToolDefinitionRuntime, ToolExecutionContext, ToolResult } from "./registry.js";
import { validateToolInput, validateToolOutput } from "./validation.js";
import type { ToolRateLimiter } from "./rate-limiter.js";
import type { ToolResultCache } from "./result-cache.js";

const logger = pino({ name: "tool-executor" });

/**
 * Optional execution features. All are opt-in: when omitted, `executeTool`
 * behaves exactly as before. (Issues #547, #552, #548)
 */
export interface ExecuteToolOptions {
  /** Per-tool rate limiter / concurrency gate (Issue #552). */
  rateLimiter?: ToolRateLimiter;
  /** Per-tool TTL result cache (Issue #548). */
  cache?: ToolResultCache;
  /**
   * When true, validate the tool output against `outputSchema` and treat a
   * mismatch as an error (Issue #547). Default false (no behavior change).
   */
  validateOutput?: boolean;
}

export const TOOL_TIMEOUT_ERROR_CODE = "TOOL_TIMEOUT";
export const TOOL_RATE_LIMITED_ERROR_CODE = "TOOL_RATE_LIMITED";

const RISK_TIMEOUT_MS = {
  low: 10_000,
  medium: 30_000,
  high: 60_000,
  critical: 120_000,
} as const;

const toolTimeoutCounts = new Map<string, { count: number; timestamp: number }>();

/**
 * Execute a tool with timeout handling, input validation, and error wrapping.
 *
 * Returns a ToolResult regardless of success or failure so the agent loop
 * can always feed a result back to the model.
 */
export async function executeTool(
  tool: ToolDefinitionRuntime,
  input: Record<string, unknown>,
  context: ToolExecutionContext,
  options: ExecuteToolOptions = {}
): Promise<ToolResult> {
  const startTime = Date.now();
  const timeout = resolveToolTimeout(tool);

  logger.info(
    { tool: tool.name, sessionId: context.sessionId, timeout },
    "Executing tool"
  );

  // Validate input against Zod schema if available (Issue #547).
  // Structured validation returns a model-friendly message; behavior is
  // unchanged for tools without an inputSchema (pass-through).
  if (tool.inputSchema) {
    const validation = validateToolInput(tool, input);
    if (!validation.ok) {
      return {
        output: null,
        isError: true,
        errorMessage: validation.error,
        durationMs: Date.now() - startTime,
      };
    }
  }

  // Result cache lookup (Issue #548). No-op unless the tool opted in.
  if (options.cache?.isEnabled(tool.name)) {
    const cached = options.cache.get(tool.name, input);
    if (cached.hit) {
      const durationMs = Date.now() - startTime;
      logger.info({ tool: tool.name, durationMs }, "Tool result cache hit");
      return { output: cached.value, isError: false, durationMs };
    }
  }

  // Acquire a rate-limit token / concurrency slot (Issue #552). Returns a
  // no-op lease for unconfigured tools.
  let lease: { release(): void } | undefined;
  if (options.rateLimiter) {
    try {
      lease = await options.rateLimiter.acquire(tool.name, context.signal);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn({ tool: tool.name, error: errorMessage }, "Rate limit acquire failed");
      return {
        output: null,
        isError: true,
        errorMessage,
        errorCode: TOOL_RATE_LIMITED_ERROR_CODE,
        durationMs: Date.now() - startTime,
      };
    }
  }

  try {
    const result = await executeWithTimeout(
      (signal) => tool.execute(input, { ...context, signal }),
      timeout,
      tool.name
    );

    // Optional output validation (Issue #547).
    if (options.validateOutput && tool.outputSchema) {
      const outValidation = validateToolOutput(tool, result);
      if (!outValidation.ok) {
        return {
          output: null,
          isError: true,
          errorMessage: outValidation.error,
          durationMs: Date.now() - startTime,
        };
      }
    }

    const durationMs = Date.now() - startTime;
    logger.info({ tool: tool.name, durationMs }, "Tool execution completed");

    // Store in cache on success (Issue #548). No-op unless opted in.
    if (options.cache?.isEnabled(tool.name)) {
      options.cache.set(tool.name, input, result);
    }

    return {
      output: result,
      isError: false,
      durationMs,
    };
  } catch (error: unknown) {
    const durationMs = Date.now() - startTime;
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    logger.error(
      { tool: tool.name, error: errorMessage, durationMs },
      "Tool execution failed"
    );

    if (error instanceof ToolTimeoutError) {
      if (toolTimeoutCounts.size > 500) {
        const oneHourAgo = Date.now() - 60 * 60 * 1000;
        for (const [key, entry] of toolTimeoutCounts) {
          if (entry.timestamp < oneHourAgo) {
            toolTimeoutCounts.delete(key);
          }
        }
        // If still over limit after age-based eviction, clear entirely
        if (toolTimeoutCounts.size > 500) {
          logger.warn("toolTimeoutCounts map exceeded max size after eviction, clearing");
          toolTimeoutCounts.clear();
        }
      }
      const existing = toolTimeoutCounts.get(tool.name);
      toolTimeoutCounts.set(tool.name, {
        count: (existing?.count ?? 0) + 1,
        timestamp: Date.now(),
      });
    }

    return {
      output: null,
      isError: true,
      errorMessage,
      errorCode: error instanceof ToolTimeoutError ? TOOL_TIMEOUT_ERROR_CODE : undefined,
      durationMs,
    };
  } finally {
    // Always release the rate-limit/concurrency slot if one was acquired.
    lease?.release();
  }
}

export function getToolTimeoutMetrics(): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, entry] of toolTimeoutCounts) {
    result[key] = entry.count;
  }
  return result;
}

export function resetToolTimeoutMetricsForTests(): void {
  toolTimeoutCounts.clear();
}

export function resolveToolTimeout(tool: ToolDefinitionRuntime): number {
  return tool.timeout > 0 ? tool.timeout : RISK_TIMEOUT_MS[tool.riskLevel];
}

/**
 * Execute an async function with a timeout. Rejects with a descriptive
 * error if the operation exceeds the allowed duration.
 */
async function executeWithTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  toolName: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new ToolTimeoutError(toolName, timeoutMs));
      reject(new ToolTimeoutError(toolName, timeoutMs));
    }, timeoutMs);

    fn(controller.signal)
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

// ─── Errors ───────────────────────────────────────────────────────────────

export class ToolTimeoutError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly timeoutMs: number
  ) {
    super(`Tool "${toolName}" timed out after ${timeoutMs}ms`);
    this.name = "ToolTimeoutError";
  }
}

export class ToolExecutionError extends Error {
  constructor(
    public readonly toolName: string,
    message: string,
    public override readonly cause?: unknown
  ) {
    super(`Tool "${toolName}" failed: ${message}`);
    this.name = "ToolExecutionError";
  }
}
