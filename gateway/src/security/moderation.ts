// ─── AI Response Moderation ────────────────────────────────────────────────

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import pino from "pino";

const logger = pino({ name: "content-moderation" });

export type ModerationLevel = "off" | "moderate" | "strict";

export interface ModerationResult {
  level: ModerationLevel;
  allowed: boolean;
  content: string;
  originalContentHash?: string;
  reasons: string[];
}

export interface ModerationLogEvent {
  id?: string;
  sessionId: string;
  messageId?: string;
  agentId?: string;
  model?: string;
  level: ModerationLevel;
  reasons: string[];
  originalContentHash: string;
  originalContent?: string;
  replacementContent: string;
  timestamp: number;
}

export interface ModerationReportEvent {
  id: string;
  sessionId: string;
  messageId?: string;
  reason: string;
  details?: string;
  reporterId?: string;
  content?: string;
  contentHash?: string;
  timestamp: number;
}

export interface ModerationReviewItem {
  kind: "filtered" | "reported";
  id: string;
  sessionId: string;
  messageId?: string;
  timestamp: number;
  reasons: string[];
  level?: ModerationLevel;
  contentHash?: string;
  content?: string;
  replacementContent?: string;
  reporterId?: string;
  details?: string;
}

const SAFE_REPLACEMENT =
  "I can't provide that response because it may contain unsafe or sensitive content. Please rephrase the request.";

const PROFANITY_PATTERNS = [
  /\bfuck(?:ing|er|ed)?\b/i,
  /\bshit(?:ty)?\b/i,
  /\bbitch\b/i,
  /\basshole\b/i,
];

const HARMFUL_PATTERNS = [
  /\b(build|make|create)\s+(a\s+)?(bomb|explosive|bioweapon)\b/i,
  /\bhow\s+to\s+(kill|harm|poison|stab)\b/i,
  /\bself[-\s]?harm\b/i,
];

const PII_PATTERNS = [
  /\b\d{3}-\d{2}-\d{4}\b/,
  /\b(?:\d[ -]*?){13,16}\b/,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*["']?[A-Za-z0-9_\-]{16,}/i,
];

const PROMPT_OUTPUT_PATTERNS = [
  /\b(system prompt|developer message|hidden instructions)\b/i,
  /\bYou are ChatGPT\b/i,
  /\bBEGIN\s+(SYSTEM|DEVELOPER)\s+MESSAGE\b/i,
  /<\s*(system|developer)\s*>/i,
];

export function resolveModerationLevel(raw = process.env["KARNA_MODERATION_LEVEL"]): ModerationLevel {
  if (raw === "off" || raw === "strict") return raw;
  return "moderate";
}

export function moderateGeneratedContent(
  content: string,
  level = resolveModerationLevel(),
): ModerationResult {
  if (level === "off") {
    return { level, allowed: true, content, reasons: [] };
  }

  const reasons = detectModerationReasons(content, level);
  if (reasons.length === 0) {
    return { level, allowed: true, content, reasons };
  }

  return {
    level,
    allowed: false,
    content: SAFE_REPLACEMENT,
    originalContentHash: hashContent(content),
    reasons,
  };
}

export async function logModerationEvent(event: ModerationLogEvent): Promise<void> {
  const persisted = {
    ...event,
    id: event.id ?? hashContent(`${event.sessionId}:${event.timestamp}:${event.originalContentHash}`),
  };
  logger.warn(
    {
      sessionId: persisted.sessionId,
      agentId: persisted.agentId,
      model: persisted.model,
      level: persisted.level,
      reasons: persisted.reasons,
      originalContentHash: persisted.originalContentHash,
      originalContent: persisted.originalContent,
    },
    "Filtered generated AI response",
  );

  const dir = getModerationLogDir();
  await mkdir(dir, { recursive: true });
  await appendFile(join(dir, "filtered.jsonl"), JSON.stringify(persisted) + "\n", "utf-8");
}

export async function logModerationReport(event: ModerationReportEvent): Promise<void> {
  logger.warn(
    {
      sessionId: event.sessionId,
      messageId: event.messageId,
      reason: event.reason,
      reporterId: event.reporterId,
      contentHash: event.contentHash,
    },
    "User reported generated AI response",
  );

  const dir = getModerationLogDir();
  await mkdir(dir, { recursive: true });
  await appendFile(join(dir, "reports.jsonl"), JSON.stringify(event) + "\n", "utf-8");
}

export async function listModerationReviewItems(limit = 100): Promise<ModerationReviewItem[]> {
  const [filtered, reports] = await Promise.all([
    readJsonLines<ModerationLogEvent & { id?: string }>("filtered.jsonl"),
    readJsonLines<ModerationReportEvent>("reports.jsonl"),
  ]);

  return [
    ...filtered.map((event) => ({
      kind: "filtered" as const,
      id: event.id ?? hashContent(`${event.sessionId}:${event.timestamp}:${event.originalContentHash}`),
      sessionId: event.sessionId,
      messageId: event.messageId,
      timestamp: event.timestamp,
      reasons: event.reasons,
      level: event.level,
      contentHash: event.originalContentHash,
      content: event.originalContent,
      replacementContent: event.replacementContent,
    })),
    ...reports.map((event) => ({
      kind: "reported" as const,
      id: event.id,
      sessionId: event.sessionId,
      messageId: event.messageId,
      timestamp: event.timestamp,
      reasons: [event.reason],
      contentHash: event.contentHash,
      content: event.content,
      reporterId: event.reporterId,
      details: event.details,
    })),
  ]
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, limit);
}

export function shouldLogModerationContent(): boolean {
  return process.env["KARNA_MODERATION_LOG_CONTENT"] === "true";
}

function detectModerationReasons(content: string, level: ModerationLevel): string[] {
  const reasons = new Set<string>();

  collectMatches(content, PII_PATTERNS, "pii_leakage", reasons);
  collectMatches(content, HARMFUL_PATTERNS, "harmful_content", reasons);
  collectMatches(content, PROMPT_OUTPUT_PATTERNS, "prompt_injection_output", reasons);

  if (level === "strict") {
    collectMatches(content, PROFANITY_PATTERNS, "profanity", reasons);
  }

  return Array.from(reasons);
}

function collectMatches(
  content: string,
  patterns: RegExp[],
  reason: string,
  reasons: Set<string>,
): void {
  if (patterns.some((pattern) => pattern.test(content))) {
    reasons.add(reason);
  }
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function hashModerationContent(content: string): string {
  return hashContent(content);
}

function getModerationLogDir(): string {
  return process.env["KARNA_MODERATION_LOG_DIR"] ?? join(homedir(), ".karna", "moderation");
}

async function readJsonLines<T>(fileName: string): Promise<T[]> {
  try {
    const content = await readFile(join(getModerationLogDir(), fileName), "utf-8");
    return content
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return [];
    throw error;
  }
}
