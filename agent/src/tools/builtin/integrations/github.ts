// ─── GitHub Integration Tools ─────────────────────────────────────────────
//
// Uses the `gh` CLI (https://cli.github.com/) for all operations.
// Requires `gh` to be installed and authenticated (`gh auth login`).

import { execFile } from "node:child_process";
import { z } from "zod";
import type { ToolDefinitionRuntime, ToolExecutionContext } from "../../registry.js";

const GH_TIMEOUT_MS = 15_000;
const MAX_OUTPUT = 30_000;

// ─── Helpers ──────────────────────────────────────────────────────────────

function runGh(
  args: string[],
  timeoutMs: number = GH_TIMEOUT_MS
): Promise<{ output: string; isError: boolean }> {
  return new Promise((resolve) => {
    execFile(
      "gh",
      args,
      { timeout: timeoutMs, maxBuffer: MAX_OUTPUT * 2, env: { ...process.env, NO_COLOR: "1" } },
      (error, stdout, stderr) => {
        if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
          resolve({
            output:
              "The `gh` CLI is not installed. Install it from https://cli.github.com/ and run `gh auth login`.",
            isError: true,
          });
          return;
        }
        if (error?.killed) {
          resolve({ output: `Command timed out after ${timeoutMs}ms`, isError: true });
          return;
        }
        const out = (stdout || "").trim();
        const err = (stderr || "").trim();
        if (error) {
          resolve({
            output: err || out || `gh exited with code ${(error as any).code ?? 1}`,
            isError: true,
          });
          return;
        }
        resolve({ output: out || "(no output)", isError: false });
      }
    );
  });
}

// ─── github_list_repos ────────────────────────────────────────────────────

const ListReposSchema = z.object({
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Max repos to return (default 30)"),
  owner: z
    .string()
    .optional()
    .describe("Filter by owner/org. Omit for your own repos."),
  visibility: z
    .enum(["public", "private", "internal"])
    .optional()
    .describe("Filter by visibility"),
});

export const githubListReposTool: ToolDefinitionRuntime = {
  name: "github_list_repos",
  description:
    "List GitHub repositories for the authenticated user or a given owner. " +
    "Requires the `gh` CLI to be installed and authenticated.",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "integer", description: "Max repos to return (default 30)", maximum: 100 },
      owner: { type: "string", description: "Filter by owner/org" },
      visibility: {
        type: "string",
        enum: ["public", "private", "internal"],
        description: "Filter by visibility",
      },
    },
  },
  inputSchema: ListReposSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: GH_TIMEOUT_MS,
  tags: ["integration", "github"],

  async execute(input) {
    const p = ListReposSchema.parse(input);
    const args = ["repo", "list"];
    if (p.owner) args.push(p.owner);
    args.push("--limit", String(p.limit ?? 30));
    if (p.visibility) args.push("--visibility", p.visibility);
    args.push("--json", "name,owner,description,visibility,updatedAt,url");
    return runGh(args);
  },
};

// ─── github_list_prs ──────────────────────────────────────────────────────

const ListPRsSchema = z.object({
  repo: z.string().describe("Repository in OWNER/NAME format"),
  state: z.enum(["open", "closed", "merged", "all"]).optional().describe("Filter by state"),
  limit: z.number().int().min(1).max(100).optional().describe("Max PRs to return (default 30)"),
  author: z.string().optional().describe("Filter by author username"),
});

export const githubListPRsTool: ToolDefinitionRuntime = {
  name: "github_list_prs",
  description:
    "List pull requests for a GitHub repository. Returns title, number, state, author, and URL.",
  parameters: {
    type: "object",
    properties: {
      repo: { type: "string", description: "Repository in OWNER/NAME format" },
      state: {
        type: "string",
        enum: ["open", "closed", "merged", "all"],
        description: "Filter by state",
      },
      limit: { type: "integer", description: "Max PRs (default 30)", maximum: 100 },
      author: { type: "string", description: "Filter by author" },
    },
    required: ["repo"],
  },
  inputSchema: ListPRsSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: GH_TIMEOUT_MS,
  tags: ["integration", "github"],

  async execute(input) {
    const p = ListPRsSchema.parse(input);
    const args = ["pr", "list", "--repo", p.repo];
    if (p.state) args.push("--state", p.state);
    args.push("--limit", String(p.limit ?? 30));
    if (p.author) args.push("--author", p.author);
    args.push("--json", "number,title,state,author,url,createdAt,updatedAt");
    return runGh(args);
  },
};

// ─── github_pr_view ───────────────────────────────────────────────────────

const PRViewSchema = z.object({
  repo: z.string().describe("Repository in OWNER/NAME format"),
  number: z.number().int().positive().describe("PR number"),
});

export const githubPRViewTool: ToolDefinitionRuntime = {
  name: "github_pr_view",
  description:
    "View details of a specific pull request including title, body, reviews, checks, and diff stats.",
  parameters: {
    type: "object",
    properties: {
      repo: { type: "string", description: "Repository in OWNER/NAME format" },
      number: { type: "integer", description: "PR number" },
    },
    required: ["repo", "number"],
  },
  inputSchema: PRViewSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: GH_TIMEOUT_MS,
  tags: ["integration", "github"],

  async execute(input) {
    const p = PRViewSchema.parse(input);
    const args = [
      "pr",
      "view",
      String(p.number),
      "--repo",
      p.repo,
      "--json",
      "number,title,body,state,author,reviewDecision,additions,deletions,files,url,createdAt,mergedAt,comments",
    ];
    return runGh(args);
  },
};

