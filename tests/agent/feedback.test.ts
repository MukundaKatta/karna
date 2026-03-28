import { describe, it, expect, beforeEach } from "vitest";
import { FeedbackCollector, type FeedbackEntry } from "../../agent/src/feedback/collector.js";
import { PromptTuner } from "../../agent/src/feedback/prompt-tuner.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeContext(overrides: Partial<FeedbackEntry["context"]> = {}): FeedbackEntry["context"] {
  return {
    userMessage: "Hello",
    assistantMessage: "Hi there!",
    model: "claude-sonnet-4-20250514",
    toolsUsed: [],
    ...overrides,
  };
}

// ─── FeedbackCollector ──────────────────────────────────────────────────────

describe("FeedbackCollector", () => {
  let collector: FeedbackCollector;

  beforeEach(() => {
    collector = new FeedbackCollector();
  });

  describe("recordExplicit", () => {
    it("records thumbs_up with value 1.0", () => {
      const entry = collector.recordExplicit(
        "sess-1", "agent-1", "msg-1", "thumbs_up", makeContext()
      );
      expect(entry.type).toBe("thumbs_up");
      expect(entry.value).toBe(1.0);
      expect(entry.sessionId).toBe("sess-1");
      expect(entry.agentId).toBe("agent-1");
      expect(entry.id).toBeTruthy();
    });

    it("records thumbs_down with value -1.0", () => {
      const entry = collector.recordExplicit(
        "sess-1", "agent-1", "msg-1", "thumbs_down", makeContext()
      );
      expect(entry.type).toBe("thumbs_down");
      expect(entry.value).toBe(-1.0);
    });
  });

  describe("recordRegenerate", () => {
    it("records regeneration with negative value", () => {
      const entry = collector.recordRegenerate(
        "sess-1", "agent-1", "msg-1", makeContext()
      );
      expect(entry.type).toBe("regenerate");
      expect(entry.value).toBe(-0.5);
    });
  });

  describe("recordCorrection", () => {
    it("records correction with metadata", () => {
      const entry = collector.recordCorrection(
        "sess-1", "agent-1", "msg-1", makeContext(), "Actually, I meant X"
      );
      expect(entry.type).toBe("correction");
      expect(entry.value).toBe(-0.3);
      expect(entry.metadata?.correctionText).toBe("Actually, I meant X");
    });
  });

  describe("getStats", () => {
    it("returns zero stats when no feedback exists", () => {
      const stats = collector.getStats();
      expect(stats.totalFeedback).toBe(0);
      expect(stats.positiveRate).toBe(0);
      expect(stats.negativeRate).toBe(0);
      expect(stats.regenerateRate).toBe(0);
      expect(stats.topIssues).toEqual([]);
    });

    it("computes correct rates with mixed feedback", () => {
      collector.recordExplicit("s1", "a1", "m1", "thumbs_up", makeContext());
      collector.recordExplicit("s1", "a1", "m2", "thumbs_up", makeContext());
      collector.recordExplicit("s1", "a1", "m3", "thumbs_down", makeContext());
      collector.recordRegenerate("s1", "a1", "m4", makeContext());

      const stats = collector.getStats();
      expect(stats.totalFeedback).toBe(4);
      expect(stats.positiveRate).toBe(0.5);
      expect(stats.negativeRate).toBe(0.25);
      expect(stats.regenerateRate).toBe(0.25);
    });

    it("filters by agentId", () => {
      collector.recordExplicit("s1", "agent-a", "m1", "thumbs_up", makeContext());
      collector.recordExplicit("s1", "agent-b", "m2", "thumbs_down", makeContext());

      const stats = collector.getStats("agent-a");
      expect(stats.totalFeedback).toBe(1);
      expect(stats.positiveRate).toBe(1);
    });

    it("identifies top issues from negative feedback", () => {
      const ctx = makeContext({ toolsUsed: ["web_search"] });
      collector.recordExplicit("s1", "a1", "m1", "thumbs_down", ctx);
      collector.recordExplicit("s1", "a1", "m2", "thumbs_down", ctx);
      collector.recordRegenerate("s1", "a1", "m3", ctx);

      const stats = collector.getStats();
      expect(stats.topIssues.length).toBeGreaterThan(0);
      expect(stats.topIssues[0].count).toBeGreaterThanOrEqual(2);
    });
  });

  describe("getLessons", () => {
    it("returns empty lessons when no feedback", () => {
      const lessons = collector.getLessons();
      expect(lessons).toEqual([]);
    });

    it("detects high regeneration rate", () => {
      for (let i = 0; i < 5; i++) {
        collector.recordRegenerate("s1", "a1", `m${i}`, makeContext());
      }
      const lessons = collector.getLessons();
      expect(lessons.some((l) => l.includes("regeneration"))).toBe(true);
    });

    it("identifies positive tool patterns", () => {
      const ctx = makeContext({ toolsUsed: ["calendar"] });
      for (let i = 0; i < 5; i++) {
        collector.recordExplicit("s1", "a1", `m${i}`, "thumbs_up", ctx);
      }
      const lessons = collector.getLessons();
      expect(lessons.some((l) => l.includes("calendar"))).toBe(true);
    });
  });

  describe("size and eviction", () => {
    it("tracks size correctly", () => {
      expect(collector.size).toBe(0);
      collector.recordExplicit("s1", "a1", "m1", "thumbs_up", makeContext());
      expect(collector.size).toBe(1);
    });

    it("evicts oldest entries when exceeding maxEntries", () => {
      const smallCollector = new FeedbackCollector(3);
      smallCollector.recordExplicit("s1", "a1", "m1", "thumbs_up", makeContext());
      smallCollector.recordExplicit("s1", "a1", "m2", "thumbs_up", makeContext());
      smallCollector.recordExplicit("s1", "a1", "m3", "thumbs_up", makeContext());
      smallCollector.recordExplicit("s1", "a1", "m4", "thumbs_up", makeContext());
      expect(smallCollector.size).toBe(3);
    });
  });
});

