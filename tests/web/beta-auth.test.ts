import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  BETA_SESSION_COOKIE_NAME,
  createBetaSessionToken,
  isBetaAuthEnabled,
  verifyBetaSessionToken,
} from "../../apps/web/lib/beta-auth";

const originalBetaCode = process.env["KARNA_BETA_ACCESS_CODE"];
const originalSessionSecret = process.env["KARNA_WEB_SESSION_SECRET"];

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

afterEach(() => {
  restoreEnv("KARNA_BETA_ACCESS_CODE", originalBetaCode);
  restoreEnv("KARNA_WEB_SESSION_SECRET", originalSessionSecret);
});

describe("beta auth helpers", () => {
  it("stays disabled when no access code is configured", () => {
    delete process.env["KARNA_BETA_ACCESS_CODE"];
    delete process.env["KARNA_WEB_SESSION_SECRET"];

    expect(isBetaAuthEnabled()).toBe(false);
  });

  it("creates and verifies a signed beta session token", async () => {
    process.env["KARNA_BETA_ACCESS_CODE"] = "karna-beta";
    process.env["KARNA_WEB_SESSION_SECRET"] = "super-secret-signing-key";

    const token = await createBetaSessionToken();

    expect(token).toBeTruthy();
    await expect(verifyBetaSessionToken(token)).resolves.toBe(true);
  });

  it("rejects expired beta session tokens", async () => {
    process.env["KARNA_BETA_ACCESS_CODE"] = "karna-beta";
    process.env["KARNA_WEB_SESSION_SECRET"] = "super-secret-signing-key";

    const fifteenDaysAgo = Date.now() - (1000 * 60 * 60 * 24 * 15);
    const token = await createBetaSessionToken(fifteenDaysAgo);

    await expect(verifyBetaSessionToken(token)).resolves.toBe(false);
  });
});

describe("beta middleware", () => {
  it("allows public routes without a session", async () => {
    process.env["KARNA_BETA_ACCESS_CODE"] = "karna-beta";
    process.env["KARNA_WEB_SESSION_SECRET"] = "super-secret-signing-key";

    const { middleware } = await import("../../apps/web/middleware");
    const response = await middleware(new NextRequest("https://karna.ai/privacy"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects protected routes to sign-in when beta access is enabled", async () => {
    process.env["KARNA_BETA_ACCESS_CODE"] = "karna-beta";
    process.env["KARNA_WEB_SESSION_SECRET"] = "super-secret-signing-key";

    const { middleware } = await import("../../apps/web/middleware");
    const response = await middleware(new NextRequest("https://karna.ai/chat"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://karna.ai/sign-in?next=%2Fchat");
  });

  it("allows protected routes when the beta session cookie is valid", async () => {
    process.env["KARNA_BETA_ACCESS_CODE"] = "karna-beta";
    process.env["KARNA_WEB_SESSION_SECRET"] = "super-secret-signing-key";

    const token = await createBetaSessionToken();
    const { middleware } = await import("../../apps/web/middleware");
    const response = await middleware(
      new NextRequest("https://karna.ai/chat", {
        headers: {
          cookie: `${BETA_SESSION_COOKIE_NAME}=${token}`,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("returns 401 for protected api routes without a beta session", async () => {
    process.env["KARNA_BETA_ACCESS_CODE"] = "karna-beta";
    process.env["KARNA_WEB_SESSION_SECRET"] = "super-secret-signing-key";

    const { middleware } = await import("../../apps/web/middleware");
    const response = await middleware(new NextRequest("https://karna.ai/api/sessions"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Authentication required",
      code: "beta_access_required",
    });
  });
});

