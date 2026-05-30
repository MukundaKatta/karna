// ─── LLM-as-Judge Scorer (#570) ───────────────────────────────────────────────
//
// A configurable scorer that uses a model ("judge") to grade responses against
// a rubric. Supports two modes:
//   - absolute: grade a single response on a numeric scale.
//   - pairwise: compare two responses (A vs B). To mitigate the well-known
//     position bias, the judge is queried twice with A/B swapped, and the
//     verdicts are reconciled (a flip => tie).
//
// The model call is injected as `JudgeModelFn` so the judge is deterministic
// and testable offline.
//
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Injected model function. Receives the fully-rendered judge prompt and returns
 * the raw completion text. Kept intentionally minimal/provider-agnostic.
 */
export type JudgeModelFn = (prompt: string) => string | Promise<string>;

/** Configuration shared by both judging modes. */
export interface JudgeConfig {
  /** The rubric / grading instructions appended to every prompt. */
  rubric: string;
  /** Injected model. */
  model: JudgeModelFn;
  /**
   * For absolute mode: the maximum score the judge may emit (default 10). The
   * extracted raw score is normalized to [0,1] by dividing by this.
   */
  maxScore?: number;
  /** Pass threshold on the normalized [0,1] score (default 0.7). */
  passThreshold?: number;
}

/** Input for an absolute-mode grade. */
export interface AbsoluteJudgeInput {
  /** The user prompt / question that was answered. */
  question: string;
  /** The response being graded. */
  response: string;
  /** Optional reference answer to compare against. */
  reference?: string;
}

/** Result of an absolute-mode grade. */
export interface AbsoluteJudgeResult {
  /** Raw score the judge emitted (0..maxScore). */
  raw: number;
  /** Normalized score in [0,1]. */
  score: number;
  passed: boolean;
  /** The judge's free-form explanation, if it provided one. */
  rationale?: string;
}

const SCORE_RE = /(?:score|rating)\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)/i;
const BARE_NUM_RE = /\b([0-9]+(?:\.[0-9]+)?)\b/;

/**
 * Parse a numeric score out of a judge completion. Looks for an explicit
 * "Score: N" marker first, then falls back to the first bare number. Returns
 * `null` if nothing parseable is found.
 */
export function parseJudgeScore(text: string): number | null {
  const m = SCORE_RE.exec(text);
  if (m) return Number.parseFloat(m[1]);
  const b = BARE_NUM_RE.exec(text);
  if (b) return Number.parseFloat(b[1]);
  return null;
}

function buildAbsolutePrompt(rubric: string, input: AbsoluteJudgeInput): string {
  const ref = input.reference
    ? `\n\nReference answer (for comparison):\n${input.reference}`
    : "";
  return [
    "You are an impartial judge. Grade the response against the rubric.",
    `\nRubric:\n${rubric}`,
    `\nQuestion:\n${input.question}`,
    `\nResponse to grade:\n${input.response}${ref}`,
    '\nReply with a line "Score: <number>" followed by a brief rationale.',
  ].join("\n");
}

/** Grade a single response on an absolute scale. */
export async function judgeAbsolute(
  config: JudgeConfig,
  input: AbsoluteJudgeInput,
): Promise<AbsoluteJudgeResult> {
  const maxScore = config.maxScore ?? 10;
  const threshold = config.passThreshold ?? 0.7;
  const completion = await config.model(buildAbsolutePrompt(config.rubric, input));
  const raw = parseJudgeScore(completion);
  const safeRaw = raw === null ? 0 : Math.max(0, Math.min(maxScore, raw));
  const score = maxScore > 0 ? safeRaw / maxScore : 0;
  return {
    raw: safeRaw,
    score,
    passed: score >= threshold,
    rationale: completion.trim() || undefined,
  };
}

/** The three possible pairwise verdicts. */
export type PairwiseVerdict = "A" | "B" | "tie";

