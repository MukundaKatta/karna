import { z } from "zod";

// ─── Session Status ──────────────────────────────────────────────────────────

export const SessionStatusSchema = z.enum([
  "active",
  "idle",
  "suspended",
  "terminated",
]);

export type SessionStatus = z.infer<typeof SessionStatusSchema>;

// ─── Message Role ────────────────────────────────────────────────────────────

export const MessageRoleSchema = z.enum(["user", "assistant", "system", "tool"]);

export type MessageRole = z.infer<typeof MessageRoleSchema>;

// ─── Conversation Message ────────────────────────────────────────────────────

export const ConversationMessageSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  role: MessageRoleSchema,
  content: z.string(),
  timestamp: z.number().int().positive(),
  metadata: z
    .object({
      model: z.string().optional(),
      inputTokens: z.number().int().nonnegative().optional(),
      outputTokens: z.number().int().nonnegative().optional(),
      toolCallId: z.string().optional(),
      toolName: z.string().optional(),
      finishReason: z.string().optional(),
      latencyMs: z.number().int().nonnegative().optional(),
    })
    .optional(),
  parentId: z.string().nullable().optional(),
});

export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;

// ─── Session ─────────────────────────────────────────────────────────────────

export const SessionSchema = z.object({
  id: z.string().min(1),
  channelType: z.string().min(1),
  channelId: z.string().min(1),
  userId: z.string().min(1).optional(),
  status: SessionStatusSchema,
  createdAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
  expiresAt: z.number().int().positive().optional(),
  metadata: z.record(z.unknown()).optional(),
  context: z
    .object({
      systemPrompt: z.string().optional(),
      model: z.string().optional(),
      temperature: z.number().min(0).max(2).optional(),
      maxTokens: z.number().int().positive().optional(),
      tools: z.array(z.string()).optional(),
      skills: z.array(z.string()).optional(),
    })
    .optional(),
  stats: z
    .object({
      messageCount: z.number().int().nonnegative(),
      totalInputTokens: z.number().int().nonnegative(),
      totalOutputTokens: z.number().int().nonnegative(),
      totalCostUsd: z.number().nonnegative(),
    })
    .optional(),
});

export type Session = z.infer<typeof SessionSchema>;

// ─── Session Creation ────────────────────────────────────────────────────────

export const CreateSessionInputSchema = z.object({
  channelType: z.string().min(1),
  channelId: z.string().min(1),
  userId: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).optional(),
  context: z
    .object({
      systemPrompt: z.string().optional(),
      model: z.string().optional(),
      temperature: z.number().min(0).max(2).optional(),
      maxTokens: z.number().int().positive().optional(),
      tools: z.array(z.string()).optional(),
      skills: z.array(z.string()).optional(),
    })
    .optional(),
});

export type CreateSessionInput = z.infer<typeof CreateSessionInputSchema>;

// ─── Conversation Thread ─────────────────────────────────────────────────────

export const ConversationThreadSchema = z.object({
  sessionId: z.string().min(1),
  messages: z.array(ConversationMessageSchema),
  totalMessages: z.number().int().nonnegative(),
  hasMore: z.boolean(),
  cursor: z.string().optional(),
});

export type ConversationThread = z.infer<typeof ConversationThreadSchema>;
