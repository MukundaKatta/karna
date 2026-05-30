import { describe, it, expect } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import {
  canonicalize,
  signManifest,
  attachSignature,
  verifyManifest,
  verifySignedManifest,
  checkTrust,
  verifyAndTrust,
} from "../../packages/plugin-sdk/src/signing.js";

const manifest = {
  name: "weather-plugin",
  version: "1.0.0",
  tools: ["get_weather", "get_forecast"],
  meta: { nested: { b: 2, a: 1 } },
};

describe("plugin-sdk signing", () => {
  it("canonicalizes deterministically regardless of key order", () => {
    const a = canonicalize({ b: 1, a: 2, c: { y: 1, x: 2 } });
    const b = canonicalize({ c: { x: 2, y: 1 }, a: 2, b: 1 });
    expect(a).toBe(b);
  });

  it("excludes the signature field from canonical form", () => {
    const withSig = { name: "x", signature: { algorithm: "ed25519" } };
    expect(canonicalize(withSig)).toBe(canonicalize({ name: "x" }));
  });

  describe("hmac-sha256", () => {
    const secret = "super-secret-shared-key";

    it("round-trips a valid signature", () => {
      const sig = signManifest(manifest, {
        algorithm: "hmac-sha256",
        keyId: "team-hmac",
        key: secret,
      });
      expect(sig.algorithm).toBe("hmac-sha256");
      expect(verifyManifest(manifest, sig, { key: secret })).toBe(true);
    });

    it("detects tampering with the manifest", () => {
      const sig = signManifest(manifest, {
        algorithm: "hmac-sha256",
        keyId: "team-hmac",
        key: secret,
      });
      const tampered = { ...manifest, tools: ["get_weather", "rm_rf"] };
      expect(verifyManifest(tampered, sig, { key: secret })).toBe(false);
    });

    it("fails with the wrong secret", () => {
      const sig = signManifest(manifest, {
        algorithm: "hmac-sha256",
        keyId: "team-hmac",
        key: secret,
      });
      expect(verifyManifest(manifest, sig, { key: "wrong-secret" })).toBe(false);
    });

    it("verifies a manifest carrying its own signature", () => {
      const sig = signManifest(manifest, {
        algorithm: "hmac-sha256",
        keyId: "team-hmac",
        key: secret,
      });
      const signed = attachSignature(manifest, sig);
      expect(verifySignedManifest(signed, { key: secret })).toBe(true);
    });
  });

  describe("ed25519", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");

    it("round-trips and detects tampering", () => {
      const sig = signManifest(manifest, {
        algorithm: "ed25519",
        keyId: "publisher-1",
        key: privateKey,
      });
      expect(verifyManifest(manifest, sig, { key: publicKey })).toBe(true);

      const tampered = { ...manifest, version: "9.9.9" };
      expect(verifyManifest(tampered, sig, { key: publicKey })).toBe(false);
    });

    it("fails verification with a different public key", () => {
      const sig = signManifest(manifest, {
        algorithm: "ed25519",
        keyId: "publisher-1",
        key: privateKey,
      });
      const other = generateKeyPairSync("ed25519");
      expect(verifyManifest(manifest, sig, { key: other.publicKey })).toBe(false);
    });
  });

  describe("trust policy", () => {
    const sig = signManifest(manifest, {
      algorithm: "hmac-sha256",
      keyId: "trusted-id",
      key: "k",
      signedAt: "2026-05-30T00:00:00.000Z",
    });

    it("trusts allowed keyId and algorithm", () => {
      const res = checkTrust(sig, {
        trustedKeyIds: ["trusted-id"],
        allowedAlgorithms: ["hmac-sha256"],
      });
      expect(res.trusted).toBe(true);
      expect(res.reasons).toEqual([]);
    });

    it("rejects untrusted keyId", () => {
      const res = checkTrust(sig, { trustedKeyIds: ["someone-else"] });
      expect(res.trusted).toBe(false);
      expect(res.reasons[0]).toContain("not trusted");
    });

    it("rejects disallowed algorithm", () => {
      const res = checkTrust(sig, { allowedAlgorithms: ["ed25519"] });
      expect(res.trusted).toBe(false);
      expect(res.reasons[0]).toContain("not in the allowed set");
    });

    it("rejects stale signatures via maxAgeMs", () => {
      const now = Date.parse("2026-05-30T00:00:00.000Z") + 10_000;
      const res = checkTrust(sig, { maxAgeMs: 5_000 }, now);
      expect(res.trusted).toBe(false);
      expect(res.reasons[0]).toContain("older than");
    });

    it("verifyAndTrust combines crypto + policy", () => {
      const ok = verifyAndTrust(manifest, sig, {
        key: "k",
        policy: { trustedKeyIds: ["trusted-id"] },
        now: Date.parse("2026-05-30T00:00:00.000Z"),
      });
      expect(ok.trusted).toBe(true);

      const badCrypto = verifyAndTrust(manifest, sig, { key: "wrong" });
      expect(badCrypto.trusted).toBe(false);
      expect(badCrypto.reasons[0]).toContain("verification failed");
    });
  });
});
