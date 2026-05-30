// ─── Evals Framework (barrel) ─────────────────────────────────────────────────
//
// A self-contained, dependency-free evaluation framework for the Karna agent.
// Each module is additive and testable in isolation. See individual files for
// the issue each addresses.
//
//   framework.ts          #566  Core harness: Dataset / Task / Scorer / runSuite
//   task-runner.ts        #567  SWE-bench-style fixtured task runner
//   golden.ts             #569  Golden transcript snapshots w/ tolerant masking
//   judge.ts              #570  LLM-as-judge (absolute + pairwise, bias-mitigated)
//   tool-use-bench.ts     #571  Tool-selection & argument-validity benchmark
//   routing-ab.ts         #572  Model-routing A/B comparison + recommendation
//   latency-cost-bench.ts #573  Latency/cost measurement + regression detection
//   redteam.ts            #575  Adversarial red-team / jailbreak suite
//
// ──────────────────────────────────────────────────────────────────────────────

export * from "./framework.js";
export * from "./task-runner.js";
export * from "./golden.js";
export * from "./judge.js";
export * from "./tool-use-bench.js";
export * from "./routing-ab.js";
export * from "./latency-cost-bench.js";
export * from "./redteam.js";
