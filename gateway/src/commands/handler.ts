// ─── Chat Commands Handler ──────────────────────────────────────────────────
// Handles in-channel slash commands like /status, /reset, /compact, /think, /verbose.
// Inspired by OpenClaw's command system.

import pino from "pino";
import type { SessionManager } from "../session/manager.js";

const logger = pino({ name: "chat-commands" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CommandResult {
  handled: boolean;
  response?: string;
  /** If true, don't forward this message to the agent */
  consumed: boolean;
}

/** Per-session settings toggled via commands */
export interface SessionSettings {
  thinkingLevel: "off" | "low" | "medium" | "high" | "xhigh";
  verbose: boolean;
  usageDisplay: "off" | "tokens" | "full";
}

const sessionSettings = new Map<string, SessionSettings>();

// ─── Persistence ────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const SETTINGS_DIR = join(homedir(), ".karna", "session-settings");

function persistSettings(sessionId: string, settings: SessionSettings): void {
  try {
    mkdirSync(SETTINGS_DIR, { recursive: true });
    writeFileSync(
      join(SETTINGS_DIR, `${sessionId}.json`),
      JSON.stringify(settings),
      "utf-8",
    );
  } catch {
    // Non-critical — settings will reset on restart
  }
}

function loadPersistedSettings(sessionId: string): SessionSettings | null {
  try {
    const filePath = join(SETTINGS_DIR, `${sessionId}.json`);
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, "utf-8")) as SessionSettings;
  } catch {
    return null;
  }
}

// ─── Default Settings ──────────────────────────────────────────────────────

function getSettings(sessionId: string): SessionSettings {
  let settings = sessionSettings.get(sessionId);
  if (!settings) {
    // Try loading persisted settings
    const persisted = loadPersistedSettings(sessionId);
    settings = persisted ?? { thinkingLevel: "medium", verbose: false, usageDisplay: "off" };
    sessionSettings.set(sessionId, settings);
  }
  return settings;
}

function updateSettings(sessionId: string, updates: Partial<SessionSettings>): SessionSettings {
  const settings = getSettings(sessionId);
  Object.assign(settings, updates);
  persistSettings(sessionId, settings);
  return settings;
}

export function getSessionSettings(sessionId: string): SessionSettings {
  return getSettings(sessionId);
}

// ─── Command Handler ───────────────────────────────────────────────────────

/**
 * Process a chat message and check if it's a slash command.
 * Returns { handled: true, consumed: true } if the command was processed.
 */
export function handleCommand(
  content: string,
  sessionId: string,
  sessionManager: SessionManager,
): CommandResult {
  const trimmed = content.trim();
  if (!trimmed.startsWith("/")) {
    return { handled: false, consumed: false };
  }

  const parts = trimmed.split(/\s+/);
  const command = parts[0]!.toLowerCase();
  const args = parts.slice(1);

  logger.debug({ command, sessionId, args }, "Processing chat command");

  switch (command) {
    case "/status":
      return handleStatus(sessionId, sessionManager);

    case "/reset":
    case "/new":
      return handleReset(sessionId);

    case "/compact":
      return handleCompact(sessionId);

    case "/think": {
      const level = args[0] as SessionSettings["thinkingLevel"] | undefined;
      return handleThink(sessionId, level);
    }

    case "/verbose": {
      const toggle = args[0]?.toLowerCase();
      return handleVerbose(sessionId, toggle);
    }

    case "/usage": {
      const mode = args[0]?.toLowerCase() as SessionSettings["usageDisplay"] | undefined;
      return handleUsage(sessionId, mode);
    }

    case "/elevated": {
      const toggle = args[0]?.toLowerCase();
      return handleElevated(sessionId, toggle);
    }

    case "/help":
      return handleHelp();

    default:
      return { handled: false, consumed: false };
  }
}

// ─── Command Implementations ───────────────────────────────────────────────

function handleStatus(sessionId: string, sessionManager: SessionManager): CommandResult {
  const session = sessionManager.getSession(sessionId);
  if (!session) {
    return { handled: true, consumed: true, response: "Session not found." };
  }

  const settings = getSettings(sessionId);
  const uptime = Date.now() - session.createdAt;
  const uptimeMin = Math.floor(uptime / 60_000);

  const lines = [
    `**Session Status**`,
    `ID: \`${session.id}\``,
    `Channel: ${session.channelType}`,
    `Status: ${session.status}`,
    `Uptime: ${uptimeMin}m`,
    `Messages: ${session.stats?.messageCount ?? 0}`,
    `Tokens: ${(session.stats?.totalInputTokens ?? 0) + (session.stats?.totalOutputTokens ?? 0)}`,
    `Think: ${settings.thinkingLevel}`,
    `Verbose: ${settings.verbose ? "on" : "off"}`,
    `Usage: ${settings.usageDisplay}`,
  ];

  return { handled: true, consumed: true, response: lines.join("\n") };
}

