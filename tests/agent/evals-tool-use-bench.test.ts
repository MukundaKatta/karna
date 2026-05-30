import { describe, it, expect } from "vitest";
import {
  runToolUseBench,
  subsetArgumentValidator,
  type ToolUseScenario,
  type ToolCall,
} from "../../agent/src/evals/tool-use-bench.js";

const scenarios: ToolUseScenario[] = [
  {
    id: "s1",
    prompt: "What's the weather in Paris?",
    expectedTool: "get_weather",
    expectedArguments: { city: "Paris" },
  },
  {
    id: "s2",
    prompt: "Send an email to bob",
    expectedTool: "send_email",
    expectedArguments: { to: "bob" },
  },
  {
    id: "s3",
    prompt: "Just chat",
    expectedTool: "noop",
  },
];

describe("tool-use accuracy benchmark", () => {
  it("scores perfect tool selection and arguments", async () => {
    const runner = (s: ToolUseScenario): ToolCall[] => {
      if (s.id === "s1") return [{ name: "get_weather", arguments: { city: "Paris" } }];
      if (s.id === "s2") return [{ name: "send_email", arguments: { to: "bob" } }];
      return [{ name: "noop", arguments: {} }];
    };
    const report = await runToolUseBench("perfect", scenarios, runner);
    expect(report.toolSelectionAccuracy).toBe(1);
    expect(report.argumentValidity).toBe(1);
    expect(report.exactAccuracy).toBe(1);
  });

  it("detects wrong tool selection", async () => {
    const runner = (s: ToolUseScenario): ToolCall[] => {
      if (s.id === "s1") return [{ name: "search", arguments: {} }];
      if (s.id === "s2") return [{ name: "send_email", arguments: { to: "bob" } }];
      return [{ name: "noop", arguments: {} }];
    };
    const report = await runToolUseBench("wrong-tool", scenarios, runner);
    expect(report.toolSelectionAccuracy).toBeCloseTo(2 / 3, 5);
    const s1 = report.results.find((r) => r.scenarioId === "s1");
    expect(s1?.toolSelected).toBe(false);
    expect(s1?.actualTools).toEqual(["search"]);
  });

  it("detects invalid arguments while tool is correct", async () => {
    const runner = (s: ToolUseScenario): ToolCall[] => {
      if (s.id === "s1") return [{ name: "get_weather", arguments: { city: "London" } }];
      if (s.id === "s2") return [{ name: "send_email", arguments: { to: "bob" } }];
      return [{ name: "noop", arguments: {} }];
    };
    const report = await runToolUseBench("bad-args", scenarios, runner);
    expect(report.toolSelectionAccuracy).toBe(1);
    // 3 selected, 2 with valid args → 2/3.
    expect(report.argumentValidity).toBeCloseTo(2 / 3, 5);
    expect(report.exactAccuracy).toBeCloseTo(2 / 3, 5);
  });

  it("subsetArgumentValidator allows extra args but requires expected ones", () => {
    const scenario = scenarios[0];
    expect(
      subsetArgumentValidator(scenario, {
        name: "get_weather",
        arguments: { city: "Paris", units: "C" },
      }),
    ).toBe(true);
    expect(
      subsetArgumentValidator(scenario, {
        name: "get_weather",
        arguments: { units: "C" },
      }),
    ).toBe(false);
  });
});
