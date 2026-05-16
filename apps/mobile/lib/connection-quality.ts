export type ConnectionQualityLevel = "unknown" | "good" | "slow" | "poor";
export type MobileNetworkType = "unknown" | "wifi" | "cellular" | "offline";

export interface ConnectionQuality {
  latencyMs: number | null;
  level: ConnectionQualityLevel;
  reconnectAttempts: number;
  networkType: MobileNetworkType;
  compactMode: boolean;
}

export function classifyLatency(latencyMs: number | null): ConnectionQualityLevel {
  if (latencyMs === null) return "unknown";
  if (latencyMs < 100) return "good";
  if (latencyMs < 500) return "slow";
  return "poor";
}

export function shouldUseCompactMode(params: {
  latencyMs: number | null;
  reconnectAttempts: number;
  networkType: MobileNetworkType;
}): boolean {
  return (
    params.networkType === "offline" ||
    params.reconnectAttempts > 0 ||
    classifyLatency(params.latencyMs) === "slow" ||
    classifyLatency(params.latencyMs) === "poor"
  );
}

export function buildConnectionQuality(params: {
  latencyMs?: number | null;
  reconnectAttempts?: number;
  networkType?: MobileNetworkType;
}): ConnectionQuality {
  const latencyMs = params.latencyMs ?? null;
  const reconnectAttempts = params.reconnectAttempts ?? 0;
  const networkType = params.networkType ?? "unknown";
  return {
    latencyMs,
    reconnectAttempts,
    networkType,
    level: classifyLatency(latencyMs),
    compactMode: shouldUseCompactMode({
      latencyMs,
      reconnectAttempts,
      networkType,
    }),
  };
}

export function formatNetworkType(type: MobileNetworkType): string {
  switch (type) {
    case "wifi":
      return "WiFi";
    case "cellular":
      return "Cellular";
    case "offline":
      return "Offline";
    default:
      return "Network unknown";
  }
}
