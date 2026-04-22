import pino from "pino";

const logger = pino({ name: "audit-logger" });

// ─── Types ──────────────────────────────────────────────────────────────────

export const AUDIT_EVENT_TYPES = [
  "auth.login",
  "auth.login_failed",
  "auth.register",
  "auth.token_refresh",
  "session.created",
  "session.terminated",
  "session.expired",
  "tool.executed",
  "tool.approved",
  "tool.rejected",
  "tool.failed",
  "config.updated",
  "agent.created",
  "agent.updated",
  "agent.deleted",
  "skill.invoked",
  "api_key.created",
  "api_key.revoked",
] as const;

export type AuditEventType = typeof AUDIT_EVENT_TYPES[number];

export interface AuditEvent {
  id: string;
  timestamp: number;
  eventType: AuditEventType;
  actorId?: string;
  sessionId?: string;
  resourceType?: string;
  resourceId?: string;
  action: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  success: boolean;
}

export interface AuditBackend {
  write(event: AuditEvent): Promise<void>;
  query(params: AuditQueryParams): Promise<AuditEvent[]>;
}

export interface AuditQueryParams {
  eventType?: AuditEventType;
  actorId?: string;
  sessionId?: string;
  since?: number;
  limit?: number;
}

// ─── Audit Logger ───────────────────────────────────────────────────────────

export class AuditLogger {
  private readonly backends: AuditBackend[];
  private counter = 0;

  constructor(backends?: AuditBackend[]) {
    this.backends = backends ?? [new LogAuditBackend()];
  }

  /**
   * Log an authentication event.
   */
  async logAuth(
    eventType: "auth.login" | "auth.login_failed" | "auth.register" | "auth.token_refresh",
    actorId: string | undefined,
    success: boolean,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.emit({
      eventType,
      actorId,
      action: eventType.split(".")[1]!,
      resourceType: "auth",
      success,
      metadata,
    });
  }

  /**
   * Log a session lifecycle event.
   */
  async logSession(
    eventType: "session.created" | "session.terminated" | "session.expired",
    sessionId: string,
    actorId?: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.emit({
      eventType,
      sessionId,
      actorId,
      action: eventType.split(".")[1]!,
      resourceType: "session",
      resourceId: sessionId,
      success: true,
      metadata,
    });
  }

  /**
   * Log a tool execution event.
   */
  async logToolExec(
    eventType: "tool.executed" | "tool.approved" | "tool.rejected" | "tool.failed",
    toolName: string,
    sessionId?: string,
    success = true,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.emit({
      eventType,
      sessionId,
      action: eventType.split(".")[1]!,
      resourceType: "tool",
      resourceId: toolName,
      success,
      metadata,
    });
  }

  /**
   * Log a configuration change.
   */
  async logConfigChange(
    actorId: string,
    resourceId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.emit({
      eventType: "config.updated",
      actorId,
      action: "updated",
      resourceType: "config",
      resourceId,
      success: true,
      metadata,
    });
  }

  /**
   * Query audit events from the first backend that supports it.
   */
  async query(params: AuditQueryParams): Promise<AuditEvent[]> {
    for (const backend of this.backends) {
      try {
        return await backend.query(params);
      } catch {
        // Try next backend
      }
    }
    return [];
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  private async emit(partial: Omit<AuditEvent, "id" | "timestamp">): Promise<void> {
    const event: AuditEvent = {
      id: `audit_${++this.counter}_${Date.now()}`,
      timestamp: Date.now(),
      ...partial,
    };

    await Promise.allSettled(
      this.backends.map((b) => b.write(event)),
    );
  }
}

// ─── Log Backend (default) ──────────────────────────────────────────────────

export class LogAuditBackend implements AuditBackend {
  private readonly events: AuditEvent[] = [];
  private readonly maxEvents: number;

  constructor(maxEvents = 10_000) {
    this.maxEvents = maxEvents;
  }

  async write(event: AuditEvent): Promise<void> {
    logger.info(
      {
        auditId: event.id,
        eventType: event.eventType,
        actorId: event.actorId,
        sessionId: event.sessionId,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        action: event.action,
        success: event.success,
      },
      `AUDIT: ${event.eventType}`,
    );

    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }
  }

  async query(params: AuditQueryParams): Promise<AuditEvent[]> {
    let results = [...this.events];

    if (params.eventType) {
      results = results.filter((e) => e.eventType === params.eventType);
    }
    if (params.actorId) {
      results = results.filter((e) => e.actorId === params.actorId);
    }
    if (params.sessionId) {
      results = results.filter((e) => e.sessionId === params.sessionId);
    }
    if (params.since) {
      results = results.filter((e) => e.timestamp >= params.since!);
    }

    return results.slice(-(params.limit ?? 100));
  }
}
