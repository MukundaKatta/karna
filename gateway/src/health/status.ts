import pino from "pino";

const logger = pino({ name: "health-status" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SystemHealth {
  status: "healthy" | "degraded" | "unhealthy";
  uptime: number;
  uptimeHuman: string;
  connections: number;
  sessions: number;
  database: "connected" | "disconnected" | "unknown";
  memoryUsage: {
    heapUsedMB: number;
    heapTotalMB: number;
    rssMB: number;
  };
  version: string;
  startedAt: number;
}

// ─── State ──────────────────────────────────────────────────────────────────

const startedAt = Date.now();

// ─── Accessors (set by the main server) ─────────────────────────────────────

let connectionCountFn: () => number = () => 0;
let sessionCountFn: () => number = () => 0;
let databaseCheckerFn: (() => Promise<boolean>) | null = null;
let lastDbStatus: "connected" | "disconnected" | "unknown" = "unknown";

export function setConnectionCounter(fn: () => number): void {
  connectionCountFn = fn;
}

export function setSessionCounter(fn: () => number): void {
  sessionCountFn = fn;
}

export function setDatabaseChecker(fn: () => Promise<boolean>): void {
  databaseCheckerFn = fn;
  // Run initial check
  fn().then((ok) => { lastDbStatus = ok ? "connected" : "disconnected"; }).catch(() => { lastDbStatus = "disconnected"; });
}

// ─── Health Check ───────────────────────────────────────────────────────────

/**
 * Compute the current system health status.
 */
export function getSystemHealth(): SystemHealth {
  const uptimeMs = Date.now() - startedAt;
  const memory = process.memoryUsage();

  const connections = connectionCountFn();
  const sessions = sessionCountFn();

  // Determine overall status
  let status: SystemHealth["status"] = "healthy";

  const heapUsedMB = memory.heapUsed / 1024 / 1024;
  const heapTotalMB = memory.heapTotal / 1024 / 1024;
  const heapUsageRatio = heapUsedMB / heapTotalMB;

  if (heapUsageRatio > 0.95) {
    status = "unhealthy";
    logger.warn({ heapUsageRatio }, "Heap usage critically high");
  } else if (heapUsageRatio > 0.8) {
    status = "degraded";
    logger.warn({ heapUsageRatio }, "Heap usage elevated");
  }

  // Async DB check — use cached result to keep health endpoint sync
  if (databaseCheckerFn) {
    databaseCheckerFn()
      .then((ok) => { lastDbStatus = ok ? "connected" : "disconnected"; })
      .catch(() => { lastDbStatus = "disconnected"; });
  }

  if (lastDbStatus === "disconnected") {
    status = status === "healthy" ? "degraded" : status;
  }

  return {
    status,
    uptime: uptimeMs,
    uptimeHuman: formatUptime(uptimeMs),
    connections,
    sessions,
    database: lastDbStatus,
    memoryUsage: {
      heapUsedMB: Math.round(heapUsedMB * 100) / 100,
      heapTotalMB: Math.round(heapTotalMB * 100) / 100,
      rssMB: Math.round((memory.rss / 1024 / 1024) * 100) / 100,
    },
    version: "0.1.0",
    startedAt,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
