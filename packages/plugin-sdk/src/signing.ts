// ─── Signed Plugin Verification ──────────────────────────────────────────────
//
// Issue #564 — Sign and verify a plugin manifest using node:crypto only (no new
// dependencies). Supports two algorithms:
//   - "hmac-sha256" — symmetric, shared-secret signing.
//   - "ed25519"     — asymmetric, public-key signing (recommended for distribution).
//
// Manifests are canonicalized (deterministic key ordering) before signing so
// that signatures are stable regardless of property order.
//
// ─────────────────────────────────────────────────────────────────────────────

import {
  createHmac,
  timingSafeEqual,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from "node:crypto";

// ─── Types ──────────────────────────────────────────────────────────────────

export type SignatureAlgorithm = "hmac-sha256" | "ed25519";

/**
 * A detached signature over a manifest.
 */
export interface PluginSignature {
  /** Algorithm used to produce the signature. */
  algorithm: SignatureAlgorithm;
  /** Base64-encoded signature bytes. */
  signature: string;
  /**
   * Identifier of the signing key (e.g. a key fingerprint or publisher id).
   * Used by trust policies to look up the expected key.
   */
  keyId: string;
  /** ISO timestamp when the signature was produced. */
  signedAt: string;
}

/**
 * A manifest is any JSON-serializable object. We never sign the `signature`
 * field itself (it is stripped during canonicalization).
 */
export type Manifest = Record<string, unknown>;

export interface SignOptions {
  algorithm: SignatureAlgorithm;
  keyId: string;
  /**
   * For "hmac-sha256": the shared secret (string or Buffer).
   * For "ed25519": a private KeyObject (or PEM string / Buffer).
   */
  key: string | Buffer | KeyObject;
  /** Override the signedAt timestamp (mainly for deterministic tests). */
  signedAt?: string;
}

export interface VerifyOptions {
  algorithm?: SignatureAlgorithm;
  /**
   * For "hmac-sha256": the shared secret.
   * For "ed25519": the public KeyObject (or PEM string / Buffer).
   */
  key: string | Buffer | KeyObject;
}

/**
 * Trust policy: which key ids are trusted for which algorithms.
 */
export interface TrustPolicy {
  /** Allowed key ids. If empty/undefined, any keyId is allowed. */
  trustedKeyIds?: string[];
  /** Allowed algorithms. Defaults to both supported algorithms. */
  allowedAlgorithms?: SignatureAlgorithm[];
  /** Reject signatures older than this many milliseconds. Optional. */
  maxAgeMs?: number;
}

export interface TrustCheckResult {
  trusted: boolean;
  reasons: string[];
}

// ─── Canonicalization ──────────────────────────────────────────────────────────

/**
 * Produce a deterministic JSON string for a manifest by recursively sorting
 * object keys. The reserved `signature` field is excluded so that a manifest
 * can carry its own detached signature without affecting verification.
 */
export function canonicalize(manifest: Manifest): string {
  const stripped: Manifest = { ...manifest };
  delete stripped.signature;
  return stableStringify(stripped);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries = keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k]));
  return "{" + entries.join(",") + "}";
}

// ─── Signing ──────────────────────────────────────────────────────────────────

/**
 * Produce a detached signature over the canonical form of a manifest.
 */
export function signManifest(manifest: Manifest, options: SignOptions): PluginSignature {
  const payload = Buffer.from(canonicalize(manifest), "utf8");
  const signedAt = options.signedAt ?? new Date().toISOString();

  let signature: string;
  if (options.algorithm === "hmac-sha256") {
    const secret = toBufferOrString(options.key);
    signature = createHmac("sha256", secret).update(payload).digest("base64");
  } else if (options.algorithm === "ed25519") {
    // For ed25519, the digest algorithm argument to sign() must be null.
    const sig = cryptoSign(null, payload, options.key as KeyObject | string | Buffer);
    signature = sig.toString("base64");
  } else {
    throw new Error(`Unsupported signature algorithm: ${String(options.algorithm)}`);
  }

  return {
    algorithm: options.algorithm,
    signature,
    keyId: options.keyId,
    signedAt,
  };
}

