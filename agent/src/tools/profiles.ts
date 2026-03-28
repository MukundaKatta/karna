// ─── Tool Profiles ──────────────────────────────────────────────────────────
// Predefined tool sets for different use cases.
// Like OpenClaw's tools.profile (full, coding, messaging, minimal).

import type { ToolPolicy } from "./registry.js";

// ─── Profile Definitions ────────────────────────────────────────────────────

export type ToolProfileName = "full" | "coding" | "messaging" | "minimal" | "custom";

/**
 * Predefined tool profiles.
 * Each profile defines an allowList of tools available to the agent.
 */
export const TOOL_PROFILES: Record<Exclude<ToolProfileName, "custom">, ToolPolicy> = {
  /** All tools enabled (default) */
  full: {},

  /** Tools for software development */
  coding: {
    allowList: [
      "shell_exec",
      "file_read",
      "file_write",
      "file_list",
      "file_search",
      "apply_patch",
      "code_exec",
      "web_search",
      "browser_navigate",
      "browser_screenshot",
      "browser_extract_text",
      "memory_search",
      "memory_get",
      "sessions_list",
    ],
  },

  /** Tools for messaging and communication */
  messaging: {
    allowList: [
      "message",
      "email_list",
      "email_read",
      "email_send",
      "email_create_draft",
      "email_search",
      "web_search",
      "web_fetch",
      "sessions_list",
      "sessions_history",
      "sessions_send",
      "memory_search",
      "memory_get",
      "calendar_list_events",
      "calendar_get_event",
      "calendar_create_event",
    ],
  },

  /** Minimal tools — read-only, safe operations only */
  minimal: {
    allowList: [
      "file_read",
      "file_list",
      "file_search",
      "web_search",
      "memory_search",
      "memory_get",
      "sessions_list",
      "session_status",
    ],
  },
};

// ─── Tool Groups ────────────────────────────────────────────────────────────

export const TOOL_GROUPS: Record<string, string[]> = {
  "group:fs": ["file_read", "file_write", "file_list", "file_search", "apply_patch"],
  "group:web": ["web_search", "browser_navigate", "browser_screenshot", "browser_extract_text", "browser_click", "browser_fill_form", "browser_evaluate"],
  "group:runtime": ["shell_exec", "code_exec"],
  "group:sessions": ["sessions_list", "sessions_history", "sessions_send", "sessions_spawn", "session_status"],
  "group:memory": ["memory_search", "memory_get"],
  "group:messaging": ["message", "email_list", "email_read", "email_send", "email_create_draft", "email_search"],
  "group:calendar": ["calendar_list_events", "calendar_get_event", "calendar_create_event", "calendar_update_event", "calendar_delete_event"],
  "group:media": ["image_generate", "screenshot_capture", "screenshot_capture_window"],
  "group:automation": ["cron", "gateway_restart"],
  "group:notes": ["note_create", "note_read", "note_update", "note_delete", "note_list", "note_search"],
  "group:mcp": ["mcp_list_servers", "mcp_connect_server", "mcp_list_tools", "mcp_call_tool", "mcp_disconnect_server"],
};

/**
 * Get a ToolPolicy from a profile name.
 */
export function getToolProfile(name: ToolProfileName): ToolPolicy {
  if (name === "custom" || name === "full") return {};
  return TOOL_PROFILES[name];
}

/**
 * Expand tool group references in an allowList.
 * E.g., ["group:fs", "web_search"] → ["file_read", "file_write", ..., "web_search"]
 */
export function expandToolGroups(tools: string[]): string[] {
  const expanded: string[] = [];
  for (const tool of tools) {
    if (tool.startsWith("group:") && TOOL_GROUPS[tool]) {
      expanded.push(...TOOL_GROUPS[tool]!);
    } else {
      expanded.push(tool);
    }
  }
  return [...new Set(expanded)];
}
