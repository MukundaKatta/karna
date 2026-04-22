import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DOCKER_COMPOSE_PATH = fileURLToPath(new URL("../../docker-compose.yml", import.meta.url));

describe("docker-compose local development", () => {
  it("defines gateway bind mounts for hot reload", () => {
    const src = readFileSync(DOCKER_COMPOSE_PATH, "utf-8");
    expect(src).toMatch(/\.\/gateway:\/app\/gateway/);
    expect(src).toMatch(/\.\/agent:\/app\/agent/);
    expect(src).toMatch(/\.\/packages:\/app\/packages/);
  });

  it("defines health checks for critical services", () => {
    const src = readFileSync(DOCKER_COMPOSE_PATH, "utf-8");
    expect(src).toMatch(/gateway:[\s\S]*healthcheck:/);
    expect(src).toMatch(/supabase-auth:[\s\S]*healthcheck:/);
    expect(src).toMatch(/redis:[\s\S]*healthcheck:/);
  });
});
