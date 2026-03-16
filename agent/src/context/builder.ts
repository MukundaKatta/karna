// ─── Context Builder ───────────────────────────────────────────────────────

import pino from "pino";
import type { MemoryEntry } from "@karna/shared/types/memory.js";
import type { SkillMetadata } from "@karna/shared/types/skill.js";
import type { ConversationMessage, Session } from "@karna/shared/types/session.js";
import type { ChatMessage } from "../models/provider.js";
import { buildSystemPrompt, type AgentPersona } from "./system-prompt.js";

const logger = pino({ name: "context-builder" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ContextBuilderConfig {
  /** Maximum total tokens for the context window. */
  maxContextTokens: number;
  /** Reserve this many tokens for the model's response. */
  reservedOutputTokens: number;
  /** Maximum number of conversation messages to include. */
  maxMessages: number;
  /** Maximum tokens for memory context. */
  maxMemoryTokens: number;
  /** Maximum tokens for skill instructions. */
  maxSkillTokens: number;
}

export interface BuildContextParams {
  session: Session;
  agent: AgentPersona;
  conversationHistory: ConversationMessage[];
  memories?: MemoryEntry[];
  skills?: SkillMetadata[];
  currentTime?: Date;
  customInstructions?: string;
}

export interface BuiltContext {
  /** The system prompt incorporating agent persona, memories, and skills. */
  systemPrompt: string;
  /** The conversation messages formatted for the model. */
  messages: ChatMessage[];
  /** Estimated total token count. */
  estimatedTokens: number;
  /** Whether the context was truncated to fit. */
  wasTruncated: boolean;
  /** Number of messages that were dropped during truncation. */
  droppedMessageCount: number;
}

const DEFAULT_CONFIG: ContextBuilderConfig = {
  maxContextTokens: 128_000,
  reservedOutputTokens: 4096,
  maxMessages: 100,
  maxMemoryTokens: 4000,
  maxSkillTokens: 2000,
};

// ─── Context Builder ────────────────────────────────────────────────────────

/**
 * Assemble the complete context (system prompt + messages) for an LLM call.
 *
 * Strategy:
 * 1. Build the system prompt with agent persona, memories, and skills.
 * 2. Convert conversation history to ChatMessage format.
 * 3. Estimate total tokens and truncate if needed.
 *    - Truncation removes older messages first, always keeping the
 *      most recent messages and the first system/user message.
 */
export function buildContext(
  params: BuildContextParams,
  config?: Partial<ContextBuilderConfig>
): BuiltContext {
  const cfg: ContextBuilderConfig = { ...DEFAULT_CONFIG, ...config };

  // 1. Build system prompt (with memory and skill sections)
  const memoriesForPrompt = params.memories
    ? truncateByTokens(params.memories, cfg.maxMemoryTokens)
    : undefined;
  const skillsForPrompt = params.skills
    ? truncateSkills(params.skills, cfg.maxSkillTokens)
    : undefined;

  const systemPrompt = buildSystemPrompt({
    agent: params.agent,
    memories: memoriesForPrompt,
    skills: skillsForPrompt,
    currentTime: params.currentTime,
    customInstructions: params.customInstructions,
  });

  // 2. Convert conversation history to ChatMessage format
  const allMessages = convertMessages(params.conversationHistory);

  // 3. Estimate tokens and truncate
  const systemPromptTokens = estimateTokens(systemPrompt);
  const availableForMessages = cfg.maxContextTokens - cfg.reservedOutputTokens - systemPromptTokens;

  const { messages, wasTruncated, droppedCount } = fitMessages(
    allMessages,
    availableForMessages,
    cfg.maxMessages
  );

  const messageTokens = messages.reduce(
    (sum, m) => sum + estimateTokens(m.content),
    0
  );

  const estimatedTokens = systemPromptTokens + messageTokens;

  if (wasTruncated) {
    logger.info(
      {
        totalMessages: allMessages.length,
        keptMessages: messages.length,
        droppedCount,
        estimatedTokens,
      },
      "Context truncated to fit window"
    );
  }

  return {
    systemPrompt,
    messages,
    estimatedTokens,
    wasTruncated,
    droppedMessageCount: droppedCount,
  };
}

// ─── Message Conversion ─────────────────────────────────────────────────────

function convertMessages(history: ConversationMessage[]): ChatMessage[] {
  return history.map((msg) => {
    const chatMsg: ChatMessage = {
      role: msg.role as ChatMessage["role"],
      content: msg.content,
    };

    if (msg.role === "tool" && msg.metadata) {
      chatMsg.toolCallId = msg.metadata.toolCallId;
      chatMsg.toolName = msg.metadata.toolName;
    }

    return chatMsg;
  });
}

// ─── Token Estimation ───────────────────────────────────────────────────────

/**
 * Estimate the token count for a piece of text.
 * Uses a rough heuristic of ~4 characters per token.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── Truncation Logic ───────────────────────────────────────────────────────

/**
 * Fit messages into a token budget.
 *
 * Strategy:
 * - Always keep the first message (often sets the context)
 * - Always keep the last N messages (most relevant)
 * - Remove messages from the middle when truncating
 */
function fitMessages(
  messages: ChatMessage[],
  tokenBudget: number,
  maxMessages: number
): { messages: ChatMessage[]; wasTruncated: boolean; droppedCount: number } {
  if (messages.length === 0) {
    return { messages: [], wasTruncated: false, droppedCount: 0 };
  }

  // Apply message count limit first
  let selected = messages;
  if (selected.length > maxMessages) {
    selected = selected.slice(-maxMessages);
  }

  // Check if all messages fit in the token budget
  const totalTokens = selected.reduce(
    (sum, m) => sum + estimateTokens(m.content) + 10, // +10 for message framing overhead
    0
  );

  if (totalTokens <= tokenBudget) {
    return {
      messages: selected,
      wasTruncated: selected.length < messages.length,
      droppedCount: messages.length - selected.length,
    };
  }

  // Need to truncate: keep first message and progressively add from the end
  const result: ChatMessage[] = [];
  let usedTokens = 0;

  // Reserve the first message if there are enough messages
  if (selected.length > 1) {
    const firstTokens = estimateTokens(selected[0].content) + 10;
    result.push(selected[0]);
    usedTokens += firstTokens;
  }

  // Add messages from the end (most recent first) until budget is exhausted
  const recentMessages: ChatMessage[] = [];
  for (let i = selected.length - 1; i >= 1; i--) {
    const msgTokens = estimateTokens(selected[i].content) + 10;
    if (usedTokens + msgTokens > tokenBudget) break;
    recentMessages.unshift(selected[i]);
    usedTokens += msgTokens;
  }

  result.push(...recentMessages);

  const keptCount = result.length;
  const droppedCount = messages.length - keptCount;

  // If we dropped middle messages, insert a summary marker
  if (result.length > 1 && result.length < selected.length) {
    const droppedMiddle = selected.length - result.length;
    if (droppedMiddle > 0) {
      result.splice(1, 0, {
        role: "system",
        content: `[${droppedMiddle} earlier messages omitted for context window management]`,
      });
    }
  }

  return {
    messages: result,
    wasTruncated: true,
    droppedCount,
  };
}

// ─── Memory Truncation ──────────────────────────────────────────────────────

/**
 * Truncate memory entries to fit within a token budget.
 * Keeps higher-priority and more recent memories.
 */
function truncateByTokens(memories: MemoryEntry[], maxTokens: number): MemoryEntry[] {
  const result: MemoryEntry[] = [];
  let usedTokens = 0;

  for (const memory of memories) {
    const text = memory.summary ?? memory.content;
    const tokens = estimateTokens(text) + 20; // overhead for formatting
    if (usedTokens + tokens > maxTokens) break;
    result.push(memory);
    usedTokens += tokens;
  }

  return result;
}

function truncateSkills(skills: SkillMetadata[], maxTokens: number): SkillMetadata[] {
  const result: SkillMetadata[] = [];
  let usedTokens = 0;

  for (const skill of skills) {
    const text = `${skill.name}: ${skill.description}`;
    const tokens = estimateTokens(text) + 50; // overhead for actions/triggers
    if (usedTokens + tokens > maxTokens) break;
    result.push(skill);
    usedTokens += tokens;
  }

  return result;
}
