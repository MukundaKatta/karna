// ─── Integration Tools Barrel Export ──────────────────────────────────────
//
// Re-exports all third-party app integration tools grouped by category.

import type { ToolDefinitionRuntime } from "../../registry.js";

// ─── GitHub ──────────────────────────────────────────────────────────────

export {
  githubListReposTool,
  githubListPRsTool,
  githubPRViewTool,
  githubCreateIssueTool,
  githubListIssuesTool,
  githubNotificationsTool,
  githubTools,
} from "./github.js";

// ─── Google Workspace (Drive, Contacts) ──────────────────────────────────

export {
  googleDriveSearchTool,
  googleDriveDownloadTool,
  googleContactsSearchTool,
  googleTools,
} from "./google.js";

// ─── Slack ───────────────────────────────────────────────────────────────

export {
  slackSendMessageTool,
  slackListChannelsTool,
  slackSearchMessagesTool,
  slackSetStatusTool,
  slackTools,
} from "./slack-tool.js";

// ─── Notion ──────────────────────────────────────────────────────────────

export {
  notionSearchTool,
  notionCreatePageTool,
  notionReadPageTool,
  notionTools,
} from "./notion.js";

// ─── Spotify ─────────────────────────────────────────────────────────────

export {
  spotifyNowPlayingTool,
  spotifyPlayPauseTool,
  spotifyNextTool,
  spotifySearchPlayTool,
  spotifyTools,
} from "./spotify.js";

// ─── All Integration Tools ───────────────────────────────────────────────

import { githubTools } from "./github.js";
import { googleTools } from "./google.js";
import { slackTools } from "./slack-tool.js";
import { notionTools } from "./notion.js";
import { spotifyTools } from "./spotify.js";

/** Every integration tool in a single flat array. */
export const allIntegrationTools: ToolDefinitionRuntime[] = [
  ...githubTools,
  ...googleTools,
  ...slackTools,
  ...notionTools,
  ...spotifyTools,
];
