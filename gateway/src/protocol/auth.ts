import { createHmac, randomBytes } from "node:crypto";
import pino from "pino";

const logger = pino({ name: "auth" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AuthContext {
  deviceId: string;
  role: "operator" | "node";
  connectedAt: number;
  token: string;
}

export interface ChallengeData {
  nonce: string;
  timestamp: number;
  expiresAt: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const CHALLENGE_EXPIRY_MS = 30_000; // 30 seconds to respond to challenge
const NONCE_BYTES = 32;

// ─── Token Validation ───────────────────────────────────────────────────────

/**
 * Validate an incoming token against the configured GATEWAY_AUTH_TOKEN.
 * Returns true if the token matches, or if no auth token is configured
 * (development mode).
 */
export function validateToken(token: string): boolean {
  const expectedToken = process.env["GATEWAY_AUTH_TOKEN"];

  if (!expectedToken) {
    logger.warn("GATEWAY_AUTH_TOKEN not set — authentication disabled (development mode)");
    return true;
  }

  if (!token) {
    logger.warn("Empty token provided");
    return false;
  }

  // Constant-time comparison to prevent timing attacks
  const expected = Buffer.from(expectedToken, "utf-8");
  const received = Buffer.from(token, "utf-8");

  if (expected.length !== received.length) {
    logger.warn("Token length mismatch");
    return false;
  }

  const isValid = createHmac("sha256", expected)
    .update("compare")
    .digest()
    .equals(
      createHmac("sha256", received).update("compare").digest()
    );

  if (!isValid) {
    logger.warn("Invalid token provided");
  }

  return isValid;
}

// ─── Challenge-Response ─────────────────────────────────────────────────────

/**
 * Generate a challenge nonce with a timestamp and expiry.
 * The client must respond with an HMAC of the nonce using the shared secret.
 */
export function generateChallenge(): ChallengeData {
  const nonce = randomBytes(NONCE_BYTES).toString("hex");
  const timestamp = Date.now();
  const expiresAt = timestamp + CHALLENGE_EXPIRY_MS;

  logger.debug({ nonce: nonce.slice(0, 8) + "...", expiresAt }, "Generated challenge");

  return { nonce, timestamp, expiresAt };
}

/**
 * Verify a challenge response.
 * The client should compute HMAC-SHA256(nonce, sharedSecret) and send it back.
 */
export function verifyChallenge(response: string, nonce: string): boolean {
  const secret = process.env["GATEWAY_AUTH_TOKEN"];

  if (!secret) {
    logger.warn("GATEWAY_AUTH_TOKEN not set — challenge verification skipped");
    return true;
  }

  const expectedResponse = createHmac("sha256", secret)
    .update(nonce)
    .digest("hex");

  const expected = Buffer.from(expectedResponse, "utf-8");
  const received = Buffer.from(response, "utf-8");

  if (expected.length !== received.length) {
    logger.warn("Challenge response length mismatch");
    return false;
  }

  const isValid = createHmac("sha256", expected)
    .update("verify")
    .digest()
    .equals(
      createHmac("sha256", received).update("verify").digest()
    );

  if (!isValid) {
    logger.warn("Challenge verification failed");
  } else {
    logger.debug("Challenge verified successfully");
  }

  return isValid;
}

/**
 * Create an auth context for a successfully authenticated connection.
 */
export function createAuthContext(
  deviceId: string,
  role: "operator" | "node",
  token: string,
): AuthContext {
  return {
    deviceId,
    role,
    connectedAt: Date.now(),
    token,
  };
}
