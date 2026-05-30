// ─── Data Exfiltration Guardrails (Issue #565) ───────────────────────────────
//
// Scan outbound tool arguments / messages for secrets and PII before they leave
// the agent (network calls, messages, file writes). Reuses the secret detection
// from `secrets.ts` and adds PII patterns. Per the configured policy, matches
// can be allowed (logged), redacted in place, or blocked.
//
// Default policy is "allow" so wiring this in does not change behavior; callers
// opt into "redact"/"block".

import { Redactor, SECRET_PATTERNS, type RedactorOptions } from "./secrets.js";

/** What to do when sensitive data is found on an outbound payload. */
export type ExfilAction = "allow" | "redact" | "block";

/** A single detected sensitive finding. */
export interface ExfilFinding {
  /** Detector name (secret pattern name or PII category). */
  kind: string;
  /** Category for coarse filtering. */
  category: "secret" | "pii";
  /** The matched substring (truncated). */
  match: string;
  /** Dot-path within the scanned object, or "" for a top-level string. */
  path: string;
}

export interface ExfilScanResult {
  /** Whether any sensitive data was found. */
  flagged: boolean;
  /** The resolved action for this scan. */
  action: ExfilAction;
  /** All findings. */
  findings: ExfilFinding[];
  /**
   * The payload after applying the action. For "redact" this is a sanitized
   * copy; for "allow"/"block" it is the original value (callers should not send
   * it when `blocked` is true).
   */
  sanitized: unknown;
  /** True when action is "block" and findings exist. */
  blocked: boolean;
}

/** PII detectors layered on top of the secret patterns. */
export const PII_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: "email", pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { name: "credit_card", pattern: /\b(?:\d[ -]?){13,16}\b/g },
  { name: "ssn", pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  { name: "phone", pattern: /\b(?:\+?\d{1,3}[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}\b/g },
  { name: "ipv4", pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
];

export interface ExfilGuardOptions {
  /** Action to take on findings. Default "allow". */
  action?: ExfilAction;
  /** Scan for secret patterns. Default true. */
  scanSecrets?: boolean;
  /** Scan for PII patterns. Default true. */
  scanPii?: boolean;
  /** Restrict to specific detector names (by `name`). Omit for all. */
  only?: string[];
  /** Extra known secret values to redact, forwarded to the {@link Redactor}. */
  knownValues?: Iterable<string>;
  /** Max characters retained per finding match. Default 80. */
  maxMatchLength?: number;
  /** Replacement token for redaction. Default "[REDACTED]". */
  replacement?: string;
}

export class ExfilGuard {
  private readonly action: ExfilAction;
  private readonly scanSecrets: boolean;
  private readonly scanPii: boolean;
  private readonly only?: Set<string>;
  private readonly maxMatchLength: number;
  private readonly redactor: Redactor;
  private readonly knownValues: string[];

  constructor(options: ExfilGuardOptions = {}) {
    this.action = options.action ?? "allow";
    this.scanSecrets = options.scanSecrets ?? true;
    this.scanPii = options.scanPii ?? true;
    this.only = options.only ? new Set(options.only) : undefined;
    this.maxMatchLength = options.maxMatchLength ?? 80;
    this.knownValues = [...(options.knownValues ?? [])];
    const redactorOpts: RedactorOptions = {
      values: this.knownValues,
      usePatterns: true,
      replacement: options.replacement,
    };
    this.redactor = new Redactor(redactorOpts);
  }

  /**
   * Scan an outbound payload (string or object) and apply the configured
   * action. Never throws; callers inspect `blocked`.
   */
  scan(payload: unknown): ExfilScanResult {
    const findings: ExfilFinding[] = [];
    this.collect(payload, "", findings);

    const flagged = findings.length > 0;
    let sanitized = payload;
    let blocked = false;

    if (flagged) {
      if (this.action === "redact") {
        sanitized = this.redactor.redact(payload);
      } else if (this.action === "block") {
        blocked = true;
      }
    }

    return { flagged, action: this.action, findings, sanitized, blocked };
  }

  private detectors(): ReadonlyArray<{ name: string; category: "secret" | "pii"; pattern: RegExp }> {
    const out: Array<{ name: string; category: "secret" | "pii"; pattern: RegExp }> = [];
    if (this.scanSecrets) {
      for (const p of SECRET_PATTERNS) {
        if (!this.only || this.only.has(p.name)) out.push({ ...p, category: "secret" });
      }
    }
    if (this.scanPii) {
      for (const p of PII_PATTERNS) {
        if (!this.only || this.only.has(p.name)) out.push({ ...p, category: "pii" });
      }
    }
    return out;
  }

  private collect(value: unknown, path: string, out: ExfilFinding[]): void {
    if (typeof value === "string") {
      this.scanString(value, path, out);
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => this.collect(v, path ? `${path}[${i}]` : `[${i}]`, out));
    } else if (value !== null && typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        this.collect(v, path ? `${path}.${k}` : k, out);
      }
    }
  }

  private scanString(value: string, path: string, out: ExfilFinding[]): void {
    // Exact known secret values.
    for (const known of this.knownValues) {
      if (known.length >= 4 && value.includes(known)) {
        out.push({ kind: "known_secret", category: "secret", match: this.truncate(known), path });
      }
    }
    for (const det of this.detectors()) {
      det.pattern.lastIndex = 0;
      for (const m of value.matchAll(det.pattern)) {
        out.push({
          kind: det.name,
          category: det.category,
          match: this.truncate(m[0]),
          path,
        });
      }
    }
  }

  private truncate(s: string): string {
    return s.length > this.maxMatchLength ? s.slice(0, this.maxMatchLength) + "…" : s;
  }
}

/** One-shot convenience: scan a payload with the given options. */
export function scanForExfil(payload: unknown, options: ExfilGuardOptions = {}): ExfilScanResult {
  return new ExfilGuard(options).scan(payload);
}
