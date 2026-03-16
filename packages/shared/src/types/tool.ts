import { z } from "zod";

// ─── Risk Level ──────────────────────────────────────────────────────────────

export const ToolRiskLevelSchema = z.enum(["low", "medium", "high", "critical"]);

export type ToolRiskLevel = z.infer<typeof ToolRiskLevelSchema>;

// ─── JSON Schema Subset ─────────────────────────────────────────────────────

export const JsonSchemaPropertySchema: z.ZodType<JsonSchemaProperty> = z.lazy(() =>
  z.object({
    type: z.enum(["string", "number", "integer", "boolean", "array", "object"]).optional(),
    description: z.string().optional(),
    enum: z.array(z.unknown()).optional(),
    default: z.unknown().optional(),
    items: JsonSchemaPropertySchema.optional(),
    properties: z.record(JsonSchemaPropertySchema).optional(),
    required: z.array(z.string()).optional(),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().nonnegative().optional(),
    pattern: z.string().optional(),
  })
);

export interface JsonSchemaProperty {
  type?: "string" | "number" | "integer" | "boolean" | "array" | "object";
  description?: string;
  enum?: unknown[];
  default?: unknown;
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}

// ─── Tool Parameters Schema ─────────────────────────────────────────────────

export const ToolParametersSchema = z.object({
  type: z.literal("object"),
  properties: z.record(JsonSchemaPropertySchema),
  required: z.array(z.string()).optional(),
  additionalProperties: z.boolean().optional(),
});

export type ToolParameters = z.infer<typeof ToolParametersSchema>;

// ─── Tool Definition ─────────────────────────────────────────────────────────

export const ToolDefinitionSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z_][a-zA-Z0-9_.-]*$/, "Tool name must be a valid identifier"),
  description: z.string().min(1).max(2048),
  parameters: ToolParametersSchema,
  riskLevel: ToolRiskLevelSchema,
  requiresApproval: z.boolean().default(false),
  timeout: z.number().int().positive().default(30_000),
  metadata: z
    .object({
      version: z.string().optional(),
      author: z.string().optional(),
      tags: z.array(z.string()).optional(),
      category: z.string().optional(),
    })
    .optional(),
});

export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

// ─── Tool Call ───────────────────────────────────────────────────────────────

export const ToolCallSchema = z.object({
  id: z.string().min(1),
  toolName: z.string().min(1),
  arguments: z.record(z.unknown()),
  status: z.enum(["pending", "approved", "rejected", "running", "completed", "failed"]),
  result: z.unknown().optional(),
  error: z.string().optional(),
  startedAt: z.number().int().positive().optional(),
  completedAt: z.number().int().positive().optional(),
  durationMs: z.number().int().nonnegative().optional(),
});

export type ToolCall = z.infer<typeof ToolCallSchema>;

// ─── Tool Registry Entry ─────────────────────────────────────────────────────

export const ToolRegistryEntrySchema = z.object({
  definition: ToolDefinitionSchema,
  enabled: z.boolean().default(true),
  registeredAt: z.number().int().positive(),
  lastUsedAt: z.number().int().positive().optional(),
  usageCount: z.number().int().nonnegative().default(0),
});

export type ToolRegistryEntry = z.infer<typeof ToolRegistryEntrySchema>;
