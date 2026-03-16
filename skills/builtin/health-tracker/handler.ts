// ─── Health Tracker Skill Handler ─────────────────────────────────────────
//
// Tracks daily health metrics (water, sleep, exercise, steps, mood),
// stores data locally, and provides daily/weekly summaries and streaks.
//
// ───────────────────────────────────────────────────────────────────────────

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import pino from "pino";
import type {
  SkillHandler,
  SkillContext,
  SkillResult,
} from "../../../agent/src/skills/loader.js";

const logger = pino({ name: "skill:health-tracker" });

// ─── Types ──────────────────────────────────────────────────────────────────

type MetricType = "water" | "sleep" | "exercise" | "steps" | "mood";

interface HealthEntry {
  date: string; // YYYY-MM-DD
  water: number; // glasses
  sleep: number; // hours
  exercise: ExerciseEntry[];
  steps: number;
  mood: number; // 1-5 scale
  notes: string[];
}

interface ExerciseEntry {
  type: string;
  durationMinutes: number;
  loggedAt: string;
}

interface HealthStore {
  version: number;
  entries: Record<string, HealthEntry>; // keyed by date
  goals: HealthGoals;
}

interface HealthGoals {
  waterGlasses: number;
  sleepHoursMin: number;
  sleepHoursMax: number;
  stepsTarget: number;
  exerciseMinutes: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const STORAGE_DIR = join(homedir(), ".karna");
const STORAGE_FILE = join(STORAGE_DIR, "health.json");

const DEFAULT_GOALS: HealthGoals = {
  waterGlasses: 8,
  sleepHoursMin: 7,
  sleepHoursMax: 9,
  stepsTarget: 10000,
  exerciseMinutes: 30,
};

const MOOD_LABELS: Record<number, string> = {
  1: "terrible",
  2: "bad",
  3: "okay",
  4: "good",
  5: "great",
};

const MOOD_WORDS: Record<string, number> = {
  terrible: 1,
  awful: 1,
  bad: 2,
  poor: 2,
  low: 2,
  okay: 3,
  ok: 3,
  fine: 3,
  alright: 3,
  good: 4,
  nice: 4,
  happy: 4,
  great: 5,
  amazing: 5,
  excellent: 5,
  wonderful: 5,
  fantastic: 5,
};

// ─── Handler ────────────────────────────────────────────────────────────────

export class HealthTrackerHandler implements SkillHandler {
  async initialize(context: SkillContext): Promise<void> {
    logger.info({ sessionId: context.sessionId }, "Health tracker skill initialized");
    await this.ensureStorageExists();
  }

  async execute(
    action: string,
    input: Record<string, unknown>,
    context: SkillContext
  ): Promise<SkillResult> {
    logger.debug({ action, sessionId: context.sessionId }, "Executing health tracker action");

    try {
      switch (action) {
        case "log":
          return this.logMetric(input);
        case "summary":
          return this.getDailySummary(input);
        case "weekly":
          return this.getWeeklyReport();
        case "streaks":
          return this.getStreaks();
        default:
          return {
            success: false,
            output: `Unknown action: ${action}`,
            error: `Action "${action}" is not supported`,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message, action }, "Health tracker action failed");
      return { success: false, output: `Failed: ${message}`, error: message };
    }
  }

  async dispose(): Promise<void> {
    logger.info("Health tracker skill disposed");
  }

  // ─── Actions ────────────────────────────────────────────────────────────

