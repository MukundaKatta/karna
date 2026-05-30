// ─── Golden Transcript Snapshot Tests (#569) ──────────────────────────────────
//
// Record/compare "golden" transcripts (sequences of turns) with a tolerant diff
// that masks nondeterministic fields (timestamps, ids, durations, ...) before
// comparison. The mask is configurable so callers can target their own schema.
//
// ──────────────────────────────────────────────────────────────────────────────

/** A single turn in a transcript. Role + content + arbitrary extra fields. */
export interface TranscriptTurn {
  role: string;
  content: string;
  [key: string]: unknown;
}

/** A recorded transcript: an ordered list of turns plus optional metadata. */
export interface Transcript {
  turns: TranscriptTurn[];
  metadata?: Record<string, unknown>;
}

/**
 * Configuration for masking nondeterministic data before comparison.
 *   - `fields`: exact key names to replace with a placeholder, at any depth.
 *   - `patterns`: regexes; any string value fully matching is replaced.
 *   - `placeholder`: the replacement token (default "<MASKED>").
 */
export interface MaskConfig {
  fields?: string[];
  patterns?: RegExp[];
  placeholder?: string;
}

const DEFAULT_PLACEHOLDER = "<MASKED>";

/** Common nondeterministic field names, provided as a sensible default. */
export const DEFAULT_MASK_FIELDS: string[] = [
  "id",
  "messageId",
  "sessionId",
  "requestId",
  "timestamp",
  "createdAt",
  "updatedAt",
  "ts",
  "latencyMs",
  "durationMs",
  "elapsedMs",
];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Recursively mask a value: replace any keyed field listed in `fields` and any
 * string fully matching one of `patterns`. Returns a deep, masked clone — the
 * input is never mutated. Ordering of object keys is normalized (sorted) so the
 * comparison is insensitive to key insertion order.
 */
export function maskValue(value: unknown, config: MaskConfig = {}): unknown {
  const fields = new Set(config.fields ?? []);
  const patterns = config.patterns ?? [];
  const placeholder = config.placeholder ?? DEFAULT_PLACEHOLDER;

  function walk(v: unknown): unknown {
    if (typeof v === "string") {
      for (const p of patterns) {
        // Reset lastIndex to avoid stateful /g regex surprises.
        p.lastIndex = 0;
        const m = p.exec(v);
        if (m && m[0] === v) return placeholder;
      }
      return v;
    }
    if (Array.isArray(v)) {
      return v.map(walk);
    }
    if (isPlainObject(v)) {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(v).sort()) {
        out[key] = fields.has(key) ? placeholder : walk(v[key]);
      }
      return out;
    }
    return v;
  }

  return walk(value);
}

/** Mask an entire transcript for comparison. */
export function maskTranscript(
  transcript: Transcript,
  config: MaskConfig = {},
): Transcript {
  return maskValue(transcript, config) as Transcript;
}

/** A single point of divergence between two transcripts. */
export interface TranscriptDiffEntry {
  /** JSON-path-ish location, e.g. "turns[2].content". */
  path: string;
  expected: unknown;
  actual: unknown;
}

/** Result of comparing a candidate transcript against a golden one. */
export interface TranscriptComparison {
  match: boolean;
  diffs: TranscriptDiffEntry[];
}

function deepDiff(
  expected: unknown,
  actual: unknown,
  path: string,
  out: TranscriptDiffEntry[],
): void {
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) {
      out.push({ path: `${path}.length`, expected: expected.length, actual: actual.length });
    }
    const n = Math.max(expected.length, actual.length);
    for (let i = 0; i < n; i++) {
      deepDiff(expected[i], actual[i], `${path}[${i}]`, out);
    }
    return;
  }
  if (isPlainObject(expected) && isPlainObject(actual)) {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const k of [...keys].sort()) {
      deepDiff(expected[k], actual[k], path ? `${path}.${k}` : k, out);
    }
    return;
  }
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    out.push({ path: path || "<root>", expected, actual });
  }
}

/**
 * Compare a candidate transcript against a recorded golden one, masking
 * nondeterministic fields first. Returns whether they match and a list of
 * concrete divergences (post-mask) for debugging.
 */
export function compareTranscripts(
  golden: Transcript,
  candidate: Transcript,
  config: MaskConfig = {},
): TranscriptComparison {
  const maskedGolden = maskTranscript(golden, config);
  const maskedCandidate = maskTranscript(candidate, config);
  const diffs: TranscriptDiffEntry[] = [];
  deepDiff(maskedGolden, maskedCandidate, "", diffs);
  return { match: diffs.length === 0, diffs };
}

/**
 * Serialize a transcript to a stable, masked JSON string suitable for writing
 * to a golden file on disk. Masking + sorted keys guarantee determinism.
 */
export function serializeGolden(
  transcript: Transcript,
  config: MaskConfig = {},
): string {
  return JSON.stringify(maskTranscript(transcript, config), null, 2);
}
