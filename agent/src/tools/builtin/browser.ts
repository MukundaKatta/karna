// ─── Browser Automation Tool (Playwright) ─────────────────────────────────

import { z } from "zod";
import pino from "pino";
import type { ToolDefinitionRuntime, ToolExecutionContext } from "../registry.js";

const logger = pino({ name: "tool-browser" });

const MAX_PAGES = 5;
const DEFAULT_TIMEOUT_MS = 30_000;

// ─── Browser Instance Management ─────────────────────────────────────────

interface BrowserState {
  browser: any;
  context: any;
  pages: Map<string, any>;
  pageCounter: number;
}

let browserState: BrowserState | null = null;

async function getPlaywright() {
  try {
    return await import("playwright");
  } catch {
    throw new Error(
      "Playwright is not installed. Run: npx playwright install chromium"
    );
  }
}

async function ensureBrowser(): Promise<BrowserState> {
  if (browserState?.browser?.isConnected()) {
    return browserState;
  }

  const pw = await getPlaywright();
  logger.info("Launching browser instance");

  const browser = await pw.chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  browserState = { browser, context, pages: new Map(), pageCounter: 0 };
  return browserState;
}

async function getOrCreatePage(state: BrowserState, url?: string): Promise<{ page: any; pageId: string }> {
  // Reuse existing page if navigating to same origin, or create new
  if (url) {
    for (const [pageId, page] of state.pages) {
      try {
        const currentUrl = page.url();
        if (currentUrl && new URL(currentUrl).origin === new URL(url).origin) {
          return { page, pageId };
        }
      } catch {
        // Invalid URL, skip
      }
    }
  }

  // Enforce page pool limit
  if (state.pages.size >= MAX_PAGES) {
    const oldestKey = state.pages.keys().next().value!;
    const oldPage = state.pages.get(oldestKey);
    await oldPage?.close().catch(() => {});
    state.pages.delete(oldestKey);
    logger.debug({ pageId: oldestKey }, "Closed oldest page (pool limit reached)");
  }

  const page = await state.context.newPage();
  const pageId = `page_${++state.pageCounter}`;
  state.pages.set(pageId, page);
  return { page, pageId };
}

// ─── Navigate ────────────────────────────────────────────────────────────

const NavigateInputSchema = z.object({
  url: z.string().url().describe("The URL to navigate to"),
  waitUntil: z
    .enum(["load", "domcontentloaded", "networkidle"])
    .optional()
    .default("domcontentloaded")
    .describe("When to consider navigation complete"),
  timeout: z
    .number()
    .int()
    .positive()
    .max(60_000)
    .optional()
    .default(DEFAULT_TIMEOUT_MS)
    .describe("Navigation timeout in milliseconds"),
});

export const browserNavigateTool: ToolDefinitionRuntime = {
  name: "browser_navigate",
  description:
    "Navigate a browser to a URL and return the page title and current URL. " +
    "The browser instance is reused across calls.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "The URL to navigate to" },
      waitUntil: {
        type: "string",
        enum: ["load", "domcontentloaded", "networkidle"],
        description: "When to consider navigation complete",
      },
      timeout: {
        type: "integer",
        description: "Navigation timeout in milliseconds",
        maximum: 60_000,
      },
    },
    required: ["url"],
  },
  inputSchema: NavigateInputSchema,
  riskLevel: "medium",
  requiresApproval: false,
  timeout: 60_000,
  tags: ["browser", "web", "navigate"],

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = NavigateInputSchema.parse(input);
    const state = await ensureBrowser();
    const { page, pageId } = await getOrCreatePage(state, parsed.url);

    logger.debug({ url: parsed.url, pageId }, "Navigating browser");

    await page.goto(parsed.url, {
      waitUntil: parsed.waitUntil,
      timeout: parsed.timeout,
    });

    const title = await page.title();
    const currentUrl = page.url();

    return { pageId, title, url: currentUrl };
  },
};

