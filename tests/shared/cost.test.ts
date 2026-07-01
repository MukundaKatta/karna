import { describe, it, expect } from "vitest";
import {
  calculateCost,
  calculateTotalCost,
  getModelPricing,
  registerModelPricing,
  getRegisteredModels,
  formatCost,
} from "../../packages/shared/src/utils/cost.js";

describe("cost utilities", () => {
  describe("getModelPricing", () => {
    it("returns pricing for an exact model id", () => {
      const pricing = getModelPricing("claude-sonnet-4-20250514");
      expect(pricing).toBeDefined();
      expect(pricing?.inputPerMillion).toBe(3);
      expect(pricing?.outputPerMillion).toBe(15);
    });

    it("resolves a dated/versioned provider id to its registered family base", () => {
      // Real provider ids carry date suffixes; they must still find a price.
      expect(getModelPricing("gpt-4o-mini-2024-07-18")).toEqual(
        getModelPricing("gpt-4o-mini"),
      );
      expect(getModelPricing("claude-3-5-sonnet-20241022-extra")).toEqual(
        getModelPricing("claude-3-5-sonnet-20241022"),
      );
    });

    it("prefers the longest (most specific) base when several match", () => {
      // "gpt-4o-..." could match "gpt-4o" base; an id under gpt-4o-mini must
      // resolve to gpt-4o-mini, not the shorter gpt-4o.
      expect(getModelPricing("gpt-4o-mini-2024-07-18")).toEqual(
        getModelPricing("gpt-4o-mini"),
      );
    });

    it("resolves an unambiguous family prefix to its full id", () => {
      expect(getModelPricing("claude-sonnet-4")).toEqual(
        getModelPricing("claude-sonnet-4-20250514"),
      );
    });

    it("returns undefined for an ambiguous family prefix instead of guessing", () => {
      // "claude" matches many models; resolving it would silently misprice.
      expect(getModelPricing("claude")).toBeUndefined();
    });

    it("returns undefined for an empty or whitespace-only model id", () => {
      expect(getModelPricing("")).toBeUndefined();
      expect(getModelPricing("   ")).toBeUndefined();
    });

    it("returns undefined for a completely unknown model", () => {
      expect(getModelPricing("totally-made-up-model")).toBeUndefined();
    });
  });

  describe("calculateCost", () => {
    it("computes input and output costs in USD", () => {
      const cost = calculateCost("claude-sonnet-4-20250514", {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      });
      expect(cost.inputCost).toBeCloseTo(3, 10);
      expect(cost.outputCost).toBeCloseTo(15, 10);
      expect(cost.totalCost).toBeCloseTo(18, 10);
      expect(cost.model).toBe("claude-sonnet-4-20250514");
    });

    it("includes cache read and write costs when provided", () => {
      const cost = calculateCost("claude-sonnet-4-20250514", {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
      });
      expect(cost.cacheReadCost).toBeCloseTo(0.3, 10);
      expect(cost.cacheWriteCost).toBeCloseTo(3.75, 10);
      expect(cost.totalCost).toBeCloseTo(4.05, 10);
    });

    it("treats cache costs as zero when the model has no cache pricing", () => {
      const cost = calculateCost("gpt-4-turbo", {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
      });
      expect(cost.cacheReadCost).toBe(0);
      expect(cost.cacheWriteCost).toBe(0);
      expect(cost.totalCost).toBe(0);
    });

    it("prices a dated provider id via family resolution rather than throwing", () => {
      // This is the bug fix: a real returned model id with a date suffix used
      // to throw because only exact/family-prefix matching was attempted.
      expect(() =>
        calculateCost("gpt-4o-mini-2024-07-18", {
          inputTokens: 1_000_000,
          outputTokens: 0,
        }),
      ).not.toThrow();
      const cost = calculateCost("gpt-4o-mini-2024-07-18", {
        inputTokens: 1_000_000,
        outputTokens: 0,
      });
      expect(cost.inputCost).toBeCloseTo(0.15, 10);
    });

    it("throws for an unknown model", () => {
      expect(() =>
        calculateCost("nope-not-real", { inputTokens: 1, outputTokens: 1 }),
      ).toThrow(/Unknown model/);
    });

    it("throws for an empty model id", () => {
      expect(() =>
        calculateCost("", { inputTokens: 1, outputTokens: 1 }),
      ).toThrow(/Unknown model/);
    });
  });

  describe("calculateTotalCost", () => {
    it("returns just the total number", () => {
      const total = calculateTotalCost("gpt-4o", {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      });
      expect(total).toBeCloseTo(12.5, 10);
    });
  });

  describe("registerModelPricing / getRegisteredModels", () => {
    it("registers a custom model and prices it", () => {
      registerModelPricing("custom-test-model", {
        inputPerMillion: 1,
        outputPerMillion: 2,
      });
      expect(getRegisteredModels()).toContain("custom-test-model");
      const cost = calculateCost("custom-test-model", {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      });
      expect(cost.totalCost).toBeCloseTo(3, 10);
    });
  });

  describe("formatCost", () => {
    it("formats with default precision of 6", () => {
      expect(formatCost(0.0045)).toBe("$0.004500");
    });

    it("respects a custom precision", () => {
      expect(formatCost(0.0045, 2)).toBe("$0.00");
      expect(formatCost(1.5, 2)).toBe("$1.50");
    });
  });
});
