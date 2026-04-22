import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import pino from "pino";
import { allBuiltinTools } from "@karna/agent/tools/builtin/index.js";
import type { TraceCollector } from "../observability/trace-collector.js";
import type { AuditLogger } from "../audit/logger.js";
import { DEFAULT_AGENTS } from "../catalog/default-agents.js";

const logger = pino({ name: "catalog-routes" });
const BUILTIN_SKILLS_DIR = resolve(import.meta.dirname, "../../../skills/builtin");
const COMMUNITY_SKILLS_DB = join(homedir(), ".karna", "community-skills", "installed.json");

interface AnalyticsHistoryQuery {
  period?: string;
}

interface AgentParams {
  id: string;
}

interface SkillCatalogEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  enabled: boolean;
  actions: number;
  triggers: number;
  category?: string;
  author?: string;
  tags: string[];
  source: "builtin" | "community";
}

export function registerApiRoutes(
  app: FastifyInstance,
  services: {
    traceCollector: TraceCollector;
    auditLogger: AuditLogger;
  },
): void {
  app.get("/api/agents", async () => {
    return {
      agents: buildAgentCatalog(services.traceCollector),
    };
  });

  app.get<{ Params: AgentParams }>("/api/agents/:id", async (request, reply) => {
    const agent = buildAgentCatalog(services.traceCollector).find(
      (entry) => entry.id === request.params.id,
    );

    if (!agent) {
      return reply.status(404).send({ error: "Agent not found" });
    }

    return reply.send({ agent });
  });

  app.get("/api/tools", async () => {
    return {
      tools: buildToolCatalog(services.traceCollector),
    };
  });

  app.get("/api/skills", async () => {
    return {
      skills: await loadSkillCatalog(),
    };
  });

  app.get<{ Querystring: AnalyticsHistoryQuery }>(
    "/api/analytics/history",
    async (request, reply) => {
      const days = parseHistoryPeriod(request.query?.period);
      if (!days) {
        return reply.status(400).send({ error: "period must be one of 7d, 14d, or 30d" });
      }

      const payload = await buildAnalyticsHistory(
        days,
        services.traceCollector,
        services.auditLogger,
      );
      return reply.send(payload);
    },
  );

  logger.info("Catalog API routes registered");
}

function buildAgentCatalog(traceCollector: TraceCollector) {
  const traces = traceCollector.queryTraces({
    limit: 10_000,
    includeActive: true,
  }).traces;

  return DEFAULT_AGENTS.map((agent) => {
    const agentTraces = traces.filter((trace) => trace.agentId === agent.id);
    const activeTraces = agentTraces.filter((trace) => trace.endedAt === undefined).length;
    const completedTraces = agentTraces.filter((trace) => trace.endedAt !== undefined);
    const lastTraceAt = agentTraces
      .map((trace) => trace.endedAt ?? trace.startedAt)
      .sort((a, b) => b - a)[0];

    return {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      model: agent.model ?? "default",
      provider: agent.provider ?? "default",
      persona: agent.persona ?? "",
      status: activeTraces > 0 ? "active" : completedTraces.length > 0 ? "idle" : "inactive",
      specializations: agent.specializations ?? [],
      tools: agent.tools ?? [],
      turns: completedTraces.length,
      activeTraces,
      lastTraceAt,
    };
  });
}

