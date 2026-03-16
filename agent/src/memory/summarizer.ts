// ─── Memory Summarizer ─────────────────────────────────────────────────────

import pino from "pino";
import type { MemoryEntry } from "@karna/shared/types/memory.js";
import type { ModelProvider, ChatMessage } from "../models/provider.js";

const logger = pino({ name: "memory-summarizer" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SummarizerConfig {
  /** Maximum tokens for the summary output. */
  maxSummaryTokens?: number;
  /** Model to use for summarization (should be fast/cheap). */
  model?: string;
}

const DEFAULT_MAX_SUMMARY_TOKENS = 500;
const DEFAULT_MODEL = "claude-haiku-4-20250514";

// ─── Summarize Memories ─────────────────────────────────────────────────────

/**
 * Compress a set of memories into a condensed summary.
 * Used for context window management when accumulated memories
 * exceed the available token budget.
 *
 * @param memories - The memory entries to summarize
 * @param provider - The LLM provider to use for summarization
 * @param config - Optional configuration
 * @returns A condensed text summary of the memories
 */
export async function summarizeMemories(
  memories: MemoryEntry[],
  provider: ModelProvider,
  config?: SummarizerConfig
): Promise<string> {
  if (memories.length === 0) {
    return "";
  }

  // If only one or two short memories, no need to summarize
  const totalContent = memories.map((m) => m.content).join("\n");
  if (totalContent.length < 500) {
    return totalContent;
  }

  const maxTokens = config?.maxSummaryTokens ?? DEFAULT_MAX_SUMMARY_TOKENS;
  const model = config?.model ?? DEFAULT_MODEL;

  const memoryTexts = memories
    .map((m, i) => {
      const tags = m.tags.length > 0 ? ` [${m.tags.join(", ")}]` : "";
      const priority = m.priority !== "normal" ? ` (${m.priority})` : "";
      return `${i + 1}. ${m.content}${tags}${priority}`;
    })
    .join("\n");

  const messages: ChatMessage[] = [
    {
      role: "user",
      content: `Summarize these memories into a concise paragraph that preserves the most important facts, preferences, and context. Focus on actionable information the agent should remember.\n\nMemories:\n${memoryTexts}`,
    },
  ];

  const systemPrompt =
    "You are a memory compression assistant. Produce a concise, factual summary. " +
    "Preserve key details, user preferences, important facts, and actionable context. " +
    "Do not add any information not present in the input. Respond with only the summary.";

  try {
    let summary = "";
    const stream = provider.chat({
      messages,
      systemPrompt,
      model,
      maxTokens,
      temperature: 0.1,
    });

    for await (const event of stream) {
      if (event.type === "text") {
        summary += event.text;
      }
    }

    logger.debug(
      { memoryCount: memories.length, summaryLength: summary.length },
      "Memories summarized"
    );

    return summary.trim();
  } catch (error) {
    logger.error({ error, memoryCount: memories.length }, "Memory summarization failed");
    // Fallback: return truncated concatenation
    return fallbackSummarize(memories, maxTokens * 4);
  }
}

/**
 * Summarize a conversation thread into a compact recap.
 * Used when conversation history exceeds the context window.
 */
export async function summarizeConversation(
  messages: ChatMessage[],
  provider: ModelProvider,
  config?: SummarizerConfig
): Promise<string> {
  if (messages.length === 0) return "";

  const maxTokens = config?.maxSummaryTokens ?? DEFAULT_MAX_SUMMARY_TOKENS;
  const model = config?.model ?? DEFAULT_MODEL;

  const transcript = messages
    .map((m) => `[${m.role}]: ${m.content}`)
    .join("\n");

  const summaryMessages: ChatMessage[] = [
    {
      role: "user",
      content: `Summarize this conversation, preserving key decisions, requests, and outcomes:\n\n${transcript}`,
    },
  ];

  const systemPrompt =
    "Summarize the conversation concisely. Include: what was discussed, " +
    "decisions made, tasks completed, and any pending items. Respond with only the summary.";

  try {
    let summary = "";
    const stream = provider.chat({
      messages: summaryMessages,
      systemPrompt,
      model,
      maxTokens,
      temperature: 0.1,
    });

    for await (const event of stream) {
      if (event.type === "text") {
        summary += event.text;
      }
    }

    return summary.trim();
  } catch (error) {
    logger.error({ error }, "Conversation summarization failed");
    return fallbackSummarize(
      messages.map((m) => ({ content: `[${m.role}]: ${m.content}` } as MemoryEntry)),
      maxTokens * 4
    );
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Fallback summarization when the LLM is unavailable.
 * Truncates and concatenates memory content.
 */
function fallbackSummarize(memories: Pick<MemoryEntry, "content">[], maxChars: number): string {
  const parts: string[] = [];
  let remaining = maxChars;

  for (const memory of memories) {
    if (remaining <= 0) break;

    const text = memory.content.slice(0, remaining);
    parts.push(text);
    remaining -= text.length + 2; // +2 for separator
  }

  return parts.join("; ");
}
