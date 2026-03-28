// ─── Feedback Collector ───────────────────────────────────────────────────
//
// Collects explicit and implicit feedback signals from user interactions.
// Explicit: thumbs up/down, regenerate requests
// Implicit: corrections, conversation abandonment, response edits
//
// ──────────────────────────────────────────────────────────────────────────

import pino from "pino";
import { randomUUID } from "crypto";

const logger = pino({ name: "feedback-collector" });

export type FeedbackType =
  | "thumbs_up"
  | "thumbs_down"
  | "regenerate"
  | "correction"
  | "abandonment"
  | "follow_up";

export interface FeedbackEntry {
  id: string;
  sessionId: string;
  agentId: string;
  messageId: string;
  type: FeedbackType;
  value: number; // -1.0 to 1.0
  context: {
    userMessage: string;
    assistantMessage: string;
    model: string;
    toolsUsed: string[];
  };
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export interface FeedbackStats {
  totalFeedback: number;
  positiveRate: number;
  negativeRate: number;
  regenerateRate: number;
  topIssues: { pattern: string; count: number }[];
}

/**
 * Collects and analyzes user feedback for agent self-improvement.
 */
export class FeedbackCollector {
  private readonly entries: FeedbackEntry[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries = 5000) {
    this.maxEntries = maxEntries;
  }

  /**
   * Record explicit feedback (thumbs up/down).
   */
  recordExplicit(
    sessionId: string,
    agentId: string,
    messageId: string,
    type: "thumbs_up" | "thumbs_down",
    context: FeedbackEntry["context"]
  ): FeedbackEntry {
    const entry: FeedbackEntry = {
      id: randomUUID(),
      sessionId,
      agentId,
      messageId,
      type,
      value: type === "thumbs_up" ? 1.0 : -1.0,
      context,
      createdAt: Date.now(),
    };
    this.addEntry(entry);
    logger.info({ type, agentId, sessionId }, "Explicit feedback recorded");
    return entry;
  }

  /**
   * Record a regeneration request (user asked to redo response).
   */
  recordRegenerate(
    sessionId: string,
    agentId: string,
    messageId: string,
    context: FeedbackEntry["context"]
  ): FeedbackEntry {
    const entry: FeedbackEntry = {
      id: randomUUID(),
      sessionId,
      agentId,
      messageId,
      type: "regenerate",
      value: -0.5,
      context,
      createdAt: Date.now(),
    };
    this.addEntry(entry);
    return entry;
  }

  /**
   * Detect implicit correction (user rephrases or corrects the agent).
   */
  recordCorrection(
    sessionId: string,
    agentId: string,
    messageId: string,
    context: FeedbackEntry["context"],
    correctionText: string
  ): FeedbackEntry {
    const entry: FeedbackEntry = {
      id: randomUUID(),
      sessionId,
      agentId,
      messageId,
      type: "correction",
      value: -0.3,
      context,
      metadata: { correctionText },
      createdAt: Date.now(),
    };
    this.addEntry(entry);
    return entry;
  }

  /**
   * Record session abandonment (user left without completion).
   */
  recordAbandonment(
    sessionId: string,
    agentId: string,
    lastMessageId: string,
    context: FeedbackEntry["context"]
  ): FeedbackEntry {
    const entry: FeedbackEntry = {
      id: randomUUID(),
      sessionId,
      agentId,
      messageId: lastMessageId,
      type: "abandonment",
      value: -0.2,
      context,
      createdAt: Date.now(),
    };
    this.addEntry(entry);
    return entry;
  }

  private addEntry(entry: FeedbackEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
  }

  // ─── Analysis ─────────────────────────────────────────────────────────

  /**
   * Get feedback entries for a specific agent.
   */
  getEntries(agentId?: string, limit = 100): FeedbackEntry[] {
    let result = [...this.entries];
    if (agentId) result = result.filter((e) => e.agentId === agentId);
    return result.slice(-limit);
  }

  /**
   * Get aggregated feedback statistics.
   */
  getStats(agentId?: string, periodMs = 86400000): FeedbackStats {
    const since = Date.now() - periodMs;
    let recent = this.entries.filter((e) => e.createdAt >= since);
    if (agentId) recent = recent.filter((e) => e.agentId === agentId);

    if (recent.length === 0) {
      return {
        totalFeedback: 0,
        positiveRate: 0,
        negativeRate: 0,
        regenerateRate: 0,
        topIssues: [],
      };
    }

    const positive = recent.filter((e) => e.type === "thumbs_up").length;
    const negative = recent.filter((e) => e.type === "thumbs_down").length;
    const regenerate = recent.filter((e) => e.type === "regenerate").length;

    // Identify patterns in negative feedback
    const negativeEntries = recent.filter((e) => e.value < 0);
    const issuePatterns = new Map<string, number>();
    for (const entry of negativeEntries) {
      const tools = entry.context.toolsUsed.join(", ") || "no tools";
      const key = `${entry.type} (${tools})`;
      issuePatterns.set(key, (issuePatterns.get(key) ?? 0) + 1);
    }

    const topIssues = Array.from(issuePatterns.entries())
      .map(([pattern, count]) => ({ pattern, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      totalFeedback: recent.length,
      positiveRate: positive / recent.length,
      negativeRate: negative / recent.length,
      regenerateRate: regenerate / recent.length,
      topIssues,
    };
  }

  /**
   * Get lessons learned from accumulated feedback for prompt injection.
   */
  getLessons(agentId?: string): string[] {
    const stats = this.getStats(agentId);
    const lessons: string[] = [];

    if (stats.negativeRate > 0.3) {
      lessons.push(
        "Users frequently rate responses negatively. Focus on accuracy and helpfulness."
      );
    }

    if (stats.regenerateRate > 0.2) {
      lessons.push(
        "Users often request regeneration. Provide more thorough initial responses."
      );
    }

    for (const issue of stats.topIssues) {
      if (issue.count >= 3) {
        lessons.push(
          `Recurring issue: ${issue.pattern} (${issue.count} occurrences). Adjust approach.`
        );
      }
    }

    // Analyze positive feedback patterns
    const positiveEntries = this.entries.filter(
      (e) => e.type === "thumbs_up" && (!agentId || e.agentId === agentId)
    );
    if (positiveEntries.length > 0) {
      const positiveTools = new Map<string, number>();
      for (const entry of positiveEntries) {
        for (const tool of entry.context.toolsUsed) {
          positiveTools.set(tool, (positiveTools.get(tool) ?? 0) + 1);
        }
      }
      const topTools = Array.from(positiveTools.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
      if (topTools.length > 0) {
        lessons.push(
          `Tools that produce positive feedback: ${topTools.map(([t]) => t).join(", ")}. Prefer these when applicable.`
        );
      }
    }

    return lessons;
  }

  get size(): number {
    return this.entries.length;
  }
}