  private async logMetric(input: Record<string, unknown>): Promise<SkillResult> {
    const metric = (input["metric"] as string)?.toLowerCase() as MetricType;
    const value = input["value"] as string ?? "";
    const date = (input["date"] as string) ?? this.today();

    if (!metric) {
      return {
        success: false,
        output: "Please specify a metric to log (water, sleep, exercise, steps, mood).",
        error: "Missing metric",
      };
    }

    const store = await this.loadStore();
    const entry = this.getOrCreateEntry(store, date);

    switch (metric) {
      case "water": {
        const glasses = this.parseNumber(value) ?? 1;
        entry.water += glasses;
        const goalPct = Math.round((entry.water / store.goals.waterGlasses) * 100);
        await this.saveStore(store);
        return {
          success: true,
          output: `Logged ${glasses} glass(es) of water. Total today: ${entry.water}/${store.goals.waterGlasses} (${goalPct}%)`,
          data: { water: entry.water, goal: store.goals.waterGlasses },
        };
      }

      case "sleep": {
        const hours = this.parseNumber(value) ?? 0;
        if (hours <= 0 || hours > 24) {
          return { success: false, output: "Invalid sleep hours. Please provide a value between 0 and 24.", error: "Invalid value" };
        }
        entry.sleep = hours;
        const inRange = hours >= store.goals.sleepHoursMin && hours <= store.goals.sleepHoursMax;
        await this.saveStore(store);
        return {
          success: true,
          output: `Logged ${hours} hours of sleep. ${inRange ? "Within target range!" : `Target: ${store.goals.sleepHoursMin}-${store.goals.sleepHoursMax} hours`}`,
          data: { sleep: hours, goalMet: inRange },
        };
      }

      case "exercise": {
        const parsed = this.parseExercise(value);
        entry.exercise.push({
          type: parsed.type,
          durationMinutes: parsed.duration,
          loggedAt: new Date().toISOString(),
        });
        const totalMinutes = entry.exercise.reduce((sum, e) => sum + e.durationMinutes, 0);
        await this.saveStore(store);
        return {
          success: true,
          output: `Logged ${parsed.duration} minutes of ${parsed.type}. Total exercise today: ${totalMinutes} minutes`,
          data: { exercise: entry.exercise, totalMinutes },
        };
      }

      case "steps": {
        const steps = this.parseNumber(value) ?? 0;
        if (steps < 0) {
          return { success: false, output: "Invalid step count.", error: "Invalid value" };
        }
        entry.steps = steps;
        const goalPct = Math.round((steps / store.goals.stepsTarget) * 100);
        await this.saveStore(store);
        return {
          success: true,
          output: `Logged ${steps.toLocaleString()} steps. ${goalPct >= 100 ? "Goal reached!" : `${goalPct}% of ${store.goals.stepsTarget.toLocaleString()} target`}`,
          data: { steps, goal: store.goals.stepsTarget },
        };
      }

      case "mood": {
        const moodValue = this.parseMood(value);
        if (!moodValue) {
          return {
            success: false,
            output: "Could not parse mood. Use a number 1-5 or words like: great, good, okay, bad, terrible.",
            error: "Invalid mood",
          };
        }
        entry.mood = moodValue;
        const label = MOOD_LABELS[moodValue] ?? "unknown";
        await this.saveStore(store);
        return {
          success: true,
          output: `Mood logged: ${label} (${moodValue}/5)`,
          data: { mood: moodValue, label },
        };
      }

      default:
        return {
          success: false,
          output: `Unknown metric: ${metric}. Supported: water, sleep, exercise, steps, mood.`,
          error: "Unknown metric",
        };
    }
  }

