import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  hashModerationContent,
  listModerationReviewItems,
  logModerationReport,
} from "../security/moderation.js";

const ReportModerationSchema = z.object({
  sessionId: z.string().min(1),
  messageId: z.string().min(1).optional(),
  reason: z.string().min(1).max(120),
  details: z.string().max(2_000).optional(),
  reporterId: z.string().max(120).optional(),
  content: z.string().max(20_000).optional(),
});

interface ModerationQuerystring {
  limit?: string | number;
}

export function registerModerationRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: ModerationQuerystring }>("/api/moderation", async (request, reply) => {
    const limit = parsePositiveInt(request.query?.limit, 100);
    if (limit === null) {
      return reply.status(400).send({ error: "limit must be a positive integer" });
    }

    const items = await listModerationReviewItems(limit);
    return reply.send({ items, total: items.length });
  });

  app.post("/api/moderation/reports", async (request, reply) => {
    const parsed = ReportModerationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const report = {
      id: nanoid(),
      ...parsed.data,
      contentHash: parsed.data.content ? hashModerationContent(parsed.data.content) : undefined,
      timestamp: Date.now(),
    };
    await logModerationReport(report);

    return reply.status(201).send({ report });
  });
}

function parsePositiveInt(value: string | number | undefined, fallback: number): number | null {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
