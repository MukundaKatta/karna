// ─── PII Detection & Redaction ──────────────────────────────────────────────
// Issue #542 — Detect and redact common PII before persistence.
//
// Pure, dependency-free regex detectors for: email, phone, SSN-like,
// credit-card-like (with Luhn validation to reduce false positives), and IPv4.
// Redaction can be irreversible (placeholder tokens) or reversible via a
// returned token map that callers can use to restore the original text.
// An optional injected classifier can contribute additional spans.
//
// Additive & non-breaking: nothing runs unless invoked.

// ─── Types ──────────────────────────────────────────────────────────────────

export type PiiType = "email" | "phone" | "ssn" | "credit_card" | "ip" | "custom";

export interface PiiMatch {
  type: PiiType;
  /** The matched substring. */
  value: string;
  /** Start index (inclusive) in the source string. */
  start: number;
  /** End index (exclusive) in the source string. */
  end: number;
}

/**
 * Optional classifier hook: receives the raw text and returns extra spans
 * (e.g. names from an NER model). Injected to keep this module pure.
 */
export type PiiClassifier = (text: string) => PiiMatch[];

export interface RedactionOptions {
  /** Restrict detection to these types. Default: all built-in types. */
  types?: PiiType[];
  /**
   * When true, produce a reversible token map so the original can be restored.
   * Tokens look like `[[PII:email:1]]`. Default: false (irreversible).
   */
  reversible?: boolean;
  /** Optional extra classifier contributing spans. */
  classifier?: PiiClassifier;
  /**
   * Placeholder used for irreversible redaction. The PII type is interpolated
   * as `{type}`. Default: `[REDACTED_{type}]`.
   */
  placeholder?: string;
}

export interface RedactionResult {
  /** Redacted text. */
  redacted: string;
  /** All detected matches (over the original text). */
  matches: PiiMatch[];
  /**
   * Token -> original value map. Only populated when `reversible` is true.
   * Pass this to {@link restorePii} to reverse the redaction.
   */
  tokenMap: Record<string, string>;
}

// ─── Detectors ────────────────────────────────────────────────────────────

// Order matters: more specific / longer patterns first so they win overlap
// resolution (email before phone, credit card before phone/ssn, etc.).
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
// 13–16 digit runs allowing space/dash separators (credit-card-like).
const CARD_RE = /\b(?:\d[ -]?){13,16}\b/g;
// US SSN-like: 3-2-4 with dashes or spaces.
const SSN_RE = /\b\d{3}[ -]\d{2}[ -]\d{4}\b/g;
// Phone-like: optional +, country/area groups, 7+ digits total.
const PHONE_RE = /(?:\+?\d{1,3}[ .-]?)?(?:\(\d{1,4}\)[ .-]?)?\d{2,4}[ .-]?\d{3,4}[ .-]?\d{3,4}\b/g;
// IPv4 with octet bounds.
const IP_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;

const ALL_TYPES: PiiType[] = ["email", "credit_card", "ssn", "ip", "phone"];

/** Luhn checksum — used to reduce credit-card false positives. */
function luhnValid(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function collect(re: RegExp, text: string, type: PiiType, validate?: (m: string) => boolean): PiiMatch[] {
  const out: PiiMatch[] = [];
  // Reset lastIndex defensively (module-level regexes are stateful with /g).
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const value = m[0];
    if (m.index === re.lastIndex) re.lastIndex++; // avoid zero-width loops
    if (validate && !validate(value)) continue;
    out.push({ type, value, start: m.index, end: m.index + value.length });
  }
  return out;
}

/**
 * Detect PII spans in `text`. Overlapping matches are resolved by preferring
 * earlier start, then longer span, then the type priority above. The returned
 * matches are sorted by start and never overlap.
 */
export function detectPii(text: string, options?: RedactionOptions): PiiMatch[] {
  const enabled = new Set(options?.types ?? ALL_TYPES);
  const raw: PiiMatch[] = [];

  if (enabled.has("email")) raw.push(...collect(EMAIL_RE, text, "email"));
  if (enabled.has("credit_card")) raw.push(...collect(CARD_RE, text, "credit_card", luhnValid));
  if (enabled.has("ssn")) raw.push(...collect(SSN_RE, text, "ssn"));
  if (enabled.has("ip")) raw.push(...collect(IP_RE, text, "ip"));
  if (enabled.has("phone")) raw.push(...collect(PHONE_RE, text, "phone"));

  if (options?.classifier) {
    try {
      raw.push(...options.classifier(text).map((m) => ({ ...m, type: m.type ?? ("custom" as PiiType) })));
    } catch {
      // Classifier failures must never break redaction.
    }
  }

  return resolveOverlaps(raw);
}

const TYPE_PRIORITY: Record<PiiType, number> = {
  email: 0,
  credit_card: 1,
  ssn: 2,
  ip: 3,
  phone: 4,
  custom: 5,
};

function resolveOverlaps(matches: PiiMatch[]): PiiMatch[] {
  const sorted = [...matches].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    const lenA = a.end - a.start;
    const lenB = b.end - b.start;
    if (lenA !== lenB) return lenB - lenA; // longer first
    return TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type];
  });

  const result: PiiMatch[] = [];
  let lastEnd = -1;
  for (const m of sorted) {
    if (m.start >= lastEnd) {
      result.push(m);
      lastEnd = m.end;
    }
  }
  return result;
}

// ─── Redaction ──────────────────────────────────────────────────────────────

function defaultPlaceholder(template: string | undefined, type: PiiType): string {
  const t = template ?? "[REDACTED_{type}]";
  return t.replace(/\{type\}/g, type.toUpperCase());
}

/**
 * Redact detected PII from `text`. When `reversible` is set, each match is
 * replaced by a stable token and the original value is recorded in `tokenMap`;
 * otherwise a type placeholder is used. Identical values reuse the same token.
 */
export function redactPii(text: string, options?: RedactionOptions): RedactionResult {
  const matches = detectPii(text, options);
  const reversible = options?.reversible ?? false;
  const tokenMap: Record<string, string> = {};
  // value -> token, so repeated PII collapses to one token (round-trippable).
  const valueToToken = new Map<string, string>();
  const counters: Partial<Record<PiiType, number>> = {};

  let result = "";
  let cursor = 0;
  for (const m of matches) {
    result += text.slice(cursor, m.start);
    if (reversible) {
      let token = valueToToken.get(m.value);
      if (!token) {
        const n = (counters[m.type] ?? 0) + 1;
        counters[m.type] = n;
        token = `[[PII:${m.type}:${n}]]`;
        valueToToken.set(m.value, token);
        tokenMap[token] = m.value;
      }
      result += token;
    } else {
      result += defaultPlaceholder(options?.placeholder, m.type);
    }
    cursor = m.end;
  }
  result += text.slice(cursor);

  return { redacted: result, matches, tokenMap };
}

/**
 * Reverse a reversible redaction by substituting tokens back to their original
 * values using the `tokenMap` returned by {@link redactPii}.
 */
export function restorePii(redacted: string, tokenMap: Record<string, string>): string {
  let result = redacted;
  for (const [token, value] of Object.entries(tokenMap)) {
    result = result.split(token).join(value);
  }
  return result;
}

/** Convenience: true if `text` contains any detectable PII. */
export function containsPii(text: string, options?: RedactionOptions): boolean {
  return detectPii(text, options).length > 0;
}
