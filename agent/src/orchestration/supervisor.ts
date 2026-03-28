// ─── Supervisor Agent ─────────────────────────────────────────────────────────
//
// A supervisor agent that coordinates worker agents. It decomposes complex
// tasks into sub-tasks, assigns them to specialized workers, and aggregates
// the results into a coherent final response.
//
// ──────────────────────────────────────────────────────────────────────────────

import { randomUUID } from "node:crypto";
import pino from "pino";
import type {
  AgentDefinition,
  TaskAssignment,
  DelegationRecord,
  HandoffResult,
} from "@karna/shared/types/orchestration.js";
import type { Session } from "@karna/shared/types/session.js";
import type { AgentPersona } from "../context/system-prompt.js";
import type { AgentConfig } from "../models/router.js";
import { AgentRuntime } from "../runtime.js";
import { ToolRegistry } from "../tools/registry.js";
import { registerBuiltinTools } from "../tools/builtin/index.js";
import type { AgentPool } from "./agent-pool.js";
import { executeHandoff } from "./handoff.js";

const logger = pino({ name: "supervisor" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SubTask {
  /** A unique ID for tracking. */
  id: string;
  /** Which agent should handle this. */
  agentId: string;
  /** The task description to send to the worker. */
  task: string;
  /** Optional context from the original request. */
  context?: string;
}

export interface SupervisorConfig {
  /** The agent definition for the supervisor itself. */
  definition: AgentDefinition;
  /** All available worker agent definitions. */
  workers: AgentDefinition[];
  /** Maximum number of sub-tasks per decomposition. Default: 5. */
  maxSubTasks?: number;
}

interface DecompositionResult {
  subTasks: SubTask[];
  strategy: string;
}

const DEFAULT_MAX_SUB_TASKS = 5;

// ─── Supervisor ─────────────────────────────────────────────────────────────

/**
 * The Supervisor coordinates worker agents to handle complex tasks.
 *
 * Workflow:
 * 1. decompose() — Use the supervisor's LLM to break the task into sub-tasks
 * 2. assign() — Delegate each sub-task to the appropriate worker
 * 3. aggregate() — Combine all worker results into a final response
 */
export class Supervisor {
  private readonly config: SupervisorConfig;
  private readonly supervisorRuntime: AgentRuntime;
  private readonly workerMap: Map<string, AgentDefinition>;
  private readonly maxSubTasks: number;

  constructor(config: SupervisorConfig) {
    this.config = config;
    this.maxSubTasks = config.maxSubTasks ?? DEFAULT_MAX_SUB_TASKS;
    this.workerMap = new Map(config.workers.map((w) => [w.id, w]));

    // Create a dedicated runtime for the supervisor's own LLM calls
    const toolRegistry = new ToolRegistry();
    registerBuiltinTools(toolRegistry);

    this.supervisorRuntime = new AgentRuntime(toolRegistry, undefined, undefined, {
      maxToolIterations: 3,
      autoMemory: false,
    });
  }

  /**
   * Initialize the supervisor runtime.
   */
  async init(): Promise<void> {
    await this.supervisorRuntime.init();
    logger.info(
      { supervisorId: this.config.definition.id, workerCount: this.workerMap.size },
      "Supervisor initialized"
    );
  }

  /**
   * Stop the supervisor runtime.
   */
  async stop(): Promise<void> {
    await this.supervisorRuntime.stop();
  }

  // ─── Decompose ──────────────────────────────────────────────────────────

  /**
   * Use the supervisor's LLM to break a complex task into sub-tasks,
   * each assigned to an appropriate worker agent.
   */
  async decompose(task: string, session: Session): Promise<DecompositionResult> {
    const workerDescriptions = this.config.workers
      .map(
        (w) =>
          `- ${w.id}: ${w.name} — ${w.description}` +
          (w.specializations?.length ? ` [specializations: ${w.specializations.join(", ")}]` : "")
      )
      .join("\n");

    const decompositionPrompt =
      `You are a task decomposition supervisor. Break the following task into sub-tasks ` +
      `and assign each to the most appropriate worker agent.\n\n` +
      `Available workers:\n${workerDescriptions}\n\n` +
      `Task: ${task}\n\n` +
      `Respond ONLY with a valid JSON object in this exact format (no markdown, no explanation):\n` +
      `{\n` +
      `  "strategy": "brief description of your decomposition strategy",\n` +
      `  "subTasks": [\n` +
      `    { "agentId": "worker-id", "task": "specific task description", "context": "optional context" }\n` +
      `  ]\n` +
      `}\n\n` +
      `Rules:\n` +
      `- Maximum ${this.maxSubTasks} sub-tasks\n` +
      `- If the task is simple enough for one agent, use just one sub-task\n` +
      `- Each sub-task must have a clear, self-contained description\n` +
      `- Only use agent IDs from the available workers list above`;

    const agentConfig = this.buildSupervisorAgentConfig();

    logger.info(
      { supervisorId: this.config.definition.id, taskLength: task.length },
      "Decomposing task"
    );

    const result = await this.supervisorRuntime.run({
      message: decompositionPrompt,
      session,
      agent: agentConfig,
      conversationHistory: [],
    });

    if (!result.success) {
      logger.warn(
        { error: result.error },
        "Supervisor decomposition failed, creating single fallback task"
      );
      return this.fallbackDecomposition(task);
    }

    try {
      // Parse the JSON response from the supervisor LLM
      const parsed = JSON.parse(this.extractJson(result.response)) as {
        strategy?: string;
        subTasks?: Array<{ agentId: string; task: string; context?: string }>;
      };

      if (!parsed.subTasks || !Array.isArray(parsed.subTasks) || parsed.subTasks.length === 0) {
        return this.fallbackDecomposition(task);
      }

      // Validate agent IDs and cap sub-tasks
      const validSubTasks = parsed.subTasks
        .filter((st) => this.workerMap.has(st.agentId))
        .slice(0, this.maxSubTasks)
        .map((st) => ({
          id: randomUUID(),
          agentId: st.agentId,
          task: st.task,
          context: st.context,
        }));

      if (validSubTasks.length === 0) {
        return this.fallbackDecomposition(task);
      }

      logger.info(
        {
          subTaskCount: validSubTasks.length,
          strategy: parsed.strategy,
          agents: validSubTasks.map((st) => st.agentId),
        },
        "Task decomposed"
      );

      return {
        subTasks: validSubTasks,
        strategy: parsed.strategy ?? "direct delegation",
      };
    } catch (error) {
      logger.warn(
        { error: String(error), response: result.response.slice(0, 200) },
        "Failed to parse decomposition response"
      );
      return this.fallbackDecomposition(task);
    }
  }

  // ─── Assign ─────────────────────────────────────────────────────────────

  /**
   * Assign a sub-task to a specific worker agent via the agent pool.
   */
  async assign(
    subTask: SubTask,
    pool: AgentPool,
    session: Session,
    agentDefinitions: Map<string, AgentDefinition>
  ): Promise<TaskAssignment> {
    const assignment: TaskAssignment = {
      taskId: subTask.id,
      agentId: subTask.agentId,
      task: subTask.task,
      status: "in_progress",
    };

    logger.info(
      { taskId: subTask.id, agentId: subTask.agentId },
      "Assigning sub-task to worker"
    );

    try {
      const handoffResult: HandoffResult = await executeHandoff(
        pool,
        {
          targetAgentId: subTask.agentId,
          reason: `Supervisor delegation: ${subTask.task.slice(0, 100)}`,
          contextSummary: subTask.context,
        },
        session,
        agentDefinitions
      );

      assignment.status = handoffResult.success ? "completed" : "failed";
      assignment.result = handoffResult.response;
      assignment.tokenUsage = handoffResult.tokenUsage;

      logger.info(
        { taskId: subTask.id, agentId: subTask.agentId, status: assignment.status },
        "Sub-task completed"
      );
    } catch (error) {
      assignment.status = "failed";
      assignment.result = error instanceof Error ? error.message : String(error);
      logger.error(
        { taskId: subTask.id, agentId: subTask.agentId, error: assignment.result },
        "Sub-task assignment failed"
      );
    }

    return assignment;
  }

  // ─── Aggregate ──────────────────────────────────────────────────────────

  /**
   * Combine the results from all worker agents into a final cohesive response.
   * Uses the supervisor's LLM to synthesize the results.
   */
  async aggregate(
    originalTask: string,
    assignments: TaskAssignment[],
    session: Session
  ): Promise<string> {
    // If only one assignment, return its result directly
    if (assignments.length === 1 && assignments[0].status === "completed") {
      return assignments[0].result ?? "";
    }

    const resultsSummary = assignments
      .map((a, i) => {
        const status = a.status === "completed" ? "SUCCESS" : "FAILED";
        return `[Sub-task ${i + 1} — Agent: ${a.agentId} — ${status}]\n${a.result ?? "No result"}`;
      })
      .join("\n\n---\n\n");

    const aggregationPrompt =
      `You are synthesizing results from multiple worker agents into a single cohesive response.\n\n` +
      `Original task: ${originalTask}\n\n` +
      `Worker results:\n${resultsSummary}\n\n` +
      `Combine these results into a single, well-organized response that directly addresses ` +
      `the original task. If any sub-tasks failed, acknowledge what could not be completed. ` +
      `Do not mention the multi-agent process — respond as if you handled everything directly.`;

    const agentConfig = this.buildSupervisorAgentConfig();

    const result = await this.supervisorRuntime.run({
      message: aggregationPrompt,
      session,
      agent: agentConfig,
      conversationHistory: [],
    });

    if (result.success) {
      return result.response;
    }

    // Fallback: just concatenate results
    logger.warn("Aggregation LLM call failed, using concatenated results");
    return assignments
      .filter((a) => a.status === "completed" && a.result)
      .map((a) => a.result!)
      .join("\n\n");
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private buildSupervisorAgentConfig(): AgentPersona & AgentConfig {
    const def = this.config.definition;
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
   * Fallback: assign the entire task to the first available worker.
   */
  private fallbackDecomposition(task: string): DecompositionResult {
    const firstWorker = this.config.workers[0];
    if (!firstWorker) {
      return { subTasks: [], strategy: "no workers available" };
    }

    return {
      subTasks: [
        {
          id: randomUUID(),
          agentId: firstWorker.id,
          task,
        },
      ],
      strategy: "fallback — single agent",
    };
  }

  /**
   * Extract JSON from a response that may contain markdown code fences.
   */
  private extractJson(text: string): string {
    // Try to extract from code fences first
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      return fenceMatch[1].trim();
    }

    // Try to find a JSON object directly
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return jsonMatch[0];
    }

    return text;
  }
}
