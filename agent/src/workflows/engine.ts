// ─── Workflow Engine ──────────────────────────────────────────────────────
//
// DAG-based workflow execution engine for multi-step automation.
// Supports triggers (schedule, webhook, event), action nodes
// (agent call, tool call, HTTP, condition, loop), and output nodes.
//
// ──────────────────────────────────────────────────────────────────────────

import pino from "pino";
import { randomUUID } from "crypto";

const logger = pino({ name: "workflow-engine" });

export type NodeType =
  | "trigger"
  | "agent_call"
  | "tool_call"
  | "http_request"
  | "condition"
  | "transform"
  | "delay"
  | "output";

export type TriggerType = "manual" | "schedule" | "webhook" | "event";

export interface WorkflowNode {
  id: string;
  type: NodeType;
  name: string;
  config: Record<string, unknown>;
  position: { x: number; y: number };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  condition?: string; // For condition nodes: "true" or "false" branch
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  trigger: {
    type: TriggerType;
    config: Record<string, unknown>;
  };
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export type RunStatus = "running" | "completed" | "failed" | "cancelled";

export interface NodeExecution {
  nodeId: string;
  nodeName: string;
  nodeType: NodeType;
  status: RunStatus;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  input: unknown;
  output: unknown;
  error?: string;
}

export interface WorkflowRun {
  runId: string;
  workflowId: string;
  status: RunStatus;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  nodeExecutions: NodeExecution[];
  trigger: { type: TriggerType; data?: unknown };
  error?: string;
}

/**
 * Executes workflow definitions as directed acyclic graphs.
 */
export class WorkflowEngine {
  private readonly workflows = new Map<string, WorkflowDefinition>();
  private readonly runs: WorkflowRun[] = [];
  private readonly maxRuns = 500;

  /**
   * Register a workflow definition.
   */
  register(workflow: WorkflowDefinition): void {
    this.workflows.set(workflow.id, workflow);
    logger.info({ workflowId: workflow.id, name: workflow.name }, "Workflow registered");
  }

  /**
   * Remove a workflow.
   */
  unregister(workflowId: string): boolean {
    return this.workflows.delete(workflowId);
  }

  /**
   * Get a workflow by ID.
   */
  get(workflowId: string): WorkflowDefinition | undefined {
    return this.workflows.get(workflowId);
  }

  /**
   * List all workflows.
   */
  list(): WorkflowDefinition[] {
    return Array.from(this.workflows.values());
  }

  /**
   * Execute a workflow.
   */
  async execute(
    workflowId: string,
    triggerData?: unknown,
    nodeExecutor?: (node: WorkflowNode, input: unknown) => Promise<unknown>
  ): Promise<WorkflowRun> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) throw new Error(`Workflow ${workflowId} not found`);

    const run: WorkflowRun = {
      runId: randomUUID(),
      workflowId,
      status: "running",
      startedAt: Date.now(),
      nodeExecutions: [],
      trigger: { type: workflow.trigger.type, data: triggerData },
    };

    logger.info({ runId: run.runId, workflowId }, "Workflow execution started");

