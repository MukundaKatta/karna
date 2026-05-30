import { describe, it, expect } from "vitest";
import {
  PolicyEngine,
  matchesCondition,
  type PolicyInput,
} from "../../agent/src/tools/security/policy-engine.js";

function input(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    toolName: "file_read",
    args: {},
    riskLevel: "low",
    ...overrides,
  };
}

describe("policy engine (#556)", () => {
  it("defaults to allow when no rules match (non-breaking)", () => {
    const engine = new PolicyEngine();
    const ev = engine.evaluate(input());
    expect(ev.decision).toBe("allow");
    expect(ev.matchedRuleId).toBe("default");
  });

  it("supports a configurable default decision", () => {
    const engine = new PolicyEngine([], { defaultDecision: "deny" });
    expect(engine.evaluate(input()).decision).toBe("deny");
  });

  it("matches by tool name", () => {
    const engine = new PolicyEngine([
      { id: "deny-shell", decision: "deny", when: { tools: ["shell_exec"] } },
    ]);
    expect(engine.evaluate(input({ toolName: "shell_exec" })).decision).toBe("deny");
    expect(engine.evaluate(input({ toolName: "file_read" })).decision).toBe("allow");
  });

  it("matches by risk level", () => {
    const engine = new PolicyEngine([
      { id: "approve-high", decision: "require-approval", when: { riskLevels: ["high", "critical"] } },
    ]);
    expect(engine.evaluate(input({ riskLevel: "high" })).decision).toBe("require-approval");
    expect(engine.evaluate(input({ riskLevel: "low" })).decision).toBe("allow");
  });

  it("matches by user", () => {
    const engine = new PolicyEngine([
      { id: "guest-deny", decision: "deny", when: { users: ["guest"] } },
    ]);
    expect(engine.evaluate(input({ user: "guest" })).decision).toBe("deny");
    expect(engine.evaluate(input({ user: "admin" })).decision).toBe("allow");
    // missing user does not match a users condition
    expect(engine.evaluate(input()).decision).toBe("allow");
  });

  it("matches by argument pattern (case-insensitive regex over JSON)", () => {
    const engine = new PolicyEngine([
      { id: "secret-arg", decision: "require-approval", when: { argPatterns: ["password|secret"] } },
    ]);
    expect(engine.evaluate(input({ args: { note: "my Password=x" } })).decision).toBe("require-approval");
    expect(engine.evaluate(input({ args: { note: "hello" } })).decision).toBe("allow");
  });

  it("supports custom predicates", () => {
    const engine = new PolicyEngine([
      { id: "big-write", decision: "dry-run", when: { predicate: (i) => String(i.args.size ?? "") > "1000" } },
    ]);
    expect(engine.evaluate(input({ args: { size: "9999" } })).decision).toBe("dry-run");
  });

  it("evaluates rules in priority order; first match wins", () => {
    const engine = new PolicyEngine([
      { id: "low-allow", decision: "allow", when: { tools: ["x"] }, priority: 1 },
      { id: "high-deny", decision: "deny", when: { tools: ["x"] }, priority: 10 },
    ]);
    expect(engine.evaluate(input({ toolName: "x" })).decision).toBe("deny");
    expect(engine.evaluate(input({ toolName: "x" })).matchedRuleId).toBe("high-deny");
  });

  it("preserves declaration order for equal priority", () => {
    const engine = new PolicyEngine([
      { id: "first", decision: "require-approval", when: { tools: ["x"] } },
      { id: "second", decision: "deny", when: { tools: ["x"] } },
    ]);
    expect(engine.evaluate(input({ toolName: "x" })).matchedRuleId).toBe("first");
  });

  describe("audit log", () => {
    it("records every evaluation", () => {
      const engine = new PolicyEngine([], { now: () => 42 });
      engine.evaluate(input({ toolName: "a" }));
      engine.evaluate(input({ toolName: "b" }));
      const audit = engine.getAudit();
      expect(audit).toHaveLength(2);
      expect(audit[0]!.input.toolName).toBe("a");
      expect(audit[0]!.at).toBe(42);
      engine.clearAudit();
      expect(engine.getAudit()).toHaveLength(0);
    });

    it("bounds the audit ring buffer", () => {
      const engine = new PolicyEngine([], { maxAudit: 3 });
      for (let i = 0; i < 10; i++) engine.evaluate(input({ toolName: `t${i}` }));
      const audit = engine.getAudit();
      expect(audit).toHaveLength(3);
      expect(audit[2]!.input.toolName).toBe("t9");
    });
  });

  describe("addRule / removeRule", () => {
    it("adds and removes rules", () => {
      const engine = new PolicyEngine();
      engine.addRule({ id: "r1", decision: "deny" });
      expect(engine.evaluate(input()).decision).toBe("deny");
      expect(engine.removeRule("r1")).toBe(true);
      expect(engine.removeRule("r1")).toBe(false);
      expect(engine.evaluate(input()).decision).toBe("allow");
    });
  });

  describe("matchesCondition", () => {
    it("undefined condition matches everything", () => {
      expect(matchesCondition(undefined, input())).toBe(true);
    });
    it("invalid regex argPattern does not throw", () => {
      expect(matchesCondition({ argPatterns: ["("] }, input())).toBe(false);
    });
  });
});
