import Stripe from "stripe";
import { createLogger } from "@karna/shared";
import type {
  PaymentProvider,
  Customer,
  Subscription,
  Invoice,
  CheckoutSession,
  WebhookEvent,
  CreateCustomerParams,
  CreateSubscriptionParams,
} from "./provider.js";
import { CreateCustomerParamsSchema, CreateSubscriptionParamsSchema, CreateCheckoutParamsSchema } from "./provider.js";
import { STRIPE_PRICE_IDS, type PlanId } from "./plans.js";

// ─── Logger ─────────────────────────────────────────────────────────────────

const logger = createLogger({ name: "karna-payments-stripe" });

// ─── Stripe Payment Provider ────────────────────────────────────────────────

export class StripePaymentProvider implements PaymentProvider {
  public readonly name = "stripe";
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;

  constructor(options?: { apiKey?: string; webhookSecret?: string }) {
    const apiKey = options?.apiKey ?? process.env["STRIPE_SECRET_KEY"];
    if (!apiKey) {
      throw new Error("Stripe API key is required. Set STRIPE_SECRET_KEY env var or pass apiKey option.");
    }

    this.webhookSecret = options?.webhookSecret ?? process.env["STRIPE_WEBHOOK_SECRET"] ?? "";
    this.stripe = new Stripe(apiKey);

    logger.info("Stripe payment provider initialized");
  }

  // ─── Customer Management ────────────────────────────────────────────────

  async createCustomer(params: CreateCustomerParams): Promise<Customer> {
    const validated = CreateCustomerParamsSchema.parse(params);

    logger.info({ email: validated.email }, "Creating Stripe customer");

    const customer = await this.stripe.customers.create({
      email: validated.email,
      name: validated.name,
      metadata: validated.metadata ?? {},
    });

    logger.info({ customerId: customer.id }, "Stripe customer created");

    return {
      id: customer.id,
      email: customer.email ?? validated.email,
      name: customer.name ?? validated.name,
      metadata: (customer.metadata ?? {}) as Record<string, string>,
      provider: this.name,
    };
  }

  // ─── Subscription Management ────────────────────────────────────────────

  async createSubscription(params: CreateSubscriptionParams): Promise<Subscription> {
    const validated = CreateSubscriptionParamsSchema.parse(params);

    logger.info({ customerId: validated.customerId, priceId: validated.priceId }, "Creating Stripe subscription");

    const subscription = await this.stripe.subscriptions.create({
      customer: validated.customerId,
      items: [{ price: validated.priceId }],
      metadata: validated.metadata ?? {},
      payment_behavior: "default_incomplete",
      expand: ["latest_invoice.payment_intent"],
    });

    logger.info({ subscriptionId: subscription.id }, "Stripe subscription created");

    return this.mapSubscription(subscription);
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    if (!subscriptionId) {
      throw new Error("Subscription ID is required");
    }

    logger.info({ subscriptionId }, "Canceling Stripe subscription");

    await this.stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });

    logger.info({ subscriptionId }, "Stripe subscription set to cancel at period end");
  }

  async updateSubscription(subscriptionId: string, newPriceId: string): Promise<Subscription> {
    if (!subscriptionId || !newPriceId) {
      throw new Error("Subscription ID and new price ID are required");
    }

    logger.info({ subscriptionId, newPriceId }, "Updating Stripe subscription");

    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
    const itemId = subscription.items.data[0]?.id;

    if (!itemId) {
      throw new Error(`No items found on subscription ${subscriptionId}`);
    }

    const updated = await this.stripe.subscriptions.update(subscriptionId, {
      items: [{ id: itemId, price: newPriceId }],
      proration_behavior: "create_prorations",
    });

    logger.info({ subscriptionId: updated.id }, "Stripe subscription updated");

    return this.mapSubscription(updated);
  }

  async getSubscription(subscriptionId: string): Promise<Subscription> {
    if (!subscriptionId) {
      throw new Error("Subscription ID is required");
    }

    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
    return this.mapSubscription(subscription);
  }

  // ─── Invoices ───────────────────────────────────────────────────────────

  async listInvoices(customerId: string): Promise<Invoice[]> {
    if (!customerId) {
      throw new Error("Customer ID is required");
    }

    const invoices = await this.stripe.invoices.list({
      customer: customerId,
      limit: 100,
    });

    return invoices.data.map((inv): Invoice => ({
      id: inv.id,
      customerId: typeof inv.customer === "string" ? inv.customer : inv.customer?.id ?? customerId,
      amountDue: inv.amount_due,
      amountPaid: inv.amount_paid,
      currency: inv.currency,
      status: inv.status ?? "unknown",
      createdAt: new Date(inv.created * 1000),
      pdfUrl: inv.invoice_pdf ?? null,
      provider: this.name,
    }));
  }

  // ─── Checkout ─────────────────────────────────────────────────────────

  async createCheckoutSession(
    priceId: string,
    successUrl: string,
    cancelUrl: string,
    customerId?: string,
  ): Promise<CheckoutSession> {
    CreateCheckoutParamsSchema.parse({ priceId, successUrl, cancelUrl, customerId });

    logger.info({ priceId }, "Creating Stripe checkout session");

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
    };

    if (customerId) {
      sessionParams.customer = customerId;
    }

    const session = await this.stripe.checkout.sessions.create(sessionParams);

    logger.info({ sessionId: session.id }, "Stripe checkout session created");

    return {
      id: session.id,
      url: session.url ?? "",
      provider: this.name,
    };
  }

  // ─── Webhooks ─────────────────────────────────────────────────────────

  async handleWebhook(payload: unknown, signature: string): Promise<WebhookEvent> {
    if (!this.webhookSecret) {
      throw new Error("Stripe webhook secret is not configured. Set STRIPE_WEBHOOK_SECRET env var.");
    }

    const rawBody = typeof payload === "string" ? payload : JSON.stringify(payload);

    const event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);

    logger.info({ eventId: event.id, type: event.type }, "Stripe webhook event received");

    return {
      id: event.id,
      type: event.type,
      data: event.data.object as unknown as Record<string, unknown>,
      provider: this.name,
      createdAt: new Date(event.created * 1000),
    };
  }

  // ─── Price ID Helpers ─────────────────────────────────────────────────

  getPriceId(plan: Exclude<PlanId, "free">): string {
    return STRIPE_PRICE_IDS[plan];
  }

  // ─── Private Helpers ──────────────────────────────────────────────────

  private mapSubscription(sub: Stripe.Subscription): Subscription {
    return {
      id: sub.id,
      customerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
      priceId: sub.items.data[0]?.price?.id ?? "",
      status: this.mapStatus(sub.status),
      currentPeriodStart: new Date(sub.current_period_start * 1000),
      currentPeriodEnd: new Date(sub.current_period_end * 1000),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      provider: this.name,
    };
  }

  private mapStatus(status: Stripe.Subscription.Status): Subscription["status"] {
    const mapping: Record<string, Subscription["status"]> = {
      active: "active",
      canceled: "canceled",
      past_due: "past_due",
      trialing: "trialing",
      incomplete: "incomplete",
      incomplete_expired: "incomplete",
      paused: "paused",
      unpaid: "past_due",
    };
    return mapping[status] ?? "incomplete";
  }
}
