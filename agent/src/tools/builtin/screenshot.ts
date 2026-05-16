// ─── Screenshot Tools (macOS / iOS Simulator) ─────────────────────────────

import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { z } from "zod";
import pino from "pino";
import type { ToolDefinitionRuntime } from "../registry.js";

const logger = pino({ name: "tool-screenshot" });
const execFileAsync = promisify(execFile);

const DEFAULT_SCREENSHOTS_DIR = join(homedir(), ".karna", "screenshots");
const CAPTURE_TIMEOUT_MS = 30_000;
const DEFAULT_DENIED_WINDOW_PATTERNS = [
  "1password",
  "bitwarden",
  "dashlane",
  "lastpass",
  "keeper",
  "password",
  "bank",
  "authenticator",
  "keychain",
];

const RegionSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const CaptureScreenInputSchema = z.object({
  mode: z.enum(["full", "selection", "region"]).optional().default("full"),
  region: RegionSchema.optional().describe("Region rectangle for mode=region"),
  delaySeconds: z.number().min(0).max(30).optional().default(0),
  outputDirectory: z.string().optional().describe("Directory to save screenshots"),
  outputPath: z.string().optional().describe("Custom output path for the PNG screenshot"),
  createThumbnail: z.boolean().optional().default(true),
  thumbnailMaxSize: z.number().int().min(64).max(2048).optional().default(512),
  ocr: z.boolean().optional().default(false),
  analysisPrompt: z.string().optional().describe("Optional vision-analysis prompt to attach to the result metadata"),
});

const CaptureWindowInputSchema = z.object({
  windowName: z
    .string()
    .optional()
    .describe("Name or partial name of the window to capture. If omitted, captures the selected/front window."),
  delaySeconds: z.number().min(0).max(30).optional().default(0),
  outputDirectory: z.string().optional(),
  outputPath: z.string().optional(),
  createThumbnail: z.boolean().optional().default(true),
  thumbnailMaxSize: z.number().int().min(64).max(2048).optional().default(512),
  ocr: z.boolean().optional().default(false),
  denyList: z.array(z.string()).optional().describe("Additional denied window title patterns"),
  analysisPrompt: z.string().optional(),
});

const CaptureIosInputSchema = z.object({
  device: z.string().optional().default("booted").describe("iOS simulator device UDID or 'booted'"),
  outputDirectory: z.string().optional(),
  outputPath: z.string().optional(),
  createThumbnail: z.boolean().optional().default(true),
  thumbnailMaxSize: z.number().int().min(64).max(2048).optional().default(512),
});

export const screenshotCaptureTool: ToolDefinitionRuntime = {
  name: "screenshot_capture",
  description:
    "Capture a macOS screenshot. Supports full-screen, selected-region, explicit rectangle, delay, configurable output directory, thumbnail generation, optional OCR command integration, and vision-analysis metadata.",
  parameters: {
    type: "object",
    properties: {
      mode: { type: "string", enum: ["full", "selection", "region"], description: "Capture mode" },
      region: {
        type: "object",
        description: "Rectangle for region captures",
        properties: {
          x: { type: "integer" },
          y: { type: "integer" },
          width: { type: "integer" },
          height: { type: "integer" },
        },
      },
      delaySeconds: { type: "number", description: "Delay before capture, max 30 seconds" },
      outputDirectory: { type: "string", description: "Directory to save screenshots" },
      outputPath: { type: "string", description: "Custom output path for the screenshot" },
      createThumbnail: { type: "boolean", description: "Generate a thumbnail for chat display" },
      thumbnailMaxSize: { type: "integer", description: "Maximum thumbnail edge in pixels" },
      ocr: { type: "boolean", description: "Run configured OCR command on the captured image" },
      analysisPrompt: { type: "string", description: "Vision-analysis prompt to attach to the result" },
    },
  },
  inputSchema: CaptureScreenInputSchema,
  riskLevel: "critical",
  requiresApproval: true,
  timeout: CAPTURE_TIMEOUT_MS,
  tags: ["screenshot", "screen", "capture", "macos"],

  async execute(input: Record<string, unknown>): Promise<unknown> {
    assertMacOS();
    const parsed = CaptureScreenInputSchema.parse(input);
    const outputPath = await resolveScreenshotPath(parsed.outputPath, parsed.outputDirectory, `screen-${parsed.mode}`);
    const args = buildScreenCaptureArgs(parsed, outputPath);

    logger.info({ mode: parsed.mode, outputPath }, "Capturing macOS screenshot");
    await runExecFile("screencapture", args, CAPTURE_TIMEOUT_MS);

    return buildScreenshotResult({
      captured: true,
      platform: "macos",
      mode: parsed.mode,
      path: outputPath,
      createThumbnail: parsed.createThumbnail,
      thumbnailMaxSize: parsed.thumbnailMaxSize,
      ocr: parsed.ocr,
      analysisPrompt: parsed.analysisPrompt,
    });
  },
};