function handleReset(sessionId: string): CommandResult {
  // Clear session settings
  sessionSettings.delete(sessionId);
  return {
    handled: true,
    consumed: true,
    response: "Session context cleared. Starting fresh.",
  };
}

function handleCompact(sessionId: string): CommandResult {
  return {
    handled: true,
    consumed: false, // Let the agent handle compaction
    response: "Compacting conversation history...",
  };
}

function handleThink(sessionId: string, level?: string): CommandResult {
  const validLevels: SessionSettings["thinkingLevel"][] = ["off", "low", "medium", "high", "xhigh"];
  const settings = getSettings(sessionId);

  if (!level) {
    return {
      handled: true,
      consumed: true,
      response: `Current thinking level: **${settings.thinkingLevel}**\nOptions: ${validLevels.join(", ")}`,
    };
  }

  if (!validLevels.includes(level as SessionSettings["thinkingLevel"])) {
    return {
      handled: true,
      consumed: true,
      response: `Invalid level. Options: ${validLevels.join(", ")}`,
    };
  }

  updateSettings(sessionId, { thinkingLevel: level as SessionSettings["thinkingLevel"] });
  return {
    handled: true,
    consumed: true,
    response: `Thinking level set to **${level}**`,
  };
}

function handleVerbose(sessionId: string, toggle?: string): CommandResult {
  const settings = getSettings(sessionId);

  if (toggle === "on") {
    updateSettings(sessionId, { verbose: true });
    return { handled: true, consumed: true, response: "Verbose mode **enabled**" };
  }
  if (toggle === "off") {
    updateSettings(sessionId, { verbose: false });
    return { handled: true, consumed: true, response: "Verbose mode **disabled**" };
  }

  updateSettings(sessionId, { verbose: !settings.verbose });
  return {
    handled: true,
    consumed: true,
    response: `Verbose mode ${settings.verbose ? "**enabled**" : "**disabled**"}`,
  };
}

function handleUsage(sessionId: string, mode?: string): CommandResult {
  const settings = getSettings(sessionId);
  const validModes: SessionSettings["usageDisplay"][] = ["off", "tokens", "full"];

  if (mode && validModes.includes(mode as SessionSettings["usageDisplay"])) {
    updateSettings(sessionId, { usageDisplay: mode as SessionSettings["usageDisplay"] });
    return { handled: true, consumed: true, response: `Usage display: **${mode}**` };
  }

  // Cycle through modes
  const currentIdx = validModes.indexOf(settings.usageDisplay);
  const newMode = validModes[(currentIdx + 1) % validModes.length]!;
  updateSettings(sessionId, { usageDisplay: newMode });
  return {
    handled: true,
    consumed: true,
    response: `Usage display: **${settings.usageDisplay}**`,
  };
}

// Shared elevated sessions set — exported for agent runtime to check
export const elevatedSessions = new Set<string>();

function handleElevated(sessionId: string, toggle?: string): CommandResult {
  const enabled = toggle === "on";
  if (enabled) {
    elevatedSessions.add(sessionId);
  } else {
    elevatedSessions.delete(sessionId);
  }
  logger.warn({ sessionId, elevated: enabled }, "Elevated mode toggled");
  return {
    handled: true,
    consumed: true,
    response: `Elevated bash mode ${enabled ? "**enabled** ⚠️ Commands can use sudo" : "**disabled**"}`,
  };
}

function handleHelp(): CommandResult {
  const lines = [
    "**Available Commands**",
    "`/status` — Show session info and settings",
    "`/new` or `/reset` — Clear conversation context",
    "`/compact` — Summarize and compress history",
    "`/think <level>` — Set reasoning depth (off/low/medium/high/xhigh)",
    "`/verbose on|off` — Toggle detailed output",
    "`/usage off|tokens|full` — Token usage display",
    "`/elevated on|off` — Toggle sudo for shell commands",
    "`/help` — Show this message",
  ];

  return { handled: true, consumed: true, response: lines.join("\n") };
}
