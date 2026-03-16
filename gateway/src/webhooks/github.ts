// ─── GitHub Webhook Handler ─────────────────────────────────────────────────
//
// Parses and verifies GitHub webhook events, formatting them as
// natural language messages for the agent.
//
// ─────────────────────────────────────────────────────────────────────────────

import { createHmac, timingSafeEqual } from "node:crypto";
import pino from "pino";

const logger = pino({ name: "webhook-github" });

// ─── Types ──────────────────────────────────────────────────────────────────

export type GitHubEventType =
  | "push"
  | "pull_request"
  | "issues"
  | "issue_comment"
  | "release"
  | "unknown";

export interface GitHubEvent {
  /** The event type. */
  type: GitHubEventType;
  /** The action (e.g. "opened", "closed"). */
  action: string | null;
  /** The repository full name. */
  repository: string;
  /** The sender's login. */
  sender: string;
  /** Human-readable summary of the event. */
  summary: string;
  /** Full raw payload. */
  raw: Record<string, unknown>;
}

interface GitHubHeaders {
  "x-github-event"?: string;
  "x-hub-signature-256"?: string;
  "x-github-delivery"?: string;
  [key: string]: string | undefined;
}

// ─── Signature Verification ─────────────────────────────────────────────────

/**
 * Verify the X-Hub-Signature-256 HMAC signature from GitHub.
 */
export function verifyGitHubSignature(
  body: string | Buffer,
  signature: string,
  secret: string,
): boolean {
  if (!signature || !secret) return false;

  const expected = "sha256=" + createHmac("sha256", secret)
    .update(typeof body === "string" ? body : body)
    .digest("hex");

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (sigBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(sigBuffer, expectedBuffer);
}

// ─── Parse GitHub Webhook ───────────────────────────────────────────────────

/**
 * Parse a GitHub webhook request into a structured event.
 *
 * @param headers - Request headers (must include x-github-event)
 * @param body - Raw request body (string or parsed object)
 * @param secret - Optional webhook secret for signature verification
 * @param rawBody - Raw body string/buffer for signature verification
 */
export function parseGitHubWebhook(
  headers: GitHubHeaders,
  body: Record<string, unknown>,
  secret?: string,
  rawBody?: string | Buffer,
): GitHubEvent {
  // Verify signature if secret is provided
  if (secret && rawBody) {
    const signature = headers["x-hub-signature-256"];
    if (!signature) {
      throw new Error("Missing X-Hub-Signature-256 header");
    }
    if (!verifyGitHubSignature(rawBody, signature, secret)) {
      throw new Error("Invalid GitHub webhook signature");
    }
  }

  const eventType = headers["x-github-event"] ?? "unknown";
  const action = (body["action"] as string) ?? null;
  const repo = (body["repository"] as Record<string, unknown>)?.["full_name"] as string ?? "unknown/unknown";
  const sender = (body["sender"] as Record<string, unknown>)?.["login"] as string ?? "unknown";

  const event: GitHubEvent = {
    type: normalizeEventType(eventType),
    action,
    repository: repo,
    sender,
    summary: formatEventSummary(eventType, action, body, repo, sender),
    raw: body,
  };

  logger.debug(
    { type: event.type, action: event.action, repo, sender },
    "Parsed GitHub webhook event",
  );

  return event;
}

// ─── Event Formatting ───────────────────────────────────────────────────────

function normalizeEventType(type: string): GitHubEventType {
  switch (type) {
    case "push":
    case "pull_request":
    case "issues":
    case "issue_comment":
    case "release":
      return type;
    default:
      return "unknown";
  }
}

function formatEventSummary(
  type: string,
  action: string | null,
  body: Record<string, unknown>,
  repo: string,
  sender: string,
): string {
  switch (type) {
    case "push":
      return formatPush(body, repo, sender);
    case "pull_request":
      return formatPullRequest(action, body, repo, sender);
    case "issues":
      return formatIssue(action, body, repo, sender);
    case "issue_comment":
      return formatIssueComment(action, body, repo, sender);
    case "release":
      return formatRelease(action, body, repo, sender);
    default:
      return `[GitHub] ${sender} triggered "${type}" event on ${repo}`;
  }
}

function formatPush(body: Record<string, unknown>, repo: string, sender: string): string {
  const ref = (body["ref"] as string) ?? "";
  const branch = ref.replace("refs/heads/", "");
  const commits = body["commits"] as Array<Record<string, unknown>> | undefined;
  const commitCount = commits?.length ?? 0;
  const headCommit = body["head_commit"] as Record<string, unknown> | undefined;
  const message = (headCommit?.["message"] as string)?.split("\n")[0] ?? "";

  return `[GitHub Push] ${sender} pushed ${commitCount} commit${commitCount !== 1 ? "s" : ""} to ${branch} in ${repo}: "${message}"`;
}

function formatPullRequest(
  action: string | null,
  body: Record<string, unknown>,
  repo: string,
  sender: string,
): string {
  const pr = body["pull_request"] as Record<string, unknown> | undefined;
  const number = (pr?.["number"] as number) ?? 0;
  const title = (pr?.["title"] as string) ?? "";
  const base = (pr?.["base"] as Record<string, unknown>)?.["ref"] as string ?? "";
  const head = (pr?.["head"] as Record<string, unknown>)?.["ref"] as string ?? "";

  return `[GitHub PR] ${sender} ${action ?? "updated"} PR #${number} "${title}" (${head} -> ${base}) in ${repo}`;
}

function formatIssue(
  action: string | null,
  body: Record<string, unknown>,
  repo: string,
  sender: string,
): string {
  const issue = body["issue"] as Record<string, unknown> | undefined;
  const number = (issue?.["number"] as number) ?? 0;
  const title = (issue?.["title"] as string) ?? "";

  return `[GitHub Issue] ${sender} ${action ?? "updated"} issue #${number} "${title}" in ${repo}`;
}

function formatIssueComment(
  action: string | null,
  body: Record<string, unknown>,
  repo: string,
  sender: string,
): string {
  const issue = body["issue"] as Record<string, unknown> | undefined;
  const number = (issue?.["number"] as number) ?? 0;
  const comment = body["comment"] as Record<string, unknown> | undefined;
  const commentBody = ((comment?.["body"] as string) ?? "").slice(0, 200);

  return `[GitHub Comment] ${sender} ${action ?? "created"} a comment on #${number} in ${repo}: "${commentBody}"`;
}

function formatRelease(
  action: string | null,
  body: Record<string, unknown>,
  repo: string,
  sender: string,
): string {
  const release = body["release"] as Record<string, unknown> | undefined;
  const tagName = (release?.["tag_name"] as string) ?? "";
  const name = (release?.["name"] as string) ?? tagName;

  return `[GitHub Release] ${sender} ${action ?? "published"} release "${name}" (${tagName}) in ${repo}`;
}
