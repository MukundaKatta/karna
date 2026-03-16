// ─── News Digest Skill Handler ────────────────────────────────────────────
//
// Searches for news on configured topics, summarizes articles, and
// formats them into a concise digest with headlines and sources.
//
// ───────────────────────────────────────────────────────────────────────────

import pino from "pino";
import type {
  SkillHandler,
  SkillContext,
  SkillResult,
} from "../../../agent/src/skills/loader.js";

const logger = pino({ name: "skill:news-digest" });

// ─── Types ──────────────────────────────────────────────────────────────────

interface NewsArticle {
  headline: string;
  source: string;
  url: string;
  summary: string;
  publishedAt: string;
  topic: string;
}

interface DigestCache {
  articles: NewsArticle[];
  generatedAt: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_TOPICS = ["technology", "world", "business"];
const DEFAULT_ARTICLE_COUNT = 10;
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const MAX_ARTICLES_PER_TOPIC = 5;

// ─── Handler ────────────────────────────────────────────────────────────────

export class NewsDigestHandler implements SkillHandler {
  private cache: Map<string, DigestCache> = new Map();

  async initialize(context: SkillContext): Promise<void> {
    logger.info({ sessionId: context.sessionId }, "News digest skill initialized");
  }

  async execute(
    action: string,
    input: Record<string, unknown>,
    context: SkillContext
  ): Promise<SkillResult> {
    logger.debug({ action, sessionId: context.sessionId }, "Executing news digest action");

    try {
      switch (action) {
        case "digest":
          return this.generateDigest(input, context);
        case "search":
          return this.searchTopic(input, context);
        case "headlines":
          return this.getHeadlines(input, context);
        default:
          return {
            success: false,
            output: `Unknown action: ${action}`,
            error: `Action "${action}" is not supported`,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message, action }, "News digest action failed");
      return { success: false, output: `Failed: ${message}`, error: message };
    }
  }

  async dispose(): Promise<void> {
    this.cache.clear();
    logger.info("News digest skill disposed");
  }

  // ─── Actions ────────────────────────────────────────────────────────────

  private async generateDigest(
    input: Record<string, unknown>,
    context: SkillContext
  ): Promise<SkillResult> {
    const isHeartbeat = input["trigger"] === "heartbeat";

    // On heartbeat, check cache TTL
    if (isHeartbeat) {
      const cached = this.cache.get(context.sessionId);
      if (cached && Date.now() - cached.generatedAt < CACHE_TTL_MS) {
        return {
          success: true,
          output: "News digest is still fresh, skipping refresh.",
          data: { cached: true },
        };
      }
    }

    const topics = (input["topics"] as string[]) ?? DEFAULT_TOPICS;
    const maxCount = (input["count"] as number) ?? DEFAULT_ARTICLE_COUNT;

    const allArticles: NewsArticle[] = [];

    for (const topic of topics) {
      const articles = await this.fetchNewsForTopic(topic, context);
      allArticles.push(...articles);
    }

    // Deduplicate by headline similarity
    const deduped = this.deduplicateArticles(allArticles);

    // Sort by recency
    deduped.sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );

    // Limit total articles
    const limited = deduped.slice(0, maxCount);

    // Cache the results
    this.cache.set(context.sessionId, {
      articles: limited,
      generatedAt: Date.now(),
    });

    const output = this.formatDigest(limited, topics);

    return {
      success: true,
      output,
      data: {
        articleCount: limited.length,
        topics,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  private async searchTopic(
    input: Record<string, unknown>,
    context: SkillContext
  ): Promise<SkillResult> {
    const topic = (input["topic"] as string) ?? "";
    if (!topic) {
      return {
        success: false,
        output: "Please specify a topic to search for.",
        error: "Missing topic",
      };
    }

    const count = (input["count"] as number) ?? MAX_ARTICLES_PER_TOPIC;
    const articles = await this.fetchNewsForTopic(topic, context);
    const limited = articles.slice(0, count);

    if (limited.length === 0) {
      return {
        success: true,
        output: `No recent news found for topic: "${topic}".`,
      };
    }

    const lines = limited.map(
      (a) =>
        `**${a.headline}**\n  ${a.source} | ${a.publishedAt}\n  ${a.summary}`
    );

    return {
      success: true,
      output: `News for "${topic}" (${limited.length} articles):\n\n${lines.join("\n\n")}`,
      data: { articles: limited, topic } as unknown as Record<string, unknown>,
    };
  }

  private async getHeadlines(
    input: Record<string, unknown>,
    context: SkillContext
  ): Promise<SkillResult> {
    const topics = (input["topics"] as string[]) ?? DEFAULT_TOPICS;
    const allArticles: NewsArticle[] = [];

    for (const topic of topics) {
      const articles = await this.fetchNewsForTopic(topic, context);
      allArticles.push(...articles);
    }

    const deduped = this.deduplicateArticles(allArticles);
    deduped.sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );

    if (deduped.length === 0) {
      return { success: true, output: "No headlines available at the moment." };
    }

    const lines = deduped
      .slice(0, 10)
      .map((a) => `• ${a.headline} — ${a.source}`);

    return {
      success: true,
      output: `Top Headlines:\n${lines.join("\n")}`,
      data: { headlines: deduped.slice(0, 10) } as unknown as Record<string, unknown>,
    };
  }

  // ─── Data Fetching ─────────────────────────────────────────────────────

  private async fetchNewsForTopic(
    topic: string,
    _context: SkillContext
  ): Promise<NewsArticle[]> {
    // In production, this calls the web_search tool to search for news.
    // The agent runtime injects tool access via context.
    logger.debug({ topic }, "Fetching news for topic");

    // Stub: return empty until web-search tool is wired
    // When integrated, the query would be: `${topic} news latest`
    return [];
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private deduplicateArticles(articles: NewsArticle[]): NewsArticle[] {
    const seen = new Set<string>();
    return articles.filter((article) => {
      // Normalize headline for comparison
      const key = article.headline
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, " ")
        .trim();

      // Check for exact or near duplicates (first 50 chars)
      const shortKey = key.slice(0, 50);
      if (seen.has(shortKey)) return false;
      seen.add(shortKey);
      return true;
    });
  }

  private formatDigest(articles: NewsArticle[], topics: string[]): string {
    if (articles.length === 0) {
      return `News Digest (${topics.join(", ")})\n\nNo articles found. The web-search dependency may not be connected.`;
    }

    const sections: string[] = [];
    sections.push(
      `News Digest — ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}\n`
    );

    // Group by topic
    const byTopic = new Map<string, NewsArticle[]>();
    for (const article of articles) {
      const group = byTopic.get(article.topic) ?? [];
      group.push(article);
      byTopic.set(article.topic, group);
    }

    for (const [topic, topicArticles] of byTopic) {
      sections.push(`**${topic.charAt(0).toUpperCase() + topic.slice(1)}**`);
      for (const article of topicArticles) {
        sections.push(
          `  • **${article.headline}**\n    ${article.source} | ${article.publishedAt}\n    ${article.summary}`
        );
      }
      sections.push("");
    }

    sections.push(`---\n${articles.length} articles from ${byTopic.size} topics`);

    return sections.join("\n");
  }
}

export default NewsDigestHandler;
