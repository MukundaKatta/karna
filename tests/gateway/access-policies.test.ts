import { describe, it, expect, beforeEach } from "vitest";
import { AccessPolicyManager } from "../../gateway/src/access/policies.js";

describe("AccessPolicyManager", () => {
  let apm: AccessPolicyManager;

  beforeEach(() => {
    apm = new AccessPolicyManager({ pairingCodeLength: 6, pairingExpiryMs: 500 });
  });

  describe("DM access policies", () => {
    it("defaults to pairing mode", () => {
      const policy = apm.getPolicy("ch-1");
      expect(policy.dmMode).toBe("pairing");
    });

    it("rejects unpaired users in pairing mode", () => {
      const result = apm.checkDmAccess("ch-1", "stranger");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Pairing required");
    });

    it("allows paired users", () => {
      const code = apm.generatePairingCode("ch-1", "user-1");
      apm.verifyPairingCode("ch-1", code);

      const result = apm.checkDmAccess("ch-1", "user-1");
      expect(result.allowed).toBe(true);
      expect(result.reason).toContain("paired");
    });

    it("rejects expired pairing codes", async () => {
      const code = apm.generatePairingCode("ch-1", "user-1");
      await new Promise((r) => setTimeout(r, 600)); // Wait for expiry

      const result = apm.verifyPairingCode("ch-1", code);
      expect(result.success).toBe(false);
    });

    it("allows all DMs in open mode", () => {
      apm.setDmMode("ch-1", "open");
      const result = apm.checkDmAccess("ch-1", "anyone");
      expect(result.allowed).toBe(true);
    });

    it("rejects all DMs in closed mode except allowlisted", () => {
      apm.setDmMode("ch-1", "closed");
      expect(apm.checkDmAccess("ch-1", "stranger").allowed).toBe(false);

      apm.addToAllowlist("ch-1", "vip");
      expect(apm.checkDmAccess("ch-1", "vip").allowed).toBe(true);
    });

    it("always blocks blocklisted users", () => {
      apm.setDmMode("ch-1", "open");
      apm.addToBlocklist("ch-1", "bad-user");
      expect(apm.checkDmAccess("ch-1", "bad-user").allowed).toBe(false);
    });

    it("allowlist overrides pairing mode", () => {
      apm.addToAllowlist("ch-1", "trusted");
      expect(apm.checkDmAccess("ch-1", "trusted").allowed).toBe(true);
    });
  });

  describe("Group chat routing", () => {
    it("defaults to mention mode", () => {
      const policy = apm.getPolicy("ch-1");
      expect(policy.groupActivation).toBe("mention");
    });

    it("allows messages that mention the agent", () => {
      const result = apm.checkGroupAccess("ch-1", "user-1", "Hey @karna help me", false);
      expect(result.allowed).toBe(true);
    });

    it("rejects messages without mention in mention mode", () => {
      const result = apm.checkGroupAccess("ch-1", "user-1", "Hello everyone", false);
      expect(result.allowed).toBe(false);
    });

    it("allows replies to agent", () => {
      const result = apm.checkGroupAccess("ch-1", "user-1", "Yes, do that", true);
      expect(result.allowed).toBe(true);
    });

    it("allows all messages in always mode", () => {
      apm.setGroupActivation("ch-1", "always");
      const result = apm.checkGroupAccess("ch-1", "user-1", "Random message", false);
      expect(result.allowed).toBe(true);
    });

    it("rejects all messages in off mode", () => {
      apm.setGroupActivation("ch-1", "off");
      const result = apm.checkGroupAccess("ch-1", "user-1", "@karna help", false);
      expect(result.allowed).toBe(false);
    });

    it("blocks blocklisted users in groups", () => {
      apm.setGroupActivation("ch-1", "always");
      apm.addToBlocklist("ch-1", "spammer");
      expect(apm.checkGroupAccess("ch-1", "spammer", "test", false).allowed).toBe(false);
    });

    it("detects case-insensitive mentions", () => {
      const result = apm.checkGroupAccess("ch-1", "user-1", "Hey KARNA help", false);
      expect(result.allowed).toBe(true);
    });
  });

  describe("Pairing codes", () => {
    it("generates unique codes", () => {
      const code1 = apm.generatePairingCode("ch-1", "user-1");
      const code2 = apm.generatePairingCode("ch-1", "user-2");
      expect(code1).not.toBe(code2);
      expect(code1).toHaveLength(6);
    });

    it("rejects invalid codes", () => {
      const result = apm.verifyPairingCode("ch-1", "000000");
      expect(result.success).toBe(false);
    });

    it("codes are single-use", () => {
      const code = apm.generatePairingCode("ch-1", "user-1");
      expect(apm.verifyPairingCode("ch-1", code).success).toBe(true);
      expect(apm.verifyPairingCode("ch-1", code).success).toBe(false); // Second use fails
    });
  });
});
