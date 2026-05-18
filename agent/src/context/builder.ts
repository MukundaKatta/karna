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
  /** Alias for maxMessages used by runtime/user-facing config. */
  maxContextMessages?: number;
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
  /** Number of tools that will be sent alongside the context (used for token budgeting). */
  toolCount?: number;
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
  maxMessages: 20,
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
  const cfg: ContextBuilderConfig = normalizeConfig(config);

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
  const estimatedToolTokens = (params.toolCount ?? 0) * 500;
  const availableForMessages = cfg.maxContextTokens - cfg.reservedOutputTokens - systemPromptTokens - estimatedToolTokens;

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

  const countDropped = Math.max(0, messages.length - maxMessages);
  const droppedByCount = countDropped > 0 ? messages.slice(0, countDropped) : [];
  let selected = countDropped > 0 ? messages.slice(-maxMessages) : messages;
  const countSummary = countDropped > 0 ? buildHistorySummary(droppedByCount) : null;

  // Check if all messages fit in the token budget
  const totalTokens = selected.reduce(
    (sum, m) => sum + estimateTokens(m.content) + 10, // +10 for message framing overhead
    0
  );

  if (totalTokens <= tokenBudget) {
    const result = countSummary ? [countSummary, ...selected] : selected;
    return {
      messages: result,
      wasTruncated: countDropped > 0,
      droppedCount: countDropped,
    };
  }

  // Need to truncate: keep first message and progressively add from the end
  const result: ChatMessage[] = countSummary ? [countSummary] : [];
  let usedTokens = 0;
  if (countSummary) {
    usedTokens += estimateTokens(countSummary.content) + 10;
  }

  // Reserve the first message if there are enough messages
  if (selected.length > 1 && !countSummary) {
    const firstTokens = estimateTokens(selected[0].content) + 10;
    result.push(selected[0]);
    usedTokens += firstTokens;
  }

  // Add messages from the end (most recent first) until budget is exhausted
  const recentMessages: ChatMessage[] = [];
  const recentStartIndex = countSummary ? 0 : 1;
  for (let i = selected.length - 1; i >= recentStartIndex; i--) {
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
    droppedCount: Math.max(droppedCount, countDropped),
  };
}

function normalizeConfig(config?: Partial<ContextBuilderConfig>): ContextBuilderConfig {
  const merged: ContextBuilderConfig = { ...DEFAULT_CONFIG, ...config };
  const maxContextMessages = config?.maxContextMessages ?? config?.maxMessages ?? resolveEnvMaxContextMessages();
  return {
    ...merged,
    maxMessages: maxContextMessages,
    maxContextMessages,
  };
}

function resolveEnvMaxContextMessages(): number {
  const raw = process.env["MAX_CONTEXT_MESSAGES"] ?? process.env["KARNA_MAX_CONTEXT_MESSAGES"];
  if (raw === undefined || raw === null || raw === "") {
    return DEFAULT_CONFIG.maxMessages;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return DEFAULT_CONFIG.maxMessages;
  }
  return parsed;
}

function buildHistorySummary(messages: ChatMessage[]): ChatMessage {
  const lines = messages.slice(-12).map((message, index) => {
    const content = message.content.replace(/\s+/g, " ").trim();
    const preview = content.length > 180 ? `${content.slice(0, 177)}...` : content;
    return `${index + 1}. ${message.role}: ${preview}`;
  });

  return {
    role: "system",
    content: [
      `[Conversation compacted: ${messages.length} older messages summarized to control context size.]`,
      "Recent summary of older context:",
      ...lines,
    ].join("\n"),
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
