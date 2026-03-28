import { describe, it, expect, beforeEach } from "vitest";
import { AuthProfileManager } from "../../agent/src/models/auth-rotation.js";

describe("AuthProfileManager", () => {
  let apm: AuthProfileManager;

  beforeEach(() => {
    apm = new AuthProfileManager(100); // 100ms window for fast tests
  });

  it("returns null for unknown provider", () => {
    expect(apm.getApiKey("unknown")).toBeNull();
  });

  it("returns api key after adding profile", () => {
    apm.addProfile("anthropic", "sk-ant-test-key");
    const key = apm.getApiKey("anthropic");
    expect(key).toBe("sk-ant-test-key");
  });

  it("round-robins between profiles", () => {
    apm.addProfile("anthropic", "key-1");
    apm.addProfile("anthropic", "key-2");

    const first = apm.getApiKey("anthropic");
    const second = apm.getApiKey("anthropic");
    expect(first).not.toBe(second);
  });

  it("respects rate limits", () => {
    apm.addProfile("anthropic", "key-limited", 2);
    apm.addProfile("anthropic", "key-unlimited");

    // Use up the limited key
    apm.getApiKey("anthropic"); // key-limited (1/2)
    apm.getApiKey("anthropic"); // key-unlimited (round-robin)
    apm.getApiKey("anthropic"); // key-limited (2/2)
    const fourth = apm.getApiKey("anthropic"); // key-unlimited (limited is full)
    expect(fourth).toBe("key-unlimited");
  });

  it("resets rate limits after window expires", async () => {
    apm.addProfile("anthropic", "key-limited", 1);

    apm.getApiKey("anthropic"); // Uses the one allowed request
    await new Promise((r) => setTimeout(r, 150)); // Wait for window reset
    const key = apm.getApiKey("anthropic"); // Should work again
    expect(key).toBe("key-limited");
  });

  it("disables profile on auth error", () => {
    apm.addProfile("anthropic", "bad-key");
    apm.addProfile("anthropic", "good-key");

    apm.markAuthError("anthropic", "bad-key");
    // Should only return good-key now
    expect(apm.getApiKey("anthropic")).toBe("good-key");
    expect(apm.getApiKey("anthropic")).toBe("good-key");
  });

  it("re-enables disabled profile", () => {
    apm.addProfile("anthropic", "key-1");
    apm.markAuthError("anthropic", "key-1");
    expect(apm.getApiKey("anthropic")).toBeNull(); // All disabled

    apm.reEnable("anthropic", "key-1");
    expect(apm.getApiKey("anthropic")).toBe("key-1");
  });

  it("tracks profile count", () => {
    expect(apm.getProfileCount("anthropic")).toBe(0);
    apm.addProfile("anthropic", "key-1");
    apm.addProfile("anthropic", "key-2");
    expect(apm.getProfileCount("anthropic")).toBe(2);
  });

  it("returns profiles without exposing api keys", () => {
    apm.addProfile("anthropic", "secret-key");
    const profiles = apm.getProfiles("anthropic");
    expect(profiles).toHaveLength(1);
    expect((profiles[0] as Record<string, unknown>)["apiKey"]).toBeUndefined();
    expect(profiles[0]!.provider).toBe("anthropic");
  });

  it("handles rate limit marking", () => {
    apm.addProfile("openai", "key-1", 100);
    apm.addProfile("openai", "key-2", 100);

    apm.markRateLimited("openai", "key-1", 5000);
    // key-1 should be skipped, key-2 should be used
    expect(apm.getApiKey("openai")).toBe("key-2");
  });
});
