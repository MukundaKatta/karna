import { nanoid } from "nanoid";
import pino from "pino";
import type { Session, SessionStatus } from "@karna/shared/types/session.js";

const logger = pino({ name: "session-manager" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SessionManagerOptions {
  /** Maximum number of sessions to keep in memory. */
  maxSessions?: number;
  /** Session timeout in milliseconds. Defaults to 1 hour. */
  sessionTimeoutMs?: number;
  /** Interval for flushing sessions to persistent storage. Defaults to 60s. */
  flushIntervalMs?: number;
}

// ─── Session Manager ────────────────────────────────────────────────────────

export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  private readonly agentSessionIndex = new Map<string, Set<string>>();
  private readonly maxSessions: number;
  private readonly sessionTimeoutMs: number;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly flushIntervalMs: number;

  constructor(options: SessionManagerOptions = {}) {
    this.maxSessions = options.maxSessions ?? 1000;
    this.sessionTimeoutMs = options.sessionTimeoutMs ?? 3_600_000;
    this.flushIntervalMs = options.flushIntervalMs ?? 60_000;
  }

  /**
   * Start the periodic flush timer for persisting sessions.
   */
  start(): void {
    if (this.flushTimer) return;

    this.flushTimer = setInterval(() => {
      this.flushToStorage().catch((error) => {
        logger.error({ error: String(error) }, "Failed to flush sessions to storage");
      });
    }, this.flushIntervalMs);

    // Allow the process to exit even if the timer is running
    this.flushTimer.unref();

    logger.info(
      { flushIntervalMs: this.flushIntervalMs, maxSessions: this.maxSessions },
      "Session manager started",
    );
  }

  /**
   * Stop the periodic flush timer and perform a final flush.
   */
  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    await this.flushToStorage();
    logger.info({ activeSessions: this.sessions.size }, "Session manager stopped");
  }

  /**
   * Create a new session for an agent channel.
   */
  createSession(
    agentId: string,
    channelType: string,
    userId?: string,
  ): Session {
    // Evict expired sessions if we're at capacity
    if (this.sessions.size >= this.maxSessions) {
      this.evictExpiredSessions();
    }

    if (this.sessions.size >= this.maxSessions) {
      logger.warn({ maxSessions: this.maxSessions }, "Maximum sessions reached, evicting oldest");
      this.evictOldestSession();
    }

    const now = Date.now();
    const session: Session = {
      id: nanoid(),
      channelType,
      channelId: agentId,
      userId,
      status: "active",
      createdAt: now,
      updatedAt: now,
      expiresAt: now + this.sessionTimeoutMs,
      metadata: {},
      stats: {
        messageCount: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUsd: 0,
      },
    };

    this.sessions.set(session.id, session);

    // Update agent index
    let agentSessions = this.agentSessionIndex.get(agentId);
    if (!agentSessions) {
      agentSessions = new Set();
      this.agentSessionIndex.set(agentId, agentSessions);
    }
    agentSessions.add(session.id);

    logger.info(
      { sessionId: session.id, agentId, channelType, userId },
      "Session created",
    );

    return session;
  }

  /**
   * Retrieve a session by ID. Returns null if not found or expired.
   */
  getSession(sessionId: string): Session | null {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return null;
    }

    // Check expiry
    if (session.expiresAt && Date.now() > session.expiresAt) {
      logger.info({ sessionId }, "Session expired");
      this.terminateSession(sessionId);
      return null;
    }

    return session;
  }

  /**
   * List all sessions for a given agent ID.
   */
  listSessions(agentId: string): Session[] {
    const sessionIds = this.agentSessionIndex.get(agentId);
    if (!sessionIds) return [];

    const sessions: Session[] = [];
    for (const sessionId of sessionIds) {
      const session = this.getSession(sessionId);
      if (session) {
        sessions.push(session);
      }
    }

    return sessions;
  }

  /**
   * Update a session's status.
   */
  updateSessionStatus(sessionId: string, status: SessionStatus): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.status = status;
    session.updatedAt = Date.now();

    logger.debug({ sessionId, status }, "Session status updated");
    return true;
  }

  /**
   * Update session usage statistics.
   */
  updateSessionStats(
    sessionId: string,
    inputTokens: number,
    outputTokens: number,
    costUsd: number,
  ): boolean {
    const session = this.sessions.get(sessionId);
    if (!session || !session.stats) return false;

    session.stats.messageCount++;
    session.stats.totalInputTokens += inputTokens;
    session.stats.totalOutputTokens += outputTokens;
    session.stats.totalCostUsd += costUsd;
    session.updatedAt = Date.now();

    return true;
  }

  /**
   * Terminate a session and remove it from the active set.
   */
  terminateSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.status = "terminated";
    session.updatedAt = Date.now();

    // Remove from agent index
    const agentSessions = this.agentSessionIndex.get(session.channelId);
    if (agentSessions) {
      agentSessions.delete(sessionId);
      if (agentSessions.size === 0) {
        this.agentSessionIndex.delete(session.channelId);
      }
    }

    this.sessions.delete(sessionId);
    logger.info({ sessionId }, "Session terminated");

    return true;
  }

  /**
   * Get the total number of active sessions.
   */
  get activeSessionCount(): number {
    return this.sessions.size;
  }

  // ─── Internal Methods ───────────────────────────────────────────────────

  private evictExpiredSessions(): void {
    const now = Date.now();
    let evicted = 0;

    for (const [sessionId, session] of this.sessions) {
      if (session.expiresAt && now > session.expiresAt) {
        this.terminateSession(sessionId);
        evicted++;
      }
    }

    if (evicted > 0) {
      logger.info({ evicted }, "Evicted expired sessions");
    }
  }

  private evictOldestSession(): void {
    let oldestId: string | null = null;
    let oldestTime = Infinity;

    for (const [sessionId, session] of this.sessions) {
      if (session.updatedAt < oldestTime) {
        oldestTime = session.updatedAt;
        oldestId = sessionId;
      }
    }

    if (oldestId) {
      this.terminateSession(oldestId);
      logger.info({ sessionId: oldestId }, "Evicted oldest session");
    }
  }

  /**
   * Flush session state to persistent storage (Supabase).
   * Currently a placeholder — will be integrated when the Supabase client is available.
   */
  private async flushToStorage(): Promise<void> {
    if (this.sessions.size === 0) return;

    logger.debug(
      { sessionCount: this.sessions.size },
      "Flushing sessions to storage",
    );

    // TODO: Integrate with @karna/supabase client
    // For now, this is a no-op. The session data is held in memory
    // and persisted via the JSONL transcript store.
  }
}
