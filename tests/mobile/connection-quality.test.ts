import { describe, expect, it } from "vitest";

import {
  buildConnectionQuality,
  classifyLatency,
  formatNetworkType,
  shouldUseCompactMode,
} from "../../apps/mobile/lib/connection-quality.js";

describe("mobile connection quality", () => {
  it("classifies latency thresholds for the chat indicator", () => {
    expect(classifyLatency(null)).toBe("unknown");
    expect(classifyLatency(99)).toBe("good");
    expect(classifyLatency(100)).toBe("slow");
    expect(classifyLatency(499)).toBe("slow");
    expect(classifyLatency(500)).toBe("poor");
  });

  it("enables compact mode for slow, reconnecting, or offline sessions", () => {
    expect(
      shouldUseCompactMode({
        latencyMs: 100,
        reconnectAttempts: 0,
        networkType: "wifi",
      }),
    ).toBe(true);
    expect(
      shouldUseCompactMode({
        latencyMs: 50,
        reconnectAttempts: 1,
        networkType: "wifi",
      }),
    ).toBe(true);
    expect(
      shouldUseCompactMode({
        latencyMs: 50,
        reconnectAttempts: 0,
        networkType: "offline",
      }),
    ).toBe(true);
    expect(
      shouldUseCompactMode({
        latencyMs: 50,
        reconnectAttempts: 0,
        networkType: "wifi",
      }),
    ).toBe(false);
  });

  it("builds labels and derived quality state", () => {
    expect(
      buildConnectionQuality({
        latencyMs: 520,
        reconnectAttempts: 2,
        networkType: "cellular",
      }),
    ).toEqual({
      latencyMs: 520,
      level: "poor",
      reconnectAttempts: 2,
      networkType: "cellular",
      compactMode: true,
    });
    expect(formatNetworkType("wifi")).toBe("WiFi");
    expect(formatNetworkType("cellular")).toBe("Cellular");
    expect(formatNetworkType("offline")).toBe("Offline");
    expect(formatNetworkType("unknown")).toBe("Network unknown");
  });
});
