// ─── News Digest Skill Handler ────────────────────────────────────────────
//
// Searches for news on configured topics, deduplicates results,
// summarizes articles, and formats them into a concise digest with
// headlines and sources. Uses web_search tool via skill context.
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
  relevanceScore: number;
}

interface DigestCache {
  articles: NewsArticle[];
  generatedAt: number;
  topics: string[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_TOPICS = ["technology", "world", "business"];
const DEFAULT_ARTICLE_COUNT = 10;
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const MAX_ARTICLES_PER_TOPIC = 5;
const SEARCH_TIMEOUT_MS = 15_000;

// Domains known to produce low-quality or SEO-spam results
const BLOCKLIST_DOMAINS = new Set([
  "pinterest.com",
  "quora.com",
  "facebook.com",
  "twitter.com",
  "instagram.com",
]);

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
    const topics = (input["topics"] as string[]) ?? DEFAULT_TOPICS;
    const maxCount = (input["count"] as number) ?? DEFAULT_ARTICLE_COUNT;

    // On heartbeat, check cache TTL
    if (isHeartbeat) {
      const cacheKey = this.buildCacheKey(context.sessionId, topics);
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.generatedAt < CACHE_TTL_MS) {
        logger.debug("News digest is still fresh, returning cached version");
        return {
          success: true,
          output: this.formatDigest(cached.articles, cached.topics),
          data: { cached: true, articleCount: cached.articles.length },
        };
      }
    }

    // Check for cached results even on manual trigger (use shorter TTL)
    const cacheKey = this.buildCacheKey(context.sessionId, topics);
    const cached = this.cache.get(cacheKey);
    const manualCacheTtl = 10 * 60 * 1000; // 10 minutes for manual
    if (!isHeartbeat && cached && Date.now() - cached.generatedAt < manualCacheTtl) {
      return {
        success: true,
        output: this.formatDigest(cached.articles, cached.topics),
        data: { cached: true, articleCount: cached.articles.length },
      };
    }

    // Fetch articles for all topics in parallel
    const topicResults = await Promise.allSettled(
      topics.map((topic) => this.fetchNewsForTopic(topic, context))
    );

    const allArticles: NewsArticle[] = [];
    for (const result of topicResults) {
      if (result.status === "fulfilled") {
        allArticles.push(...result.value);
      } else {
        logger.warn({ error: String(result.reason) }, "Topic fetch failed");
      }
    }

    if (allArticles.length === 0) {
      return {
        success: true,
        output: `News Digest (${topics.join(", ")})\n\nNo articles found. The web_search tool may not be connected.`,
        data: { articleCount: 0, topics },
      };
    }

    // Deduplicate by headline similarity
    const deduped = this.deduplicateArticles(allArticles);

    // Sort by relevance, then recency
    deduped.sort((a, b) => {
      if (b.relevanceScore !== a.relevanceScore) {
        return b.relevanceScore - a.relevanceScore;
      }
      return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
    });

    // Limit total articles
    const limited = deduped.slice(0, maxCount);

    // Cache the results
    this.cache.set(cacheKey, {
      articles: limited,
      generatedAt: Date.now(),
      topics,
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
    const deduped = this.deduplicateArticles(articles);
    const limited = deduped.slice(0, count);

    if (limited.length === 0) {
      return {
        success: true,
        output: `No recent news found for topic: "${topic}".`,
      };
    }

    const formatted = limited.map(
      (a, i) =>
        `${i + 1}. **${a.headline}**\n   ${a.source} | ${this.formatRelativeTime(a.publishedAt)}\n   ${a.summary}`
    );

    return {
      success: true,
      output: `News for "${topic}" (${limited.length} articles):\n\n${formatted.join("\n\n")}`,
      data: { articles: limited, topic } as unknown as Record<string, unknown>,
    };
  }

  private async getHeadlines(
    input: Record<string, unknown>,
    context: SkillContext
  ): Promise<SkillResult> {
    const topics = (input["topics"] as string[]) ?? DEFAULT_TOPICS;

    // Fetch all topics in parallel
    const topicResults = await Promise.allSettled(
      topics.map((topic) => this.fetchNewsForTopic(topic, context))
    );

    const allArticles: NewsArticle[] = [];
    for (const result of topicResults) {
      if (result.status === "fulfilled") {
        allArticles.push(...result.value);
      }
    }

    const deduped = this.deduplicateArticles(allArticles);
    deduped.sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );

    if (deduped.length === 0) {
      return { success: true, output: "No headlines available at the moment." };
    }

    const headlineList = deduped
      .slice(0, 10)
      .map((a) => `- ${a.headline} -- ${a.source}`);

    return {
      success: true,
      output: `Top Headlines:\n${headlineList.join("\n")}`,
      data: { headlines: deduped.slice(0, 10) } as unknown as Record<string, unknown>,
    };
  }

  // ─── Data Fetching ─────────────────────────────────────────────────────