// ─── github_create_issue ──────────────────────────────────────────────────

const CreateIssueSchema = z.object({
  repo: z.string().describe("Repository in OWNER/NAME format"),
  title: z.string().min(1).describe("Issue title"),
  body: z.string().optional().describe("Issue body (markdown)"),
  labels: z.array(z.string()).optional().describe("Labels to apply"),
  assignees: z.array(z.string()).optional().describe("Usernames to assign"),
});

export const githubCreateIssueTool: ToolDefinitionRuntime = {
  name: "github_create_issue",
  description: "Create a new issue in a GitHub repository.",
  parameters: {
    type: "object",
    properties: {
      repo: { type: "string", description: "Repository in OWNER/NAME format" },
      title: { type: "string", description: "Issue title" },
      body: { type: "string", description: "Issue body (markdown)" },
      labels: { type: "array", items: { type: "string" }, description: "Labels" },
      assignees: { type: "array", items: { type: "string" }, description: "Assignees" },
    },
    required: ["repo", "title"],
  },
  inputSchema: CreateIssueSchema,
  riskLevel: "medium",
  requiresApproval: true,
  timeout: GH_TIMEOUT_MS,
  tags: ["integration", "github"],

  async execute(input) {
    const p = CreateIssueSchema.parse(input);
    const args = ["issue", "create", "--repo", p.repo, "--title", p.title];
    if (p.body) args.push("--body", p.body);
    if (p.labels?.length) args.push("--label", p.labels.join(","));
    if (p.assignees?.length) args.push("--assignee", p.assignees.join(","));
    return runGh(args);
  },
};

// ─── github_list_issues ───────────────────────────────────────────────────

const ListIssuesSchema = z.object({
  repo: z.string().describe("Repository in OWNER/NAME format"),
  state: z.enum(["open", "closed", "all"]).optional().describe("Filter by state"),
  limit: z.number().int().min(1).max(100).optional().describe("Max issues (default 30)"),
  labels: z.array(z.string()).optional().describe("Filter by labels"),
  assignee: z.string().optional().describe("Filter by assignee"),
});

export const githubListIssuesTool: ToolDefinitionRuntime = {
  name: "github_list_issues",
  description: "List issues for a GitHub repository with optional filters.",
  parameters: {
    type: "object",
    properties: {
      repo: { type: "string", description: "Repository in OWNER/NAME format" },
      state: { type: "string", enum: ["open", "closed", "all"], description: "Filter state" },
      limit: { type: "integer", description: "Max issues (default 30)", maximum: 100 },
      labels: { type: "array", items: { type: "string" }, description: "Filter by labels" },
      assignee: { type: "string", description: "Filter by assignee" },
    },
    required: ["repo"],
  },
  inputSchema: ListIssuesSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: GH_TIMEOUT_MS,
  tags: ["integration", "github"],

  async execute(input) {
    const p = ListIssuesSchema.parse(input);
    const args = ["issue", "list", "--repo", p.repo];
    if (p.state) args.push("--state", p.state);
    args.push("--limit", String(p.limit ?? 30));
    if (p.labels?.length) args.push("--label", p.labels.join(","));
    if (p.assignee) args.push("--assignee", p.assignee);
    args.push("--json", "number,title,state,author,labels,assignees,url,createdAt,updatedAt");
    return runGh(args);
  },
};

// ─── github_notifications ─────────────────────────────────────────────────

const NotificationsSchema = z.object({
  all: z.boolean().optional().describe("Include read notifications"),
  limit: z.number().int().min(1).max(50).optional().describe("Max notifications (default 20)"),
});

export const githubNotificationsTool: ToolDefinitionRuntime = {
  name: "github_notifications",
  description:
    "List your GitHub notifications (unread by default). Shows repo, reason, and subject.",
  parameters: {
    type: "object",
    properties: {
      all: { type: "boolean", description: "Include read notifications" },
      limit: { type: "integer", description: "Max notifications (default 20)", maximum: 50 },
    },
  },
  inputSchema: NotificationsSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: GH_TIMEOUT_MS,
  tags: ["integration", "github"],

  async execute(input) {
    const p = NotificationsSchema.parse(input);
    const limit = p.limit ?? 20;
    const allParam = p.all ? "&all=true" : "";
    const args = [
      "api",
      `notifications?per_page=${limit}${allParam}`,
      "--jq",
      '.[] | {repo: .repository.full_name, reason: .reason, title: .subject.title, type: .subject.type, updated: .updated_at, unread: .unread}',
    ];
    return runGh(args);
  },
};

// ─── Collected exports ────────────────────────────────────────────────────

export const githubTools: ToolDefinitionRuntime[] = [
  githubListReposTool,
  githubListPRsTool,
  githubPRViewTool,
  githubCreateIssueTool,
  githubListIssuesTool,
  githubNotificationsTool,
];
