import { afterEach, describe, expect, it } from "vitest";
import {
  resolvePublicGatewayUrl,
  resolvePublicWebSocketUrl,
  resolveServerGatewayUrl,
} from "../../apps/web/lib/runtime-config";

const originalNodeEnv = process.env["NODE_ENV"];
const originalGatewayUrl = process.env["GATEWAY_URL"];
const originalPublicGatewayUrl = process.env["NEXT_PUBLIC_GATEWAY_URL"];
const originalPublicWsUrl = process.env["NEXT_PUBLIC_WS_URL"];

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

afterEach(() => {
  restoreEnv("NODE_ENV", originalNodeEnv);
  restoreEnv("GATEWAY_URL", originalGatewayUrl);
  restoreEnv("NEXT_PUBLIC_GATEWAY_URL", originalPublicGatewayUrl);
  restoreEnv("NEXT_PUBLIC_WS_URL", originalPublicWsUrl);
});

describe("web runtime config", () => {
  it("uses localhost defaults outside production", () => {
    delete process.env["NODE_ENV"];
    delete process.env["GATEWAY_URL"];
    delete process.env["NEXT_PUBLIC_GATEWAY_URL"];
    delete process.env["NEXT_PUBLIC_WS_URL"];

    expect(resolveServerGatewayUrl()).toEqual({
      url: "http://localhost:4000",
      error: null,
    });
    expect(resolvePublicGatewayUrl()).toEqual({
      url: "http://localhost:4000",
      error: null,
    });
    expect(resolvePublicWebSocketUrl()).toEqual({
      url: "ws://localhost:4000/ws",
      error: null,
    });
  });

  it("normalizes internal hostport service references for server-side proxies", () => {
    process.env["NODE_ENV"] = "production";
    process.env["GATEWAY_URL"] = "karna-gateway:10000";
    delete process.env["NEXT_PUBLIC_GATEWAY_URL"];

    expect(resolveServerGatewayUrl()).toEqual({
      url: "http://karna-gateway:10000",
      error: null,
    });
  });

  it("prefers the public gateway URL when production fallback points at an internal hostport", () => {
    process.env["NODE_ENV"] = "production";
    process.env["GATEWAY_URL"] = "karna-gateway:10000";
    process.env["NEXT_PUBLIC_GATEWAY_URL"] = "https://karna-gateway.onrender.com";

    expect(resolveServerGatewayUrl()).toEqual({
      url: "https://karna-gateway.onrender.com",
      error: null,
    });
  });

  it("derives the websocket endpoint from NEXT_PUBLIC_GATEWAY_URL", () => {
    process.env["NODE_ENV"] = "production";
    process.env["NEXT_PUBLIC_GATEWAY_URL"] = "https://gateway.karna.ai";
    delete process.env["NEXT_PUBLIC_WS_URL"];

    expect(resolvePublicWebSocketUrl()).toEqual({
      url: "wss://gateway.karna.ai/ws",
      error: null,
    });
  });

  it("returns a clear production error when gateway env vars are missing", () => {
    process.env["NODE_ENV"] = "production";
    delete process.env["GATEWAY_URL"];
    delete process.env["NEXT_PUBLIC_GATEWAY_URL"];
    delete process.env["NEXT_PUBLIC_WS_URL"];

    expect(resolveServerGatewayUrl()).toEqual({
      url: null,
      error: "Set GATEWAY_URL or NEXT_PUBLIC_GATEWAY_URL for the hosted web app",
    });
    expect(resolvePublicGatewayUrl()).toEqual({
      url: null,
      error: "Set NEXT_PUBLIC_GATEWAY_URL for browser access to the gateway",
    });
    expect(resolvePublicWebSocketUrl()).toEqual({
      url: null,
      error: "Set NEXT_PUBLIC_GATEWAY_URL for browser access to the gateway",
    });
  });

  it("surfaces malformed public websocket configuration", () => {
    process.env["NODE_ENV"] = "production";
    process.env["NEXT_PUBLIC_WS_URL"] = "karna-websocket";

    expect(resolvePublicWebSocketUrl()).toEqual({
      url: null,
      error:
        'WebSocket URL must start with ws://, wss://, http://, or https://, received "karna-websocket"',
    });
  });
});
