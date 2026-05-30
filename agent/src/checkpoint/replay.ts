// ─── Deterministic Session Replay (#525) ──────────────────────────────────────
//
// Reconstructs an agent run from a recorded JSONL transcript. The replay engine
// is pure and deterministic: instead of calling a live model or executing real
// tools, it replays model output and tool results from an injected record. This
// makes recorded sessions reproducible for debugging, regression tests, and
// audit.
//
// The record format is a superset of the gateway transcript: each line is a
// JSON object. We recognize three kinds of events derived from the transcript
// roles plus an optional explicit-event form, so existing JSONL transcripts
// (see gateway/src/session/store.ts) can be replayed directly.
//
// ───────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import pino from "pino";
import { ConversationMessageSchema, type ConversationMessage } from "@karna/shared/types/session.js";

const logger = pino({ name: "agent-replay" });

// ─── Recorded Event Schema ────────────────────────────────────────────────

/**
 * An explicit replay event. Recordings may use this richer form to capture
 * model output (text + tool calls) and tool results with full fidelity.
 */
export const ReplayToolUseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  input: z.record(z.unknown()),
});

export const ReplayModelEventSchema = z.object({
  kind: z.literal("model"),
  /** Assistant text produced for this step. */
  text: z.string(),
  /** Tool calls the model requested for this step. */
  toolUses: z.array(ReplayToolUseSchema).default([]),
  usage: z
    .object({
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
    })
    .default({ inputTokens: 0, outputTokens: 0 }),
});

export const ReplayToolResultEventSchema = z.object({
  kind: z.literal("tool_result"),
  id: z.string().min(1),
  name: z.string().min(1),
  output: z.unknown(),
  isError: z.boolean().default(false),
  errorMessage: z.string().optional(),
});

export const ReplayUserEventSchema = z.object({
  kind: z.literal("user"),
  content: z.string(),
});

export const ReplayEventSchema = z.discriminatedUnion("kind", [
  ReplayModelEventSchema,
  ReplayToolResultEventSchema,
  ReplayUserEventSchema,
]);

export type ReplayToolUse = z.infer<typeof ReplayToolUseSchema>;
export type ReplayModelEvent = z.infer<typeof ReplayModelEventSchema>;
export type ReplayToolResultEvent = z.infer<typeof ReplayToolResultEventSchema>;
export type ReplayUserEvent = z.infer<typeof ReplayUserEventSchema>;
export type ReplayEvent = z.infer<typeof ReplayEventSchema>;

// ─── Record Parsing ─────────────────────────────────────────────────────────

/**
 * Parse a JSONL record (the contents of a `.jsonl` file) into an ordered list
 * of replay events. Lines may be either explicit {@link ReplayEvent}s (objects
 * with a `kind` discriminator) or plain {@link ConversationMessage}s, which are
 * converted into the appropriate event. Malformed lines are skipped with a
 * warning, mirroring the gateway transcript reader.
 */
export function parseReplayRecord(jsonl: string): ReplayEvent[] {
  const lines = jsonl.split("\n").map((line) => line.trim()).filter(Boolean);
  const events: ReplayEvent[] = [];

  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      logger.warn({ error: String(error), line: line.slice(0, 80) }, "Skipping malformed record line");
      continue;
    }

    // Prefer the explicit event form when a `kind` discriminator is present.
    if (isRecord(parsed) && typeof parsed["kind"] === "string") {
      const result = ReplayEventSchema.safeParse(parsed);
      if (result.success) {
        events.push(result.data);
      } else {
        logger.warn({ line: line.slice(0, 80) }, "Skipping invalid replay event");
      }
      continue;
    }

    // Otherwise treat the line as a ConversationMessage transcript entry.
    const message = ConversationMessageSchema.safeParse(parsed);
    if (!message.success) {
      logger.warn({ line: line.slice(0, 80) }, "Skipping unrecognized record line");
      continue;
    }
    const event = conversationMessageToEvent(message.data);
    if (event) events.push(event);
  }

  return events;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Convert a recorded ConversationMessage into a replay event.
 * - `user` → user event
 * - `assistant` → model event (text only; tool calls are not encoded in the
 *   plain transcript, so callers needing tool-call fidelity should record
 *   explicit events).
 * - `tool` → tool_result event (output is the JSON-decoded content when possible).
 * - `system` → ignored (context, not a replay step).
 */
export function conversationMessageToEvent(message: ConversationMessage): ReplayEvent | null {
  switch (message.role) {
    case "user":
      return { kind: "user", content: message.content };
    case "assistant":
      return {
        kind: "model",
        text: message.content,
        toolUses: [],
        usage: {
          inputTokens: message.metadata?.inputTokens ?? 0,
          outputTokens: message.metadata?.outputTokens ?? 0,
        },
      };
    case "tool": {
      let output: unknown = message.content;
      try {
        output = JSON.parse(message.content);
      } catch {
        // Keep the raw string when content is not JSON.
      }
      return {
        kind: "tool_result",
        id: message.metadata?.toolCallId ?? "unknown",
        name: message.metadata?.toolName ?? "unknown",
        output,
        isError: false,
      };
    }
    case "system":
    default:
      return null;
  }
}

// ─── Deterministic I/O Stubs ──────────────────────────────────────────────

/** A model step served from the record (no live model call). */
export interface DeterministicModelStep {
  text: string;
  toolUses: ReplayToolUse[];
  usage: { inputTokens: number; outputTokens: number };
}

/** A tool result served from the record (no live tool execution). */
export interface DeterministicToolResult {
  id: string;
  name: string;
  output: unknown;
  isError: boolean;
  errorMessage?: string;
}

/**
 * Stubbed, injectable model + tool I/O sourced from a recorded event list.
 * Replays model steps in recorded order and resolves tool results by call id
 * (falling back to recorded order when ids are absent).
 */
