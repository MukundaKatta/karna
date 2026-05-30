// ─── PII Redaction Tests (Issue #542) ────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  detectPii,
  redactPii,
  restorePii,
  containsPii,
  type PiiMatch,
} from "../../agent/src/memory/pii-redaction.js";

describe("detectPii", () => {
  it("detects email", () => {
    const m = detectPii("contact me at alice@example.com please");
    expect(m).toHaveLength(1);
    expect(m[0].type).toBe("email");
    expect(m[0].value).toBe("alice@example.com");
  });

  it("detects a valid (Luhn) credit card but not random digit runs", () => {
    // 4111 1111 1111 1111 is a standard Luhn-valid test card.
    const m = detectPii("card 4111 1111 1111 1111 end");
    expect(m.some((x) => x.type === "credit_card")).toBe(true);
    const none = detectPii("just digits 1234 5678 9012 3456 here");
    expect(none.some((x) => x.type === "credit_card")).toBe(false);
  });

  it("detects SSN-like and IPv4", () => {
    const ssn = detectPii("ssn 123-45-6789");
    expect(ssn.some((x) => x.type === "ssn")).toBe(true);
    const ip = detectPii("server 192.168.1.100 online");
    expect(ip.some((x) => x.type === "ip")).toBe(true);
    expect(detectPii("999.999.999.999").some((x) => x.type === "ip")).toBe(false);
  });

  it("detects phone numbers", () => {
    const m = detectPii("call +1 415-555-0199 now");
    expect(m.some((x) => x.type === "phone")).toBe(true);
  });

  it("resolves overlaps without double-counting", () => {
    const m = detectPii("email bob@host.com and ip 10.0.0.1");
    // Sorted by start, no overlapping spans.
    for (let i = 1; i < m.length; i++) {
      expect(m[i].start).toBeGreaterThanOrEqual(m[i - 1].end);
    }
  });

  it("can restrict to specific types", () => {
    const m = detectPii("a@b.com and 10.0.0.1", { types: ["ip"] });
    expect(m.every((x) => x.type === "ip")).toBe(true);
  });

  it("merges spans from an injected classifier", () => {
    const classifier = (text: string): PiiMatch[] => {
      const idx = text.indexOf("SECRET");
      return idx >= 0 ? [{ type: "custom", value: "SECRET", start: idx, end: idx + 6 }] : [];
    };
    const m = detectPii("the SECRET value", { classifier });
    expect(m.some((x) => x.type === "custom")).toBe(true);
  });
});

describe("redactPii", () => {
  it("irreversibly replaces with type placeholders", () => {
    const { redacted, tokenMap } = redactPii("mail alice@example.com now");
    expect(redacted).toBe("mail [REDACTED_EMAIL] now");
    expect(tokenMap).toEqual({});
  });

  it("supports custom placeholder template", () => {
    const { redacted } = redactPii("ip 10.0.0.1", { placeholder: "<{type}>" });
    expect(redacted).toBe("ip <IP>");
  });

  it("is reversible round-trip via token map", () => {
    const original = "email alice@example.com and bob@example.com, ip 10.0.0.1";
    const { redacted, tokenMap } = redactPii(original, { reversible: true });
    expect(redacted).not.toContain("alice@example.com");
    expect(redacted).toContain("[[PII:email:1]]");
    const restored = restorePii(redacted, tokenMap);
    expect(restored).toBe(original);
  });

  it("reuses one token per identical value", () => {
    const { redacted, tokenMap } = redactPii("a@b.com x a@b.com", { reversible: true });
    expect(Object.keys(tokenMap)).toHaveLength(1);
    expect(redacted.match(/\[\[PII:email:1\]\]/g)).toHaveLength(2);
  });

  it("leaves clean text untouched", () => {
    const { redacted, matches } = redactPii("nothing sensitive here");
    expect(redacted).toBe("nothing sensitive here");
    expect(matches).toHaveLength(0);
    expect(containsPii("nothing sensitive here")).toBe(false);
  });
});