/** Input for a pairwise comparison. */
export interface PairwiseJudgeInput {
  question: string;
  responseA: string;
  responseB: string;
}

/** Result of a pairwise comparison (after bias mitigation). */
export interface PairwiseJudgeResult {
  /** Final reconciled verdict. */
  verdict: PairwiseVerdict;
  /** Verdict when A was presented first. */
  firstPass: PairwiseVerdict;
  /** Verdict when the order was swapped (B presented as "first"). */
  swappedPass: PairwiseVerdict;
  /** True when the two passes disagreed (position bias detected). */
  inconsistent: boolean;
}

function buildPairwisePrompt(
  rubric: string,
  question: string,
  first: string,
  second: string,
): string {
  return [
    "You are an impartial judge comparing two responses.",
    `\nRubric:\n${rubric}`,
    `\nQuestion:\n${question}`,
    `\nResponse 1:\n${first}`,
    `\nResponse 2:\n${second}`,
    '\nWhich is better? Reply with exactly one of: "Verdict: 1", "Verdict: 2", or "Verdict: tie".',
  ].join("\n");
}

const VERDICT_RE = /verdict\s*[:=]\s*(1|2|tie|a|b)/i;

/** Parse a "first/second" verdict from a judge completion. */
export function parsePairwiseVerdict(text: string): "first" | "second" | "tie" {
  const m = VERDICT_RE.exec(text);
  if (!m) return "tie";
  const v = m[1].toLowerCase();
  if (v === "1" || v === "a") return "first";
  if (v === "2" || v === "b") return "second";
  return "tie";
}

/**
 * Compare two responses with position-swap bias mitigation. The judge is asked
 * twice — once with A first, once with B first. If both agree on the same
 * candidate, that's the verdict; otherwise it's reported as a tie and flagged
 * inconsistent.
 */
export async function judgePairwise(
  config: JudgeConfig,
  input: PairwiseJudgeInput,
): Promise<PairwiseJudgeResult> {
  // Pass 1: A as first, B as second.
  const out1 = await config.model(
    buildPairwisePrompt(config.rubric, input.question, input.responseA, input.responseB),
  );
  const v1 = parsePairwiseVerdict(out1);
  const firstPass: PairwiseVerdict =
    v1 === "first" ? "A" : v1 === "second" ? "B" : "tie";

  // Pass 2: B as first, A as second (positions swapped).
  const out2 = await config.model(
    buildPairwisePrompt(config.rubric, input.question, input.responseB, input.responseA),
  );
  const v2 = parsePairwiseVerdict(out2);
  // In the swapped prompt, "first" now refers to B.
  const swappedPass: PairwiseVerdict =
    v2 === "first" ? "B" : v2 === "second" ? "A" : "tie";

  let verdict: PairwiseVerdict;
  let inconsistent = false;
  if (firstPass === swappedPass) {
    verdict = firstPass;
  } else if (firstPass === "tie") {
    verdict = swappedPass;
  } else if (swappedPass === "tie") {
    verdict = firstPass;
  } else {
    // Genuine disagreement (e.g. A then B) => position bias; call it a tie.
    verdict = "tie";
    inconsistent = true;
  }

  return { verdict, firstPass, swappedPass, inconsistent };
}

/**
 * Build a {@link Scorer}-compatible object for absolute-mode judging, for use
 * inside `runSuite`. The task input must carry the `question`; the runner's
 * output is the `response` string. `task.expected` (if a string) is the
 * reference.
 */
export function judgeScorer(config: JudgeConfig): {
  name: string;
  score: (
    task: { input: { question: string }; expected?: unknown },
    output: string,
  ) => Promise<{ score: number; passed: boolean; rationale?: string }>;
} {
  return {
    name: "llm-judge",
    async score(task, output) {
      const result = await judgeAbsolute(config, {
        question: task.input.question,
        response: output,
        reference: typeof task.expected === "string" ? task.expected : undefined,
      });
      return { score: result.score, passed: result.passed, rationale: result.rationale };
    },
  };
}
