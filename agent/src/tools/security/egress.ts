// ─── Per-Tool Egress Allowlists (Issue #557) ─────────────────────────────────
//
// A per-tool host allowlist enforcing where a tool may make outbound network
// requests. Tools explicitly marked "untrusted" are DEFAULT-DENY (must match an
// allowlist entry); all other tools are DEFAULT-ALLOW, so wiring this in does
// not change behavior for existing tools unless they are configured.
//
// Host matching supports exact hosts and leading-dot wildcards (".example.com"
// matches the apex and any subdomain). Loopback/private ranges can optionally
// be blocked to mitigate SSRF.

import pino from "pino";

const logger = pino({ name: "tool-egress" });

/** Per-tool egress rule. */
export interface EgressRule {
  /**
   * When true, this tool is default-deny: only hosts matching `allow` may be
   * reached. When false/omitted, the tool is default-allow.
   */
  untrusted?: boolean;
  /**
   * Allowed hosts. An entry beginning with "." (e.g. ".example.com") matches
   * the apex domain and all subdomains. Otherwise exact host match (port
   * ignored). Case-insensitive.
   */
  allow?: string[];
  /** Hosts that are always denied, taking precedence over `allow`. */
  deny?: string[];
  /** Allowed URL schemes. Default ["http:", "https:"]. */
  schemes?: string[];
  /** Block loopback / private / link-local addresses (SSRF guard). Default false. */
  blockPrivate?: boolean;
}

export type EgressDecision =
  | { allowed: true; host: string }
  | { allowed: false; host: string | null; reason: string };

/** Thrown by `assertEgressAllowed` when a request is denied. */
export class EgressDeniedError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly url: string,
    public readonly reason: string,
  ) {
    super(`Egress denied for tool "${toolName}" to ${url}: ${reason}`);
    this.name = "EgressDeniedError";
  }
}

const DEFAULT_SCHEMES = ["http:", "https:"];

export class EgressPolicy {
  private readonly rules: Map<string, EgressRule>;

  constructor(rules: Record<string, EgressRule> = {}) {
    this.rules = new Map(Object.entries(rules));
  }

  /** Set or replace the egress rule for a tool. */
  configure(toolName: string, rule: EgressRule): void {
    this.rules.set(toolName, rule);
  }

  /** Mark a tool untrusted with an optional initial allowlist. */
  markUntrusted(toolName: string, allow: string[] = []): void {
    const existing = this.rules.get(toolName) ?? {};
    this.rules.set(toolName, { ...existing, untrusted: true, allow });
  }

  /**
   * Decide whether `url` is permitted for `toolName`. Pure: returns a decision
   * and never throws on a denial (only on a malformed URL, surfaced as denied).
   */
  evaluate(toolName: string, url: string): EgressDecision {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { allowed: false, host: null, reason: "invalid URL" };
    }

    const host = parsed.hostname.toLowerCase();
    const rule = this.rules.get(toolName);
    const schemes = rule?.schemes ?? DEFAULT_SCHEMES;

    if (!schemes.includes(parsed.protocol)) {
      return { allowed: false, host, reason: `scheme "${parsed.protocol}" not permitted` };
    }

    // Explicit deny always wins.
    if (rule?.deny && hostMatchesAny(host, rule.deny)) {
      return { allowed: false, host, reason: "host is explicitly denied" };
    }

    if (rule?.blockPrivate && isPrivateHost(host)) {
      return { allowed: false, host, reason: "private/loopback address blocked" };
    }

    const untrusted = rule?.untrusted ?? false;
    if (!untrusted) {
      // Default-allow tools: allowed unless explicitly denied (handled above).
      return { allowed: true, host };
    }

    // Default-deny tools must match the allowlist.
    if (rule?.allow && hostMatchesAny(host, rule.allow)) {
      return { allowed: true, host };
    }
    return { allowed: false, host, reason: "host not in allowlist for untrusted tool" };
  }

  /** Whether `toolName` is permitted to reach `url`. */
  isAllowed(toolName: string, url: string): boolean {
    return this.evaluate(toolName, url).allowed;
  }

  /**
   * Assert that `toolName` may reach `url`, throwing {@link EgressDeniedError}
   * with a structured reason on denial. Returns the normalized host on success.
   */
  assertEgressAllowed(toolName: string, url: string): string {
    const decision = this.evaluate(toolName, url);
    if (!decision.allowed) {
      logger.warn({ tool: toolName, url, reason: decision.reason }, "Egress denied");
      throw new EgressDeniedError(toolName, url, decision.reason);
    }
    return decision.host;
  }
}

/** Standalone convenience matching {@link EgressPolicy.assertEgressAllowed}. */
export function assertEgressAllowed(
  policy: EgressPolicy,
  toolName: string,
  url: string,
): string {
  return policy.assertEgressAllowed(toolName, url);
}

/** Whether `host` matches any entry (exact or leading-dot wildcard). */
function hostMatchesAny(host: string, entries: string[]): boolean {
  for (const raw of entries) {
    const entry = raw.toLowerCase();
    if (entry.startsWith(".")) {
      const suffix = entry; // e.g. ".example.com"
      const apex = entry.slice(1); // "example.com"
      if (host === apex || host.endsWith(suffix)) {
        return true;
      }
    } else if (host === entry) {
      return true;
    }
  }
  return false;
}

/** Heuristic check for loopback / private / link-local hosts (IPv4 + common IPv6). */
function isPrivateHost(host: string): boolean {
  if (host === "localhost" || host === "::1" || host === "0.0.0.0") return true;
  // Strip IPv6 brackets if present.
  const h = host.replace(/^\[|\]$/g, "");
  // IPv4 dotted quad.
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  // IPv6 unique-local / link-local prefixes.
  if (/^f[cd][0-9a-f]{2}:/i.test(h) || /^fe80:/i.test(h)) return true;
  return false;
}
