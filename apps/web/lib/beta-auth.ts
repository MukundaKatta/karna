const SESSION_VERSION = 1;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const BETA_SESSION_COOKIE_NAME = "karna_beta_session";

function getEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function encodePayload(payload: Record<string, number>): string {
  return bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
}

function decodePayload(payload: string): { iat: number; v: number } | null {
  try {
    const parsed = JSON.parse(decoder.decode(base64UrlToBytes(payload))) as {
      iat?: number;
      v?: number;
    };

    if (typeof parsed.iat !== "number" || typeof parsed.v !== "number") {
      return null;
    }

    return { iat: parsed.iat, v: parsed.v };
  } catch {
    return null;
  }
}

async function importSigningKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

async function signValue(value: string, secret: string): Promise<string> {
  const key = await importSigningKey(secret, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

async function verifySignature(value: string, signature: string, secret: string): Promise<boolean> {
  const key = await importSigningKey(secret, ["verify"]);
  return crypto.subtle.verify(
    "HMAC",
    key,
    bytesToArrayBuffer(base64UrlToBytes(signature)),
    encoder.encode(value),
  );
}

export function getBetaAccessCode(): string | null {
  return getEnv("KARNA_BETA_ACCESS_CODE");
}

export function getBetaSessionSecret(): string | null {
  return getEnv("KARNA_WEB_SESSION_SECRET") ?? getBetaAccessCode();
}

export function isBetaAuthEnabled(): boolean {
  return Boolean(getBetaAccessCode());
}

export function validateBetaAccessCode(accessCode: string): boolean {
  const expected = getBetaAccessCode();
  return Boolean(expected && accessCode.trim() === expected);
}

export async function createBetaSessionToken(issuedAt = Date.now()): Promise<string | null> {
  const secret = getBetaSessionSecret();
  if (!secret) {
    return null;
  }

  const payload = encodePayload({ iat: issuedAt, v: SESSION_VERSION });
  const signature = await signValue(payload, secret);
  return `${payload}.${signature}`;
}

export async function verifyBetaSessionToken(token: string | null | undefined): Promise<boolean> {
  const secret = getBetaSessionSecret();
  if (!secret || !token) {
    return false;
  }

  const [payload, signature] = token.split(".");
  if (!payload || !signature) {
    return false;
  }

  const verified = await verifySignature(payload, signature, secret);
  if (!verified) {
    return false;
  }

  const parsed = decodePayload(payload);
  if (!parsed || parsed.v !== SESSION_VERSION) {
    return false;
  }

  const ageMs = Date.now() - parsed.iat;
  return ageMs >= 0 && ageMs <= SESSION_TTL_MS;
}

export function getBetaSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env["NODE_ENV"] === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}
