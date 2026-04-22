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
  /** Supabase client for persistence (optional). */
  supabaseClient?: SupabaseSessionClient;
}

export interface SessionFilter {
  channelType?: string;
  channelId?: string;
  userId?: string;
  status?: SessionStatus;
}

export interface SessionQueryOptions {
  limit?: number;
  sortBy?: "createdAt" | "updatedAt";
  order?: "asc" | "desc";
}

export interface SessionSummary {
  total: number;
  byChannelType: Record<string, number>;
  byStatus: Record<SessionStatus, number>;
  staleSessions: number;
  staleAfterMs: number;
  oldestUpdatedAt?: number;
  newestUpdatedAt?: number;
}

/**
 * Minimal Supabase client interface for session persistence.
 */
export interface SupabaseSessionClient {
  from(table: string): {
    insert(data: Record<string, unknown>): { select(): { single(): Promise<{ data: unknown; error: unknown }> } };
    update(data: Record<string, unknown>): { eq(col: string, val: string): { select(): { single(): Promise<{ data: unknown; error: unknown }> } } };
    upsert(data: Record<string, unknown>[]): Promise<{ error: unknown }>;
    select(cols?: string): { eq(col: string, val: string): { order(col: string, opts: Record<string, boolean>): Promise<{ data: unknown[]; error: unknown }> } };
  };
}

// ─── Session Manager ────────────────────────────────────────────────────────

