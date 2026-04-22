import { appendFile, readFile, mkdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import type { ConversationMessage } from "@karna/shared/types/session.js";

const logger = pino({ name: "session-store" });

// ─── Constants ──────────────────────────────────────────────────────────────

const SESSIONS_DIR = join(homedir(), ".karna", "sessions");

// ─── Directory Initialization ───────────────────────────────────────────────

let dirInitialized = false;

async function ensureSessionsDir(): Promise<void> {
  if (dirInitialized) return;

  try {
    if (!existsSync(SESSIONS_DIR)) {
      await mkdir(SESSIONS_DIR, { recursive: true });
      logger.info({ dir: SESSIONS_DIR }, "Created sessions directory");
    }
    dirInitialized = true;
  } catch (error) {
    logger.error({ error: String(error), dir: SESSIONS_DIR }, "Failed to create sessions directory");
    throw error;
  }
}

function getTranscriptPath(sessionId: string): string {
  // Sanitize sessionId to prevent path traversal
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(SESSIONS_DIR, `${safeId}.jsonl`);
}

// ─── Write Operations ───────────────────────────────────────────────────────

/**
 * Append a conversation message to the session's JSONL transcript file.
 */
export async function appendToTranscript(
  sessionId: string,
  message: ConversationMessage,
): Promise<void> {
  await ensureSessionsDir();

  const filePath = getTranscriptPath(sessionId);

  try {
    const line = JSON.stringify(message) + "\n";
    await appendFile(filePath, line, "utf-8");
    logger.debug({ sessionId, messageId: message.id }, "Appended message to transcript");
  } catch (error) {
    logger.error(
      { sessionId, error: String(error), filePath },
      "Failed to append to transcript",
    );
    throw error;
  }
}

// ─── Read Operations ────────────────────────────────────────────────────────

/**
 * Read a session's transcript, optionally limiting to the most recent N messages.
 *
 * @param sessionId - The session ID
 * @param limit - Maximum number of messages to return (from the end). If undefined, returns all.
 * @returns Array of conversation messages, ordered chronologically.
 */
export async function readTranscript(
  sessionId: string,
  limit?: number,
): Promise<ConversationMessage[]> {
  await ensureSessionsDir();

  const filePath = getTranscriptPath(sessionId);

  try {
    const content = await readFile(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    const messages: ConversationMessage[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as ConversationMessage;
        messages.push(parsed);
      } catch (parseError) {
        logger.warn(
          { sessionId, error: String(parseError), line: line.slice(0, 100) },
          "Skipping malformed transcript line",
        );
      }
    }

    if (limit !== undefined && limit > 0 && messages.length > limit) {
      return messages.slice(-limit);
    }

    return messages;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      logger.debug({ sessionId }, "No transcript file found");
      return [];
    }
    logger.error(
      { sessionId, error: String(error), filePath },
      "Failed to read transcript",
    );
    throw error;
  }
}

/**
 * Get the total message count for a session without loading all messages.
 */
export async function getTranscriptLength(sessionId: string): Promise<number> {
  await ensureSessionsDir();

  const filePath = getTranscriptPath(sessionId);

  try {
    const content = await readFile(filePath, "utf-8");
    return content.trim().split("\n").filter(Boolean).length;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return 0;
    throw error;
  }
}

/**
 * Delete a session transcript file. Returns true if a file was removed.
 */
export async function deleteTranscript(sessionId: string): Promise<boolean> {
  await ensureSessionsDir();

  const filePath = getTranscriptPath(sessionId);

  try {
    await unlink(filePath);
    logger.info({ sessionId }, "Deleted transcript");
    return true;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return false;
    }
    logger.error(
      { sessionId, error: String(error), filePath },
      "Failed to delete transcript",
    );
    throw error;
  }
}
