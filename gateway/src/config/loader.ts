import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { KarnaConfigSchema, type KarnaConfig } from "./schema.js";

const logger = pino({ name: "config-loader" });

/**
 * Resolve the path to the Karna config file.
 * Checks KARNA_CONFIG env var first, then defaults to ~/.karna/karna.json.
 */
export function getConfigPath(): string {
  return process.env["KARNA_CONFIG"] ?? join(homedir(), ".karna", "karna.json");
}

/**
 * Load and validate the Karna configuration.
 * Falls back to defaults if the config file does not exist.
 */
export async function loadConfig(): Promise<KarnaConfig> {
  const configPath = getConfigPath();

  let rawData: unknown = {};

  try {
    const contents = await readFile(configPath, "utf-8");
    rawData = JSON.parse(contents);
    logger.info({ configPath }, "Loaded config file");
  } catch (error: unknown) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      logger.info(
        { configPath },
        "Config file not found, using defaults"
      );
    } else if (err instanceof SyntaxError) {
      logger.error({ configPath, error: err.message }, "Invalid JSON in config file, using defaults");
    } else {
      logger.error(
        { configPath, error: String(err) },
        "Failed to read config file, using defaults"
      );
    }
  }

  const result = KarnaConfigSchema.safeParse(rawData);

  if (!result.success) {
    logger.error(
      { errors: result.error.flatten() },
      "Config validation failed, using defaults"
    );
    return KarnaConfigSchema.parse({});
  }

  return result.data;
}
