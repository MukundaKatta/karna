import { describe, expect, it } from "vitest";
import {
  resolveWebSocketLimitConfig,
  validateWebSocketMessageSize,
  type BandwidthTracker,
} from "../../gateway/src/protocol/limits.js";

describe("websocket message limits", () => {
  const limits = resolveWebSocketLimitConfig({
    maxPayloadBytes: 100,
    maxMediaPayloadBytes: 1_000,
    bandwidthWindowMs: 60_000,
    maxBandwidthBytesPerWindow: 10_000,
  });

  it("rejects regular messages over the default payload limit", () => {
    const tracker: BandwidthTracker = { windowStartedAt: 0, bytes: 0 };
    const result = validateWebSocketMessageSize(
      JSON.stringify({
        type: "chat.message",
        payload: { content: "x".repeat(140) },
      }),
      limits,
      tracker,
      1,
    );

    expect(result.ok).toBe(false);
    expect(result.code).toBe("MESSAGE_TOO_LARGE");
  });

  it("allows larger voice payloads up to the media limit", () => {
    const tracker: BandwidthTracker = { windowStartedAt: 0, bytes: 0 };
    const result = validateWebSocketMessageSize(
      JSON.stringify({
        type: "voice.audio.chunk",
        payload: { data: "x".repeat(140) },
      }),
      limits,
      tracker,
      1,
    );

    expect(result.ok).toBe(true);
  });

  it("tracks per-connection bandwidth within a time window", () => {
    const tightLimits = resolveWebSocketLimitConfig({
      maxPayloadBytes: 1_000,
      maxMediaPayloadBytes: 1_000,
      bandwidthWindowMs: 60_000,
      maxBandwidthBytesPerWindow: 120,
    });
    const tracker: BandwidthTracker = { windowStartedAt: 0, bytes: 0 };
    const message = JSON.stringify({ type: "heartbeat.ack", payload: { clientTime: 1 } });

    expect(validateWebSocketMessageSize(message, tightLimits, tracker, 1).ok).toBe(true);
    expect(validateWebSocketMessageSize(message, tightLimits, tracker, 2).ok).toBe(true);

    const result = validateWebSocketMessageSize(message, tightLimits, tracker, 3);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("BANDWIDTH_LIMIT_EXCEEDED");
  });
});
