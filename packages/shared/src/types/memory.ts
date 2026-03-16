import { z } from "zod";

// ─── Memory Source ───────────────────────────────────────────────────────────

export const MemorySourceSchema = z.enum([
  "conversation",
  "tool_result",
  "user_feedback",
  "system",
  "skill",
  "external",
]);

export type MemorySource = z.infer<typeof MemorySourceSchema>;

// ─── Memory Priority ─────────────────────────────────────────────────────────

export const MemoryPrioritySchema = z.enum(["low", "normal", "high", "critical"]);

export type MemoryPriority = z.infer<typeof MemoryPrioritySchema>;

// ─── Memory Entry ────────────────────────────────────────────────────────────

export const MemoryEntrySchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),

  // Content
  content: z.string().min(1),
  summary: z.string().optional(),
  embedding: z.array(z.number()).optional(),

  // Classification
  source: MemorySourceSchema,
  priority: MemoryPrioritySchema.default("normal"),
  tags: z.array(z.string()).default([]),
  category: z.string().optional(),

  // Relationships
  relatedMessageIds: z.array(z.string()).default([]),
  relatedMemoryIds: z.array(z.string()).default([]),
  parentId: z.string().nullable().optional(),

  // Lifecycle
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
  accessedAt: z.number().int().positive(),
  expiresAt: z.number().int().positive().optional(),
  accessCount: z.number().int().nonnegative().default(0),

  // Scoring
  relevanceScore: z.number().min(0).max(1).optional(),
  decayFactor: z.number().min(0).max(1).default(1),
});

export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;

// ─── Memory Query ────────────────────────────────────────────────────────────

export const MemoryQuerySchema = z.object({
  query: z.string().min(1).optional(),
  embedding: z.array(z.number()).optional(),
  sessionId: z.string().optional(),
  userId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  category: z.string().optional(),
  source: MemorySourceSchema.optional(),
  priority: MemoryPrioritySchema.optional(),
  minRelevance: z.number().min(0).max(1).optional(),
  limit: z.number().int().positive().max(100).default(10),
  offset: z.number().int().nonnegative().default(0),
  sortBy: z.enum(["relevance", "recency", "priority", "access_count"]).default("relevance"),
});

export type MemoryQuery = z.infer<typeof MemoryQuerySchema>;

// ─── Memory Query Result ─────────────────────────────────────────────────────

export const MemoryQueryResultSchema = z.object({
  entries: z.array(
    MemoryEntrySchema.extend({
      score: z.number().min(0).max(1),
    })
  ),
  total: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  queryTimeMs: z.number().nonnegative(),
});

export type MemoryQueryResult = z.infer<typeof MemoryQueryResultSchema>;

// ─── Create Memory Input ─────────────────────────────────────────────────────

export const CreateMemoryInputSchema = z.object({
  content: z.string().min(1),
  summary: z.string().optional(),
  sessionId: z.string().optional(),
  userId: z.string().optional(),
  source: MemorySourceSchema,
  priority: MemoryPrioritySchema.default("normal"),
  tags: z.array(z.string()).default([]),
  category: z.string().optional(),
  relatedMessageIds: z.array(z.string()).default([]),
  expiresAt: z.number().int().positive().optional(),
});

export type CreateMemoryInput = z.infer<typeof CreateMemoryInputSchema>;