function buildToolCatalog(traceCollector: TraceCollector) {
  const traces = traceCollector.queryTraces({
    limit: 10_000,
    includeActive: true,
  }).traces;

  const usageByTool = new Map<
    string,
    { totalCalls: number; failedCalls: number; lastUsedAt?: number }
  >();

  for (const trace of traces) {
    for (const span of trace.spans) {
      if (span.kind !== "tool") continue;

      const entry = usageByTool.get(span.name) ?? {
        totalCalls: 0,
        failedCalls: 0,
        lastUsedAt: undefined,
      };
      entry.totalCalls += 1;
      if (span.status === "error") {
        entry.failedCalls += 1;
      }
      entry.lastUsedAt = Math.max(
        entry.lastUsedAt ?? 0,
        span.endedAt ?? span.startedAt,
      );
      usageByTool.set(span.name, entry);
    }
  }

  return allBuiltinTools.map((tool) => {
    const usage = usageByTool.get(tool.name);
    return {
      name: tool.name,
      description: tool.description,
      riskLevel: tool.riskLevel,
      requiresApproval: tool.requiresApproval,
      timeout: tool.timeout,
      tags: tool.tags ?? [],
      enabled: true,
      totalCalls: usage?.totalCalls ?? 0,
      failedCalls: usage?.failedCalls ?? 0,
      lastUsedAt: usage?.lastUsedAt,
    };
  });
}

async function loadSkillCatalog(): Promise<SkillCatalogEntry[]> {
  const [builtinSkills, communitySkills] = await Promise.all([
    loadBuiltinSkillCatalog(),
    loadCommunitySkillCatalog(),
  ]);

  return [...builtinSkills, ...communitySkills].sort((a, b) => a.name.localeCompare(b.name));
}

async function loadBuiltinSkillCatalog(): Promise<SkillCatalogEntry[]> {
  let entries: string[] = [];
  try {
    entries = await readdir(BUILTIN_SKILLS_DIR);
  } catch (error) {
    logger.warn({ error: String(error) }, "Failed to read builtin skills directory");
    return [];
  }

  const skills: Array<SkillCatalogEntry | null> = await Promise.all(
    entries.map(async (entry) => {
      const skillPath = join(BUILTIN_SKILLS_DIR, entry, "SKILL.md");
      try {
        const raw = await readFile(skillPath, "utf-8");
        const parsed = parseSkillMarkdown(entry, raw);
        return {
          ...parsed,
          source: "builtin" as const,
        };
      } catch {
        return null;
      }
    }),
  );

  return skills.filter((skill): skill is SkillCatalogEntry => skill !== null);
}

async function loadCommunitySkillCatalog(): Promise<SkillCatalogEntry[]> {
  try {
    const raw = await readFile(COMMUNITY_SKILLS_DB, "utf-8");
    const parsed = JSON.parse(raw) as {
      installed?: Array<{
        name: string;
        version: string;
        manifest?: {
          displayName?: string;
          description?: string;
          author?: string;
          tags?: string[];
        };
      }>;
    };

    return (parsed.installed ?? []).map((skill) => ({
      id: skill.name,
      name: skill.manifest?.displayName ?? skill.name,
      description: skill.manifest?.description ?? "",
      version: skill.version,
      enabled: true,
      actions: 0,
      triggers: 0,
      category: skill.manifest?.tags?.[0],
      author: skill.manifest?.author,
      tags: skill.manifest?.tags ?? [],
      source: "community",
    }));
  } catch (error) {
    logger.warn({ error: String(error) }, "Failed to load community skill catalog");
    return [];
  }
}

function parseSkillMarkdown(id: string, raw: string): Omit<SkillCatalogEntry, "source"> {
  const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  const frontmatter = frontmatterMatch?.[1] ?? "";

  const name = readScalar(frontmatter, "name") ?? id;
  const description = readScalar(frontmatter, "description") ?? "";
  const version = readScalar(frontmatter, "version") ?? "1.0.0";
  const author = readScalar(frontmatter, "author") ?? undefined;
  const category = readScalar(frontmatter, "category") ?? undefined;
  const enabledValue = readScalar(frontmatter, "enabled");
  const enabled = enabledValue === undefined ? true : enabledValue === "true";
  const tags = readList(frontmatter, "tags");

  return {
    id,
    name,
    description,
    version,
    enabled,
    actions: countSectionItems(frontmatter, "actions", "name"),
    triggers: countSectionItems(frontmatter, "triggers", "type"),
    category,
    author,
    tags,
  };
}

