import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import {
  type TriggerType,
  type WorkflowDefinition,
  type WorkflowEngine,
} from "@karna/agent/workflows/engine.js";

interface CreateWorkflowBody {
  name?: string;
  description?: string;
  triggerType?: TriggerType;
  schedule?: string;
}

interface UpdateWorkflowBody {
  enabled?: boolean;
  name?: string;
  description?: string;
}

interface RunWorkflowBody {
  triggerData?: unknown;
}

interface WorkflowParams {
  workflowId: string;
}

export function registerWorkflowRoutes(
  app: FastifyInstance,
  workflowEngine: WorkflowEngine,
): void {
  app.get("/api/workflows", async () => {
    const workflows = workflowEngine
      .list()
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((workflow) => summarizeWorkflow(workflowEngine, workflow));

    return {
      workflows,
      total: workflows.length,
    };
  });

  app.get<{ Params: WorkflowParams }>("/api/workflows/:workflowId", async (request, reply) => {
    const workflow = workflowEngine.get(request.params.workflowId);
    if (!workflow) {
      return reply.status(404).send({ error: "Workflow not found" });
    }

    return reply.send({
      workflow,
      summary: summarizeWorkflow(workflowEngine, workflow),
      runs: workflowEngine.getRuns(workflow.id, 20),
    });
  });

  app.post<{ Body: CreateWorkflowBody }>("/api/workflows", async (request, reply) => {
    const workflow = createStarterWorkflow(request.body);
    workflowEngine.register(workflow);

    return reply.status(201).send({
      workflow: summarizeWorkflow(workflowEngine, workflow),
    });
  });

  app.patch<{ Params: WorkflowParams; Body: UpdateWorkflowBody }>(
    "/api/workflows/:workflowId",
    async (request, reply) => {
      const workflow = workflowEngine.get(request.params.workflowId);
      if (!workflow) {
        return reply.status(404).send({ error: "Workflow not found" });
      }

      if (
        request.body?.enabled === undefined &&
        request.body?.name === undefined &&
        request.body?.description === undefined
      ) {
        return reply.status(400).send({ error: "At least one workflow field must be provided" });
      }

      const updatedWorkflow: WorkflowDefinition = {
        ...workflow,
        name: request.body?.name?.trim() || workflow.name,
        description: request.body?.description?.trim() || workflow.description,
        enabled: request.body?.enabled ?? workflow.enabled,
        updatedAt: Date.now(),
      };
      workflowEngine.register(updatedWorkflow);

      return reply.send({
        workflow: summarizeWorkflow(workflowEngine, updatedWorkflow),
      });
    },
  );

  app.delete<{ Params: WorkflowParams }>("/api/workflows/:workflowId", async (request, reply) => {
    const deleted = workflowEngine.unregister(request.params.workflowId);
    if (!deleted) {
      return reply.status(404).send({ error: "Workflow not found" });
    }

    return reply.send({
      deleted: true,
      workflowId: request.params.workflowId,
    });
  });

  app.post<{ Params: WorkflowParams; Body: RunWorkflowBody }>(
    "/api/workflows/:workflowId/run",
    async (request, reply) => {
      const workflow = workflowEngine.get(request.params.workflowId);
      if (!workflow) {
        return reply.status(404).send({ error: "Workflow not found" });
      }
      if (!workflow.enabled) {
        return reply.status(409).send({ error: "Workflow is disabled" });
      }

      const run = await workflowEngine.execute(workflow.id, request.body?.triggerData);
      const refreshed = workflowEngine.get(workflow.id);
      if (!refreshed) {
        return reply.status(500).send({ error: "Workflow disappeared after execution" });
      }

      return reply.send({
        workflow: summarizeWorkflow(workflowEngine, refreshed),
        run,
      });
    },
  );
}

function summarizeWorkflow(workflowEngine: WorkflowEngine, workflow: WorkflowDefinition) {
  const runs = workflowEngine.getRuns(workflow.id, 500);
  const lastRun = runs[0];
  const schedule = typeof workflow.trigger.config["schedule"] === "string"
    ? (workflow.trigger.config["schedule"] as string)
    : undefined;

  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    trigger: {
      type: workflow.trigger.type,
      schedule,
    },
    nodeCount: workflow.nodes.length,
    enabled: workflow.enabled,
    lastRun: lastRun
      ? {
          status: lastRun.status,
          at: lastRun.startedAt,
          durationMs: lastRun.durationMs ?? 0,
        }
      : undefined,
    runs: runs.length,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
  };
}

function createStarterWorkflow(body: CreateWorkflowBody | undefined): WorkflowDefinition {
  const now = Date.now();
  const triggerType = body?.triggerType ?? "manual";
  const name = body?.name?.trim() || "Starter Workflow";
  const description =
    body?.description?.trim() ||
    "A starter workflow that captures input, shapes it, and emits a reusable output.";

  return {
    id: `wf-${nanoid(8)}`,
    name,
    description,
    trigger: {
      type: triggerType,
      config:
        triggerType === "schedule"
          ? { schedule: body?.schedule?.trim() || "0 9 * * 1-5" }
          : {},
    },
    enabled: true,
    createdAt: now,
    updatedAt: now,
    nodes: [
      {
        id: "trigger",
        type: "trigger",
        name: "Trigger",
        config: {},
        position: { x: 0, y: 0 },
      },
      {
        id: "shape",
        type: "transform",
        name: "Shape input",
        config: {
          template: "Starter workflow output: {{input}}",
        },
        position: { x: 260, y: 0 },
      },
      {
        id: "output",
        type: "output",
        name: "Output",
        config: {},
        position: { x: 520, y: 0 },
      },
    ],
    edges: [
      {
        id: "trigger->shape",
        source: "trigger",
        target: "shape",
      },
      {
        id: "shape->output",
        source: "shape",
        target: "output",
      },
    ],
  };
}
