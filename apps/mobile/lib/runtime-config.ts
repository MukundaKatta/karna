import Constants from "expo-constants";

const LOCAL_GATEWAY_HTTP_URL = "http://localhost:4000";
const LOCAL_GATEWAY_WS_URL = "ws://localhost:4000/ws";
const LEGACY_LOCAL_GATEWAY_WS_URL = "ws://localhost:3100";
const DEFAULT_HOSTED_GATEWAY_HTTP_URL = "https://karna-gateway.onrender.com";
const DEFAULT_HOSTED_GATEWAY_WS_URL = "wss://karna-gateway.onrender.com/ws";

type MobileGatewayExtra = {
  gatewayUrl?: string;
  webSocketUrl?: string;
  supportUrl?: string;
  privacyUrl?: string;
  marketingUrl?: string;
};

function getMobileGatewayExtra(): MobileGatewayExtra {
  const expoExtra = (Constants.expoConfig?.extra ?? {}) as {
    mobileGateway?: MobileGatewayExtra;
  };

  return expoExtra.mobileGateway ?? {};
}

export function normalizeMobileGatewayWsUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Gateway URL is empty");
  }

  if (/^[a-z0-9.-]+:\d+$/i.test(trimmed)) {
    return `ws://${trimmed}/ws`;
  }

  if (!/^(https?|wss?):\/\//i.test(trimmed)) {
    throw new Error(
      `Gateway URL must start with ws://, wss://, http://, or https://, received "${trimmed}"`,
    );
  }

  const parsed = new URL(trimmed);
  const protocol =
    parsed.protocol === "https:"
      ? "wss:"
      : parsed.protocol === "http:"
        ? "ws:"
        : parsed.protocol;
  const path = parsed.pathname === "/" ? "/ws" : parsed.pathname.replace(/\/+$/, "");

  parsed.protocol = protocol;
  parsed.pathname = path || "/ws";
  parsed.hash = "";

  return parsed.toString().replace(/\/+$/, "");
}

export function deriveMobileGatewayHealthUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Gateway URL is empty");
  }

  if (/^[a-z0-9.-]+:\d+$/i.test(trimmed)) {
    return `http://${trimmed}/health`;
  }

  if (!/^(https?|wss?):\/\//i.test(trimmed)) {
    throw new Error(
      `Gateway URL must start with ws://, wss://, http://, or https://, received "${trimmed}"`,
    );
  }

  const parsed = new URL(trimmed);
  parsed.protocol =
    parsed.protocol === "wss:"
      ? "https:"
      : parsed.protocol === "ws:"
        ? "http:"
        : parsed.protocol;
  parsed.pathname = "/health";
  parsed.search = "";
  parsed.hash = "";

  return parsed.toString();
}

export function isLegacyLocalGatewayUrl(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return value.trim() === LEGACY_LOCAL_GATEWAY_WS_URL;
}

export function resolveDefaultMobileGatewayHttpUrl(options?: { dev?: boolean }): string {
  const extra = getMobileGatewayExtra();
  if (options?.dev ?? __DEV__) {
    return LOCAL_GATEWAY_HTTP_URL;
  }

  return extra.gatewayUrl?.trim() || DEFAULT_HOSTED_GATEWAY_HTTP_URL;
}

export function resolveDefaultMobileGatewayWsUrl(options?: { dev?: boolean }): string {
  const extra = getMobileGatewayExtra();
  if (options?.dev ?? __DEV__) {
    return LOCAL_GATEWAY_WS_URL;
  }

  return extra.webSocketUrl?.trim() || DEFAULT_HOSTED_GATEWAY_WS_URL;
}

export function resolveDefaultMobileGatewayHealthUrl(options?: { dev?: boolean }): string {
  return deriveMobileGatewayHealthUrl(resolveDefaultMobileGatewayWsUrl(options));
}
