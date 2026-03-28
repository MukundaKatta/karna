// ─── Expense Tracker Skill Handler ────────────────────────────────────────
//
// Parses expenses from natural language, stores them in a local JSON file,
// and generates summaries and reports. Uses date-fns for date handling.
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
  date: string; // ISO date string YYYY-MM-DD
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
  food: ["grocery", "groceries", "restaurant", "food", "lunch", "dinner", "breakfast", "coffee", "snack", "meal", "eat", "pizza", "burger", "sushi", "takeout", "delivery"],
  transport: ["taxi", "uber", "lyft", "fuel", "gas", "petrol", "bus", "metro", "train", "parking", "toll", "ride", "fare", "flight", "airline"],
  entertainment: ["movie", "movies", "game", "games", "netflix", "spotify", "subscription", "concert", "hobby", "theater", "theatre", "show", "ticket"],
  bills: ["electricity", "electric", "water", "internet", "wifi", "phone", "rent", "bill", "utility", "insurance", "mortgage", "cable", "tax"],
  shopping: ["clothes", "clothing", "shoes", "amazon", "electronics", "gadget", "furniture", "household", "appliance", "store", "mall"],
  health: ["medicine", "doctor", "hospital", "pharmacy", "gym", "health", "dental", "medical", "workout", "vitamin", "therapy", "prescription"],
  other: [],
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  "$": "USD",
  "\u20B9": "INR",
  "\u20AC": "EUR",
  "\u00A3": "GBP",
  "\u00A5": "JPY",
};

// ─── Date Helpers (lightweight date-fns style) ──────────────────────────────

function parseDate(dateStr: string): Date {
  // Handle relative dates
  const lower = dateStr.toLowerCase().trim();
  const now = new Date();

  if (lower === "today" || lower === "") {
    return now;
  }
  if (lower === "yesterday") {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return d;
  }
  const daysAgoMatch = lower.match(/(\d+)\s*days?\s*ago/);
  if (daysAgoMatch) {
    const d = new Date(now);
    d.setDate(d.getDate() - parseInt(daysAgoMatch[1]!, 10));
    return d;
  }
  const weeksAgoMatch = lower.match(/(\d+)\s*weeks?\s*ago/);
  if (weeksAgoMatch) {
    const d = new Date(now);
    d.setDate(d.getDate() - parseInt(weeksAgoMatch[1]!, 10) * 7);
    return d;
  }
  if (lower === "last week") {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    return d;
  }
  if (lower === "last month") {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 1);
    return d;
  }

  // Try standard parsing
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) return parsed;
  return now;
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0]!;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  return d;
}

function endOfWeek(date: Date): Date {
  const d = startOfWeek(date);
  d.setDate(d.getDate() + 6);
  return d;
}

function differenceInDays(dateA: Date, dateB: Date): number {
  return Math.floor((dateA.getTime() - dateB.getTime()) / (1000 * 60 * 60 * 24));
}

