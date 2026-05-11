import { z } from "zod";
import type { ToolDefinitionRuntime } from "../registry.js";

const CalculateInputSchema = z.object({
  expression: z.string().min(1).optional().describe("Math expression to evaluate safely"),
  mode: z.enum(["expression", "tip", "loan"]).optional().default("expression"),
  amount: z.number().optional().describe("Bill/principal amount for tip or loan calculations"),
  percentage: z.number().optional().describe("Tip percentage"),
  rate: z.number().optional().describe("Annual interest rate percentage for loan calculations"),
  months: z.number().int().positive().optional().describe("Loan term in months"),
  people: z.number().int().positive().optional().default(1).describe("People splitting a tip total"),
});

const ConvertUnitInputSchema = z.object({
  value: z.number(),
  from: z.string().min(1),
  to: z.string().min(1),
});

const ConvertCurrencyInputSchema = z.object({
  amount: z.number(),
  from: z.string().length(3),
  to: z.string().length(3),
});

export const calculateTool: ToolDefinitionRuntime = {
  name: "calculate",
  description:
    "Safely evaluate math expressions without eval. Supports arithmetic, percentages, exponents, sqrt/abs/log/ln, trig functions, tip splits, and loan payments.",
  parameters: {
    type: "object",
    properties: {
      expression: { type: "string", description: "Math expression, for example: sin(30) + 2^3 or 15% * 80" },
      mode: { type: "string", enum: ["expression", "tip", "loan"], description: "Calculation mode" },
      amount: { type: "number", description: "Bill amount or loan principal" },
      percentage: { type: "number", description: "Tip percentage" },
      rate: { type: "number", description: "Annual loan interest rate percentage" },
      months: { type: "integer", description: "Loan term in months" },
      people: { type: "integer", description: "Number of people splitting the tip total" },
    },
  },
  inputSchema: CalculateInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: 5_000,
  tags: ["utility", "calculator", "math"],
  async execute(input) {
    const params = CalculateInputSchema.parse(input);

    if (params.mode === "tip") {
      if (params.amount === undefined || params.percentage === undefined) {
        throw new Error("Tip calculation requires amount and percentage");
      }
      const tip = params.amount * (params.percentage / 100);
      const total = params.amount + tip;
      return {
        mode: "tip",
        amount: round(params.amount),
        tip: round(tip),
        total: round(total),
        perPerson: round(total / (params.people ?? 1)),
        people: params.people ?? 1,
      };
    }

    if (params.mode === "loan") {
      if (params.amount === undefined || params.rate === undefined || params.months === undefined) {
        throw new Error("Loan calculation requires amount, rate, and months");
      }
      const monthlyRate = params.rate / 100 / 12;
      const payment =
        monthlyRate === 0
          ? params.amount / params.months
          : (params.amount * monthlyRate) / (1 - (1 + monthlyRate) ** -params.months);
      const total = payment * params.months;
      return {
        mode: "loan",
        principal: round(params.amount),
        monthlyPayment: round(payment),
        totalPaid: round(total),
        interestPaid: round(total - params.amount),
        months: params.months,
      };
    }

    if (!params.expression) {
      throw new Error("Expression calculation requires expression");
    }

    const value = evaluateExpression(params.expression);
    return {
      mode: "expression",
      expression: params.expression,
      result: round(value),
    };
  },
};

export const convertUnitTool: ToolDefinitionRuntime = {
  name: "convert_unit",
  description:
    "Convert units for length, weight, temperature, volume, area, speed, digital storage, cooking measurements, and common time durations.",
  parameters: {
    type: "object",
    properties: {
      value: { type: "number", description: "Numeric value to convert" },
      from: { type: "string", description: "Source unit, such as miles, kg, celsius, cups, gb" },
      to: { type: "string", description: "Target unit" },
    },
    required: ["value", "from", "to"],
  },
  inputSchema: ConvertUnitInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: 5_000,
  tags: ["utility", "conversion", "units"],
  async execute(input) {
    const params = ConvertUnitInputSchema.parse(input);
    const result = convertUnit(params.value, params.from, params.to);
    return {
      value: params.value,
      from: params.from,
      to: params.to,
      result: round(result),
    };
  },
};

