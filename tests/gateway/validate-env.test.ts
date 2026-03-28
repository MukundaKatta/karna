import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateGatewayEnv, validateCloudEnv } from "../../gateway/src/config/validate-env.js";

describe("Environment Validation", () => {
  const savedEnv: Record<string, string | undefined> = {};
  const envKeys = [
    "NODE_ENV", "GATEWAY_AUTH_TOKEN", "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY", "JWT_SECRET", "SUPABASE_URL",
  ];

  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  describe("validateGatewayEnv", () => {
    it("returns valid in test mode", () => {
      const result = validateGatewayEnv("test");
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("warns in development when no API key set", () => {
      delete process.env["ANTHROPIC_API_KEY"];
      delete process.env["OPENAI_API_KEY"];
      delete process.env["GATEWAY_AUTH_TOKEN"];
      const result = validateGatewayEnv("development");
      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("fails in production when no API key set", () => {
      delete process.env["ANTHROPIC_API_KEY"];
      delete process.env["OPENAI_API_KEY"];
      delete process.env["GATEWAY_AUTH_TOKEN"];
      const result = validateGatewayEnv("production");
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("passes in production with ANTHROPIC_API_KEY and auth token (16+ chars)", () => {
      process.env["ANTHROPIC_API_KEY"] = "sk-ant-test-key";
      process.env["GATEWAY_AUTH_TOKEN"] = "a-secure-gateway-token-that-is-long-enough";
      const result = validateGatewayEnv("production");
      expect(result.valid).toBe(true);
    });

    it("passes in production with OPENAI_API_KEY and auth token (16+ chars)", () => {
      delete process.env["ANTHROPIC_API_KEY"];
      process.env["OPENAI_API_KEY"] = "sk-test-key";
      process.env["GATEWAY_AUTH_TOKEN"] = "a-secure-gateway-token-that-is-long-enough";
      const result = validateGatewayEnv("production");
      expect(result.valid).toBe(true);
    });

    it("fails in production without GATEWAY_AUTH_TOKEN", () => {
      process.env["ANTHROPIC_API_KEY"] = "sk-ant-test";
      delete process.env["GATEWAY_AUTH_TOKEN"];
      const result = validateGatewayEnv("production");
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("fails in production with short GATEWAY_AUTH_TOKEN", () => {
      process.env["ANTHROPIC_API_KEY"] = "sk-ant-test";
      process.env["GATEWAY_AUTH_TOKEN"] = "short";
      const result = validateGatewayEnv("production");
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("16"))).toBe(true);
    });
  });

  describe("validateCloudEnv", () => {
    it("returns valid in test mode", () => {
      const result = validateCloudEnv("test");
      expect(result.valid).toBe(true);
    });

    it("warns in development when JWT_SECRET not set", () => {
      delete process.env["JWT_SECRET"];
      const result = validateCloudEnv("development");
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.includes("JWT_SECRET"))).toBe(true);
    });

    it("fails in production when JWT_SECRET not set", () => {
      delete process.env["JWT_SECRET"];
      const result = validateCloudEnv("production");
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("JWT_SECRET"))).toBe(true);
    });

    it("fails in production when JWT_SECRET too short", () => {
      process.env["JWT_SECRET"] = "short";
      const result = validateCloudEnv("production");
      expect(result.valid).toBe(false);
    });

    it("passes in production with proper JWT_SECRET", () => {
      process.env["JWT_SECRET"] = "a".repeat(32);
      const result = validateCloudEnv("production");
      expect(result.valid).toBe(true);
    });

    it("warns when SUPABASE_URL not set", () => {
      delete process.env["SUPABASE_URL"];
      process.env["JWT_SECRET"] = "a".repeat(32);
      const result = validateCloudEnv("development");
      expect(result.warnings.some((w) => w.includes("SUPABASE_URL"))).toBe(true);
    });
  });
});
