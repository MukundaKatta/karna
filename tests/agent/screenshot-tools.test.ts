import { describe, expect, it } from "vitest";
import {
  buildScreenCaptureArgs,
  buildWindowCaptureArgs,
  isDeniedWindowTitle,
  screenshotCaptureIosTool,
  screenshotCaptureTool,
  screenshotCaptureWindowTool,
} from "../../agent/src/tools/builtin/screenshot.js";
import { allBuiltinTools } from "../../agent/src/tools/builtin/index.js";
import { expandToolGroups } from "../../agent/src/tools/profiles.js";

describe("screenshot tools", () => {
  it("marks all screenshot capture tools as critical approval-gated tools", () => {
    for (const tool of [screenshotCaptureTool, screenshotCaptureWindowTool, screenshotCaptureIosTool]) {
      expect(tool.riskLevel).toBe("critical");
      expect(tool.requiresApproval).toBe(true);
    }
  });

  it("registers macOS and iOS screenshot tools as built-ins and media-profile tools", () => {
    const names = allBuiltinTools.map((tool) => tool.name);
    expect(names).toContain("screenshot_capture");
    expect(names).toContain("screenshot_capture_window");
    expect(names).toContain("screenshot_capture_ios");
    expect(expandToolGroups(["group:media"])).toEqual(
      expect.arrayContaining(["screenshot_capture", "screenshot_capture_window", "screenshot_capture_ios"]),
    );
  });

  it("builds full, delayed, selection, and region screencapture arguments without a shell", () => {
    expect(buildScreenCaptureArgs({ mode: "full", delaySeconds: 0 }, "/tmp/full.png")).toEqual([
      "-x",
      "/tmp/full.png",
    ]);
    expect(buildScreenCaptureArgs({ mode: "selection", delaySeconds: 2 }, "/tmp/selection.png")).toEqual([
      "-x",
      "-T",
      "2",
      "-i",
      "/tmp/selection.png",
    ]);
    expect(
      buildScreenCaptureArgs(
        { mode: "region", delaySeconds: 0, region: { x: 10, y: 20, width: 300, height: 200 } },
        "/tmp/region.png",
      ),
    ).toEqual(["-x", "-R", "10,20,300,200", "/tmp/region.png"]);
  });

  it("builds window capture arguments with optional delay", () => {
    expect(buildWindowCaptureArgs({ delaySeconds: 0 }, "/tmp/window.png")).toEqual([
      "-x",
      "-w",
      "-o",
      "/tmp/window.png",
    ]);
    expect(buildWindowCaptureArgs({ delaySeconds: 5 }, "/tmp/window.png")).toEqual([
      "-x",
      "-w",
      "-o",
      "-T",
      "5",
      "/tmp/window.png",
    ]);
  });

  it("blocks sensitive window title patterns", () => {
    expect(isDeniedWindowTitle("1Password - Login")).toBe(true);
    expect(isDeniedWindowTitle("Bank of Example")).toBe(true);
    expect(isDeniedWindowTitle("Project Notes", ["notes"])).toBe(true);
    expect(isDeniedWindowTitle("Karna Dashboard")).toBe(false);
  });
});
