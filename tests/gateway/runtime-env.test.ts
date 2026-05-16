import { afterEach, describe, expect, it } from "vitest";
import { KarnaConfigSchema } from "../../gateway/src/config/schema.js";
import {
  isGatewayOriginAllowed,
  resolveGatewayCorsOrigins,
} from "../../gateway/src/config/runtime-env.js";

describe("gateway runtime environment", () => {
  const originalNodeEnv = process.env["NODE_ENV"];
  const originalCorsOrigins = process.env["GATEWAY_CORS_ORIGINS"];
  const originalLegacyCorsOrigins = process.env["CORS_ORIGINS"];

  afterEach(() => {
    restoreEnv("NODE_ENV", originalNodeEnv);
    restoreEnv("GATEWAY_CORS_ORIGINS", originalCorsOrigins);
    restoreEnv("CORS_ORIGINS", originalLegacyCorsOrigins);
  });

  it("uses localhost CORS defaults outside production", () => {
    process.env["NODE_ENV"] = "development";
    const config = KarnaConfigSchema.parse({});
    expect(resolveGatewayCorsOrigins(config)).toEqual([
      "http://localhost:3000",
      "http://localhost:5173",
    ]);
  });

  it("uses explicit production origins when no override is configured", () => {
    process.env["NODE_ENV"] = "production";
    const config = KarnaConfigSchema.parse({});
    expect(resolveGatewayCorsOrigins(config)).toEqual([
      "https://app.karna.ai",
      "https://karna-web.vercel.app",
      "https://karna-web-0osh.onrender.com",
    ]);
  });

  it("validates WebSocket origins against the same allowlist", () => {
    const allowedOrigins = ["https://app.karna.ai"];
    expect(isGatewayOriginAllowed("https://app.karna.ai/chat", allowedOrigins)).toBe(true);
    expect(isGatewayOriginAllowed("https://evil.example", allowedOrigins)).toBe(false);
    expect(isGatewayOriginAllowed(undefined, allowedOrigins)).toBe(true);
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
