import pino from "pino";
import type { ConversationMessage } from "@karna/shared/types/session.js";

const logger = pino({ name: "session-compactor" });

// ─── Token Estimation ───────────────────────────────────────────────────────

/**
 * Rough token count estimation: ~4 characters per token.
 * This is a fast heuristic; for production accuracy, use a proper tokenizer.
 */
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate the total token count of a message array.
 */
export function estimateMessagesTokenCount(messages: ConversationMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    // Account for role/metadata overhead (~20 tokens per message)
    total += estimateTokenCount(msg.content) + 20;
  }
  return total;
}

// ─── Compaction ─────────────────────────────────────────────────────────────

/**
 * Compact a conversation's messages to fit within a maximum token budget.
 *
 * Strategy:
 * 1. Always keep the system prompt (first message if role=system).
 * 2. Always keep the most recent N messages verbatim.
 * 3. Summarize older messages into a single condensed "system" message.
 *
 * @param messages - The full message history, ordered chronologically.
 * @param maxTokens - The maximum token budget for the compacted result.
 * @returns Compacted messages fitting within the token budget.
 */
export function compactSession(
  messages: ConversationMessage[],
  maxTokens: number,
): ConversationMessage[] {
  if (messages.length === 0) return [];

  const currentTokenCount = estimateMessagesTokenCount(messages);

  // If we're already within budget, return as-is
  if (currentTokenCount <= maxTokens) {
    logger.debug(
      { messageCount: messages.length, tokens: currentTokenCount, maxTokens },
      "Messages already within token budget",
    );
    return messages;
  }

  logger.info(
    { messageCount: messages.length, tokens: currentTokenCount, maxTokens },
    "Compacting session messages",
  );

  // Separate system prompt from conversation
  const systemMessages: ConversationMessage[] = [];
  const conversationMessages: ConversationMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      systemMessages.push(msg);
    } else {
      conversationMessages.push(msg);
    }
  }

  // Reserve tokens for system prompt
  const systemTokens = estimateMessagesTokenCount(systemMessages);
  const availableTokens = maxTokens - systemTokens;

  if (availableTokens <= 0) {
    logger.warn("System prompt alone exceeds token budget");
    return systemMessages.slice(0, 1);
  }

  // Calculate how many recent messages we can keep verbatim
  const recentMessages: ConversationMessage[] = [];
  let recentTokens = 0;
  // Reserve ~25% of available budget for the summary
  const summaryBudget = Math.floor(availableTokens * 0.25);
  const recentBudget = availableTokens - summaryBudget;

  // Walk backwards through conversation to find how many we can keep
  for (let i = conversationMessages.length - 1; i >= 0; i--) {
    const msg = conversationMessages[i]!;
    const msgTokens = estimateTokenCount(msg.content) + 20;

    if (recentTokens + msgTokens > recentBudget) {
      break;
    }

    recentMessages.unshift(msg);
    recentTokens += msgTokens;
  }

  // Summarize older messages
  const oldMessages = conversationMessages.slice(
    0,
    conversationMessages.length - recentMessages.length,
  );

  const result: ConversationMessage[] = [...systemMessages];

  if (oldMessages.length > 0) {
    const summary = createSummary(oldMessages);
    const summaryMessage: ConversationMessage = {
      id: `summary-${Date.now()}`,
      sessionId: messages[0]!.sessionId,
      role: "system",
      content: summary,
      timestamp: oldMessages[oldMessages.length - 1]!.timestamp,
      metadata: {
        model: "compactor",
      },
    };
    result.push(summaryMessage);
  }

  result.push(...recentMessages);

  const finalTokens = estimateMessagesTokenCount(result);
  logger.info(
    {
      originalMessages: messages.length,
      compactedMessages: result.length,
      summarizedMessages: oldMessages.length,
      keptVerbatim: recentMessages.length,
      originalTokens: currentTokenCount,
      compactedTokens: finalTokens,
    },
    "Session compaction complete",
  );

  return result;
}

// ─── Summary Generation ─────────────────────────────────────────────────────

/**
 * Create a concise summary of a set of messages.
 * This is a local heuristic summarizer. For higher quality,
 * this could be replaced with an LLM-based summarization call.
 */
function createSummary(messages: ConversationMessage[]): string {
  const parts: string[] = [
    `[Conversation summary — ${messages.length} messages compacted]`,
  ];

  // Extract key topics by looking at user messages
  const userMessages = messages.filter((m) => m.role === "user");
  const assistantMessages = messages.filter((m) => m.role === "assistant");
  const toolMessages = messages.filter((m) => m.role === "tool");

  if (userMessages.length > 0) {
    parts.push(`\nUser discussed ${userMessages.length} topics:`);
    // Include truncated versions of user messages
    for (const msg of userMessages.slice(0, 10)) {
      const truncated =
        msg.content.length > 150
          ? msg.content.slice(0, 150) + "..."
          : msg.content;
      parts.push(`- ${truncated}`);
    }
    if (userMessages.length > 10) {
      parts.push(`- ... and ${userMessages.length - 10} more messages`);
    }
  }

  if (assistantMessages.length > 0) {
    parts.push(
      `\nAssistant provided ${assistantMessages.length} responses.`,
    );
  }

  if (toolMessages.length > 0) {
    const toolNames = new Set(
      toolMessages
        .map((m) => m.metadata?.toolName)
        .filter(Boolean),
    );
    parts.push(
      `\nTools used: ${[...toolNames].join(", ") || "various tools"} (${toolMessages.length} calls)`,
    );
  }

  return parts.join("\n");
}
