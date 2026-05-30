import { describe, it, expect } from "vitest";
import {
  ExfilGuard,
  scanForExfil,
} from "../../agent/src/tools/security/exfil.js";

describe("data exfiltration guardrails (#565)", () => {
  it("does not flag clean payloads", () => {
    const r = scanForExfil({ message: "the build finished successfully" });
    expect(r.flagged).toBe(false);
    expect(r.findings).toEqual([]);
  });

  describe("secret patterns", () => {
    it("detects an embedded API key in a nested arg", () => {
      const r = scanForExfil({ headers: { auth: "sk-ant-api03-AbCdEf0123456789ZZZ" } });
      expect(r.flagged).toBe(true);
      const f = r.findings[0]!;
      expect(f.category).toBe("secret");
      expect(f.path).toBe("headers.auth");
    });

    it("detects a known exact secret value", () => {
      const r = scanForExfil({ body: "token is hunter2supersecret here" }, { knownValues: ["hunter2supersecret"] });
      expect(r.findings.some((f) => f.kind === "known_secret")).toBe(true);
    });
  });

  describe("PII patterns", () => {
    it("detects emails, SSNs and credit cards", () => {
      const r = scanForExfil({
        a: "contact me at jane.doe@example.com",
        b: "ssn 123-45-6789",
        c: "card 4111 1111 1111 1111",
      });
      const kinds = new Set(r.findings.map((f) => f.kind));
      expect(kinds.has("email")).toBe(true);
      expect(kinds.has("ssn")).toBe(true);
      expect(kinds.has("credit_card")).toBe(true);
    });

    it("can restrict to specific detectors via `only`", () => {
      const r = scanForExfil({ a: "jane@example.com", b: "ssn 123-45-6789" }, { only: ["email"] });
      const kinds = new Set(r.findings.map((f) => f.kind));
      expect(kinds.has("email")).toBe(true);
      expect(kinds.has("ssn")).toBe(false);
    });
  });

  describe("actions", () => {
    const payload = { msg: "key sk-ant-api03-AbCdEf0123456789ZZZ and mail a@b.com" };

    it("allow: flags but returns original payload, not blocked", () => {
      const r = scanForExfil(payload, { action: "allow" });
      expect(r.flagged).toBe(true);
      expect(r.blocked).toBe(false);
      expect(r.sanitized).toBe(payload);
    });

    it("redact: scrubs sensitive substrings in a copy", () => {
      const r = scanForExfil(payload, { action: "redact" });
      const sanitized = r.sanitized as { msg: string };
      expect(sanitized.msg).not.toContain("sk-ant-api03-AbCdEf0123456789ZZZ");
      expect(sanitized.msg).toContain("[REDACTED]");
      // original untouched
      expect(payload.msg).toContain("sk-ant-api03");
    });

    it("block: marks the scan blocked", () => {
      const r = scanForExfil(payload, { action: "block" });
      expect(r.blocked).toBe(true);
    });
  });

  it("scans plain strings and arrays with path indices", () => {
    const guard = new ExfilGuard();
    const r = guard.scan(["clean", "leak sk-ant-api03-AbCdEf0123456789ZZZ"]);
    expect(r.flagged).toBe(true);
    expect(r.findings[0]!.path).toBe("[1]");
  });
});
