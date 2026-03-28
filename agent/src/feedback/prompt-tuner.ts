// ─── Prompt Tuner ─────────────────────────────────────────────────────────
//
// Analyzes accumulated feedback to auto-generate prompt amendments.
// Creates "meta-memory" entries that are injected into the system prompt
// to improve agent behavior over time.
//
// ──────────────────────────────────────────────────────────────────────────

import pino from "pino";
import { FeedbackCollector, type FeedbackEntry } from "./collector.js";

const logger = pino({ name: "prompt-tuner" });

export interface PromptAmendment {
  id: string;
  rule: string;
  confidence: number; // 0-1
  source: "feedback" | "correction" | "pattern";
  evidenceCount: number;
  createdAt: number;
}

/**
 * Analyzes feedback patterns and generates prompt amendments
 * that improve agent behavior over time.
 */
export class PromptTuner {
  private readonly amendments: PromptAmendment[] = [];
  private readonly maxAmendments = 20;

  /**
   * Analyze feedback and generate new amendments.
   */
  analyze(collector: FeedbackCollector, agentId?: string): PromptAmendment[] {
    const newAmendments: PromptAmendment[] = [];
    const entries = collector.getEntries(agentId, 500);

    // Pattern 1: Detect tools that consistently fail/get negative feedback
    const toolFeedback = this.analyzeToolPatterns(entries);
    for (const [tool, stats] of toolFeedback) {
      if (stats.negative > 3 && stats.negativeRate > 0.5) {
        newAmendments.push({
          id: `tool-caution-${tool}`,
          rule: `The "${tool}" tool has received negative feedback ${stats.negative} times. Double-check results from this tool before presenting them to the user.`,
          confidence: Math.min(0.9, stats.negativeRate),
          source: "feedback",
          evidenceCount: stats.negative,
          createdAt: Date.now(),
        });
      }
    }

    // Pattern 2: Detect response style preferences from corrections
    const corrections = entries.filter((e) => e.type === "correction");
    if (corrections.length >= 3) {
      const correctionTexts = corrections
        .map((e) => (e.metadata?.correctionText as string) || "")
        .filter(Boolean);

      // Check for length preference
      const shortCorrections = correctionTexts.filter((t) => t.length < 100).length;
      if (shortCorrections / correctionTexts.length > 0.6) {
        newAmendments.push({
          id: "style-brevity",
          rule: "User prefers concise, short responses. Keep answers brief and to the point.",
          confidence: 0.7,
          source: "correction",
          evidenceCount: shortCorrections,
          createdAt: Date.now(),
        });
      }
    }

    // Pattern 3: Detect abandonment patterns
    const abandonments = entries.filter((e) => e.type === "abandonment");
    if (abandonments.length >= 5) {
      const toolsAtAbandonment = new Map<string, number>();
      for (const entry of abandonments) {
        for (const tool of entry.context.toolsUsed) {
          toolsAtAbandonment.set(tool, (toolsAtAbandonment.get(tool) ?? 0) + 1);
        }
      }
      for (const [tool, count] of toolsAtAbandonment) {
        if (count >= 3) {
          newAmendments.push({
            id: `abandon-tool-${tool}`,
            rule: `Users frequently abandon conversations after "${tool}" is used (${count} times). Consider asking for confirmation before using this tool.`,
            confidence: 0.6,
            source: "pattern",
            evidenceCount: count,
            createdAt: Date.now(),
          });
        }
      }
    }

    // Merge new amendments with existing ones
    for (const amendment of newAmendments) {
      const existing = this.amendments.findIndex((a) => a.id === amendment.id);
      if (existing >= 0) {
        this.amendments[existing] = amendment;
      } else {
        this.amendments.push(amendment);
      }
    }

    // Keep only top amendments by confidence
    this.amendments.sort((a, b) => b.confidence - a.confidence);
    while (this.amendments.length > this.maxAmendments) {
      this.amendments.pop();
    }

    logger.info(
      { newCount: newAmendments.length, totalCount: this.amendments.length },
      "Prompt tuning analysis complete"
    );
    return newAmendments;
  }

  /**
   * Get current amendments formatted for system prompt injection.
   */
  getPromptSection(): string {
    if (this.amendments.length === 0) return "";

    const rules = this.amendments
      .filter((a) => a.confidence >= 0.5)
      .map((a) => `- ${a.rule}`)
      .join("\n");

    if (!rules) return "";

    return [
      "## Learned Behaviors",
      "Based on past interactions, follow these guidelines:",
      rules,
    ].join("\n");
  }

  /**
   * Get all current amendments.
   */
  getAmendments(): PromptAmendment[] {
    return [...this.amendments];
  }

  private analyzeToolPatterns(
    entries: FeedbackEntry[]
  ): Map<string, { positive: number; negative: number; negativeRate: number }> {
    const toolStats = new Map<string, { positive: number; negative: number; negativeRate: number }>();

    for (const entry of entries) {
      for (const tool of entry.context.toolsUsed) {
        const stats = toolStats.get(tool) ?? { positive: 0, negative: 0, negativeRate: 0 };
        if (entry.value > 0) stats.positive++;
        if (entry.value < 0) stats.negative++;
        stats.negativeRate = stats.negative / (stats.positive + stats.negative || 1);
        toolStats.set(tool, stats);
      }
    }

    return toolStats;
  }
}
