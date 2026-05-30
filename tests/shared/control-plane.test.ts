import { describe, it, expect } from "vitest";
import {
  ControlPlaneConfigSchema,
  defaultControlPlaneConfig,
  mergeControlPlaneConfig,
} from "../../packages/shared/src/types/control-plane.js";

describe("ControlPlaneConfig (#523)", () => {
  it("produces a fully-populated default config", () => {
    const cfg = defaultControlPlaneConfig();
    expect(cfg.budgets.maxIterations).toBe(10);
    expect(cfg.approval.low).toBe("auto");
    expect(cfg.approval.critical).toBe("deny");
    expect(cfg.tools.allowlist).toEqual([]);
    expect(cfg.memory.enabledTiers).toContain("working");
  });

  it("validates and fills defaults via the schema", () => {
    const cfg = ControlPlaneConfigSchema.parse({});
    expect(cfg.routing.primary).toBeTruthy();
    expect(cfg.budgets.maxCostUsd).toBeGreaterThan(0);
  });

  it("merges overrides field-by-field without dropping siblings", () => {
    const base = defaultControlPlaneConfig();
    const merged = mergeControlPlaneConfig(base, {
      budgets: { maxIterations: 3 },
    });
    expect(merged.budgets.maxIterations).toBe(3);
    expect(merged.budgets.maxTokens).toBe(base.budgets.maxTokens);
    expect(merged.approval.low).toBe("auto");
  });

  it("replaces array-valued fields wholesale on override", () => {
    const base = defaultControlPlaneConfig();
    const merged = mergeControlPlaneConfig(base, {
      tools: { allowlist: ["only_this"] },
    });
    expect(merged.tools.allowlist).toEqual(["only_this"]);
  });
});
