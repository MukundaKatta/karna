import { beforeEach, describe, expect, it, vi } from "vitest";

const expoConstantsState = vi.hoisted(() => ({
  expoConfig: {
    extra: {},
  },
}));

vi.mock("expo-constants", () => ({
  default: expoConstantsState,
}));

const {
  deriveMobileGatewayHttpUrl,
  deriveMobileGatewayHealthUrl,
  isLegacyLocalGatewayUrl,
  normalizeMobileGatewayWsUrl,
  resolveDefaultMobileGatewayHealthUrl,
  resolveDefaultMobileGatewayWsUrl,
} = await import("../../apps/mobile/lib/runtime-config.js");

describe("mobile runtime config", () => {
  beforeEach(() => {
    expoConstantsState.expoConfig.extra = {};
  });

  it("defaults dev builds to the local gateway websocket", () => {
    expect(resolveDefaultMobileGatewayWsUrl({ dev: true })).toBe(
      "ws://localhost:4000/ws",
    );
    expect(resolveDefaultMobileGatewayHealthUrl({ dev: true })).toBe(
      "http://localhost:4000/health",
    );
  });

  it("defaults production builds to the hosted Karna gateway", () => {
    expect(resolveDefaultMobileGatewayWsUrl({ dev: false })).toBe(
      "wss://karna-gateway.onrender.com/ws",
    );
    expect(resolveDefaultMobileGatewayHealthUrl({ dev: false })).toBe(
      "https://karna-gateway.onrender.com/health",
    );
  });

  it("normalizes host, http, and websocket inputs into websocket URLs", () => {
    expect(normalizeMobileGatewayWsUrl("karna-gateway.onrender.com:4000")).toBe(
      "ws://karna-gateway.onrender.com:4000/ws",
    );
    expect(
      normalizeMobileGatewayWsUrl("https://karna-gateway.onrender.com"),
    ).toBe("wss://karna-gateway.onrender.com/ws");
    expect(
      normalizeMobileGatewayWsUrl("wss://karna-gateway.onrender.com/ws"),
    ).toBe("wss://karna-gateway.onrender.com/ws");
  });

  it("derives a health endpoint from websocket or http inputs", () => {
    expect(
      deriveMobileGatewayHttpUrl(
        "wss://karna-gateway.onrender.com/ws",
      ).toString(),
    ).toBe("https://karna-gateway.onrender.com/");
    expect(
      deriveMobileGatewayHealthUrl("wss://karna-gateway.onrender.com/ws"),
    ).toBe("https://karna-gateway.onrender.com/health");
    expect(
      deriveMobileGatewayHealthUrl("https://karna-gateway.onrender.com"),
    ).toBe("https://karna-gateway.onrender.com/health");
  });

  it("flags the legacy localhost review URL for migration", () => {
    expect(isLegacyLocalGatewayUrl("ws://localhost:3100")).toBe(true);
    expect(isLegacyLocalGatewayUrl("ws://localhost:4000/ws")).toBe(false);
  });

  it("uses expo extra overrides for hosted builds when present", () => {
    expoConstantsState.expoConfig.extra = {
      mobileGateway: {
        gatewayUrl: "https://review.karna.ai",
        webSocketUrl: "wss://review.karna.ai/ws",
      },
    };

    expect(resolveDefaultMobileGatewayWsUrl({ dev: false })).toBe(
      "wss://review.karna.ai/ws",
    );
    expect(resolveDefaultMobileGatewayHealthUrl({ dev: false })).toBe(
      "https://review.karna.ai/health",
    );
  });
});
