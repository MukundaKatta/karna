import { describe, it, expect } from "vitest";
import {
  generateEvalTasks,
  generateEvalScorer,
  generateEvalSpec,
  scaffoldEvalSuite,
} from "../../packages/plugin-sdk/src/scaffold-eval.js";

describe("plugin-sdk scaffold-eval", () => {
  it("generates a valid tasks fixture with a trivial passing task", () => {
    const json = generateEvalTasks("My Cool Skill");
    const parsed = JSON.parse(json);
    expect(parsed.skill).toBe("My Cool Skill");
    expect(Array.isArray(parsed.tasks)).toBe(true);
    // First task is a non-empty smoke task, which passes against the trivial
    // default runSkill (which echoes input).
    expect(parsed.tasks[0].expect.kind).toBe("non-empty");
  });

  it("generates a scorer that scores the supported expectation kinds", () => {
    const src = generateEvalScorer("news");
    expect(src).toContain("export function scoreNews");
    expect(src).toContain("non-empty");
    expect(src).toContain("contains");

    // Reconstruct the scorer's contract to confirm it is real, working logic.
    const score = (output: string, exp: { kind: string; value?: string }) => {
      switch (exp.kind) {
        case "non-empty":
          return output.trim().length > 0 ? 1 : 0;
        case "contains":
          return output.includes(exp.value!) ? 1 : 0;
        default:
          return 0;
      }
    };
    expect(score("hello", { kind: "non-empty" })).toBe(1);
    expect(score("", { kind: "non-empty" })).toBe(0);
    expect(score("ping pong", { kind: "contains", value: "ping" })).toBe(1);
  });

  it("generates a spec that imports the fixture and scorer", () => {
    const src = generateEvalSpec({ name: "daily-briefing" });
    expect(src).toContain("daily-briefing.eval.tasks.json");
    expect(src).toContain("daily-briefing.eval.scorer.js");
    expect(src).toContain("scoreDailyBriefing");
    expect(src).toContain("daily-briefing eval suite");
  });

  it("scaffoldEvalSuite returns the three eval files with sensible paths", () => {
    const files = scaffoldEvalSuite({ name: "Code Review" });
    const paths = files.map((f) => f.path);
    expect(paths).toEqual([
      "code-review.eval.tasks.json",
      "code-review.eval.scorer.ts",
      "code-review.eval.test.ts",
    ]);
    // The tasks fixture is valid JSON.
    const tasks = files.find((f) => f.path.endsWith(".json"))!;
    expect(() => JSON.parse(tasks.content)).not.toThrow();
  });
});
