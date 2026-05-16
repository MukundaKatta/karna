import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calculateTool,
  convertCurrencyTool,
  convertUnitTool,
  evaluateExpression,
} from "../../agent/src/tools/builtin/utility-tools.js";
import { allBuiltinTools } from "../../agent/src/tools/builtin/index.js";

const context = { sessionId: "session-1", agentId: "agent-1" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("utility tools", () => {
  it("registers calculator and conversion tools as built-ins", () => {
    const names = allBuiltinTools.map((tool) => tool.name);
    expect(names).toContain("calculate");
    expect(names).toContain("convert_unit");
    expect(names).toContain("convert_currency");
  });

  it("evaluates math expressions without eval", async () => {
    expect(evaluateExpression("2 + 3 * 4")).toBe(14);
    expect(evaluateExpression("2^3 + sqrt(16)")).toBe(12);
    expect(evaluateExpression("sin(30) + cos(60)")).toBeCloseTo(1);
    await expect(calculateTool.execute({ expression: "15% * 80" }, context)).resolves.toMatchObject({
      result: 12,
    });
  });

  it("calculates tips and loan payments", async () => {
    await expect(
      calculateTool.execute({ mode: "tip", amount: 100, percentage: 20, people: 4 }, context),
    ).resolves.toMatchObject({
      tip: 20,
      total: 120,
      perPerson: 30,
    });

    await expect(
      calculateTool.execute({ mode: "loan", amount: 200000, rate: 6, months: 360 }, context),
    ).resolves.toMatchObject({
      principal: 200000,
      months: 360,
    });
  });

  it("converts supported units", async () => {
    await expect(convertUnitTool.execute({ value: 1, from: "mile", to: "km" }, context)).resolves.toMatchObject({
      result: 1.609344,
    });
    await expect(convertUnitTool.execute({ value: 32, from: "fahrenheit", to: "celsius" }, context)).resolves.toMatchObject({
      result: 0,
    });
    await expect(convertUnitTool.execute({ value: 2, from: "GB", to: "MB" }, context)).resolves.toMatchObject({
      result: 2000,
    });
    await expect(convertUnitTool.execute({ value: 3, from: "cups", to: "ml" }, context)).resolves.toMatchObject({
      result: 709.7647095,
    });
  });

  it("converts currencies with live-rate response payloads", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ date: "2026-05-11", rates: { EUR: 92 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(convertCurrencyTool.execute({ amount: 100, from: "usd", to: "eur" }, context)).resolves.toMatchObject({
      amount: 100,
      from: "USD",
      to: "EUR",
      result: 92,
      rate: 0.92,
      source: "frankfurter.app",
    });
  });
});
