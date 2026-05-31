// ─── Channel Inline Approve/Deny Rendering (Issue #588) ──────────────────────
//
// Channel-agnostic rendering + callback-parsing for inline approval prompts.
//
// The agent-side correlation (token minting + single-use resolution with expiry)
// lives in `@karna/agent`'s `InlineApprovalCorrelator`. This module is the
// channel-side counterpart: given an opaque token + a human-readable prompt, it
// produces the platform-specific interactive payload (Slack Block Kit actions,
// Telegram inline keyboard, Discord message components), and parses an inbound
// interaction payload back into a `(token, decision)` pair that the adapter
// hands to the correlator.
//
// It is pure and dependency-free (no channel SDKs), so each platform's button
// shape and callback round-trip is unit-testable in isolation. Adapters import
// these helpers and pass the rendered object straight into their existing
// send/blocks/components path.

import type { ChannelName } from './capabilities.js';

// ─── Shared types ─────────────────────────────────────────────────────────────

export type InlineDecision = 'approve' | 'deny';

/** Channels that support native inline approve/deny buttons. */
export type InteractiveChannel = 'slack' | 'telegram' | 'discord';

const CALLBACK_PREFIX = 'karna:approval';
const DECISIONS: readonly InlineDecision[] = ['approve', 'deny'];

export interface InlineApprovalPromptInput {
  /** Opaque token minted by the agent-side InlineApprovalCorrelator. */
  token: string;
  /** Human-readable description of what is being approved (tool + summary). */
  prompt: string;
  /** Optional labels for the buttons. */
  approveLabel?: string;
  denyLabel?: string;
}

/** A parsed inbound interaction. */
export type ParsedCallback =
  | { ok: true; token: string; decision: InlineDecision }
  | { ok: false; reason: 'not-approval' | 'malformed' };

// ─── Callback id encoding (shared across platforms) ──────────────────────────

/**
 * Encode a stable callback id of the form `karna:approval:<decision>:<token>`.
 * Tokens are UUIDs (no colons), so a 4-part split is unambiguous. Slack puts
 * this in `action_id`/`value`, Telegram in `callback_data`, Discord in
 * `custom_id`.
 */
export function encodeCallbackId(decision: InlineDecision, token: string): string {
  return `${CALLBACK_PREFIX}:${decision}:${token}`;
}

/**
 * Parse a callback id produced by {@link encodeCallbackId}. Returns a structured
 * result rather than throwing so adapters can ignore non-approval interactions.
 */
export function parseCallbackId(raw: string | undefined | null): ParsedCallback {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, reason: 'malformed' };
  }
  const parts = raw.split(':');
  // ["karna", "approval", decision, token]
  if (parts.length !== 4 || `${parts[0]}:${parts[1]}` !== CALLBACK_PREFIX) {
    return { ok: false, reason: 'not-approval' };
  }
  const decision = parts[2] as InlineDecision;
  const token = parts[3];
  if (!DECISIONS.includes(decision) || token.length === 0) {
    return { ok: false, reason: 'malformed' };
  }
  return { ok: true, token, decision };
}

/** Whether a channel supports native inline approval buttons. */
export function supportsInlineApproval(channel: string): channel is InteractiveChannel {
  return channel === 'slack' || channel === 'telegram' || channel === 'discord';
}

// ─── Platform renderers ───────────────────────────────────────────────────────

/** Slack Block Kit: a section + an actions block with two buttons. */
export interface SlackApprovalPayload {
  text: string;
  blocks: unknown[];
}

export function renderSlackApproval(input: InlineApprovalPromptInput): SlackApprovalPayload {
  const approve = input.approveLabel ?? 'Approve';
  const deny = input.denyLabel ?? 'Deny';
  return {
    text: input.prompt,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: input.prompt } },
      {
        type: 'actions',
        block_id: encodeCallbackId('approve', input.token).slice(0, 255),
        elements: [
          {
            type: 'button',
            style: 'primary',
            text: { type: 'plain_text', text: approve },
            action_id: encodeCallbackId('approve', input.token),
            value: encodeCallbackId('approve', input.token),
          },
          {
            type: 'button',
            style: 'danger',
            text: { type: 'plain_text', text: deny },
            action_id: encodeCallbackId('deny', input.token),
            value: encodeCallbackId('deny', input.token),
          },
        ],
      },
    ],
  };
}

