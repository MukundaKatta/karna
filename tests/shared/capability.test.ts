import { describe, it, expect } from "vitest";
import {
  CapabilityTokenSchema,
  issueCapability,
  isCapabilityExpired,
  capabilityAllowsTool,
  capabilityAllowsSkill,
  capabilityAllowsScope,
} from "../../packages/shared/src/types/capability.js";

describe("Capability tokens (#562)", () => {
  it("issues a valid, schema-conforming capability", () => {
    const cap = issueCapability({
      subject: "user-1",
      tools: ["shell_exec"],
      skills: ["news-digest"],
      scopes: ["memory:read"],
      now: 1000,
      ttlMs: 5000,
    });
    expect(() => CapabilityTokenSchema.parse(cap)).not.toThrow();
    expect(cap.subject).toBe("user-1");
    expect(cap.issuedAt).toBe(1000);
    expect(cap.expiresAt).toBe(6000);
    expect(cap.id).toBeTruthy();
  });

  it("honors explicit tool grants and denies others", () => {
    const cap = issueCapability({ subject: "u", tools: ["a"], now: 0, ttlMs: 10_000 });
    expect(capabilityAllowsTool(cap, "a", 1000)).toBe(true);
    expect(capabilityAllowsTool(cap, "b", 1000)).toBe(false);
  });

  it("applies the same semantics to skills and scopes", () => {
    const cap = issueCapability({
      subject: "u",
      skills: ["s1"],
      scopes: ["files:write"],
      now: 0,
      ttlMs: 10_000,
    });
    expect(capabilityAllowsSkill(cap, "s1", 1000)).toBe(true);
    expect(capabilityAllowsSkill(cap, "s2", 1000)).toBe(false);
    expect(capabilityAllowsScope(cap, "files:write", 1000)).toBe(true);
    expect(capabilityAllowsScope(cap, "files:read", 1000)).toBe(false);
  });

  it("denies everything once expired", () => {
    const cap = issueCapability({ subject: "u", tools: ["a"], now: 0, ttlMs: 1000 });
    expect(isCapabilityExpired(cap, 500)).toBe(false);
    expect(isCapabilityExpired(cap, 1000)).toBe(true);
    expect(capabilityAllowsTool(cap, "a", 2000)).toBe(false);
  });
});
