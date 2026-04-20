import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = "/tmp/karna-user";

describe("docker-compose local development", () => {
  it("defines gateway bind mounts for hot reload", () => {
    const src = readFileSync(join(ROOT, "docker-compose.yml"), "utf-8");
    expect(src).toMatch(/\.\/gateway:\/app\/gateway/);
    expect(src).toMatch(/\.\/agent:\/app\/agent/);
    expect(src).toMatch(/\.\/packages:\/app\/packages/);
  });

  it("defines health checks for critical services", () => {
    const src = readFileSync(join(ROOT, "docker-compose.yml"), "utf-8");
    expect(src).toMatch(/gateway:[\s\S]*healthcheck:/);
    expect(src).toMatch(/supabase-auth:[\s\S]*healthcheck:/);
    expect(src).toMatch(/redis:[\s\S]*healthcheck:/);
  });
});
