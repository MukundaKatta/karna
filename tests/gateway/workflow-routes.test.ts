import { beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { WorkflowEngine, type WorkflowDefinition } from "../../agent/src/workflows/engine.js";
import { registerWorkflowRoutes } from "../../gateway/src/routes/workflows.js";

function makeWorkflow(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  const now = Date.now();
  return {
    id: "wf-test",
    name: "Test Workflow",
    description: "A workflow for route tests",
    trigger: {
      type: "manual",
      config: {},
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
        id: "output",
        type: "output",
        name: "Output",
        config: {},
        position: { x: 200, y: 0 },
      },
    ],
    edges: [
      {
        id: "trigger->output",
        source: "trigger",
        target: "output",
      },
    ],
    ...overrides,
  };
}

describe("workflow routes", () => {
  let app: ReturnType<typeof Fastify>;
  let workflowEngine: WorkflowEngine;

  beforeEach(async () => {
    app = Fastify();
    workflowEngine = new WorkflowEngine();
    workflowEngine.register(makeWorkflow());
    registerWorkflowRoutes(app, workflowEngine);
    await app.ready();
  });

  it("lists, creates, updates, runs, and deletes workflows", async () => {
    const list = await app.inject({
      method: "GET",
      url: "/api/workflows",
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().workflows[0].id).toBe("wf-test");

    const detail = await app.inject({
      method: "GET",
      url: "/api/workflows/wf-test",
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().workflow.id).toBe("wf-test");

    const create = await app.inject({
      method: "POST",
      url: "/api/workflows",
      payload: {
        name: "Starter",
        triggerType: "schedule",
        schedule: "0 10 * * *",
      },
    });
    expect(create.statusCode).toBe(201);
    const createdId = create.json().workflow.id as string;

    const patch = await app.inject({
      method: "PATCH",
      url: `/api/workflows/${createdId}`,
      payload: {
        enabled: false,
      },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().workflow.enabled).toBe(false);

    const disabledRun = await app.inject({
      method: "POST",
      url: `/api/workflows/${createdId}/run`,
    });
    expect(disabledRun.statusCode).toBe(409);

    await app.inject({
      method: "PATCH",
      url: `/api/workflows/${createdId}`,
      payload: {
        enabled: true,
      },
    });

    const run = await app.inject({
      method: "POST",
      url: `/api/workflows/${createdId}/run`,
      payload: {
        triggerData: { source: "test-suite" },
      },
    });
    expect(run.statusCode).toBe(200);
    expect(run.json().run.status).toBe("completed");
    expect(run.json().workflow.runs).toBe(1);

    const remove = await app.inject({
      method: "DELETE",
      url: `/api/workflows/${createdId}`,
    });
    expect(remove.statusCode).toBe(200);
    expect(remove.json().deleted).toBe(true);
  });

  it("returns 404 for unknown workflows and 400 for empty patch requests", async () => {
    const missing = await app.inject({
      method: "GET",
      url: "/api/workflows/not-real",
    });
    expect(missing.statusCode).toBe(404);

    const emptyPatch = await app.inject({
      method: "PATCH",
      url: "/api/workflows/wf-test",
      payload: {},
    });
    expect(emptyPatch.statusCode).toBe(400);
  });
});
