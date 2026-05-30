import { describe, it, expect } from "vitest";
import {
  EgressPolicy,
  EgressDeniedError,
  assertEgressAllowed,
} from "../../agent/src/tools/security/egress.js";

describe("egress allowlists (#557)", () => {
  it("default-allows tools with no rule (non-breaking)", () => {
    const p = new EgressPolicy();
    expect(p.isAllowed("web_read", "https://anything.example.com/page")).toBe(true);
  });

  it("default-allows a configured-but-trusted tool", () => {
    const p = new EgressPolicy({ web_read: { untrusted: false } });
    expect(p.isAllowed("web_read", "https://x.com")).toBe(true);
  });

  describe("untrusted tools are default-deny", () => {
    const p = new EgressPolicy({
      fetch_tool: { untrusted: true, allow: ["api.example.com", ".trusted.dev"] },
    });

    it("allows an exact host", () => {
      expect(p.isAllowed("fetch_tool", "https://api.example.com/v1")).toBe(true);
    });

    it("allows subdomains via leading-dot wildcard", () => {
      expect(p.isAllowed("fetch_tool", "https://a.b.trusted.dev/x")).toBe(true);
      expect(p.isAllowed("fetch_tool", "https://trusted.dev/x")).toBe(true);
    });

    it("denies a host not on the allowlist", () => {
      expect(p.isAllowed("fetch_tool", "https://evil.com")).toBe(false);
    });

    it("denies a lookalike host (suffix without dot boundary)", () => {
      expect(p.isAllowed("fetch_tool", "https://notapi.example.com")).toBe(false);
      expect(p.isAllowed("fetch_tool", "https://nottrusted.dev")).toBe(false);
    });
  });

  it("explicit deny overrides allow", () => {
    const p = new EgressPolicy({
      t: { untrusted: false, deny: ["blocked.com"] },
    });
    expect(p.isAllowed("t", "https://blocked.com")).toBe(false);
    expect(p.isAllowed("t", "https://ok.com")).toBe(true);
  });

  it("rejects disallowed schemes", () => {
    const p = new EgressPolicy();
    expect(p.isAllowed("t", "file:///etc/passwd")).toBe(false);
    expect(p.isAllowed("t", "ftp://x.com")).toBe(false);
  });

  it("can block private/loopback addresses (SSRF guard)", () => {
    const p = new EgressPolicy({ t: { untrusted: false, blockPrivate: true } });
    expect(p.isAllowed("t", "http://127.0.0.1/x")).toBe(false);
    expect(p.isAllowed("t", "http://localhost/x")).toBe(false);
    expect(p.isAllowed("t", "http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(p.isAllowed("t", "http://10.0.0.5/")).toBe(false);
    expect(p.isAllowed("t", "http://192.168.1.1/")).toBe(false);
    expect(p.isAllowed("t", "https://public.example.com/")).toBe(true);
  });

  it("treats an invalid URL as denied", () => {
    const p = new EgressPolicy();
    const d = p.evaluate("t", "not a url");
    expect(d.allowed).toBe(false);
  });

  describe("assertEgressAllowed", () => {
    it("returns the host on success", () => {
      const p = new EgressPolicy();
      expect(p.assertEgressAllowed("t", "https://Example.COM/path")).toBe("example.com");
      expect(assertEgressAllowed(p, "t", "https://ok.io")).toBe("ok.io");
    });

    it("throws EgressDeniedError on denial", () => {
      const p = new EgressPolicy({ t: { untrusted: true, allow: [] } });
      expect(() => p.assertEgressAllowed("t", "https://evil.com")).toThrow(EgressDeniedError);
    });
  });

  it("markUntrusted flips a tool to default-deny", () => {
    const p = new EgressPolicy();
    expect(p.isAllowed("t", "https://x.com")).toBe(true);
    p.markUntrusted("t", ["x.com"]);
    expect(p.isAllowed("t", "https://x.com")).toBe(true);
    expect(p.isAllowed("t", "https://y.com")).toBe(false);
  });
});
