// ─── Presence & Typing Indicators ───────────────────────────────────────────
// Tracks user/agent presence and typing state per session.
// Broadcasts presence updates to all connected clients for a session.

import pino from "pino";

const logger = pino({ name: "presence-manager" });

// ─── Types ──────────────────────────────────────────────────────────────────

export type PresenceState = "online" | "away" | "offline";
export type TypingState = "typing" | "idle";

export interface PresenceEntry {
  userId: string;
  sessionId: string;
  presence: PresenceState;
  typing: TypingState;
  lastSeen: number;
  metadata?: Record<string, unknown>;
}

export interface PresenceUpdate {
  type: "presence.update";
  sessionId: string;
  userId: string;
  presence: PresenceState;
  typing: TypingState;
  timestamp: number;
}

export type PresenceBroadcaster = (sessionId: string, update: PresenceUpdate) => void;

// ─── Presence Manager ──────────────────────────────────────────────────────

export class PresenceManager {
  private readonly entries = new Map<string, PresenceEntry>(); // key: `${sessionId}:${userId}`
  private readonly sessionUsers = new Map<string, Set<string>>(); // sessionId -> Set<userId>
  private broadcaster: PresenceBroadcaster | null = null;
  private typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly typingTimeoutMs: number;

  constructor(typingTimeoutMs = 5_000) {
    this.typingTimeoutMs = typingTimeoutMs;
  }

  /**
   * Set the broadcaster function for sending presence updates to clients.
   */
  setBroadcaster(fn: PresenceBroadcaster): void {
    this.broadcaster = fn;
  }

  /**
   * Mark a user as online in a session.
   */
  setOnline(sessionId: string, userId: string): void {
    this.updatePresence(sessionId, userId, "online", "idle");
  }

  /**
   * Mark a user as offline.
   */
  setOffline(sessionId: string, userId: string): void {
    this.updatePresence(sessionId, userId, "offline", "idle");
    this.clearTypingTimer(sessionId, userId);
  }

  /**
   * Mark a user as typing. Automatically clears after timeout.
   */
  setTyping(sessionId: string, userId: string): void {
    const key = `${sessionId}:${userId}`;
    const entry = this.entries.get(key);

    if (entry) {
      entry.typing = "typing";
      entry.lastSeen = Date.now();
    } else {
      this.updatePresence(sessionId, userId, "online", "typing");
      return; // updatePresence already broadcasts
    }

    // Broadcast typing
    this.broadcast(sessionId, userId, entry?.presence ?? "online", "typing");

    // Auto-clear typing after timeout
    this.clearTypingTimer(sessionId, userId);
    const timer = setTimeout(() => {
      this.clearTyping(sessionId, userId);
    }, this.typingTimeoutMs);
    (timer as NodeJS.Timeout).unref?.();
    this.typingTimers.set(key, timer);
  }

  /**
   * Clear typing state for a user.
   */
  clearTyping(sessionId: string, userId: string): void {
    const key = `${sessionId}:${userId}`;
    const entry = this.entries.get(key);
    if (entry && entry.typing === "typing") {
      entry.typing = "idle";
      this.broadcast(sessionId, userId, entry.presence, "idle");
    }
    this.clearTypingTimer(sessionId, userId);
  }

  /**
   * Get all users present in a session.
   */
  getSessionPresence(sessionId: string): PresenceEntry[] {
    const userIds = this.sessionUsers.get(sessionId);
    if (!userIds) return [];

    const entries: PresenceEntry[] = [];
    for (const userId of userIds) {
      const entry = this.entries.get(`${sessionId}:${userId}`);
      if (entry) entries.push(entry);
    }
    return entries;
  }

  /**
   * Get presence for a specific user in a session.
   */
  getUserPresence(sessionId: string, userId: string): PresenceEntry | null {
    return this.entries.get(`${sessionId}:${userId}`) ?? null;
  }

  /**
   * Remove all presence data for a session.
   */
  clearSession(sessionId: string): void {
    const userIds = this.sessionUsers.get(sessionId);
    if (!userIds) return;

    for (const userId of userIds) {
      const key = `${sessionId}:${userId}`;
      this.entries.delete(key);
      this.clearTypingTimer(sessionId, userId);
    }
    this.sessionUsers.delete(sessionId);
  }

  /**
   * Total tracked entries.
   */
  get size(): number {
    return this.entries.size;
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  private updatePresence(
    sessionId: string,
    userId: string,
    presence: PresenceState,
    typing: TypingState,
  ): void {
    const key = `${sessionId}:${userId}`;

    this.entries.set(key, {
      userId,
      sessionId,
      presence,
      typing,
      lastSeen: Date.now(),
    });

    // Track session → users mapping
    let users = this.sessionUsers.get(sessionId);
    if (!users) {
      users = new Set();
      this.sessionUsers.set(sessionId, users);
    }
    users.add(userId);

    this.broadcast(sessionId, userId, presence, typing);
  }

  private broadcast(
    sessionId: string,
    userId: string,
    presence: PresenceState,
    typing: TypingState,
  ): void {
    if (!this.broadcaster) return;

    this.broadcaster(sessionId, {
      type: "presence.update",
      sessionId,
      userId,
      presence,
      typing,
      timestamp: Date.now(),
    });
  }

  private clearTypingTimer(sessionId: string, userId: string): void {
    const key = `${sessionId}:${userId}`;
    const timer = this.typingTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.typingTimers.delete(key);
    }
  }
}