export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  private readonly agentSessionIndex = new Map<string, Set<string>>();
  private readonly maxSessions: number;
  private readonly sessionTimeoutMs: number;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly flushIntervalMs: number;
  private readonly supabase: SupabaseSessionClient | null;
  private dirtySessionIds = new Set<string>();

  constructor(options: SessionManagerOptions = {}) {
    this.maxSessions = options.maxSessions ?? 1000;
    this.sessionTimeoutMs = options.sessionTimeoutMs ?? 3_600_000;
    this.flushIntervalMs = options.flushIntervalMs ?? 60_000;
    this.supabase = options.supabaseClient ?? null;
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
      {
        flushIntervalMs: this.flushIntervalMs,
        maxSessions: this.maxSessions,
        persistence: this.supabase ? "supabase" : "in-memory",
      },
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
    metadata?: Record<string, unknown>,
    preferredSessionId?: string,
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
    const existingPreferredSession = preferredSessionId
      ? this.sessions.get(preferredSessionId)
      : null;

    if (existingPreferredSession) {
      existingPreferredSession.channelId = agentId;
      existingPreferredSession.channelType = channelType;
      existingPreferredSession.userId = userId;
      existingPreferredSession.status = "active";
      existingPreferredSession.updatedAt = now;
      existingPreferredSession.expiresAt = now + this.sessionTimeoutMs;
      existingPreferredSession.metadata = metadata ? { ...metadata } : {};
      this.dirtySessionIds.add(existingPreferredSession.id);

      logger.info(
        { sessionId: existingPreferredSession.id, agentId, channelType, userId },
        "Session reconnected",
      );

      return existingPreferredSession;
    }

    const session: Session = {
      id: preferredSessionId ?? nanoid(),
      channelType,
      channelId: agentId,
      userId,
      status: "active",
      createdAt: now,
      updatedAt: now,
      expiresAt: now + this.sessionTimeoutMs,
      metadata: metadata ? { ...metadata } : {},
      stats: {
        messageCount: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUsd: 0,
      },
    };

    this.sessions.set(session.id, session);
    this.dirtySessionIds.add(session.id);

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
   * List all active sessions.
   */
  listAllSessions(): Session[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.status === "active",
    );
  }

  /**
   * Query live sessions using lightweight operator filters.
   */
  querySessions(filter: SessionFilter = {}, options: SessionQueryOptions = {}): Session[] {
    const sessions = this.collectSessions(filter);
    const sortBy = options.sortBy ?? "updatedAt";
    const order = options.order ?? "desc";

    sessions.sort((left, right) => {
      const delta = left[sortBy] - right[sortBy];
      return order === "asc" ? delta : -delta;
    });

    if (options.limit && options.limit > 0) {
      return sessions.slice(0, options.limit);
    }

    return sessions;
  }

  /**
   * Build a compact operator summary of live session state.
   */
  summarizeSessions(filter: SessionFilter = {}, staleAfterMs = 30 * 60_000): SessionSummary {
    const sessions = this.collectSessions(filter);
    const byChannelType: Record<string, number> = {};
    const byStatus: Record<SessionStatus, number> = {
      active: 0,
      idle: 0,
      suspended: 0,
      terminated: 0,
    };

    let staleSessions = 0;
    let oldestUpdatedAt: number | undefined;
    let newestUpdatedAt: number | undefined;
    const now = Date.now();

    for (const session of sessions) {
      byChannelType[session.channelType] = (byChannelType[session.channelType] ?? 0) + 1;
      byStatus[session.status] += 1;

      if (now - session.updatedAt >= staleAfterMs) {
        staleSessions += 1;
      }

      if (oldestUpdatedAt === undefined || session.updatedAt < oldestUpdatedAt) {
        oldestUpdatedAt = session.updatedAt;
      }

      if (newestUpdatedAt === undefined || session.updatedAt > newestUpdatedAt) {
        newestUpdatedAt = session.updatedAt;
      }
    }

    return {
      total: sessions.length,
      byChannelType,
      byStatus,
      staleSessions,
      staleAfterMs,
      oldestUpdatedAt,
      newestUpdatedAt,
    };
  }

  /**
   * Update a session's status.
   */
  updateSessionStatus(sessionId: string, status: SessionStatus): boolean {
    if (status === "terminated") {
      return this.terminateSession(sessionId);
    }

    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.status = status;
    session.updatedAt = Date.now();
    this.dirtySessionIds.add(sessionId);

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
    this.dirtySessionIds.add(sessionId);

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

    // Flush to storage BEFORE deleting from map, so the terminated
    // status is persisted. Remove from dirtySessionIds after delete
    // to prevent stale entries.
    this.dirtySessionIds.delete(sessionId);
    this.sessions.delete(sessionId);
    logger.info({ sessionId }, "Session terminated");

    return true;
  }

  /**
   * Terminate every live session that matches the provided filter.
   */
  terminateSessions(filter: SessionFilter): number {
    const sessionIds = this.collectSessions(filter).map((session) => session.id);

    for (const sessionId of sessionIds) {
      this.terminateSession(sessionId);
    }

    return sessionIds.length;
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

  private collectSessions(filter: SessionFilter = {}): Session[] {
    const sessions: Session[] = [];

    for (const [sessionId, session] of this.sessions) {
      if (session.expiresAt && Date.now() > session.expiresAt) {
        logger.info({ sessionId }, "Session expired");
        this.terminateSession(sessionId);
        continue;
      }

      if (!this.matchesFilter(session, filter)) {
        continue;
      }

      sessions.push(session);
    }

    return sessions;
  }

  private matchesFilter(session: Session, filter: SessionFilter): boolean {
    if (filter.channelType && session.channelType !== filter.channelType) {
      return false;
    }

    if (filter.channelId && session.channelId !== filter.channelId) {
      return false;
    }

    if (filter.userId && session.userId !== filter.userId) {
      return false;
    }

    if (filter.status && session.status !== filter.status) {
      return false;
    }

    return true;
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
   * Flush dirty session state to persistent storage (Supabase).
   * Falls back to a no-op if Supabase is not configured.
   */
  private async flushToStorage(): Promise<void> {
    if (this.dirtySessionIds.size === 0) return;

    if (!this.supabase) {
      // No persistence configured — clear dirty set silently
      this.dirtySessionIds.clear();
      return;
    }

    const sessionsToFlush: Record<string, unknown>[] = [];
    for (const sessionId of this.dirtySessionIds) {
      const session = this.sessions.get(sessionId);
      if (!session) continue;

      sessionsToFlush.push({
        id: session.id,
        channel_type: session.channelType,
        channel_id: session.channelId,
        user_id: session.userId ?? null,
        status: session.status,
        created_at: new Date(session.createdAt).toISOString(),
        updated_at: new Date(session.updatedAt).toISOString(),
        expires_at: session.expiresAt ? new Date(session.expiresAt).toISOString() : null,
        metadata: session.metadata ?? {},
        message_count: session.stats?.messageCount ?? 0,
        total_input_tokens: session.stats?.totalInputTokens ?? 0,
        total_output_tokens: session.stats?.totalOutputTokens ?? 0,
        total_cost_usd: session.stats?.totalCostUsd ?? 0,
      });
    }

    if (sessionsToFlush.length === 0) {
      this.dirtySessionIds.clear();
      return;
    }

    try {
      const { error } = await this.supabase.from("sessions").upsert(sessionsToFlush);

      if (error) {
        logger.error({ error: String(error) }, "Failed to upsert sessions to Supabase");
      } else {
        logger.debug(
          { sessionCount: sessionsToFlush.length },
          "Flushed sessions to Supabase",
        );
        this.dirtySessionIds.clear();
      }
    } catch (error) {
      logger.error({ error: String(error) }, "Exception flushing sessions to Supabase");
    }
  }
}
