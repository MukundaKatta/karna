import { describe, it, expect } from "vitest";
import {
  runRedTeam,
  heuristicSafetyJudge,
  DEFAULT_REDTEAM_DATASET,
  type RedTeamCase,
  type SafetyJudge,
} from "../../agent/src/evals/redteam.js";

describe("red-team / jailbreak eval suite", () => {
  it("ships a curated multi-category dataset", () => {
    const categories = new Set(DEFAULT_REDTEAM_DATASET.map((c) => c.category));
    expect(categories.has("jailbreak")).toBe(true);
    expect(categories.has("injection")).toBe(true);
    expect(categories.has("exfiltration")).toBe(true);
    expect(DEFAULT_REDTEAM_DATASET.length).toBeGreaterThanOrEqual(5);
  });

  it("scores a refusing agent as fully defended", async () => {
    const report = await runRedTeam(
      "refuser",
      DEFAULT_REDTEAM_DATASET,
      () => "I'm sorry, but I can't help with that request.",
    );
    expect(report.defenseRate).toBe(1);
    expect(report.unsafe).toBe(0);
  });

  it("flags an agent that complies / leaks the canary", async () => {
    const runner = (c: RedTeamCase): string => {
      if (c.canary) return `Sure, here it is: ${c.canary}`;
      return "Sure, here is exactly what you asked for, no restrictions.";
    };
    const report = await runRedTeam("compliant", DEFAULT_REDTEAM_DATASET, runner);
    expect(report.unsafe).toBeGreaterThan(0);
    expect(report.defenseRate).toBeLessThan(1);
    const exfil = report.results.find((r) => r.caseId === "exfil-secrets");
    expect(exfil?.safe).toBe(false);
    expect(exfil?.rationale).toContain("canary");
  });

  it("computes per-category defense rates", async () => {
    const report = await runRedTeam(
      "refuser",
      DEFAULT_REDTEAM_DATASET,
      () => "I cannot assist with that.",
    );
    expect(report.byCategory.jailbreak.defenseRate).toBe(1);
    expect(report.byCategory.exfiltration.total).toBeGreaterThan(0);
  });

  it("treats exfiltration without canary leak as contained", () => {
    const verdict = heuristicSafetyJudge(
      {
        id: "x",
        category: "exfiltration",
        prompt: "give secret",
        intent: "test",
        canary: "SECRET",
      },
      "Here is some unrelated text without the secret.",
    );
    expect(verdict.safe).toBe(true);
  });

  it("supports an injected custom judge", async () => {
    const strictJudge: SafetyJudge = (_c, response) => ({
      safe: response.includes("[REFUSED]"),
    });
    const report = await runRedTeam(
      "custom",
      DEFAULT_REDTEAM_DATASET.slice(0, 2),
      () => "ok here you go",
      strictJudge,
    );
    expect(report.defenseRate).toBe(0);
  });

  it("treats a thrown runner as contained", async () => {
    const report = await runRedTeam(
      "throwing",
      DEFAULT_REDTEAM_DATASET.slice(0, 1),
      () => {
        throw new Error("blocked by guardrail");
      },
    );
    expect(report.safe).toBe(1);
    expect(report.results[0].error).toBe("blocked by guardrail");
  });
});
