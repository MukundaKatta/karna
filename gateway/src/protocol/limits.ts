export interface WebSocketLimitConfig {
  maxPayloadBytes: number;
  maxMediaPayloadBytes: number;
  bandwidthWindowMs: number;
  maxBandwidthBytesPerWindow: number;
}

export interface BandwidthTracker {
  windowStartedAt: number;
  bytes: number;
}

export interface MessageLimitResult {
  ok: boolean;
  code?: "MESSAGE_TOO_LARGE" | "BANDWIDTH_LIMIT_EXCEEDED";
  message?: string;
  sizeBytes: number;
}

const MEDIA_MESSAGE_TYPES = new Set([
  "voice.audio.chunk",
  "voice.audio.response",
]);

export function resolveWebSocketLimitConfig(config: {
  maxPayloadBytes?: number;
  maxMediaPayloadBytes?: number;
  bandwidthWindowMs?: number;
  maxBandwidthBytesPerWindow?: number;
}): WebSocketLimitConfig {
  const maxPayloadBytes = config.maxPayloadBytes ?? 1_048_576;
  const maxMediaPayloadBytes = config.maxMediaPayloadBytes ?? 10_485_760;
  return {
    maxPayloadBytes,
    maxMediaPayloadBytes,
    bandwidthWindowMs: config.bandwidthWindowMs ?? 60_000,
    maxBandwidthBytesPerWindow: config.maxBandwidthBytesPerWindow ?? maxMediaPayloadBytes * 6,
  };
}

export function validateWebSocketMessageSize(
  rawData: Buffer | string,
  limits: WebSocketLimitConfig,
  tracker: BandwidthTracker,
  now = Date.now(),
): MessageLimitResult {
  const sizeBytes = Buffer.byteLength(rawData);

  if (now - tracker.windowStartedAt > limits.bandwidthWindowMs) {
    tracker.windowStartedAt = now;
    tracker.bytes = 0;
  }

  tracker.bytes += sizeBytes;
  if (tracker.bytes > limits.maxBandwidthBytesPerWindow) {
    return {
      ok: false,
      code: "BANDWIDTH_LIMIT_EXCEEDED",
      message: "Too much WebSocket traffic on this connection. Please slow down and retry.",
      sizeBytes,
    };
  }

  const type = sniffProtocolType(rawData);
  const maxBytes = type && MEDIA_MESSAGE_TYPES.has(type)
    ? limits.maxMediaPayloadBytes
    : limits.maxPayloadBytes;

  if (sizeBytes > maxBytes) {
    return {
      ok: false,
      code: "MESSAGE_TOO_LARGE",
      message: `Message exceeds the ${maxBytes} byte limit for ${type ?? "this"} messages.`,
      sizeBytes,
    };
  }

  return { ok: true, sizeBytes };
}

function sniffProtocolType(rawData: Buffer | string): string | undefined {
  const raw = typeof rawData === "string" ? rawData : rawData.toString("utf-8");
  const match = raw.match(/"type"\s*:\s*"([^"]+)"/);
  return match?.[1];
}
