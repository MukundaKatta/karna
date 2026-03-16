// ─── Provider Interface ─────────────────────────────────────────────────────

export type {
  PaymentProvider,
  Customer,
  Subscription,
  Invoice,
  CheckoutSession,
  Order,
  WebhookEvent,
  CreateCustomerParams,
  CreateSubscriptionParams,
  CreateCheckoutParams,
  CreateOrderParams,
} from "./provider.js";

export {
  CreateCustomerParamsSchema,
  CreateSubscriptionParamsSchema,
  CreateCheckoutParamsSchema,
  CreateOrderParamsSchema,
} from "./provider.js";

// ─── Plans ──────────────────────────────────────────────────────────────────

export {
  PLANS,
  STRIPE_PRICE_IDS,
  RAZORPAY_PLAN_IDS,
  INR_PRICES,
  PlanIdSchema,
  getPlan,
  getPlanByStripePriceId,
  getPlanByRazorpayPlanId,
  isUnlimited,
  type PlanId,
  type Plan,
} from "./plans.js";

// ─── Stripe ─────────────────────────────────────────────────────────────────

export { StripePaymentProvider } from "./stripe.js";

// ─── Razorpay ───────────────────────────────────────────────────────────────

export { RazorpayPaymentProvider } from "./razorpay.js";

// ─── Usage ──────────────────────────────────────────────────────────────────

export {
  UsageMeter,
  InMemoryUsageStore,
  UsagePeriodSchema,
  type UsagePeriod,
  type UsageRecord,
  type UsageReport,
  type LimitCheckResult,
  type UsageStore,
} from "./usage.js";
