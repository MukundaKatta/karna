// ─── macOS Tools Barrel Export ──────────────────────────────────────────────

import type { ToolDefinitionRuntime } from "../../registry.js";

// App Control
import {
  macOpenAppTool,
  macListAppsTool,
  macQuitAppTool,
  macFocusAppTool,
} from "./apps.js";

// System Control
import {
  macGetClipboardTool,
  macSetClipboardTool,
  macScreenshotTool,
  macNotificationTool,
  macGetVolumeTool,
  macSetVolumeTool,
  macBrightnessTool,
} from "./system.js";

// Finder / File Operations
import {
  macOpenFileTool,
  macRevealInFinderTool,
  macGetDownloadsTool,
  macTrashTool,
  macSearchSpotlightTool,
} from "./finder.js";

// Automation (AppleScript & Shortcuts)
import {
  macRunAppleScriptTool,
  macRunShortcutTool,
  macGetShortcutsTool,
} from "./automation.js";

// ─── All macOS Tools ──────────────────────────────────────────────────────

export const allMacOSTools: ToolDefinitionRuntime[] = [
  // App Control
  macOpenAppTool,
  macListAppsTool,
  macQuitAppTool,
  macFocusAppTool,

  // System Control
  macGetClipboardTool,
  macSetClipboardTool,
  macScreenshotTool,
  macNotificationTool,
  macGetVolumeTool,
  macSetVolumeTool,
  macBrightnessTool,

  // Finder / File Operations
  macOpenFileTool,
  macRevealInFinderTool,
  macGetDownloadsTool,
  macTrashTool,
  macSearchSpotlightTool,

  // Automation
  macRunAppleScriptTool,
  macRunShortcutTool,
  macGetShortcutsTool,
];

// ─── Re-exports ───────────────────────────────────────────────────────────

export {
  macOpenAppTool,
  macListAppsTool,
  macQuitAppTool,
  macFocusAppTool,
} from "./apps.js";

export {
  macGetClipboardTool,
  macSetClipboardTool,
  macScreenshotTool,
  macNotificationTool,
  macGetVolumeTool,
  macSetVolumeTool,
  macBrightnessTool,
} from "./system.js";

export {
  macOpenFileTool,
  macRevealInFinderTool,
  macGetDownloadsTool,
  macTrashTool,
  macSearchSpotlightTool,
} from "./finder.js";

export {
  macRunAppleScriptTool,
  macRunShortcutTool,
  macGetShortcutsTool,
} from "./automation.js";
