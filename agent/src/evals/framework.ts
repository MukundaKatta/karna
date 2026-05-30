// ─── Eval Harness Framework (#566) ────────────────────────────────────────────
//
// Core abstractions for building deterministic evaluation suites:
//   - Dataset:  a named collection of fixed eval cases (inputs + expectations)
//   - Task:     a single unit of work (input -> expected) within a dataset
//   - Scorer:   a pure function mapping (task, output) -> a numeric score [0,1]
//   - runSuite: executes every task against an injected runner and scores the
//               result deterministically, producing a JSON-serializable report.
//
// Everything here is dependency-free and pure (aside from the injected runner),
// which makes suites trivially testable and reproducible.
//
// ──────────────────────────────────────────────────────────────────────────────

/**
 * A single evaluation case. `TInput` is fed to the runner; `TExpected` is the
 * reference used by scorers. `metadata` carries arbitrary labels (tags, etc.).
 */
export interface Task<TInput = unknown, TExpected = unknown> {
  /** Stable, unique identifier within the dataset. */
  id: string;
  /** Optional human-readable description. */
  description?: string;
  /** The fixed input handed to the runner. */
  input: TInput;
  /** The reference expectation handed to scorers (optional for open-ended evals). */
  expected?: TExpected;
  /** Free-form labels (tags, difficulty, category, ...). */
  metadata?: Record<string, unknown>;
}

/** A named, immutable collection of tasks. */
export interface Dataset<TInput = unknown, TExpected = unknown> {
  name: string;
  description?: string;
  tasks: ReadonlyArray<Task<TInput, TExpected>>;
}

/**
 * The result of scoring a single (task, output) pair. `score` is normalized to
 * `[0, 1]`. `passed` is derived from the suite threshold unless a scorer wants
 * to override it explicitly.
 */
export interface ScoreResult {
  /** Normalized score in [0, 1]. */
  score: number;
  /** Optional explicit pass/fail; if omitted, suite threshold decides. */
  passed?: boolean;
  /** Optional explanation / breakdown for debugging. */
  rationale?: string;
  /** Optional sub-metrics keyed by name (each in [0,1] by convention). */
  components?: Record<string, number>;
}

/**
 * A scorer maps a task and the runner's output to a {@link ScoreResult}.
 * Scorers should be pure and deterministic. Async is supported (e.g. judge).
 */
export interface Scorer<TInput = unknown, TExpected = unknown, TOutput = unknown> {
  name: string;
  score(
    task: Task<TInput, TExpected>,
    output: TOutput,
  ): ScoreResult | Promise<ScoreResult>;
}

/**
 * The function under test. Receives a task input and returns an output that the
 * scorers know how to evaluate. Injected by the caller so suites stay pure.
 */
export type RunnerFn<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  task: Task<TInput, unknown>,
) => TOutput | Promise<TOutput>;

/** A suite ties a dataset to one or more scorers and a pass threshold. */
export interface Suite<TInput = unknown, TExpected = unknown, TOutput = unknown> {
  name: string;
  dataset: Dataset<TInput, TExpected>;
  scorers: ReadonlyArray<Scorer<TInput, TExpected, TOutput>>;
  /**
   * Minimum mean score (across scorers) for a task to count as passing.
   * Defaults to 0.5. Ignored when a scorer returns an explicit `passed`.
   */
  passThreshold?: number;
}

/** Per-scorer outcome for a single task. */
export interface TaskScorerResult {
  scorer: string;
  score: number;
  passed: boolean;
  rationale?: string;
  components?: Record<string, number>;
}

/** Full result for a single task across all scorers. */
export interface TaskReport<TOutput = unknown> {
  taskId: string;
  description?: string;
  /** Mean of all scorer scores for this task. */
  meanScore: number;
  /** True when the task passes (all scorers pass). */
  passed: boolean;
  /** The output the runner produced (captured for debugging). */
  output: TOutput;
  scorers: TaskScorerResult[];
  /** Error message if the runner threw. The task is then scored 0/failed. */
  error?: string;
}

