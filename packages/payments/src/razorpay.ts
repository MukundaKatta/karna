import Razorpay from "razorpay";
import { createHmac } from "node:crypto";
import { createLogger } from "@karna/shared";
import type {
  PaymentProvider,
  Customer,
  Subscription,
  Order,
  WebhookEvent,
  CreateCustomerParams,
  CreateSubscriptionParams,
} from "./provider.js";
import { CreateCustomerParamsSchema, CreateSubscriptionParamsSchema, CreateOrderParamsSchema } from "./provider.js";
import { RAZORPAY_PLAN_IDS, type PlanId } from "./plans.js";

// ─── Logger ─────────────────────────────────────────────────────────────────

const logger = createLogger({ name: "karna-payments-razorpay" });

// ─── Types ──────────────────────────────────────────────────────────────────

interface RazorpaySubscriptionResponse {
  id: string;
  plan_id: string;
  customer_id: string;
  status: string;
  current_start: number | null;
  current_end: number | null;
  ended_at: number | null;
}

interface RazorpayOrderResponse {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status: string;
}

interface RazorpayCustomerResponse {
  id: string;
  email: string;
  name: string;
}

interface RazorpayWebhookPayload {
  entity: string;
  account_id: string;
  event: string;
  contains: string[];
  payload: Record<string, { entity: Record<string, unknown> }>;
  created_at: number;
}

// ─── Razorpay Payment Provider ──────────────────────────────────────────────

export class RazorpayPaymentProvider implements PaymentProvider {
  public readonly name = "razorpay";
  private readonly razorpay: InstanceType<typeof Razorpay>;
  private readonly webhookSecret: string;