export const screenshotCaptureWindowTool: ToolDefinitionRuntime = {
  name: "screenshot_capture_window",
  description:
    "Capture a macOS window screenshot with optional title matching, delay, configurable output directory, thumbnail generation, OCR, and sensitive-window deny-list checks.",
  parameters: {
    type: "object",
    properties: {
      windowName: { type: "string", description: "Window title pattern to capture" },
      delaySeconds: { type: "number", description: "Delay before capture, max 30 seconds" },
      outputDirectory: { type: "string", description: "Directory to save screenshots" },
      outputPath: { type: "string", description: "Custom output path for the screenshot" },
      createThumbnail: { type: "boolean", description: "Generate a thumbnail for chat display" },
      thumbnailMaxSize: { type: "integer", description: "Maximum thumbnail edge in pixels" },
      ocr: { type: "boolean", description: "Run configured OCR command on the captured image" },
      denyList: { type: "array", items: { type: "string" }, description: "Additional denied window title patterns" },
      analysisPrompt: { type: "string", description: "Vision-analysis prompt to attach to the result" },
    },
  },
  inputSchema: CaptureWindowInputSchema,
  riskLevel: "critical",
  requiresApproval: true,
  timeout: CAPTURE_TIMEOUT_MS,
  tags: ["screenshot", "window", "capture", "macos"],

  async execute(input: Record<string, unknown>): Promise<unknown> {
    assertMacOS();
    const parsed = CaptureWindowInputSchema.parse(input);
    assertWindowAllowed(parsed.windowName, parsed.denyList);
    const outputPath = await resolveScreenshotPath(parsed.outputPath, parsed.outputDirectory, "window");

    logger.info({ outputPath, windowName: parsed.windowName }, "Capturing macOS window screenshot");
    if (parsed.windowName) {
      await focusWindowByName(parsed.windowName);
    }
    await runExecFile("screencapture", buildWindowCaptureArgs(parsed, outputPath), CAPTURE_TIMEOUT_MS);

    return buildScreenshotResult({
      captured: true,
      platform: "macos",
      mode: "window",
      path: outputPath,
      windowName: parsed.windowName ?? "(selected/frontmost)",
      createThumbnail: parsed.createThumbnail,
      thumbnailMaxSize: parsed.thumbnailMaxSize,
      ocr: parsed.ocr,
      analysisPrompt: parsed.analysisPrompt,
    });
  },
};

export const screenshotCaptureIosTool: ToolDefinitionRuntime = {
  name: "screenshot_capture_ios",
  description:
    "Capture a screenshot from an iOS Simulator using xcrun simctl io. Supports configurable output directory and thumbnail generation.",
  parameters: {
    type: "object",
    properties: {
      device: { type: "string", description: "Simulator UDID or 'booted'" },
      outputDirectory: { type: "string", description: "Directory to save screenshots" },
      outputPath: { type: "string", description: "Custom output path for the screenshot" },
      createThumbnail: { type: "boolean", description: "Generate a thumbnail for chat display" },
      thumbnailMaxSize: { type: "integer", description: "Maximum thumbnail edge in pixels" },
    },
  },
  inputSchema: CaptureIosInputSchema,
  riskLevel: "critical",
  requiresApproval: true,
  timeout: CAPTURE_TIMEOUT_MS,
  tags: ["screenshot", "capture", "ios", "simulator"],

  async execute(input: Record<string, unknown>): Promise<unknown> {
    assertMacOS();
    const parsed = CaptureIosInputSchema.parse(input);
    const outputPath = await resolveScreenshotPath(parsed.outputPath, parsed.outputDirectory, "ios");

    logger.info({ outputPath, device: parsed.device }, "Capturing iOS simulator screenshot");
    await runExecFile("xcrun", ["simctl", "io", parsed.device, "screenshot", outputPath], CAPTURE_TIMEOUT_MS);

    return buildScreenshotResult({
      captured: true,
      platform: "ios-simulator",
      mode: "full",
      path: outputPath,
      createThumbnail: parsed.createThumbnail,
      thumbnailMaxSize: parsed.thumbnailMaxSize,
      ocr: false,
    });
  },
};

