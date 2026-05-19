import { appendFile, readFile, mkdir, unlink, stat, rename, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import pino from "pino";
import type { ConversationMessage } from "@karna/shared/types/session.js";

const logger = pino({ name: "session-store" });

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_MAX_TRANSCRIPT_BYTES = 10 * 1024 * 1024;
const DEFAULT_RETENTION_DAYS = 30;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

// ─── Write Lock ────────────────────────────────────────────────────────────

/**
 * Simple per-session write lock to prevent concurrent transcript writes
 * from interleaving or corrupting JSONL files.
 */
const writeLocks = new Map<string, Promise<void>>();

async function withWriteLock(sessionId: string, fn: () => Promise<void>): Promise<void> {
  const previous = writeLocks.get(sessionId) ?? Promise.resolve();
  const current = previous.then(fn, fn);
  writeLocks.set(sessionId, current);
  try {
    await current;
  } finally {
    // Clean up the lock entry if it's still pointing to our promise
    if (writeLocks.get(sessionId) === current) {
      writeLocks.delete(sessionId);
    }
  }
}

// ─── Directory Initialization ───────────────────────────────────────────────

const initializedDirs = new Set<string>();

async function ensureSessionsDir(): Promise<void> {
  const sessionsDir = getSessionsDir();
  if (initializedDirs.has(sessionsDir)) return;

  try {
    if (!existsSync(sessionsDir)) {
      await mkdir(sessionsDir, { recursive: true });
      logger.info({ dir: sessionsDir }, "Created sessions directory");
    }
    initializedDirs.add(sessionsDir);
  } catch (error) {
    logger.error({ error: String(error), dir: getSessionsDir() }, "Failed to create sessions directory");
    throw error;
  }
}

function getTranscriptPath(sessionId: string): string {
  // Sanitize sessionId to prevent path traversal
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(getSessionsDir(), `${safeId}.jsonl`);
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

  await withWriteLock(sessionId, async () => {
    const filePath = getTranscriptPath(sessionId);

    try {
      const line = JSON.stringify(message) + "\n";
      await rotateTranscriptIfNeeded(filePath, Buffer.byteLength(line, "utf-8"));
      await appendFile(filePath, line, "utf-8");
      cleanupExpiredTranscriptsSoon();
      logger.debug({ sessionId, messageId: message.id }, "Appended message to transcript");
    } catch (error) {
      logger.error(
        { sessionId, error: String(error), filePath },
        "Failed to append to transcript",
      );
      throw error;
    }
  });
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

  try {
    const files = await listTranscriptFiles(sessionId);
    const lines: string[] = [];
    for (const filePath of files) {
      const content = await readFile(filePath, "utf-8");
      lines.push(...content.trim().split("\n").filter(Boolean));
    }

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
      { sessionId, error: String(error) },
      "Failed to read transcript",
    );
    throw error;
  }
}

/**
 * Get the total message count for a session without loading all messages.
 */
export async function getTranscriptLength(sessionId: string): Promise<number | null> {
  await ensureSessionsDir();

  try {
    const files = await listTranscriptFiles(sessionId);
    if (files.length === 0) return null;
    let total = 0;
    for (const filePath of files) {
      const content = await readFile(filePath, "utf-8");
      total += content.trim().split("\n").filter(Boolean).length;
    }
    return total;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Delete a session transcript file. Returns true if a file was removed.
 */
export async function deleteTranscript(sessionId: string): Promise<boolean> {
  await ensureSessionsDir();

  const files = await listTranscriptFiles(sessionId);
  if (files.length === 0) return false;
  let removed = false;
  try {
    await Promise.all(
      files.map(async (filePath) => {
        await unlink(filePath);
        removed = true;
      }),
    );
    logger.info({ sessionId }, "Deleted transcript");
    return removed;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return removed;
    }
    logger.error(
      { sessionId, error: String(error) },
      "Failed to delete transcript",
    );
    throw error;
  }
}

/**
 * Remove transcript segments older than the configured retention window.
 */
export async function cleanupExpiredTranscripts(now = Date.now()): Promise<number> {
  await ensureSessionsDir();

  const retentionDays = parsePositiveEnvInt("KARNA_TRANSCRIPT_RETENTION_DAYS", DEFAULT_RETENTION_DAYS);
  if (retentionDays <= 0) return 0;

  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  const files = await readdir(getSessionsDir());
  let removed = 0;

  for (const fileName of files) {
    if (!fileName.endsWith(".jsonl")) continue;

    const filePath = join(getSessionsDir(), fileName);
    const stats = await stat(filePath);
    if (stats.mtimeMs >= cutoff) continue;

    await unlink(filePath);
    removed++;
  }

  if (removed > 0) {
    logger.info({ removed, retentionDays }, "Removed expired transcript files");
  }

  return removed;
}

let lastCleanupAt = 0;

async function rotateTranscriptIfNeeded(filePath: string, nextBytes: number): Promise<void> {
  const maxBytes = parsePositiveEnvInt("KARNA_TRANSCRIPT_MAX_BYTES", DEFAULT_MAX_TRANSCRIPT_BYTES);
  if (!existsSync(filePath)) return;

  const stats = await stat(filePath);
  if (stats.size + nextBytes <= maxBytes) return;

  const dir = getSessionsDir();
  const activeName = basename(filePath, ".jsonl");
  const rotatedPath = join(dir, `${activeName}.${Date.now()}.jsonl`);
  await rename(filePath, rotatedPath);
  logger.info({ filePath, rotatedPath, maxBytes }, "Rotated session transcript");
}

async function listTranscriptFiles(sessionId: string): Promise<string[]> {
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const sessionsDir = getSessionsDir();
  const files = await readdir(sessionsDir);
  const prefix = `${safeId}.`;
  return files
    .filter((fileName) => fileName === `${safeId}.jsonl` || (fileName.startsWith(prefix) && fileName.endsWith(".jsonl")))
    .sort((left, right) => segmentSortKey(left, safeId) - segmentSortKey(right, safeId))
    .map((fileName) => join(sessionsDir, fileName));
}

function segmentSortKey(fileName: string, safeId: string): number {
  if (fileName === `${safeId}.jsonl`) return Number.MAX_SAFE_INTEGER;
  const match = fileName.match(/\.(\d+)\.jsonl$/);
  return match ? Number(match[1]) : 0;
}

function getSessionsDir(): string {
  return process.env["KARNA_TRANSCRIPT_DIR"] ?? join(homedir(), ".karna", "transcripts");
}

function parsePositiveEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function cleanupExpiredTranscriptsSoon(): void {
  const now = Date.now();
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = now;
  cleanupExpiredTranscripts(now).catch((error) => {
    logger.warn({ error: String(error) }, "Transcript retention cleanup failed");
  });
}
