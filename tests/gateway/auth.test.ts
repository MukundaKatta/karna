import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  validateToken,
  generateChallenge,
  verifyChallenge,
  createAuthContext,
} from "../../gateway/src/protocol/auth.js";

describe("Gateway Auth", () => {
  const originalEnv = process.env["GATEWAY_AUTH_TOKEN"];

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env["GATEWAY_AUTH_TOKEN"] = originalEnv;
    } else {
      delete process.env["GATEWAY_AUTH_TOKEN"];
    }
  });

  describe("validateToken", () => {
    it("returns true when no token is configured (dev mode)", () => {
      delete process.env["GATEWAY_AUTH_TOKEN"];
      expect(validateToken("")).toBe(true);
      expect(validateToken("anything")).toBe(true);
    });

    it("returns true for valid token", () => {
      process.env["GATEWAY_AUTH_TOKEN"] = "my-secret-token";
      expect(validateToken("my-secret-token")).toBe(true);
    });

    it("returns false for invalid token", () => {
      process.env["GATEWAY_AUTH_TOKEN"] = "my-secret-token";
      expect(validateToken("wrong-token")).toBe(false);
    });

    it("returns false for empty token when auth is configured", () => {
      process.env["GATEWAY_AUTH_TOKEN"] = "my-secret-token";
      expect(validateToken("")).toBe(false);
    });

    it("returns false for token with different length", () => {
      process.env["GATEWAY_AUTH_TOKEN"] = "short";
      expect(validateToken("much-longer-token-here")).toBe(false);
    });
  });

  describe("generateChallenge", () => {
    it("generates a challenge with nonce and expiry", () => {
      const challenge = generateChallenge();
      expect(challenge.nonce).toBeTruthy();
      expect(challenge.nonce.length).toBe(64); // 32 bytes hex
      expect(challenge.timestamp).toBeLessThanOrEqual(Date.now());
      expect(challenge.expiresAt).toBeGreaterThan(Date.now());
    });

    it("generates unique nonces", () => {
      const c1 = generateChallenge();
      const c2 = generateChallenge();
      expect(c1.nonce).not.toBe(c2.nonce);
    });

    it("sets 30-second expiry", () => {
      const challenge = generateChallenge();
      const diff = challenge.expiresAt - challenge.timestamp;
      expect(diff).toBe(30_000);
    });
  });

  describe("verifyChallenge", () => {
    it("returns true when no token is configured (dev mode)", () => {
      delete process.env["GATEWAY_AUTH_TOKEN"];
      expect(verifyChallenge("any-response", "any-nonce")).toBe(true);
    });

    it("verifies correct HMAC response", () => {
      process.env["GATEWAY_AUTH_TOKEN"] = "test-secret";
      const { createHmac } = require("node:crypto");
      const nonce = "test-nonce-123";
      const expectedResponse = createHmac("sha256", "test-secret")
        .update(nonce)
        .digest("hex");
      expect(verifyChallenge(expectedResponse, nonce)).toBe(true);
    });

    it("rejects incorrect response", () => {
      process.env["GATEWAY_AUTH_TOKEN"] = "test-secret";
      expect(verifyChallenge("wrong-response", "test-nonce")).toBe(false);
    });
  });

  describe("createAuthContext", () => {
    it("creates an auth context with correct fields", () => {
      const ctx = createAuthContext("device-1", "operator", "my-token");
      expect(ctx.deviceId).toBe("device-1");
      expect(ctx.role).toBe("operator");
      expect(ctx.token).toBe("my-token");
      expect(ctx.connectedAt).toBeLessThanOrEqual(Date.now());
    });

    it("supports node role", () => {
      const ctx = createAuthContext("node-1", "node", "token");
      expect(ctx.role).toBe("node");
    });
  });
});
