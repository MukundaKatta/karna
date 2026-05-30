// ─── Pre-Execution Policy Engine (Issue #556) ────────────────────────────────
//
// A declarative rule engine evaluated BEFORE a tool executes. Rules match over
// (tool, args, riskLevel, user, context) and yield a decision:
//   allow | deny | require-approval | dry-run
//
// Rules are evaluated in priority order (highest first; ties → declaration
// order). The first matching rule wins. When no rule matches, a configurable
// default decision applies (default "allow", so wiring this in is non-breaking).
//
// Every evaluation is recorded in an in-memory audit log for observability.
//
// Pure aside from the audit buffer and a clock; the matchers themselves are
// pure functions, so the engine is fully testable.

import type { ToolRiskLevel } from "@karna/shared/types/tool.js";

export type PolicyDecision = "allow" | "deny" | "require-approval" | "dry-run";

/** The subject of a policy evaluation. */
export interface PolicyInput {
  toolName: string;
  args: Record<string, unknown>;
  riskLevel: ToolRiskLevel;
  /** Acting user / subject, if known. */
  user?: string;
  /** Arbitrary contextual signals (sessionId, agentId, channel, tags, …). */
  context?: Record<string, unknown>;
}

/**
 * A condition over a {@link PolicyInput}. Either a declarative matcher object or
 * a predicate function. All declarative fields are ANDed together.
 */
export interface PolicyCondition {
  /** Match these exact tool names. */
  tools?: string[];
  /** Match these risk levels. */
  riskLevels?: ToolRiskLevel[];
  /** Match these acting users. */
  users?: string[];
  /**
   * Regexes (as strings, case-insensitive) tested against the JSON-stringified
   * args. Any match satisfies this field.
   */
  argPatterns?: string[];
  /** Custom predicate; ANDed with the declarative fields when present. */
  predicate?: (input: PolicyInput) => boolean;
}

export interface PolicyRule {
  /** Stable identifier for auditing. */
  id: string;
  /** Decision applied when this rule matches. */
  decision: PolicyDecision;
  /** Match condition. Omit to match everything (a catch-all). */
  when?: PolicyCondition;
  /** Higher priority rules are evaluated first. Default 0. */
  priority?: number;
  /** Optional human-readable explanation, surfaced in the audit entry. */
  reason?: string;
}

export interface PolicyEvaluation {
  decision: PolicyDecision;
  /** The rule id that produced the decision, or "default" if none matched. */
  matchedRuleId: string;
  reason?: string;
  input: { toolName: string; riskLevel: ToolRiskLevel; user?: string };
  at: number;
}

export interface PolicyEngineOptions {
  /** Decision used when no rule matches. Default "allow" (non-breaking). */
  defaultDecision?: PolicyDecision;
  /** Max audit entries to retain (ring buffer). Default 1000. */
  maxAudit?: number;
  /** Clock override for deterministic tests. */
  now?: () => number;
}

const DEFAULT_MAX_AUDIT = 1000;

export class PolicyEngine {
  private rules: PolicyRule[] = [];
  private readonly defaultDecision: PolicyDecision;
  private readonly maxAudit: number;
  private readonly now: () => number;
  private readonly auditLog: PolicyEvaluation[] = [];

  constructor(rules: PolicyRule[] = [], options: PolicyEngineOptions = {}) {
    this.defaultDecision = options.defaultDecision ?? "allow";
    this.maxAudit = options.maxAudit ?? DEFAULT_MAX_AUDIT;
    this.now = options.now ?? Date.now;
    for (const rule of rules) this.addRule(rule);
  }

  /** Add a rule, keeping the rule set sorted by descending priority. */
  addRule(rule: PolicyRule): void {
    this.rules.push(rule);
    // Stable sort by priority desc; preserves declaration order for ties.
    this.rules = this.rules
      .map((r, i) => ({ r, i }))
      .sort((a, b) => (b.r.priority ?? 0) - (a.r.priority ?? 0) || a.i - b.i)
      .map((x) => x.r);
  }

  /** Remove a rule by id. Returns true if one was removed. */
  removeRule(id: string): boolean {
    const before = this.rules.length;
    this.rules = this.rules.filter((r) => r.id !== id);
    return this.rules.length < before;
  }

  /** Current rules in evaluation order. */
  getRules(): readonly PolicyRule[] {
    return this.rules;
  }

  /**
   * Evaluate the policy for a tool call. Records and returns the evaluation.
   * The first matching rule (by priority) wins; otherwise the default applies.
   */
  evaluate(input: PolicyInput): PolicyEvaluation {
    let matched: PolicyRule | undefined;
    for (const rule of this.rules) {
      if (matchesCondition(rule.when, input)) {
        matched = rule;
        break;
      }
    }

    const evaluation: PolicyEvaluation = {
      decision: matched?.decision ?? this.defaultDecision,
      matchedRuleId: matched?.id ?? "default",
      reason: matched?.reason,
      input: { toolName: input.toolName, riskLevel: input.riskLevel, user: input.user },
      at: this.now(),
    };

    this.record(evaluation);
    return evaluation;
  }

  /** A snapshot of the audit log (most recent last). */
  getAudit(): readonly PolicyEvaluation[] {
    return [...this.auditLog];
  }

  /** Clear the audit log. */
  clearAudit(): void {
    this.auditLog.length = 0;
  }

  private record(evaluation: PolicyEvaluation): void {
    this.auditLog.push(evaluation);
    if (this.auditLog.length > this.maxAudit) {
      this.auditLog.splice(0, this.auditLog.length - this.maxAudit);
    }
  }
}

/** Whether a condition matches an input. Undefined condition matches all. */
export function matchesCondition(
  condition: PolicyCondition | undefined,
  input: PolicyInput,
): boolean {
  if (!condition) return true;

  if (condition.tools && !condition.tools.includes(input.toolName)) {
    return false;
  }
  if (condition.riskLevels && !condition.riskLevels.includes(input.riskLevel)) {
    return false;
  }
  if (condition.users) {
    if (input.user === undefined || !condition.users.includes(input.user)) {
      return false;
    }
  }
  if (condition.argPatterns && condition.argPatterns.length > 0) {
    const haystack = safeStringify(input.args);
    const anyMatch = condition.argPatterns.some((p) => {
      try {
        return new RegExp(p, "i").test(haystack);
      } catch {
        return false;
      }
    });
    if (!anyMatch) return false;
  }
  if (condition.predicate && !condition.predicate(input)) {
    return false;
  }
  return true;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}
