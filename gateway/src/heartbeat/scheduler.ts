import { nanoid } from "nanoid";
import pino from "pino";
import { readChecklist } from "./checklist.js";

const logger = pino({ name: "heartbeat-scheduler" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface HeartbeatTask {
  agentId: string;
  intervalMs: number;
  timer: ReturnType<typeof setInterval>;
  lastTick: number;
  tickCount: number;
}

export interface HeartbeatTickPayload {
  agentId: string;
  serverTime: number;
  tickNumber: number;
  checklist: ChecklistItem[];
}

export interface ChecklistItem {
  text: string;
  checked: boolean;
  line: number;
}

export type HeartbeatTickHandler = (payload: HeartbeatTickPayload) => void;

// ─── Heartbeat Scheduler ────────────────────────────────────────────────────

export class HeartbeatScheduler {
  private readonly tasks = new Map<string, HeartbeatTask>();
  private tickHandler: HeartbeatTickHandler | null = null;
  private workspacePath: string | null = null;

  /**
   * Set the handler that will be called on each heartbeat tick.
   */
  onTick(handler: HeartbeatTickHandler): void {
    this.tickHandler = handler;
  }

  /**
   * Set the workspace path for reading HEARTBEAT.md checklists.
   */
  setWorkspacePath(path: string): void {
    this.workspacePath = path;
  }

  /**
   * Start a periodic heartbeat for a given agent.
   *
   * @param agentId - The agent identifier
   * @param intervalMs - Interval between heartbeat ticks in milliseconds
   */
  start(agentId: string, intervalMs: number): void {
    // Stop existing heartbeat if running
    if (this.tasks.has(agentId)) {
      this.stop(agentId);
    }

    const task: HeartbeatTask = {
      agentId,
      intervalMs,
      timer: null as unknown as ReturnType<typeof setInterval>,
      lastTick: 0,
      tickCount: 0,
    };

    task.timer = setInterval(() => {
      this.tick(task).catch((error) => {
        logger.error(
          { agentId, error: String(error) },
          "Heartbeat tick failed",
        );
      });
    }, intervalMs);

    // Allow process to exit
    task.timer.unref();

    this.tasks.set(agentId, task);

    logger.info(
      { agentId, intervalMs },
      "Heartbeat scheduler started",
    );
  }

  /**
   * Stop the heartbeat for a given agent.
   */
  stop(agentId: string): void {
    const task = this.tasks.get(agentId);
    if (!task) {
      logger.debug({ agentId }, "No heartbeat to stop");
      return;
    }

    clearInterval(task.timer);
    this.tasks.delete(agentId);

    logger.info(
      { agentId, totalTicks: task.tickCount },
      "Heartbeat scheduler stopped",
    );
  }

  /**
   * Stop all heartbeat tasks.
   */
  stopAll(): void {
    for (const [agentId] of this.tasks) {
      this.stop(agentId);
    }
    logger.info("All heartbeat schedulers stopped");
  }

  /**
   * Check if a heartbeat is running for a given agent.
   */
  isRunning(agentId: string): boolean {
    return this.tasks.has(agentId);
  }

  /**
   * Get info about all running heartbeat tasks.
   */
  getRunningTasks(): Array<{
    agentId: string;
    intervalMs: number;
    lastTick: number;
    tickCount: number;
  }> {
    return Array.from(this.tasks.values()).map((task) => ({
      agentId: task.agentId,
      intervalMs: task.intervalMs,
      lastTick: task.lastTick,
      tickCount: task.tickCount,
    }));
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  private async tick(task: HeartbeatTask): Promise<void> {
    task.tickCount++;
    task.lastTick = Date.now();

    let checklist: ChecklistItem[] = [];

    if (this.workspacePath) {
      try {
        checklist = await readChecklist(this.workspacePath);
      } catch (error) {
        logger.debug(
          { agentId: task.agentId, error: String(error) },
          "Failed to read heartbeat checklist",
        );
      }
    }

    const payload: HeartbeatTickPayload = {
      agentId: task.agentId,
      serverTime: Date.now(),
      tickNumber: task.tickCount,
      checklist,
    };

    logger.debug(
      { agentId: task.agentId, tick: task.tickCount, checklistItems: checklist.length },
      "Heartbeat tick",
    );

    if (this.tickHandler) {
      try {
        this.tickHandler(payload);
      } catch (error) {
        logger.error(
          { agentId: task.agentId, error: String(error) },
          "Heartbeat tick handler error",
        );
      }
    }
  }
}
