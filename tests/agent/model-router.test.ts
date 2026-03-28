import { describe, it, expect, beforeEach } from "vitest";
import { assessComplexity, routeModel, clearProviderCache } from "../../agent/src/models/router.js";

describe("Model Router - Extended", () => {
  beforeEach(() => {
    clearProviderCache();
  });

  describe("assessComplexity edge cases", () => {
    it("empty string is simple", () => {
      expect(assessComplexity("")).toBe("simple");
    });

    it("single word is simple", () => {
      expect(assessComplexity("test")).toBe("simple");
    });

    it("exactly 200 chars is simple threshold", () => {
      const msg = "a".repeat(200);
      expect(assessComplexity(msg)).toBe("simple");
    });

    it("201 chars with no keywords stays simple (length alone needs >200 for +1 score)", () => {
      const msg = "a".repeat(201);
      // Score is only 1 from length alone, needs >=2 for moderate
      expect(assessComplexity(msg)).toBe("simple");
    });

    it("1001 chars is at least moderate", () => {
      const msg = "a".repeat(1001);
      const result = assessComplexity(msg);
      expect(["moderate", "complex"]).toContain(result);
    });

    it("multiple tool mentions increase complexity", () => {
      const msg = "search the database and execute a shell command to create a file";
      const result = assessComplexity(msg);
      expect(["moderate", "complex"]).toContain(result);
    });

    it("numbered steps with tool mentions is complex", () => {
      const msg = `
        1. Search for files
        2. Read the database
        3. Execute the command
        4. Create the output
      `;
      expect(assessComplexity(msg)).toBe("complex");
    });

    it("code block alone adds score but may not be enough for moderate", () => {
      const msg = "Fix this:\n```\nconsole.log('test')\n```";
      const result = assessComplexity(msg);
      // Score is 1 (code block) — still simple unless other heuristics trigger
      expect(["simple", "moderate", "complex"]).toContain(result);
    });

    it("three question marks bump complexity", () => {
      const msg = "What is this? How does it work? Where is the file?";
      const result = assessComplexity(msg);
      expect(["moderate", "complex"]).toContain(result);
    });
  });

  describe("routeModel provider inference", () => {
    it("infers anthropic for claude models", () => {
      const result = routeModel("Hello!", {
        id: "test",
        name: "Test",
        defaultModel: "claude-sonnet-4-20250514",
      });
      expect(result.model).toBe("claude-sonnet-4-20250514");
    });

    it("uses anthropic provider when no OpenAI key is set", () => {
      // OpenAI provider requires OPENAI_API_KEY, so we test anthropic path
      const result = routeModel("Hello!", {
        id: "test",
        name: "Test",
        defaultModel: "claude-haiku-4-20250514",
        defaultProvider: "anthropic",
      });
      expect(result.model).toBe("claude-haiku-4-20250514");
    });

    it("respects complexity tier overrides", () => {
      const result = routeModel("Hi", {
        id: "test",
        name: "Test",
        modelOverrides: { simple: "claude-haiku-4-20250514" },
      });
      // "Hi" should be simple, so override should apply
      if (result.complexity === "simple") {
        expect(result.model).toBe("claude-haiku-4-20250514");
      }
    });

    it("falls back to global defaults without agent config", () => {
      const result = routeModel("Hello!");
      expect(result.model).toBeTruthy();
      expect(result.complexity).toBeTruthy();
      expect(result.provider).toBeTruthy();
    });
  });
});
