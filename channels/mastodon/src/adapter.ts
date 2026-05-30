/**
 * Issue #610 — Mastodon channel adapter.
 *
 * Implements mention + direct-message handling and posting via the Mastodon
 * REST API using the global `fetch` only (no external SDK / no new deps).
 *
 * Mirrors the lightweight structure of the other Karna channel adapters: a
 * class with `start()` / `stop()` / `send()` plus an inbound message callback.
 * Inbound events are obtained by polling the notifications timeline (mentions)
 * and the conversations endpoint (DMs), which keeps the adapter dependency-free
 * (no streaming websocket SDK required).
 *
 * Reuses `@karna/shared` capability degradation so outbound posts respect
 * Mastodon's 500-char limit and plain-text constraint.
 */

import { degradeOutput, getCapabilities } from '../../_shared/capabilities.js';

/** Visibility of a posted status. Mirrors Mastodon's API values. */
export type MastodonVisibility = 'public' | 'unlisted' | 'private' | 'direct';

/** Normalized inbound message handed to the runtime. */
export interface MastodonInboundMessage {
  channel: 'mastodon';
  /** Mastodon notification / status id. */
  id: string;
  /** 'mention' for public mentions, 'direct' for DM-style conversations. */
  kind: 'mention' | 'direct';
  /** acct of the sender, e.g. "alice@mastodon.social". */
  from: string;
  /** Plain-text body with surrounding HTML stripped. */
  text: string;
  /** The status id to reply to (for threading). */
  inReplyToId: string;
  /** Conversation id when kind === 'direct'. */
  conversationId?: string;
  /** Raw API object for advanced consumers. */
  raw: unknown;
}

/** Outbound message the adapter knows how to send. */
export interface MastodonOutboundMessage {
  text: string;
  /** Status id to reply to (preserves threads). */
  inReplyToId?: string;
  /** Defaults to 'unlisted' for mentions; 'direct' for DM replies. */
  visibility?: MastodonVisibility;
}

export type InboundHandler = (
  msg: MastodonInboundMessage,
) => void | Promise<void>;

export interface MastodonAdapterOptions {
  /** Base URL of the instance, e.g. "https://mastodon.social". */
  instanceUrl: string;
  /** OAuth access token with read+write scopes. */
  accessToken: string;
  /** Poll interval (ms) for notifications/conversations. Default 15000. */
  pollIntervalMs?: number;
  /** Injectable fetch (defaults to global fetch). Enables testing. */
  fetchFn?: typeof fetch;
  /** Optional structured logger. */
  logger?: {
    info: (obj: unknown, msg?: string) => void;
    warn: (obj: unknown, msg?: string) => void;
    error: (obj: unknown, msg?: string) => void;
  };
}

/** Minimal shape of the Mastodon account object we consume. */
interface MastodonAccount {
  id: string;
  acct: string;
}

/** Minimal shape of the Mastodon status object we consume. */
interface MastodonStatus {
  id: string;
  content: string;
  account: MastodonAccount;
  visibility?: MastodonVisibility;
}

/** Minimal shape of a Mastodon notification object. */
interface MastodonNotification {
  id: string;
  type: string;
  account: MastodonAccount;
  status?: MastodonStatus;
}

/** Minimal shape of a Mastodon conversation object. */
interface MastodonConversation {
  id: string;
  last_status?: MastodonStatus;
}

/**
 * Strip HTML tags Mastodon returns in `content` and decode the handful of
 * entities the API commonly emits. Keeps the adapter dependency-free.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>(\n)?/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/**
 * Mastodon channel adapter. Polls for inbound mentions/DMs and posts replies
 * via the REST API using fetch only.
 */
export class MastodonAdapter {
  readonly name = 'mastodon' as const;

  private readonly baseUrl: string;
  private readonly token: string;
  private readonly pollIntervalMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly logger: MastodonAdapterOptions['logger'];

  private handler: InboundHandler | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  /** Cursor for notifications polling (Mastodon `since_id`). */
  private lastNotificationId: string | undefined;
  /** Cursor for conversations polling. */
  private lastConversationStatusId: string | undefined;
  /** Avoid double-dispatching the same inbound id. */
  private readonly seen = new Set<string>();

  constructor(opts: MastodonAdapterOptions) {
    if (!opts.instanceUrl) throw new Error('Mastodon instanceUrl is required');
    if (!opts.accessToken) throw new Error('Mastodon accessToken is required');
    this.baseUrl = opts.instanceUrl.replace(/\/+$/, '');
    this.token = opts.accessToken;
    this.pollIntervalMs = opts.pollIntervalMs ?? 15000;
    this.fetchFn = opts.fetchFn ?? fetch;
    this.logger = opts.logger;
  }

  /** Register the inbound message handler. */
  onMessage(handler: InboundHandler): void {
    this.handler = handler;
  }

