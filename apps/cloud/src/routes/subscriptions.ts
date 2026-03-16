import type { FastifyInstance } from "fastify";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createLogger } from "@karna/shared";
import {
  PLANS,
  STRIPE_PRICE_IDS,
  StripePaymentProvider,
  RazorpayPaymentProvider,
  getPlanByStripePriceId,
  getPlanByRazorpayPlanId,
  PlanIdSchema,
  type PlanId,
} from "@karna/payments";
import { authMiddleware } from "../middleware/auth.js";

// ─── Logger ─────────────────────────────────────────────────────────────────

const logger = createLogger({ name: "karna-cloud-routes-subscriptions" });

// ─── Schemas ────────────────────────────────────────────────────────────────

const CheckoutSchema = z.object({
  planId: PlanIdSchema.refine((val) => val !== "free", { message: "Cannot checkout for the free plan" }),
  provider: z.enum(["stripe", "razorpay"]).default("stripe"),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

// ─── Route Registration ─────────────────────────────────────────────────────

export async function subscriptionRoutes(server: FastifyInstance): Promise<void> {
  const supabaseUrl = process.env["SUPABASE_URL"];
  const supabaseServiceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];

  const supabase: SupabaseClient | null =
    supabaseUrl && supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey) : null;

  function requireSupabase(): SupabaseClient {
    if (!supabase) {
      throw { statusCode: 503, message: "Database service is not configured" };
    }
    return supabase;
  }

  // Lazy-init payment providers (only when env vars are available)
  let stripeProvider: StripePaymentProvider | null = null;
  let razorpayProvider: RazorpayPaymentProvider | null = null;

  function getStripe(): StripePaymentProvider {
    if (!stripeProvider) {
      stripeProvider = new StripePaymentProvider();
    }
    return stripeProvider;
  }

  function getRazorpay(): RazorpayPaymentProvider {
    if (!razorpayProvider) {
      razorpayProvider = new RazorpayPaymentProvider();
    }
    return razorpayProvider;
  }

  // ─── GET /subscriptions/plans ─────────────────────────────────────────

  server.get("/subscriptions/plans", async (_request, reply) => {
    const plans = Object.entries(PLANS).map(([id, plan]) => ({
      id,
      ...plan,
    }));

    return reply.send({ plans });
  });

  // ─── POST /subscriptions/checkout ─────────────────────────────────────

  server.post("/subscriptions/checkout", { preHandler: [authMiddleware] }, async (request, reply) => {
    const parseResult = CheckoutSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    const user = request.user!;
    const { planId, provider, successUrl, cancelUrl } = parseResult.data;
    const sb = requireSupabase();

    const defaultSuccessUrl = process.env["CHECKOUT_SUCCESS_URL"] ?? "https://cloud.karna.ai/billing?success=true";
    const defaultCancelUrl = process.env["CHECKOUT_CANCEL_URL"] ?? "https://cloud.karna.ai/billing?canceled=true";

    logger.info({ userId: user.userId, planId, provider }, "Creating checkout session");

    if (provider === "stripe") {
      const stripe = getStripe();

      // Ensure user has a Stripe customer ID
      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.createCustomer({
          email: user.email,
          name: user.email,
          metadata: { userId: user.userId, karnaCloud: "true" },
        });
        customerId = customer.id;

        // Save customer ID
        await sb
          .from("cloud_users")
          .update({ stripe_customer_id: customerId })
          .eq("user_id", user.userId);
      }

      const priceId = STRIPE_PRICE_IDS[planId as Exclude<PlanId, "free">];
      const session = await stripe.createCheckoutSession(
        priceId,
        successUrl ?? defaultSuccessUrl,
        cancelUrl ?? defaultCancelUrl,
        customerId,
      );

      return reply.send({ url: session.url, sessionId: session.id, provider: "stripe" });
    }

    if (provider === "razorpay") {
      const razorpay = getRazorpay();

      let customerId = user.razorpayCustomerId;
      if (!customerId) {
        const customer = await razorpay.createCustomer({
          email: user.email,
          name: user.email,
          metadata: { userId: user.userId },
        });
        customerId = customer.id;

        await sb
          .from("cloud_users")
          .update({ razorpay_customer_id: customerId })
          .eq("user_id", user.userId);
      }

      const planRzpId = razorpay.getPlanId(planId as Exclude<PlanId, "free">);
      const subscription = await razorpay.createSubscription({
        customerId,
        priceId: planRzpId,
      });

      return reply.send({
        subscriptionId: subscription.id,
        provider: "razorpay",
      });
    }

    return reply.status(400).send({ error: "Unsupported payment provider" });
  });

  // ─── GET /subscriptions/current ───────────────────────────────────────

  server.get("/subscriptions/current", { preHandler: [authMiddleware] }, async (request, reply) => {
    const user = request.user!;
    const sb = requireSupabase();

    const { data: profile } = await sb
      .from("cloud_users")
      .select("plan, stripe_customer_id, razorpay_customer_id, usage_reset_at")
      .eq("user_id", user.userId)
      .single();

    if (!profile) {
      return reply.status(404).send({ error: "User profile not found" });
    }

    const planId = (profile.plan ?? "free") as PlanId;
    const planConfig = PLANS[planId] ?? PLANS.free;

    const result: Record<string, unknown> = {
      plan: { id: planId, ...planConfig },
      usageResetAt: profile.usage_reset_at,
    };

    // Fetch active subscription details from payment provider
    if (profile.stripe_customer_id && planId !== "free") {
      try {
        const stripe = getStripe();
        const invoices = await stripe.listInvoices(profile.stripe_customer_id);
        result["latestInvoice"] = invoices[0] ?? null;
      } catch (error) {
        logger.debug({ error: String(error) }, "Failed to fetch Stripe subscription details");
      }
    }

    return reply.send(result);
  });

  // ─── POST /subscriptions/cancel ───────────────────────────────────────

  server.post("/subscriptions/cancel", { preHandler: [authMiddleware] }, async (request, reply) => {
    const user = request.user!;
    const sb = requireSupabase();

    const { data: profile } = await sb
      .from("cloud_users")
      .select("plan, stripe_customer_id, razorpay_customer_id")
      .eq("user_id", user.userId)
      .single();

    if (!profile || profile.plan === "free") {
      return reply.status(400).send({ error: "No active subscription to cancel" });
    }

    logger.info({ userId: user.userId, plan: profile.plan }, "Canceling subscription");

    // For now, downgrade to free immediately
    // In production, this would cancel at period end via the payment provider
    await sb
      .from("cloud_users")
      .update({ plan: "free" })
      .eq("user_id", user.userId);

    return reply.send({ message: "Subscription canceled. You will be downgraded to the free plan." });
  });

  // ─── POST /subscriptions/webhooks/stripe ──────────────────────────────

  server.post("/subscriptions/webhooks/stripe", async (request, reply) => {
    const signature = request.headers["stripe-signature"] as string;
    if (!signature) {
      return reply.status(400).send({ error: "Missing stripe-signature header" });
    }

    try {
      const stripe = getStripe();
      const event = await stripe.handleWebhook(request.body, signature);
      const sb = requireSupabase();

      logger.info({ eventType: event.type, eventId: event.id }, "Processing Stripe webhook");

      switch (event.type) {
        case "customer.subscription.created":
        case "customer.subscription.updated": {
          const subData = event.data as Record<string, unknown>;
          const customerId = subData["customer"] as string;
          const status = subData["status"] as string;
          const priceId = ((subData["items"] as Record<string, unknown>)?.["data"] as Array<Record<string, unknown>>)?.[0]?.["price"] as Record<string, unknown>;
          const planId = priceId ? getPlanByStripePriceId(priceId["id"] as string) : null;

          if (status === "active" && planId) {
            await sb
              .from("cloud_users")
              .update({ plan: planId })
              .eq("stripe_customer_id", customerId);

            logger.info({ customerId, planId }, "User plan updated via Stripe webhook");
          }
          break;
        }

        case "customer.subscription.deleted": {
          const subData = event.data as Record<string, unknown>;
          const customerId = subData["customer"] as string;

          await sb
            .from("cloud_users")
            .update({ plan: "free" })
            .eq("stripe_customer_id", customerId);

          logger.info({ customerId }, "User downgraded to free via Stripe webhook");
          break;
        }

        default:
          logger.debug({ eventType: event.type }, "Unhandled Stripe webhook event");
      }

      return reply.send({ received: true });
    } catch (error) {
      logger.error({ error: String(error) }, "Failed to process Stripe webhook");
      return reply.status(400).send({ error: "Webhook processing failed" });
    }
  });

  // ─── POST /subscriptions/webhooks/razorpay ────────────────────────────

  server.post("/subscriptions/webhooks/razorpay", async (request, reply) => {
    const signature = request.headers["x-razorpay-signature"] as string;
    if (!signature) {
      return reply.status(400).send({ error: "Missing x-razorpay-signature header" });
    }

    try {
      const razorpay = getRazorpay();
      const event = await razorpay.handleWebhook(request.body, signature);
      const sb = requireSupabase();

      logger.info({ eventType: event.type, eventId: event.id }, "Processing Razorpay webhook");

      switch (event.type) {
        case "subscription.activated": {
          const payload = event.data as Record<string, Record<string, Record<string, unknown>>>;
          const sub = payload["subscription"]?.["entity"];
          const customerId = sub?.["customer_id"] as string;
          const planRzpId = sub?.["plan_id"] as string;
          const planId = getPlanByRazorpayPlanId(planRzpId);

          if (planId) {
            await sb
              .from("cloud_users")
              .update({ plan: planId })
              .eq("razorpay_customer_id", customerId);

            logger.info({ customerId, planId }, "User plan updated via Razorpay webhook");
          }
          break;
        }

        case "subscription.cancelled":
        case "subscription.completed": {
          const payload = event.data as Record<string, Record<string, Record<string, unknown>>>;
          const sub = payload["subscription"]?.["entity"];
          const customerId = sub?.["customer_id"] as string;

          await sb
            .from("cloud_users")
            .update({ plan: "free" })
            .eq("razorpay_customer_id", customerId);

          logger.info({ customerId }, "User downgraded to free via Razorpay webhook");
          break;
        }

        default:
          logger.debug({ eventType: event.type }, "Unhandled Razorpay webhook event");
      }

      return reply.send({ received: true });
    } catch (error) {
      logger.error({ error: String(error) }, "Failed to process Razorpay webhook");
      return reply.status(400).send({ error: "Webhook processing failed" });
    }
  });
}
