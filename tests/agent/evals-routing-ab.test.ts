import { describe, it, expect } from "vitest";
import { runRoutingAb, type ModelVariant } from "../../agent/src/evals/routing-ab.js";
import {
  defineDataset,
  exactMatchScorer,
  type Suite,
} from "../../agent/src/evals/framework.js";

const dataset = defineDataset<string, string>("echo", [
  { id: "e1", input: "a", expected: "A" },
  { id: "e2", input: "b", expected: "B" },
]);

const suite: Suite<string, string, string> = {
  name: "uppercase",
  dataset,
  scorers: [exactMatchScorer<string, string>()],
};

const variants: ModelVariant[] = [
  { label: "sonnet", model: "claude-sonnet-4-20250514" },
  { label: "haiku", model: "claude-haiku-4-20250514" },
];

describe("model routing A/B eval", () => {
  it("builds a comparative table across variants", async () => {
    const report = await runRoutingAb(suite, variants, (variant, input) => ({
      output: input.toUpperCase(),
      latencyMs: variant.label === "haiku" ? 50 : 200,
      usage: { inputTokens: 1000, outputTokens: 1000 },
    }));

    expect(report.variants).toHaveLength(2);
    const sonnet = report.variants.find((v) => v.label === "sonnet")!;
    const haiku = report.variants.find((v) => v.label === "haiku")!;
    expect(sonnet.quality).toBe(1);
    expect(haiku.quality).toBe(1);
    expect(haiku.meanLatencyMs).toBe(50);
    expect(sonnet.meanLatencyMs).toBe(200);
    // Haiku cheaper than sonnet for identical usage.
    expect(haiku.totalCostUsd).toBeLessThan(sonnet.totalCostUsd);
  });

  it("recommends the faster/cheaper variant at equal quality", async () => {
    const report = await runRoutingAb(suite, variants, (variant, input) => ({
      output: input.toUpperCase(),
      latencyMs: variant.label === "haiku" ? 50 : 200,
      usage: { inputTokens: 1000, outputTokens: 1000 },
    }));
    expect(report.recommendation).toBe("haiku");
    expect(report.compositeScores.haiku).toBeGreaterThan(
      report.compositeScores.sonnet,
    );
  });

  it("prefers higher quality even if slower when quality weight dominates", async () => {
    const report = await runRoutingAb(
      suite,
      variants,
      (variant, input) => ({
        // haiku gets it wrong, sonnet correct.
        output: variant.label === "haiku" ? "wrong" : input.toUpperCase(),
        latencyMs: variant.label === "haiku" ? 10 : 500,
        usage: { inputTokens: 1000, outputTokens: 1000 },
      }),
      { quality: 1, latency: 0.25, cost: 0.25 },
    );
    expect(report.recommendation).toBe("sonnet");
  });
});
