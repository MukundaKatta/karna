// ─── SWE-bench-style Task Runner (#567) ───────────────────────────────────────
//
// A fixtured task format for "apply a patch / produce a solution, then verify
// it passes a check" style evals (the SWE-bench pattern). Verification is an
// injected function (e.g. "run the repo's tests and report pass/fail") so the
// runner stays pure and offline-testable.
//
// ──────────────────────────────────────────────────────────────────────────────

/** A fixtured SWE-bench-style task. */
export interface SweTask<TContext = unknown, TSolution = unknown> {
  id: string;
  description?: string;
  /** Repository / problem context handed to the solver. */
  context: TContext;
  /** Optional reference (golden) solution, for diff-based scoring if desired. */
  reference?: TSolution;
  metadata?: Record<string, unknown>;
}

/** The result of verifying a candidate solution. */
export interface VerificationResult {
  /** Whether the solution passed verification (e.g. all tests green). */
  passed: boolean;
  /** Number of checks that passed (e.g. tests passed). */
  passedChecks?: number;
  /** Total number of checks (e.g. total tests). */
  totalChecks?: number;
  /** Optional log / reason for debugging. */
  detail?: string;
}

/** Produces a candidate solution for a task. Injected (the system under test). */
export type SolverFn<TContext, TSolution> = (
  task: SweTask<TContext, TSolution>,
) => TSolution | Promise<TSolution>;

/**
 * Verifies a candidate solution against the task. Injected — in a real harness
 * this would apply the patch and run the project's test command.
 */
export type VerifyFn<TContext, TSolution> = (
  task: SweTask<TContext, TSolution>,
  solution: TSolution,
) => VerificationResult | Promise<VerificationResult>;

/** Per-task outcome. */
export interface SweTaskResult<TSolution> {
  taskId: string;
  resolved: boolean;
  solution?: TSolution;
  verification?: VerificationResult;
  /** Partial credit in [0,1]: passedChecks/totalChecks, or 1/0 when unknown. */
  score: number;
  error?: string;
}

/** Aggregate report for a SWE-bench-style run. */
export interface SweRunReport<TSolution> {
  name: string;
  total: number;
  resolved: number;
  /** Fraction of tasks fully resolved (verification.passed), in [0,1]. */
  resolveRate: number;
  /** Mean partial-credit score across tasks, in [0,1]. */
  meanScore: number;
  results: SweTaskResult<TSolution>[];
}

function partialScore(v: VerificationResult): number {
  if (
    typeof v.passedChecks === "number" &&
    typeof v.totalChecks === "number" &&
    v.totalChecks > 0
  ) {
    return Math.max(0, Math.min(1, v.passedChecks / v.totalChecks));
  }
  return v.passed ? 1 : 0;
}

/**
 * Run a set of SWE-bench-style tasks: solve each, verify it, and aggregate.
 * Errors in the solver/verifier mark the task unresolved (score 0) without
 * aborting the run.
 */
export async function runSweTasks<TContext, TSolution>(
  name: string,
  tasks: ReadonlyArray<SweTask<TContext, TSolution>>,
  solver: SolverFn<TContext, TSolution>,
  verify: VerifyFn<TContext, TSolution>,
): Promise<SweRunReport<TSolution>> {
  const results: SweTaskResult<TSolution>[] = [];

  for (const task of tasks) {
    try {
      const solution = await solver(task);
      const verification = await verify(task, solution);
      results.push({
        taskId: task.id,
        resolved: verification.passed,
        solution,
        verification,
        score: partialScore(verification),
      });
    } catch (err) {
      results.push({
        taskId: task.id,
        resolved: false,
        score: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const resolved = results.filter((r) => r.resolved).length;
  const total = results.length;
  const meanScore =
    total === 0 ? 0 : results.reduce((a, r) => a + r.score, 0) / total;

  return {
    name,
    total,
    resolved,
    resolveRate: total === 0 ? 0 : resolved / total,
    meanScore,
    results,
  };
}

/**
 * A reusable verify function that checks the solution against a set of named
 * assertions. Each assertion returns true/false; the result reports how many
 * passed. Useful for building deterministic, fixtured "tests pass" checks.
 */
export function makeAssertionVerifier<TContext, TSolution>(
  assertions: ReadonlyArray<{
    name: string;
    check: (task: SweTask<TContext, TSolution>, solution: TSolution) => boolean;
  }>,
): VerifyFn<TContext, TSolution> {
  return (task, solution) => {
    const failures: string[] = [];
    let passedChecks = 0;
    for (const a of assertions) {
      let ok = false;
      try {
        ok = a.check(task, solution);
      } catch {
        ok = false;
      }
      if (ok) passedChecks += 1;
      else failures.push(a.name);
    }
    return {
      passed: failures.length === 0,
      passedChecks,
      totalChecks: assertions.length,
      detail:
        failures.length === 0
          ? "all checks passed"
          : `failed: ${failures.join(", ")}`,
    };
  };
}
