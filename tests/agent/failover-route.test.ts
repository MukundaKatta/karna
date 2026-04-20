import { describe, it, expect, beforeEach } from "vitest";
import { buildFailoverChain, clearProviderCache } from "../../agent/src/models/router.js";

describe("buildFailoverChain", () => {
  beforeEach(() => {
    clearProviderCache();
  });

  it("builds a primary route plus fallback models", () => {
    const chain = buildFailoverChain("Search the web, write files, and deploy the project");
    expect(chain.primary.model).toBeTruthy();
    expect(chain.fallbacks.length).toBeGreaterThan(0);
    expect(chain.fallbacks[0]?.model).not.toBe(chain.primary.model);
  });

  it("deduplicates custom fallback models", () => {
    const chain = buildFailoverChain("Hi there", undefined, [
      "claude-haiku-4-20250514",
      "claude-haiku-4-20250514",
      "gpt-4o-mini",
    ]);
    const models = chain.fallbacks.map((item) => item.model);
    expect(new Set(models).size).toBe(models.length);
  });
});
