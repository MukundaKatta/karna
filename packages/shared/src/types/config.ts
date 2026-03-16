import { z } from "zod";

// ─── Gateway Config ──────────────────────────────────────────────────────────

export const GatewayConfigSchema = z.object({
  port: z.number().int().positive().default(3000),
  host: z.string().default("0.0.0.0"),
  cors: z
    .object({
      origins: z.array(z.string()).default(["*"]),
      credentials: z.boolean().default(true),
    })
    .default({}),
  websocket: z
    .object({
      path: z.string().default("/ws"),
      heartbeatIntervalMs: z.number().int().positive().default(30_000),
      heartbeatTimeoutMs: z.number().int().positive().default(10_000),
      maxPayloadBytes: z.number().int().positive().default(1_048_576), // 1MB
      maxConnectionsPerIp: z.number().int().positive().default(10),
    })
    .default({}),
  rateLimit: z
    .object({
      windowMs: z.number().int().positive().default(60_000),
      maxRequests: z.number().int().positive().default(60),
    })
    .default({}),
  auth: z
    .object({
      tokenSecret: z.string().min(32),
      tokenExpiryMs: z.number().int().positive().default(86_400_000), // 24h
      challengeExpiryMs: z.number().int().positive().default(30_000),
    })
    .optional(),
});

export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;

// ─── Agent Config ────────────────────────────────────────────────────────────

export const AgentConfigSchema = z.object({
  defaultModel: z.string().default("claude-sonnet-4-20250514"),
  fallbackModel: z.string().optional(),
  maxTokens: z.number().int().positive().default(4096),
  temperature: z.number().min(0).max(2).default(0.7),
  systemPrompt: z.string().optional(),
  maxTurns: z.number().int().positive().default(20),
  toolApproval: z
    .object({
      autoApproveBelow: z.enum(["low", "medium", "high", "critical"]).default("low"),
      timeoutMs: z.number().int().positive().default(120_000),
    })
    .default({}),
  providers: z
    .object({
      anthropic: z
        .object({
          apiKey: z.string().min(1),
          baseUrl: z.string().url().optional(),
          maxRetries: z.number().int().nonnegative().default(3),
        })
        .optional(),
      openai: z
        .object({
          apiKey: z.string().min(1),
          baseUrl: z.string().url().optional(),
          organization: z.string().optional(),
          maxRetries: z.number().int().nonnegative().default(3),
        })
        .optional(),
    })
    .optional(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

// ─── Channel Config ──────────────────────────────────────────────────────────

export const ChannelConfigSchema = z.object({
  type: z.string().min(1),
  enabled: z.boolean().default(true),
  settings: z.record(z.unknown()).default({}),
  rateLimit: z
    .object({
      windowMs: z.number().int().positive().optional(),
      maxRequests: z.number().int().positive().optional(),
    })
    .optional(),
});

export type ChannelConfig = z.infer<typeof ChannelConfigSchema>;

// ─── Memory Config ───────────────────────────────────────────────────────────

export const MemoryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  backend: z.enum(["sqlite", "postgres", "redis"]).default("sqlite"),
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

// ─── Logging Config ──────────────────────────────────────────────────────────

export const LoggingConfigSchema = z.object({
  level: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  pretty: z.boolean().default(false),
  file: z.string().optional(),
  redact: z.array(z.string()).default(["*.apiKey", "*.token", "*.secret", "*.password"]),
});

export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;

// ─── Karna Config (Root) ────────────────────────────────────────────────────

export const KarnaConfigSchema = z.object({
  name: z.string().default("karna"),
  env: z.enum(["development", "staging", "production"]).default("development"),
  gateway: GatewayConfigSchema,
  agent: AgentConfigSchema,
  channels: z.array(ChannelConfigSchema).default([]),
  memory: MemoryConfigSchema.default({}),
  logging: LoggingConfigSchema.default({}),
  skills: z
    .object({
      directory: z.string().default("./skills"),
      autoLoad: z.boolean().default(true),
      enabled: z.array(z.string()).optional(),
      disabled: z.array(z.string()).optional(),
    })
    .default({}),
});

export type KarnaConfig = z.infer<typeof KarnaConfigSchema>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse and validate a raw config object against the KarnaConfig schema.
 */
export function parseKarnaConfig(data: unknown): KarnaConfig {
  return KarnaConfigSchema.parse(data);
}

/**
 * Safely parse a config, returning a result object.
 */
export function safeParseKarnaConfig(
  data: unknown
): z.SafeParseReturnType<unknown, KarnaConfig> {
  return KarnaConfigSchema.safeParse(data);
}
