// ─── Gmail Pub/Sub Integration ──────────────────────────────────────────────
// Receives push notifications from Gmail when new emails arrive.
// Uses Google Cloud Pub/Sub as the transport layer.
//
// Setup:
// 1. Create a Google Cloud project with Pub/Sub API enabled
// 2. Create a topic and subscription
// 3. Grant Gmail publish access to the topic
// 4. Call gmail.users.watch() to start notifications
// 5. Set GMAIL_PUBSUB_SUBSCRIPTION env var

import pino from "pino";

const logger = pino({ name: "gmail-pubsub" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface GmailNotification {
  emailAddress: string;
  historyId: string;
}

export interface GmailPubSubConfig {
  /** Google Cloud project ID */
  projectId: string;
  /** Pub/Sub topic name */
  topicName: string;
  /** Pub/Sub subscription name */
  subscriptionName: string;
  /** Gmail user email to watch */
  userEmail: string;
  /** Label IDs to watch (default: INBOX) */
  labelIds?: string[];
}

export type GmailNotificationHandler = (notification: GmailNotification) => Promise<void>;

// ─── Gmail Pub/Sub Manager ─────────────────────────────────────────────────

export class GmailPubSubManager {
  private handler: GmailNotificationHandler | null = null;
  private watchTimer: ReturnType<typeof setInterval> | null = null;
  private readonly config: GmailPubSubConfig;
  private lastHistoryId: string | null = null;

  constructor(config: GmailPubSubConfig) {
    this.config = config;
  }

  /**
   * Set the handler called when a Gmail notification arrives.
   */
  onNotification(handler: GmailNotificationHandler): void {
    this.handler = handler;
  }

  /**
   * Start watching Gmail for new messages.
   * Sets up Gmail watch and renews it every 6 days (watch expires after 7 days).
   */
  async start(): Promise<void> {
    logger.info(
      { userEmail: this.config.userEmail, topic: this.config.topicName },
      "Starting Gmail Pub/Sub watch",
    );

    await this.setupWatch();

    // Renew watch every 6 days (Gmail watch expires after 7 days)
    this.watchTimer = setInterval(
      () => this.setupWatch().catch((e) => logger.error({ error: String(e) }, "Failed to renew Gmail watch")),
      6 * 24 * 60 * 60 * 1000,
    );
    this.watchTimer.unref();
  }

  /**
   * Stop watching Gmail.
   */
  async stop(): Promise<void> {
    if (this.watchTimer) {
      clearInterval(this.watchTimer);
      this.watchTimer = null;
    }

    try {
      await this.stopWatch();
    } catch (error) {
      logger.warn({ error: String(error) }, "Failed to stop Gmail watch");
    }

    logger.info("Gmail Pub/Sub stopped");
  }

  /**
   * Handle an incoming Pub/Sub push message.
   * Called from the webhook endpoint.
   */
  async handlePushMessage(data: string): Promise<void> {
    try {
      const decoded = Buffer.from(data, "base64").toString("utf-8");
      const notification = JSON.parse(decoded) as GmailNotification;

      logger.info(
        { emailAddress: notification.emailAddress, historyId: notification.historyId },
        "Gmail notification received",
      );

      // Avoid processing duplicate notifications
      if (this.lastHistoryId === notification.historyId) {
        logger.debug("Duplicate notification, skipping");
        return;
      }
      this.lastHistoryId = notification.historyId;

      if (this.handler) {
        await this.handler(notification);
      }
    } catch (error) {
      logger.error({ error: String(error) }, "Failed to process Gmail push message");
    }
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  private async setupWatch(): Promise<void> {
    try {
      // Call Gmail API via HTTP to avoid googleapis dependency in gateway
      const accessToken = process.env["GMAIL_ACCESS_TOKEN"];
      if (!accessToken) {
        logger.warn("GMAIL_ACCESS_TOKEN not set — Gmail watch requires OAuth token");
        return;
      }

      const topicName = `projects/${this.config.projectId}/topics/${this.config.topicName}`;
      const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/watch", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          topicName,
          labelIds: this.config.labelIds ?? ["INBOX"],
        }),
      });

      if (!response.ok) {
        throw new Error(`Gmail watch API returned ${response.status}: ${await response.text()}`);
      }

      const data = await response.json() as { historyId?: string; expiration?: string };
      this.lastHistoryId = data.historyId ?? null;

      logger.info(
        { historyId: this.lastHistoryId, expiration: data.expiration },
        "Gmail watch established",
      );
    } catch (error) {
      logger.error({ error: String(error) }, "Failed to setup Gmail watch");
      throw error;
    }
  }

  private async stopWatch(): Promise<void> {
    const accessToken = process.env["GMAIL_ACCESS_TOKEN"];
    if (!accessToken) return;

    await fetch("https://gmail.googleapis.com/gmail/v1/users/me/stop", {
      method: "POST",
      headers: { "Authorization": `Bearer ${accessToken}` },
    });
    logger.info("Gmail watch stopped");
  }
}

/**
 * Create a Fastify route handler for Gmail Pub/Sub push notifications.
 */
export function createGmailPubSubWebhook(manager: GmailPubSubManager) {
  return async (request: { body: { message?: { data?: string } } }, reply: { send: (body: unknown) => void }) => {
    const data = request.body?.message?.data;
    if (!data) {
      reply.send({ error: "No message data" });
      return;
    }

    await manager.handlePushMessage(data);
    reply.send({ ok: true });
  };
}