    try {
      // Build adjacency list
      const adjacency = new Map<string, string[]>();
      for (const edge of workflow.edges) {
        const targets = adjacency.get(edge.source) ?? [];
        targets.push(edge.target);
        adjacency.set(edge.source, targets);
      }

      // Find trigger/start nodes (nodes with no incoming edges)
      const targetNodes = new Set(workflow.edges.map((e) => e.target));
      const startNodes = workflow.nodes.filter((n) => !targetNodes.has(n.id));

      // Execute in topological order
      const visited = new Set<string>();
      const nodeOutputs = new Map<string, unknown>();
      nodeOutputs.set("trigger", triggerData);

      const executeNode = async (nodeId: string): Promise<void> => {
        if (visited.has(nodeId)) return;
        visited.add(nodeId);

        const node = workflow.nodes.find((n) => n.id === nodeId);
        if (!node) return;

        // Get input from parent nodes
        const parentEdges = workflow.edges.filter((e) => e.target === nodeId);
        const input = parentEdges.length > 0
          ? nodeOutputs.get(parentEdges[0].source)
          : triggerData;

        const execution: NodeExecution = {
          nodeId,
          nodeName: node.name,
          nodeType: node.type,
          status: "running",
          startedAt: Date.now(),
          input,
          output: null,
        };
        run.nodeExecutions.push(execution);

        try {
          let output: unknown;

          if (nodeExecutor) {
            output = await nodeExecutor(node, input);
          } else {
            output = await this.defaultExecutor(node, input);
          }

          execution.output = output;
          execution.status = "completed";
          execution.endedAt = Date.now();
          execution.durationMs = execution.endedAt - execution.startedAt;
          nodeOutputs.set(nodeId, output);

          // Execute child nodes
          const children = adjacency.get(nodeId) ?? [];
          for (const childId of children) {
            // For condition nodes, check which branch to take
            if (node.type === "condition") {
              const edge = workflow.edges.find((e) => e.source === nodeId && e.target === childId);
              const conditionResult = Boolean(output);
              if (edge?.condition === "true" && conditionResult) {
                await executeNode(childId);
              } else if (edge?.condition === "false" && !conditionResult) {
                await executeNode(childId);
              } else if (!edge?.condition) {
                await executeNode(childId);
              }
            } else {
              await executeNode(childId);
            }
          }
        } catch (err) {
          execution.status = "failed";
          execution.error = err instanceof Error ? err.message : String(err);
          execution.endedAt = Date.now();
          execution.durationMs = execution.endedAt - execution.startedAt;
          throw err;
        }
      };

      for (const startNode of startNodes) {
        await executeNode(startNode.id);
      }

      run.status = "completed";
    } catch (err) {
      run.status = "failed";
      run.error = err instanceof Error ? err.message : String(err);
    } finally {
      run.endedAt = Date.now();
      run.durationMs = run.endedAt - run.startedAt;
      this.addRun(run);
    }

    logger.info(
      { runId: run.runId, status: run.status, durationMs: run.durationMs },
      "Workflow execution finished"
    );
    return run;
  }

  /**
   * Default node executor for common node types.
   */
  private async defaultExecutor(node: WorkflowNode, input: unknown): Promise<unknown> {
    switch (node.type) {
      case "trigger":
        return input;

      case "delay": {
        const ms = (node.config.delayMs as number) ?? 1000;
        await new Promise((r) => setTimeout(r, Math.min(ms, 60000)));
        return input;
      }

      case "transform": {
        const template = node.config.template as string;
        if (template) {
          return template.replace(/\{\{input\}\}/g, JSON.stringify(input));
        }
        return input;
      }

      case "condition": {
        const field = node.config.field as string;
        const operator = node.config.operator as string;
        const value = node.config.value;
        if (!field) return Boolean(input);
        const inputObj = input as Record<string, unknown>;
        const actual = inputObj[field];
        switch (operator) {
          case "equals": return actual === value;
          case "not_equals": return actual !== value;
          case "contains": return String(actual).includes(String(value));
          case "greater_than": return Number(actual) > Number(value);
          case "less_than": return Number(actual) < Number(value);
          default: return Boolean(actual);
        }
      }

      case "output":
        return input;

      default:
        return input;
    }
  }

  /**
   * Get run history.
   */
  getRuns(workflowId?: string, limit = 20): WorkflowRun[] {
    let result = [...this.runs];
    if (workflowId) result = result.filter((r) => r.workflowId === workflowId);
    return result.sort((a, b) => b.startedAt - a.startedAt).slice(0, limit);
  }

  private addRun(run: WorkflowRun): void {
    this.runs.push(run);
    if (this.runs.length > this.maxRuns) this.runs.shift();
  }
}