  constructor(options?: { keyId?: string; keySecret?: string; webhookSecret?: string }) {
    const keyId = options?.keyId ?? process.env["RAZORPAY_KEY_ID"];
    const keySecret = options?.keySecret ?? process.env["RAZORPAY_KEY_SECRET"];

    if (!keyId || !keySecret) {
      throw new Error(
        "Razorpay key ID and key secret are required. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET env vars.",
      );
    }

    this.webhookSecret = options?.webhookSecret ?? process.env["RAZORPAY_WEBHOOK_SECRET"] ?? "";
    this.razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });

    logger.info("Razorpay payment provider initialized");
  }

  // ─── Customer Management ────────────────────────────────────────────────

  async createCustomer(params: CreateCustomerParams): Promise<Customer> {
    const validated = CreateCustomerParamsSchema.parse(params);

    logger.info({ email: validated.email }, "Creating Razorpay customer");

    const customer = (await this.razorpay.customers.create({
      name: validated.name,
      email: validated.email,
      notes: validated.metadata ?? {},
    })) as unknown as RazorpayCustomerResponse;

    logger.info({ customerId: customer.id }, "Razorpay customer created");

    return {
      id: customer.id,
      email: customer.email,
      name: customer.name,
      metadata: validated.metadata ?? {},
      provider: this.name,
    };
  }

  // ─── Subscription Management ────────────────────────────────────────────

  async createSubscription(params: CreateSubscriptionParams): Promise<Subscription> {
    const validated = CreateSubscriptionParamsSchema.parse(params);

    logger.info({ customerId: validated.customerId, planId: validated.priceId }, "Creating Razorpay subscription");

    const createParams = {
      plan_id: validated.priceId,
      total_count: 120,
      notes: validated.metadata ?? {},
    };
    const subscription = (await (this.razorpay.subscriptions as any).create(createParams)) as unknown as RazorpaySubscriptionResponse;

    logger.info({ subscriptionId: subscription.id }, "Razorpay subscription created");

    return this.mapSubscription(subscription);
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    if (!subscriptionId) {
      throw new Error("Subscription ID is required");
    }

    logger.info({ subscriptionId }, "Canceling Razorpay subscription");

    await this.razorpay.subscriptions.cancel(subscriptionId, false);

    logger.info({ subscriptionId }, "Razorpay subscription canceled");
  }

  async getSubscription(subscriptionId: string): Promise<Subscription> {
    if (!subscriptionId) {
      throw new Error("Subscription ID is required");
    }

    const subscription = (await this.razorpay.subscriptions.fetch(
      subscriptionId,
    )) as unknown as RazorpaySubscriptionResponse;

    return this.mapSubscription(subscription);
  }

  // ─── Orders ─────────────────────────────────────────────────────────────

  async createOrder(amount: number, currency: string, receipt: string): Promise<Order> {
    CreateOrderParamsSchema.parse({ amount, currency, receipt });

    logger.info({ amount, currency, receipt }, "Creating Razorpay order");

    const order = (await this.razorpay.orders.create({
      amount,
      currency,
      receipt,
    })) as unknown as RazorpayOrderResponse;

    logger.info({ orderId: order.id }, "Razorpay order created");

    return {
      id: order.id,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt,
      status: order.status,
      provider: this.name,
    };
  }

  // ─── Payment Verification ─────────────────────────────────────────────

  verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
    if (!orderId || !paymentId || !signature) {
      throw new Error("Order ID, payment ID, and signature are required for verification");
    }

    const keySecret = process.env["RAZORPAY_KEY_SECRET"];
    if (!keySecret) {
      throw new Error("RAZORPAY_KEY_SECRET is required for signature verification");
    }

    const body = `${orderId}|${paymentId}`;
    const expectedSignature = createHmac("sha256", keySecret).update(body).digest("hex");

    logger.debug({ orderId, paymentId }, "Verifying Razorpay payment signature");

    return expectedSignature === signature;
  }

  // ─── Webhooks ─────────────────────────────────────────────────────────

  async handleWebhook(payload: unknown, signature: string): Promise<WebhookEvent> {
    if (!this.webhookSecret) {
      throw new Error("Razorpay webhook secret is not configured. Set RAZORPAY_WEBHOOK_SECRET env var.");
    }

    const rawBody = typeof payload === "string" ? payload : JSON.stringify(payload);
    const expectedSignature = createHmac("sha256", this.webhookSecret).update(rawBody).digest("hex");

    if (expectedSignature !== signature) {
      logger.warn("Invalid Razorpay webhook signature");
      throw new Error("Invalid webhook signature");
    }

    const event = (typeof payload === "string" ? JSON.parse(payload) : payload) as RazorpayWebhookPayload;

    logger.info({ event: event.event }, "Razorpay webhook event received");

    return {
      id: `rzp_evt_${event.created_at}`,
      type: event.event,
      data: event.payload as unknown as Record<string, unknown>,
      provider: this.name,
      createdAt: new Date(event.created_at * 1000),
    };
  }

  // ─── Plan ID Helpers ──────────────────────────────────────────────────

  getPlanId(plan: Exclude<PlanId, "free">): string {
    return RAZORPAY_PLAN_IDS[plan];
  }

  // ─── Private Helpers ──────────────────────────────────────────────────

  private mapSubscription(sub: RazorpaySubscriptionResponse): Subscription {
    return {
      id: sub.id,
      customerId: sub.customer_id,
      priceId: sub.plan_id,
      status: this.mapStatus(sub.status),
      currentPeriodStart: sub.current_start ? new Date(sub.current_start * 1000) : new Date(),
      currentPeriodEnd: sub.current_end ? new Date(sub.current_end * 1000) : new Date(),
      cancelAtPeriodEnd: sub.status === "pending" || sub.ended_at !== null,
      provider: this.name,
    };
  }

  private mapStatus(status: string): Subscription["status"] {
    const mapping: Record<string, Subscription["status"]> = {
      created: "incomplete",
      authenticated: "incomplete",
      active: "active",
      pending: "past_due",
      halted: "past_due",
      cancelled: "canceled",
      completed: "canceled",
      expired: "canceled",
      paused: "paused",
    };
    return mapping[status] ?? "incomplete";
  }
}
