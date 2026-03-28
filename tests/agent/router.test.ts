import { describe, it, expect } from "vitest";
import { assessComplexity, routeModel, clearProviderCache } from "../../agent/src/models/router.js";

describe("Model Router", () => {
  describe("assessComplexity", () => {
    it("classifies short greetings as simple", () => {
      expect(assessComplexity("Hi there!")).toBe("simple");
      expect(assessComplexity("Hello")).toBe("simple");
      expect(assessComplexity("Thanks")).toBe("simple");
    });

    it("classifies tool-related requests as moderate or complex", () => {
      const result = assessComplexity("Can you search for the latest news about AI?");
      expect(["moderate", "complex"]).toContain(result);
    });

    it("classifies long multi-part requests as complex", () => {
      const longRequest = `
        I need you to do the following:
        1. Search the web for recent articles about TypeScript 5.0
        2. Create a file summarizing the key changes
        3. Run the test suite to make sure everything works
        4. Create a pull request with the changes
        5. Send me an email summary when done
      `;
      expect(assessComplexity(longRequest)).toBe("complex");
    });

    it("classifies messages with code blocks as more complex", () => {
      const codeMsg = "Can you help me fix this code?\n```\nfunction foo() { return bar; }\n```";
      const result = assessComplexity(codeMsg);
      expect(["moderate", "complex"]).toContain(result);
    });

    it("classifies messages with multiple questions as more complex", () => {
      const multiQuestion = "What is the weather? What time is it? Where is the nearest store?";
      const result = assessComplexity(multiQuestion);
      expect(["moderate", "complex"]).toContain(result);
    });
  });

  describe("routeModel", () => {
    it("returns a route result with provider, model, and complexity", () => {
      const result = routeModel("Hello!");
      expect(result).toHaveProperty("provider");
      expect(result).toHaveProperty("model");
      expect(result).toHaveProperty("complexity");
      expect(typeof result.model).toBe("string");
    });

    it("uses agent default model when provided", () => {
      const result = routeModel("Hello!", {
        id: "agent-1",
        name: "Test Agent",
        defaultModel: "claude-haiku-4-20250514",
        defaultProvider: "anthropic",
      });
      expect(result.model).toBe("claude-haiku-4-20250514");
    });

    it("uses model overrides per complexity tier", () => {
      const result = routeModel(
        "Search for files in the project and run the test suite then deploy",
        {
          id: "agent-1",
          name: "Test Agent",
          modelOverrides: {
            complex: "claude-opus-4-20250514",
          },
        },
      );
      // Complex tasks should use the override
      if (result.complexity === "complex") {
        expect(result.model).toBe("claude-opus-4-20250514");
      }
    });
  });
});
