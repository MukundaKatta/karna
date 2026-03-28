// ─── Notion Integration Tools ─────────────────────────────────────────────
//
// Uses the Notion API (https://developers.notion.com/) via fetch.
// Requires NOTION_API_KEY env var (an internal integration token).

import { z } from "zod";
import pino from "pino";
import type { ToolDefinitionRuntime, ToolExecutionContext } from "../../registry.js";

const logger = pino({ name: "tool-notion" });
const TIMEOUT_MS = 15_000;
const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

// ─── Helpers ──────────────────────────────────────────────────────────────

function getApiKey(): string {
  const key = process.env.NOTION_API_KEY;
  if (!key) {
    throw new Error(
      "NOTION_API_KEY is not set. Create an integration at https://www.notion.so/my-integrations and set the token."
    );
  }
  return key;
}

async function notionFetch(
  path: string,
  method: "GET" | "POST" | "PATCH" = "GET",
  body?: Record<string, unknown>
): Promise<{ output: string; isError: boolean }> {
  try {
    const key = getApiKey();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${key}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    };

    const res = await fetch(`${NOTION_API}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timer);

    const data = await res.json();
    if (!res.ok) {
      const msg = (data as any).message ?? (data as any).code ?? res.statusText;
      return { output: `Notion API error (${res.status}): ${msg}`, isError: true };
    }
    return { output: JSON.stringify(data, null, 2), isError: false };
  } catch (err: any) {
    if (err.name === "AbortError") {
      return { output: `Notion API timed out after ${TIMEOUT_MS}ms`, isError: true };
    }
    logger.error({ err }, "Notion API call failed");
    return { output: `Notion API failed: ${err.message}`, isError: true };
  }
}

// ─── notion_search ────────────────────────────────────────────────────────

const SearchSchema = z.object({
  query: z.string().describe("Search query text"),
  filter: z
    .enum(["page", "database"])
    .optional()
    .describe("Filter results to pages or databases only"),
  pageSize: z.number().int().min(1).max(100).optional().describe("Max results (default 10)"),
  sort: z
    .enum(["last_edited_time", "created_time"])
    .optional()
    .describe("Sort by (default last_edited_time descending)"),
});

export const notionSearchTool: ToolDefinitionRuntime = {
  name: "notion_search",
  description:
    "Search Notion pages and databases by title or content. " +
    "Returns page/database IDs, titles, URLs, and last edited time.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      filter: { type: "string", enum: ["page", "database"], description: "Object type filter" },
      pageSize: { type: "integer", description: "Max results (default 10)", maximum: 100 },
      sort: {
        type: "string",
        enum: ["last_edited_time", "created_time"],
        description: "Sort property",
      },
    },
    required: ["query"],
  },
  inputSchema: SearchSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: TIMEOUT_MS,
  tags: ["integration", "notion"],

  async execute(input) {
    const p = SearchSchema.parse(input);
    const body: Record<string, unknown> = {
      query: p.query,
      page_size: p.pageSize ?? 10,
    };
    if (p.filter) {
      body.filter = { value: p.filter, property: "object" };
    }
    if (p.sort) {
      body.sort = { direction: "descending", timestamp: p.sort };
    }
    const result = await notionFetch("/search", "POST", body);
    if (result.isError) return result;

    // Slim down the response for readability
    try {
      const data = JSON.parse(result.output);
      const items = (data.results ?? []).map((item: any) => ({
        id: item.id,
        object: item.object,
        title:
          item.properties?.title?.title?.[0]?.plain_text ??
          item.properties?.Name?.title?.[0]?.plain_text ??
          item.title?.[0]?.plain_text ??
          "(untitled)",
        url: item.url,
        last_edited: item.last_edited_time,
        created: item.created_time,
      }));
      return { output: JSON.stringify(items, null, 2), isError: false };
    } catch {
      return result;
    }
  },
};

// ─── notion_create_page ───────────────────────────────────────────────────

const CreatePageSchema = z.object({
  parentId: z
    .string()
    .min(1)
    .describe("Parent page or database ID where the new page will be created"),
  parentType: z
    .enum(["page_id", "database_id"])
    .optional()
    .default("page_id")
    .describe("Type of parent (page_id or database_id)"),
  title: z.string().min(1).describe("Page title"),
  content: z
    .string()
    .optional()
    .describe("Page content as plain text (will be added as paragraph blocks)"),
  icon: z.string().optional().describe("Page icon emoji (e.g. a single emoji character)"),
});

export const notionCreatePageTool: ToolDefinitionRuntime = {
  name: "notion_create_page",
  description:
    "Create a new Notion page under a parent page or database. " +
    "Content is added as paragraph blocks.",
  parameters: {
    type: "object",
    properties: {
      parentId: { type: "string", description: "Parent page or database ID" },
      parentType: {
        type: "string",
        enum: ["page_id", "database_id"],
        description: "Parent type",
      },
      title: { type: "string", description: "Page title" },
      content: { type: "string", description: "Plain text content" },
      icon: { type: "string", description: "Icon emoji" },
    },
    required: ["parentId", "title"],
  },
  inputSchema: CreatePageSchema,
  riskLevel: "medium",
  requiresApproval: true,
  timeout: TIMEOUT_MS,
  tags: ["integration", "notion"],

  async execute(input) {
    const p = CreatePageSchema.parse(input);
    const parentType = p.parentType ?? "page_id";

    const body: Record<string, unknown> = {
      parent: { [parentType]: p.parentId },
      properties: {
        title: {
          title: [{ text: { content: p.title } }],
        },
      },
    };

    if (p.icon) {
      body.icon = { type: "emoji", emoji: p.icon };
    }

    // Convert content string into paragraph blocks
    if (p.content) {
      const paragraphs = p.content.split("\n\n").filter(Boolean);
      body.children = paragraphs.map((text) => ({
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [{ type: "text", text: { content: text } }],
        },
      }));
    }

    const result = await notionFetch("/pages", "POST", body);
    if (result.isError) return result;

    try {
      const data = JSON.parse(result.output);
      return {
        output: JSON.stringify({
          id: data.id,
          url: data.url,
          title: p.title,
          created: data.created_time,
        }),
        isError: false,
      };
    } catch {
      return result;
    }
  },
};

// ─── notion_read_page ─────────────────────────────────────────────────────

const ReadPageSchema = z.object({
  pageId: z.string().min(1).describe("Notion page ID"),
  includeChildren: z
    .boolean()
    .optional()
    .default(true)
    .describe("Also fetch block children / content (default true)"),
});

export const notionReadPageTool: ToolDefinitionRuntime = {
  name: "notion_read_page",
  description:
    "Read a Notion page's properties and content blocks. " +
    "Returns title, properties, and text content from all blocks.",
  parameters: {
    type: "object",
    properties: {
      pageId: { type: "string", description: "Notion page ID" },
      includeChildren: { type: "boolean", description: "Fetch block content (default true)" },
    },
    required: ["pageId"],
  },
  inputSchema: ReadPageSchema,
  riskLevel: "low",
  requiresApproval: false,
  timeout: TIMEOUT_MS,
  tags: ["integration", "notion"],

  async execute(input) {
    const p = ReadPageSchema.parse(input);

    // Fetch page metadata
    const pageResult = await notionFetch(`/pages/${p.pageId}`);
    if (pageResult.isError) return pageResult;

    const includeChildren = p.includeChildren ?? true;
    if (!includeChildren) return pageResult;

    // Fetch block children for content
    const blocksResult = await notionFetch(`/blocks/${p.pageId}/children?page_size=100`);
    if (blocksResult.isError) {
      // Return page without content if blocks fail
      return pageResult;
    }

    try {
      const page = JSON.parse(pageResult.output);
      const blocks = JSON.parse(blocksResult.output);

      // Extract text from blocks
      const content = (blocks.results ?? [])
        .map((block: any) => {
          const type = block.type;
          const richText = block[type]?.rich_text ?? block[type]?.text ?? [];
          const text = richText.map((t: any) => t.plain_text ?? "").join("");

          switch (type) {
            case "heading_1":
              return `# ${text}`;
            case "heading_2":
              return `## ${text}`;
            case "heading_3":
              return `### ${text}`;
            case "bulleted_list_item":
              return `- ${text}`;
            case "numbered_list_item":
              return `1. ${text}`;
            case "to_do":
              return `[${block.to_do?.checked ? "x" : " "}] ${text}`;
            case "code":
              return `\`\`\`${block.code?.language ?? ""}\n${text}\n\`\`\``;
            case "divider":
              return "---";
            default:
              return text;
          }
        })
        .filter(Boolean)
        .join("\n");

      // Extract title
      const titleProp =
        page.properties?.title?.title ?? page.properties?.Name?.title ?? [];
      const title = titleProp.map((t: any) => t.plain_text).join("") || "(untitled)";

      return {
        output: JSON.stringify(
          { id: page.id, title, url: page.url, lastEdited: page.last_edited_time, content },
          null,
          2
        ),
        isError: false,
      };
    } catch {
      return pageResult;
    }
  },
};

// ─── Collected exports ────────────────────────────────────────────────────

export const notionTools: ToolDefinitionRuntime[] = [
  notionSearchTool,
  notionCreatePageTool,
  notionReadPageTool,
];
