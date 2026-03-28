// ─── macOS App Control Tools ───────────────────────────────────────────────

import { execFile } from "node:child_process";
import { z } from "zod";
import type { ToolDefinitionRuntime, ToolExecutionContext } from "../../registry.js";

const DEFAULT_TIMEOUT_MS = 10_000;

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
    execFile(cmd, args, { timeout, maxBuffer: 1_000_000 }, (error, stdout, stderr) => {
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

function runOsascript(script: string, timeout = DEFAULT_TIMEOUT_MS): Promise<string> {
  return runExecFile("osascript", ["-e", script], timeout).then((r) => r.stdout.trim());
}

// ─── mac_open_app ──────────────────────────────────────────────────────────

const OpenAppInputSchema = z.object({
  name: z.string().min(1).describe("Application name to open (e.g. 'Safari', 'Visual Studio Code')"),
});

export const macOpenAppTool: ToolDefinitionRuntime = {
  name: "mac_open_app",
  description:
    "Open a macOS application by name. Uses the `open -a` command to launch applications.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Application name to open" },
    },
    required: ["name"],
  },
  inputSchema: OpenAppInputSchema,
  riskLevel: "medium",
  requiresApproval: false,
  timeout: DEFAULT_TIMEOUT_MS,
  tags: ["macos", "apps"],

  async execute(input: Record<string, unknown>): Promise<unknown> {
    assertMacOS();
    const parsed = OpenAppInputSchema.parse(input);

    await runExecFile("open", ["-a", parsed.name]);
    return { output: `Opened application: ${parsed.name}`, isError: false, durationMs: 0 };
  },
};

// ─── mac_list_apps ─────────────────────────────────────────────────────────

const ListAppsInputSchema = z.object({});

export const macListAppsTool: ToolDefinitionRuntime = {
  name: "mac_list_apps",
  description:
    "List all currently running macOS applications with their names and process IDs.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  inputSchema: ListAppsInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: DEFAULT_TIMEOUT_MS,
  tags: ["macos", "apps"],

  async execute(): Promise<unknown> {
    assertMacOS();

    const script = `
      set appList to ""
      tell application "System Events"
        set runningApps to every application process whose background only is false
        repeat with anApp in runningApps
          set appList to appList & name of anApp & " (pid: " & unix id of anApp & ")" & linefeed
        end repeat
      end tell
      return appList
    `;

    const result = await runOsascript(script);
    const apps = result
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    return { output: apps.join("\n"), isError: false, apps, count: apps.length };
  },
};

// ─── mac_quit_app ──────────────────────────────────────────────────────────

const QuitAppInputSchema = z.object({
  name: z.string().min(1).describe("Application name to quit"),
  force: z.boolean().optional().default(false).describe("Force quit the application"),
});

export const macQuitAppTool: ToolDefinitionRuntime = {
  name: "mac_quit_app",
  description:
    "Quit a running macOS application by name. Optionally force-quit if the app is unresponsive.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Application name to quit" },
      force: { type: "boolean", description: "Force quit the application" },
    },
    required: ["name"],
  },
  inputSchema: QuitAppInputSchema,
  riskLevel: "medium",
  requiresApproval: true,
  timeout: DEFAULT_TIMEOUT_MS,
  tags: ["macos", "apps"],

  async execute(input: Record<string, unknown>): Promise<unknown> {
    assertMacOS();
    const parsed = QuitAppInputSchema.parse(input);

    const action = parsed.force ? "force quit" : "quit";
    const script = `tell application "${parsed.name}" to ${action}`;

    try {
      await runOsascript(script);
      return { output: `${parsed.force ? "Force-quit" : "Quit"} application: ${parsed.name}`, isError: false, durationMs: 0 };
    } catch (err) {
      return {
        output: `Failed to ${action} ${parsed.name}: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  },
};

// ─── mac_focus_app ─────────────────────────────────────────────────────────

const FocusAppInputSchema = z.object({
  name: z.string().min(1).describe("Application name to bring to front"),
});

export const macFocusAppTool: ToolDefinitionRuntime = {
  name: "mac_focus_app",
  description:
    "Bring a running macOS application to the front (activate it). The app must already be running.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Application name to bring to front" },
    },
    required: ["name"],
  },
  inputSchema: FocusAppInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: DEFAULT_TIMEOUT_MS,
  tags: ["macos", "apps"],

  async execute(input: Record<string, unknown>): Promise<unknown> {
    assertMacOS();
    const parsed = FocusAppInputSchema.parse(input);

    const script = `
      tell application "${parsed.name}"
        activate
      end tell
    `;

    try {
      await runOsascript(script);
      return { output: `Focused application: ${parsed.name}`, isError: false, durationMs: 0 };
    } catch (err) {
      return {
        output: `Failed to focus ${parsed.name}: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  },
};
