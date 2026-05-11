// ─── Tool Executor ─────────────────────────────────────────────────────────

import pino from "pino";
import type { ToolDefinitionRuntime, ToolExecutionContext, ToolResult } from "./registry.js";

const logger = pino({ name: "tool-executor" });

export const TOOL_TIMEOUT_ERROR_CODE = "TOOL_TIMEOUT";

const RISK_TIMEOUT_MS = {
  low: 10_000,
  medium: 30_000,
  high: 60_000,
  critical: 120_000,
} as const;

const toolTimeoutCounts = new Map<string, number>();

/**
 * Execute a tool with timeout handling, input validation, and error wrapping.
 *
 * Returns a ToolResult regardless of success or failure so the agent loop
 * can always feed a result back to the model.
 */
export async function executeTool(
  tool: ToolDefinitionRuntime,
  input: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolResult> {
  const startTime = Date.now();
  const timeout = resolveToolTimeout(tool);

  logger.info(
    { tool: tool.name, sessionId: context.sessionId, timeout },
    "Executing tool"
  );

  // Validate input against Zod schema if available
  if (tool.inputSchema) {
    const parseResult = tool.inputSchema.safeParse(input);
    if (!parseResult.success) {
      const errorMessage = parseResult.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      logger.warn({ tool: tool.name, errors: errorMessage }, "Input validation failed");
      return {
        output: null,
        isError: true,
        errorMessage: `Invalid input: ${errorMessage}`,
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

    const durationMs = Date.now() - startTime;
    logger.info({ tool: tool.name, durationMs }, "Tool execution completed");

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
      toolTimeoutCounts.set(tool.name, (toolTimeoutCounts.get(tool.name) ?? 0) + 1);
    }

    return {
      output: null,
      isError: true,
      errorMessage,
      errorCode: error instanceof ToolTimeoutError ? TOOL_TIMEOUT_ERROR_CODE : undefined,
      durationMs,
    };
  }
}

export function getToolTimeoutMetrics(): Record<string, number> {
  return Object.fromEntries(toolTimeoutCounts);
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