/** Telegram: an inline keyboard with two callback buttons. */
export interface TelegramApprovalPayload {
  text: string;
  reply_markup: {
    inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
  };
}

export function renderTelegramApproval(input: InlineApprovalPromptInput): TelegramApprovalPayload {
  const approve = input.approveLabel ?? '✅ Approve';
  const deny = input.denyLabel ?? '❌ Deny';
  return {
    text: input.prompt,
    reply_markup: {
      inline_keyboard: [
        [
          // Telegram limits callback_data to 64 bytes; "karna:approval:approve:" (23) + UUID (36) = 59. OK.
          { text: approve, callback_data: encodeCallbackId('approve', input.token) },
          { text: deny, callback_data: encodeCallbackId('deny', input.token) },
        ],
      ],
    },
  };
}

/** Discord: a message-components action row with two buttons. */
export interface DiscordApprovalPayload {
  content: string;
  components: Array<{
    type: 1; // ActionRow
    components: Array<{ type: 2; style: number; label: string; custom_id: string }>;
  }>;
}

export function renderDiscordApproval(input: InlineApprovalPromptInput): DiscordApprovalPayload {
  const approve = input.approveLabel ?? 'Approve';
  const deny = input.denyLabel ?? 'Deny';
  return {
    content: input.prompt,
    components: [
      {
        type: 1,
        components: [
          // style 3 = Success (green), 4 = Danger (red); custom_id max 100 chars.
          { type: 2, style: 3, label: approve, custom_id: encodeCallbackId('approve', input.token) },
          { type: 2, style: 4, label: deny, custom_id: encodeCallbackId('deny', input.token) },
        ],
      },
    ],
  };
}

/**
 * Render the right payload for a channel, or `undefined` if the channel has no
 * native inline-button support (the adapter should then fall back to a text
 * prompt + keyword reply, correlated via the same token).
 */
export function renderInlineApproval(
  channel: ChannelName | string,
  input: InlineApprovalPromptInput,
):
  | { channel: 'slack'; payload: SlackApprovalPayload }
  | { channel: 'telegram'; payload: TelegramApprovalPayload }
  | { channel: 'discord'; payload: DiscordApprovalPayload }
  | undefined {
  switch (channel) {
    case 'slack':
      return { channel: 'slack', payload: renderSlackApproval(input) };
    case 'telegram':
      return { channel: 'telegram', payload: renderTelegramApproval(input) };
    case 'discord':
      return { channel: 'discord', payload: renderDiscordApproval(input) };
    default:
      return undefined;
  }
}

// ─── Inbound callback extraction ──────────────────────────────────────────────

/**
 * Extract a callback id from a platform interaction payload, then parse it.
 * Accepts the raw shapes each SDK delivers:
 *   - Slack:    `{ actions: [{ action_id | value }] }` (block_actions)
 *   - Telegram: `{ callback_query: { data } }`
 *   - Discord:  `{ data: { custom_id } }` (or a raw interaction with custom_id)
 */
export function parseInboundApproval(
  channel: InteractiveChannel | string,
  raw: unknown,
): ParsedCallback {
  const id = extractCallbackId(channel, raw);
  return parseCallbackId(id);
}

function extractCallbackId(channel: string, raw: unknown): string | undefined {
  if (raw == null || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;

  if (channel === 'slack') {
    const actions = obj.actions as Array<Record<string, unknown>> | undefined;
    const first = actions?.[0];
    return (first?.action_id as string) ?? (first?.value as string) ?? undefined;
  }
  if (channel === 'telegram') {
    const cq = obj.callback_query as Record<string, unknown> | undefined;
    return cq?.data as string | undefined;
  }
  if (channel === 'discord') {
    const data = obj.data as Record<string, unknown> | undefined;
    return (data?.custom_id as string) ?? (obj.custom_id as string) ?? undefined;
  }
  // Generic fallback: a bare custom_id/callback_data/value field.
  return (
    (obj.custom_id as string) ??
    (obj.callback_data as string) ??
    (obj.value as string) ??
    undefined
  );
}
