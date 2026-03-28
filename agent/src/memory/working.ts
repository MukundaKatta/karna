// ─── Working Memory ──────────────────────────────────────────────────────────
// In-process memory for the current conversation turn.
// Manages the conversation buffer within a token budget.

import pino from "pino";

const logger = pino({ name: "working-memory" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WorkingMemoryMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: number;
  tokenCount?: number;
  metadata?: Record<string, unknown>;
}

export interface WorkingMemoryOptions {
  /** Maximum token budget for the conversation buffer. Default: 100,000 */
  maxTokens?: number;
  /** Number of recent messages to always preserve. Default: 4 */
  preserveRecentCount?: number;
}

// ─── Working Memory ────────────────────────────────────────────────────────

export class WorkingMemory {
  private messages: WorkingMemoryMessage[] = [];
  private readonly maxTokens: number;
  private readonly preserveRecentCount: number;
  private currentTokens = 0;
  private summary: string | null = null;

  constructor(options?: WorkingMemoryOptions) {
    this.maxTokens = options?.maxTokens ?? 100_000;
    this.preserveRecentCount = options?.preserveRecentCount ?? 4;
  }

  /**
   * Add a message to the working memory.
   */
  addMessage(message: WorkingMemoryMessage): void {
    const tokens = message.tokenCount ?? this.estimateTokens(message.content);
    message.tokenCount = tokens;
    this.messages.push(message);
    this.currentTokens += tokens;

    // Compact if over budget
    if (this.currentTokens > this.maxTokens) {
      this.compact();
    }
  }

  /**
   * Get all messages in the working memory.
   */
  getMessages(): WorkingMemoryMessage[] {
    return [...this.messages];
  }

  /**
   * Get the context window for the LLM, including any summary of older messages.
   */
  getContextWindow(): { summary: string | null; messages: WorkingMemoryMessage[] } {
    return {
      summary: this.summary,
      messages: [...this.messages],
    };
  }

  /**
   * Get current token usage.
   */
  get tokenUsage(): number {
    return this.currentTokens;
  }

  /**
   * Get message count.
   */
  get messageCount(): number {
    return this.messages.length;
  }

  /**
   * Set a summary of compacted older messages.
   */
  setSummary(summary: string): void {
    this.summary = summary;
  }

  /**
   * Clear all messages and summary.
   */
  clear(): void {
    this.messages = [];
    this.currentTokens = 0;
    this.summary = null;
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  /**
   * Compact the buffer by removing oldest messages, keeping the most recent ones.
   * In a full implementation, this would call an LLM to summarize removed messages.
   */
  private compact(): void {
    if (this.messages.length <= this.preserveRecentCount) return;

    const toRemove = this.messages.length - this.preserveRecentCount;
    const removed = this.messages.splice(0, toRemove);

    // Build a simple summary of removed messages
    const summaryParts = removed.map((m) => {
      const prefix = m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : m.role;
      const truncated = m.content.length > 200 ? m.content.slice(0, 200) + "..." : m.content;
      return `${prefix}: ${truncated}`;
    });

    const oldSummary = this.summary ? this.summary + "\n" : "";
    this.summary = oldSummary + "[Earlier in conversation]\n" + summaryParts.join("\n");

    // Recalculate tokens
    this.currentTokens = this.messages.reduce((sum, m) => sum + (m.tokenCount ?? 0), 0);

    logger.debug(
      { removed: toRemove, remaining: this.messages.length, tokens: this.currentTokens },
      "Working memory compacted",
    );
  }

  private estimateTokens(text: string): number {
    // Rough approximation: ~4 chars per token
    return Math.ceil(text.length / 4);
  }
}
