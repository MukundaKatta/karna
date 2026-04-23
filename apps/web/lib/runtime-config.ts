const LOCAL_GATEWAY_URL = "http://localhost:4000";
const LOCAL_WS_URL = "ws://localhost:4000/ws";

function isProduction(): boolean {
  return process.env["NODE_ENV"] === "production";
}

function normalizeHttpUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Gateway URL is empty");
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/+$/, "");
  }

  if (/^[a-z0-9.-]+:\d+$/i.test(trimmed)) {
    return `http://${trimmed}`;
  }

  throw new Error(`Gateway URL must start with http:// or https://, received "${trimmed}"`);
}

function normalizeWebSocketUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("WebSocket URL is empty");
  }

  if (/^wss?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/+$/, "");
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed
      .replace(/^http:\/\//i, "ws://")
      .replace(/^https:\/\//i, "wss://")
      .replace(/\/+$/, "");
  }

  throw new Error(`WebSocket URL must start with ws://, wss://, http://, or https://, received "${trimmed}"`);
}

export function resolveServerGatewayUrl(): {
  url: string | null;
  error: string | null;
} {
  const configuredGatewayUrl = process.env["GATEWAY_URL"] ?? process.env["NEXT_PUBLIC_GATEWAY_URL"];
  if (configuredGatewayUrl) {
    try {
      return {
        url: normalizeHttpUrl(configuredGatewayUrl),
        error: null,
      };
    } catch (error) {
      return {
        url: null,
        error: error instanceof Error ? error.message : "Invalid GATEWAY_URL configuration",
      };
    }
  }

  if (!isProduction()) {
    return { url: LOCAL_GATEWAY_URL, error: null };
  }

  return {
    url: null,
    error: "Set GATEWAY_URL or NEXT_PUBLIC_GATEWAY_URL for the hosted web app",
  };
}

export function resolvePublicGatewayUrl(): {
  url: string | null;
  error: string | null;
} {
  const configuredGatewayUrl = process.env["NEXT_PUBLIC_GATEWAY_URL"];
  if (configuredGatewayUrl) {
    try {
      return {
        url: normalizeHttpUrl(configuredGatewayUrl),
        error: null,
      };
    } catch (error) {
      return {
        url: null,
        error: error instanceof Error ? error.message : "Invalid NEXT_PUBLIC_GATEWAY_URL configuration",
      };
    }
  }

  if (!isProduction()) {
    return { url: LOCAL_GATEWAY_URL, error: null };
  }

  return {
    url: null,
    error: "Set NEXT_PUBLIC_GATEWAY_URL for browser access to the gateway",
  };
}

export function resolvePublicWebSocketUrl(): {
  url: string | null;
  error: string | null;
} {
  const configuredWsUrl = process.env["NEXT_PUBLIC_WS_URL"];
  if (configuredWsUrl) {
    try {
      return {
        url: normalizeWebSocketUrl(configuredWsUrl),
        error: null,
      };
    } catch (error) {
      return {
        url: null,
        error: error instanceof Error ? error.message : "Invalid NEXT_PUBLIC_WS_URL configuration",
      };
    }
  }

  const gatewayUrl = resolvePublicGatewayUrl();
  if (gatewayUrl.url) {
    try {
      const derivedUrl = normalizeWebSocketUrl(`${gatewayUrl.url}/ws`);
      return { url: derivedUrl, error: null };
    } catch (error) {
      return {
        url: null,
        error: error instanceof Error ? error.message : "Failed to derive NEXT_PUBLIC_WS_URL",
      };
    }
  }

  if (!isProduction()) {
    return { url: LOCAL_WS_URL, error: null };
  }

  return {
    url: null,
    error: gatewayUrl.error ?? "Set NEXT_PUBLIC_WS_URL or NEXT_PUBLIC_GATEWAY_URL for browser websocket access",
  };
}
