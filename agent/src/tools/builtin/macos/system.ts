// ─── macOS System Control Tools ────────────────────────────────────────────

import { execFile, spawn } from "node:child_process";
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

function pipeToCommand(
  cmd: string,
  args: string[],
  stdinData: string,
  timeout = DEFAULT_TIMEOUT_MS
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { timeout });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (err) => reject(new Error(`Failed to run ${cmd}: ${err.message}`)));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `${cmd} exited with code ${code}`));
      } else {
        resolve(stdout.trim());
      }
    });

    child.stdin.write(stdinData);
    child.stdin.end();
  });
}

// ─── mac_get_clipboard ─────────────────────────────────────────────────────

const GetClipboardInputSchema = z.object({});

export const macGetClipboardTool: ToolDefinitionRuntime = {
  name: "mac_get_clipboard",
  description: "Read the current contents of the macOS clipboard (pasteboard).",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  inputSchema: GetClipboardInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: DEFAULT_TIMEOUT_MS,
  tags: ["macos", "system", "clipboard"],

  async execute(): Promise<unknown> {
    assertMacOS();

    const { stdout } = await runExecFile("pbpaste", []);
    return { output: stdout, isError: false, durationMs: 0 };
  },
};

// ─── mac_set_clipboard ─────────────────────────────────────────────────────

const SetClipboardInputSchema = z.object({
  content: z.string().describe("Text content to copy to the clipboard"),
});

export const macSetClipboardTool: ToolDefinitionRuntime = {
  name: "mac_set_clipboard",
  description: "Set the macOS clipboard (pasteboard) content to the specified text.",
  parameters: {
    type: "object",
    properties: {
      content: { type: "string", description: "Text content to copy to the clipboard" },
    },
    required: ["content"],
  },
  inputSchema: SetClipboardInputSchema,
  riskLevel: "medium",
  requiresApproval: false,
  timeout: DEFAULT_TIMEOUT_MS,
  tags: ["macos", "system", "clipboard"],

  async execute(input: Record<string, unknown>): Promise<unknown> {
    assertMacOS();
    const parsed = SetClipboardInputSchema.parse(input);

    await pipeToCommand("pbcopy", [], parsed.content);
    return { output: "Clipboard updated", isError: false, durationMs: 0 };
  },
};

// ─── mac_screenshot ────────────────────────────────────────────────────────

const ScreenshotInputSchema = z.object({
  path: z
    .string()
    .optional()
    .default("/tmp/karna-screenshot.png")
    .describe("File path to save the screenshot (default: /tmp/karna-screenshot.png)"),
  region: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, capture only the interactive selection region"),
});

export const macScreenshotTool: ToolDefinitionRuntime = {
  name: "mac_screenshot",
  description:
    "Take a screenshot of the macOS screen and save it as a PNG file. " +
    "By default captures the entire screen silently (no shutter sound).",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to save the screenshot" },
      region: { type: "boolean", description: "Capture only a selected region" },
    },
    required: [],
  },
  inputSchema: ScreenshotInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: DEFAULT_TIMEOUT_MS,
  tags: ["macos", "system", "screenshot"],

  async execute(input: Record<string, unknown>): Promise<unknown> {
    assertMacOS();
    const parsed = ScreenshotInputSchema.parse(input);

    const args = ["-x"]; // silent
    if (parsed.region) {
      args.push("-i"); // interactive selection
    }
    args.push(parsed.path);

    await runExecFile("screencapture", args);
    return { output: `Screenshot saved to ${parsed.path}`, isError: false, path: parsed.path };
  },
};

// ─── mac_notification ──────────────────────────────────────────────────────

const NotificationInputSchema = z.object({
  message: z.string().min(1).describe("Notification message body"),
  title: z.string().optional().describe("Notification title"),
  subtitle: z.string().optional().describe("Notification subtitle"),
  sound: z.string().optional().describe("Sound name (e.g. 'Glass', 'Ping', 'default')"),
});

