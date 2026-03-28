import { z } from "zod";

// ─── Agent Definition ─────────────────────────────────────────────────────────

export const AgentDefinitionSchema = z.object({
  /** Unique agent identifier. */
  id: z.string().min(1),
  /** Human-readable agent name. */
  name: z.string().min(1),
  /** What this agent does — shown to the supervisor when deciding delegation. */
  description: z.string().min(1),
  /** Agent persona/personality prompt fragment. */
  persona: z.string().optional(),
  /** Default LLM model for this agent. */
  model: z.string().optional(),
  /** Default LLM provider (e.g. "anthropic", "openai"). */
  provider: z.string().optional(),
  /** Allowed tool names for this agent (empty = all tools). */
  tools: z.array(z.string()).optional(),
  /** Specialization tags for routing (e.g. ["code", "research", "writing"]). */
  specializations: z.array(z.string()).optional(),
  /** Whether this agent can act as a supervisor. */
  isSupervisor: z.boolean().optional(),
});

export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;

// ─── Handoff Protocol ─────────────────────────────────────────────────────────

export const HandoffPayloadSchema = z.object({
  /** The agent to hand off to. */
  targetAgentId: z.string().min(1),
  /** Why the handoff is happening. */
  reason: z.string().min(1),
  /** A summary of the conversation context for the target agent. */
  contextSummary: z.string().optional(),
  /** Slice of recent conversation messages to pass along. */
  conversationSlice: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system", "tool"]),
        content: z.string(),
      })
    )
    .optional(),
  /** Arbitrary metadata to pass to the target agent. */
  metadata: z.record(z.unknown()).optional(),
});

export type HandoffPayload = z.infer<typeof HandoffPayloadSchema>;

export const HandoffResultSchema = z.object({
  /** Whether the handoff completed successfully. */
  success: z.boolean(),
  /** The response from the target agent. */
  response: z.string(),
  /** The agent that handled the request. */
  agentId: z.string(),
  /** Token usage for the handoff. */
  tokenUsage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
});

export type HandoffResult = z.infer<typeof HandoffResultSchema>;

// ─── Task Assignment ──────────────────────────────────────────────────────────

export const TaskStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "failed",
]);

export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskAssignmentSchema = z.object({
  /** Unique task identifier. */
  taskId: z.string().min(1),
  /** Agent assigned to this task. */
  agentId: z.string().min(1),
  /** The task description / prompt. */
  task: z.string().min(1),
  /** Current task status. */
  status: TaskStatusSchema,
  /** The result once the task completes. */
  result: z.string().optional(),
  /** Token usage for this task. */
  tokenUsage: z
    .object({
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
    })
    .optional(),
});

export type TaskAssignment = z.infer<typeof TaskAssignmentSchema>;

// ─── Orchestration Result ─────────────────────────────────────────────────────

export const DelegationRecordSchema = z.object({
  /** Which agent delegated. */
  fromAgentId: z.string(),
  /** Which agent received the delegation. */
  toAgentId: z.string(),
  /** Why delegation happened. */
  reason: z.string(),
  /** The task that was delegated. */
  task: z.string(),
  /** The response from the delegated agent. */
  response: z.string().optional(),
  /** Timestamp of the delegation. */
  timestamp: z.number().int().positive(),
});

export type DelegationRecord = z.infer<typeof DelegationRecordSchema>;

export const OrchestrationResultSchema = z.object({
  /** The final response text. */
  response: z.string(),
  /** Which agent produced the final response. */
  agentId: z.string(),
  /** All delegations that occurred during processing. */
  delegations: z.array(DelegationRecordSchema),
  /** Total token usage across all agents. */
  totalTokens: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
  /** Whether the orchestration succeeded. */
  success: z.boolean(),
  /** Error message if failed. */
  error: z.string().optional(),
});

export type OrchestrationResult = z.infer<typeof OrchestrationResultSchema>;
