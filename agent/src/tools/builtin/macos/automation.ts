// ─── macOS Automation Tools (AppleScript & Shortcuts) ──────────────────────

import { execFile } from "node:child_process";
import { z } from "zod";
import type { ToolDefinitionRuntime, ToolExecutionContext } from "../../registry.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const APPLESCRIPT_TIMEOUT_MS = 30_000;

// ─── Helpers ───────────────────────────────────────────────────────────────

function assertMacOS(): void {
  if (process.platform !== "darwin") {
    throw new Error("This tool is only available on macOS");
  }
}

function runExecFile(
  cmd: string,
  args: string[],
  timeout = DEFAULT_TIMEOUT_MS
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 2_000_000 }, (error, stdout, stderr) => {
      if (error && (error as NodeJS.ErrnoException & { killed?: boolean }).killed) {
        reject(new Error(`Command timed out after ${timeout}ms`));
        return;
      }
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

// ─── mac_run_applescript ───────────────────────────────────────────────────

const RunAppleScriptInputSchema = z.object({
  script: z.string().min(1).describe("AppleScript code to execute"),
  timeout: z
    .number()
    .int()
    .positive()
    .max(60_000)
    .optional()
    .default(APPLESCRIPT_TIMEOUT_MS)
    .describe("Timeout in milliseconds (default 30000, max 60000)"),
});

export const macRunAppleScriptTool: ToolDefinitionRuntime = {
  name: "mac_run_applescript",
  description:
    "Execute an AppleScript and return its output. " +
    "AppleScript can control applications, automate workflows, display dialogs, and interact with the macOS system. " +
    "WARNING: AppleScript has full system access — use with care.",
  parameters: {
    type: "object",
    properties: {
      script: { type: "string", description: "AppleScript code to execute" },
      timeout: {
        type: "integer",
        description: "Timeout in milliseconds (default 30000, max 60000)",
        maximum: 60_000,
      },
    },
    required: ["script"],
  },
  inputSchema: RunAppleScriptInputSchema,
  riskLevel: "high",
  requiresApproval: true,
  timeout: 60_000,
  tags: ["macos", "automation", "applescript"],

  async execute(input: Record<string, unknown>): Promise<unknown> {
    assertMacOS();
    const parsed = RunAppleScriptInputSchema.parse(input);

    try {
      const { stdout, stderr } = await runExecFile(
        "osascript",
        ["-e", parsed.script],
        parsed.timeout
      );

      const result = stdout.trim();
      return {
        output: result || "(no output)",
        isError: false,
        stderr: stderr.trim() || undefined,
      };
    } catch (err) {
      return {
        output: `AppleScript error: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  },
};

// ─── mac_run_shortcut ──────────────────────────────────────────────────────

const RunShortcutInputSchema = z.object({
  name: z.string().min(1).describe("Name of the Siri Shortcut to run"),
  input: z.string().optional().describe("Text input to pass to the shortcut"),
});

export const macRunShortcutTool: ToolDefinitionRuntime = {
  name: "mac_run_shortcut",
  description:
    "Run a Siri Shortcut by name. Optionally provide text input for the shortcut. " +
    "Requires macOS 12+ with the Shortcuts app installed.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Name of the Siri Shortcut to run" },
      input: { type: "string", description: "Text input to pass to the shortcut" },
    },
    required: ["name"],
  },
  inputSchema: RunShortcutInputSchema,
  riskLevel: "medium",
  requiresApproval: true,
  timeout: 30_000,
  tags: ["macos", "automation", "shortcuts"],

  async execute(input: Record<string, unknown>): Promise<unknown> {
    assertMacOS();
    const parsed = RunShortcutInputSchema.parse(input);

    const args = ["run", parsed.name];
    if (parsed.input) {
      args.push("--input-type", "text", "--input", parsed.input);
    }

    try {
      const { stdout, stderr } = await runExecFile("shortcuts", args, 30_000);
      return {
        output: stdout.trim() || `Shortcut "${parsed.name}" executed successfully`,
        isError: false,
        stderr: stderr.trim() || undefined,
      };
    } catch (err) {
      return {
        output: `Failed to run shortcut "${parsed.name}": ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  },
};

// ─── mac_get_shortcuts ─────────────────────────────────────────────────────

const GetShortcutsInputSchema = z.object({});

export const macGetShortcutsTool: ToolDefinitionRuntime = {
  name: "mac_get_shortcuts",
  description:
    "List all available Siri Shortcuts on this Mac. " +
    "Requires macOS 12+ with the Shortcuts app installed.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  inputSchema: GetShortcutsInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: DEFAULT_TIMEOUT_MS,
  tags: ["macos", "automation", "shortcuts"],

  async execute(): Promise<unknown> {
    assertMacOS();

    try {
      const { stdout } = await runExecFile("shortcuts", ["list"]);
      const shortcuts = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      return {
        output: shortcuts.length > 0 ? shortcuts.join("\n") : "No shortcuts found",
        isError: false,
        shortcuts,
        count: shortcuts.length,
      };
    } catch (err) {
      return {
        output: `Failed to list shortcuts: ${err instanceof Error ? err.message : String(err)}. Ensure macOS 12+ and Shortcuts app is installed.`,
        isError: true,
      };
    }
  },
};
