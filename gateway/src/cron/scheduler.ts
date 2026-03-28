// ─── Cron Scheduler ──────────────────────────────────────────────────────────
// Persistent cron job system inspired by OpenClaw.
// Supports: one-shot (at), interval (every), and cron expressions.
// Jobs persist to ~/.karna/cron/jobs.json and survive restarts.

import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import pino from "pino";
import { nanoid } from "nanoid";

const logger = pino({ name: "cron-scheduler" });

// ─── Types ──────────────────────────────────────────────────────────────────

export type ScheduleType = "at" | "every" | "cron";
export type DeliveryMode = "announce" | "webhook" | "none";

export interface CronJob {
  id: string;
  name: string;
  prompt: string;
  schedule: {
    type: ScheduleType;
    /** ISO 8601 timestamp for "at" schedules */
    at?: string;
    /** Interval in milliseconds for "every" schedules */
    everyMs?: number;
    /** Cron expression (5-field) for "cron" schedules */
    expression?: string;
    /** IANA timezone for cron expressions */
    timezone?: string;
  };
  delivery: DeliveryMode;
  /** Channel to deliver results to */
  channelId?: string;
  /** Webhook URL for delivery mode "webhook" */
  webhookUrl?: string;
  /** Whether the job is active */
  enabled: boolean;
  /** Agent ID to run the job under */
  agentId?: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  runCount: number;
}

export interface CronRunResult {
  jobId: string;
  runId: string;
  startedAt: string;
  completedAt: string;
  success: boolean;
  output?: string;
  error?: string;
}

export type CronJobExecutor = (job: CronJob) => Promise<CronRunResult>;

// ─── Cron Scheduler ────────────────────────────────────────────────────────

export class CronScheduler {
  private jobs = new Map<string, CronJob>();
  private timers = new Map<string, ReturnType<typeof setTimeout | typeof setInterval>>();
  private readonly storagePath: string;
  private readonly runsPath: string;
  private executor: CronJobExecutor | null = null;

  constructor(basePath?: string) {
    const base = basePath ?? join(homedir(), ".karna", "cron");
    this.storagePath = join(base, "jobs.json");
    this.runsPath = join(base, "runs");

    mkdirSync(base, { recursive: true });
    mkdirSync(this.runsPath, { recursive: true });

    this.loadJobs();
  }

  /**
   * Set the executor function called when a job triggers.
   */
  setExecutor(executor: CronJobExecutor): void {
    this.executor = executor;
  }

  /**
   * Start all enabled jobs.
   */
  start(): void {
    for (const job of this.jobs.values()) {
      if (job.enabled) {
        this.scheduleJob(job);
      }
    }
    logger.info({ jobCount: this.jobs.size }, "Cron scheduler started");
  }

  /**
   * Stop all running timers.
   */
  stop(): void {
    for (const [id, timer] of this.timers) {
      clearTimeout(timer as ReturnType<typeof setTimeout>);
      clearInterval(timer as ReturnType<typeof setInterval>);
      this.timers.delete(id);
    }
    logger.info("Cron scheduler stopped");
  }

  /**
   * Add a new cron job.
   */
  addJob(params: Omit<CronJob, "id" | "createdAt" | "updatedAt" | "runCount">): CronJob {
    const now = new Date().toISOString();
    const job: CronJob = {
      ...params,
      id: `cron_${nanoid(10)}`,
      createdAt: now,
      updatedAt: now,
      runCount: 0,
    };

    this.jobs.set(job.id, job);
    this.saveJobs();

    if (job.enabled) {
      this.scheduleJob(job);
    }

    logger.info({ jobId: job.id, name: job.name, type: job.schedule.type }, "Cron job added");
    return job;
  }

  /**
   * Remove a cron job.
   */
  removeJob(jobId: string): boolean {
    const timer = this.timers.get(jobId);
    if (timer) {
      clearTimeout(timer as ReturnType<typeof setTimeout>);
      clearInterval(timer as ReturnType<typeof setInterval>);
      this.timers.delete(jobId);
    }

    const removed = this.jobs.delete(jobId);
    if (removed) {
      this.saveJobs();
      logger.info({ jobId }, "Cron job removed");
    }
    return removed;
  }

  /**
   * Edit a cron job.
   */
  editJob(jobId: string, updates: Partial<Pick<CronJob, "name" | "prompt" | "schedule" | "delivery" | "enabled" | "channelId" | "webhookUrl">>): CronJob | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;

    Object.assign(job, updates, { updatedAt: new Date().toISOString() });
    this.saveJobs();

    // Reschedule if enabled/schedule changed
    const timer = this.timers.get(jobId);
    if (timer) {
      clearTimeout(timer as ReturnType<typeof setTimeout>);
      clearInterval(timer as ReturnType<typeof setInterval>);
      this.timers.delete(jobId);
    }
    if (job.enabled) {
      this.scheduleJob(job);
    }

