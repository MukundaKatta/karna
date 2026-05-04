import { describe, expect, it } from "vitest";
import { resolvePasswordResetRedirectUrl } from "../../apps/cloud/src/routes/auth.js";

describe("resolvePasswordResetRedirectUrl", () => {
  it("falls back to the default URL when unset", () => {
    expect(resolvePasswordResetRedirectUrl(undefined)).toBe("https://cloud.karna.ai/reset-password");
  });

  it("strips query strings and fragments from configured URLs", () => {
    expect(resolvePasswordResetRedirectUrl("https://cloud.karna.ai/reset-password?token=secret#frag")).toBe(
      "https://cloud.karna.ai/reset-password"
    );
  });

  it("rejects non-https remote URLs", () => {
    expect(resolvePasswordResetRedirectUrl("http://karna.ai/reset-password")).toBe(
      "https://cloud.karna.ai/reset-password"
    );
  });

  it("allows localhost http URLs for development", () => {
    expect(resolvePasswordResetRedirectUrl("http://localhost:3000/reset-password?token=secret")).toBe(
      "http://localhost:3000/reset-password"
    );
  });
});
