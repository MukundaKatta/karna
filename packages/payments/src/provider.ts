import { z } from "zod";

// ─── Schemas ────────────────────────────────────────────────────────────────

export const CreateCustomerParamsSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  metadata: z.record(z.string()).optional(),
});

export const CreateSubscriptionParamsSchema = z.object({
  customerId: z.string().min(1),
  priceId: z.string().min(1),
  metadata: z.record(z.string()).optional(),
});

export const CreateCheckoutParamsSchema = z.object({
  priceId: z.string().min(1),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
  customerId: z.string().min(1).optional(),
  metadata: z.record(z.string()).optional(),
});

export const CreateOrderParamsSchema = z.object({
  amount: z.number().int().positive(),
  currency: z.string().length(3),
  receipt: z.string().min(1),
  metadata: z.record(z.string()).optional(),
});

// ─── Types ──────────────────────────────────────────────────────────────────

export type CreateCustomerParams = z.infer<typeof CreateCustomerParamsSchema>;
export type CreateSubscriptionParams = z.infer<typeof CreateSubscriptionParamsSchema>;
export type CreateCheckoutParams = z.infer<typeof CreateCheckoutParamsSchema>;
export type CreateOrderParams = z.infer<typeof CreateOrderParamsSchema>;

export interface Customer {
  id: string;
  email: string;
  name: string;
  metadata: Record<string, string>;
  provider: string;
}

export interface Subscription {
  id: string;
  customerId: string;
  priceId: string;
  status: "active" | "canceled" | "past_due" | "trialing" | "incomplete" | "paused";
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  provider: string;
}

export interface Invoice {
  id: string;
  customerId: string;
  amountDue: number;
  amountPaid: number;
  currency: string;
  status: string;
  createdAt: Date;
  pdfUrl: string | null;
  provider: string;
}

export interface CheckoutSession {
  id: string;
  url: string;
  provider: string;
}

export interface Order {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status: string;
  provider: string;
}

export interface WebhookEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
  provider: string;
  createdAt: Date;
}

// ─── Payment Provider Interface ─────────────────────────────────────────────

export interface PaymentProvider {
  name: string;
  createCustomer(params: CreateCustomerParams): Promise<Customer>;
  createSubscription(params: CreateSubscriptionParams): Promise<Subscription>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  getSubscription(subscriptionId: string): Promise<Subscription>;
  handleWebhook(payload: unknown, signature: string): Promise<WebhookEvent>;
}
