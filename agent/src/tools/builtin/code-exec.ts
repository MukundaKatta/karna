// ─── Sandboxed Code Execution Tool ────────────────────────────────────────

import { fork } from "node:child_process";
import { writeFile, unlink, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import pino from "pino";
import type { ToolDefinitionRuntime, ToolExecutionContext } from "../registry.js";

const logger = pino({ name: "tool-code-exec" });

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_MEMORY_MB = 256;
const MAX_OUTPUT_LENGTH = 50_000;

const CodeExecInputSchema = z.object({
  code: z.string().min(1).describe("JavaScript or TypeScript code to execute"),
  language: z
    .enum(["javascript", "typescript"])
    .optional()
    .default("javascript")
    .describe("Language of the code (default: javascript)"),
  timeout: z
    .number()
    .int()
    .positive()
    .max(MAX_TIMEOUT_MS)
    .optional()
    .default(DEFAULT_TIMEOUT_MS)
    .describe("Execution timeout in milliseconds (max 120000)"),
  memoryMB: z
    .number()
    .int()
    .positive()
    .max(1024)
    .optional()
    .default(DEFAULT_MEMORY_MB)
    .describe("Memory limit in megabytes (max 1024)"),
});

/**
 * Execute JavaScript/TypeScript code in an isolated child process.
 *
 * Risk level: HIGH - arbitrary code execution.
 * Always requires human approval in the default configuration.
 */
export const codeExecTool: ToolDefinitionRuntime = {
  name: "code_exec",
  description:
    "Execute JavaScript or TypeScript code in a sandboxed child process. " +
    "Captures stdout, stderr, and the return value of the last expression. " +
    "Useful for computations, data transformations, and testing code snippets.",
  parameters: {
    type: "object",
    properties: {
      code: { type: "string", description: "JavaScript or TypeScript code to execute" },
      language: {
        type: "string",
        enum: ["javascript", "typescript"],
        description: "Language of the code (default: javascript)",
      },
      timeout: {
        type: "integer",
        description: "Execution timeout in milliseconds (max 120000)",
        maximum: MAX_TIMEOUT_MS,
      },
      memoryMB: {
        type: "integer",
        description: "Memory limit in megabytes (max 1024)",
        maximum: 1024,
      },
    },
    required: ["code"],
  },
  inputSchema: CodeExecInputSchema,
  riskLevel: "high",
  requiresApproval: true,
  timeout: MAX_TIMEOUT_MS + 5_000,
  tags: ["code", "execution", "sandbox"],

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = CodeExecInputSchema.parse(input);

    // Create a temporary file for the code
    const tempDir = await mkdtemp(join(tmpdir(), "karna-exec-"));
    const ext = parsed.language === "typescript" ? ".mts" : ".mjs";
    const codePath = join(tempDir, `script${ext}`);

    // Wrap code to capture the return value
    const wrappedCode = `
const __capturedLogs = [];
const __originalLog = console.log;
const __originalError = console.error;
const __originalWarn = console.warn;

console.log = (...args) => { __capturedLogs.push({ level: 'log', args: args.map(String) }); __originalLog(...args); };
console.error = (...args) => { __capturedLogs.push({ level: 'error', args: args.map(String) }); __originalError(...args); };
console.warn = (...args) => { __capturedLogs.push({ level: 'warn', args: args.map(String) }); __originalWarn(...args); };

async function __execute() {
  ${parsed.code}
}

__execute()
  .then((result) => {
    process.send?.({ type: 'result', value: result !== undefined ? String(result) : undefined, logs: __capturedLogs });
  })
  .catch((err) => {
    process.send?.({ type: 'error', message: err?.message ?? String(err), stack: err?.stack, logs: __capturedLogs });
  });
`;

    await writeFile(codePath, wrappedCode, "utf-8");

    try {
      return await executeInChildProcess(codePath, parsed.timeout, parsed.memoryMB, parsed.language);
    } finally {
      // Clean up temp files
      await unlink(codePath).catch(() => {});
    }
  },
};

function executeInChildProcess(
  codePath: string,
  timeout: number,
  memoryMB: number,
  language: string
): Promise<unknown> {
  return new Promise((resolve) => {
    const execArgv: string[] = [
      `--max-old-space-size=${memoryMB}`,
      "--no-warnings",
    ];

    // For TypeScript, we need tsx or ts-node loader
    if (language === "typescript") {
      execArgv.push("--import=tsx");
    }

    const startTime = Date.now();
    let stdout = "";
    let stderr = "";
    let resolved = false;

    const child = fork(codePath, [], {
      execArgv,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      timeout,
      env: {
        ...process.env,
        NODE_ENV: "sandbox",
      },
    });

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
      if (stdout.length > MAX_OUTPUT_LENGTH) {
        stdout = stdout.slice(0, MAX_OUTPUT_LENGTH) + "\n...[truncated]";
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
      if (stderr.length > MAX_OUTPUT_LENGTH) {
        stderr = stderr.slice(0, MAX_OUTPUT_LENGTH) + "\n...[truncated]";
      }
    });

    child.on("message", (msg: any) => {
      if (resolved) return;
      resolved = true;

      const durationMs = Date.now() - startTime;

      if (msg.type === "result") {
        resolve({
          success: true,
          returnValue: msg.value,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          logs: msg.logs,
          durationMs,
        });
      } else if (msg.type === "error") {
        resolve({
          success: false,
          error: msg.message,
          stack: msg.stack,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          logs: msg.logs,
          durationMs,
        });
      }
    });

    child.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      resolve({
        success: false,
        error: `Process error: ${err.message}`,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        durationMs: Date.now() - startTime,
      });
    });

    child.on("exit", (code, signal) => {
      if (resolved) return;
      resolved = true;

      const durationMs = Date.now() - startTime;
      const timedOut = signal === "SIGTERM";

      resolve({
        success: code === 0,
        exitCode: code,
        signal,
        timedOut,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        error: timedOut ? `Execution timed out after ${timeout}ms` : undefined,
        durationMs,
      });
    });

    // Safety timeout slightly beyond the child timeout
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.kill("SIGKILL");
        resolve({
          success: false,
          error: `Execution forcefully killed after ${timeout + 5000}ms`,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          timedOut: true,
          durationMs: Date.now() - startTime,
        });
      }
    }, timeout + 5000);
  });
}
