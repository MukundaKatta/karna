import { z } from "zod";
import pino from "pino";

const logger = pino({ name: "env-validation" });

// ─── Environment Schemas ──────────────────────────────────────────────────────

const ProductionEnvSchema = z.object({
  GATEWAY_AUTH_TOKEN: z.string().min(16, "GATEWAY_AUTH_TOKEN must be at least 16 characters"),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
}).refine(
  (env) => env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY,
  { message: "At least one model API key is required (ANTHROPIC_API_KEY or OPENAI_API_KEY)" },
);

const CloudProductionEnvSchema = z.object({
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_KEY: z.string().min(1).optional(),
});

// ─── Types ──────────────────────────────────────────────────────────────────

export type ValidationMode = "development" | "production" | "test";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ─── Validators ─────────────────────────────────────────────────────────────

/**
 * Validate required environment variables for the gateway.
 * In production, enforces strict requirements. In development, only warns.
 */
export function validateGatewayEnv(mode?: ValidationMode): ValidationResult {
  const envMode = mode ?? (process.env["NODE_ENV"] as ValidationMode) ?? "development";
  const result: ValidationResult = { valid: true, errors: [], warnings: [] };

  if (envMode === "test") return result;

  // In production, use strict Zod schema validation
  if (envMode === "production") {
    const parsed = ProductionEnvSchema.safeParse({
      GATEWAY_AUTH_TOKEN: process.env["GATEWAY_AUTH_TOKEN"],
      ANTHROPIC_API_KEY: process.env["ANTHROPIC_API_KEY"],
      OPENAI_API_KEY: process.env["OPENAI_API_KEY"],
    });

    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        result.errors.push(issue.message);
      }
      result.valid = false;
    }
  } else {
    // Development: warn but don't fail
    if (!process.env["ANTHROPIC_API_KEY"] && !process.env["OPENAI_API_KEY"]) {
      result.warnings.push("No model API key configured (ANTHROPIC_API_KEY or OPENAI_API_KEY)");
    }

    if (!process.env["GATEWAY_AUTH_TOKEN"]) {
      result.warnings.push("GATEWAY_AUTH_TOKEN not set — authentication is disabled");
    }
  }

  // Log results
  for (const warning of result.warnings) {
    logger.warn(warning);
  }
  for (const error of result.errors) {
    logger.error(error);
  }

  if (!result.valid) {
    logger.fatal(
      { errors: result.errors },
      "Environment validation failed — refusing to start in production with missing configuration",
    );
  }

  return result;
}

/**
 * Validate required environment variables for the cloud API.
 */
export function validateCloudEnv(mode?: ValidationMode): ValidationResult {
  const envMode = mode ?? (process.env["NODE_ENV"] as ValidationMode) ?? "development";
  const result: ValidationResult = { valid: true, errors: [], warnings: [] };

  if (envMode === "test") return result;

  // Check JWT secret
  const jwtSecret = process.env["JWT_SECRET"];
  if (!jwtSecret || jwtSecret.length < 32) {
    const msg = "JWT_SECRET not set or too short (minimum 32 characters)";
    if (envMode === "production") {
      result.errors.push(msg);
      result.valid = false;
    } else {
      result.warnings.push(msg);
    }
  }

  // Check Supabase configuration
  if (!process.env["SUPABASE_URL"]) {
    result.warnings.push("SUPABASE_URL not set — database features will be unavailable");
  }

  // Log results
  for (const warning of result.warnings) {
    logger.warn(warning);
  }
  for (const error of result.errors) {
    logger.error(error);
  }

  if (!result.valid) {
    logger.fatal(
      { errors: result.errors },
      "Cloud API environment validation failed",
    );
  }

  return result;
}
