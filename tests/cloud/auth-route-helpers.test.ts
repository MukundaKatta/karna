import { describe, expect, it } from "vitest";
import {
  PASSWORD_RESET_TOKEN_TTL_SECONDS,
  recordPasswordResetRequest,
  resolvePasswordResetRedirectUrl,
} from "../../apps/cloud/src/routes/auth.js";

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

describe("password reset rate limiting", () => {
  it("uses a 15 minute reset token TTL policy", () => {
    expect(PASSWORD_RESET_TOKEN_TTL_SECONDS).toBe(900);
  });

  it("allows only three reset requests per normalized email per hour", () => {
    const store = new Map<string, number[]>();
    const now = 1_000_000;

    expect(recordPasswordResetRequest("User@Example.com", now, store)).toMatchObject({
      allowed: true,
      remaining: 2,
    });
    expect(recordPasswordResetRequest(" user@example.com ", now + 1, store)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
    expect(recordPasswordResetRequest("USER@example.com", now + 2, store)).toMatchObject({
      allowed: true,
      remaining: 0,
    });
    expect(recordPasswordResetRequest("user@example.com", now + 3, store)).toMatchObject({
      allowed: false,
      remaining: 0,
    });
    expect(recordPasswordResetRequest("user@example.com", now + 60 * 60 * 1000 + 3, store)).toMatchObject({
      allowed: true,
      remaining: 2,
    });
  });
});
