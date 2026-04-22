import { z } from "zod";

// ─── Gateway Config ─────────────────────────────────────────────────────────

export const GatewayConfigSchema = z.object({
  port: z.number().int().positive().default(18789),
  host: z.string().default("0.0.0.0"),
  authToken: z.string().min(1).optional(),
  maxConnections: z.number().int().positive().default(100),
  heartbeatIntervalMs: z.number().int().positive().default(30_000),
  sessionTimeoutMs: z.number().int().positive().default(3_600_000),
  corsOrigin: z.string().default(""),
});

export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;

// ─── Agent Config ───────────────────────────────────────────────────────────

export const AgentConfigSchema = z.object({
  defaultModel: z.string().default("claude-sonnet-4-20250514"),
  maxTokens: z.number().int().positive().default(8192),
  temperature: z.number().min(0).max(2).default(0.7),
  systemPrompt: z.string().optional(),
  workspacePath: z.string().optional(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

// ─── Channel Config ─────────────────────────────────────────────────────────

export const ChannelConfigSchema = z.object({
  type: z.string().min(1),
  enabled: z.boolean().default(true),
  config: z.record(z.unknown()).default({}),
});

export type ChannelConfig = z.infer<typeof ChannelConfigSchema>;

// ─── Memory Config ───────────────────────────────────────────────────────────

export const MemoryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  backend: z.enum(["sqlite", "postgres", "redis", "supabase"]).default("sqlite"),
  connectionString: z.string().optional(),
  maxEntriesPerSession: z.number().int().positive().default(1000),
  defaultTtlMs: z.number().int().positive().optional(),
  embedding: z
    .object({
      enabled: z.boolean().default(false),
      model: z.string().default("text-embedding-3-small"),
      dimensions: z.number().int().positive().default(1536),
    })
    .default({}),
});

export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;

// ─── Model Config ───────────────────────────────────────────────────────────

export const ModelConfigSchema = z.object({
  provider: z.enum(["anthropic", "openai", "local"]),
  model: z.string().min(1),
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional(),
  maxTokens: z.number().int().positive().optional(),
  costPer1kInput: z.number().nonnegative().default(0),
  costPer1kOutput: z.number().nonnegative().default(0),
});

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

// ─── Root Karna Config ──────────────────────────────────────────────────────

export const KarnaConfigSchema = z.object({
  gateway: GatewayConfigSchema.default({}),
  agent: AgentConfigSchema.default({}),
  channels: z.array(ChannelConfigSchema).default([]),
  memory: MemoryConfigSchema.default({}),
  models: z.record(ModelConfigSchema).default({}),
});

export type KarnaConfig = z.infer<typeof KarnaConfigSchema>;