// ─── Screenshot ──────────────────────────────────────────────────────────

const ScreenshotInputSchema = z.object({
  url: z.string().url().describe("URL to take a screenshot of"),
  selector: z.string().optional().describe("CSS selector to screenshot a specific element"),
  fullPage: z.boolean().optional().default(false).describe("Capture full scrollable page"),
});

export const browserScreenshotTool: ToolDefinitionRuntime = {
  name: "browser_screenshot",
  description:
    "Take a screenshot of a web page or a specific element on the page. " +
    "Returns the screenshot as a base64-encoded PNG.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL to take a screenshot of" },
      selector: {
        type: "string",
        description: "CSS selector to screenshot a specific element",
      },
      fullPage: { type: "boolean", description: "Capture full scrollable page" },
    },
    required: ["url"],
  },
  inputSchema: ScreenshotInputSchema,
  riskLevel: "medium",
  requiresApproval: false,
  timeout: 45_000,
  tags: ["browser", "web", "screenshot"],

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = ScreenshotInputSchema.parse(input);
    const state = await ensureBrowser();
    const { page, pageId } = await getOrCreatePage(state, parsed.url);

    await page.goto(parsed.url, { waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT_MS });

    let screenshotBuffer: Buffer;

    if (parsed.selector) {
      const element = await page.$(parsed.selector);
      if (!element) {
        throw new Error(`Element not found: ${parsed.selector}`);
      }
      screenshotBuffer = await element.screenshot({ type: "png" });
    } else {
      screenshotBuffer = await page.screenshot({
        type: "png",
        fullPage: parsed.fullPage,
      });
    }

    const base64 = screenshotBuffer.toString("base64");

    return {
      pageId,
      url: page.url(),
      format: "png",
      base64,
      sizeBytes: screenshotBuffer.length,
    };
  },
};

// ─── Extract Text ────────────────────────────────────────────────────────

const ExtractTextInputSchema = z.object({
  url: z.string().url().describe("URL to extract text from"),
  selector: z
    .string()
    .optional()
    .describe("CSS selector to narrow extraction to a specific element"),
});

export const browserExtractTextTool: ToolDefinitionRuntime = {
  name: "browser_extract_text",
  description:
    "Extract visible text content from a web page or a specific element. " +
    "Navigates to the URL and returns the inner text.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL to extract text from" },
      selector: {
        type: "string",
        description: "CSS selector to narrow extraction",
      },
    },
    required: ["url"],
  },
  inputSchema: ExtractTextInputSchema,
  riskLevel: "medium",
  requiresApproval: false,
  timeout: 30_000,
  tags: ["browser", "web", "extract"],

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = ExtractTextInputSchema.parse(input);
    const state = await ensureBrowser();
    const { page, pageId } = await getOrCreatePage(state, parsed.url);

    await page.goto(parsed.url, { waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT_MS });

    let text: string;

    if (parsed.selector) {
      const element = await page.$(parsed.selector);
      if (!element) {
        throw new Error(`Element not found: ${parsed.selector}`);
      }
      text = await element.innerText();
    } else {
      text = await page.innerText("body");
    }

    // Truncate very long text
    const maxLength = 50_000;
    const truncated = text.length > maxLength;
    const content = truncated ? text.slice(0, maxLength) + "\n...[truncated]" : text;

    return { pageId, url: page.url(), text: content, truncated, length: text.length };
  },
};

// ─── Click ───────────────────────────────────────────────────────────────

const ClickInputSchema = z.object({
  selector: z.string().min(1).describe("CSS selector of the element to click"),
  pageId: z
    .string()
    .optional()
    .describe("Page ID to interact with (from previous navigate). Uses most recent page if omitted."),
});

