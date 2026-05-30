import { describe, it, expect } from "vitest";
import {
  EnvSecretsProvider,
  InMemorySecretsProvider,
  injectSecrets,
  Redactor,
  redactSecrets,
  REDACTED,
} from "../../agent/src/tools/security/secrets.js";

describe("secrets providers (#559)", () => {
  it("InMemorySecretsProvider resolves and lists", async () => {
    const p = new InMemorySecretsProvider({ API_KEY: "abc123" });
    expect(await p.get("API_KEY")).toBe("abc123");
    expect(await p.get("MISSING")).toBeUndefined();
    expect(await p.list()).toEqual(["API_KEY"]);
    p.set("OTHER", "x");
    expect(await p.get("OTHER")).toBe("x");
  });

  it("EnvSecretsProvider reads from injected env with prefix", async () => {
    const p = new EnvSecretsProvider({ env: { KARNA_TOKEN: "tok", IGNORED: "no" }, prefix: "KARNA_" });
    expect(await p.get("TOKEN")).toBe("tok");
    expect(await p.list()).toEqual(["TOKEN"]);
  });

  describe("injectSecrets", () => {
    it("replaces placeholders without mutating input", async () => {
      const p = new InMemorySecretsProvider({ TOKEN: "s3cret" });
      const input = { auth: "Bearer {{secret:TOKEN}}", nested: { k: "{{ secret:TOKEN }}" }, arr: ["{{secret:TOKEN}}"] };
      const out = await injectSecrets(p, input);
      expect(out).toEqual({ auth: "Bearer s3cret", nested: { k: "s3cret" }, arr: ["s3cret"] });
      // original untouched
      expect(input.auth).toBe("Bearer {{secret:TOKEN}}");
    });

    it("leaves unknown placeholders intact in non-strict mode", async () => {
      const p = new InMemorySecretsProvider({});
      const out = await injectSecrets(p, { x: "{{secret:NOPE}}" });
      expect(out).toEqual({ x: "{{secret:NOPE}}" });
    });

    it("rejects unknown placeholders in strict mode", async () => {
      const p = new InMemorySecretsProvider({});
      await expect(injectSecrets(p, { x: "{{secret:NOPE}}" }, { strict: true })).rejects.toThrow(/not available/);
    });
  });
});

describe("Redactor (#559)", () => {
  it("scrubs known exact secret values, longest match first", () => {
    const r = new Redactor({ values: ["topsecret", "secret"], usePatterns: false });
    expect(r.redactString("the topsecret and secret")).toBe(`the ${REDACTED} and ${REDACTED}`);
  });

  it("does not scrub very short values", () => {
    const r = new Redactor({ values: ["ab"], usePatterns: false, minValueLength: 4 });
    expect(r.redactString("ab cd")).toBe("ab cd");
  });

  it("recursively redacts objects and arrays", () => {
    const r = new Redactor({ values: ["hunter2"], usePatterns: false });
    const out = r.redact({ a: "hunter2", b: ["x", "hunter2"], c: 5 });
    expect(out).toEqual({ a: REDACTED, b: ["x", REDACTED], c: 5 });
  });

  describe("structural secret patterns", () => {
    const cases: Array<[string, string]> = [
      ["anthropic", "sk-ant-api03-AbCdEf0123456789ZZZ"],
      ["openai", "sk-proj-AbCdEf0123456789ABCDEFGH"],
      ["aws", "AKIAIOSFODNN7EXAMPLE"],
      ["github", "ghp_" + "A".repeat(36)],
      ["slack", "xoxb-12345678901-abcdef"],
      ["jwt", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"],
    ];
    for (const [label, secret] of cases) {
      it(`redacts ${label} key`, () => {
        const out = redactSecrets(`value=${secret} end`);
        expect(out).not.toContain(secret);
        expect(out).toContain(REDACTED);
      });
    }

    it("redacts a PEM private key block", () => {
      const pem = "-----BEGIN PRIVATE KEY-----\nMIIEv...AAA\n-----END PRIVATE KEY-----";
      expect(redactSecrets(pem)).toBe(REDACTED);
    });
  });
});