  /** Start polling for inbound mentions and DMs. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    // Verify credentials early so misconfiguration surfaces immediately.
    await this.verifyCredentials();
    // Prime cursors so we only act on messages received after start.
    await this.poll().catch((err) => this.logger?.error({ err }, 'mastodon initial poll failed'));
    this.timer = setInterval(() => {
      this.poll().catch((err) =>
        this.logger?.error({ err }, 'mastodon poll failed'),
      );
    }, this.pollIntervalMs);
  }

  /** Stop polling and release timers. */
  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Whether the adapter is actively polling. */
  isRunning(): boolean {
    return this.running;
  }

  /** Authenticated request helper against the Mastodon REST API. */
  private async api<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `Mastodon API ${init.method ?? 'GET'} ${path} failed: ${res.status} ${body}`,
      );
    }
    // Some endpoints (rare) return empty bodies; guard the parse.
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /** Confirm the access token works; throws on auth failure. */
  async verifyCredentials(): Promise<MastodonAccount> {
    return this.api<MastodonAccount>('/api/v1/accounts/verify_credentials');
  }

  /**
   * Poll notifications (mentions) and conversations (DMs) and dispatch any new
   * inbound messages to the registered handler.
   */
  async poll(): Promise<void> {
    if (!this.running) return;
    await Promise.all([this.pollMentions(), this.pollConversations()]);
  }

  private async pollMentions(): Promise<void> {
    const qs = new URLSearchParams({ 'types[]': 'mention', limit: '40' });
    if (this.lastNotificationId) qs.set('since_id', this.lastNotificationId);
    const notifications = await this.api<MastodonNotification[]>(
      `/api/v1/notifications?${qs.toString()}`,
    );
    if (!Array.isArray(notifications) || notifications.length === 0) return;

    // Notifications come newest-first; advance cursor to the newest id.
    this.lastNotificationId = notifications[0].id;

    // Dispatch oldest-first for natural ordering.
    for (const n of [...notifications].reverse()) {
      if (n.type !== 'mention' || !n.status) continue;
      const status = n.status;
      // Mentions that are 'direct' visibility are handled by conversations.
      if (status.visibility === 'direct') continue;
      if (this.seen.has(n.id)) continue;
      this.seen.add(n.id);
      await this.dispatch({
        channel: 'mastodon',
        id: n.id,
        kind: 'mention',
        from: status.account.acct,
        text: stripHtml(status.content),
        inReplyToId: status.id,
        raw: n,
      });
    }
  }

  private async pollConversations(): Promise<void> {
    const conversations = await this.api<MastodonConversation[]>(
      '/api/v1/conversations?limit=40',
    );
    if (!Array.isArray(conversations) || conversations.length === 0) return;

    for (const c of conversations) {
      const status = c.last_status;
      if (!status) continue;
      const dedupeKey = `conv:${c.id}:${status.id}`;
      if (this.seen.has(dedupeKey)) continue;
      // On first poll just record cursors without dispatching backlog.
      this.seen.add(dedupeKey);
      if (this.lastConversationStatusId === undefined) continue;
      await this.dispatch({
        channel: 'mastodon',
        id: status.id,
        kind: 'direct',
        from: status.account.acct,
        text: stripHtml(status.content),
        inReplyToId: status.id,
        conversationId: c.id,
        raw: c,
      });
    }
    // Track the newest status we've seen so subsequent polls dispatch new DMs.
    if (conversations[0]?.last_status) {
      this.lastConversationStatusId = conversations[0].last_status.id;
    }
  }

  private async dispatch(msg: MastodonInboundMessage): Promise<void> {
    if (!this.handler) return;
    try {
      await this.handler(msg);
    } catch (err) {
      this.logger?.error({ err, id: msg.id }, 'mastodon inbound handler threw');
    }
  }

  /**
   * Post a status. Text is degraded to Mastodon's plain-text 500-char limit via
   * the shared capability matrix. Returns the created status id.
   */
  async send(msg: MastodonOutboundMessage): Promise<string> {
    const caps = getCapabilities('mastodon');
    const status = degradeOutput(msg.text, caps);
    const visibility =
      msg.visibility ?? (msg.inReplyToId ? 'unlisted' : 'public');

    const created = await this.api<MastodonStatus>('/api/v1/statuses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status,
        in_reply_to_id: msg.inReplyToId,
        visibility,
      }),
    });
    return created.id;
  }

  /**
   * Convenience: reply to an inbound message, preserving thread + DM semantics.
   * Mentions reply 'unlisted'; DMs reply 'direct'.
   */
  async reply(inbound: MastodonInboundMessage, text: string): Promise<string> {
    return this.send({
      text,
      inReplyToId: inbound.inReplyToId,
      visibility: inbound.kind === 'direct' ? 'direct' : 'unlisted',
    });
  }
}