function getMonthName(month: number): string {
  return new Date(2000, month - 1).toLocaleString("en-US", { month: "long" });
}

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
        case "delete":
          return this.deleteExpense(input);
        case "search":
          return this.searchExpenses(input);
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
    const dateInput = (input["date"] as string) ?? "today";
    const date = formatDate(parseDate(dateInput));
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

    // Apply date filters with relative date support
    const startDate = input["startDate"] as string | undefined;
    const endDate = input["endDate"] as string | undefined;
    const category = input["category"] as string | undefined;
    const period = input["period"] as string | undefined;

    // Handle period shortcuts
    if (period) {
      const now = new Date();
      let start: Date;
      let end: Date = now;
      switch (period.toLowerCase()) {
        case "today":
          start = now;
          end = now;
          break;
        case "week":
        case "this week":
          start = startOfWeek(now);
          end = endOfWeek(now);
          break;
        case "month":
        case "this month":
          start = startOfMonth(now);
          end = endOfMonth(now);
          break;
        case "last month": {
          const lastMonth = new Date(now);
          lastMonth.setMonth(lastMonth.getMonth() - 1);
          start = startOfMonth(lastMonth);
          end = endOfMonth(lastMonth);
          break;
        }
        default:
          start = new Date(now.getFullYear(), 0, 1); // Year start
          end = now;
      }
      expenses = expenses.filter((e) => e.date >= formatDate(start) && e.date <= formatDate(end));
    } else {
      if (startDate) {
        const sd = formatDate(parseDate(startDate));
        expenses = expenses.filter((e) => e.date >= sd);
      }
      if (endDate) {
        const ed = formatDate(parseDate(endDate));
        expenses = expenses.filter((e) => e.date <= ed);
      }
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
      return `- ${e.date} | ${symbol}${e.amount.toFixed(2)} | ${e.category} | ${e.description}`;
    });

    // Group totals by currency
    const byCurrency = new Map<string, number>();
    for (const e of expenses) {
      byCurrency.set(e.currency, (byCurrency.get(e.currency) ?? 0) + e.amount);
    }

    const totalLines = [...byCurrency.entries()].map(
      ([cur, tot]) => `${this.getCurrencySymbol(cur)}${tot.toFixed(2)}`
    );

    return {
      success: true,
      output: `Expenses (${expenses.length} entries):\n${lines.join("\n")}\n\nTotal: ${totalLines.join(", ")}`,
      data: { expenses, totals: Object.fromEntries(byCurrency) } as unknown as Record<string, unknown>,
    };
  }

  private async getSummary(input: Record<string, unknown>): Promise<SkillResult> {
    const store = await this.loadStore();
    let expenses = store.expenses;

    // Default to current month
    const period = (input["period"] as string) ?? "this month";
    const now = new Date();

    if (period === "this month") {
      const monthPrefix = formatDate(startOfMonth(now)).slice(0, 7);
      expenses = expenses.filter((e) => e.date.startsWith(monthPrefix));
    } else if (period === "this week") {
      const weekStart = formatDate(startOfWeek(now));
      const weekEnd = formatDate(endOfWeek(now));
      expenses = expenses.filter((e) => e.date >= weekStart && e.date <= weekEnd);
    } else if (period === "all") {
      // Keep all
    }

    if (expenses.length === 0) {
      return { success: true, output: "No expenses recorded for this period." };
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

    // Build visual bar chart
    const maxAmount = sorted[0]?.[1] ?? 1;
    const lines = sorted.map(([category, amount]) => {
      const pct = ((amount / total) * 100).toFixed(1);
      const barLength = Math.round((amount / maxAmount) * 20);
      const bar = "#".repeat(barLength) + ".".repeat(20 - barLength);
      return `  ${category.padEnd(14)} ${symbol}${amount.toFixed(2).padStart(10)} (${pct.padStart(5)}%) [${bar}]`;
    });

    // Compute daily average
    const dateRange = expenses.map((e) => e.date);
    const firstDate = new Date(dateRange.sort()[0]!);
    const daySpan = Math.max(1, differenceInDays(now, firstDate) + 1);
    const dailyAvg = total / daySpan;

    return {
      success: true,
      output: `Spending Summary (${period}):\n${lines.join("\n")}\n\n  ${"─".repeat(50)}\n  Total: ${symbol}${total.toFixed(2)} across ${expenses.length} expenses\n  Daily average: ${symbol}${dailyAvg.toFixed(2)}`,
      data: {
        categories: Object.fromEntries(sorted),
        total,
        count: expenses.length,
        currency,
        dailyAverage: dailyAvg,
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
        output: `No expenses recorded for ${getMonthName(month)} ${year}.`,
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

    const monthName = getMonthName(month);
    const daysInMonth = endOfMonth(new Date(year, month - 1)).getDate();

    const lines = [
      `Monthly Report: ${monthName} ${year}`,
      `${"=".repeat(50)}`,
      "",
      "Category Breakdown:",
      ...sorted.map(([category, data]) => {
        const pct = ((data.total / total) * 100).toFixed(1);
        return `  ${category.padEnd(16)} ${symbol}${data.total.toFixed(2).padStart(10)}  (${pct}%, ${data.count} items)`;
      }),
      "",
      `${"─".repeat(50)}`,
      `  Total:            ${symbol}${total.toFixed(2)}`,
      `  Transactions:     ${monthExpenses.length}`,
      `  Daily average:    ${symbol}${(total / daysInMonth).toFixed(2)}`,
    ];

    // Top expense
    const topExpense = monthExpenses.reduce((max, e) => e.amount > max.amount ? e : max, monthExpenses[0]!);
    lines.push(`  Largest expense:  ${symbol}${topExpense.amount.toFixed(2)} (${topExpense.description})`);

    // Week-by-week breakdown
    lines.push("", "Weekly Breakdown:");
    const weekTotals = new Map<number, number>();
    for (const expense of monthExpenses) {
      const d = new Date(expense.date);
      const weekNum = Math.ceil(d.getDate() / 7);
      weekTotals.set(weekNum, (weekTotals.get(weekNum) ?? 0) + expense.amount);
    }
    for (const [week, weekTotal] of [...weekTotals.entries()].sort((a, b) => a[0] - b[0])) {
      lines.push(`  Week ${week}: ${symbol}${weekTotal.toFixed(2)}`);
    }

    // Previous month comparison
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevPrefix = `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
    const prevExpenses = store.expenses.filter((e) => e.date.startsWith(prevPrefix));
    const prevTotal = prevExpenses.reduce((sum, e) => sum + e.amount, 0);

    if (prevTotal > 0) {
      const change = ((total - prevTotal) / prevTotal) * 100;
      const direction = change >= 0 ? "up" : "down";
      lines.push("");
      lines.push(
        `  vs. ${getMonthName(prevMonth)}:  ${direction} ${Math.abs(change).toFixed(1)}% (${symbol}${prevTotal.toFixed(2)})`
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

  private async deleteExpense(input: Record<string, unknown>): Promise<SkillResult> {
    const id = input["id"] as string;
    if (!id) {
      return { success: false, output: "Specify an expense ID to delete.", error: "Missing ID" };
    }

    const store = await this.loadStore();
    const index = store.expenses.findIndex((e) => e.id === id);
    if (index === -1) {
      return { success: false, output: `Expense "${id}" not found.`, error: "Not found" };
    }

    const removed = store.expenses.splice(index, 1)[0]!;
    await this.saveStore(store);

    const symbol = this.getCurrencySymbol(removed.currency);
    return {
      success: true,
      output: `Deleted expense: ${symbol}${removed.amount.toFixed(2)} for "${removed.description}" on ${removed.date}`,
      data: { deleted: removed } as unknown as Record<string, unknown>,
    };
  }

  private async searchExpenses(input: Record<string, unknown>): Promise<SkillResult> {
    const query = ((input["query"] as string) ?? "").toLowerCase();
    if (!query) {
      return { success: false, output: "Specify a search query.", error: "Missing query" };
    }

    const store = await this.loadStore();
    const matches = store.expenses.filter(
      (e) =>
        e.description.toLowerCase().includes(query) ||
        e.category.includes(query) ||
        e.tags.some((t) => t.toLowerCase().includes(query))
    );

    if (matches.length === 0) {
      return { success: true, output: `No expenses matching "${query}".` };
    }

    matches.sort((a, b) => b.date.localeCompare(a.date));

    const lines = matches.slice(0, 20).map((e) => {
      const symbol = this.getCurrencySymbol(e.currency);
      return `- ${e.date} | ${symbol}${e.amount.toFixed(2)} | ${e.category} | ${e.description}`;
    });

    const total = matches.reduce((sum, e) => sum + e.amount, 0);
    const symbol = this.getCurrencySymbol(matches[0]?.currency ?? "INR");

    return {
      success: true,
      output: `Search results for "${query}" (${matches.length} matches):\n${lines.join("\n")}\n\nTotal: ${symbol}${total.toFixed(2)}`,
      data: { matches: matches.slice(0, 20), total } as unknown as Record<string, unknown>,
    };
  }

  // ─── Natural Language Parsing ──────────────────────────────────────────

  private parseNaturalLanguage(
    text: string
  ): Record<string, unknown> | null {
    const normalized = text.toLowerCase().trim();

    // Match amount with currency: $50, 2000, 15, etc.
    const amountPatterns = [
      /(?:[$\u20B9\u20AC\u00A3\u00A5])\s*([0-9]+(?:\.[0-9]{1,2})?)/,
      /([0-9]+(?:\.[0-9]{1,2})?)\s*(?:dollars?|usd|inr|rupees?|euros?|eur|pounds?|gbp)/i,
      /(?:for|of|about|around)\s*(?:[$\u20B9\u20AC\u00A3\u00A5])?\s*([0-9]+(?:\.[0-9]{1,2})?)/,
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

    // Extract description -- text after "on", "for", "at"
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

    // Extract date hints
    let date = "today";
    if (/yesterday/i.test(normalized)) date = "yesterday";
    const daysAgo = normalized.match(/(\d+)\s*days?\s*ago/);
    if (daysAgo) date = `${daysAgo[1]} days ago`;

    return { amount, currency, description, date };
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
      INR: "\u20B9",
      EUR: "\u20AC",
      GBP: "\u00A3",
      JPY: "\u00A5",
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
