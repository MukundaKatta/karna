// ─── Workspace Config Loader ────────────────────────────────────────────────
// Auto-loads personality, instructions, and configuration from Markdown files
// in the workspace directory. Inspired by OpenClaw's 8-file config system.
//
// Supported files:
//   SOUL.md      — Personality, tone, behavioral boundaries
//   AGENTS.md    — Operating contract, priorities, workflow
//   USER.md      — User-specific knowledge and preferences
//   TOOLS.md     — Instructions for tool usage
//   IDENTITY.md  — Agent identity metadata
//   HEARTBEAT.md — Scheduled tasks in plain English
//   BOOTSTRAP.md — Initialization instructions (run once on first connect)
//   MEMORY.md    — Curated long-term memory (durable facts, decisions)

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import pino from "pino";

const logger = pino({ name: "workspace-loader" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WorkspaceConfig {
  /** Agent personality, tone, boundaries */
  soul: string | null;
  /** Operating contract, priorities */
  agents: string | null;
  /** User-specific knowledge */
  user: string | null;
  /** Tool usage instructions */
  tools: string | null;
  /** Agent identity metadata */
  identity: string | null;
  /** Scheduled tasks */
  heartbeat: string | null;
  /** Init instructions (run once) */
  bootstrap: string | null;
  /** Curated long-term memory */
  memory: string | null;
  /** The workspace path that was loaded */
  workspacePath: string;
  /** Files that were found */
  loadedFiles: string[];
}

const CONFIG_FILES: Array<{ key: keyof Omit<WorkspaceConfig, "workspacePath" | "loadedFiles">; filename: string }> = [
  { key: "soul", filename: "SOUL.md" },
  { key: "agents", filename: "AGENTS.md" },
  { key: "user", filename: "USER.md" },
  { key: "tools", filename: "TOOLS.md" },
  { key: "identity", filename: "IDENTITY.md" },
  { key: "heartbeat", filename: "HEARTBEAT.md" },
  { key: "bootstrap", filename: "BOOTSTRAP.md" },
  { key: "memory", filename: "MEMORY.md" },
];

// ─── Loader ─────────────────────────────────────────────────────────────────

/**
 * Load all workspace configuration files from a directory.
 * Missing files result in null values (not errors).
 */
export function loadWorkspaceConfig(workspacePath: string): WorkspaceConfig {
  const config: WorkspaceConfig = {
    soul: null,
    agents: null,
    user: null,
    tools: null,
    identity: null,
    heartbeat: null,
    bootstrap: null,
    memory: null,
    workspacePath,
    loadedFiles: [],
  };

  for (const { key, filename } of CONFIG_FILES) {
    const filePath = join(workspacePath, filename);
    if (existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, "utf-8").trim();
        if (content.length > 0) {
          (config as unknown as Record<string, unknown>)[key] = content;
          config.loadedFiles.push(filename);
        }
      } catch (error) {
        logger.warn({ filePath, error: String(error) }, `Failed to read ${filename}`);
      }
    }
  }

  logger.info(
    { workspacePath, loadedFiles: config.loadedFiles },
    `Workspace config loaded (${config.loadedFiles.length}/${CONFIG_FILES.length} files)`,
  );

  return config;
}

/**
 * Build a system prompt section from workspace config.
 * Only includes sections that have content.
 */
export function workspaceToPromptSections(config: WorkspaceConfig): string {
  const sections: string[] = [];

  if (config.soul) {
    sections.push(`## Personality & Soul\n${config.soul}`);
  }

  if (config.identity) {
    sections.push(`## Identity\n${config.identity}`);
  }

  if (config.agents) {
    sections.push(`## Operating Instructions\n${config.agents}`);
  }

  if (config.user) {
    sections.push(`## User Context\n${config.user}`);
  }

  if (config.tools) {
    sections.push(`## Tool Usage Guidelines\n${config.tools}`);
  }

  if (config.memory) {
    sections.push(`## Curated Memory\n${config.memory}`);
  }

  if (config.bootstrap) {
    sections.push(`## Bootstrap (Initialization)\n${config.bootstrap}`);
  }

  return sections.join("\n\n");
}

/**
 * Parse HEARTBEAT.md into scheduled task descriptions.
 * Each line starting with "- " or "* " is a task.
 */
export function parseHeartbeatTasks(heartbeat: string): Array<{ description: string; schedule?: string }> {
  const lines = heartbeat.split("\n");
  const tasks: Array<{ description: string; schedule?: string }> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("- ") && !trimmed.startsWith("* ")) continue;

    const text = trimmed.slice(2).trim();
    if (!text) continue;

    // Try to extract schedule from brackets: [every 4h] Check emails
    const scheduleMatch = text.match(/^\[([^\]]+)\]\s*(.+)$/);
    if (scheduleMatch) {
      tasks.push({
        schedule: scheduleMatch[1]!.trim(),
        description: scheduleMatch[2]!.trim(),
      });
    } else {
      tasks.push({ description: text });
    }
  }

  return tasks;
}
