import { describe, it, expect, beforeEach } from "vitest";
import {
  WorkflowEngine,
  type WorkflowDefinition,
  type WorkflowNode,
  type WorkflowEdge,
} from "../../agent/src/workflows/engine.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeNode(overrides: Partial<WorkflowNode> & { id: string; type: WorkflowNode["type"] }): WorkflowNode {
  return {
    name: overrides.id,
    config: {},
    position: { x: 0, y: 0 },
    ...overrides,
  };
}

function makeEdge(source: string, target: string, overrides: Partial<WorkflowEdge> = {}): WorkflowEdge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    ...overrides,
  };
}

function makeWorkflow(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return {
    id: "wf-1",
    name: "Test Workflow",
    description: "A test workflow",
    nodes: [],
    edges: [],
    trigger: { type: "manual", config: {} },
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ─── WorkflowEngine ─────────────────────────────────────────────────────────

describe("WorkflowEngine", () => {
  let engine: WorkflowEngine;

  beforeEach(() => {
    engine = new WorkflowEngine();
  });

  describe("register", () => {
    it("registers a workflow definition", () => {
      const wf = makeWorkflow();
      engine.register(wf);
      expect(engine.get("wf-1")).toBeDefined();
      expect(engine.get("wf-1")?.name).toBe("Test Workflow");
    });

    it("overwrites existing workflow with same ID", () => {
      engine.register(makeWorkflow({ name: "Version 1" }));
      engine.register(makeWorkflow({ name: "Version 2" }));
      expect(engine.get("wf-1")?.name).toBe("Version 2");
    });
  });

  describe("unregister", () => {
    it("removes a workflow", () => {
      engine.register(makeWorkflow());
      expect(engine.unregister("wf-1")).toBe(true);
      expect(engine.get("wf-1")).toBeUndefined();
    });

    it("returns false for non-existent workflow", () => {
      expect(engine.unregister("nonexistent")).toBe(false);
    });
  });

  describe("list", () => {
    it("returns all registered workflows", () => {
      engine.register(makeWorkflow({ id: "wf-1", name: "First" }));
      engine.register(makeWorkflow({ id: "wf-2", name: "Second" }));
      const list = engine.list();
      expect(list).toHaveLength(2);
    });
  });

  describe("execute", () => {
    it("throws for unknown workflow", async () => {
      await expect(engine.execute("nonexistent")).rejects.toThrow(
        "Workflow nonexistent not found"
      );
    });

    it("executes a simple linear workflow", async () => {
      const wf = makeWorkflow({
        nodes: [
          makeNode({ id: "trigger", type: "trigger" }),
          makeNode({ id: "output", type: "output" }),
        ],
        edges: [makeEdge("trigger", "output")],
      });
      engine.register(wf);

      const run = await engine.execute("wf-1", { message: "hello" });
      expect(run.status).toBe("completed");
      expect(run.nodeExecutions).toHaveLength(2);
      expect(run.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("passes trigger data through the pipeline", async () => {
      const results: unknown[] = [];
      const wf = makeWorkflow({
        nodes: [
          makeNode({ id: "trigger", type: "trigger" }),
          makeNode({ id: "output", type: "output" }),
        ],
        edges: [makeEdge("trigger", "output")],
      });
      engine.register(wf);

      const run = await engine.execute(
        "wf-1",
        { value: 42 },
        async (node, input) => {
          results.push({ nodeId: node.id, input });
          return input;
        }
      );

      expect(run.status).toBe("completed");
      expect(results).toHaveLength(2);
      expect((results[0] as any).input).toEqual({ value: 42 });
    });

    it("handles condition nodes with true branch", async () => {
      const wf = makeWorkflow({
        nodes: [
          makeNode({ id: "trigger", type: "trigger" }),
          makeNode({
            id: "check",
            type: "condition",
            config: { field: "status", operator: "equals", value: "active" },
          }),
          makeNode({ id: "true-branch", type: "output" }),
          makeNode({ id: "false-branch", type: "output" }),
        ],
        edges: [
          makeEdge("trigger", "check"),
          makeEdge("check", "true-branch", { condition: "true" }),
          makeEdge("check", "false-branch", { condition: "false" }),
        ],
      });
      engine.register(wf);

      const run = await engine.execute("wf-1", { status: "active" });
      expect(run.status).toBe("completed");
      // Should execute trigger, check, and true-branch (not false-branch)
      const executedIds = run.nodeExecutions.map((n) => n.nodeId);
      expect(executedIds).toContain("true-branch");
      expect(executedIds).not.toContain("false-branch");
    });

    it("handles condition nodes with false branch", async () => {
      const wf = makeWorkflow({
        nodes: [
          makeNode({ id: "trigger", type: "trigger" }),
          makeNode({
            id: "check",
            type: "condition",
            config: { field: "status", operator: "equals", value: "active" },
          }),
          makeNode({ id: "true-branch", type: "output" }),
          makeNode({ id: "false-branch", type: "output" }),
        ],
        edges: [
          makeEdge("trigger", "check"),
          makeEdge("check", "true-branch", { condition: "true" }),
          makeEdge("check", "false-branch", { condition: "false" }),
        ],
      });
      engine.register(wf);

      const run = await engine.execute("wf-1", { status: "inactive" });
      expect(run.status).toBe("completed");
      const executedIds = run.nodeExecutions.map((n) => n.nodeId);
      expect(executedIds).toContain("false-branch");
      expect(executedIds).not.toContain("true-branch");
    });

    it("handles transform nodes", async () => {
      const wf = makeWorkflow({
        nodes: [
          makeNode({ id: "trigger", type: "trigger" }),
          makeNode({
            id: "transform",
            type: "transform",
            config: { template: "Result: {{input}}" },
          }),
          makeNode({ id: "output", type: "output" }),
        ],
        edges: [
          makeEdge("trigger", "transform"),
          makeEdge("transform", "output"),
        ],
      });
      engine.register(wf);

      const run = await engine.execute("wf-1", "hello");
      expect(run.status).toBe("completed");
      const transformExec = run.nodeExecutions.find((n) => n.nodeId === "transform");
      expect(transformExec?.output).toContain("hello");
    });

    it("marks run as failed when a node throws", async () => {
      const wf = makeWorkflow({
        nodes: [
          makeNode({ id: "trigger", type: "trigger" }),
          makeNode({ id: "broken", type: "agent_call" }),
        ],
        edges: [makeEdge("trigger", "broken")],
      });
      engine.register(wf);

      const run = await engine.execute("wf-1", {}, async (node) => {
        if (node.id === "broken") throw new Error("Agent unavailable");
        return null;
      });

      expect(run.status).toBe("failed");
      expect(run.error).toContain("Agent unavailable");
      const brokenExec = run.nodeExecutions.find((n) => n.nodeId === "broken");
      expect(brokenExec?.status).toBe("failed");
      expect(brokenExec?.error).toContain("Agent unavailable");
    });

    it("does not revisit already-visited nodes in DAG", async () => {
      // Diamond pattern: trigger -> A, trigger -> B, A -> output, B -> output
      const wf = makeWorkflow({
        nodes: [
          makeNode({ id: "trigger", type: "trigger" }),
          makeNode({ id: "a", type: "transform", config: {} }),
          makeNode({ id: "b", type: "transform", config: {} }),
          makeNode({ id: "output", type: "output" }),
        ],
        edges: [
          makeEdge("trigger", "a"),
          makeEdge("trigger", "b"),
          makeEdge("a", "output"),
          makeEdge("b", "output"),
        ],
      });
      engine.register(wf);

      const run = await engine.execute("wf-1", "data");
      expect(run.status).toBe("completed");
      // Output node should only be executed once thanks to visited set
      const outputExecs = run.nodeExecutions.filter((n) => n.nodeId === "output");
      expect(outputExecs).toHaveLength(1);
    });
  });

  describe("getRuns", () => {
    it("returns run history sorted by most recent first", async () => {
      const wf = makeWorkflow({
        nodes: [makeNode({ id: "trigger", type: "trigger" })],
        edges: [],
      });
      engine.register(wf);

      await engine.execute("wf-1", "run-1");
      await engine.execute("wf-1", "run-2");

      const runs = engine.getRuns();
      expect(runs).toHaveLength(2);
      expect(runs[0].startedAt).toBeGreaterThanOrEqual(runs[1].startedAt);
    });

    it("filters by workflowId", async () => {
      engine.register(makeWorkflow({ id: "wf-1", nodes: [makeNode({ id: "t", type: "trigger" })], edges: [] }));
      engine.register(makeWorkflow({ id: "wf-2", nodes: [makeNode({ id: "t", type: "trigger" })], edges: [] }));

      await engine.execute("wf-1");
      await engine.execute("wf-2");
      await engine.execute("wf-1");

      const runs = engine.getRuns("wf-1");
      expect(runs).toHaveLength(2);
      expect(runs.every((r) => r.workflowId === "wf-1")).toBe(true);
    });
  });

  describe("condition operators", () => {
    async function runCondition(operator: string, field: string, value: unknown, input: Record<string, unknown>) {
      const wf = makeWorkflow({
        id: `cond-${operator}`,
        nodes: [
          makeNode({ id: "trigger", type: "trigger" }),
          makeNode({ id: "cond", type: "condition", config: { field, operator, value } }),
          makeNode({ id: "yes", type: "output" }),
        ],
        edges: [
          makeEdge("trigger", "cond"),
          makeEdge("cond", "yes", { condition: "true" }),
        ],
      });
      engine.register(wf);
      return engine.execute(`cond-${operator}`, input);
    }

    it("supports equals operator", async () => {
      const run = await runCondition("equals", "x", 10, { x: 10 });
      expect(run.nodeExecutions.map((n) => n.nodeId)).toContain("yes");
    });

    it("supports not_equals operator", async () => {
      const run = await runCondition("not_equals", "x", 10, { x: 5 });
      expect(run.nodeExecutions.map((n) => n.nodeId)).toContain("yes");
    });

    it("supports greater_than operator", async () => {
      const run = await runCondition("greater_than", "x", 5, { x: 10 });
      expect(run.nodeExecutions.map((n) => n.nodeId)).toContain("yes");
    });

    it("supports contains operator", async () => {
      const run = await runCondition("contains", "name", "arn", { name: "karna" });
      expect(run.nodeExecutions.map((n) => n.nodeId)).toContain("yes");
    });
  });
});
