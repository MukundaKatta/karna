// ─── Shell Execution Tool ──────────────────────────────────────────────────

import { exec } from "node:child_process";
import { z } from "zod";
import type { ToolDefinitionRuntime, ToolExecutionContext } from "../registry.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_LENGTH = 50_000;

const ShellInputSchema = z.object({
  command: z.string().min(1).describe("The shell command to execute"),
  cwd: z
    .string()
    .optional()
    .describe("Working directory for the command. Defaults to the agent working directory."),
  timeout: z
    .number()
    .int()
    .positive()
    .max(120_000)
    .optional()
    .describe("Timeout in milliseconds (max 120000)"),
  elevated: z
    .boolean()
    .optional()
    .describe("Run with elevated privileges (sudo). Requires elevated mode to be enabled per-session."),
});

// Per-session elevated mode state
const elevatedSessions = new Set<string>();

/**
 * Enable or disable elevated bash mode for a session.
 * When enabled, shell commands can use sudo.
 */
export function setElevatedMode(sessionId: string, enabled: boolean): void {
  if (enabled) {
    elevatedSessions.add(sessionId);
  } else {
    elevatedSessions.delete(sessionId);
  }
}

/**
 * Execute shell commands with stdout/stderr capture.
 *
 * Risk level: HIGH - shell commands can have destructive side effects.
 * Always requires human approval in the default configuration.
 */
export const shellTool: ToolDefinitionRuntime = {
  name: "shell_exec",
  description:
    "Execute a shell command and return its stdout and stderr. " +
    "Use for running scripts, installing packages, checking system state, etc. " +
    "Commands run in a non-interactive shell (bash).",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The shell command to execute",
      },
      cwd: {
        type: "string",
        description: "Working directory for the command",
      },
      timeout: {
        type: "integer",
        description: "Timeout in milliseconds (max 120000)",
        maximum: 120_000,
      },
      elevated: {
        type: "boolean",
        description: "Run with sudo (requires elevated mode enabled)",
      },
    },
    required: ["command"],
  },
  inputSchema: ShellInputSchema,
  riskLevel: "high",
  requiresApproval: true,
  timeout: 120_000,
  tags: ["system", "shell"],

  async execute(
    input: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = ShellInputSchema.parse(input);
    const timeout = parsed.timeout ?? DEFAULT_TIMEOUT_MS;
    const cwd = parsed.cwd ?? context.workingDirectory ?? process.cwd();

    // Check elevated mode
    let command = parsed.command;
    if (parsed.elevated) {
      if (!elevatedSessions.has(context.sessionId)) {
        return {
          exitCode: -1,
          stdout: "",
          stderr: "Elevated mode is not enabled for this session. Use /elevated on to enable.",
          error: "Elevated mode not enabled",
          timedOut: false,
        };
      }
      command = `sudo ${command}`;
    }

    return new Promise((resolve, reject) => {
      const child = exec(
        command,
        {
          cwd,
          timeout,
          maxBuffer: MAX_OUTPUT_LENGTH * 2,
          env: {
            ...process.env,
            // Prevent interactive prompts
            DEBIAN_FRONTEND: "noninteractive",
            GIT_TERMINAL_PROMPT: "0",
          },
        },
        (error, stdout, stderr) => {
          const truncatedStdout = truncateOutput(stdout);
          const truncatedStderr = truncateOutput(stderr);

          if (error && error.killed) {
            resolve({
              exitCode: -1,
              stdout: truncatedStdout,
              stderr: truncatedStderr,
              error: `Command timed out after ${timeout}ms`,
              timedOut: true,
            });
            return;
          }

          resolve({
            exitCode: error?.code ?? 0,
            stdout: truncatedStdout,
            stderr: truncatedStderr,
            timedOut: false,
          });
        }
      );

      // Safety: kill the child if something goes wrong
      child.on("error", (err) => {
        reject(new Error(`Failed to start command: ${err.message}`));
      });
    });
  },
};

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_LENGTH) return output;
  const half = Math.floor(MAX_OUTPUT_LENGTH / 2);
  return (
    output.slice(0, half) +
    `\n\n... [truncated ${output.length - MAX_OUTPUT_LENGTH} characters] ...\n\n` +
    output.slice(-half)
  );
}
