// ─── Channel Adapter Interface ──────────────────────────────────────────────
//
// Defines the contract for channel adapters (Slack, Discord, Web, etc.).
// Plugins implement this to add new communication channels.
//
// ─────────────────────────────────────────────────────────────────────────────

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * An incoming message from a channel.
 */
export interface IncomingMessage {
  /** Unique message ID from the channel. */
  id: string;
  /** Channel-specific identifier for the sender. */
  senderId: string;
  /** Display name of the sender. */
  senderName: string;
  /** The message text content. */
  content: string;
  /** Channel-specific conversation/thread ID. */
  threadId?: string;
  /** Timestamp of the message. */
  timestamp: number;
  /** Optional file/media attachments. */
  attachments?: MessageAttachment[];
  /** Channel-specific metadata. */
  metadata?: Record<string, unknown>;
}

/**
 * A message attachment (file, image, etc.).
 */
export interface MessageAttachment {
  /** Attachment type (e.g. "image", "file", "audio", "video"). */
  type: string;
  /** URL to the attachment. */
  url?: string;
  /** Raw data if available. */
  data?: Buffer;
  /** MIME type. */
  mimeType?: string;
  /** File name. */
  name?: string;
  /** File size in bytes. */
  size?: number;
}

/**
 * Options for sending a message.
 */
export interface SendMessageOptions {
  /** Thread/conversation ID to reply in. */
  threadId?: string;
  /** Reply to a specific message ID. */
  replyTo?: string;
  /** Attachments to include. */
  attachments?: MessageAttachment[];
  /** Channel-specific options. */
  metadata?: Record<string, unknown>;
}

/**
 * Handler function for incoming messages.
 */
export type MessageHandler = (message: IncomingMessage) => Promise<void>;

// ─── Channel Adapter ────────────────────────────────────────────────────────

/**
 * Interface that all channel adapters must implement.
 *
 * A channel adapter bridges Karna with an external messaging platform
 * (Slack, Discord, Telegram, Web chat, etc.).
 *
 * Lifecycle:
 * 1. Instantiate with configuration
 * 2. Call `onMessage(handler)` to register the message handler
 * 3. Call `start()` to begin listening
 * 4. Call `stop()` to gracefully disconnect
 */
export interface ChannelAdapter {
  /** Unique identifier for this adapter instance. */
  readonly id: string;

  /** Human-readable name (e.g. "Slack", "Discord"). */
  readonly name: string;

  /**
   * Start the adapter (connect to platform, begin listening).
   * Should be idempotent — calling start() twice should not fail.
   */
  start(): Promise<void>;

  /**
   * Stop the adapter gracefully (disconnect, clean up resources).
   * Should be idempotent.
   */
  stop(): Promise<void>;

  /**
   * Send a message to a specific target on the channel.
   *
   * @param target - Channel-specific target identifier
   *   (e.g. Slack channel ID, Discord channel ID, user ID)
   * @param content - Text content of the message
   * @param options - Additional send options
   */
  sendMessage(
    target: string,
    content: string,
    options?: SendMessageOptions,
  ): Promise<void>;

  /**
   * Register a handler for incoming messages.
   * The handler will be called for every message received.
   */
  onMessage(handler: MessageHandler): void;
}

// ─── Base Adapter ───────────────────────────────────────────────────────────

/**
 * Abstract base class providing common functionality for channel adapters.
 * Extend this instead of implementing ChannelAdapter directly for convenience.
 */
export abstract class BaseChannelAdapter implements ChannelAdapter {
  abstract readonly id: string;
  abstract readonly name: string;

  protected messageHandler: MessageHandler | null = null;
  protected started = false;

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract sendMessage(
    target: string,
    content: string,
    options?: SendMessageOptions,
  ): Promise<void>;

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  /**
   * Emit an incoming message to the registered handler.
   * Subclasses should call this when they receive a message from the platform.
   */
  protected async emitMessage(message: IncomingMessage): Promise<void> {
    if (!this.messageHandler) {
      throw new Error(
        `No message handler registered for channel adapter "${this.name}". ` +
          "Call onMessage() before start().",
      );
    }
    await this.messageHandler(message);
  }
}
