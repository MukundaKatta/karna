import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CronScheduler, type CronJob, type CronRunResult } from "../../gateway/src/cron/scheduler.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("CronScheduler", () => {
  let scheduler: CronScheduler;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "karna-cron-test-"));
    scheduler = new CronScheduler(tempDir);
  });

  afterEach(() => {
    scheduler.stop();
    try { rmSync(tempDir, { recursive: true }); } catch {}
  });

  it("adds and lists jobs", () => {
    const job = scheduler.addJob({
      name: "test-job",
      prompt: "Do something",
      schedule: { type: "every", everyMs: 60_000 },
      delivery: "none",
      enabled: true,
    });

    expect(job.id).toBeTruthy();
    expect(job.name).toBe("test-job");
    expect(scheduler.jobCount).toBe(1);

    const listed = scheduler.listJobs();
    expect(listed).toHaveLength(1);
    expect(listed[0]!.id).toBe(job.id);
  });

  it("removes jobs", () => {
    const job = scheduler.addJob({
      name: "to-remove",
      prompt: "test",
      schedule: { type: "every", everyMs: 60_000 },
      delivery: "none",
      enabled: true,
    });

    expect(scheduler.removeJob(job.id)).toBe(true);
    expect(scheduler.jobCount).toBe(0);
    expect(scheduler.removeJob("nonexistent")).toBe(false);
  });

  it("edits jobs", () => {
    const job = scheduler.addJob({
      name: "editable",
      prompt: "original",
      schedule: { type: "every", everyMs: 60_000 },
      delivery: "none",
      enabled: true,
    });

    const edited = scheduler.editJob(job.id, { name: "edited", prompt: "updated" });
    expect(edited?.name).toBe("edited");
    expect(edited?.prompt).toBe("updated");
  });

  it("returns null when editing nonexistent job", () => {
    expect(scheduler.editJob("nonexistent", { name: "test" })).toBeNull();
  });

  it("gets a single job", () => {
    const job = scheduler.addJob({
      name: "lookup",
      prompt: "test",
      schedule: { type: "at", at: new Date(Date.now() + 3600000).toISOString() },
      delivery: "none",
      enabled: false,
    });

    expect(scheduler.getJob(job.id)?.name).toBe("lookup");
    expect(scheduler.getJob("nonexistent")).toBeNull();
  });

  it("runs a job manually with executor", async () => {
    const results: string[] = [];
    scheduler.setExecutor(async (job): Promise<CronRunResult> => {
      results.push(job.name);
      return {
        jobId: job.id,
        runId: "test-run",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        success: true,
        output: "done",
      };
    });

    const job = scheduler.addJob({
      name: "manual-run",
      prompt: "test",
      schedule: { type: "at", at: new Date(Date.now() + 3600000).toISOString() },
      delivery: "none",
      enabled: false,
    });

    const result = await scheduler.runJob(job.id);
    expect(result?.success).toBe(true);
    expect(results).toEqual(["manual-run"]);
    expect(job.runCount).toBe(1);
  });

  it("returns null when running nonexistent job", async () => {
    expect(await scheduler.runJob("nonexistent")).toBeNull();
  });

  it("persists jobs across instances", () => {
    scheduler.addJob({
      name: "persistent",
      prompt: "test",
      schedule: { type: "every", everyMs: 60_000 },
      delivery: "none",
      enabled: true,
    });

    // Create new scheduler pointing to same directory
    const scheduler2 = new CronScheduler(tempDir);
    expect(scheduler2.jobCount).toBe(1);
    expect(scheduler2.listJobs()[0]?.name).toBe("persistent");
    scheduler2.stop();
  });
});