export const convertCurrencyTool: ToolDefinitionRuntime = {
  name: "convert_currency",
  description: "Convert currency amounts using live exchange rates from frankfurter.app.",
  parameters: {
    type: "object",
    properties: {
      amount: { type: "number", description: "Amount to convert" },
      from: { type: "string", description: "Three-letter source currency code" },
      to: { type: "string", description: "Three-letter target currency code" },
    },
    required: ["amount", "from", "to"],
  },
  inputSchema: ConvertCurrencyInputSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: 10_000,
  tags: ["utility", "conversion", "currency"],
  async execute(input) {
    const params = ConvertCurrencyInputSchema.parse(input);
    const from = params.from.toUpperCase();
    const to = params.to.toUpperCase();
    if (from === to) {
      return { amount: params.amount, from, to, result: params.amount, rate: 1 };
    }

    const url = new URL("https://api.frankfurter.app/latest");
    url.searchParams.set("amount", String(params.amount));
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Currency rate request failed with ${response.status}`);
    }

    const payload = (await response.json()) as { rates?: Record<string, number>; date?: string };
    const converted = payload.rates?.[to];
    if (typeof converted !== "number") {
      throw new Error(`No live exchange rate found for ${from} to ${to}`);
    }

    return {
      amount: params.amount,
      from,
      to,
      result: round(converted),
      rate: round(converted / params.amount),
      date: payload.date,
      source: "frankfurter.app",
    };
  },
};

type Token =
  | { type: "number"; value: number }
  | { type: "operator"; value: string }
  | { type: "function"; value: string }
  | { type: "leftParen" }
  | { type: "rightParen" };

const FUNCTIONS: Record<string, (value: number) => number> = {
  abs: Math.abs,
  sqrt: Math.sqrt,
  log: Math.log10,
  ln: Math.log,
  sin: (value) => Math.sin(toRadians(value)),
  cos: (value) => Math.cos(toRadians(value)),
  tan: (value) => Math.tan(toRadians(value)),
};

const OPERATORS: Record<string, { precedence: number; associativity: "left" | "right"; apply: (a: number, b: number) => number }> = {
  "+": { precedence: 1, associativity: "left", apply: (a, b) => a + b },
  "-": { precedence: 1, associativity: "left", apply: (a, b) => a - b },
  "*": { precedence: 2, associativity: "left", apply: (a, b) => a * b },
  "/": { precedence: 2, associativity: "left", apply: (a, b) => a / b },
  "^": { precedence: 3, associativity: "right", apply: (a, b) => a ** b },
};

export function evaluateExpression(expression: string): number {
  const output = toReversePolish(tokenize(expression));
  const stack: number[] = [];

  for (const token of output) {
    if (token.type === "number") {
      stack.push(token.value);
      continue;
    }

    if (token.type === "function") {
      const value = stack.pop();
      if (value === undefined) throw new Error(`Function ${token.value} is missing an argument`);
      stack.push(FUNCTIONS[token.value]!(value));
      continue;
    }

    if (token.type === "operator") {
      const right = stack.pop();
      const left = stack.pop();
      if (left === undefined || right === undefined) throw new Error(`Operator ${token.value} is missing operands`);
      stack.push(OPERATORS[token.value]!.apply(left, right));
    }
  }

  if (stack.length !== 1 || !Number.isFinite(stack[0]!)) {
    throw new Error("Invalid mathematical expression");
  }

  return stack[0]!;
}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let expectsValue = true;

  while (index < expression.length) {
    const char = expression[index]!;
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (/\d|\./.test(char) || (char === "-" && expectsValue && /\d|\./.test(expression[index + 1] ?? ""))) {
      const match = expression.slice(index).match(/^-?\d+(?:\.\d+)?/);
      if (!match) throw new Error(`Invalid number near ${expression.slice(index)}`);
      tokens.push({ type: "number", value: Number(match[0]) });
      index += match[0].length;
      expectsValue = false;
      continue;
    }

    if (/[a-z]/i.test(char)) {
      const match = expression.slice(index).match(/^[a-z]+/i);
      const name = match![0].toLowerCase();
      if (!FUNCTIONS[name]) throw new Error(`Unsupported function: ${name}`);
      tokens.push({ type: "function", value: name });
      index += name.length;
      expectsValue = true;
      continue;
    }

    if (char === "(") {
      tokens.push({ type: "leftParen" });
      index += 1;
      expectsValue = true;
      continue;
    }

    if (char === ")") {
      tokens.push({ type: "rightParen" });
      index += 1;
      expectsValue = false;
      continue;
    }

    if (char === "%") {
      tokens.push({ type: "number", value: 100 });
      tokens.push({ type: "operator", value: "/" });
      index += 1;
      expectsValue = false;
      continue;
    }

    if (OPERATORS[char]) {
      tokens.push({ type: "operator", value: char });
      index += 1;
      expectsValue = true;
      continue;
    }

    throw new Error(`Unsupported character: ${char}`);
  }

  return tokens;
}

function toReversePolish(tokens: Token[]): Token[] {
  const output: Token[] = [];
  const operators: Token[] = [];

  for (const token of tokens) {
    if (token.type === "number") {
      output.push(token);
      continue;
    }

    if (token.type === "function") {
      operators.push(token);
      continue;
    }

    if (token.type === "operator") {
      const current = OPERATORS[token.value]!;
      while (operators.length > 0) {
        const top = operators[operators.length - 1]!;
        if (top.type === "function") {
          output.push(operators.pop()!);
          continue;
        }
        if (top.type !== "operator") break;
        const previous = OPERATORS[top.value]!;
        const shouldPop =
          previous.precedence > current.precedence ||
          (previous.precedence === current.precedence && current.associativity === "left");
        if (!shouldPop) break;
        output.push(operators.pop()!);
      }
      operators.push(token);
      continue;
    }

    if (token.type === "leftParen") {
      operators.push(token);
      continue;
    }

    while (operators.length > 0 && operators[operators.length - 1]!.type !== "leftParen") {
      output.push(operators.pop()!);
    }
    if (operators.pop()?.type !== "leftParen") {
      throw new Error("Mismatched parentheses");
    }
    if (operators[operators.length - 1]?.type === "function") {
      output.push(operators.pop()!);
    }
  }

  while (operators.length > 0) {
    const token = operators.pop()!;
    if (token.type === "leftParen" || token.type === "rightParen") {
      throw new Error("Mismatched parentheses");
    }
    output.push(token);
  }

  return output;
}

const UNIT_TABLES: Array<Record<string, number>> = [
  { m: 1, meter: 1, meters: 1, km: 1000, kilometer: 1000, kilometers: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, mile: 1609.344, miles: 1609.344, ft: 0.3048, foot: 0.3048, feet: 0.3048, in: 0.0254, inch: 0.0254, inches: 0.0254 },
  { g: 1, gram: 1, grams: 1, kg: 1000, kilogram: 1000, kilograms: 1000, lb: 453.59237, lbs: 453.59237, pound: 453.59237, pounds: 453.59237, oz: 28.349523125, ounce: 28.349523125, ounces: 28.349523125 },
  { l: 1, liter: 1, liters: 1, litre: 1, litres: 1, ml: 0.001, gallon: 3.785411784, gallons: 3.785411784, quart: 0.946352946, quarts: 0.946352946, pint: 0.473176473, pints: 0.473176473, cup: 0.2365882365, cups: 0.2365882365, tbsp: 0.0147867648, tablespoon: 0.0147867648, tablespoons: 0.0147867648, tsp: 0.00492892159, teaspoon: 0.00492892159, teaspoons: 0.00492892159 },
  { sqm: 1, "m2": 1, "meter2": 1, sqft: 0.09290304, "ft2": 0.09290304, acre: 4046.8564224, hectare: 10000 },
  { mps: 1, "m/s": 1, kph: 0.2777777778, "km/h": 0.2777777778, mph: 0.44704, knot: 0.5144444444, knots: 0.5144444444 },
  { byte: 1, bytes: 1, kb: 1000, mb: 1_000_000, gb: 1_000_000_000, tb: 1_000_000_000_000, kib: 1024, mib: 1_048_576, gib: 1_073_741_824, tib: 1_099_511_627_776 },
  { second: 1, seconds: 1, sec: 1, minute: 60, minutes: 60, min: 60, hour: 3600, hours: 3600, day: 86400, days: 86400, week: 604800, weeks: 604800 },
];

export function convertUnit(value: number, from: string, to: string): number {
  const source = normalizeUnit(from);
  const target = normalizeUnit(to);

  const temperature = convertTemperature(value, source, target);
  if (temperature !== undefined) return temperature;

  for (const table of UNIT_TABLES) {
    if (table[source] !== undefined && table[target] !== undefined) {
      return (value * table[source]!) / table[target]!;
    }
  }

  throw new Error(`Unsupported unit conversion: ${from} to ${to}`);
}

function convertTemperature(value: number, from: string, to: string): number | undefined {
  const units = new Set(["c", "celsius", "f", "fahrenheit", "k", "kelvin"]);
  if (!units.has(from) && !units.has(to)) return undefined;
  if (!units.has(from) || !units.has(to)) throw new Error("Temperature units can only convert to temperature units");
  const celsius = from === "f" || from === "fahrenheit" ? (value - 32) * (5 / 9) : from === "k" || from === "kelvin" ? value - 273.15 : value;
  if (to === "f" || to === "fahrenheit") return celsius * (9 / 5) + 32;
  if (to === "k" || to === "kelvin") return celsius + 273.15;
  return celsius;
}

function normalizeUnit(unit: string): string {
  return unit.trim().toLowerCase().replaceAll(" ", "").replaceAll("_", "");
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

function round(value: number): number {
  return Number(value.toFixed(10));
}
