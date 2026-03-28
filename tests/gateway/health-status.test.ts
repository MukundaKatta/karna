import { describe, it, expect, beforeEach } from "vitest";
import {
  getSystemHealth,
  setConnectionCounter,
  setSessionCounter,
  setDatabaseChecker,
} from "../../gateway/src/health/status.js";

describe("Health Status", () => {
  beforeEach(() => {
    setConnectionCounter(() => 0);
    setSessionCounter(() => 0);
  });

  it("returns healthy status by default", () => {
    const health = getSystemHealth();
    expect(health.status).toBe("healthy");
    expect(health.version).toBe("0.1.0");
    expect(health.uptime).toBeGreaterThan(0);
    expect(health.connections).toBe(0);
    expect(health.sessions).toBe(0);
  });

  it("reports memory usage", () => {
    const health = getSystemHealth();
    expect(health.memoryUsage.heapUsedMB).toBeGreaterThan(0);
    expect(health.memoryUsage.heapTotalMB).toBeGreaterThan(0);
    expect(health.memoryUsage.rssMB).toBeGreaterThan(0);
  });

  it("formats uptime as human-readable string", () => {
    const health = getSystemHealth();
    expect(health.uptimeHuman).toMatch(/\d+[smhd]/);
  });

  it("reflects connection and session counters", () => {
    setConnectionCounter(() => 5);
    setSessionCounter(() => 10);
    const health = getSystemHealth();
    expect(health.connections).toBe(5);
    expect(health.sessions).toBe(10);
  });

  it("includes startedAt timestamp", () => {
    const health = getSystemHealth();
    expect(health.startedAt).toBeLessThanOrEqual(Date.now());
    expect(health.startedAt).toBeGreaterThan(0);
  });

  it("includes database status as unknown by default", () => {
    const health = getSystemHealth();
    expect(health.database).toBe("unknown");
  });

  it("reports database connected via checker", async () => {
    setDatabaseChecker(async () => true);
    // Wait for initial async check
    await new Promise((r) => setTimeout(r, 10));
    const health = getSystemHealth();
    expect(health.database).toBe("connected");
  });

  it("reports database disconnected on checker failure", async () => {
    setDatabaseChecker(async () => { throw new Error("down"); });
    await new Promise((r) => setTimeout(r, 10));
    const health = getSystemHealth();
    expect(health.database).toBe("disconnected");
  });
});
