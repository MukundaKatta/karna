import type { KarnaConfig } from "./schema.js";

function parsePositivePort(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function resolveGatewayHost(config: KarnaConfig): string {
  return process.env["GATEWAY_HOST"] ?? config.gateway.host;
}

export function resolveGatewayPort(config: KarnaConfig): number {
  return (
    parsePositivePort(process.env["GATEWAY_PORT"])
    ?? parsePositivePort(process.env["PORT"])
    ?? config.gateway.port
  );
}

export function hasGatewayPortOverride(): boolean {
  return Boolean(process.env["GATEWAY_PORT"] || process.env["PORT"]);
}

export function resolveGatewayCorsOrigins(config: KarnaConfig): string[] {
  const rawOrigins = process.env["GATEWAY_CORS_ORIGINS"] ?? process.env["CORS_ORIGINS"];
  const envOrigins = rawOrigins?.split(",").map((origin) => origin.trim()).filter(Boolean);
  if (envOrigins?.length) {
    return envOrigins;
  }

  if (config.gateway.cors.origins.length > 0) {
    return config.gateway.cors.origins;
  }

  return ["http://localhost:3000", "http://localhost:5173"];
}

export function hasGatewayCorsOverride(): boolean {
  return Boolean(process.env["GATEWAY_CORS_ORIGINS"] || process.env["CORS_ORIGINS"]);
}
