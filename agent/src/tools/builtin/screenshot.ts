// ─── Screenshot Tool (macOS) ──────────────────────────────────────────────

import { exec } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import pino from "pino";
import type { ToolDefinitionRuntime, ToolExecutionContext } from "../registry.js";

const logger = pino({ name: "tool-screenshot" });

const SCREENSHOTS_DIR = join(homedir(), ".karna", "screenshots");
const CAPTURE_TIMEOUT_MS = 10_000;

// ─── Helpers ─────────────────────────────────────────────────────────────

async function ensureScreenshotsDir(): Promise<void> {
  await mkdir(SCREENSHOTS_DIR, { recursive: true });
}

function generateTimestampPath(prefix: string): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, "-");
  return join(SCREENSHOTS_DIR, `${prefix}-${ts}.png`);
}

function execCommand(command: string, timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(command, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Command failed: ${error.message}\nstderr: ${stderr}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

// ─── Capture Screen ──────────────────────────────────────────────────────

const CaptureScreenInputSchema = z.object({
  outputPath: z
    .string()
    .optional()
    .describe("Custom output path for the screenshot. Defaults to ~/.karna/screenshots/<timestamp>.png"),
});

export const screenshotCaptureTool: ToolDefinitionRuntime = {
  name: "screenshot_capture",
  description:
    "Take a screenshot of the entire screen (macOS). " +
    "Saves the image to ~/.karna/screenshots/ with a timestamp filename.",
  parameters: {
    type: "object",
    properties: {
      outputPath: {
        type: "string",
        description: "Custom output path for the screenshot",
      },
    },
  },
  inputSchema: CaptureScreenInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: 15_000,
  tags: ["screenshot", "screen", "capture"],

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = CaptureScreenInputSchema.parse(input);
    await ensureScreenshotsDir();

    const outputPath = parsed.outputPath ?? generateTimestampPath("screen");

    if (process.platform !== "darwin") {
      throw new Error("Screenshot capture is currently only supported on macOS");
    }

    logger.debug({ outputPath }, "Capturing screen");

    // macOS screencapture: -x suppresses sound
    await execCommand(`screencapture -x "${outputPath}"`, CAPTURE_TIMEOUT_MS);

    return { captured: true, path: outputPath };
  },
};

// ─── Capture Window ──────────────────────────────────────────────────────

const CaptureWindowInputSchema = z.object({
  windowName: z
    .string()
    .optional()
    .describe("Name or partial name of the window to capture. If omitted, captures the frontmost window."),
  outputPath: z
    .string()
    .optional()
    .describe("Custom output path for the screenshot"),
});

export const screenshotCaptureWindowTool: ToolDefinitionRuntime = {
  name: "screenshot_capture_window",
  description:
    "Take a screenshot of a specific window or the frontmost window (macOS). " +
    "Saves to ~/.karna/screenshots/ by default.",
  parameters: {
    type: "object",
    properties: {
      windowName: {
        type: "string",
        description: "Name of the window to capture (omit for frontmost window)",
      },
      outputPath: {
        type: "string",
        description: "Custom output path for the screenshot",
      },
    },
  },
  inputSchema: CaptureWindowInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: 15_000,
  tags: ["screenshot", "window", "capture"],

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = CaptureWindowInputSchema.parse(input);
    await ensureScreenshotsDir();

    if (process.platform !== "darwin") {
      throw new Error("Screenshot capture is currently only supported on macOS");
    }

    const outputPath = parsed.outputPath ?? generateTimestampPath("window");

    if (parsed.windowName) {
      // Use AppleScript to find and capture specific window
      const script = `
tell application "System Events"
  set targetWindow to missing value
  repeat with proc in (every process whose visible is true)
    repeat with win in (every window of proc)
      if name of win contains "${parsed.windowName.replace(/"/g, '\\"')}" then
        set targetWindow to win
        set windowId to id of win
        exit repeat
      end if
    end repeat
    if targetWindow is not missing value then exit repeat
  end repeat
  if targetWindow is missing value then
    error "Window not found: ${parsed.windowName.replace(/"/g, '\\"')}"
  end if
end tell
`;
      // First bring the window to front, then capture it
      const bringToFrontScript = `
tell application "System Events"
  repeat with proc in (every process whose visible is true)
    repeat with win in (every window of proc)
      if name of win contains "${parsed.windowName.replace(/"/g, '\\"')}" then
        set frontmost of proc to true
        delay 0.3
        exit repeat
      end if
    end repeat
  end repeat
end tell
`;
      try {
        await execCommand(
          `osascript -e '${bringToFrontScript.replace(/'/g, "'\\''")}'`,
          CAPTURE_TIMEOUT_MS
        );
      } catch (err) {
        logger.warn({ err, windowName: parsed.windowName }, "Could not bring window to front, capturing frontmost");
      }

      // Capture the frontmost window with -l flag won't work reliably, use -w (interactive) is not suitable
      // Instead capture the frontmost window after bringing target to front
      await execCommand(`screencapture -x -w -o "${outputPath}"`, CAPTURE_TIMEOUT_MS);
    } else {
      // Capture frontmost window: -l flag not available without window ID, use -w
      // -w captures the frontmost window without interaction when combined with -x
      await execCommand(`screencapture -x -w -o "${outputPath}"`, CAPTURE_TIMEOUT_MS);
    }

    logger.debug({ outputPath, windowName: parsed.windowName }, "Window captured");

    return { captured: true, path: outputPath, windowName: parsed.windowName ?? "(frontmost)" };
  },
};
