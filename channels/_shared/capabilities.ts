/**
 * Issue #606 — Unified channel capability matrix.
 *
 * A dependency-free model describing what each messaging channel can do, a
 * registry mapping channel name -> capabilities, and a {@link degradeOutput}
 * helper that gracefully downgrades rich text/markdown to fit a channel's
 * constraints (length + markdown support).
 *
 * Pure: no imports, no side effects. Safe to use from any channel adapter.
 */

/** Names of the channels Karna ships adapters for. */
export type ChannelName =
  | 'telegram'
  | 'slack'
  | 'discord'
  | 'whatsapp'
  | 'sms'
  | 'imessage'
  | 'webchat'
  | 'signal'
  | 'google-chat'
  | 'teams'
  | 'matrix'
  | 'irc'
  | 'line'
  | 'mastodon';

/**
 * Per-channel capability descriptor. All fields are intentionally simple so the
 * matrix can be serialized, diffed, and reasoned about without any runtime deps.
 */
export interface ChannelCapabilities {
  /** Interactive buttons / quick replies are supported. */
  buttons: boolean;
  /** File / media attachments are supported. */
  attachments: boolean;
  /** Threaded replies are supported. */
  threads: boolean;
  /** Emoji reactions on messages are supported. */
  reactions: boolean;
  /**
   * Maximum number of characters in a single outbound message. Messages longer
   * than this must be split or truncated. Use Infinity for "no practical limit".
   */
  maxMessageLength: number;
  /**
   * Markdown flavor the channel understands.
   * - 'full'  : rich markdown (bold, italic, code, links).
   * - 'basic' : limited subset (e.g. bold/italic only).
   * - 'none'  : plain text only; markdown syntax should be stripped.
   */
  markdown: 'full' | 'basic' | 'none';
}

/** Conservative defaults used when a channel is not in the registry. */
export const DEFAULT_CAPABILITIES: ChannelCapabilities = {
  buttons: false,
  attachments: false,
  threads: false,
  reactions: false,
  maxMessageLength: 2000,
  markdown: 'none',
};

/**
 * The capability matrix. Values reflect the documented limits of each platform.
 * These are deliberately on the safe/conservative side of each provider's docs.
 */
export const CHANNEL_CAPABILITIES: Record<ChannelName, ChannelCapabilities> = {
  telegram: {
    buttons: true,
    attachments: true,
    threads: true,
    reactions: true,
    maxMessageLength: 4096,
    markdown: 'full',
  },
  slack: {
    buttons: true,
    attachments: true,
    threads: true,
    reactions: true,
    maxMessageLength: 40000,
    markdown: 'full',
  },
  discord: {
    buttons: true,
    attachments: true,
    threads: true,
    reactions: true,
    maxMessageLength: 2000,
    markdown: 'full',
  },
  whatsapp: {
    buttons: true,
    attachments: true,
    threads: false,
    reactions: true,
    maxMessageLength: 4096,
    markdown: 'basic',
  },
  sms: {
    buttons: false,
    attachments: false,
    threads: false,
    reactions: false,
    maxMessageLength: 1600,
    markdown: 'none',
  },
  imessage: {
    buttons: false,
    attachments: true,
    threads: false,
    reactions: true,
    maxMessageLength: 20000,
    markdown: 'none',
  },
  webchat: {
    buttons: true,
    attachments: true,
    threads: true,
    reactions: true,
    maxMessageLength: 100000,
    markdown: 'full',
  },
  signal: {
    buttons: false,
    attachments: true,
    threads: false,
    reactions: true,
    maxMessageLength: 20000,
    markdown: 'none',
  },
  'google-chat': {
    buttons: true,
    attachments: true,
    threads: true,
    reactions: false,
    maxMessageLength: 4096,
    markdown: 'basic',
  },
  teams: {
    buttons: true,
    attachments: true,
    threads: true,
    reactions: true,
    maxMessageLength: 28000,
    markdown: 'full',
  },
  matrix: {
    buttons: false,
    attachments: true,
    threads: true,
    reactions: true,
    maxMessageLength: 32000,
    markdown: 'full',
  },
  irc: {
    buttons: false,
    attachments: false,
    threads: false,
    reactions: false,
    maxMessageLength: 400,
    markdown: 'none',
  },
  line: {
    buttons: true,
    attachments: true,
    threads: false,
    reactions: false,
    maxMessageLength: 5000,
    markdown: 'none',
  },
  mastodon: {
    buttons: false,
    attachments: true,
    threads: true,
    reactions: false,
    maxMessageLength: 500,
    markdown: 'none',
  },
};