export class RecordedIO {
  private readonly modelSteps: DeterministicModelStep[];
  private readonly toolResultsById = new Map<string, DeterministicToolResult>();
  private readonly toolResultQueue: DeterministicToolResult[];
  private modelCursor = 0;

  constructor(events: ReplayEvent[]) {
    this.modelSteps = [];
    this.toolResultQueue = [];

    for (const event of events) {
      if (event.kind === "model") {
        this.modelSteps.push({
          text: event.text,
          toolUses: event.toolUses,
          usage: event.usage,
        });
      } else if (event.kind === "tool_result") {
        const result: DeterministicToolResult = {
          id: event.id,
          name: event.name,
          output: event.output,
          isError: event.isError,
          errorMessage: event.errorMessage,
        };
        this.toolResultsById.set(event.id, result);
        this.toolResultQueue.push(result);
      }
      // user events are inputs, not stubbed outputs.
    }
  }

  /** Number of recorded model steps. */
  get modelStepCount(): number {
    return this.modelSteps.length;
  }

  /** True when every recorded model step has been consumed. */
  get exhausted(): boolean {
    return this.modelCursor >= this.modelSteps.length;
  }

  /**
   * Return the next recorded model step, or null when the record is exhausted.
   * Deterministic: successive calls walk the recording in order.
   */
  nextModelStep(): DeterministicModelStep | null {
    if (this.modelCursor >= this.modelSteps.length) return null;
    return this.modelSteps[this.modelCursor++]!;
  }

  /**
   * Resolve a tool result for a given call id. Falls back to dequeuing the next
   * recorded result when the id is not found (supports plain transcripts that
   * lack explicit ids).
   */
  resolveTool(id: string): DeterministicToolResult | null {
    const byId = this.toolResultsById.get(id);
    if (byId) return byId;
    return this.toolResultQueue.shift() ?? null;
  }
}

// ─── Replay Engine ──────────────────────────────────────────────────────────

export interface ReplayedToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output: unknown;
  isError: boolean;
  errorMessage?: string;
}

export interface ReplayResult {
  /** The user message that initiated the run (first recorded user event). */
  userMessage: string | null;
  /** Reconstructed assistant message array, in order. */
  messages: Array<{
    role: "user" | "assistant" | "tool";
    content: string;
    toolCallId?: string;
    toolName?: string;
  }>;
  /** Every tool call replayed during the run. */
  toolCalls: ReplayedToolCall[];
  /** The final assistant text response (last model step with no tool calls). */
  response: string;
  /** Number of model steps (loop iterations) replayed. */
  iterations: number;
  /** Aggregated token usage across replayed model steps. */
  usage: { inputTokens: number; outputTokens: number };
  /** True if the run reached a final response within the iteration budget. */
  completed: boolean;
}

export interface ReplayOptions {
  /** Maximum model steps to replay (mirrors AgentRuntime maxToolIterations). */
  maxIterations?: number;
}

const DEFAULT_MAX_ITERATIONS = 10;

/**
 * Deterministically replay a recorded run.
 *
 * Mirrors the AgentRuntime loop shape: a user message kicks off a sequence of
 * model steps; when a step requests tools, their results are served from the
 * record and fed back; the loop ends at the first model step with no tool
 * calls (the final response) or when the iteration budget is hit.
 *
 * This function performs no I/O and is fully deterministic given `events`.
 */
export function replayRun(events: ReplayEvent[], options: ReplayOptions = {}): ReplayResult {
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const io = new RecordedIO(events);

  const userEvent = events.find((event): event is ReplayUserEvent => event.kind === "user");
  const userMessage = userEvent?.content ?? null;

  const messages: ReplayResult["messages"] = [];
  if (userMessage !== null) {
    messages.push({ role: "user", content: userMessage });
  }

  const toolCalls: ReplayedToolCall[] = [];
  let response = "";
  let iterations = 0;
  let completed = false;
  let inputTokens = 0;
  let outputTokens = 0;

  while (iterations < maxIterations) {
    const step = io.nextModelStep();
    if (!step) break;
    iterations++;

    inputTokens += step.usage.inputTokens;
    outputTokens += step.usage.outputTokens;

    if (step.text) {
      messages.push({ role: "assistant", content: step.text });
    }

    if (step.toolUses.length === 0) {
      response = step.text;
      completed = true;
      break;
    }

    // Replay tool results deterministically from the record.
    for (const toolUse of step.toolUses) {
      const resolved = io.resolveTool(toolUse.id);
      const output = resolved ? resolved.output : null;
      const isError = resolved ? resolved.isError : true;
      const errorMessage = resolved
        ? resolved.errorMessage
        : "No recorded result for tool call";

      toolCalls.push({
        id: toolUse.id,
        name: toolUse.name,
        input: toolUse.input,
        output,
        isError,
        errorMessage,
      });

      messages.push({
        role: "tool",
        content: JSON.stringify(isError ? { error: errorMessage } : output),
        toolCallId: toolUse.id,
        toolName: toolUse.name,
      });
    }

    // If there are no further model steps but tools were called, the last text
    // is the best available response.
    if (io.exhausted) {
      response = step.text;
      break;
    }
  }

  logger.debug(
    { iterations, toolCalls: toolCalls.length, completed },
    "Replay run complete",
  );

  return {
    userMessage,
    messages,
    toolCalls,
    response,
    iterations,
    usage: { inputTokens, outputTokens },
    completed,
  };
}

/**
 * Convenience: parse a JSONL record and replay it in one call.
 */
export function replayFromJsonl(jsonl: string, options: ReplayOptions = {}): ReplayResult {
  return replayRun(parseReplayRecord(jsonl), options);
}
