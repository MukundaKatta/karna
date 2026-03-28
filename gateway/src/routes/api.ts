// ─── REST API Routes ──────────────────────────────────────────────────────
//
// Additional REST endpoints for the gateway beyond the core WebSocket protocol.
// Provides agent management, activity feeds, and trace APIs.
//
// ──────────────────────────────────────────────────────────────────────────

import type { FastifyInstance } from "fastify";
import pino from "pino";

const logger = pino({ name: "api-routes" });

interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  model: string;
  status: "active" | "inactive";
  persona: string;
  tools: string[];
  sessions: number;
  messages: number;
  createdAt: number;
}

// Default agents matching the orchestrator definitions
const defaultAgents: AgentDefinition[] = [
  {
    id: "karna-default",
    name: "Karna Default",
    description: "A helpful AI assistant that can use tools and skills to complete tasks.",
    model: "claude-sonnet-4-20250514",
    status: "active",
    persona: "helpful, thorough, concise",
    tools: ["file_read", "file_write", "web_search", "code_execute", "shell_exec"],
    sessions: 156,
    messages: 4231,
    createdAt: Date.now() - 86400000 * 30,
  },
  {
    id: "code-reviewer",
    name: "Code Reviewer",
    description: "An expert code reviewer focused on quality, security, and best practices.",
    model: "claude-sonnet-4-20250514",
    status: "active",
    persona: "meticulous, security-focused",
    tools: ["file_read", "git_diff", "code_analyze"],
    sessions: 42,
    messages: 892,
    createdAt: Date.now() - 86400000 * 14,
  },
  {
    id: "research-assistant",
    name: "Research Assistant",
    description: "A research-oriented assistant that gathers, synthesizes, and presents information.",
    model: "claude-sonnet-4-20250514",
    status: "active",
    persona: "thorough, analytical",
    tools: ["web_search", "web_scrape", "file_write"],
    sessions: 18,
    messages: 340,
    createdAt: Date.now() - 86400000 * 7,
  },
  {
    id: "writer",
    name: "Content Writer",
    description: "A skilled writer that creates blog posts, documentation, and marketing copy.",
    model: "claude-sonnet-4-20250514",
    status: "active",
    persona: "creative, clear communicator",
    tools: ["web_search", "file_write", "file_read"],
    sessions: 24,
    messages: 567,
    createdAt: Date.now() - 86400000 * 5,
  },
];

export function registerApiRoutes(app: FastifyInstance): void {
  // ─── Agents ────────────────────────────────────────────────────────
  app.get("/api/agents", async () => {
    return { agents: defaultAgents };
  });

  app.get<{ Params: { id: string } }>("/api/agents/:id", async (req) => {
    const agent = defaultAgents.find((a) => a.id === req.params.id);
    if (!agent) return { error: "Agent not found" };
    return agent;
  });

  // ─── Activity Feed ─────────────────────────────────────────────────
  app.get("/api/activity", async () => {
    const activities = [
      { type: "session", message: "New web chat session started", timestamp: Date.now() - 60000 },
      { type: "tool", message: "file_read tool executed in session #42", timestamp: Date.now() - 180000 },
      { type: "memory", message: "15 new memories stored from conversation", timestamp: Date.now() - 300000 },
      { type: "agent", message: "Agent model switched to claude-sonnet-4-20250514", timestamp: Date.now() - 600000 },
      { type: "skill", message: "code-review skill triggered", timestamp: Date.now() - 900000 },
      { type: "session", message: "CLI session terminated after 45 minutes", timestamp: Date.now() - 1200000 },
      { type: "tool", message: "web_search executed 3 times in session #38", timestamp: Date.now() - 1500000 },
      { type: "memory", message: "Memory promotion: 5 entries moved to long-term", timestamp: Date.now() - 1800000 },
    ];
    return { activities };
  });

  // ─── Analytics History ──────────────────────────────────────────────
  app.get("/api/analytics/history", async (req) => {
    const query = req.query as { period?: string };
    const days = query.period === "30d" ? 30 : query.period === "14d" ? 14 : 7;
    const now = Date.now();

    const history = Array.from({ length: days }, (_, i) => {
      const date = new Date(now - (days - 1 - i) * 86400000);
      return {
        date: date.toISOString().split("T")[0],
        messages: 400 + Math.floor(Math.random() * 600),
        tokens: 20000 + Math.floor(Math.random() * 40000),
        cost: +(0.5 + Math.random() * 2.5).toFixed(2),
      };
    });

    return {
      period: `${days}d`,
      history,
      totals: {
        messages: history.reduce((s, h) => s + h.messages, 0),
        tokens: history.reduce((s, h) => s + h.tokens, 0),
        cost: +history.reduce((s, h) => s + h.cost, 0).toFixed(2),
      },
    };
  });

  // ─── Skills ─────────────────────────────────────────────────────────
  app.get("/api/skills", async () => {
    return {
      skills: [
        { id: "code-reviewer", name: "Code Review", version: "1.2.0", enabled: true, category: "Development" },
        { id: "web-research", name: "Web Research", version: "1.0.3", enabled: true, category: "Research" },
        { id: "file-manager", name: "File Manager", version: "2.0.1", enabled: true, category: "System" },
        { id: "task-planner", name: "Task Planner", version: "0.9.0", enabled: false, category: "Productivity" },
        { id: "memory-manager", name: "Memory Manager", version: "1.1.0", enabled: true, category: "System" },
        { id: "git-operations", name: "Git Operations", version: "1.3.0", enabled: false, category: "Development" },
        { id: "daily-briefing", name: "Daily Briefing", version: "1.0.0", enabled: true, category: "Productivity" },
        { id: "expense-tracker", name: "Expense Tracker", version: "1.0.0", enabled: true, category: "Productivity" },
      ],
    };
  });

  // ─── Tools ──────────────────────────────────────────────────────────
  app.get("/api/tools", async () => {
    return {
      tools: [
        { name: "file_read", riskLevel: "low", uses: 432, requiresApproval: false, enabled: true },
        { name: "file_write", riskLevel: "medium", uses: 156, requiresApproval: true, enabled: true },
        { name: "web_search", riskLevel: "low", uses: 289, requiresApproval: false, enabled: true },
        { name: "code_execute", riskLevel: "high", uses: 87, requiresApproval: true, enabled: true },
        { name: "shell_exec", riskLevel: "critical", uses: 12, requiresApproval: true, enabled: false },
        { name: "git_commit", riskLevel: "medium", uses: 45, requiresApproval: true, enabled: true },
        { name: "db_query", riskLevel: "high", uses: 67, requiresApproval: true, enabled: true },
        { name: "web_scrape", riskLevel: "low", uses: 134, requiresApproval: false, enabled: true },
      ],
    };
  });

  logger.info("API routes registered");
}