/**
 * Look up capabilities for a channel by name, falling back to safe defaults for
 * unknown channels. Never throws.
 */
export function getCapabilities(channel: string): ChannelCapabilities {
  return CHANNEL_CAPABILITIES[channel as ChannelName] ?? DEFAULT_CAPABILITIES;
}

/** Returns true if every named channel has a complete capability descriptor. */
export function isCapabilityMatrixComplete(): boolean {
  return Object.values(CHANNEL_CAPABILITIES).every(
    (c) =>
      typeof c.buttons === 'boolean' &&
      typeof c.attachments === 'boolean' &&
      typeof c.threads === 'boolean' &&
      typeof c.reactions === 'boolean' &&
      typeof c.maxMessageLength === 'number' &&
      (c.markdown === 'full' || c.markdown === 'basic' || c.markdown === 'none'),
  );
}

/**
 * Strip common markdown syntax to plain text. Conservative: handles the
 * constructs an LLM is most likely to emit (bold, italic, inline code, fenced
 * code, links, headings, blockquotes, list bullets).
 */
export function stripMarkdown(text: string): string {
  let out = text;
  // Fenced code blocks ```lang\n...\n``` -> keep inner content.
  out = out.replace(/```[a-zA-Z0-9_-]*\n?([\s\S]*?)```/g, (_m, code: string) =>
    code.replace(/\n+$/, ''),
  );
  // Inline code `x` -> x
  out = out.replace(/`([^`]+)`/g, '$1');
  // Images ![alt](url) -> alt
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  // Links [text](url) -> text (url)
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
  // Bold **x** / __x__ -> x
  out = out.replace(/(\*\*|__)(.*?)\1/g, '$2');
  // Italic *x* / _x_ -> x
  out = out.replace(/(\*|_)(.*?)\1/g, '$2');
  // Headings ###, leading > blockquote markers, and list bullets.
  out = out.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  out = out.replace(/^\s{0,3}>\s?/gm, '');
  out = out.replace(/^\s{0,3}[-*+]\s+/gm, '');
  return out;
}

/**
 * Reduce full markdown to a "basic" subset by stripping the constructs that
 * basic-markdown channels do not understand (code, links, headings, lists),
 * while preserving bold/italic emphasis.
 */
export function downgradeToBasicMarkdown(text: string): string {
  let out = text;
  out = out.replace(/```[a-zA-Z0-9_-]*\n?([\s\S]*?)```/g, (_m, code: string) =>
    code.replace(/\n+$/, ''),
  );
  out = out.replace(/`([^`]+)`/g, '$1');
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
  out = out.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  out = out.replace(/^\s{0,3}>\s?/gm, '');
  out = out.replace(/^\s{0,3}[-*+]\s+/gm, '');
  return out;
}

/**
 * Truncate to a maximum length, appending an ellipsis marker when the text was
 * actually cut. The marker is included within the budget so the result never
 * exceeds `max`.
 */
export function truncate(text: string, max: number, marker = '…'): string {
  if (max === Infinity || text.length <= max) return text;
  if (max <= marker.length) return text.slice(0, max);
  return text.slice(0, max - marker.length) + marker;
}

/**
 * Degrade rich output so it can be safely sent over a channel with the given
 * capabilities:
 *  1. Convert markdown to what the channel supports (full/basic/none).
 *  2. Enforce the channel's maximum message length.
 *
 * Always returns a string that satisfies `caps`. Pure and side-effect free.
 */
export function degradeOutput(text: string, caps: ChannelCapabilities): string {
  let out = text;
  if (caps.markdown === 'none') {
    out = stripMarkdown(out);
  } else if (caps.markdown === 'basic') {
    out = downgradeToBasicMarkdown(out);
  }
  out = truncate(out, caps.maxMessageLength);
  return out;
}

/**
 * Split text into chunks that each fit within `caps.maxMessageLength`, breaking
 * on newline / whitespace boundaries where possible. Markdown is degraded first
 * so each chunk is channel-safe. Useful for channels that prefer multiple
 * messages over truncation.
 */
export function degradeAndSplit(text: string, caps: ChannelCapabilities): string[] {
  let body = text;
  if (caps.markdown === 'none') body = stripMarkdown(body);
  else if (caps.markdown === 'basic') body = downgradeToBasicMarkdown(body);

  const max = caps.maxMessageLength;
  if (max === Infinity || body.length <= max) return [body];

  const chunks: string[] = [];
  let remaining = body;
  while (remaining.length > max) {
    let cut = remaining.lastIndexOf('\n', max);
    if (cut <= 0) cut = remaining.lastIndexOf(' ', max);
    if (cut <= 0) cut = max;
    chunks.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}
