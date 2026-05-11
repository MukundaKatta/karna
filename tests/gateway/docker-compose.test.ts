import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DOCKER_COMPOSE_PATH = fileURLToPath(new URL("../../docker-compose.yml", import.meta.url));
const PRODUCTION_COMPOSE_PATH = fileURLToPath(new URL("../../docker-compose.production.yml", import.meta.url));
const WEB_DOCKERFILE_PATH = fileURLToPath(new URL("../../apps/web/Dockerfile", import.meta.url));

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

describe("docker-compose production", () => {
  it("waits for healthy gateway before starting web", () => {
    const src = readFileSync(PRODUCTION_COMPOSE_PATH, "utf-8");
    expect(src).toMatch(/web:[\s\S]*depends_on:[\s\S]*gateway:[\s\S]*condition: service_healthy/);
  });

  it("defines health checks for gateway and web services", () => {
    const src = readFileSync(PRODUCTION_COMPOSE_PATH, "utf-8");
    expect(src).toMatch(/gateway:[\s\S]*healthcheck:[\s\S]*\/health/);
    expect(src).toMatch(/web:[\s\S]*healthcheck:[\s\S]*\/api\/health/);
  });
});

describe("web Dockerfile", () => {
  it("defines a container health check against the Next.js health endpoint", () => {
    const src = readFileSync(WEB_DOCKERFILE_PATH, "utf-8");
    expect(src).toMatch(/HEALTHCHECK[\s\S]*\/api\/health/);
  });
});