/** Aggregate, JSON-serializable suite report. */
export interface SuiteReport<TOutput = unknown> {
  suite: string;
  dataset: string;
  total: number;
  passed: number;
  failed: number;
  /** Fraction of tasks that passed, in [0,1]. */
  passRate: number;
  /** Mean of all task mean-scores, in [0,1]. */
  meanScore: number;
  passThreshold: number;
  tasks: TaskReport<TOutput>[];
}

const DEFAULT_THRESHOLD = 0.5;

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Execute a suite: run every task through `runnerFn`, score each output with
 * every scorer, and aggregate into a deterministic {@link SuiteReport}.
 *
 * Tasks are processed in declaration order. A runner throwing is captured as a
 * failed task (score 0) rather than aborting the whole suite.
 */
export async function runSuite<TInput, TExpected, TOutput>(
  suite: Suite<TInput, TExpected, TOutput>,
  runnerFn: RunnerFn<TInput, TOutput>,
): Promise<SuiteReport<TOutput>> {
  const threshold = suite.passThreshold ?? DEFAULT_THRESHOLD;
  const taskReports: TaskReport<TOutput>[] = [];

  for (const task of suite.dataset.tasks) {
    let output: TOutput;
    try {
      output = await runnerFn(task.input, task);
    } catch (err) {
      taskReports.push({
        taskId: task.id,
        description: task.description,
        meanScore: 0,
        passed: false,
        output: undefined as unknown as TOutput,
        scorers: [],
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const scorerResults: TaskScorerResult[] = [];
    for (const scorer of suite.scorers) {
      const raw = await scorer.score(task, output);
      const score = clamp01(raw.score);
      const passed = raw.passed ?? score >= threshold;
      scorerResults.push({
        scorer: scorer.name,
        score,
        passed,
        rationale: raw.rationale,
        components: raw.components,
      });
    }

    const meanScore = mean(scorerResults.map((s) => s.score));
    const passed =
      scorerResults.length > 0 && scorerResults.every((s) => s.passed);

    taskReports.push({
      taskId: task.id,
      description: task.description,
      meanScore,
      passed,
      output,
      scorers: scorerResults,
    });
  }

  const passedCount = taskReports.filter((t) => t.passed).length;
  const total = taskReports.length;

  return {
    suite: suite.name,
    dataset: suite.dataset.name,
    total,
    passed: passedCount,
    failed: total - passedCount,
    passRate: total === 0 ? 0 : passedCount / total,
    meanScore: mean(taskReports.map((t) => t.meanScore)),
    passThreshold: threshold,
    tasks: taskReports,
  };
}

/** Helper to build a dataset with minimal boilerplate. */
export function defineDataset<TInput, TExpected>(
  name: string,
  tasks: ReadonlyArray<Task<TInput, TExpected>>,
  description?: string,
): Dataset<TInput, TExpected> {
  return { name, description, tasks };
}

/**
 * Build a scorer from a plain function. Convenience over implementing the
 * interface manually.
 */
export function defineScorer<TInput, TExpected, TOutput>(
  name: string,
  fn: (
    task: Task<TInput, TExpected>,
    output: TOutput,
  ) => ScoreResult | Promise<ScoreResult>,
): Scorer<TInput, TExpected, TOutput> {
  return { name, score: fn };
}

/**
 * A common scorer: exact-match equality between `output` and `task.expected`
 * (deep-equal via JSON). Returns 1 on match, 0 otherwise.
 */
export function exactMatchScorer<
  TInput,
  TExpected,
>(): Scorer<TInput, TExpected, TExpected> {
  return {
    name: "exact-match",
    score(task, output) {
      const a = JSON.stringify(task.expected);
      const b = JSON.stringify(output);
      const match = a === b;
      return {
        score: match ? 1 : 0,
        passed: match,
        rationale: match ? "exact match" : `expected ${a}, got ${b}`,
      };
    },
  };
}