function readScalar(frontmatter: string, key: string): string | undefined {
  const match = frontmatter.match(new RegExp(`^${escapeRegex(key)}:\\s*(.+)$`, "m"));
  if (!match?.[1]) return undefined;

  return stripQuotes(match[1].trim());
}

function readList(frontmatter: string, key: string): string[] {
  const lines = frontmatter.split("\n");
  const values: string[] = [];
  let collecting = false;

  for (const line of lines) {
    if (!collecting && line.startsWith(`${key}:`)) {
      collecting = true;
      continue;
    }

    if (!collecting) continue;

    if (/^[a-zA-Z][a-zA-Z0-9]*:/.test(line)) {
      break;
    }

    const itemMatch = line.match(/^\s*-\s+(.+)$/);
    if (itemMatch?.[1]) {
      values.push(stripQuotes(itemMatch[1].trim()));
    }
  }

  return values;
}

function countSectionItems(frontmatter: string, section: string, markerKey: string): number {
  const sectionMatch = frontmatter.match(
    new RegExp(`^${escapeRegex(section)}:\\n([\\s\\S]*?)(?=^[a-zA-Z][a-zA-Z0-9]*:|$)`, "m"),
  );
  if (!sectionMatch?.[1]) return 0;

  const itemRegex = new RegExp(`^\\s*-\\s+${escapeRegex(markerKey)}:`, "gm");
  return sectionMatch[1].match(itemRegex)?.length ?? 0;
}

function stripQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, "");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseHistoryPeriod(period: string | undefined): number | null {
  if (!period || period === "7d") return 7;
  if (period === "14d") return 14;
  if (period === "30d") return 30;
  return null;
}

async function buildAnalyticsHistory(
  days: number,
  traceCollector: TraceCollector,
  auditLogger: AuditLogger,
): Promise<{
  period: string;
  history: Array<{
    date: string;
    messages: number;
    tokens: number;
    cost: number;
    sessions: number;
    toolCalls: number;
    errors: number;
  }>;
  totals: {
    messages: number;
    tokens: number;
    cost: number;
    sessions: number;
    toolCalls: number;
    errors: number;
  };
}> {
  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const start = startOfToday.getTime() - (days - 1) * 86_400_000;
  const traces = traceCollector.queryTraces({
    limit: 10_000,
    since: start,
  }).traces;
  const sessionEvents = await auditLogger.query({
    eventType: "session.created",
    since: start,
    limit: 10_000,
  });

  const buckets = new Map<string, {
    date: string;
    messages: number;
    tokens: number;
    cost: number;
    sessions: number;
    toolCalls: number;
    errors: number;
  }>();

  for (let i = 0; i < days; i++) {
    const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    buckets.set(date, {
      date,
      messages: 0,
      tokens: 0,
      cost: 0,
      sessions: 0,
      toolCalls: 0,
      errors: 0,
    });
  }

  for (const trace of traces) {
    const bucket = buckets.get(new Date(trace.startedAt).toISOString().slice(0, 10));
    if (!bucket) continue;

    bucket.messages += 1;
    bucket.tokens += trace.inputTokens + trace.outputTokens;
    bucket.cost += trace.costUsd;
    bucket.toolCalls += trace.toolCalls;
    if (!trace.success) {
      bucket.errors += 1;
    }
  }

  for (const event of sessionEvents) {
    const bucket = buckets.get(new Date(event.timestamp).toISOString().slice(0, 10));
    if (!bucket) continue;
    bucket.sessions += 1;
  }

  const history = Array.from(buckets.values());

  return {
    period: `${days}d`,
    history,
    totals: {
      messages: history.reduce((sum, item) => sum + item.messages, 0),
      tokens: history.reduce((sum, item) => sum + item.tokens, 0),
      cost: Number(history.reduce((sum, item) => sum + item.cost, 0).toFixed(4)),
      sessions: history.reduce((sum, item) => sum + item.sessions, 0),
      toolCalls: history.reduce((sum, item) => sum + item.toolCalls, 0),
      errors: history.reduce((sum, item) => sum + item.errors, 0),
    },
  };
}
