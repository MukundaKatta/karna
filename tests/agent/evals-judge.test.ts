import { describe, it, expect } from "vitest";
import {
  judgeAbsolute,
  judgePairwise,
  judgeScorer,
  parseJudgeScore,
  parsePairwiseVerdict,
  type JudgeConfig,
} from "../../agent/src/evals/judge.js";

describe("LLM-as-judge", () => {
  it("parses scores from various formats", () => {
    expect(parseJudgeScore("Score: 8.5\nGood answer")).toBe(8.5);
    expect(parseJudgeScore("Rating = 3")).toBe(3);
    expect(parseJudgeScore("I'd give it a 7 out of 10")).toBe(7);
    expect(parseJudgeScore("no number here")).toBeNull();
  });

  it("absolute mode normalizes and applies threshold", async () => {
    const config: JudgeConfig = {
      rubric: "Grade helpfulness 0-10.",
      model: () => "Score: 9\nVery helpful.",
      maxScore: 10,
      passThreshold: 0.7,
    };
    const res = await judgeAbsolute(config, {
      question: "What is 2+2?",
      response: "4",
    });
    expect(res.raw).toBe(9);
    expect(res.score).toBeCloseTo(0.9, 5);
    expect(res.passed).toBe(true);
  });

  it("absolute mode fails low scores and clamps out-of-range", async () => {
    const config: JudgeConfig = {
      rubric: "r",
      model: () => "Score: 50",
      maxScore: 10,
    };
    const res = await judgeAbsolute(config, { question: "q", response: "bad" });
    expect(res.raw).toBe(10); // clamped to maxScore
    expect(res.score).toBe(1);
  });

  it("pairwise verdict parsing", () => {
    expect(parsePairwiseVerdict("Verdict: 1")).toBe("first");
    expect(parsePairwiseVerdict("Verdict: 2")).toBe("second");
    expect(parsePairwiseVerdict("Verdict: tie")).toBe("tie");
    expect(parsePairwiseVerdict("hmm")).toBe("tie");
  });

  it("pairwise mode is consistent when judge truly prefers A", async () => {
    // Judge always prefers whichever response equals "GOOD". A == GOOD.
    const config: JudgeConfig = {
      rubric: "Pick the better one.",
      model: (prompt) => {
        // Response 1 line, Response 2 line. Find which holds GOOD.
        const r1 = /Response 1:\n(.*)/.exec(prompt)?.[1] ?? "";
        return r1.includes("GOOD") ? "Verdict: 1" : "Verdict: 2";
      },
    };
    const res = await judgePairwise(config, {
      question: "q",
      responseA: "GOOD",
      responseB: "bad",
    });
    expect(res.verdict).toBe("A");
    expect(res.inconsistent).toBe(false);
  });

  it("pairwise mode flags position bias as tie", async () => {
    // Judge always says "Verdict: 1" (first position) regardless of content →
    // position bias. firstPass=A, swappedPass=B → inconsistent tie.
    const config: JudgeConfig = {
      rubric: "r",
      model: () => "Verdict: 1",
    };
    const res = await judgePairwise(config, {
      question: "q",
      responseA: "x",
      responseB: "y",
    });
    expect(res.firstPass).toBe("A");
    expect(res.swappedPass).toBe("B");
    expect(res.verdict).toBe("tie");
    expect(res.inconsistent).toBe(true);
  });

  it("judgeScorer integrates with the scorer shape", async () => {
    const scorer = judgeScorer({
      rubric: "r",
      model: () => "Score: 10",
      maxScore: 10,
    });
    const out = await scorer.score({ input: { question: "q" } }, "answer");
    expect(out.score).toBe(1);
    expect(out.passed).toBe(true);
  });
});