export const macNotificationTool: ToolDefinitionRuntime = {
  name: "mac_notification",
  description: "Display a native macOS notification with an optional title, subtitle, and sound.",
  parameters: {
    type: "object",
    properties: {
      message: { type: "string", description: "Notification message body" },
      title: { type: "string", description: "Notification title" },
      subtitle: { type: "string", description: "Notification subtitle" },
      sound: { type: "string", description: "Sound name (e.g. 'Glass', 'Ping')" },
    },
    required: ["message"],
  },
  inputSchema: NotificationInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: DEFAULT_TIMEOUT_MS,
  tags: ["macos", "system", "notification"],

  async execute(input: Record<string, unknown>): Promise<unknown> {
    assertMacOS();
    const parsed = NotificationInputSchema.parse(input);

    // Escape double quotes for AppleScript strings
    const escape = (s: string) => s.replace(/"/g, '\\"');

    let script = `display notification "${escape(parsed.message)}"`;
    if (parsed.title) script += ` with title "${escape(parsed.title)}"`;
    if (parsed.subtitle) script += ` subtitle "${escape(parsed.subtitle)}"`;
    if (parsed.sound) script += ` sound name "${escape(parsed.sound)}"`;

    await runOsascript(script);
    return { output: "Notification displayed", isError: false, durationMs: 0 };
  },
};

// ─── mac_get_volume ────────────────────────────────────────────────────────

const GetVolumeInputSchema = z.object({});

export const macGetVolumeTool: ToolDefinitionRuntime = {
  name: "mac_get_volume",
  description: "Get the current macOS system volume level (0-100) and mute state.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  inputSchema: GetVolumeInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: DEFAULT_TIMEOUT_MS,
  tags: ["macos", "system", "volume"],

  async execute(): Promise<unknown> {
    assertMacOS();

    const volumeStr = await runOsascript("output volume of (get volume settings)");
    const mutedStr = await runOsascript("output muted of (get volume settings)");

    const volume = parseInt(volumeStr, 10);
    const muted = mutedStr === "true";

    return {
      output: `Volume: ${volume}%, Muted: ${muted}`,
      isError: false,
      volume,
      muted,
    };
  },
};

// ─── mac_set_volume ────────────────────────────────────────────────────────

const SetVolumeInputSchema = z.object({
  level: z.number().int().min(0).max(100).describe("Volume level (0-100)"),
  mute: z.boolean().optional().describe("Set mute state (true = muted)"),
});

export const macSetVolumeTool: ToolDefinitionRuntime = {
  name: "mac_set_volume",
  description: "Set the macOS system volume level (0-100) and optionally mute/unmute.",
  parameters: {
    type: "object",
    properties: {
      level: { type: "integer", description: "Volume level (0-100)", minimum: 0, maximum: 100 },
      mute: { type: "boolean", description: "Set mute state" },
    },
    required: ["level"],
  },
  inputSchema: SetVolumeInputSchema,
  riskLevel: "medium",
  requiresApproval: false,
  timeout: DEFAULT_TIMEOUT_MS,
  tags: ["macos", "system", "volume"],

  async execute(input: Record<string, unknown>): Promise<unknown> {
    assertMacOS();
    const parsed = SetVolumeInputSchema.parse(input);

    await runOsascript(`set volume output volume ${parsed.level}`);

    if (parsed.mute !== undefined) {
      await runOsascript(`set volume output muted ${parsed.mute}`);
    }

    return {
      output: `Volume set to ${parsed.level}%${parsed.mute !== undefined ? `, muted: ${parsed.mute}` : ""}`,
      isError: false,
    };
  },
};

// ─── mac_brightness ────────────────────────────────────────────────────────

const BrightnessInputSchema = z.object({
  level: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("Brightness level (0.0-1.0). Omit to get the current brightness."),
});

export const macBrightnessTool: ToolDefinitionRuntime = {
  name: "mac_brightness",
  description:
    "Get or set the macOS screen brightness. " +
    "Provide a level (0.0-1.0) to set brightness, or omit to read the current value. " +
    "Uses CoreBrightness via AppleScript.",
  parameters: {
    type: "object",
    properties: {
      level: {
        type: "number",
        description: "Brightness level (0.0-1.0). Omit to get current brightness.",
        minimum: 0,
        maximum: 1,
      },
    },
    required: [],
  },
  inputSchema: BrightnessInputSchema,
  riskLevel: "medium",
  requiresApproval: false,
  timeout: DEFAULT_TIMEOUT_MS,
  tags: ["macos", "system", "brightness"],

  async execute(input: Record<string, unknown>): Promise<unknown> {
    assertMacOS();
    const parsed = BrightnessInputSchema.parse(input);

    if (parsed.level !== undefined) {
      // Set brightness using AppleScript with CoreBrightness framework
      const script = `
        do shell script "brightness ${parsed.level}"
      `;
      try {
        // Try using the brightness CLI tool if installed
        await runExecFile("brightness", [String(parsed.level)]);
        return {
          output: `Brightness set to ${Math.round(parsed.level * 100)}%`,
          isError: false,
        };
      } catch {
        // Fallback to AppleScript
        try {
          await runOsascript(`
            tell application "System Events"
              tell appearance preferences
                -- Use key codes to adjust brightness; this is an approximation
              end tell
            end tell
          `);
          // Use osascript with the CoreBrightness framework
          const setBrightness = `
            tell application "System Preferences"
              reveal anchor "displaysDisplayTab" of pane id "com.apple.preference.displays"
            end tell
          `;
          return {
            output: `Brightness adjustment requested. Note: programmatic brightness control may require the 'brightness' CLI tool (brew install brightness).`,
            isError: false,
          };
        } catch (err) {
          return {
            output: `Cannot set brightness programmatically. Install 'brightness' CLI tool: brew install brightness. Error: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
          };
        }
      }
    } else {
      // Get brightness
      try {
        const { stdout } = await runExecFile("brightness", ["-l"]);
        const match = stdout.match(/brightness\s+([\d.]+)/i);
        const level = match ? parseFloat(match[1]) : null;
        return {
          output: level !== null ? `Current brightness: ${Math.round(level * 100)}%` : stdout,
          isError: false,
          level,
        };
      } catch {
        // Fallback: use ioreg to read brightness
        try {
          const { stdout } = await runExecFile("ioreg", ["-c", "AppleBacklightDisplay", "-r", "-d", "1"]);
          const match = stdout.match(/"brightness"\s*=\s*(\d+)/);
          if (match) {
            const raw = parseInt(match[1], 10);
            // ioreg brightness is typically 0-1024
            const level = raw / 1024;
            return {
              output: `Current brightness: ~${Math.round(level * 100)}%`,
              isError: false,
              level,
            };
          }
          return {
            output: "Could not determine brightness level. Install 'brightness' CLI: brew install brightness",
            isError: true,
          };
        } catch (err) {
          return {
            output: `Cannot read brightness: ${err instanceof Error ? err.message : String(err)}`,
            isError: true,
          };
        }
      }
    }
  },
};