// ─── PromptTuner ────────────────────────────────────────────────────────────

describe("PromptTuner", () => {
  let tuner: PromptTuner;
  let collector: FeedbackCollector;

  beforeEach(() => {
    tuner = new PromptTuner();
    collector = new FeedbackCollector();
  });

  describe("analyze", () => {
    it("returns empty amendments for no feedback", () => {
      const amendments = tuner.analyze(collector);
      expect(amendments).toEqual([]);
    });

    it("generates tool caution amendment for consistently failing tools", () => {
      const ctx = makeContext({ toolsUsed: ["broken_tool"] });
      for (let i = 0; i < 5; i++) {
        collector.recordExplicit("s1", "a1", `m${i}`, "thumbs_down", ctx);
      }
      const amendments = tuner.analyze(collector);
      const toolCaution = amendments.find((a) => a.id.includes("broken_tool"));
      expect(toolCaution).toBeDefined();
      expect(toolCaution?.source).toBe("feedback");
    });

    it("generates brevity amendment from short corrections", () => {
      for (let i = 0; i < 4; i++) {
        collector.recordCorrection("s1", "a1", `m${i}`, makeContext(), "short");
      }
      const amendments = tuner.analyze(collector);
      const brevity = amendments.find((a) => a.id === "style-brevity");
      expect(brevity).toBeDefined();
      expect(brevity?.source).toBe("correction");
    });

    it("generates abandonment amendment for repeated tool abandonments", () => {
      const ctx = makeContext({ toolsUsed: ["slow_tool"] });
      for (let i = 0; i < 6; i++) {
        collector.recordAbandonment("s1", "a1", `m${i}`, ctx);
      }
      const amendments = tuner.analyze(collector);
      const abandon = amendments.find((a) => a.id.includes("slow_tool"));
      expect(abandon).toBeDefined();
      expect(abandon?.source).toBe("pattern");
    });
  });

  describe("getPromptSection", () => {
    it("returns empty string when no amendments", () => {
      expect(tuner.getPromptSection()).toBe("");
    });

    it("returns formatted prompt section after analysis", () => {
      const ctx = makeContext({ toolsUsed: ["broken_tool"] });
      for (let i = 0; i < 5; i++) {
        collector.recordExplicit("s1", "a1", `m${i}`, "thumbs_down", ctx);
      }
      tuner.analyze(collector);
      const section = tuner.getPromptSection();
      expect(section).toContain("Learned Behaviors");
      expect(section).toContain("broken_tool");
    });
  });

  describe("getAmendments", () => {
    it("returns a copy of amendments array", () => {
      const amendments = tuner.getAmendments();
      expect(amendments).toEqual([]);
      // Mutating the returned array should not affect internals
      amendments.push({
        id: "test",
        rule: "test",
        confidence: 1,
        source: "feedback",
        evidenceCount: 1,
        createdAt: Date.now(),
      });
      expect(tuner.getAmendments()).toEqual([]);
    });
  });
});
