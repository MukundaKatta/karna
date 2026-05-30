// ─── Secrets Vault Integration & Redaction (Issue #559) ──────────────────────
//
// A pluggable SecretsProvider interface so secrets can be fetched at execution
// time from an environment, an in-memory map, or a real vault (e.g. Vault /
// AWS Secrets Manager) supplied by the host. Plus a redactor that scrubs known
// secret values — and structurally-likely secrets (tokens, keys) — from
// strings and objects before they hit logs or model context.
//
// This module is additive and side-effect-free at import time. Nothing here
// changes executor behavior unless a caller wires it in.

/**
 * Pluggable provider that resolves named secrets at execution time. Async to
 * accommodate remote vaults; the built-in providers resolve synchronously.
 */
export interface SecretsProvider {
  /** Resolve a single secret by name. Returns undefined if not found. */
  get(name: string): Promise<string | undefined>;
  /** List available secret names (best-effort; vaults may return []). */
  list?(): Promise<string[]>;
}

/** A SecretsProvider backed by `process.env` (or an injected env map). */
export class EnvSecretsProvider implements SecretsProvider {
  private readonly env: Record<string, string | undefined>;
  /** Optional prefix; only env keys starting with it are exposed (stripped). */
  private readonly prefix: string;

  constructor(options: { env?: Record<string, string | undefined>; prefix?: string } = {}) {
    this.env = options.env ?? process.env;
    this.prefix = options.prefix ?? "";
  }

  async get(name: string): Promise<string | undefined> {
    return this.env[this.prefix + name];
  }

  async list(): Promise<string[]> {
    return Object.keys(this.env)
      .filter((k) => k.startsWith(this.prefix))
      .map((k) => k.slice(this.prefix.length));
  }
}

/** A SecretsProvider backed by an in-memory map. Useful for tests/injection. */
export class InMemorySecretsProvider implements SecretsProvider {
  private readonly store: Map<string, string>;

  constructor(initial: Record<string, string> = {}) {
    this.store = new Map(Object.entries(initial));
  }

  set(name: string, value: string): void {
    this.store.set(name, value);
  }

  delete(name: string): boolean {
    return this.store.delete(name);
  }

  async get(name: string): Promise<string | undefined> {
    return this.store.get(name);
  }

  async list(): Promise<string[]> {
    return [...this.store.keys()];
  }
}

/**
 * Inject named secrets into a tool's input at execution time. Placeholders of
 * the form `{{secret:NAME}}` in string values are replaced with the resolved
 * secret. Returns a new object; the original input is not mutated.
 *
 * Unknown secrets are left as-is unless `strict` is set, in which case the
 * resolution rejects.
 */
const SECRET_PLACEHOLDER = /\{\{\s*secret:([A-Za-z0-9_.-]+)\s*\}\}/g;

export async function injectSecrets(
  provider: SecretsProvider,
  input: Record<string, unknown>,
  options: { strict?: boolean } = {},
): Promise<Record<string, unknown>> {
  // Collect all referenced secret names first so each is fetched once.
  const names = new Set<string>();
  collectPlaceholders(input, names);

  const resolved = new Map<string, string | undefined>();
  for (const name of names) {
    resolved.set(name, await provider.get(name));
  }

  return substitute(input, resolved, options.strict ?? false) as Record<string, unknown>;
}

function collectPlaceholders(value: unknown, out: Set<string>): void {
  if (typeof value === "string") {
    for (const m of value.matchAll(SECRET_PLACEHOLDER)) {
      out.add(m[1]!);
    }
  } else if (Array.isArray(value)) {
    for (const v of value) collectPlaceholders(v, out);
  } else if (value !== null && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectPlaceholders(v, out);
    }
  }
}

function substitute(
  value: unknown,
  resolved: Map<string, string | undefined>,
  strict: boolean,
): unknown {
  if (typeof value === "string") {
    return value.replace(SECRET_PLACEHOLDER, (whole, name: string) => {
      const secret = resolved.get(name);
      if (secret === undefined) {
        if (strict) {
          throw new Error(`Secret "${name}" is not available`);
        }
        return whole;
      }
      return secret;
    });
  }
  if (Array.isArray(value)) {
    return value.map((v) => substitute(v, resolved, strict));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = substitute(v, resolved, strict);
    }
    return out;
  }
  return value;
}

// ─── Redaction ────────────────────────────────────────────────────────────

/** Placeholder substituted in place of a redacted value. */
export const REDACTED = "[REDACTED]";

/**
 * Structural patterns for things that *look* like secrets even when their exact
 * value is unknown. Ordered roughly most-specific to least.
 */
export const SECRET_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: "anthropic_key", pattern: /sk-ant-[A-Za-z0-9_-]{16,}/g },
  { name: "openai_key", pattern: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { name: "aws_access_key", pattern: /AKIA[0-9A-Z]{16}/g },
  { name: "github_token", pattern: /gh[pousr]_[A-Za-z0-9]{36,}/g },
  { name: "slack_token", pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { name: "google_api_key", pattern: /AIza[0-9A-Za-z_-]{35}/g },
  { name: "jwt", pattern: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { name: "private_key_block", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: "bearer_token", pattern: /\bBearer\s+[A-Za-z0-9._-]{16,}/g },
];

export interface RedactorOptions {
  /** Exact secret values to always scrub (e.g. resolved env secrets). */
  values?: Iterable<string>;
  /** Also apply structural {@link SECRET_PATTERNS}. Default true. */
  usePatterns?: boolean;
  /** Replacement token. Default {@link REDACTED}. */
  replacement?: string;
  /** Minimum length for an exact value to be eligible for scrubbing. Default 4. */
  minValueLength?: number;
}

/**
 * A reusable redactor. Build once with known secret values, then scrub strings
 * or whole objects (recursively) before logging.
 */
export class Redactor {
  private readonly values: string[];
  private readonly usePatterns: boolean;
  private readonly replacement: string;

  constructor(options: RedactorOptions = {}) {
    const min = options.minValueLength ?? 4;
    this.values = [...(options.values ?? [])]
      .filter((v) => typeof v === "string" && v.length >= min)
      // Longest first so we redact the most specific match.
      .sort((a, b) => b.length - a.length);
    this.usePatterns = options.usePatterns ?? true;
    this.replacement = options.replacement ?? REDACTED;
  }

  /** Scrub a single string. */
  redactString(input: string): string {
    let out = input;
    for (const value of this.values) {
      if (value && out.includes(value)) {
        out = out.split(value).join(this.replacement);
      }
    }
    if (this.usePatterns) {
      for (const { pattern } of SECRET_PATTERNS) {
        // Reset lastIndex defensively (patterns are global).
        pattern.lastIndex = 0;
        out = out.replace(pattern, this.replacement);
      }
    }
    return out;
  }

  /** Recursively scrub an arbitrary value (strings inside objects/arrays). */
  redact<T>(value: T): T {
    return this.redactValue(value) as T;
  }

  private redactValue(value: unknown): unknown {
    if (typeof value === "string") {
      return this.redactString(value);
    }
    if (Array.isArray(value)) {
      return value.map((v) => this.redactValue(v));
    }
    if (value !== null && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = this.redactValue(v);
      }
      return out;
    }
    return value;
  }
}

/** Convenience: redact a string using only structural patterns (no known values). */
export function redactSecrets(input: string, replacement = REDACTED): string {
  return new Redactor({ usePatterns: true, replacement }).redactString(input);
}
