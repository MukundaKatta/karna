// ─── Built-in Tools Barrel Export ─────────────────────────────────────────

import type { ToolRegistry } from "../registry.js";

// Shell
import { shellTool } from "./shell.js";

// Files
import {
  fileReadTool,
  fileWriteTool,
  fileListTool,
  fileSearchTool,
} from "./files.js";

// Web Search
import { webSearchTool } from "./web-search.js";

// Calendar
import {
  calendarListEventsTool,
  calendarGetEventTool,
  calendarCreateEventTool,
  calendarUpdateEventTool,
  calendarDeleteEventTool,
} from "./calendar.js";

// Email
import {
  emailListTool,
  emailReadTool,
  emailSendTool,
  emailCreateDraftTool,
  emailSearchTool,
} from "./email.js";

// Browser
import {
  browserNavigateTool,
  browserScreenshotTool,
  browserExtractTextTool,
  browserClickTool,
  browserFillFormTool,
  browserEvaluateTool,
} from "./browser.js";

// Code Execution
import { codeExecTool } from "./code-exec.js";

// Reminders
import {
  reminderSetTool,
  reminderListTool,
  reminderCancelTool,
} from "./reminder.js";

// Notes
import {
  noteCreateTool,
  noteReadTool,
  noteUpdateTool,
  noteDeleteTool,
  noteListTool,
  noteSearchTool,
} from "./notes.js";

// Screenshot
import {
  screenshotCaptureTool,
  screenshotCaptureWindowTool,
} from "./screenshot.js";

// MCP Client
import {
  mcpListServersTool,
  mcpConnectServerTool,
  mcpListToolsTool,
  mcpCallToolTool,
  mcpDisconnectServerTool,
} from "./mcp-client.js";

// ─── All Tools ───────────────────────────────────────────────────────────

export const allBuiltinTools = [
  // Shell
  shellTool,

  // Files
  fileReadTool,
  fileWriteTool,
  fileListTool,
  fileSearchTool,

  // Web Search
  webSearchTool,

  // Calendar
  calendarListEventsTool,
  calendarGetEventTool,
  calendarCreateEventTool,
  calendarUpdateEventTool,
  calendarDeleteEventTool,

  // Email
  emailListTool,
  emailReadTool,
  emailSendTool,
  emailCreateDraftTool,
  emailSearchTool,

  // Browser
  browserNavigateTool,
  browserScreenshotTool,
  browserExtractTextTool,
  browserClickTool,
  browserFillFormTool,
  browserEvaluateTool,

  // Code Execution
  codeExecTool,

  // Reminders
  reminderSetTool,
  reminderListTool,
  reminderCancelTool,

  // Notes
  noteCreateTool,
  noteReadTool,
  noteUpdateTool,
  noteDeleteTool,
  noteListTool,
  noteSearchTool,

  // Screenshot
  screenshotCaptureTool,
  screenshotCaptureWindowTool,

  // MCP Client
  mcpListServersTool,
  mcpConnectServerTool,
  mcpListToolsTool,
  mcpCallToolTool,
  mcpDisconnectServerTool,
] as const;

// ─── Registration ────────────────────────────────────────────────────────

/**
 * Register all built-in tools with the given tool registry.
 */
export function registerBuiltinTools(registry: ToolRegistry): void {
  for (const tool of allBuiltinTools) {
    registry.register(tool);
  }
}

// ─── Re-exports ──────────────────────────────────────────────────────────

export { shellTool } from "./shell.js";
export {
  fileReadTool,
  fileWriteTool,
  fileListTool,
  fileSearchTool,
} from "./files.js";
export { webSearchTool } from "./web-search.js";
export {
  calendarListEventsTool,
  calendarGetEventTool,
  calendarCreateEventTool,
  calendarUpdateEventTool,
  calendarDeleteEventTool,
} from "./calendar.js";
export {
  emailListTool,
  emailReadTool,
  emailSendTool,
  emailCreateDraftTool,
  emailSearchTool,
} from "./email.js";
export {
  browserNavigateTool,
  browserScreenshotTool,
  browserExtractTextTool,
  browserClickTool,
  browserFillFormTool,
  browserEvaluateTool,
} from "./browser.js";
export { codeExecTool } from "./code-exec.js";
export {
  reminderSetTool,
  reminderListTool,
  reminderCancelTool,
} from "./reminder.js";
export {
  noteCreateTool,
  noteReadTool,
  noteUpdateTool,
  noteDeleteTool,
  noteListTool,
  noteSearchTool,
} from "./notes.js";
export {
  screenshotCaptureTool,
  screenshotCaptureWindowTool,
} from "./screenshot.js";
export {
  mcpListServersTool,
  mcpConnectServerTool,
  mcpListToolsTool,
  mcpCallToolTool,
  mcpDisconnectServerTool,
} from "./mcp-client.js";
