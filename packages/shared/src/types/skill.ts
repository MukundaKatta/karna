import { z } from "zod";
import { ToolRiskLevelSchema } from "./tool.js";

// ─── Skill Trigger ───────────────────────────────────────────────────────────

export const SkillTriggerSchema = z.object({
  type: z.enum(["command", "pattern", "event", "schedule"]),
  value: z.string().min(1),
  description: z.string().optional(),
});

export type SkillTrigger = z.infer<typeof SkillTriggerSchema>;

// ─── Skill Action ────────────────────────────────────────────────────────────

export const SkillActionSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  parameters: z.record(z.unknown()).optional(),
  riskLevel: ToolRiskLevelSchema.default("low"),
});

export type SkillAction = z.infer<typeof SkillActionSchema>;

// ─── Skill Metadata ──────────────────────────────────────────────────────────

export const SkillMetadataSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z_][a-zA-Z0-9_.-]*$/, "Skill ID must be a valid identifier"),
  name: z.string().min(1).max(128),
  description: z.string().min(1).max(2048),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "Version must be semver format"),
  author: z.string().optional(),
  tags: z.array(z.string()).default([]),
  category: z.string().optional(),
  icon: z.string().optional(),

  // Capabilities
  triggers: z.array(SkillTriggerSchema).min(1),
  actions: z.array(SkillActionSchema).min(1),
  requiredTools: z.array(z.string()).default([]),

  // Runtime
  enabled: z.boolean().default(true),
  singleton: z.boolean().default(false),
  maxConcurrency: z.number().int().positive().default(5),

  // Dependencies
  dependencies: z.array(z.string()).default([]),
  permissions: z.array(z.string()).default([]),
});

export type SkillMetadata = z.infer<typeof SkillMetadataSchema>;

// ─── Skill Instance ──────────────────────────────────────────────────────────

export const SkillInstanceSchema = z.object({
  skillId: z.string().min(1),
  instanceId: z.string().min(1),
  sessionId: z.string().min(1),
  status: z.enum(["initializing", "ready", "running", "paused", "stopped", "error"]),
  startedAt: z.number().int().positive(),
  lastActivityAt: z.number().int().positive(),
  state: z.record(z.unknown()).optional(),
  error: z.string().optional(),
});

export type SkillInstance = z.infer<typeof SkillInstanceSchema>;

// ─── Skill Registry Entry ────────────────────────────────────────────────────

export const SkillRegistryEntrySchema = z.object({
  metadata: SkillMetadataSchema,
  registeredAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
  loadPath: z.string().min(1),
  configSchema: z.record(z.unknown()).optional(),
});

export type SkillRegistryEntry = z.infer<typeof SkillRegistryEntrySchema>;
