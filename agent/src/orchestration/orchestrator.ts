// ─── Orchestrator ─────────────────────────────────────────────────────────────
//
// The top-level multi-agent orchestrator. Routes messages to agents, intercepts
// delegate_to_agent tool calls, and manages the full lifecycle of multi-agent
// conversations including handoffs and supervisor delegation.
//
// ──────────────────────────────────────────────────────────────────────────────

import pino from "pino";
import type {
  AgentDefinition,
  DelegationRecord,
  OrchestrationResult,
} from "@karna/shared/types/orchestration.js";
import type { Session } from "@karna/shared/types/session.js";
import type { ConversationMessage } from "@karna/shared/types/session.js";
import type { AgentPersona } from "../context/system-prompt.js";
import type { AgentConfig } from "../models/router.js";
import type { StreamCallback, AgentTurnResult } from "../runtime.js";
import type { ApprovalCallback } from "../tools/approval.js";
import { AgentPool, type AgentPoolConfig } from "./agent-pool.js";
import { executeHandoff, type HandoffOptions } from "./handoff.js";
import { Supervisor, type SupervisorConfig } from "./supervisor.js";
import { DELEGATE_TOOL_NAME } from "../tools/builtin/delegate.js";

const logger = pino({ name: "orchestrator" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface OrchestratorConfig {
  /** All agent definitions available in this orchestrator. */
  agents: AgentDefinition[];
  /** The default agent to route messages to when no agentId is specified. */
  defaultAgentId: string;
  /** Agent pool configuration. */
  poolConfig?: AgentPoolConfig;
  /** Handoff options (max depth, slice size). */
  handoffOptions?: HandoffOptions;
  /** Whether to enable supervisor mode for complex tasks. */
  enableSupervisor?: boolean;
  /** The supervisor agent ID (must be in agents array with isSupervisor: true). */
  supervisorAgentId?: string;
}

/**
 * Callback invoked when a delegation / handoff event occurs.
 * The gateway can use this to emit `agent.handoff` messages to the client.
 */
export type DelegationCallback = (record: DelegationRecord) => void;

// ─── Orchestrator ───────────────────────────────────────────────────────────

/**
 * The Orchestrator is the central coordinator for multi-agent conversations.
 *
 * Responsibilities:
 * - Manage a pool of AgentRuntime instances
 * - Route incoming messages to the appropriate agent
 * - Intercept `delegate_to_agent` tool calls and execute handoffs
 * - Optionally use a Supervisor for task decomposition
 * - Track all delegations and aggregate token usage
 */
export class Orchestrator {
  private readonly agentPool: AgentPool;
  private readonly agentDefinitions: Map<string, AgentDefinition>;
  private readonly defaultAgentId: string;
  private readonly handoffOptions: HandoffOptions;
  private readonly enableSupervisor: boolean;
  private supervisor: Supervisor | null = null;
  private delegationCallback: DelegationCallback | null = null;
  private approvalCallback: ApprovalCallback | null = null;
  private streamCallback: StreamCallback | null = null;
  private initialized = false;

  constructor(config: OrchestratorConfig) {
    this.agentPool = new AgentPool(config.poolConfig);
    this.agentDefinitions = new Map(config.agents.map((a) => [a.id, a]));
    this.defaultAgentId = config.defaultAgentId;
    this.handoffOptions = config.handoffOptions ?? {};
    this.enableSupervisor = config.enableSupervisor ?? false;

    // Validate default agent exists
    if (!this.agentDefinitions.has(this.defaultAgentId)) {
      throw new Error(
        `Default agent "${this.defaultAgentId}" not found in agent definitions`
      );
    }

    // Set up supervisor if enabled
    if (this.enableSupervisor) {
      const supervisorId = config.supervisorAgentId;
      const supervisorDef = supervisorId
        ? this.agentDefinitions.get(supervisorId)
        : Array.from(this.agentDefinitions.values()).find((a) => a.isSupervisor);

      if (supervisorDef) {
        const workers = Array.from(this.agentDefinitions.values()).filter(
          (a) => a.id !== supervisorDef.id && !a.isSupervisor
        );

        this.supervisor = new Supervisor({
          definition: supervisorDef,
          workers,
        });
      } else {
        logger.warn(
          "Supervisor mode enabled but no supervisor agent definition found"
        );
      }
    }
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Initialize the orchestrator and its supervisor (if configured).
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    if (this.supervisor) {
      await this.supervisor.init();
    }

    this.initialized = true;
    logger.info(
      {
        agentCount: this.agentDefinitions.size,
        defaultAgent: this.defaultAgentId,
        supervisorEnabled: !!this.supervisor,
      },
      "Orchestrator initialized"
    );
  }

  /**
   * Shut down the orchestrator, pool, and supervisor.
   */
  async shutdown(): Promise<void> {
    logger.info("Shutting down orchestrator");
    await this.agentPool.shutdown();
    if (this.supervisor) {
      await this.supervisor.stop();
    }
    this.initialized = false;
  }

  // ─── Callbacks ──────────────────────────────────────────────────────────

  setDelegationCallback(callback: DelegationCallback): void {
    this.delegationCallback = callback;
  }

  setApprovalCallback(callback: ApprovalCallback): void {
    this.approvalCallback = callback;
    this.agentPool.setApprovalCallback(callback);
  }

  setStreamCallback(callback: StreamCallback): void {
    this.streamCallback = callback;
    this.agentPool.setStreamCallback(callback);
  }

  // ─── Main Entry Point ─────────────────────────────────────────────────

  /**
   * Handle an incoming message by routing it to the appropriate agent.
   *
   * If the agent calls `delegate_to_agent`, the orchestrator intercepts
   * the tool call and executes a handoff to the target agent.
   */
  async handleMessage(
    session: Session,
    message: string,
    conversationHistory: ConversationMessage[],
    agentId?: string
  ): Promise<OrchestrationResult> {
    if (!this.initialized) {
      await this.init();
    }

    const targetAgentId = agentId ?? this.defaultAgentId;
    const agentDef = this.agentDefinitions.get(targetAgentId);

    if (!agentDef) {
      return {
        response: `Agent "${targetAgentId}" not found`,
        agentId: targetAgentId,
        delegations: [],
        totalTokens: { inputTokens: 0, outputTokens: 0 },
        success: false,
        error: `Agent "${targetAgentId}" not found`,
      };
    }

    const delegations: DelegationRecord[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    logger.info(
      { sessionId: session.id, agentId: targetAgentId, messageLength: message.length },
      "Handling message"
    );

    // Get or create the agent runtime
    const entry = await this.agentPool.getOrCreate(agentDef);

    // Build the agent persona with available agents info for delegation
    const agentPersonaConfig = this.buildAgentConfig(agentDef);

    // Build custom instructions that include available agents for delegation
    const delegationInstructions = this.buildDelegationInstructions(targetAgentId);

    // Execute the agent turn
    const result = await entry.runtime.run({
      message,
      session,
      agent: agentPersonaConfig,
      conversationHistory,
      customInstructions: delegationInstructions,
    });

    totalInputTokens += result.usage.inputTokens;
    totalOutputTokens += result.usage.outputTokens;

    // Check if any tool calls were delegate_to_agent
    const delegateCall = result.toolCalls.find(
      (tc) => tc.name === DELEGATE_TOOL_NAME
    );

    if (delegateCall && result.success) {
      // Intercept the delegation
      const delegateInput = delegateCall.input as {
        agentId: string;
        task: string;
        context?: string;
      };

      const record: DelegationRecord = {
        fromAgentId: targetAgentId,
        toAgentId: delegateInput.agentId,
        reason: delegateInput.task,
        task: delegateInput.task,
        timestamp: Date.now(),
      };

      // Notify the gateway/client about the handoff
      this.delegationCallback?.(record);

      logger.info(
        {
          fromAgent: targetAgentId,
          toAgent: delegateInput.agentId,
          task: delegateInput.task.slice(0, 100),
        },
        "Delegation intercepted"
      );

      // Execute the handoff
      try {
        const handoffResult = await executeHandoff(
          this.agentPool,
          {
            targetAgentId: delegateInput.agentId,
            reason: delegateInput.task,
            contextSummary: delegateInput.context ?? result.response,
            conversationSlice: conversationHistory
              .slice(-5)
              .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
          },
          session,
          this.agentDefinitions,
          1, // depth starts at 1 since we're already one level in
          new Set([targetAgentId]),
          this.handoffOptions
        );

        record.response = handoffResult.response;
        delegations.push(record);

        totalInputTokens += handoffResult.tokenUsage.inputTokens;
        totalOutputTokens += handoffResult.tokenUsage.outputTokens;

        return {
          response: handoffResult.response,
          agentId: handoffResult.agentId,
          delegations,
          totalTokens: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
          success: handoffResult.success,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        record.response = `Delegation failed: ${errorMessage}`;
        delegations.push(record);

        logger.error(
          { error: errorMessage, toAgent: delegateInput.agentId },
          "Delegation handoff failed"
        );

        // Fall back to the original agent's response
        return {
          response: result.response || `Delegation to ${delegateInput.agentId} failed: ${errorMessage}`,
          agentId: targetAgentId,
          delegations,
          totalTokens: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
          success: false,
          error: errorMessage,
        };
      }
    }

    // No delegation — return the direct agent response
    return {
      response: result.response,
      agentId: targetAgentId,
      delegations,
      totalTokens: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
      success: result.success,
      error: result.error,
    };
  }

  // ─── Supervisor Mode ──────────────────────────────────────────────────

  /**
   * Handle a complex task using the supervisor for decomposition and aggregation.
   * This is an alternative to handleMessage() for explicitly multi-agent workflows.
   */
  async handleWithSupervisor(
    session: Session,
    task: string
  ): Promise<OrchestrationResult> {
    if (!this.supervisor) {
      return {
        response: "Supervisor mode is not enabled",
        agentId: this.defaultAgentId,
        delegations: [],
        totalTokens: { inputTokens: 0, outputTokens: 0 },
        success: false,
        error: "Supervisor not configured",
      };
    }

    if (!this.initialized) {
      await this.init();
    }

    const delegations: DelegationRecord[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    logger.info(
      { sessionId: session.id, taskLength: task.length },
      "Supervisor handling task"
    );

    // 1. Decompose the task
    const decomposition = await this.supervisor.decompose(task, session);

    logger.info(
      { subTaskCount: decomposition.subTasks.length, strategy: decomposition.strategy },
      "Task decomposed"
    );

    // 2. Assign each sub-task to a worker (in parallel)
    const assignmentPromises = decomposition.subTasks.map((subTask) => {
      const record: DelegationRecord = {
        fromAgentId: this.supervisor!.constructor.name,
        toAgentId: subTask.agentId,
        reason: `Supervisor decomposition: ${subTask.task.slice(0, 100)}`,
        task: subTask.task,
        timestamp: Date.now(),
      };
      this.delegationCallback?.(record);
      delegations.push(record);

      return this.supervisor!.assign(subTask, this.agentPool, session, this.agentDefinitions);
    });

    const assignments = await Promise.all(assignmentPromises);

    // Tally token usage from assignments
    for (const assignment of assignments) {
      if (assignment.tokenUsage) {
        totalInputTokens += assignment.tokenUsage.inputTokens;
        totalOutputTokens += assignment.tokenUsage.outputTokens;
      }
    }

    // Update delegation records with responses
    for (let i = 0; i < assignments.length && i < delegations.length; i++) {
      delegations[i].response = assignments[i].result;
    }

    // 3. Aggregate results
    const aggregatedResponse = await this.supervisor.aggregate(task, assignments, session);

    return {
      response: aggregatedResponse,
      agentId: this.defaultAgentId,
      delegations,
      totalTokens: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
      success: true,
    };
  }

  // ─── Accessors ────────────────────────────────────────────────────────

  /**
   * Get a list of all registered agent definitions.
   */
  getAgentDefinitions(): AgentDefinition[] {
    return Array.from(this.agentDefinitions.values());
  }

  /**
   * Get a specific agent definition by ID.
   */
  getAgentDefinition(agentId: string): AgentDefinition | undefined {
    return this.agentDefinitions.get(agentId);
  }

  /**
   * Get the current pool size.
   */
  get activeAgentCount(): number {
    return this.agentPool.size;
  }

  // ─── Private ──────────────────────────────────────────────────────────

  private buildAgentConfig(def: AgentDefinition): AgentPersona & AgentConfig {
    return {
      id: def.id,
      name: def.name,
      description: def.description,
      personality: def.persona,
      defaultModel: def.model ?? "claude-sonnet-4-20250514",
      defaultProvider: def.provider ?? "anthropic",
    };
  }

  /**
   * Build instructions that tell the agent about other available agents
   * it can delegate to via the delegate_to_agent tool.
   */
  private buildDelegationInstructions(currentAgentId: string): string {
    const otherAgents = Array.from(this.agentDefinitions.values()).filter(
      (a) => a.id !== currentAgentId && !a.isSupervisor
    );

    if (otherAgents.length === 0) {
      return "";
    }

    const agentList = otherAgents
      .map(
        (a) =>
          `- ${a.id}: ${a.name} — ${a.description}` +
          (a.specializations?.length ? ` [${a.specializations.join(", ")}]` : "")
      )
      .join("\n");

    return (
      `You have access to the "delegate_to_agent" tool. Use it to delegate tasks ` +
      `that require specialized expertise to another agent.\n\n` +
      `Available agents for delegation:\n${agentList}\n\n` +
      `Only delegate when the task clearly falls outside your expertise. ` +
      `For straightforward tasks, handle them yourself.`
    );
  }
}
