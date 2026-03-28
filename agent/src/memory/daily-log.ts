// ─── Daily Memory Logs ──────────────────────────────────────────────────────
// Stores daily conversation summaries and observations as Markdown files.
// Format: memory/YYYY-MM-DD.md
// Like OpenClaw's date-stamped memory system.

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pino from "pino";

const logger = pino({ name: "daily-memory-log" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DailyLogEntry {
  time: string;
  type: "conversation" | "observation" | "decision" | "tool_result" | "fact";
  content: string;
  sessionId?: string;
  tags?: string[];
}

// ─── Daily Log Manager ─────────────────────────────────────────────────────

export class DailyLogManager {
  private readonly basePath: string;

  constructor(basePath: string) {
    this.basePath = join(basePath, "memory");
    mkdirSync(this.basePath, { recursive: true });
  }

  /**
   * Append an entry to today's log.
   */
  append(entry: DailyLogEntry): void {
    const date = new Date().toISOString().split("T")[0]!;
    const filePath = join(this.basePath, `${date}.md`);

    const tags = entry.tags?.length ? ` [${entry.tags.join(", ")}]` : "";
    const session = entry.sessionId ? ` (session: ${entry.sessionId.slice(0, 8)})` : "";
    const line = `- **${entry.time}** [${entry.type}]${tags}${session}: ${entry.content}\n`;

    // Create file with header if it doesn't exist, then append atomically
    if (!existsSync(filePath)) {
      const header = `# Daily Log — ${date}\n\n`;
      writeFileSync(filePath, header + line, "utf-8");
    } else {
      appendFileSync(filePath, line, "utf-8");
    }

    logger.debug({ date, type: entry.type }, "Daily log entry appended");
  }

  /**
   * Log a conversation summary.
   */
  logConversation(summary: string, sessionId?: string): void {
    this.append({
      time: new Date().toLocaleTimeString("en-US", { hour12: false }),
      type: "conversation",
      content: summary,
      sessionId,
    });
  }

  /**
   * Log an observation or fact learned.
   */
  logObservation(content: string, tags?: string[]): void {
    this.append({
      time: new Date().toLocaleTimeString("en-US", { hour12: false }),
      type: "observation",
      content,
      tags,
    });
  }

  /**
   * Log a decision made.
   */
  logDecision(content: string, tags?: string[]): void {
    this.append({
      time: new Date().toLocaleTimeString("en-US", { hour12: false }),
      type: "decision",
      content,
      tags,
    });
  }

  /**
   * Read today's log.
   */
  readToday(): string | null {
    const date = new Date().toISOString().split("T")[0]!;
    return this.readDate(date);
  }

  /**
   * Read a specific date's log.
   */
  readDate(date: string): string | null {
    const filePath = join(this.basePath, `${date}.md`);
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, "utf-8");
  }

  /**
   * Read recent logs (last N days).
   */
  readRecent(days = 7): Array<{ date: string; content: string }> {
    const results: Array<{ date: string; content: string }> = [];

    if (!existsSync(this.basePath)) return results;

    const files = readdirSync(this.basePath)
      .filter((f) => f.match(/^\d{4}-\d{2}-\d{2}\.md$/))
      .sort()
      .reverse()
      .slice(0, days);

    for (const file of files) {
      const date = file.replace(".md", "");
      const content = readFileSync(join(this.basePath, file), "utf-8");
      results.push({ date, content });
    }

    return results;
  }

  /**
   * Get the context string for recent logs (for system prompt injection).
   */
  getRecentContext(days = 3): string {
    const recent = this.readRecent(days);
    if (recent.length === 0) return "";

    return `## Recent Activity Log\n\n${recent.map((r) => r.content).join("\n")}`;
  }
}
