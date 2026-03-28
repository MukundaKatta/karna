// ─── Readiness & Liveness Probes ──────────────────────────────────────────
//
// Kubernetes/Docker-compatible health check endpoints:
// - /health/live    — Is the process alive?
// - /health/ready   — Is it ready to accept traffic?
// - /health/startup — Has it finished initialization?
//
// ──────────────────────────────────────────────────────────────────────────

import type { FastifyInstance } from "fastify";

let isReady = false;
let startupComplete = false;

export function setReady(ready: boolean): void {
  isReady = ready;
}

export function setStartupComplete(complete: boolean): void {
  startupComplete = complete;
  if (complete) isReady = true;
}

export function registerHealthProbes(app: FastifyInstance): void {
  // Liveness: is the process running?
  app.get("/health/live", async (_, reply) => {
    reply.code(200).send({ status: "alive", timestamp: Date.now() });
  });

  // Readiness: ready to accept traffic?
  app.get("/health/ready", async (_, reply) => {
    if (isReady) {
      reply.code(200).send({ status: "ready", timestamp: Date.now() });
    } else {
      reply.code(503).send({ status: "not ready", timestamp: Date.now() });
    }
  });

  // Startup: has initialization completed?
  app.get("/health/startup", async (_, reply) => {
    if (startupComplete) {
      reply.code(200).send({ status: "started", timestamp: Date.now() });
    } else {
      reply.code(503).send({ status: "starting", timestamp: Date.now() });
    }
  });
}
