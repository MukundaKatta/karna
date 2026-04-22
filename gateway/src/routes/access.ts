import type { FastifyInstance } from "fastify";
import pino from "pino";
import { AccessPolicyManager, type DmAccessMode, type GroupActivationMode } from "../access/policies.js";

const logger = pino({ name: "access-routes" });

interface ModeBody {
  dmMode?: DmAccessMode;
  groupActivation?: GroupActivationMode;
  agentMentionNames?: string[];
}

interface UserBody {
  userId?: string;
}

interface PairingBody {
  code?: string;
}

export function registerAccessRoutes(app: FastifyInstance, accessPolicies: AccessPolicyManager): void {
  app.get("/api/access/policies", async () => {
    return { policies: accessPolicies.listPolicySnapshots() };
  });

  app.get<{ Params: { channel: string } }>("/api/access/policies/:channel", async (request, reply) => {
    const channel = request.params.channel;
    return reply.send({ policy: accessPolicies.getPolicySnapshot(channel) });
  });

  app.patch<{ Params: { channel: string }; Body: ModeBody }>(
    "/api/access/policies/:channel",
    async (request, reply) => {
      const channel = request.params.channel;
      const body = request.body ?? {};

      if (body.dmMode) {
        accessPolicies.setDmMode(channel, body.dmMode);
      }
      if (body.groupActivation) {
        accessPolicies.setGroupActivation(channel, body.groupActivation);
      }
      if (body.agentMentionNames) {
        accessPolicies.setAgentMentionNames(channel, body.agentMentionNames);
      }

      return reply.send({ policy: accessPolicies.getPolicySnapshot(channel) });
    },
  );

  app.post<{ Params: { channel: string }; Body: UserBody }>(
    "/api/access/policies/:channel/allowlist",
    async (request, reply) => {
      const userId = request.body?.userId?.trim();
      if (!userId) {
        return reply.status(400).send({ error: "userId is required" });
      }

      accessPolicies.addToAllowlist(request.params.channel, userId);
      return reply.send({ policy: accessPolicies.getPolicySnapshot(request.params.channel) });
    },
  );

  app.delete<{ Params: { channel: string; userId: string } }>(
    "/api/access/policies/:channel/allowlist/:userId",
    async (request, reply) => {
      const removed = accessPolicies.removeFromAllowlist(request.params.channel, request.params.userId);
      return reply.send({ removed, policy: accessPolicies.getPolicySnapshot(request.params.channel) });
    },
  );

  app.post<{ Params: { channel: string }; Body: UserBody }>(
    "/api/access/policies/:channel/blocklist",
    async (request, reply) => {
      const userId = request.body?.userId?.trim();
      if (!userId) {
        return reply.status(400).send({ error: "userId is required" });
      }

      accessPolicies.addToBlocklist(request.params.channel, userId);
      return reply.send({ policy: accessPolicies.getPolicySnapshot(request.params.channel) });
    },
  );

  app.delete<{ Params: { channel: string; userId: string } }>(
    "/api/access/policies/:channel/blocklist/:userId",
    async (request, reply) => {
      const removed = accessPolicies.removeFromBlocklist(request.params.channel, request.params.userId);
      return reply.send({ removed, policy: accessPolicies.getPolicySnapshot(request.params.channel) });
    },
  );

  app.post<{ Params: { channel: string }; Body: PairingBody }>(
    "/api/access/policies/:channel/pairings/approve",
    async (request, reply) => {
      const code = request.body?.code?.trim();
      if (!code) {
        return reply.status(400).send({ error: "code is required" });
      }

      const result = accessPolicies.verifyPairingCode(request.params.channel, code);
      if (!result.success) {
        return reply.status(404).send({ error: "Pairing code not found or expired" });
      }

      logger.info({ channel: request.params.channel, userId: result.userId }, "Pairing approved via API");
      return reply.send({
        success: true,
        userId: result.userId,
        policy: accessPolicies.getPolicySnapshot(request.params.channel),
      });
    },
  );

  app.delete<{ Params: { channel: string; userId: string } }>(
    "/api/access/policies/:channel/paired/:userId",
    async (request, reply) => {
      const removed = accessPolicies.revokePairedUser(request.params.channel, request.params.userId);
      return reply.send({ removed, policy: accessPolicies.getPolicySnapshot(request.params.channel) });
    },
  );
}