  private async fetchNewsForTopic(
    topic: string,
    context: SkillContext
  ): Promise<NewsArticle[]> {
    logger.debug({ topic }, "Fetching news for topic");

    if (!context.callTool) {
      logger.debug({ topic }, "No callTool available in context -- web_search not connected");
      return [];
    }

    try {
      const today = new Date().toISOString().split("T")[0];
      const result = await context.callTool("web_search", {
        query: `${topic} news latest ${today}`,
        maxResults: MAX_ARTICLES_PER_TOPIC * 2, // Fetch extra to allow for filtering
      });

      if (!result || typeof result !== "object") return [];

      const searchResults = Array.isArray(result)
        ? result
        : Array.isArray((result as Record<string, unknown>)["results"])
          ? (result as { results: unknown[] }).results
          : [];

      const articles: NewsArticle[] = [];

      for (const r of searchResults) {
        if (!r || typeof r !== "object") continue;
        const item = r as Record<string, unknown>;
        const url = (item["url"] as string) ?? "";
        const title = (item["title"] as string) ?? "";
        const snippet = (item["snippet"] as string) ?? "";

        // Filter out blocklisted domains
        const domain = this.extractDomain(url);
        if (BLOCKLIST_DOMAINS.has(domain)) continue;

        // Filter out non-news results
        if (!title || title.length < 10) continue;

        // Calculate relevance score
        const relevanceScore = this.calculateRelevance(title, snippet, topic);

        articles.push({
          headline: this.cleanHeadline(title),
          source: (item["source"] as string) ?? domain,
          url,
          summary: this.cleanSummary(snippet),
          publishedAt: (item["publishedAt"] as string) ?? new Date().toISOString(),
          topic,
          relevanceScore,
        });
      }

      // Sort by relevance within this topic
      articles.sort((a, b) => b.relevanceScore - a.relevanceScore);

      return articles.slice(0, MAX_ARTICLES_PER_TOPIC);
    } catch (error) {
      logger.warn({ topic, error: String(error) }, "web_search tool call failed");
      return [];
    }
  }

  // ─── Deduplication ─────────────────────────────────────────────────────

  private deduplicateArticles(articles: NewsArticle[]): NewsArticle[] {
    const seen = new Set<string>();
    const seenUrls = new Set<string>();

    return articles.filter((article) => {
      // Deduplicate by URL
      if (article.url && seenUrls.has(article.url)) return false;
      if (article.url) seenUrls.add(article.url);

      // Normalize headline for comparison
      const key = article.headline
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, " ")
        .trim();

      // Check for exact match on short key
      const shortKey = key.slice(0, 50);
      if (seen.has(shortKey)) return false;

      // Check for fuzzy matches (compare word overlap)
      const words = new Set(key.split(" ").filter((w) => w.length > 3));
      for (const existingKey of seen) {
        const existingWords = new Set(existingKey.split(" ").filter((w: string) => w.length > 3));
        const overlap = [...words].filter((w) => existingWords.has(w)).length;
        const minSize = Math.min(words.size, existingWords.size);
        if (minSize > 0 && overlap / minSize > 0.7) {
          return false; // Too similar
        }
      }

      seen.add(shortKey);
      return true;
    });
  }

  // ─── Relevance Scoring ────────────────────────────────────────────────

  private calculateRelevance(title: string, snippet: string, topic: string): number {
    let score = 50; // Base score
    const lower = (title + " " + snippet).toLowerCase();
    const topicLower = topic.toLowerCase();

    // Topic mention in title is highly relevant
    if (title.toLowerCase().includes(topicLower)) score += 30;

    // Topic mention in snippet
    if (snippet.toLowerCase().includes(topicLower)) score += 10;

    // Recency indicators boost score
    const recencyKeywords = ["today", "just", "breaking", "now", "latest", "new"];
    for (const kw of recencyKeywords) {
      if (lower.includes(kw)) {
        score += 5;
        break;
      }
    }

    // Length penalty for very short or very long snippets
    if (snippet.length < 30) score -= 10;
    if (snippet.length > 500) score -= 5;

    return Math.max(0, Math.min(100, score));
  }

  // ─── Formatting ────────────────────────────────────────────────────────

  private formatDigest(articles: NewsArticle[], topics: string[]): string {
    if (articles.length === 0) {
      return `News Digest (${topics.join(", ")})\n\nNo articles found. The web_search dependency may not be connected.`;
    }

    const sections: string[] = [];
    const dateStr = new Date().toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });

    sections.push(`News Digest -- ${dateStr}\n`);

    // Group by topic
    const byTopic = new Map<string, NewsArticle[]>();
    for (const article of articles) {
      const group = byTopic.get(article.topic) ?? [];
      group.push(article);
      byTopic.set(article.topic, group);
    }

    for (const [topic, topicArticles] of byTopic) {
      const topicTitle = topic.charAt(0).toUpperCase() + topic.slice(1);
      sections.push(`**${topicTitle}**`);

      for (const article of topicArticles) {
        const relTime = this.formatRelativeTime(article.publishedAt);
        sections.push(
          `  - **${article.headline}**\n    ${article.source} | ${relTime}\n    ${article.summary}`
        );
      }
      sections.push("");
    }

    sections.push(`---\n${articles.length} articles from ${byTopic.size} topic(s)`);

    return sections.join("\n");
  }

  private formatRelativeTime(isoDate: string): string {
    try {
      const date = new Date(isoDate);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffMinutes = Math.floor(diffMs / (1000 * 60));

      if (diffMinutes < 1) return "Just now";
      if (diffMinutes < 60) return `${diffMinutes}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      const diffDays = Math.floor(diffHours / 24);
      if (diffDays === 1) return "Yesterday";
      if (diffDays < 7) return `${diffDays}d ago`;
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } catch {
      return isoDate;
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private cleanHeadline(title: string): string {
    // Remove common suffixes like "| Source Name", "- Site"
    return title
      .replace(/\s*[-|]\s*[A-Z][A-Za-z\s]+$/, "")
      .trim()
      .slice(0, 120);
  }

  private cleanSummary(snippet: string): string {
    return snippet
      .replace(/\s+/g, " ")
      .replace(/\.\.\.$/, "...")
      .trim()
      .slice(0, 200);
  }

  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname.replace("www.", "");
    } catch {
      return "";
    }
  }

  private buildCacheKey(sessionId: string, topics: string[]): string {
    return `digest:${sessionId}:${topics.sort().join(",")}`;
  }
}

export default NewsDigestHandler;
