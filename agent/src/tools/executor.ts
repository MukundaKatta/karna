// ─── Tool Executor ─────────────────────────────────────────────────────────

import pino from "pino";
import type { ToolDefinitionRuntime, ToolExecutionContext, ToolResult } from "./registry.js";

const logger = pino({ name: "tool-executor" });

const DEFAULT_TIMEOUT_MS = 30_000;

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
  const timeout = tool.timeout ?? DEFAULT_TIMEOUT_MS;

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
      () => tool.execute(input, context),
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

    return {
      output: null,
      isError: true,
      errorMessage,
      durationMs,
    };
  }
}

/**
 * Execute an async function with a timeout. Rejects with a descriptive
 * error if the operation exceeds the allowed duration.
 */
async function executeWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  toolName: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new ToolTimeoutError(toolName, timeoutMs));
    }, timeoutMs);

    fn()
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
