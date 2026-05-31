import { describe, it, expect } from "vitest";
import {
  resolveApprovalPolicy,
  parseApprovalPolicyConfig,
  DEFAULT_APPROVAL_POLICY_CONFIG,
  DEFAULT_BASE_POLICY,
  ApprovalPolicyConfigSchema,
  type ApprovalPolicyConfig,
} from "../../agent/src/approval/policies.js";

describe("Approval Policies (#587)", () => {
  describe("default config", () => {
    it("auto-approves low and medium by default", () => {
      expect(resolveApprovalPolicy("low").autoApprove).toBe(true);
      expect(resolveApprovalPolicy("medium").autoApprove).toBe(true);
    });

    it("requires approval for high and critical by default", () => {
      expect(resolveApprovalPolicy("high").autoApprove).toBe(false);
      expect(resolveApprovalPolicy("critical").autoApprove).toBe(false);
    });

    it("critical requires more approvers than high", () => {
      expect(resolveApprovalPolicy("critical").requiredApprovers).toBeGreaterThan(
        resolveApprovalPolicy("high").requiredApprovers
      );
    });

    it("returns a fresh object (not the shared base reference)", () => {
      const p = resolveApprovalPolicy("high");
      expect(p).not.toBe(DEFAULT_BASE_POLICY.high);
      expect(p).toEqual(DEFAULT_BASE_POLICY.high);
    });
  });

  describe("scoped overrides", () => {
    const config: ApprovalPolicyConfig = {
      base: DEFAULT_BASE_POLICY,
      channels: {
        "ops-chan": { high: { autoApprove: true } },
      },
      users: {
        alice: { high: { requiredApprovers: 3 }, low: { autoApprove: false } },
      },
    };

    it("applies channel override on top of base", () => {
      const p = resolveApprovalPolicy("high", { channelId: "ops-chan" }, config);
      expect(p.autoApprove).toBe(true);
      // untouched fields remain from base
      expect(p.requiredApprovers).toBe(DEFAULT_BASE_POLICY.high.requiredApprovers);
    });

    it("user override wins over channel override", () => {
      const p = resolveApprovalPolicy(
        "high",
        { channelId: "ops-chan", userId: "alice" },
        config
      );
      // channel set autoApprove true; user did not touch it -> stays true
      expect(p.autoApprove).toBe(true);
      // user override of requiredApprovers wins
      expect(p.requiredApprovers).toBe(3);
    });

    it("user override can flip a low-risk level to require approval", () => {
      const p = resolveApprovalPolicy("low", { userId: "alice" }, config);
      expect(p.autoApprove).toBe(false);
    });

    it("unknown scope ids fall back to base", () => {
      const p = resolveApprovalPolicy("high", { userId: "nobody", channelId: "nope" }, config);
      expect(p).toEqual(DEFAULT_BASE_POLICY.high);
    });
  });

  describe("validation", () => {
    it("parses a valid config", () => {
      expect(() => parseApprovalPolicyConfig(DEFAULT_APPROVAL_POLICY_CONFIG)).not.toThrow();
    });

    it("rejects a config missing a risk level in base", () => {
      const bad = {
        base: {
          low: { autoApprove: true, requiredApprovers: 0, timeoutMs: 1000 },
          medium: { autoApprove: true, requiredApprovers: 0, timeoutMs: 1000 },
          high: { autoApprove: false, requiredApprovers: 1, timeoutMs: 1000 },
          // critical missing
        },
      };
      expect(ApprovalPolicyConfigSchema.safeParse(bad).success).toBe(false);
    });

    it("rejects negative requiredApprovers", () => {
      const bad = {
        base: {
          ...DEFAULT_BASE_POLICY,
          high: { autoApprove: false, requiredApprovers: -1, timeoutMs: 1000 },
        },
      };
      expect(ApprovalPolicyConfigSchema.safeParse(bad).success).toBe(false);
    });

    it("rejects non-positive timeoutMs", () => {
      const bad = {
        base: {
          ...DEFAULT_BASE_POLICY,
          low: { autoApprove: true, requiredApprovers: 0, timeoutMs: 0 },
        },
      };
      expect(ApprovalPolicyConfigSchema.safeParse(bad).success).toBe(false);
    });
  });
});
