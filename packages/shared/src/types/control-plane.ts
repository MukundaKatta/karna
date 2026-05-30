import { z } from "zod";

/** Memory tier identifiers used by the control plane (kept local to stay decoupled). */
const MemoryTierSchema = z.enum(["working", "short-term", "long-term"]);

/**
 * Per-risk-level approval policy. Each risk level maps to whether tool calls at
 * that level are auto-approved or require explicit human approval.
 */
export const ApprovalActionSchema = z.enum(["auto", "require-approval", "deny"]);
export type ApprovalAction = z.infer<typeof ApprovalActionSchema>;

export const ApprovalPolicySchema = z.object({
  low: ApprovalActionSchema.default("auto"),
  medium: ApprovalActionSchema.default("require-approval"),
  high: ApprovalActionSchema.default("require-approval"),
  critical: ApprovalActionSchema.default("deny"),
});
export type ApprovalPolicy = z.infer<typeof ApprovalPolicySchema>;

/**
 * Tool allow/deny configuration. An empty allowlist means "all tools permitted"
 * (subject to the denylist). A non-empty allowlist is exclusive.
 */
export const ToolAccessConfigSchema = z.object({
  allowlist: z.array(z.string()).default([]),
  denylist: z.array(z.string()).default([]),
});
export type ToolAccessConfig = z.infer<typeof ToolAccessConfigSchema>;

/**
 * Memory tier settings: which tiers are enabled and their retention/promotion
 * thresholds.
 */
export const MemoryTierSettingsSchema = z.object({
  enabledTiers: z.array(MemoryTierSchema).default(["working", "short-term", "long-term"]),
  workingMaxItems: z.number().int().positive().default(50),
  shortTermMaxItems: z.number().int().positive().default(500),
  longTermMaxItems: z.number().int().positive().default(10_000),
  promotionThreshold: z.number().min(0).max(1).default(0.5),
});
export type MemoryTierSettings = z.infer<typeof MemoryTierSettingsSchema>;

/**
 * Model routing preferences: the primary model plus an ordered failover chain.
 */
export const ModelRoutingPrefsSchema = z.object({
  primary: z.string().min(1).default("claude-3-5-sonnet-20241022"),
  fallbacks: z.array(z.string()).default([]),
  preferCheapModels: z.boolean().default(false),
});
export type ModelRoutingPrefs = z.infer<typeof ModelRoutingPrefsSchema>;

/**
 * Hard budgets enforced over a single agent run/loop.
 */
export const BudgetConfigSchema = z.object({
  maxIterations: z.number().int().positive().default(10),
  maxTokens: z.number().int().positive().default(200_000),
  maxCostUsd: z.number().nonnegative().default(5),
  maxWallClockMs: z.number().int().positive().default(120_000),
});
export type BudgetConfig = z.infer<typeof BudgetConfigSchema>;

/**
 * Control plane configuration centralizes runtime governance: which tools may
 * run, what requires approval, memory behavior, model routing, and budgets.
 */
export const ControlPlaneConfigSchema = z.object({
  tools: ToolAccessConfigSchema.default({}),
  approval: ApprovalPolicySchema.default({}),
  memory: MemoryTierSettingsSchema.default({}),
  routing: ModelRoutingPrefsSchema.default({}),
  budgets: BudgetConfigSchema.default({}),
});
export type ControlPlaneConfig = z.infer<typeof ControlPlaneConfigSchema>;

/**
 * Produce a fully-populated default control plane config from schema defaults.
 */
export function defaultControlPlaneConfig(): ControlPlaneConfig {
  return ControlPlaneConfigSchema.parse({});
}

/**
 * Deep, non-destructive merge of an override onto a base control plane config.
 *
 * Object-valued sections (tools, approval, memory, routing, budgets) are merged
 * field-by-field. Array fields (e.g. allowlist) and scalar fields are replaced
 * wholesale by the override when provided. The result is re-validated so callers
 * always receive a fully-typed, valid config.
 */
export function mergeControlPlaneConfig(
  base: ControlPlaneConfig,
  override: DeepPartial<ControlPlaneConfig>,
): ControlPlaneConfig {
  const merged = {
    tools: { ...base.tools, ...(override.tools ?? {}) },
    approval: { ...base.approval, ...(override.approval ?? {}) },
    memory: { ...base.memory, ...(override.memory ?? {}) },
    routing: { ...base.routing, ...(override.routing ?? {}) },
    budgets: { ...base.budgets, ...(override.budgets ?? {}) },
  };
  return ControlPlaneConfigSchema.parse(merged);
}

/**
 * Recursive partial used for override inputs.
 */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};
