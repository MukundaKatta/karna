import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  HandoffLoopError,
  HandoffDepthError,
} from "../../agent/src/orchestration/handoff.js";
import { Orchestrator } from "../../agent/src/orchestration/orchestrator.js";
import type { AgentDefinition } from "@karna/shared/types/orchestration.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeAgentDef(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    id: "agent-1",
    name: "Test Agent",
    description: "A test agent",
    ...overrides,
  };
}

// ─── HandoffLoopError ───────────────────────────────────────────────────────

describe("HandoffLoopError", () => {
  it("stores agentId and visitedPath", () => {
    const err = new HandoffLoopError("agent-c", ["agent-a", "agent-b"]);
    expect(err.agentId).toBe("agent-c");
    expect(err.visitedPath).toEqual(["agent-a", "agent-b"]);
    expect(err.name).toBe("HandoffLoopError");
  });

  it("includes the path in the error message", () => {
    const err = new HandoffLoopError("agent-c", ["agent-a", "agent-b"]);
    expect(err.message).toContain("agent-a -> agent-b -> agent-c");
  });
});

// ─── HandoffDepthError ──────────────────────────────────────────────────────

describe("HandoffDepthError", () => {
  it("stores currentDepth and maxDepth", () => {
    const err = new HandoffDepthError(5, 5);
    expect(err.currentDepth).toBe(5);
    expect(err.maxDepth).toBe(5);
    expect(err.name).toBe("HandoffDepthError");
  });

  it("includes depth info in message", () => {
    const err = new HandoffDepthError(6, 5);
    expect(err.message).toContain("5");
    expect(err.message).toContain("6");
  });
});

// ─── Orchestrator constructor ───────────────────────────────────────────────

describe("Orchestrator", () => {
  const defaultAgent = makeAgentDef({ id: "default" });
  const codeAgent = makeAgentDef({
    id: "code-agent",
    name: "Code Agent",
    description: "Writes code",
    specializations: ["code"],
  });

  describe("constructor", () => {
    it("creates an orchestrator with valid config", () => {
      const orchestrator = new Orchestrator({
        agents: [defaultAgent, codeAgent],
        defaultAgentId: "default",
      });
      expect(orchestrator).toBeDefined();
      expect(orchestrator.activeAgentCount).toBe(0);
    });

    it("throws when default agent is not in definitions", () => {
      expect(
        () =>
          new Orchestrator({
            agents: [codeAgent],
            defaultAgentId: "missing-agent",
          })
      ).toThrow('Default agent "missing-agent" not found');
    });
  });

  describe("getAgentDefinitions", () => {
    it("returns all registered agent definitions", () => {
      const orchestrator = new Orchestrator({
        agents: [defaultAgent, codeAgent],
        defaultAgentId: "default",
      });
      const defs = orchestrator.getAgentDefinitions();
      expect(defs).toHaveLength(2);
      expect(defs.map((d) => d.id)).toContain("default");
      expect(defs.map((d) => d.id)).toContain("code-agent");
    });
  });

  describe("getAgentDefinition", () => {
    it("returns a specific agent by ID", () => {
      const orchestrator = new Orchestrator({
        agents: [defaultAgent, codeAgent],
        defaultAgentId: "default",
      });
      const def = orchestrator.getAgentDefinition("code-agent");
      expect(def).toBeDefined();
      expect(def?.name).toBe("Code Agent");
    });

    it("returns undefined for unknown agent", () => {
      const orchestrator = new Orchestrator({
        agents: [defaultAgent],
        defaultAgentId: "default",
      });
      expect(orchestrator.getAgentDefinition("nonexistent")).toBeUndefined();
    });
  });

  describe("callbacks", () => {
    it("accepts delegation callback without error", () => {
      const orchestrator = new Orchestrator({
        agents: [defaultAgent],
        defaultAgentId: "default",
      });
      expect(() =>
        orchestrator.setDelegationCallback(() => {})
      ).not.toThrow();
    });

    it("accepts stream callback without error", () => {
      const orchestrator = new Orchestrator({
        agents: [defaultAgent],
        defaultAgentId: "default",
      });
      expect(() =>
        orchestrator.setStreamCallback(() => {})
      ).not.toThrow();
    });
  });

  describe("supervisor mode", () => {
    it("does not create supervisor when not enabled", () => {
      const orchestrator = new Orchestrator({
        agents: [defaultAgent],
        defaultAgentId: "default",
        enableSupervisor: false,
      });
      // handleWithSupervisor should fail gracefully
      // (we don't call it here because it requires full runtime, but the
      // constructor path is exercised)
      expect(orchestrator).toBeDefined();
    });

    it("warns but does not throw when supervisor enabled without supervisor agent", () => {
      // No agent has isSupervisor: true, should not throw
      expect(
        () =>
          new Orchestrator({
            agents: [defaultAgent],
            defaultAgentId: "default",
            enableSupervisor: true,
          })
      ).not.toThrow();
    });
  });
});
