// ─── Configurable Approval Policies Per Risk Level (Issue #587) ───────────────
//
// A Zod-validated configuration that maps each tool risk level
// (low/medium/high/critical) to an approval policy:
//   { autoApprove, requiredApprovers, timeoutMs }
//
// The base policy is keyed by risk level. It can be overridden per-user and/or
// per-channel; overrides are merged field-by-field on top of the base.
//
// `resolveApprovalPolicy(riskLevel, ctx)` returns the effective, fully-resolved
// policy for a given call. This module is purely declarative + a pure resolver,
// so it is fully testable and has no side effects.

import { z } from "zod";
import { ToolRiskLevelSchema } from "@karna/shared/types/tool.js";
import type { ToolRiskLevel } from "@karna/shared/types/tool.js";

// ─── Schemas ──────────────────────────────────────────────────────────────────

/** Policy applied to a single risk level. */
export const RiskLevelPolicySchema = z.object({
  /** When true, calls at this risk level are approved without human input. */
  autoApprove: z.boolean(),
  /** Number of distinct approvers required to approve a call. */
  requiredApprovers: z.number().int().nonnegative(),
  /** How long to wait for approval before timing out (ms). */
  timeoutMs: z.number().int().positive(),
});

export type RiskLevelPolicy = z.infer<typeof RiskLevelPolicySchema>;

/**
 * A partial override of a {@link RiskLevelPolicy}. Each field is optional and is
 * merged on top of the resolved base policy when present.
 */
export const RiskLevelPolicyOverrideSchema = RiskLevelPolicySchema.partial();

export type RiskLevelPolicyOverride = z.infer<typeof RiskLevelPolicyOverrideSchema>;

/** Map of every risk level → its base policy. All four levels are required. */
export const RiskLevelPolicyMapSchema = z.record(ToolRiskLevelSchema, RiskLevelPolicySchema).superRefine(
  (val, ctx) => {
    for (const level of ["low", "medium", "high", "critical"] as const) {
      if (val[level] === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Missing policy for risk level "${level}"`,
          path: [level],
        });
      }
    }
  }
);

export type RiskLevelPolicyMap = Record<ToolRiskLevel, RiskLevelPolicy>;

/**
 * A per-scope (user or channel) override: a partial policy override for any
 * subset of risk levels.
 */
export const ScopedOverrideSchema = z.record(
  ToolRiskLevelSchema,
  RiskLevelPolicyOverrideSchema
);

export type ScopedOverride = Partial<Record<ToolRiskLevel, RiskLevelPolicyOverride>>;

/** Full approval-policy configuration. */
export const ApprovalPolicyConfigSchema = z.object({
  /** Base policy per risk level. */
  base: RiskLevelPolicyMapSchema,
  /** Per-user overrides, keyed by user id. */
  users: z.record(z.string(), ScopedOverrideSchema).optional(),
  /** Per-channel overrides, keyed by channel id. */
  channels: z.record(z.string(), ScopedOverrideSchema).optional(),
});

/**
 * Full approval-policy configuration.
 *
 * Declared explicitly (rather than `z.infer`) because `z.record(enum, …)` infers
 * a `Partial` map, whereas the schema's `superRefine` guarantees all four risk
 * levels are present in `base` at runtime. This keeps `config.base[level]`
 * non-optional for callers.
 */
export interface ApprovalPolicyConfig {
  base: RiskLevelPolicyMap;
  users?: Record<string, ScopedOverride>;
  channels?: Record<string, ScopedOverride>;
}

// ─── Default Config ───────────────────────────────────────────────────────────

/**
 * Default base policy. Mirrors the existing default behavior in
 * `tools/approval.ts`: low/medium auto-approve, high/critical require approval.
 */
export const DEFAULT_BASE_POLICY: RiskLevelPolicyMap = {
  low: { autoApprove: true, requiredApprovers: 0, timeoutMs: 300_000 },
  medium: { autoApprove: true, requiredApprovers: 0, timeoutMs: 300_000 },
  high: { autoApprove: false, requiredApprovers: 1, timeoutMs: 300_000 },
  critical: { autoApprove: false, requiredApprovers: 2, timeoutMs: 300_000 },
};

/** A complete default configuration with no scope overrides. */
export const DEFAULT_APPROVAL_POLICY_CONFIG: ApprovalPolicyConfig = {
  base: DEFAULT_BASE_POLICY,
};

// ─── Resolver ─────────────────────────────────────────────────────────────────

/** Context for resolving a policy: optionally a user and/or channel scope. */
export interface ApprovalPolicyContext {
  userId?: string;
  channelId?: string;
}

/**
 * Resolve the effective approval policy for a risk level under a given context.
 *
 * Merge order (later wins, field-by-field):
 *   base[riskLevel] → channel override[riskLevel] → user override[riskLevel]
 *
 * User overrides take highest precedence so that an individual operator's
 * configuration wins over a broader channel default.
 */
export function resolveApprovalPolicy(
  riskLevel: ToolRiskLevel,
  ctx: ApprovalPolicyContext = {},
  config: ApprovalPolicyConfig = DEFAULT_APPROVAL_POLICY_CONFIG
): RiskLevelPolicy {
  let policy: RiskLevelPolicy = { ...config.base[riskLevel] };

  if (ctx.channelId) {
    const override = config.channels?.[ctx.channelId]?.[riskLevel];
    if (override) policy = mergePolicy(policy, override);
  }

  if (ctx.userId) {
    const override = config.users?.[ctx.userId]?.[riskLevel];
    if (override) policy = mergePolicy(policy, override);
  }

  return policy;
}

/** Merge a partial override on top of a base policy (override fields win). */
function mergePolicy(base: RiskLevelPolicy, override: RiskLevelPolicyOverride): RiskLevelPolicy {
  return {
    autoApprove: override.autoApprove ?? base.autoApprove,
    requiredApprovers: override.requiredApprovers ?? base.requiredApprovers,
    timeoutMs: override.timeoutMs ?? base.timeoutMs,
  };
}

/**
 * Parse and validate an untrusted approval-policy configuration. Throws a
 * ZodError on invalid input.
 */
export function parseApprovalPolicyConfig(input: unknown): ApprovalPolicyConfig {
  // The schema's superRefine guarantees all risk levels exist in `base`; the
  // inferred type is `Partial`, so we narrow to the strict config interface.
  return ApprovalPolicyConfigSchema.parse(input) as ApprovalPolicyConfig;
}
