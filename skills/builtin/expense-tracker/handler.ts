// ─── Expense Tracker Skill Handler ────────────────────────────────────────
//
// Parses expenses from natural language, stores them in a local JSON file,
// and generates summaries and reports.
//
// ───────────────────────────────────────────────────────────────────────────

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import pino from "pino";
import type {
  SkillHandler,
  SkillContext,
  SkillResult,
} from "../../../agent/src/skills/loader.js";

const logger = pino({ name: "skill:expense-tracker" });

// ─── Types ──────────────────────────────────────────────────────────────────

type ExpenseCategory =
  | "food"
  | "transport"
  | "entertainment"
  | "bills"
  | "shopping"
  | "health"
  | "other";

interface Expense {
  id: string;
  amount: number;
  currency: string;
  category: ExpenseCategory;
  description: string;
  date: string; // ISO date string
  tags: string[];
  createdAt: string;
}

interface ExpenseStore {
  version: number;
  expenses: Expense[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const STORAGE_DIR = join(homedir(), ".karna");
const STORAGE_FILE = join(STORAGE_DIR, "expenses.json");

const CATEGORY_KEYWORDS: Record<ExpenseCategory, string[]> = {
  food: ["grocery", "groceries", "restaurant", "food", "lunch", "dinner", "breakfast", "coffee", "snack", "meal", "eat"],
  transport: ["taxi", "uber", "lyft", "fuel", "gas", "petrol", "bus", "metro", "train", "parking", "toll", "ride"],
  entertainment: ["movie", "movies", "game", "games", "netflix", "spotify", "subscription", "concert", "hobby"],
  bills: ["electricity", "electric", "water", "internet", "wifi", "phone", "rent", "bill", "utility", "insurance"],
  shopping: ["clothes", "clothing", "shoes", "amazon", "electronics", "gadget", "furniture", "household"],
  health: ["medicine", "doctor", "hospital", "pharmacy", "gym", "health", "dental", "medical", "workout"],
  other: [],
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  "$": "USD",
  "₹": "INR",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
};

// ─── Handler ────────────────────────────────────────────────────────────────

export class ExpenseTrackerHandler implements SkillHandler {
  async initialize(context: SkillContext): Promise<void> {
    logger.info({ sessionId: context.sessionId }, "Expense tracker skill initialized");
    await this.ensureStorageExists();
  }

  async execute(
    action: string,
    input: Record<string, unknown>,
    context: SkillContext
  ): Promise<SkillResult> {
    logger.debug({ action, sessionId: context.sessionId }, "Executing expense tracker action");

    try {
      switch (action) {
        case "add":
          return this.addExpense(input);
        case "list":
          return this.listExpenses(input);
        case "summary":
          return this.getSummary(input);
        case "report":
          return this.getMonthlyReport(input);
        case "parse":
          return this.parseAndAdd(input);
        default:
          return {
            success: false,
            output: `Unknown action: ${action}`,
            error: `Action "${action}" is not supported`,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message, action }, "Expense tracker action failed");
      return { success: false, output: `Failed: ${message}`, error: message };
    }
  }

  async dispose(): Promise<void> {
    logger.info("Expense tracker skill disposed");
  }

  // ─── Actions ────────────────────────────────────────────────────────────

  private async addExpense(input: Record<string, unknown>): Promise<SkillResult> {
    const amount = Number(input["amount"]);
    if (isNaN(amount) || amount <= 0) {
      return { success: false, output: "Invalid amount. Please provide a positive number.", error: "Invalid amount" };
    }

    const currency = (input["currency"] as string)?.toUpperCase() ?? "INR";
    const category = this.inferCategory(
      (input["category"] as string) ?? "",
      (input["description"] as string) ?? ""
    );
    const description = (input["description"] as string) ?? "Unnamed expense";
    const date = (input["date"] as string) ?? new Date().toISOString().split("T")[0]!;
    const tags = (input["tags"] as string[]) ?? [];

    const expense: Expense = {
      id: randomUUID(),
      amount,
      currency,
      category,
      description,
      date,
      tags,
      createdAt: new Date().toISOString(),
    };

    const store = await this.loadStore();
    store.expenses.push(expense);
    await this.saveStore(store);

    const symbol = this.getCurrencySymbol(currency);

    logger.info(
      { expenseId: expense.id, amount, currency, category },
      "Expense added"
    );

    return {
      success: true,
      output: `Expense added: ${symbol}${amount.toFixed(2)} for "${description}" [${category}] on ${date}`,
      data: { expense } as unknown as Record<string, unknown>,
    };
  }

  private async parseAndAdd(input: Record<string, unknown>): Promise<SkillResult> {
    const text = (input["text"] as string) ?? (input["args"] as string) ?? "";
    if (!text.trim()) {
      return { success: false, output: "No expense text to parse.", error: "Empty input" };
    }

    const parsed = this.parseNaturalLanguage(text);
    if (!parsed) {
      return {
        success: false,
        output: `Could not parse expense from: "${text}". Try something like "spent $50 on groceries".`,
        error: "Parse failed",
      };
    }

    return this.addExpense(parsed);
  }

  private async listExpenses(input: Record<string, unknown>): Promise<SkillResult> {
    const store = await this.loadStore();
    let expenses = store.expenses;

    // Apply date filters
    const startDate = input["startDate"] as string | undefined;
    const endDate = input["endDate"] as string | undefined;
    const category = input["category"] as string | undefined;

    if (startDate) {
      expenses = expenses.filter((e) => e.date >= startDate);
    }
    if (endDate) {
      expenses = expenses.filter((e) => e.date <= endDate);
    }
    if (category) {
      expenses = expenses.filter((e) => e.category === category);
    }

    // Sort by date descending
    expenses.sort((a, b) => b.date.localeCompare(a.date));

    if (expenses.length === 0) {
      return { success: true, output: "No expenses found for the given criteria." };
    }

    const lines = expenses.map((e) => {
      const symbol = this.getCurrencySymbol(e.currency);
      return `• ${e.date} | ${symbol}${e.amount.toFixed(2)} | ${e.category} | ${e.description}`;
    });

    const total = expenses.reduce((sum, e) => sum + e.amount, 0);
    const currency = expenses[0]?.currency ?? "INR";
    const symbol = this.getCurrencySymbol(currency);

    return {
      success: true,
      output: `Expenses (${expenses.length} entries):\n${lines.join("\n")}\n\nTotal: ${symbol}${total.toFixed(2)}`,
      data: { expenses, total, currency } as unknown as Record<string, unknown>,
    };
  }

  private async getSummary(input: Record<string, unknown>): Promise<SkillResult> {
    const store = await this.loadStore();
    const expenses = store.expenses;

    if (expenses.length === 0) {
      return { success: true, output: "No expenses recorded yet." };
    }

    // Group by category
    const byCategory = new Map<ExpenseCategory, number>();
    let total = 0;

    for (const expense of expenses) {
      const current = byCategory.get(expense.category) ?? 0;
      byCategory.set(expense.category, current + expense.amount);
      total += expense.amount;
    }

    // Sort categories by spending (descending)
    const sorted = Array.from(byCategory.entries()).sort((a, b) => b[1] - a[1]);
    const currency = expenses[0]?.currency ?? "INR";
    const symbol = this.getCurrencySymbol(currency);

    const lines = sorted.map(([category, amount]) => {
      const pct = ((amount / total) * 100).toFixed(1);
      return `• ${category}: ${symbol}${amount.toFixed(2)} (${pct}%)`;
    });

    return {
      success: true,
      output: `Spending Summary:\n${lines.join("\n")}\n\nTotal: ${symbol}${total.toFixed(2)} across ${expenses.length} expenses`,
      data: {
        categories: Object.fromEntries(sorted),
        total,
        count: expenses.length,
        currency,
      },
    };
  }

  private async getMonthlyReport(input: Record<string, unknown>): Promise<SkillResult> {
    const now = new Date();
    const month = (input["month"] as number) ?? now.getMonth() + 1;
    const year = (input["year"] as number) ?? now.getFullYear();

    const monthStr = String(month).padStart(2, "0");
    const prefix = `${year}-${monthStr}`;

    const store = await this.loadStore();
    const monthExpenses = store.expenses.filter((e) => e.date.startsWith(prefix));

    if (monthExpenses.length === 0) {
      return {
        success: true,
        output: `No expenses recorded for ${year}-${monthStr}.`,
      };
    }

    // Category breakdown
    const byCategory = new Map<ExpenseCategory, { total: number; count: number }>();
    let total = 0;

    for (const expense of monthExpenses) {
      const entry = byCategory.get(expense.category) ?? { total: 0, count: 0 };
      entry.total += expense.amount;
      entry.count++;
      byCategory.set(expense.category, entry);
      total += expense.amount;
    }

    const sorted = Array.from(byCategory.entries()).sort((a, b) => b[1].total - a[1].total);
    const currency = monthExpenses[0]?.currency ?? "INR";
    const symbol = this.getCurrencySymbol(currency);

    const monthName = new Date(year, month - 1).toLocaleString("en-US", { month: "long" });

    const lines = [
      `Monthly Report: ${monthName} ${year}`,
      `${"─".repeat(40)}`,
      "",
      "Category Breakdown:",
      ...sorted.map(([category, data]) => {
        const pct = ((data.total / total) * 100).toFixed(1);
        return `  ${category.padEnd(16)} ${symbol}${data.total.toFixed(2).padStart(10)}  (${pct}%, ${data.count} items)`;
      }),
      "",
      `${"─".repeat(40)}`,
      `  Total:            ${symbol}${total.toFixed(2)}`,
      `  Transactions:     ${monthExpenses.length}`,
      `  Daily average:    ${symbol}${(total / new Date(year, month, 0).getDate()).toFixed(2)}`,
    ];

    // Previous month comparison
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevPrefix = `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
    const prevExpenses = store.expenses.filter((e) => e.date.startsWith(prevPrefix));
    const prevTotal = prevExpenses.reduce((sum, e) => sum + e.amount, 0);

    if (prevTotal > 0) {
      const change = ((total - prevTotal) / prevTotal) * 100;
      const direction = change >= 0 ? "up" : "down";
      lines.push(
        `  vs. last month:   ${direction} ${Math.abs(change).toFixed(1)}% (${symbol}${prevTotal.toFixed(2)})`
      );
    }

    return {
      success: true,
      output: lines.join("\n"),
      data: {
        month,
        year,
        total,
        categories: Object.fromEntries(sorted.map(([k, v]) => [k, v.total])),
        count: monthExpenses.length,
        currency,
      },
    };
  }

  // ─── Natural Language Parsing ──────────────────────────────────────────

  private parseNaturalLanguage(
    text: string
  ): Record<string, unknown> | null {
    const normalized = text.toLowerCase().trim();

    // Match amount with currency: $50, ₹2000, €15, 50 dollars, etc.
    const amountPatterns = [
      /(?:[$₹€£¥])\s*([0-9]+(?:\.[0-9]{1,2})?)/,
      /([0-9]+(?:\.[0-9]{1,2})?)\s*(?:dollars?|usd|inr|rupees?|euros?|eur|pounds?|gbp)/i,
      /(?:for|of|about|around)\s*(?:[$₹€£¥])?\s*([0-9]+(?:\.[0-9]{1,2})?)/,
      /([0-9]+(?:\.[0-9]{1,2})?)/,
    ];

    let amount: number | null = null;
    for (const pattern of amountPatterns) {
      const match = normalized.match(pattern);
      if (match?.[1]) {
        amount = parseFloat(match[1]);
        break;
      }
    }

    if (!amount || amount <= 0) return null;

    // Detect currency
    let currency = "INR"; // Default
    for (const [symbol, code] of Object.entries(CURRENCY_SYMBOLS)) {
      if (text.includes(symbol)) {
        currency = code;
        break;
      }
    }
    if (/dollars?|usd/i.test(normalized)) currency = "USD";
    if (/rupees?|inr/i.test(normalized)) currency = "INR";
    if (/euros?|eur/i.test(normalized)) currency = "EUR";
    if (/pounds?|gbp/i.test(normalized)) currency = "GBP";

    // Extract description — text after "on", "for", "at"
    let description = text.trim();
    const descPatterns = [
      /(?:on|for|at)\s+(.+?)(?:\s+(?:today|yesterday|on\s+\d))?$/i,
      /(?:spent|paid|bought|cost)\s+.+?\s+(?:on|for|at)\s+(.+)/i,
    ];
    for (const pattern of descPatterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        description = match[1].trim();
        break;
      }
    }

    return { amount, currency, description };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private inferCategory(
    explicit: string,
    description: string
  ): ExpenseCategory {
    // If explicitly provided, validate and return
    if (explicit && explicit in CATEGORY_KEYWORDS) {
      return explicit as ExpenseCategory;
    }

    // Auto-detect from description
    const lowerDesc = description.toLowerCase();
    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      if (category === "other") continue;
      if (keywords.some((kw) => lowerDesc.includes(kw))) {
        return category as ExpenseCategory;
      }
    }

    return "other";
  }

  private getCurrencySymbol(currency: string): string {
    const symbolMap: Record<string, string> = {
      USD: "$",
      INR: "₹",
      EUR: "€",
      GBP: "£",
      JPY: "¥",
    };
    return symbolMap[currency] ?? currency + " ";
  }

  private async ensureStorageExists(): Promise<void> {
    try {
      await mkdir(STORAGE_DIR, { recursive: true });
    } catch {
      // Directory may already exist
    }
  }

  private async loadStore(): Promise<ExpenseStore> {
    try {
      const content = await readFile(STORAGE_FILE, "utf-8");
      return JSON.parse(content) as ExpenseStore;
    } catch {
      return { version: 1, expenses: [] };
    }
  }

  private async saveStore(store: ExpenseStore): Promise<void> {
    await this.ensureStorageExists();
    await writeFile(STORAGE_FILE, JSON.stringify(store, null, 2), "utf-8");
  }
}

export default ExpenseTrackerHandler;
