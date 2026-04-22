import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from "@karna/agent/workflows/engine.js";

function makeNode(
  id: string,
  type: WorkflowNode["type"],
  name: string,
  position: { x: number; y: number },
  config: Record<string, unknown> = {},
): WorkflowNode {
  return { id, type, name, position, config };
}

function makeEdge(
  source: string,
  target: string,
  overrides: Partial<WorkflowEdge> = {},
): WorkflowEdge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    ...overrides,
  };
}

export function createDefaultWorkflows(now = Date.now()): WorkflowDefinition[] {
  return [
    {
      id: "wf-daily-code-review",
      name: "Daily Code Review",
      description: "Review the latest changes, summarize findings, and queue follow-up notes every morning.",
      trigger: {
        type: "schedule",
        config: {
          schedule: "0 9 * * 1-5",
        },
      },
      enabled: true,
      createdAt: now - 14 * 86_400_000,
      updatedAt: now - 3_600_000,
      nodes: [
        makeNode("trigger", "trigger", "Morning trigger", { x: 0, y: 0 }),
        makeNode("collect", "tool_call", "Collect latest diffs", { x: 220, y: 0 }, { tool: "file_read" }),
        makeNode("review", "agent_call", "Review code changes", { x: 460, y: 0 }, { agentId: "karna-coder" }),
        makeNode("summary", "transform", "Format findings", { x: 700, y: 0 }, { template: "Review summary: {{input}}" }),
        makeNode("output", "output", "Publish review digest", { x: 940, y: 0 }),
      ],
      edges: [
        makeEdge("trigger", "collect"),
        makeEdge("collect", "review"),
        makeEdge("review", "summary"),
        makeEdge("summary", "output"),
      ],
    },
    {
      id: "wf-inbox-triage",
      name: "Inbox Triage",
      description: "Scan inbound work, separate urgent items, and produce a concise triage summary.",
      trigger: {
        type: "schedule",
        config: {
          schedule: "*/30 * * * *",
        },
      },
      enabled: true,
      createdAt: now - 30 * 86_400_000,
      updatedAt: now - 1_800_000,
      nodes: [
        makeNode("trigger", "trigger", "Recurring inbox scan", { x: 0, y: 0 }),
        makeNode("fetch", "tool_call", "Fetch inbox events", { x: 210, y: 0 }, { tool: "gmail_search" }),
        makeNode("check", "condition", "Anything urgent?", { x: 420, y: 0 }, { field: "urgent", operator: "equals", value: true }),
        makeNode("urgent", "agent_call", "Draft urgent summary", { x: 650, y: -80 }, { agentId: "karna-general" }),
        makeNode("routine", "transform", "Prepare routine digest", { x: 650, y: 80 }, { template: "Routine inbox digest: {{input}}" }),
        makeNode("merge", "transform", "Merge triage output", { x: 880, y: 0 }, { template: "Triage result: {{input}}" }),
        makeNode("output", "output", "Post triage report", { x: 1110, y: 0 }),
      ],
      edges: [
        makeEdge("trigger", "fetch"),
        makeEdge("fetch", "check"),
        makeEdge("check", "urgent", { condition: "true" }),
        makeEdge("check", "routine", { condition: "false" }),
        makeEdge("urgent", "merge"),
        makeEdge("routine", "merge"),
        makeEdge("merge", "output"),
      ],
    },
    {
      id: "wf-bug-report-handler",
      name: "Bug Report Handler",
      description: "Normalize bug reports from webhooks, enrich context, and prepare a routed incident packet.",
      trigger: {
        type: "webhook",
        config: {
          path: "/webhooks/bugs",
        },
      },
      enabled: true,
      createdAt: now - 7 * 86_400_000,
      updatedAt: now - 7_200_000,
      nodes: [
        makeNode("trigger", "trigger", "Bug report webhook", { x: 0, y: 0 }),
        makeNode("normalize", "transform", "Normalize payload", { x: 230, y: 0 }, { template: "Normalized bug payload: {{input}}" }),
        makeNode("classify", "agent_call", "Classify severity", { x: 470, y: 0 }, { agentId: "karna-coder" }),
        makeNode("route", "tool_call", "Route incident packet", { x: 710, y: 0 }, { tool: "message" }),
        makeNode("output", "output", "Emit triaged report", { x: 940, y: 0 }),
      ],
      edges: [
        makeEdge("trigger", "normalize"),
        makeEdge("normalize", "classify"),
        makeEdge("classify", "route"),
        makeEdge("route", "output"),
      ],
    },
    {
      id: "wf-weekly-digest",
      name: "Weekly Digest",
      description: "Collect the week’s activity, summarize trends, and generate a reusable recap.",
      trigger: {
        type: "schedule",
        config: {
          schedule: "0 17 * * 5",
        },
      },
      enabled: false,
      createdAt: now - 60 * 86_400_000,
      updatedAt: now - 3 * 86_400_000,
      nodes: [
        makeNode("trigger", "trigger", "Friday digest schedule", { x: 0, y: 0 }),
        makeNode("analytics", "tool_call", "Collect analytics", { x: 220, y: 0 }, { tool: "sessions_history" }),
        makeNode("compose", "agent_call", "Write weekly digest", { x: 470, y: 0 }, { agentId: "karna-writer" }),
        makeNode("output", "output", "Publish digest", { x: 710, y: 0 }),
      ],
      edges: [
        makeEdge("trigger", "analytics"),
        makeEdge("analytics", "compose"),
        makeEdge("compose", "output"),
      ],
    },
    {
      id: "wf-customer-onboarding",
      name: "Customer Onboarding",
      description: "React to a new customer event, prepare the welcome flow, and stage next-step handoffs.",
      trigger: {
        type: "event",
        config: {
          eventName: "customer.created",
        },
      },
      enabled: true,
      createdAt: now - 86_400_000,
      updatedAt: now - 86_400_000,
      nodes: [
        makeNode("trigger", "trigger", "New customer event", { x: 0, y: 0 }),
        makeNode("welcome", "agent_call", "Draft welcome message", { x: 220, y: 0 }, { agentId: "karna-general" }),
        makeNode("handoff", "tool_call", "Create onboarding task", { x: 460, y: 0 }, { tool: "sessions_spawn" }),
        makeNode("delay", "delay", "Wait for acknowledgment", { x: 700, y: 0 }, { delayMs: 1000 }),
        makeNode("output", "output", "Finalize onboarding packet", { x: 940, y: 0 }),
      ],
      edges: [
        makeEdge("trigger", "welcome"),
        makeEdge("welcome", "handoff"),
        makeEdge("handoff", "delay"),
        makeEdge("delay", "output"),
      ],
    },
  ];
}