  private async getDailySummary(input: Record<string, unknown>): Promise<SkillResult> {
    const date = (input["date"] as string) ?? this.today();
    const store = await this.loadStore();
    const entry = store.entries[date];

    if (!entry) {
      return {
        success: true,
        output: `No health data recorded for ${date}.`,
      };
    }

    const goals = store.goals;
    const totalExercise = entry.exercise.reduce((sum, e) => sum + e.durationMinutes, 0);

    const lines = [
      `Health Summary for ${date}`,
      `${"─".repeat(40)}`,
      "",
      `Water:    ${entry.water}/${goals.waterGlasses} glasses ${entry.water >= goals.waterGlasses ? "[GOAL MET]" : ""}`,
      `Sleep:    ${entry.sleep} hours ${entry.sleep >= goals.sleepHoursMin && entry.sleep <= goals.sleepHoursMax ? "[GOAL MET]" : `(target: ${goals.sleepHoursMin}-${goals.sleepHoursMax}h)`}`,
      `Exercise: ${totalExercise} minutes ${totalExercise >= goals.exerciseMinutes ? "[GOAL MET]" : `(target: ${goals.exerciseMinutes}m)`}`,
    ];

    if (entry.exercise.length > 0) {
      for (const ex of entry.exercise) {
        lines.push(`          - ${ex.type}: ${ex.durationMinutes} min`);
      }
    }

    lines.push(
      `Steps:    ${entry.steps.toLocaleString()}/${goals.stepsTarget.toLocaleString()} ${entry.steps >= goals.stepsTarget ? "[GOAL MET]" : ""}`
    );

    if (entry.mood > 0) {
      lines.push(`Mood:     ${MOOD_LABELS[entry.mood] ?? "—"} (${entry.mood}/5)`);
    }

    // Calculate goals met
    const goalsMetCount = [
      entry.water >= goals.waterGlasses,
      entry.sleep >= goals.sleepHoursMin && entry.sleep <= goals.sleepHoursMax,
      totalExercise >= goals.exerciseMinutes,
      entry.steps >= goals.stepsTarget,
    ].filter(Boolean).length;

    lines.push("");
    lines.push(`${"─".repeat(40)}`);
    lines.push(`Goals met: ${goalsMetCount}/4`);

    return {
      success: true,
      output: lines.join("\n"),
      data: { entry, goalsMetCount } as unknown as Record<string, unknown>,
    };
  }

  private async getWeeklyReport(): Promise<SkillResult> {
    const store = await this.loadStore();
    const dates = this.getLastNDays(7);
    const entries = dates.map((d) => ({ date: d, entry: store.entries[d] }));
    const validEntries = entries.filter((e) => e.entry);

    if (validEntries.length === 0) {
      return { success: true, output: "No health data recorded in the past 7 days." };
    }

    const goals = store.goals;
    const totals = {
      water: 0,
      sleep: 0,
      exercise: 0,
      steps: 0,
      mood: 0,
      moodCount: 0,
    };

    for (const { entry } of validEntries) {
      if (!entry) continue;
      totals.water += entry.water;
      totals.sleep += entry.sleep;
      totals.exercise += entry.exercise.reduce((s, e) => s + e.durationMinutes, 0);
      totals.steps += entry.steps;
      if (entry.mood > 0) {
        totals.mood += entry.mood;
        totals.moodCount++;
      }
    }

    const days = validEntries.length;
    const avgWater = totals.water / days;
    const avgSleep = totals.sleep / days;
    const avgExercise = totals.exercise / days;
    const avgSteps = totals.steps / days;
    const avgMood = totals.moodCount > 0 ? totals.mood / totals.moodCount : 0;

    const lines = [
      `Weekly Health Report (${dates[dates.length - 1]} to ${dates[0]})`,
      `${"─".repeat(50)}`,
      `Days tracked: ${days}/7`,
      "",
      `Metric        Average/Day     Total     Goal`,
      `${"─".repeat(50)}`,
      `Water         ${avgWater.toFixed(1)} glasses    ${totals.water}         ${goals.waterGlasses}/day`,
      `Sleep         ${avgSleep.toFixed(1)} hours      ${totals.sleep.toFixed(1)}h       ${goals.sleepHoursMin}-${goals.sleepHoursMax}h`,
      `Exercise      ${avgExercise.toFixed(0)} min        ${totals.exercise} min    ${goals.exerciseMinutes}m/day`,
      `Steps         ${Math.round(avgSteps).toLocaleString()}        ${totals.steps.toLocaleString()}   ${goals.stepsTarget.toLocaleString()}/day`,
    ];

    if (avgMood > 0) {
      lines.push(
        `Mood          ${avgMood.toFixed(1)}/5          —         —`
      );
    }

    return {
      success: true,
      output: lines.join("\n"),
      data: {
        days,
        averages: { water: avgWater, sleep: avgSleep, exercise: avgExercise, steps: avgSteps, mood: avgMood },
        totals,
      },
    };
  }

