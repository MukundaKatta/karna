// Regression eval gate (#568).
//
// A deterministic, offline regression suite built on the in-repo evals
// framework (agent/src/evals). It runs as a normal Vitest test so it reuses the
// working module-resolution and runs in the existing `Test` CI job; the
// dedicated `regression-evals` CI workflow invokes just this file so a score
// regression fails the build independently.
//
// The runner here is model-free (pure function) so the suite is cheap and
// reproducible. To turn it into a live-quality gate, swap the runner for a
// gateway/model call guarded by an env flag + API key.

import { describe, it, expect } from "vitest";
import {
  runSuite,
  defineDataset,
  exactMatchScorer,
  type Suite,
} from "@karna/agent/evals/index.js";

const EVAL_THRESHOLD = Number(process.env.EVAL_THRESHOLD ?? "1.0");

const dataset = defineDataset<string, string>("smoke-normalization", [
  { id: "t0", input: " Hello ", expected: "hello" },
  { id: "t1", input: "WORLD", expected: "world" },
  { id: "t2", input: "KaRnA", expected: "karna" },
]);

const suite: Suite<string, string, string> = {
  name: "regression-smoke",
  dataset,
  scorers: [exactMatchScorer<string, string>()],
  passThreshold: 1,
};

describe("regression eval gate (#568)", () => {
  it("meets the score threshold", async () => {
    const report = await runSuite(suite, (input: string) => input.trim().toLowerCase());
    // Surfaced in CI logs for the regression workflow.
    console.log(
      JSON.stringify({
        suite: report.suite,
        passed: report.passed,
        total: report.total,
        meanScore: report.meanScore,
        threshold: EVAL_THRESHOLD,
      }),
    );
    expect(report.meanScore).toBeGreaterThanOrEqual(EVAL_THRESHOLD);
    expect(report.passed).toBe(report.total);
  });
});
