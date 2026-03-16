// ─── Stripe Webhook Handler ─────────────────────────────────────────────────
//
// Parses and verifies Stripe webhook events, formatting them as
// natural language messages for the agent.
//
// ─────────────────────────────────────────────────────────────────────────────

import { createHmac, timingSafeEqual } from "node:crypto";
import pino from "pino";

const logger = pino({ name: "webhook-stripe" });

// ─── Types ──────────────────────────────────────────────────────────────────

export type StripeEventType =
  | "payment_intent.succeeded"
  | "customer.subscription.created"
  | "customer.subscription.updated"
  | "customer.subscription.deleted"
  | "invoice.paid"
  | "unknown";

export interface StripeEvent {
  /** Stripe event ID. */
  id: string;
  /** The event type. */
  type: StripeEventType;
  /** Human-readable summary. */
  summary: string;
  /** The event data object. */
  data: Record<string, unknown>;
  /** Timestamp of the event. */
  created: number;
  /** Full raw payload. */
  raw: Record<string, unknown>;
}

// ─── Signature Verification ─────────────────────────────────────────────────

/**
 * Verify Stripe webhook signature (Stripe-Signature header).
 *
 * Stripe uses the `v1` scheme: `t=timestamp,v1=signature`.
 * Signature = HMAC-SHA256(timestamp + "." + rawBody, endpointSecret)
 */
export function verifyStripeSignature(
  rawBody: string | Buffer,
  signatureHeader: string,
  endpointSecret: string,
  toleranceSeconds = 300,
): boolean {
  if (!signatureHeader || !endpointSecret) return false;

  const elements = signatureHeader.split(",");
  const sigMap = new Map<string, string>();

  for (const element of elements) {
    const [key, value] = element.split("=", 2);
    if (key && value) {
      sigMap.set(key.trim(), value.trim());
    }
  }

  const timestamp = sigMap.get("t");
  const signature = sigMap.get("v1");

  if (!timestamp || !signature) {
    logger.warn("Stripe signature header missing t or v1 component");
    return false;
  }

  // Check timestamp tolerance to prevent replay attacks
  const timestampSec = parseInt(timestamp, 10);
  if (isNaN(timestampSec)) return false;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestampSec) > toleranceSeconds) {
    logger.warn(
      { timestampSec, nowSec: now, toleranceSeconds },
      "Stripe webhook timestamp outside tolerance",
    );
    return false;
  }

  // Compute expected signature
  const payload = `${timestamp}.${typeof rawBody === "string" ? rawBody : rawBody.toString("utf-8")}`;
  const expected = createHmac("sha256", endpointSecret)
    .update(payload, "utf8")
    .digest("hex");

  const sigBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  if (sigBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(sigBuffer, expectedBuffer);
}

// ─── Parse Stripe Webhook ───────────────────────────────────────────────────

/**
 * Parse a Stripe webhook payload into a structured event.
 *
 * @param headers - Request headers (must include stripe-signature)
 * @param body - Parsed JSON body
 * @param endpointSecret - Stripe endpoint signing secret
 * @param rawBody - Raw body string for signature verification
 */
export function parseStripeWebhook(
  headers: Record<string, string | undefined>,
  body: Record<string, unknown>,
  endpointSecret?: string,
  rawBody?: string | Buffer,
): StripeEvent {
  // Verify signature if endpoint secret is provided
  if (endpointSecret && rawBody) {
    const signature = headers["stripe-signature"];
    if (!signature) {
      throw new Error("Missing Stripe-Signature header");
    }
    if (!verifyStripeSignature(rawBody, signature, endpointSecret)) {
      throw new Error("Invalid Stripe webhook signature");
    }
  }

  const eventId = (body["id"] as string) ?? "unknown";
  const eventType = (body["type"] as string) ?? "unknown";
  const dataObject = ((body["data"] as Record<string, unknown>)?.["object"] as Record<string, unknown>) ?? {};
  const created = (body["created"] as number) ?? Date.now() / 1000;

  const event: StripeEvent = {
    id: eventId,
    type: normalizeEventType(eventType),
    summary: formatEventSummary(eventType, dataObject),
    data: dataObject,
    created,
    raw: body,
  };

  logger.debug(
    { id: event.id, type: event.type },
    "Parsed Stripe webhook event",
  );

  return event;
}

// ─── Event Formatting ───────────────────────────────────────────────────────

function normalizeEventType(type: string): StripeEventType {
  switch (type) {
    case "payment_intent.succeeded":
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "invoice.paid":
      return type;
    default:
      return "unknown";
  }
}

function formatEventSummary(
  type: string,
  data: Record<string, unknown>,
): string {
  switch (type) {
    case "payment_intent.succeeded":
      return formatPaymentSucceeded(data);
    case "customer.subscription.created":
      return formatSubscription("created", data);
    case "customer.subscription.updated":
      return formatSubscription("updated", data);
    case "customer.subscription.deleted":
      return formatSubscription("deleted", data);
    case "invoice.paid":
      return formatInvoicePaid(data);
    default:
      return `[Stripe] Event "${type}" received`;
  }
}

function formatPaymentSucceeded(data: Record<string, unknown>): string {
  const amount = (data["amount"] as number) ?? 0;
  const currency = ((data["currency"] as string) ?? "usd").toUpperCase();
  const customer = (data["customer"] as string) ?? "unknown";
  const description = (data["description"] as string) ?? "";

  const amountFormatted = (amount / 100).toFixed(2);

  return `[Stripe Payment] Payment of ${amountFormatted} ${currency} succeeded for customer ${customer}${description ? `: ${description}` : ""}`;
}

function formatSubscription(action: string, data: Record<string, unknown>): string {
  const customer = (data["customer"] as string) ?? "unknown";
  const status = (data["status"] as string) ?? "";
  const items = data["items"] as Record<string, unknown> | undefined;
  const itemsData = (items?.["data"] as Array<Record<string, unknown>>) ?? [];
  const planName = itemsData[0]
    ? ((itemsData[0]["plan"] as Record<string, unknown>)?.["nickname"] as string) ?? "unknown plan"
    : "unknown plan";

  return `[Stripe Subscription] Subscription ${action} for customer ${customer} on "${planName}" (status: ${status})`;
}

function formatInvoicePaid(data: Record<string, unknown>): string {
  const amountPaid = (data["amount_paid"] as number) ?? 0;
  const currency = ((data["currency"] as string) ?? "usd").toUpperCase();
  const customer = (data["customer"] as string) ?? "unknown";
  const invoiceNumber = (data["number"] as string) ?? "N/A";

  const amountFormatted = (amountPaid / 100).toFixed(2);

  return `[Stripe Invoice] Invoice ${invoiceNumber} paid: ${amountFormatted} ${currency} by customer ${customer}`;
}
