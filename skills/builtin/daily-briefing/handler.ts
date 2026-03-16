// ─── Daily Briefing Skill Handler ─────────────────────────────────────────
//
// Generates a comprehensive morning briefing with weather, calendar,
// news, and tasks. Designed to be triggered on heartbeat (morning) or
// via the /briefing command.
//
// ───────────────────────────────────────────────────────────────────────────

import pino from "pino";
import type {
  SkillHandler,
  SkillContext,
  SkillResult,
} from "../../../agent/src/skills/loader.js";

const logger = pino({ name: "skill:daily-briefing" });

// ─── Types ──────────────────────────────────────────────────────────────────

interface WeatherInfo {
  location: string;
  temperature: string;
  conditions: string;
  forecast: string;
}

interface CalendarEvent {
  title: string;
  startTime: string;
  endTime: string;
  location?: string;
  isConflict?: boolean;
}

interface NewsItem {
  headline: string;
  source: string;
  summary: string;
}

interface TaskItem {
  title: string;
  dueDate?: string;
  priority: "high" | "medium" | "low";
}

interface BriefingData {
  weather?: WeatherInfo;
  calendar?: CalendarEvent[];
  news?: NewsItem[];
  tasks?: TaskItem[];
  generatedAt: string;
}

// ─── Cache ──────────────────────────────────────────────────────────────────

interface CacheEntry {
  data: BriefingData;
  expiresAt: number;
}

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// ─── Handler ────────────────────────────────────────────────────────────────

export class DailyBriefingHandler implements SkillHandler {
  private cache: Map<string, CacheEntry> = new Map();

  async initialize(context: SkillContext): Promise<void> {
    logger.info({ sessionId: context.sessionId }, "Daily briefing skill initialized");
  }

  async execute(
    action: string,
    input: Record<string, unknown>,
    context: SkillContext
  ): Promise<SkillResult> {
    logger.debug({ action, sessionId: context.sessionId }, "Executing daily briefing action");

    try {
      switch (action) {
        case "generate":
          return this.generateBriefing(input, context);
        case "weather":
          return this.getWeather(input, context);
        case "calendar":
          return this.getCalendarEvents(context);
        case "news":
          return this.getNews(input, context);
        case "tasks":
          return this.getTasks(context);
        default:
          return {
            success: false,
            output: `Unknown action: ${action}`,
            error: `Action "${action}" is not supported by the daily-briefing skill`,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message, action }, "Daily briefing action failed");
      return {
        success: false,
        output: `Failed to execute ${action}: ${message}`,
        error: message,
      };
    }
  }

  async dispose(): Promise<void> {
    this.cache.clear();
    logger.info("Daily briefing skill disposed");
  }

  // ─── Actions ────────────────────────────────────────────────────────────

