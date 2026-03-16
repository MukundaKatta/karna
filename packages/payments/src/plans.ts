import { z } from "zod";

// ─── Plan Definitions ───────────────────────────────────────────────────────

export const PLANS = {
  free: {
    name: "Open Source",
    price: 0,
    agents: 1,
    channels: 1,
    messagesPerMonth: 1000,
    voice: false,
    api: false,
  },
  basic: {
    name: "Karna Cloud Basic",
    price: 9,
    agents: 1,
    channels: 3,
    messagesPerMonth: 10000,
    voice: false,
    api: false,
  },
  pro: {
    name: "Karna Cloud Pro",
    price: 29,
    agents: 3,
    channels: -1,
    messagesPerMonth: 50000,
    voice: true,
    api: false,
  },
  team: {
    name: "Karna Cloud Team",
    price: 49,
    agents: 10,
    channels: -1,
    messagesPerMonth: 200000,
    voice: true,
    api: true,
  },
} as const;

export type PlanId = keyof typeof PLANS;
export type Plan = (typeof PLANS)[PlanId];

// ─── Stripe Price IDs ───────────────────────────────────────────────────────

export const STRIPE_PRICE_IDS: Record<Exclude<PlanId, "free">, string> = {
  basic: process.env["STRIPE_PRICE_BASIC"] ?? "price_karna_basic_9",
  pro: process.env["STRIPE_PRICE_PRO"] ?? "price_karna_pro_29",
  team: process.env["STRIPE_PRICE_TEAM"] ?? "price_karna_team_49",
};

// ─── Razorpay Plan IDs (INR) ────────────────────────────────────────────────

export const RAZORPAY_PLAN_IDS: Record<Exclude<PlanId, "free">, string> = {
  basic: process.env["RAZORPAY_PLAN_BASIC"] ?? "plan_karna_basic_749",
  pro: process.env["RAZORPAY_PLAN_PRO"] ?? "plan_karna_pro_2399",
  team: process.env["RAZORPAY_PLAN_TEAM"] ?? "plan_karna_team_3999",
};

// ─── INR Prices ─────────────────────────────────────────────────────────────

export const INR_PRICES: Record<Exclude<PlanId, "free">, number> = {
  basic: 749,
  pro: 2399,
  team: 3999,
};

// ─── Helpers ────────────────────────────────────────────────────────────────

export const PlanIdSchema = z.enum(["free", "basic", "pro", "team"]);

export function getPlan(planId: PlanId): Plan {
  return PLANS[planId];
}

export function getPlanByStripePriceId(priceId: string): PlanId | null {
  for (const [plan, id] of Object.entries(STRIPE_PRICE_IDS)) {
    if (id === priceId) return plan as PlanId;
  }
  return null;
}

export function getPlanByRazorpayPlanId(planId: string): PlanId | null {
  for (const [plan, id] of Object.entries(RAZORPAY_PLAN_IDS)) {
    if (id === planId) return plan as PlanId;
  }
  return null;
}

export function isUnlimited(value: number): boolean {
  return value === -1;
}