/**
 * Attach (or replace) a detached signature on a manifest, returning a copy.
 */
export function attachSignature(manifest: Manifest, signature: PluginSignature): Manifest {
  return { ...manifest, signature };
}

// ─── Verification ───────────────────────────────────────────────────────────

/**
 * Verify a detached signature against a manifest. Returns true if valid.
 * Uses constant-time comparison for HMAC.
 */
export function verifyManifest(
  manifest: Manifest,
  signature: PluginSignature,
  options: VerifyOptions,
): boolean {
  const algorithm = options.algorithm ?? signature.algorithm;
  if (algorithm !== signature.algorithm) {
    // Algorithm mismatch between expected and provided signature.
    return false;
  }
  const payload = Buffer.from(canonicalize(manifest), "utf8");

  try {
    if (algorithm === "hmac-sha256") {
      const secret = toBufferOrString(options.key);
      const expected = createHmac("sha256", secret).update(payload).digest();
      let provided: Buffer;
      try {
        provided = Buffer.from(signature.signature, "base64");
      } catch {
        return false;
      }
      if (provided.length !== expected.length) return false;
      return timingSafeEqual(provided, expected);
    }
    if (algorithm === "ed25519") {
      const sig = Buffer.from(signature.signature, "base64");
      return cryptoVerify(null, payload, options.key as KeyObject | string | Buffer, sig);
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Verify a manifest that carries its own `signature` field.
 */
export function verifySignedManifest(manifest: Manifest, options: VerifyOptions): boolean {
  const sig = manifest.signature as PluginSignature | undefined;
  if (!sig || typeof sig !== "object") return false;
  return verifyManifest(manifest, sig, options);
}

// ─── Trust policy ───────────────────────────────────────────────────────────

const ALL_ALGORITHMS: SignatureAlgorithm[] = ["hmac-sha256", "ed25519"];

/**
 * Evaluate a signature against a trust policy. This is independent of
 * cryptographic verification — callers should typically require BOTH a valid
 * signature (via {@link verifyManifest}) AND a passing trust check.
 */
export function checkTrust(
  signature: PluginSignature,
  policy: TrustPolicy = {},
  now: number = Date.now(),
): TrustCheckResult {
  const reasons: string[] = [];
  const allowedAlgorithms = policy.allowedAlgorithms ?? ALL_ALGORITHMS;

  if (!allowedAlgorithms.includes(signature.algorithm)) {
    reasons.push(`algorithm "${signature.algorithm}" is not in the allowed set`);
  }

  if (policy.trustedKeyIds && policy.trustedKeyIds.length > 0) {
    if (!policy.trustedKeyIds.includes(signature.keyId)) {
      reasons.push(`keyId "${signature.keyId}" is not trusted`);
    }
  }

  if (policy.maxAgeMs !== undefined) {
    const signedAtMs = Date.parse(signature.signedAt);
    if (Number.isNaN(signedAtMs)) {
      reasons.push(`signedAt "${signature.signedAt}" is not a valid timestamp`);
    } else if (now - signedAtMs > policy.maxAgeMs) {
      reasons.push(`signature is older than the allowed max age (${policy.maxAgeMs}ms)`);
    }
  }

  return { trusted: reasons.length === 0, reasons };
}

/**
 * Convenience: verify cryptographic validity AND trust policy in one call.
 */
export function verifyAndTrust(
  manifest: Manifest,
  signature: PluginSignature,
  options: VerifyOptions & { policy?: TrustPolicy; now?: number },
): TrustCheckResult {
  const cryptoOk = verifyManifest(manifest, signature, options);
  if (!cryptoOk) {
    return { trusted: false, reasons: ["cryptographic signature verification failed"] };
  }
  return checkTrust(signature, options.policy ?? {}, options.now);
}

// ─── Internal ───────────────────────────────────────────────────────────────

function toBufferOrString(key: string | Buffer | KeyObject): string | Buffer {
  if (typeof key === "string" || Buffer.isBuffer(key)) return key;
  // KeyObject for HMAC — extract symmetric key bytes.
  return key.export() as Buffer;
}
