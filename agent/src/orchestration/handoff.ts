// ─── Handoff Protocol ─────────────────────────────────────────────────────────
//
// Context handoff between agents. Supports loop detection and depth limiting
// to prevent runaway delegation chains.
//
// ──────────────────────────────────────────────────────────────────────────────

import pino from "pino";
import type { HandoffPayload, HandoffResult, AgentDefinition } from "@karna/shared/types/orchestration.js";
import type { AgentPool } from "./agent-pool.js";
import type { Session } from "@karna/shared/types/session.js";
import type { AgentPersona } from "../context/system-prompt.js";
import type { AgentConfig } from "../models/router.js";

const logger = pino({ name: "handoff" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface HandoffOptions {
  /** Maximum delegation depth. Default: 5. */
  maxDepth?: number;
  /** Maximum number of recent messages to include in the conversation slice. */
  conversationSliceSize?: number;
}

export class HandoffLoopError extends Error {
  constructor(
    public readonly agentId: string,
    public readonly visitedPath: string[]
  ) {
    super(
      `Handoff loop detected: agent "${agentId}" was already visited. ` +
        `Path: ${visitedPath.join(" -> ")} -> ${agentId}`
    );
    this.name = "HandoffLoopError";
  }
}

export class HandoffDepthError extends Error {
  constructor(
    public readonly currentDepth: number,
    public readonly maxDepth: number
  ) {
    super(
      `Maximum handoff depth of ${maxDepth} exceeded (current depth: ${currentDepth})`
    );
    this.name = "HandoffDepthError";
  }
}

const DEFAULT_MAX_DEPTH = 5;
const DEFAULT_CONVERSATION_SLICE_SIZE = 10;

// ─── Execute Handoff ────────────────────────────────────────────────────────

/**
 * Execute a handoff from one agent to another.
 *
 * The target agent receives:
 * - A context summary of why the handoff happened
 * - A slice of the recent conversation
 * - The original user message
 *
 * Loop detection tracks all visited agent IDs to prevent cycles.
 * Depth limiting prevents excessively deep delegation chains.
 */
export async function executeHandoff(
  pool: AgentPool,
  payload: HandoffPayload,
  session: Session,
  agentDefinitions: Map<string, AgentDefinition>,
  depth: number = 0,
  visited: Set<string> = new Set(),
  options?: HandoffOptions
): Promise<HandoffResult> {
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const sliceSize = options?.conversationSliceSize ?? DEFAULT_CONVERSATION_SLICE_SIZE;

  // ─── Guard: depth ─────────────────────────────────────────────────────
  if (depth >= maxDepth) {
    logger.warn(
      { targetAgentId: payload.targetAgentId, depth, maxDepth },
      "Handoff depth exceeded"
    );
    throw new HandoffDepthError(depth, maxDepth);
  }

  // ─── Guard: loop detection ────────────────────────────────────────────
  if (visited.has(payload.targetAgentId)) {
    const visitedPath = Array.from(visited);
    logger.warn(
      { targetAgentId: payload.targetAgentId, visitedPath },
      "Handoff loop detected"
    );
    throw new HandoffLoopError(payload.targetAgentId, visitedPath);
  }

  visited.add(payload.targetAgentId);

  // ─── Resolve target agent ─────────────────────────────────────────────
  const targetDef = agentDefinitions.get(payload.targetAgentId);
  if (!targetDef) {
    logger.error({ targetAgentId: payload.targetAgentId }, "Target agent not found");
    return {
      success: false,
      response: `Agent "${payload.targetAgentId}" not found. Available agents: ${Array.from(agentDefinitions.keys()).join(", ")}`,
      agentId: payload.targetAgentId,
      tokenUsage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  // ─── Get or create runtime ────────────────────────────────────────────
  const entry = await pool.getOrCreate(targetDef);

  // ─── Build the handoff message ────────────────────────────────────────
  const handoffParts: string[] = [];

  if (payload.contextSummary) {
    handoffParts.push(`[Handoff Context] ${payload.contextSummary}`);
  }
  handoffParts.push(`[Handoff Reason] ${payload.reason}`);

  // Include conversation slice for context
  if (payload.conversationSlice && payload.conversationSlice.length > 0) {
    const slice = payload.conversationSlice.slice(-sliceSize);
    const sliceText = slice
      .map((msg) => `${msg.role}: ${msg.content}`)
      .join("\n");
    handoffParts.push(`[Recent Conversation]\n${sliceText}`);
  }

  const handoffMessage = handoffParts.join("\n\n");

  // ─── Build agent persona + config ─────────────────────────────────────
  const agentPersonaConfig: AgentPersona & AgentConfig = {
    id: targetDef.id,
    name: targetDef.name,
    description: targetDef.description,
    personality: targetDef.persona,
    defaultModel: targetDef.model ?? "claude-sonnet-4-20250514",
    defaultProvider: targetDef.provider ?? "anthropic",
  };

  logger.info(
    {
      targetAgentId: payload.targetAgentId,
      reason: payload.reason,
      depth,
      visitedCount: visited.size,
    },
    "Executing handoff"
  );

  // ─── Execute the agent turn ───────────────────────────────────────────
  try {
    const result = await entry.runtime.run({
      message: handoffMessage,
      session,
      agent: agentPersonaConfig,
      conversationHistory: [],
      customInstructions: targetDef.persona
        ? `You are ${targetDef.name}. ${targetDef.description}. ${targetDef.persona}`
        : `You are ${targetDef.name}. ${targetDef.description}.`,
    });

    logger.info(
      {
        targetAgentId: payload.targetAgentId,
        success: result.success,
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      },
      "Handoff completed"
    );

    return {
      success: result.success,
      response: result.success
        ? result.response
        : result.error ?? "Agent failed to produce a response",
      agentId: payload.targetAgentId,
      tokenUsage: result.usage,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      { targetAgentId: payload.targetAgentId, error: errorMessage },
      "Handoff execution failed"
    );

    return {
      success: false,
      response: `Handoff to "${payload.targetAgentId}" failed: ${errorMessage}`,
      agentId: payload.targetAgentId,
      tokenUsage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}
