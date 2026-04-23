import type { BrowserRuntimeConfig } from "./runtime-config";

let runtimeConfigCache: BrowserRuntimeConfig | null = null;
let runtimeConfigRequest: Promise<BrowserRuntimeConfig> | null = null;

function normalizeRuntimeConfig(payload: unknown): BrowserRuntimeConfig {
  if (!payload || typeof payload !== "object") {
    return {
      gatewayUrl: null,
      webSocketUrl: null,
      error: "Browser runtime configuration is unavailable",
    };
  }

  const config = payload as Record<string, unknown>;

  return {
    gatewayUrl: typeof config.gatewayUrl === "string" ? config.gatewayUrl : null,
    webSocketUrl: typeof config.webSocketUrl === "string" ? config.webSocketUrl : null,
    error: typeof config.error === "string" ? config.error : null,
  };
}

export async function getBrowserRuntimeConfig(): Promise<BrowserRuntimeConfig> {
  if (runtimeConfigCache) {
    return runtimeConfigCache;
  }

  if (typeof window === "undefined") {
    return {
      gatewayUrl: null,
      webSocketUrl: null,
      error: "Browser runtime configuration is only available in the browser",
    };
  }

  if (!runtimeConfigRequest) {
    runtimeConfigRequest = fetch("/api/runtime-config", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response
          .json()
          .catch(() => ({ error: "Failed to parse browser runtime configuration" }));

        const nextConfig = normalizeRuntimeConfig(payload);
        runtimeConfigCache = nextConfig;
        return nextConfig;
      })
      .catch(() => {
        const nextConfig: BrowserRuntimeConfig = {
          gatewayUrl: null,
          webSocketUrl: null,
          error: "Failed to load browser runtime configuration",
        };
        runtimeConfigCache = nextConfig;
        return nextConfig;
      })
      .finally(() => {
        runtimeConfigRequest = null;
      });
  }

  return runtimeConfigRequest;
}

export function clearBrowserRuntimeConfigForTesting(): void {
  runtimeConfigCache = null;
  runtimeConfigRequest = null;
}
