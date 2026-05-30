// ─── Prompt-Injection Detection (Issue #560) ─────────────────────────────────
//
// Heuristic detection of prompt-injection attempts in untrusted content (tool
// outputs, fetched web pages, file contents, inbound messages). Returns a
// structured result with matched spans and a recommended action. An optional
// async classifier can be injected to augment the heuristics (e.g. an LLM-based
// detector) without changing the call site.
//
// Pure by default and side-effect free at import; nothing here blocks anything
// on its own — callers decide what to do with the `action`.

/** A matched suspicious span in the scanned content. */
export interface InjectionSpan {
  /** Rule that matched. */
  rule: string;
  /** The matched substring (truncated for safety). */
  match: string;
  /** Start index in the original string. */
  start: number;
  /** End index (exclusive). */
  end: number;
  /** Per-match severity weight. */
  weight: number;
}

export type InjectionAction = "allow" | "flag" | "block";

export interface InjectionResult {
  /** True when the aggregate score crosses the flag threshold. */
  flagged: boolean;
  /** Aggregate severity score (sum of matched weights). */
  score: number;
  /** All matched spans. */
  spans: InjectionSpan[];
  /** Recommended action given the configured thresholds. */
  action: InjectionAction;
}

interface Heuristic {
  rule: string;
  pattern: RegExp;
  weight: number;
}

/**
 * Heuristics targeting common injection patterns. Patterns are case-insensitive
 * and global; weights are summed to produce a score.
 */
const HEURISTICS: Heuristic[] = [
  { rule: "ignore_previous", pattern: /\bignore\s+(?:all\s+)?(?:the\s+)?(?:previous|above|prior|earlier)\s+(?:instructions?|prompts?|messages?|context)\b/gi, weight: 5 },
  { rule: "disregard", pattern: /\bdisregard\s+(?:all\s+)?(?:the\s+)?(?:previous|above|prior|earlier|your)\b/gi, weight: 4 },
  { rule: "forget_instructions", pattern: /\bforget\s+(?:everything|all|your)\b.{0,40}\b(?:instructions?|rules?|prompt)\b/gi, weight: 4 },
  { rule: "new_instructions", pattern: /\b(?:new|updated|revised)\s+(?:instructions?|directives?|system\s+prompt)\b/gi, weight: 3 },
  { rule: "system_prompt_override", pattern: /\b(?:system\s*prompt|system\s*message)\s*[:=]/gi, weight: 4 },
  { rule: "role_injection", pattern: /^\s*(?:system|assistant|developer)\s*[:>]/gim, weight: 4 },
  { rule: "you_are_now", pattern: /\byou\s+are\s+now\s+(?:a|an|the|in)\b/gi, weight: 4 },
  { rule: "act_as", pattern: /\b(?:act|behave|respond)\s+as\s+(?:if|a|an|though)\b/gi, weight: 2 },
  { rule: "dan_jailbreak", pattern: /\b(?:do\s+anything\s+now|DAN\s+mode|developer\s+mode|jailbreak)\b/gi, weight: 5 },
  { rule: "reveal_secrets", pattern: /\b(?:reveal|print|show|expose|leak|exfiltrate)\b.{0,40}\b(?:system\s*prompt|secrets?|api\s*keys?|passwords?|credentials?|env(?:ironment)?\s*variables?)\b/gi, weight: 5 },
  { rule: "ignore_safety", pattern: /\b(?:ignore|bypass|override|disable)\b.{0,30}\b(?:safety|guard\s*rails?|filters?|restrictions?|policy)\b/gi, weight: 5 },
  { rule: "fake_tool_marker", pattern: /<\/?(?:tool_result|function_results?|system|im_start|im_end)\b/gi, weight: 4 },
  { rule: "override_rules", pattern: /\boverride\s+(?:the\s+)?(?:rules?|guidelines?|instructions?|safeguards?)\b/gi, weight: 4 },
];

export interface DetectInjectionOptions {
  /**
   * Optional async/sync classifier to augment heuristics. It receives the raw
   * content and returns an additive score and/or spans. Failures are ignored.
   */
  classifier?: InjectionClassifier;
  /** Score at/above which content is flagged. Default 4. */
  flagThreshold?: number;
  /** Score at/above which the action becomes "block". Default 8. */
  blockThreshold?: number;
  /** Max characters of a matched span to retain. Default 120. */
  maxSpanLength?: number;
}

/** A pluggable classifier (e.g. an LLM-backed detector). */
export type InjectionClassifier = (
  content: string,
) => Promise<ClassifierResult> | ClassifierResult;

export interface ClassifierResult {
  /** Additive score contributed by the classifier. */
  score?: number;
  /** Optional spans contributed by the classifier. */
  spans?: InjectionSpan[];
}

const DEFAULT_FLAG = 4;
const DEFAULT_BLOCK = 8;
const DEFAULT_MAX_SPAN = 120;

/**
 * Synchronous heuristic-only detection. Use this when no async classifier is
 * needed (most call sites). Pure and deterministic.
 */
export function detectInjectionSync(
  content: string,
  options: Omit<DetectInjectionOptions, "classifier"> = {},
): InjectionResult {
  const maxSpan = options.maxSpanLength ?? DEFAULT_MAX_SPAN;
  const flagThreshold = options.flagThreshold ?? DEFAULT_FLAG;
  const blockThreshold = options.blockThreshold ?? DEFAULT_BLOCK;

  const spans: InjectionSpan[] = [];
  let score = 0;

  for (const h of HEURISTICS) {
    h.pattern.lastIndex = 0;
    for (const m of content.matchAll(h.pattern)) {
      const start = m.index ?? 0;
      const raw = m[0];
      spans.push({
        rule: h.rule,
        match: raw.length > maxSpan ? raw.slice(0, maxSpan) + "…" : raw,
        start,
        end: start + raw.length,
        weight: h.weight,
      });
      score += h.weight;
    }
  }

  return finalize(score, spans, flagThreshold, blockThreshold);
}

/**
 * Full detection including an optional injected classifier. Always resolves;
 * a throwing classifier is treated as contributing nothing.
 */
export async function detectInjection(
  content: string,
  options: DetectInjectionOptions = {},
): Promise<InjectionResult> {
  const base = detectInjectionSync(content, options);
  if (!options.classifier) {
    return base;
  }

  const flagThreshold = options.flagThreshold ?? DEFAULT_FLAG;
  const blockThreshold = options.blockThreshold ?? DEFAULT_BLOCK;

  let extraScore = 0;
  const extraSpans: InjectionSpan[] = [];
  try {
    const result = await options.classifier(content);
    extraScore = result.score ?? 0;
    if (result.spans) extraSpans.push(...result.spans);
  } catch {
    // Classifier failures degrade gracefully to heuristics-only.
  }

  return finalize(
    base.score + extraScore,
    [...base.spans, ...extraSpans],
    flagThreshold,
    blockThreshold,
  );
}

function finalize(
  score: number,
  spans: InjectionSpan[],
  flagThreshold: number,
  blockThreshold: number,
): InjectionResult {
  let action: InjectionAction = "allow";
  if (score >= blockThreshold) {
    action = "block";
  } else if (score >= flagThreshold) {
    action = "flag";
  }
  return { flagged: score >= flagThreshold, score, spans, action };
}