export function buildScreenCaptureArgs(
  input: z.infer<typeof CaptureScreenInputSchema>,
  outputPath: string,
): string[] {
  const args = ["-x"];
  if (input.delaySeconds > 0) {
    args.push("-T", String(input.delaySeconds));
  }
  if (input.mode === "selection") {
    args.push("-i");
  }
  if (input.mode === "region") {
    if (!input.region) {
      throw new Error("Region capture requires a region rectangle");
    }
    args.push("-R", `${input.region.x},${input.region.y},${input.region.width},${input.region.height}`);
  }
  args.push(outputPath);
  return args;
}

export function buildWindowCaptureArgs(
  input: z.infer<typeof CaptureWindowInputSchema>,
  outputPath: string,
): string[] {
  const args = ["-x", "-w", "-o"];
  if (input.delaySeconds > 0) {
    args.push("-T", String(input.delaySeconds));
  }
  args.push(outputPath);
  return args;
}

export function isDeniedWindowTitle(windowName: string | undefined, denyList: string[] = []): boolean {
  if (!windowName) return false;
  const normalizedWindow = windowName.toLowerCase();
  return [...DEFAULT_DENIED_WINDOW_PATTERNS, ...resolveConfiguredDenyList(), ...denyList]
    .map((pattern) => pattern.trim().toLowerCase())
    .filter(Boolean)
    .some((pattern) => normalizedWindow.includes(pattern));
}

function assertWindowAllowed(windowName: string | undefined, denyList: string[] | undefined): void {
  if (isDeniedWindowTitle(windowName, denyList)) {
    throw new Error(`Screenshot blocked by sensitive-window deny list: ${windowName}`);
  }
}

async function buildScreenshotResult(params: {
  captured: boolean;
  platform: "macos" | "ios-simulator";
  mode: string;
  path: string;
  windowName?: string;
  createThumbnail: boolean;
  thumbnailMaxSize: number;
  ocr: boolean;
  analysisPrompt?: string;
}) {
  const thumbnailPath = params.createThumbnail
    ? await createThumbnail(params.path, params.thumbnailMaxSize)
    : null;
  const ocrText = params.ocr ? await runOcrCommand(params.path) : null;

  return {
    captured: params.captured,
    platform: params.platform,
    mode: params.mode,
    path: params.path,
    thumbnailPath,
    windowName: params.windowName,
    ocrText,
    analysis:
      params.analysisPrompt === undefined
        ? undefined
        : {
            prompt: params.analysisPrompt,
            note: "Attach the screenshot path to the configured vision model pipeline for analysis.",
          },
  };
}

async function createThumbnail(path: string, maxSize: number): Promise<string | null> {
  const thumbnailPath = join(dirname(path), `${basename(path, ".png")}.thumb.png`);
  try {
    await runExecFile("sips", ["-Z", String(maxSize), path, "--out", thumbnailPath], CAPTURE_TIMEOUT_MS);
    return thumbnailPath;
  } catch (error) {
    logger.warn({ error: String(error), path }, "Screenshot thumbnail generation failed");
    return null;
  }
}

async function runOcrCommand(path: string): Promise<string | null> {
  const rawCommand = process.env["KARNA_SCREENSHOT_OCR_COMMAND"];
  if (!rawCommand) {
    return null;
  }
  const [command, ...args] = rawCommand.split(" ").filter(Boolean);
  if (!command) return null;
  const result = await runExecFile(command, [...args, path], CAPTURE_TIMEOUT_MS);
  return result.stdout.trim();
}

async function focusWindowByName(windowName: string): Promise<void> {
  const escaped = windowName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const script = `
tell application "System Events"
  repeat with proc in (every process whose visible is true)
    repeat with win in (every window of proc)
      if name of win contains "${escaped}" then
        set frontmost of proc to true
        perform action "AXRaise" of win
        delay 0.3
        return
      end if
    end repeat
  end repeat
end tell
`;
  await runExecFile("osascript", ["-e", script], CAPTURE_TIMEOUT_MS);
}

async function resolveScreenshotPath(
  outputPath: string | undefined,
  outputDirectory: string | undefined,
  prefix: string,
): Promise<string> {
  const resolvedPath = outputPath
    ? resolve(outputPath)
    : join(resolve(outputDirectory ?? process.env["KARNA_SCREENSHOT_DIR"] ?? DEFAULT_SCREENSHOTS_DIR), generateFilename(prefix));
  await mkdir(dirname(resolvedPath), { recursive: true });
  return resolvedPath;
}

function generateFilename(prefix: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `${prefix}-${ts}.png`;
}

function resolveConfiguredDenyList(): string[] {
  return (process.env["KARNA_SCREENSHOT_DENY_WINDOWS"] ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function runExecFile(
  file: string,
  args: string[],
  timeout: number,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(file, args, { timeout });
}

function assertMacOS(): void {
  if (process.platform !== "darwin") {
    throw new Error("Screenshot capture is currently only supported on macOS");
  }
}
