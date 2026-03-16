import { createHmac, timingSafeEqual } from "node:crypto";
import { nanoid, customAlphabet } from "nanoid";

// ─── Token Generation ────────────────────────────────────────────────────────

/**
 * Generate a cryptographically random token using nanoid.
 *
 * @param size - Length of the token (default: 32)
 * @returns A URL-safe random token
 */
export function generateToken(size = 32): string {
  return nanoid(size);
}

/**
 * Generate a session ID with a `ses_` prefix.
 *
 * @param size - Length of the random portion (default: 24)
 * @returns A prefixed session ID (e.g., `ses_V1StGXR8_Z5jdHi6B-myT`)
 */
export function generateSessionId(size = 24): string {
  return `ses_${nanoid(size)}`;
}

/**
 * Generate a message ID with a `msg_` prefix.
 *
 * @param size - Length of the random portion (default: 21)
 * @returns A prefixed message ID
 */
export function generateMessageId(size = 21): string {
  return `msg_${nanoid(size)}`;
}

/**
 * Generate a numeric-only code (useful for verification challenges).
 *
 * @param length - Number of digits (default: 6)
 * @returns A numeric string (e.g., `847293`)
 */
export function generateNumericCode(length = 6): string {
  const generator = customAlphabet("0123456789", length);
  return generator();
}

/**
 * Generate a challenge token for WebSocket authentication.
 *
 * @param size - Length of the challenge (default: 48)
 * @returns A URL-safe random challenge string
 */
export function generateChallenge(size = 48): string {
  return nanoid(size);
}

// ─── HMAC Signing ────────────────────────────────────────────────────────────

/**
 * Create an HMAC-SHA256 signature for the given payload.
 *
 * @param payload - The string payload to sign
 * @param secret - The secret key for HMAC
 * @returns A hex-encoded HMAC signature
 */
export function hmacSign(payload: string, secret: string): string {
  if (!secret) {
    throw new Error("HMAC secret must not be empty");
  }
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

/**
 * Verify an HMAC-SHA256 signature in constant time.
 *
 * @param payload - The original string payload
 * @param signature - The hex-encoded signature to verify
 * @param secret - The secret key for HMAC
 * @returns `true` if the signature is valid
 */
export function hmacVerify(payload: string, signature: string, secret: string): boolean {
  if (!secret) {
    throw new Error("HMAC secret must not be empty");
  }
  const expected = hmacSign(payload, secret);

  // Ensure both buffers have the same length for timing-safe comparison
  const sigBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  if (sigBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(sigBuffer, expectedBuffer);
}

/**
 * Sign a JSON-serializable object by creating a signature over its JSON representation.
 *
 * @param data - The data to sign
 * @param secret - The HMAC secret
 * @returns A hex-encoded signature
 */
export function signPayload(data: unknown, secret: string): string {
  const payload = JSON.stringify(data);
  return hmacSign(payload, secret);
}

/**
 * Verify the signature of a JSON-serializable object.
 *
 * @param data - The original data
 * @param signature - The signature to verify
 * @param secret - The HMAC secret
 * @returns `true` if the signature matches
 */
export function verifyPayload(data: unknown, signature: string, secret: string): boolean {
  const payload = JSON.stringify(data);
  return hmacVerify(payload, signature, secret);
}
