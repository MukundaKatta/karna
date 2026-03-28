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
  humidity?: string;
  wind?: string;
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
    } else {
      logger.warn({ error: String(weatherResult.reason) }, "Weather fetch failed");
    }
    if (calendarResult.status === "fulfilled") {
      briefingData.calendar = calendarResult.value;
    } else {
      logger.warn({ error: String(calendarResult.reason) }, "Calendar fetch failed");
    }
    if (newsResult.status === "fulfilled") {
      briefingData.news = newsResult.value;
    } else {
      logger.warn({ error: String(newsResult.reason) }, "News fetch failed");
    }
    if (tasksResult.status === "fulfilled") {
      briefingData.tasks = tasksResult.value;
    } else {
      logger.warn({ error: String(tasksResult.reason) }, "Tasks fetch failed");
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
      let line = `- ${e.startTime} - ${e.endTime}: ${e.title}`;
      if (e.location) line += ` (${e.location})`;
      if (e.isConflict) line += " !! CONFLICT";
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
      (n) => `- ${n.headline} -- ${n.source}\n  ${n.summary}`
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
      const priority = t.priority === "high" ? "[!]" : t.priority === "medium" ? "[*]" : "[-]";
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

  // ─── Data Fetching ────────────────────────────────────────────────────

  private async fetchWeather(
    input: Record<string, unknown>,
    _context: SkillContext
  ): Promise<WeatherInfo | null> {
    const location = (input["location"] as string) ?? "";
    const queryLoc = location || "auto";

    logger.debug({ location: queryLoc }, "Fetching weather data from wttr.in");

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      // wttr.in provides free, no-key-needed weather in JSON format
      const url = `https://wttr.in/${encodeURIComponent(queryLoc)}?format=j1`;
      const response = await fetch(url, {
        headers: { "User-Agent": "karna-agent/1.0" },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        logger.warn({ status: response.status }, "wttr.in returned non-OK status");
        return null;
      }

      const data = (await response.json()) as {
        current_condition?: Array<{
          temp_C?: string;
          temp_F?: string;
          humidity?: string;
          weatherDesc?: Array<{ value?: string }>;
          windspeedKmph?: string;
          winddir16Point?: string;
        }>;
        nearest_area?: Array<{ areaName?: Array<{ value?: string }>; country?: Array<{ value?: string }> }>;
        weather?: Array<{
          date?: string;
          maxtempC?: string;
          mintempC?: string;
          maxtempF?: string;
          mintempF?: string;
          hourly?: Array<{ weatherDesc?: Array<{ value?: string }> }>;
        }>;
      };

      const current = data.current_condition?.[0];
      const area = data.nearest_area?.[0];
      const todayForecast = data.weather?.[0];

      if (!current) return null;

      const areaName = area?.areaName?.[0]?.value ?? queryLoc;
      const country = area?.country?.[0]?.value ?? "";
      const resolvedLocation = country ? `${areaName}, ${country}` : areaName;
      const conditions = current.weatherDesc?.[0]?.value ?? "Unknown";
      const tempC = current.temp_C ?? "?";
      const tempF = current.temp_F ?? "?";
      const humidity = current.humidity ? `${current.humidity}%` : undefined;
      const wind = current.windspeedKmph
        ? `${current.windspeedKmph} km/h ${current.winddir16Point ?? ""}`
        : undefined;

      let forecast = "";
      if (todayForecast) {
        forecast = `High ${todayForecast.maxtempC}C/${todayForecast.maxtempF}F, Low ${todayForecast.mintempC}C/${todayForecast.mintempF}F`;
      }

      return {
        location: resolvedLocation,
        temperature: `${tempC}C (${tempF}F)`,
        conditions,
        forecast,
        humidity,
        wind,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ error: msg }, "Failed to fetch weather from wttr.in");
      return null;
    }
  }

  private async fetchCalendarEvents(
    context: SkillContext
  ): Promise<CalendarEvent[]> {
    logger.debug("Fetching calendar events for today");

    if (!context.callTool) {
      logger.debug("No callTool available — calendar tool not connected");
      return [];
    }

    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todayEnd = new Date(todayStart);
      todayEnd.setDate(todayEnd.getDate() + 1);

      const result = await context.callTool("calendar_list", {
        timeMin: todayStart.toISOString(),
        timeMax: todayEnd.toISOString(),
      });

      if (!result || typeof result !== "object") return [];

      const events = Array.isArray(result)
        ? result
        : Array.isArray((result as Record<string, unknown>)["events"])
          ? (result as { events: unknown[] }).events
          : [];

      const parsed: CalendarEvent[] = [];
      for (const evt of events) {
        if (!evt || typeof evt !== "object") continue;
        const e = evt as Record<string, unknown>;
        const startRaw = e["startTime"] ?? e["start"] ?? "";
        const endRaw = e["endTime"] ?? e["end"] ?? "";
        parsed.push({
          title: (e["title"] as string) ?? (e["summary"] as string) ?? "Untitled",
          startTime: this.formatTimeStr(String(startRaw)),
          endTime: this.formatTimeStr(String(endRaw)),
          location: (e["location"] as string) ?? undefined,
        });
      }

      // Sort chronologically
      parsed.sort((a, b) => a.startTime.localeCompare(b.startTime));

      // Detect scheduling conflicts
      for (let i = 1; i < parsed.length; i++) {
        const prev = parsed[i - 1]!;
        const curr = parsed[i]!;
        if (curr.startTime < prev.endTime) {
          curr.isConflict = true;
          prev.isConflict = true;
        }
      }

      return parsed;
    } catch (error) {
      logger.warn({ error: String(error) }, "Calendar fetch failed");
      return [];
    }
  }

  private async fetchNews(
    input: Record<string, unknown>,
    context: SkillContext
  ): Promise<NewsItem[]> {
    const topics = (input["topics"] as string[]) ?? ["top news today"];

    logger.debug({ topics }, "Fetching news headlines");

    if (!context.callTool) {
      logger.debug("No callTool available — web_search tool not connected");
      return [];
    }

    const allItems: NewsItem[] = [];

    for (const topic of topics.slice(0, 3)) {
      try {
        const result = await context.callTool("web_search", {
          query: `${topic} news today ${new Date().toISOString().split("T")[0]}`,
          maxResults: 5,
        });

        if (!result || typeof result !== "object") continue;

        const searchResults = Array.isArray(result)
          ? result
          : Array.isArray((result as Record<string, unknown>)["results"])
            ? (result as { results: unknown[] }).results
            : [];

        for (const r of searchResults) {
          if (!r || typeof r !== "object") continue;
          const item = r as Record<string, unknown>;
          allItems.push({
            headline: (item["title"] as string) ?? "Untitled",
            source: (item["source"] as string) ??
              this.extractDomain((item["url"] as string) ?? ""),
            summary: (item["snippet"] as string) ?? "",
          });
        }
      } catch (error) {
        logger.warn({ topic, error: String(error) }, "News search failed for topic");
      }
    }

    // Deduplicate by headline
    const seen = new Set<string>();
    const deduped = allItems.filter((item) => {
      const key = item.headline.toLowerCase().slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return deduped.slice(0, 5);
  }

  private async fetchTasks(_context: SkillContext): Promise<TaskItem[]> {
    logger.debug("Fetching pending tasks");

    // Read tasks from local storage file if available
    try {
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const { homedir } = await import("node:os");
      const tasksFile = join(homedir(), ".karna", "tasks.json");

      const content = await readFile(tasksFile, "utf-8");
      const data = JSON.parse(content) as {
        tasks?: Array<{
          title?: string;
          dueDate?: string;
          priority?: string;
          completed?: boolean;
        }>;
      };

      if (!Array.isArray(data.tasks)) return [];

      const today = new Date().toISOString().split("T")[0]!;

      return data.tasks
        .filter((t) => !t.completed)
        .map((t) => ({
          title: t.title ?? "Untitled task",
          dueDate: t.dueDate,
          priority: (t.priority as "high" | "medium" | "low") ?? "medium",
        }))
        .filter((t) => !t.dueDate || t.dueDate <= today || t.priority === "high")
        .sort((a, b) => {
          const priorityOrder = { high: 0, medium: 1, low: 2 };
          return priorityOrder[a.priority] - priorityOrder[b.priority];
        })
        .slice(0, 10);
    } catch {
      // Tasks file may not exist — that's fine
      return [];
    }
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
      const w = data.weather;
      let weatherText = `**Weather** (${w.location})\n- ${w.temperature}, ${w.conditions}`;
      if (w.humidity) weatherText += ` | Humidity: ${w.humidity}`;
      if (w.wind) weatherText += ` | Wind: ${w.wind}`;
      if (w.forecast) weatherText += `\n- Forecast: ${w.forecast}`;
      sections.push(weatherText);
    } else {
      sections.push("**Weather** -- unavailable (could not reach wttr.in)");
    }

    // Calendar
    if (data.calendar && data.calendar.length > 0) {
      const conflicts = data.calendar.filter((e) => e.isConflict);
      const eventLines = data.calendar.map((e) => {
        let line = `- ${e.startTime} - ${e.endTime}: ${e.title}`;
        if (e.location) line += ` (${e.location})`;
        if (e.isConflict) line += " !! CONFLICT";
        return line;
      });

      let calSection = `**Calendar** (${data.calendar.length} events)\n${eventLines.join("\n")}`;
      if (conflicts.length > 0) {
        calSection += `\n!! ${conflicts.length} scheduling conflict(s) detected`;
      }
      sections.push(calSection);
    } else {
      sections.push("**Calendar** -- No events scheduled for today");
    }

    // News
    if (data.news && data.news.length > 0) {
      const newsLines = data.news.map(
        (n) => `- ${n.headline} -- ${n.source}\n  ${n.summary}`
      );
      sections.push(`**News**\n${newsLines.join("\n")}`);
    } else {
      sections.push("**News** -- No headlines available");
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
        taskSection += `\n!! ${highPriority.length} high-priority item(s)`;
      }
      sections.push(taskSection);
    } else {
      sections.push("**Tasks** -- No pending items");
    }

    return sections.join("\n\n");
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private formatTimeStr(isoOrTime: string): string {
    if (!isoOrTime) return "??:??";
    try {
      const date = new Date(isoOrTime);
      if (isNaN(date.getTime())) return isoOrTime;
      return date.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
    } catch {
      return isoOrTime;
    }
  }

  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname.replace("www.", "");
    } catch {
      return "unknown";
    }
  }
}

export default DailyBriefingHandler;
