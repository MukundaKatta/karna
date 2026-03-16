import { createLogger } from "@karna/shared";
import { z } from "zod";
import { PLANS, type PlanId } from "./plans.js";

// ─── Logger ─────────────────────────────────────────────────────────────────

const logger = createLogger({ name: "karna-payments-usage" });

// ─── Schemas ────────────────────────────────────────────────────────────────

export const UsagePeriodSchema = z.enum(["daily", "monthly"]);
export type UsagePeriod = z.infer<typeof UsagePeriodSchema>;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface UsageRecord {
  agentId: string;
  channel: string;
  messages: number;
  tokensIn: number;
  tokensOut: number;
  date: string; // ISO date YYYY-MM-DD
}

export interface UsageReport {
  agentId: string;
  period: UsagePeriod;
  startDate: string;
  endDate: string;
  totalMessages: number;
  totalTokensIn: number;
  totalTokensOut: number;
  costCents: number;
  daily: UsageRecord[];
}

export interface LimitCheckResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  used: number;
  resetAt: Date;
}

export interface UsageStore {
  increment(key: string, field: string, amount: number): Promise<number>;
  get(key: string, field: string): Promise<number>;
  getAll(key: string): Promise<Record<string, number>>;
  reset(key: string): Promise<void>;
  setExpiry(key: string, expiresAt: Date): Promise<void>;
}

// ─── In-Memory Usage Store (default, for development) ───────────────────────

export class InMemoryUsageStore implements UsageStore {
  private data = new Map<string, Map<string, number>>();
  private expiries = new Map<string, Date>();

  async increment(key: string, field: string, amount: number): Promise<number> {
    if (!this.data.has(key)) {
      this.data.set(key, new Map());
    }
    const bucket = this.data.get(key)!;
    const current = bucket.get(field) ?? 0;
    const updated = current + amount;
    bucket.set(field, updated);
    return updated;
  }

  async get(key: string, field: string): Promise<number> {
    return this.data.get(key)?.get(field) ?? 0;
  }

  async getAll(key: string): Promise<Record<string, number>> {
    const bucket = this.data.get(key);
    if (!bucket) return {};
    return Object.fromEntries(bucket.entries());
  }

  async reset(key: string): Promise<void> {
    this.data.delete(key);
  }

  async setExpiry(key: string, expiresAt: Date): Promise<void> {
    this.expiries.set(key, expiresAt);
  }

  /** Check and purge expired keys. Call periodically. */
  purgeExpired(): void {
    const now = new Date();
    for (const [key, expiry] of this.expiries) {
      if (expiry <= now) {
        this.data.delete(key);
        this.expiries.delete(key);
      }
    }
  }
}

// ─── Usage Meter ────────────────────────────────────────────────────────────

export class UsageMeter {
  private readonly store: UsageStore;

  constructor(store?: UsageStore) {
    this.store = store ?? new InMemoryUsageStore();
    logger.info("Usage meter initialized");
  }

  // ─── Tracking ───────────────────────────────────────────────────────────

  async trackMessage(agentId: string, channel: string): Promise<number> {
    if (!agentId) throw new Error("Agent ID is required");

    const dateKey = this.getDateKey();
    const bucketKey = this.getBucketKey(agentId, dateKey);

    const count = await this.store.increment(bucketKey, "messages", 1);
    await this.store.increment(bucketKey, `messages:${channel}`, 1);

    logger.debug({ agentId, channel, totalMessages: count }, "Message tracked");

    return count;
  }

  async trackTokens(agentId: string, inputTokens: number, outputTokens: number): Promise<void> {
    if (!agentId) throw new Error("Agent ID is required");
    if (inputTokens < 0 || outputTokens < 0) throw new Error("Token counts must be non-negative");

    const dateKey = this.getDateKey();
    const bucketKey = this.getBucketKey(agentId, dateKey);

    await this.store.increment(bucketKey, "tokens_in", inputTokens);
    await this.store.increment(bucketKey, "tokens_out", outputTokens);

    logger.debug({ agentId, inputTokens, outputTokens }, "Tokens tracked");
  }

  // ─── Reporting ──────────────────────────────────────────────────────────

  async getUsage(agentId: string, period: UsagePeriod = "monthly"): Promise<UsageReport> {
    if (!agentId) throw new Error("Agent ID is required");

    const now = new Date();
    const dates = period === "daily" ? [this.getDateKey(now)] : this.getMonthDates(now);

    const daily: UsageRecord[] = [];
    let totalMessages = 0;
    let totalTokensIn = 0;
    let totalTokensOut = 0;

    for (const date of dates) {
      const bucketKey = this.getBucketKey(agentId, date);
      const data = await this.store.getAll(bucketKey);

      const messages = data["messages"] ?? 0;
      const tokensIn = data["tokens_in"] ?? 0;
      const tokensOut = data["tokens_out"] ?? 0;

      totalMessages += messages;
      totalTokensIn += tokensIn;
      totalTokensOut += tokensOut;

      if (messages > 0 || tokensIn > 0 || tokensOut > 0) {
        daily.push({
          agentId,
          channel: "all",
          messages,
          tokensIn,
          tokensOut,
          date,
        });
      }
    }

    // Rough cost estimation: $3/1M input tokens, $15/1M output tokens
    const costCents = Math.ceil((totalTokensIn * 0.3 + totalTokensOut * 1.5) / 100_000);

    return {
      agentId,
      period,
      startDate: dates[0] ?? this.getDateKey(now),
      endDate: dates[dates.length - 1] ?? this.getDateKey(now),
      totalMessages,
      totalTokensIn,
      totalTokensOut,
      costCents,
      daily,
    };
  }

  // ─── Limit Checks ──────────────────────────────────────────────────────

  async checkLimits(agentId: string, plan: PlanId): Promise<LimitCheckResult> {
    if (!agentId) throw new Error("Agent ID is required");

    const planConfig = PLANS[plan];
    const now = new Date();
    const dates = this.getMonthDates(now);

    let totalMessages = 0;
    for (const date of dates) {
      const bucketKey = this.getBucketKey(agentId, date);
      totalMessages += await this.store.get(bucketKey, "messages");
    }

    const limit = planConfig.messagesPerMonth;
    const remaining = Math.max(0, limit - totalMessages);
    const allowed = totalMessages < limit;

    // Reset at the start of next month
    const resetAt = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    logger.debug(
      { agentId, plan, used: totalMessages, limit, remaining, allowed },
      "Limit check performed",
    );

    return { allowed, remaining, limit, used: totalMessages, resetAt };
  }

  // ─── Billing Cycle Reset ──────────────────────────────────────────────

  async resetUsage(agentId: string): Promise<void> {
    if (!agentId) throw new Error("Agent ID is required");

    const now = new Date();
    const dates = this.getMonthDates(now);

    for (const date of dates) {
      const bucketKey = this.getBucketKey(agentId, date);
      await this.store.reset(bucketKey);
    }

    logger.info({ agentId }, "Usage reset for billing cycle");
  }

  // ─── Private Helpers ──────────────────────────────────────────────────

  private getBucketKey(agentId: string, date: string): string {
    return `usage:${agentId}:${date}`;
  }

  private getDateKey(date: Date = new Date()): string {
    return date.toISOString().split("T")[0]!;
  }

  private getMonthDates(now: Date): string[] {
    const dates: string[] = [];
    const year = now.getFullYear();
    const month = now.getMonth();
    const today = now.getDate();

    for (let day = 1; day <= today; day++) {
      const d = new Date(year, month, day);
      dates.push(this.getDateKey(d));
    }

    return dates;
  }
}
