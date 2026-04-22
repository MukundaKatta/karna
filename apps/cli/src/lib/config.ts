import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { safeParseKarnaConfig, type KarnaConfig } from "@karna/shared";

export interface LoadedCliConfig {
  path: string;
  exists: boolean;
  config: KarnaConfig | null;
  parseError?: string;
  validationErrors: string[];
}

export function getConfigPath(): string {
  return process.env["KARNA_CONFIG"] ?? join(homedir(), ".karna", "karna.json");
}

export async function loadConfig(): Promise<KarnaConfig | null> {
  const loaded = await loadConfigWithStatus();
  return loaded.config;
}

export async function loadConfigWithStatus(): Promise<LoadedCliConfig> {
  const configPath = getConfigPath();

  try {
    const raw = await readFile(configPath, "utf-8");
    let parsedJson: unknown;

    try {
      parsedJson = JSON.parse(raw);
    } catch (error) {
      return {
        path: configPath,
        exists: true,
        config: null,
        parseError: error instanceof Error ? error.message : String(error),
        validationErrors: [],
      };
    }

    const parsed = safeParseKarnaConfig(parsedJson);
    if (!parsed.success) {
      return {
        path: configPath,
        exists: true,
        config: null,
        validationErrors: parsed.error.issues.slice(0, 5).map((issue) =>
          `${issue.path.join(".") || "(root)"}: ${issue.message}`,
        ),
      };
    }

    return {
      path: configPath,
      exists: true,
      config: parsed.data,
      validationErrors: [],
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return {
        path: configPath,
        exists: false,
        config: null,
        validationErrors: [],
      };
    }

    return {
      path: configPath,
      exists: true,
      config: null,
      parseError: err.message,
      validationErrors: [],
    };
  }
}

export async function resolveGatewayPort(override?: string): Promise<string> {
  if (override) {
    return override;
  }

  if (process.env["GATEWAY_PORT"]) {
    return process.env["GATEWAY_PORT"];
  }

  const config = await loadConfig();
  return String(config?.gateway.port ?? 3000);
}

export async function resolveGatewayHttpUrl(override?: string): Promise<string> {
  if (override) {
    return override;
  }

  const config = await loadConfig();
  return `http://${resolveGatewayHost(config)}:${await resolveGatewayPort()}`;
}

export async function resolveGatewayWsUrl(override?: string): Promise<string> {
  if (override) {
    return override;
  }

  const config = await loadConfig();
  const host = resolveGatewayHost(config);
  const port = await resolveGatewayPort();
  const path = config?.gateway.websocket?.path ?? "/ws";
  return `ws://${host}:${port}${path}`;
}

function resolveGatewayHost(config: KarnaConfig | null): string {
  const host = process.env["GATEWAY_HOST"] ?? config?.gateway.host ?? "localhost";
  if (host === "0.0.0.0" || host === "::" || host === "[::]") {
    return "localhost";
  }
  return host;
}
