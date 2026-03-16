import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pino from "pino";

const logger = pino({ name: "heartbeat-checklist" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ChecklistItem {
  text: string;
  checked: boolean;
  line: number;
}

// ─── Regex Patterns ─────────────────────────────────────────────────────────

/**
 * Matches markdown checkbox items:
 * - [ ] unchecked item
 * - [x] checked item
 * - [X] checked item (uppercase)
 * With optional leading whitespace and list markers (-, *, +).
 */
const CHECKBOX_PATTERN = /^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/;

// ─── Parse Functions ────────────────────────────────────────────────────────

/**
 * Parse markdown content into a list of checklist items.
 */
export function parseChecklistContent(content: string): ChecklistItem[] {
  const lines = content.split("\n");
  const items: ChecklistItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const match = CHECKBOX_PATTERN.exec(line);

    if (match) {
      const [, checkChar, text] = match;
      items.push({
        text: text!.trim(),
        checked: checkChar === "x" || checkChar === "X",
        line: i + 1, // 1-indexed line number
      });
    }
  }

  return items;
}

/**
 * Read and parse the HEARTBEAT.md file from a workspace directory.
 *
 * @param workspacePath - Path to the workspace root directory.
 * @returns Array of checklist items found in HEARTBEAT.md.
 */
export async function readChecklist(workspacePath: string): Promise<ChecklistItem[]> {
  const heartbeatPath = join(workspacePath, "HEARTBEAT.md");

  try {
    const content = await readFile(heartbeatPath, "utf-8");
    const items = parseChecklistContent(content);

    logger.debug(
      { path: heartbeatPath, totalItems: items.length, checked: items.filter((i) => i.checked).length },
      "Parsed heartbeat checklist",
    );

    return items;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      logger.debug({ path: heartbeatPath }, "HEARTBEAT.md not found");
      return [];
    }

    logger.error(
      { path: heartbeatPath, error: String(error) },
      "Failed to read HEARTBEAT.md",
    );
    throw error;
  }
}
