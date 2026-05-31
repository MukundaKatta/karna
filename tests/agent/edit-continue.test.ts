import { describe, it, expect } from "vitest";
import { z } from "zod";
import { editToolArgs } from "../../agent/src/approval/edit-continue.js";
import { ApprovalAuditTrail } from "../../agent/src/approval/audit-trail.js";
import type { ToolDefinitionRuntime } from "../../agent/src/tools/registry.js";

function mockTool(overrides: Partial<ToolDefinitionRuntime> = {}): ToolDefinitionRuntime {
  return {
    name: "send_email",
    description: "Send an email",
    parameters: { type: "object", properties: {} },
    riskLevel: "high",
    requiresApproval: true,
    timeout: 30_000,
    execute: async () => null,
    ...overrides,
  };
}

const emailSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1),
  retries: z.number().int().min(0).default(0),
});

describe("Edit-and-Continue (#590)", () => {
  it("accepts a valid edit and reports it changed", () => {
    const tool = mockTool({ inputSchema: emailSchema });
    const result = editToolArgs(
      tool,
      { to: "a@example.com", subject: "Hi", retries: 0 },
      { to: "b@example.com", subject: "Hi", retries: 0 },
      "call-1",
      { actor: "alice", now: () => 42 }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.changed).toBe(true);
      expect(result.args.to).toBe("b@example.com");
      expect(result.record.originalArgs.to).toBe("a@example.com");
      expect(result.record.actor).toBe("alice");
      expect(result.record.at).toBe(42);
    }
  });

  it("applies Zod defaults during re-validation", () => {
    const tool = mockTool({ inputSchema: emailSchema });
    const result = editToolArgs(
      tool,
      { to: "a@example.com", subject: "Hi", retries: 0 },
      { to: "a@example.com", subject: "Edited" },
      "call-1",
      { actor: "alice" }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args.retries).toBe(0); // default applied
      expect(result.changed).toBe(true);
    }
  });

  it("rejects an invalid edit and surfaces issues", () => {
    const tool = mockTool({ inputSchema: emailSchema });
    const result = editToolArgs(
      tool,
      { to: "a@example.com", subject: "Hi" },
      { to: "not-an-email", subject: "" },
      "call-1",
      { actor: "alice" }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.error).toContain("Invalid");
    }
  });

  it("reports changed=false for an identical (order-insensitive) edit", () => {
    const tool = mockTool({ inputSchema: emailSchema });
    const result = editToolArgs(
      tool,
      { to: "a@example.com", subject: "Hi", retries: 0 },
      { subject: "Hi", retries: 0, to: "a@example.com" },
      "call-1",
      { actor: "alice" }
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.changed).toBe(false);
  });

  it("passes through when the tool has no inputSchema", () => {
    const tool = mockTool(); // no inputSchema
    const result = editToolArgs(
      tool,
      { anything: 1 },
      { anything: 2, extra: "x" },
      "call-1",
      { actor: "alice" }
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args).toEqual({ anything: 2, extra: "x" });
      expect(result.changed).toBe(true);
    }
  });

  it("records an edit decision into the audit trail on success", () => {
    const tool = mockTool({ inputSchema: emailSchema });
    const audit = new ApprovalAuditTrail({ now: () => 100 });
    editToolArgs(
      tool,
      { to: "a@example.com", subject: "Hi", retries: 0 },
      { to: "b@example.com", subject: "Hi", retries: 0 },
      "call-9",
      { actor: "bob", audit, reason: "fix recipient" }
    );
    const entries = audit.forToolCall("call-9");
    expect(entries).toHaveLength(1);
    expect(entries[0].decision).toBe("edit");
    expect(entries[0].actor).toBe("bob");
    expect(entries[0].reason).toBe("fix recipient");
    expect(entries[0].details?.changed).toBe(true);
  });

  it("does not record into audit when the edit is rejected", () => {
    const tool = mockTool({ inputSchema: emailSchema });
    const audit = new ApprovalAuditTrail();
    editToolArgs(
      tool,
      { to: "a@example.com", subject: "Hi" },
      { to: "bad", subject: "" },
      "call-x",
      { actor: "bob", audit }
    );
    expect(audit.size).toBe(0);
  });
});
