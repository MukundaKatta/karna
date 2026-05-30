import { describe, it, expect } from "vitest";
import {
  checkPassport,
  assertPassport,
  PassportDeniedError,
  type AgentPassport,
} from "../../agent/src/tools/security/passport.js";
import { issueCapability } from "../../packages/shared/src/types/capability.js";

const NOW = 1_000_000;

function passport(overrides: Partial<AgentPassport> = {}): AgentPassport {
  return {
    id: "pp-1",
    subject: "agent-1",
    capabilities: [
      issueCapability({ subject: "agent-1", tools: ["web_read"], scopes: ["net:read"], now: NOW, ttlMs: 10_000 }),
    ],
    ...overrides,
  };
}

describe("agent passport authz (#555)", () => {
  it("default-allows when no passport is supplied (non-breaking)", () => {
    const d = checkPassport(undefined, { toolName: "anything" }, { now: NOW });
    expect(d.allowed).toBe(true);
    expect(typeof d.overheadMs).toBe("number");
  });

  it("allows a granted tool and scope", () => {
    const d = checkPassport(passport(), { toolName: "web_read", requiredScopes: ["net:read"] }, { now: NOW });
    expect(d.allowed).toBe(true);
  });

  it("denies an ungranted tool with a structured error", () => {
    const d = checkPassport(passport(), { toolName: "shell_exec" }, { now: NOW });
    expect(d.allowed).toBe(false);
    expect(d.error?.code).toBe("tool_not_granted");
    expect(d.error?.detail).toBe("shell_exec");
  });

  it("denies an ungranted scope", () => {
    const d = checkPassport(passport(), { toolName: "web_read", requiredScopes: ["net:write"] }, { now: NOW });
    expect(d.allowed).toBe(false);
    expect(d.error?.code).toBe("scope_not_granted");
  });

  it("denies when the passport itself is expired", () => {
    const d = checkPassport(passport({ expiresAt: NOW - 1 }), { toolName: "web_read" }, { now: NOW });
    expect(d.error?.code).toBe("passport_expired");
  });

  it("denies when all embedded capabilities are expired", () => {
    const expired = passport({
      capabilities: [issueCapability({ subject: "a", tools: ["web_read"], now: NOW - 100_000, ttlMs: 1 })],
    });
    const d = checkPassport(expired, { toolName: "web_read" }, { now: NOW });
    expect(d.error?.code).toBe("no_capabilities");
  });

  describe("audience", () => {
    it("allows a matching audience", () => {
      const d = checkPassport(passport({ audience: ["prod"] }), { toolName: "web_read", audience: "prod" }, { now: NOW });
      expect(d.allowed).toBe(true);
    });
    it("denies a mismatched audience", () => {
      const d = checkPassport(passport({ audience: ["prod"] }), { toolName: "web_read", audience: "staging" }, { now: NOW });
      expect(d.error?.code).toBe("audience_mismatch");
    });
  });

  it("measures non-negative overhead", () => {
    const d = checkPassport(passport(), { toolName: "web_read" }, { now: NOW });
    expect(d.overheadMs).toBeGreaterThanOrEqual(0);
  });

  describe("assertPassport", () => {
    it("returns overhead on success", () => {
      const res = assertPassport(passport(), { toolName: "web_read" }, { now: NOW });
      expect(res.overheadMs).toBeGreaterThanOrEqual(0);
    });
    it("throws PassportDeniedError on denial", () => {
      expect(() => assertPassport(passport(), { toolName: "nope" }, { now: NOW })).toThrow(PassportDeniedError);
    });
  });
});