export const browserClickTool: ToolDefinitionRuntime = {
  name: "browser_click",
  description:
    "Click an element on the current browser page identified by CSS selector.",
  parameters: {
    type: "object",
    properties: {
      selector: { type: "string", description: "CSS selector of the element to click" },
      pageId: { type: "string", description: "Page ID to interact with" },
    },
    required: ["selector"],
  },
  inputSchema: ClickInputSchema,
  riskLevel: "medium",
  requiresApproval: false,
  timeout: 15_000,
  tags: ["browser", "web", "interact"],

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = ClickInputSchema.parse(input);
    const state = await ensureBrowser();

    let page: any;
    if (parsed.pageId && state.pages.has(parsed.pageId)) {
      page = state.pages.get(parsed.pageId);
    } else {
      // Use the most recently created page
      const entries = Array.from(state.pages.entries());
      if (entries.length === 0) throw new Error("No browser page is open. Navigate to a URL first.");
      page = entries[entries.length - 1][1];
    }

    await page.click(parsed.selector, { timeout: 10_000 });

    return { clicked: true, selector: parsed.selector, url: page.url() };
  },
};

// ─── Fill Form ───────────────────────────────────────────────────────────

const FillFormInputSchema = z.object({
  selector: z.string().min(1).describe("CSS selector of the input element"),
  value: z.string().describe("Value to fill into the input"),
  pageId: z.string().optional().describe("Page ID to interact with"),
});

export const browserFillFormTool: ToolDefinitionRuntime = {
  name: "browser_fill_form",
  description:
    "Fill a form input field on the current browser page with a value. " +
    "Clears the field first, then types the new value.",
  parameters: {
    type: "object",
    properties: {
      selector: { type: "string", description: "CSS selector of the input element" },
      value: { type: "string", description: "Value to fill into the input" },
      pageId: { type: "string", description: "Page ID to interact with" },
    },
    required: ["selector", "value"],
  },
  inputSchema: FillFormInputSchema,
  riskLevel: "high",
  requiresApproval: true,
  timeout: 15_000,
  tags: ["browser", "web", "interact", "form"],

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = FillFormInputSchema.parse(input);
    const state = await ensureBrowser();

    let page: any;
    if (parsed.pageId && state.pages.has(parsed.pageId)) {
      page = state.pages.get(parsed.pageId);
    } else {
      const entries = Array.from(state.pages.entries());
      if (entries.length === 0) throw new Error("No browser page is open. Navigate to a URL first.");
      page = entries[entries.length - 1][1];
    }

    await page.fill(parsed.selector, parsed.value, { timeout: 10_000 });

    return { filled: true, selector: parsed.selector, url: page.url() };
  },
};

// ─── Evaluate JavaScript ─────────────────────────────────────────────────

const EvaluateInputSchema = z.object({
  script: z.string().min(1).describe("JavaScript code to evaluate in the browser page context"),
  pageId: z.string().optional().describe("Page ID to interact with"),
});

export const browserEvaluateTool: ToolDefinitionRuntime = {
  name: "browser_evaluate",
  description:
    "Execute JavaScript code in the browser page context and return the result. " +
    "The script runs in the page's DOM environment.",
  parameters: {
    type: "object",
    properties: {
      script: {
        type: "string",
        description: "JavaScript code to evaluate in the browser page context",
      },
      pageId: { type: "string", description: "Page ID to interact with" },
    },
    required: ["script"],
  },
  inputSchema: EvaluateInputSchema,
  riskLevel: "high",
  requiresApproval: true,
  timeout: 30_000,
  tags: ["browser", "web", "evaluate"],

  async execute(
    input: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<unknown> {
    const parsed = EvaluateInputSchema.parse(input);
    const state = await ensureBrowser();

    let page: any;
    if (parsed.pageId && state.pages.has(parsed.pageId)) {
      page = state.pages.get(parsed.pageId);
    } else {
      const entries = Array.from(state.pages.entries());
      if (entries.length === 0) throw new Error("No browser page is open. Navigate to a URL first.");
      page = entries[entries.length - 1][1];
    }

    logger.debug("Evaluating script in browser context");

    const result = await page.evaluate(parsed.script);

    return { result, url: page.url() };
  },
};