  private async getStreaks(): Promise<SkillResult> {
    const store = await this.loadStore();
    const goals = store.goals;

    const streaks = {
      water: this.calculateStreak(store, (e) => e.water >= goals.waterGlasses),
      sleep: this.calculateStreak(
        store,
        (e) => e.sleep >= goals.sleepHoursMin && e.sleep <= goals.sleepHoursMax
      ),
      exercise: this.calculateStreak(store, (e) => e.exercise.length > 0),
      steps: this.calculateStreak(store, (e) => e.steps >= goals.stepsTarget),
    };

    const lines = [
      "Current Streaks",
      `${"─".repeat(30)}`,
      `Water:    ${streaks.water} day(s)`,
      `Sleep:    ${streaks.sleep} day(s)`,
      `Exercise: ${streaks.exercise} day(s)`,
      `Steps:    ${streaks.steps} day(s)`,
    ];

    const longest = Math.max(...Object.values(streaks));
    if (longest >= 7) {
      lines.push("", "Keep it up! You have a streak of 7+ days!");
    }

    return {
      success: true,
      output: lines.join("\n"),
      data: { streaks },
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private calculateStreak(
    store: HealthStore,
    predicate: (entry: HealthEntry) => boolean
  ): number {
    let streak = 0;
    const today = new Date();

    for (let i = 0; i < 365; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split("T")[0]!;
      const entry = store.entries[dateStr];

      if (!entry || !predicate(entry)) break;
      streak++;
    }

    return streak;
  }

  private parseNumber(value: string): number | null {
    const match = value.match(/([0-9]+(?:\.[0-9]+)?)/);
    return match ? parseFloat(match[1]!) : null;
  }

  private parseMood(value: string): number | null {
    // Try numeric
    const num = this.parseNumber(value);
    if (num !== null && num >= 1 && num <= 5) {
      return Math.round(num);
    }

    // Try word matching
    const lower = value.toLowerCase().trim();
    for (const [word, score] of Object.entries(MOOD_WORDS)) {
      if (lower.includes(word)) return score;
    }

    return null;
  }

  private parseExercise(value: string): { type: string; duration: number } {
    const durationMatch = value.match(/(\d+)\s*(?:min|minutes?|hrs?|hours?)/i);
    let duration = durationMatch ? parseInt(durationMatch[1]!, 10) : 30;

    // Convert hours to minutes
    if (durationMatch && /hrs?|hours?/i.test(durationMatch[0]!)) {
      duration *= 60;
    }

    // Extract exercise type
    const exerciseTypes = [
      "running",
      "walking",
      "cycling",
      "swimming",
      "yoga",
      "weights",
      "hiit",
      "stretching",
      "cardio",
      "pilates",
    ];
    const lower = value.toLowerCase();
    const type = exerciseTypes.find((t) => lower.includes(t)) ?? "general";

    return { type, duration };
  }

  private today(): string {
    return new Date().toISOString().split("T")[0]!;
  }

  private getLastNDays(n: number): string[] {
    const dates: string[] = [];
    const today = new Date();
    for (let i = 0; i < n; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      dates.push(date.toISOString().split("T")[0]!);
    }
    return dates;
  }

  private getOrCreateEntry(store: HealthStore, date: string): HealthEntry {
    if (!store.entries[date]) {
      store.entries[date] = {
        date,
        water: 0,
        sleep: 0,
        exercise: [],
        steps: 0,
        mood: 0,
        notes: [],
      };
    }
    return store.entries[date]!;
  }

  private async ensureStorageExists(): Promise<void> {
    try {
      await mkdir(STORAGE_DIR, { recursive: true });
    } catch {
      // Directory may already exist
    }
  }

  private async loadStore(): Promise<HealthStore> {
    try {
      const content = await readFile(STORAGE_FILE, "utf-8");
      return JSON.parse(content) as HealthStore;
    } catch {
      return { version: 1, entries: {}, goals: { ...DEFAULT_GOALS } };
    }
  }

  private async saveStore(store: HealthStore): Promise<void> {
    await this.ensureStorageExists();
    await writeFile(STORAGE_FILE, JSON.stringify(store, null, 2), "utf-8");
  }
}

export default HealthTrackerHandler;