  private async generateBriefing(
    input: Record<string, unknown>,
    context: SkillContext
  ): Promise<SkillResult> {
    const isHeartbeat = input["trigger"] === "heartbeat";

    // On heartbeat, only trigger between 6 AM and 10 AM
    if (isHeartbeat) {
      const hour = new Date().getHours();
      if (hour < 6 || hour >= 10) {
        return {
          success: true,
          output: "Outside briefing window (6 AM - 10 AM), skipping.",
          data: { skipped: true },
        };
      }
    }

    // Check cache
    const cacheKey = `briefing:${context.sessionId}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      logger.debug("Returning cached briefing");
      return {
        success: true,
        output: this.formatBriefing(cached.data),
        data: cached.data as unknown as Record<string, unknown>,
      };
    }

    // Build briefing sections
    const briefingData: BriefingData = {
      generatedAt: new Date().toISOString(),
    };

    // Fetch each section independently — failures are non-fatal
    const [weatherResult, calendarResult, newsResult, tasksResult] =
      await Promise.allSettled([
        this.fetchWeather(input, context),
        this.fetchCalendarEvents(context),
        this.fetchNews(input, context),
        this.fetchTasks(context),
      ]);

    if (weatherResult.status === "fulfilled") {
      briefingData.weather = weatherResult.value;
    }
    if (calendarResult.status === "fulfilled") {
      briefingData.calendar = calendarResult.value;
    }
    if (newsResult.status === "fulfilled") {
      briefingData.news = newsResult.value;
    }
    if (tasksResult.status === "fulfilled") {
      briefingData.tasks = tasksResult.value;
    }

    // Cache the result
    this.cache.set(cacheKey, {
      data: briefingData,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    const output = this.formatBriefing(briefingData);

    return {
      success: true,
      output,
      data: briefingData as unknown as Record<string, unknown>,
    };
  }

  private async getWeather(
    input: Record<string, unknown>,
    context: SkillContext
  ): Promise<SkillResult> {
    const weather = await this.fetchWeather(input, context);
    return {
      success: true,
      output: weather
        ? `Weather in ${weather.location}: ${weather.temperature}, ${weather.conditions}. ${weather.forecast}`
        : "Weather information is currently unavailable.",
      data: weather as unknown as Record<string, unknown>,
    };
  }

  private async getCalendarEvents(context: SkillContext): Promise<SkillResult> {
    const events = await this.fetchCalendarEvents(context);
    if (events.length === 0) {
      return { success: true, output: "No calendar events for today." };
    }

    const lines = events.map((e) => {
      let line = `• ${e.startTime} - ${e.endTime}: ${e.title}`;
      if (e.location) line += ` (${e.location})`;
      if (e.isConflict) line += " ⚠️ CONFLICT";
      return line;
    });

    return {
      success: true,
      output: `Today's events:\n${lines.join("\n")}`,
      data: { events } as unknown as Record<string, unknown>,
    };
  }

  private async getNews(
    input: Record<string, unknown>,
    context: SkillContext
  ): Promise<SkillResult> {
    const news = await this.fetchNews(input, context);
    if (news.length === 0) {
      return { success: true, output: "No news available at the moment." };
    }

    const lines = news.map(
      (n) => `• ${n.headline} — ${n.source}\n  ${n.summary}`
    );

    return {
      success: true,
      output: `Top headlines:\n${lines.join("\n\n")}`,
      data: { news } as unknown as Record<string, unknown>,
    };
  }

  private async getTasks(context: SkillContext): Promise<SkillResult> {
    const tasks = await this.fetchTasks(context);
    if (tasks.length === 0) {
      return { success: true, output: "No pending tasks or reminders." };
    }

    const lines = tasks.map((t) => {
      const priority = t.priority === "high" ? "🔴" : t.priority === "medium" ? "🟡" : "🟢";
      let line = `${priority} ${t.title}`;
      if (t.dueDate) line += ` (due: ${t.dueDate})`;
      return line;
    });

    return {
      success: true,
      output: `Pending tasks:\n${lines.join("\n")}`,
      data: { tasks } as unknown as Record<string, unknown>,
    };
  }

  // ─── Data Fetching (Stubs — wired to tools at runtime) ─────────────────

  private async fetchWeather(
    input: Record<string, unknown>,
    _context: SkillContext
  ): Promise<WeatherInfo | null> {
    // In production, this calls the web_search tool for weather data.
    // The agent runtime injects tool access via context.config.
    const location = (input["location"] as string) ?? "auto";

    logger.debug({ location }, "Fetching weather data");

    // Stub: return placeholder until tool integration is wired
    return {
      location,
      temperature: "—",
      conditions: "Weather data requires web-search tool integration",
      forecast: "Connect the web_search tool to enable live weather.",
    };
  }

  private async fetchCalendarEvents(
    _context: SkillContext
  ): Promise<CalendarEvent[]> {
    // In production, calls calendar_list tool for today's events.
    logger.debug("Fetching calendar events");

    // Stub: return empty until calendar tool is wired
    return [];
  }

  private async fetchNews(
    input: Record<string, unknown>,
    _context: SkillContext
  ): Promise<NewsItem[]> {
    // In production, calls web_search tool for news.
    const topics = (input["topics"] as string[]) ?? ["technology", "world"];

    logger.debug({ topics }, "Fetching news");

    // Stub: return empty until web-search tool is wired
    return [];
  }

  private async fetchTasks(_context: SkillContext): Promise<TaskItem[]> {
    // In production, reads from the memory store or a tasks file.
    logger.debug("Fetching pending tasks");

    // Stub: return empty until task storage is wired
    return [];
  }

  // ─── Formatting ────────────────────────────────────────────────────────

  private formatBriefing(data: BriefingData): string {
    const now = new Date();
    const hour = now.getHours();
    const greeting =
      hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

    const sections: string[] = [];

    sections.push(`${greeting}! Here's your briefing for ${now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}:\n`);

    // Weather
    if (data.weather) {
      sections.push(
        `**Weather** (${data.weather.location})\n• ${data.weather.temperature}, ${data.weather.conditions}\n• ${data.weather.forecast}`
      );
    } else {
      sections.push("**Weather** — unavailable (web-search dependency not connected)");
    }

    // Calendar
    if (data.calendar && data.calendar.length > 0) {
      const conflicts = data.calendar.filter((e) => e.isConflict);
      const eventLines = data.calendar.map((e) => {
        let line = `• ${e.startTime} - ${e.endTime}: ${e.title}`;
        if (e.location) line += ` (${e.location})`;
        if (e.isConflict) line += " ⚠ CONFLICT";
        return line;
      });

      let calSection = `**Calendar** (${data.calendar.length} events)\n${eventLines.join("\n")}`;
      if (conflicts.length > 0) {
        calSection += `\n⚠ ${conflicts.length} scheduling conflict(s) detected`;
      }
      sections.push(calSection);
    } else {
      sections.push("**Calendar** — No events scheduled for today");
    }

    // News
    if (data.news && data.news.length > 0) {
      const newsLines = data.news.map(
        (n) => `• ${n.headline} — ${n.source}\n  ${n.summary}`
      );
      sections.push(`**News**\n${newsLines.join("\n")}`);
    } else {
      sections.push("**News** — No headlines available");
    }

    // Tasks
    if (data.tasks && data.tasks.length > 0) {
      const highPriority = data.tasks.filter((t) => t.priority === "high");
      const taskLines = data.tasks.map((t) => {
        const marker = t.priority === "high" ? "[!]" : t.priority === "medium" ? "[*]" : "[-]";
        let line = `${marker} ${t.title}`;
        if (t.dueDate) line += ` (due: ${t.dueDate})`;
        return line;
      });

      let taskSection = `**Tasks** (${data.tasks.length} pending)\n${taskLines.join("\n")}`;
      if (highPriority.length > 0) {
        taskSection += `\n⚠ ${highPriority.length} high-priority item(s)`;
      }
      sections.push(taskSection);
    } else {
      sections.push("**Tasks** — No pending items");
    }

    return sections.join("\n\n");
  }
}

export default DailyBriefingHandler;