    logger.info({ jobId, name: job.name }, "Cron job edited");
    return job;
  }

  /**
   * Run a job immediately (manual trigger).
   */
  async runJob(jobId: string): Promise<CronRunResult | null> {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    return this.executeJob(job);
  }

  /**
   * List all jobs.
   */
  listJobs(): CronJob[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Get a single job by ID.
   */
  getJob(jobId: string): CronJob | null {
    return this.jobs.get(jobId) ?? null;
  }

  /**
   * Get run count.
   */
  get jobCount(): number {
    return this.jobs.size;
  }

  // ─── Internal ───────────────────────────────────────────────────────────

  private scheduleJob(job: CronJob): void {
    const { type } = job.schedule;

    if (type === "at" && job.schedule.at) {
      const targetTime = new Date(job.schedule.at).getTime();
      const delay = targetTime - Date.now();
      if (delay <= 0) {
        logger.debug({ jobId: job.id }, "One-shot job already past — executing immediately");
        this.executeJob(job).catch((e) => logger.error({ error: String(e) }, "Job execution failed"));
        return;
      }

      // setTimeout uses 32-bit signed int — max ~24.8 days (2^31 - 1 ms).
      // For longer delays, chain timeouts in steps of 12 hours.
      const MAX_TIMEOUT = 2_147_483_647;
      const scheduleWithChaining = (remaining: number): void => {
        const wait = Math.min(remaining, MAX_TIMEOUT);
        const timer = setTimeout(() => {
          const left = remaining - wait;
          if (left > 0) {
            scheduleWithChaining(left);
            return;
          }
          this.executeJob(job).catch((e) => logger.error({ error: String(e) }, "Job execution failed"));
          job.enabled = false;
          this.saveJobs();
        }, wait);
        (timer as NodeJS.Timeout).unref?.();
        this.timers.set(job.id, timer);
      };
      scheduleWithChaining(delay);
    }

    if (type === "every" && job.schedule.everyMs) {
      const timer = setInterval(() => {
        this.executeJob(job).catch((e) => logger.error({ error: String(e) }, "Job execution failed"));
      }, job.schedule.everyMs);
      (timer as NodeJS.Timeout).unref?.();
      this.timers.set(job.id, timer);
    }

    if (type === "cron" && job.schedule.expression) {
      // Simple cron: parse and use setInterval as approximation
      // In production, use croner library for proper 5-field cron
      const intervalMs = this.cronToInterval(job.schedule.expression);
      if (intervalMs > 0) {
        const timer = setInterval(() => {
          this.executeJob(job).catch((e) => logger.error({ error: String(e) }, "Job execution failed"));
        }, intervalMs);
        (timer as NodeJS.Timeout).unref?.();
        this.timers.set(job.id, timer);
      }
    }
  }

  private async executeJob(job: CronJob): Promise<CronRunResult> {
    const runId = `run_${nanoid(8)}`;
    const startedAt = new Date().toISOString();

    logger.info({ jobId: job.id, runId, name: job.name }, "Executing cron job");

    let result: CronRunResult;

    try {
      if (this.executor) {
        result = await this.executor(job);
      } else {
        result = {
          jobId: job.id,
          runId,
          startedAt,
          completedAt: new Date().toISOString(),
          success: false,
          error: "No executor configured",
        };
      }
    } catch (error) {
      result = {
        jobId: job.id,
        runId,
        startedAt,
        completedAt: new Date().toISOString(),
        success: false,
        error: String(error),
      };
    }

    // Update job stats
    job.lastRunAt = result.completedAt;
    job.runCount++;
    this.saveJobs();

    // Log run
    this.logRun(job.id, result);

    logger.info(
      { jobId: job.id, runId, success: result.success, duration: Date.now() - new Date(startedAt).getTime() },
      "Cron job completed",
    );

    return result;
  }

  private loadJobs(): void {
    if (!existsSync(this.storagePath)) return;

    try {
      const data = readFileSync(this.storagePath, "utf-8");
      const jobs = JSON.parse(data) as CronJob[];
      for (const job of jobs) {
        this.jobs.set(job.id, job);
      }
      logger.debug({ jobCount: this.jobs.size }, "Loaded persisted cron jobs");
    } catch (error) {
      logger.warn({ error: String(error) }, "Failed to load cron jobs");
    }
  }

  private saveJobs(): void {
    try {
      const data = JSON.stringify(Array.from(this.jobs.values()), null, 2);
      writeFileSync(this.storagePath, data, "utf-8");
    } catch (error) {
      logger.error({ error: String(error) }, "Failed to save cron jobs");
    }
  }

  private logRun(jobId: string, result: CronRunResult): void {
    try {
      const logFile = join(this.runsPath, `${jobId}.jsonl`);
      appendFileSync(logFile, JSON.stringify(result) + "\n", "utf-8");
    } catch {
      // Non-critical
    }
  }

  /**
   * Simple cron expression to interval converter.
   * Handles common patterns: * /N * * * (every N minutes), 0 * * * * (hourly), etc.
   */
  private cronToInterval(expression: string): number {
    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 5) return 60_000; // Default to 1 minute

    const [min] = parts;

    // Every N minutes: */N * * * *
    const everyNMatch = min?.match(/^\*\/(\d+)$/);
    if (everyNMatch) {
      return parseInt(everyNMatch[1]!, 10) * 60_000;
    }

    // Hourly: 0 * * * *
    if (min === "0" && parts[1] === "*") return 3_600_000;

    // Daily: 0 0 * * * (approximate)
    if (min === "0" && parts[1] === "0" && parts[2] === "*") return 86_400_000;

    // Default: every hour
    return 3_600_000;
  }
}
