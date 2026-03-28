// ─── Health Tracker Skill Handler ─────────────────────────────────────────
//
// Tracks daily health metrics (water, sleep, exercise, steps, mood),
// stores data locally, and provides daily/weekly summaries and streaks.
// Supports natural language input for all metrics.
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
  updatedAt: string;
}

interface ExerciseEntry {
  type: string;
  durationMinutes: number;
  caloriesEstimate?: number;
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
  horrible: 1,
  bad: 2,
  poor: 2,
  low: 2,
  down: 2,
  sad: 2,
  okay: 3,
  ok: 3,
  fine: 3,
  alright: 3,
  meh: 3,
  neutral: 3,
  good: 4,
  nice: 4,
  happy: 4,
  well: 4,
  positive: 4,
  great: 5,
  amazing: 5,
  excellent: 5,
  wonderful: 5,
  fantastic: 5,
  awesome: 5,
  incredible: 5,
};

// Calorie estimates per minute for different exercise types
const CALORIES_PER_MINUTE: Record<string, number> = {
  running: 11,
  cycling: 8,
  swimming: 9,
  walking: 4,
  yoga: 3,
  weights: 6,
  hiit: 12,
  stretching: 2,
  cardio: 8,
  pilates: 4,
  dancing: 6,
  hiking: 7,
  general: 5,
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
        case "goals":
          return this.manageGoals(input);
        case "trends":
          return this.getTrends();
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
    const value = (input["value"] as string) ?? "";
    const date = (input["date"] as string) ?? this.today();
    const note = input["note"] as string | undefined;

    if (!metric) {
      return {
        success: false,
        output: "Please specify a metric to log (water, sleep, exercise, steps, mood).",
        error: "Missing metric",
      };
    }

    const store = await this.loadStore();
    const entry = this.getOrCreateEntry(store, date);
    entry.updatedAt = new Date().toISOString();

    if (note) {
      entry.notes.push(`[${metric}] ${note}`);
    }

    switch (metric) {
      case "water": {
        const glasses = this.parseNumber(value) ?? 1;
        entry.water += glasses;
        const goalPct = Math.round((entry.water / store.goals.waterGlasses) * 100);
        const goalMet = entry.water >= store.goals.waterGlasses;
        await this.saveStore(store);

        let message = `Logged ${glasses} glass(es) of water. Total today: ${entry.water}/${store.goals.waterGlasses} (${goalPct}%)`;
        if (goalMet && entry.water - glasses < store.goals.waterGlasses) {
          message += "\n-- Water goal reached! Great job staying hydrated!";
        }

        return {
          success: true,
          output: message,
          data: { water: entry.water, goal: store.goals.waterGlasses, goalMet },
        };
      }

      case "sleep": {
        const hours = this.parseNumber(value) ?? 0;
        if (hours <= 0 || hours > 24) {
          return { success: false, output: "Invalid sleep hours. Please provide a value between 0 and 24.", error: "Invalid value" };
        }
        entry.sleep = hours;
        const inRange = hours >= store.goals.sleepHoursMin && hours <= store.goals.sleepHoursMax;
        const quality = hours < 5 ? "Poor" : hours < 7 ? "Below target" : hours <= 9 ? "Good" : "Oversleep";
        await this.saveStore(store);
        return {
          success: true,
          output: `Logged ${hours} hours of sleep. Quality: ${quality}. ${inRange ? "Within target range!" : `Target: ${store.goals.sleepHoursMin}-${store.goals.sleepHoursMax} hours`}`,
          data: { sleep: hours, goalMet: inRange, quality },
        };
      }

      case "exercise": {
        const parsed = this.parseExercise(value);
        const calories = Math.round(parsed.duration * (CALORIES_PER_MINUTE[parsed.type] ?? 5));
        entry.exercise.push({
          type: parsed.type,
          durationMinutes: parsed.duration,
          caloriesEstimate: calories,
          loggedAt: new Date().toISOString(),
        });
        const totalMinutes = entry.exercise.reduce((sum, e) => sum + e.durationMinutes, 0);
        const totalCalories = entry.exercise.reduce((sum, e) => sum + (e.caloriesEstimate ?? 0), 0);
        const goalMet = totalMinutes >= store.goals.exerciseMinutes;
        await this.saveStore(store);

        let message = `Logged ${parsed.duration} minutes of ${parsed.type} (~${calories} cal). Total exercise today: ${totalMinutes} min (~${totalCalories} cal)`;
        if (goalMet && totalMinutes - parsed.duration < store.goals.exerciseMinutes) {
          message += "\n-- Exercise goal reached! Keep up the great work!";
        }

        return {
          success: true,
          output: message,
          data: { exercise: entry.exercise, totalMinutes, totalCalories, goalMet },
        };
      }

      case "steps": {
        const steps = this.parseNumber(value) ?? 0;
        if (steps < 0) {
          return { success: false, output: "Invalid step count.", error: "Invalid value" };
        }
        entry.steps = steps;
        const goalPct = Math.round((steps / store.goals.stepsTarget) * 100);
        const goalMet = steps >= store.goals.stepsTarget;
        await this.saveStore(store);

        let message = `Logged ${steps.toLocaleString()} steps. ${goalMet ? "Goal reached!" : `${goalPct}% of ${store.goals.stepsTarget.toLocaleString()} target`}`;
        const remaining = store.goals.stepsTarget - steps;
        if (!goalMet && remaining > 0) {
          message += ` (${remaining.toLocaleString()} to go)`;
        }

        return {
          success: true,
          output: message,
          data: { steps, goal: store.goals.stepsTarget, goalMet },
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
        output: `No health data recorded for ${date}. Start logging with: log water, sleep, exercise, steps, or mood.`,
      };
    }

    const goals = store.goals;
    const totalExercise = entry.exercise.reduce((sum, e) => sum + e.durationMinutes, 0);
    const totalCalories = entry.exercise.reduce((sum, e) => sum + (e.caloriesEstimate ?? 0), 0);

    const waterMet = entry.water >= goals.waterGlasses;
    const sleepMet = entry.sleep >= goals.sleepHoursMin && entry.sleep <= goals.sleepHoursMax;
    const exerciseMet = totalExercise >= goals.exerciseMinutes;
    const stepsMet = entry.steps >= goals.stepsTarget;

    const check = (met: boolean) => met ? "[x]" : "[ ]";

    const lines = [
      `Health Summary for ${date}`,
      `${"=".repeat(45)}`,
      "",
      `${check(waterMet)} Water:    ${entry.water}/${goals.waterGlasses} glasses${waterMet ? " -- GOAL MET" : ""}`,
      `${check(sleepMet)} Sleep:    ${entry.sleep} hours${sleepMet ? " -- GOAL MET" : ` (target: ${goals.sleepHoursMin}-${goals.sleepHoursMax}h)`}`,
      `${check(exerciseMet)} Exercise: ${totalExercise} minutes${exerciseMet ? " -- GOAL MET" : ` (target: ${goals.exerciseMinutes}m)`}`,
    ];

    if (entry.exercise.length > 0) {
      for (const ex of entry.exercise) {
        const cal = ex.caloriesEstimate ? ` (~${ex.caloriesEstimate} cal)` : "";
        lines.push(`            - ${ex.type}: ${ex.durationMinutes} min${cal}`);
      }
      if (totalCalories > 0) {
        lines.push(`            Total calories burned: ~${totalCalories}`);
      }
    }

    lines.push(
      `${check(stepsMet)} Steps:    ${entry.steps.toLocaleString()}/${goals.stepsTarget.toLocaleString()}${stepsMet ? " -- GOAL MET" : ""}`
    );

    if (entry.mood > 0) {
      lines.push(`    Mood:     ${MOOD_LABELS[entry.mood] ?? "--"} (${entry.mood}/5)`);
    }

    if (entry.notes.length > 0) {
      lines.push("", "Notes:");
      for (const note of entry.notes) {
        lines.push(`  - ${note}`);
      }
    }

    // Calculate goals met
    const goalsMetCount = [waterMet, sleepMet, exerciseMet, stepsMet].filter(Boolean).length;

    lines.push("");
    lines.push(`${"─".repeat(45)}`);
    lines.push(`Goals met: ${goalsMetCount}/4${goalsMetCount === 4 ? " -- Perfect day!" : ""}`);

    return {
      success: true,
      output: lines.join("\n"),
      data: { entry, goalsMetCount, totalCalories } as unknown as Record<string, unknown>,
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
      calories: 0,
      steps: 0,
      mood: 0,
      moodCount: 0,
      goalsMetDays: 0,
    };

    for (const { entry } of validEntries) {
      if (!entry) continue;
      totals.water += entry.water;
      totals.sleep += entry.sleep;
      const exMin = entry.exercise.reduce((s, e) => s + e.durationMinutes, 0);
      const exCal = entry.exercise.reduce((s, e) => s + (e.caloriesEstimate ?? 0), 0);
      totals.exercise += exMin;
      totals.calories += exCal;
      totals.steps += entry.steps;
      if (entry.mood > 0) {
        totals.mood += entry.mood;
        totals.moodCount++;
      }

      // Count days where all goals met
      const allMet =
        entry.water >= goals.waterGlasses &&
        entry.sleep >= goals.sleepHoursMin &&
        entry.sleep <= goals.sleepHoursMax &&
        exMin >= goals.exerciseMinutes &&
        entry.steps >= goals.stepsTarget;
      if (allMet) totals.goalsMetDays++;
    }

    const days = validEntries.length;
    const avgWater = totals.water / days;
    const avgSleep = totals.sleep / days;
    const avgExercise = totals.exercise / days;
    const avgSteps = totals.steps / days;
    const avgMood = totals.moodCount > 0 ? totals.mood / totals.moodCount : 0;

    const lines = [
      `Weekly Health Report (${dates[dates.length - 1]} to ${dates[0]})`,
      `${"=".repeat(55)}`,
      `Days tracked: ${days}/7`,
      "",
      `Metric        Average/Day     Total         Goal`,
      `${"─".repeat(55)}`,
      `Water         ${avgWater.toFixed(1)} glasses    ${totals.water} glasses     ${goals.waterGlasses}/day`,
      `Sleep         ${avgSleep.toFixed(1)} hours      ${totals.sleep.toFixed(1)}h           ${goals.sleepHoursMin}-${goals.sleepHoursMax}h`,
      `Exercise      ${avgExercise.toFixed(0)} min        ${totals.exercise} min        ${goals.exerciseMinutes}m/day`,
      `Steps         ${Math.round(avgSteps).toLocaleString()}        ${totals.steps.toLocaleString()}       ${goals.stepsTarget.toLocaleString()}/day`,
    ];

    if (totals.calories > 0) {
      lines.push(`Calories      ~${Math.round(totals.calories / days)}/day    ~${totals.calories} total   --`);
    }

    if (avgMood > 0) {
      const moodLabel = MOOD_LABELS[Math.round(avgMood)] ?? "--";
      lines.push(`Mood          ${avgMood.toFixed(1)}/5 (${moodLabel})  --            --`);
    }

    lines.push("");
    lines.push(`${"─".repeat(55)}`);
    lines.push(`Perfect days (all goals met): ${totals.goalsMetDays}/${days}`);

    // Daily breakdown
    lines.push("", "Daily Breakdown:");
    for (const { date, entry } of entries) {
      if (!entry) {
        lines.push(`  ${date}: No data`);
        continue;
      }
      const exMin = entry.exercise.reduce((s, e) => s + e.durationMinutes, 0);
      const moodStr = entry.mood > 0 ? MOOD_LABELS[entry.mood] ?? "--" : "--";
      lines.push(
        `  ${date}: W:${entry.water} S:${entry.sleep}h E:${exMin}m St:${entry.steps.toLocaleString()} M:${moodStr}`
      );
    }

    return {
      success: true,
      output: lines.join("\n"),
      data: {
        days,
        averages: { water: avgWater, sleep: avgSleep, exercise: avgExercise, steps: avgSteps, mood: avgMood },
        totals,
        perfectDays: totals.goalsMetDays,
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
      allGoals: this.calculateStreak(store, (e) => {
        const exMin = e.exercise.reduce((s, ex) => s + ex.durationMinutes, 0);
        return (
          e.water >= goals.waterGlasses &&
          e.sleep >= goals.sleepHoursMin &&
          e.sleep <= goals.sleepHoursMax &&
          exMin >= goals.exerciseMinutes &&
          e.steps >= goals.stepsTarget
        );
      }),
    };

    // Best streak records
    const bestStreaks = {
      water: this.calculateBestStreak(store, (e) => e.water >= goals.waterGlasses),
      exercise: this.calculateBestStreak(store, (e) => e.exercise.length > 0),
      steps: this.calculateBestStreak(store, (e) => e.steps >= goals.stepsTarget),
    };

    const lines = [
      "Current Streaks",
      `${"=".repeat(35)}`,
      `Water:        ${streaks.water} day(s)`,
      `Sleep:        ${streaks.sleep} day(s)`,
      `Exercise:     ${streaks.exercise} day(s)`,
      `Steps:        ${streaks.steps} day(s)`,
      `All goals:    ${streaks.allGoals} day(s)`,
      "",
      "Best Streaks",
      `${"─".repeat(35)}`,
      `Water:        ${bestStreaks.water} day(s)`,
      `Exercise:     ${bestStreaks.exercise} day(s)`,
      `Steps:        ${bestStreaks.steps} day(s)`,
    ];

    const longest = Math.max(...Object.values(streaks));
    if (longest >= 7) {
      lines.push("", "Incredible! You have a streak of 7+ days!");
    } else if (longest >= 3) {
      lines.push("", "Good momentum! Keep building those habits.");
    }

    return {
      success: true,
      output: lines.join("\n"),
      data: { streaks, bestStreaks },
    };
  }

  private async manageGoals(input: Record<string, unknown>): Promise<SkillResult> {
    const store = await this.loadStore();

    // If no goal updates provided, show current goals
    const hasUpdates =
      input["waterGlasses"] !== undefined ||
      input["sleepHoursMin"] !== undefined ||
      input["sleepHoursMax"] !== undefined ||
      input["stepsTarget"] !== undefined ||
      input["exerciseMinutes"] !== undefined;

    if (!hasUpdates) {
      const g = store.goals;
      return {
        success: true,
        output: `Current Goals:\n  Water:    ${g.waterGlasses} glasses/day\n  Sleep:    ${g.sleepHoursMin}-${g.sleepHoursMax} hours\n  Exercise: ${g.exerciseMinutes} minutes/day\n  Steps:    ${g.stepsTarget.toLocaleString()}/day`,
        data: { goals: g },
      };
    }

    // Update goals
    if (input["waterGlasses"] !== undefined) {
      store.goals.waterGlasses = Number(input["waterGlasses"]);
    }
    if (input["sleepHoursMin"] !== undefined) {
      store.goals.sleepHoursMin = Number(input["sleepHoursMin"]);
    }
    if (input["sleepHoursMax"] !== undefined) {
      store.goals.sleepHoursMax = Number(input["sleepHoursMax"]);
    }
    if (input["stepsTarget"] !== undefined) {
      store.goals.stepsTarget = Number(input["stepsTarget"]);
    }
    if (input["exerciseMinutes"] !== undefined) {
      store.goals.exerciseMinutes = Number(input["exerciseMinutes"]);
    }

    await this.saveStore(store);

    const g = store.goals;
    return {
      success: true,
      output: `Goals updated:\n  Water:    ${g.waterGlasses} glasses/day\n  Sleep:    ${g.sleepHoursMin}-${g.sleepHoursMax} hours\n  Exercise: ${g.exerciseMinutes} minutes/day\n  Steps:    ${g.stepsTarget.toLocaleString()}/day`,
      data: { goals: g },
    };
  }

  private async getTrends(): Promise<SkillResult> {
    const store = await this.loadStore();
    const dates = this.getLastNDays(30);
    const entries = dates.map((d) => store.entries[d]).filter((e) => e !== undefined);

    if (entries.length < 3) {
      return { success: true, output: "Not enough data for trends (need at least 3 days of data)." };
    }

    // Split into two halves for comparison
    const mid = Math.floor(entries.length / 2);
    const recent = entries.slice(0, mid);
    const older = entries.slice(mid);

    const avgRecent = {
      water: recent.reduce((s, e) => s + e.water, 0) / recent.length,
      sleep: recent.reduce((s, e) => s + e.sleep, 0) / recent.length,
      steps: recent.reduce((s, e) => s + e.steps, 0) / recent.length,
      mood: recent.filter((e) => e.mood > 0).reduce((s, e) => s + e.mood, 0) /
        Math.max(1, recent.filter((e) => e.mood > 0).length),
    };

    const avgOlder = {
      water: older.reduce((s, e) => s + e.water, 0) / older.length,
      sleep: older.reduce((s, e) => s + e.sleep, 0) / older.length,
      steps: older.reduce((s, e) => s + e.steps, 0) / older.length,
      mood: older.filter((e) => e.mood > 0).reduce((s, e) => s + e.mood, 0) /
        Math.max(1, older.filter((e) => e.mood > 0).length),
    };

    const trend = (recent: number, older: number) => {
      if (older === 0) return "-- (no prior data)";
      const pct = ((recent - older) / older) * 100;
      if (Math.abs(pct) < 2) return "Stable";
      return pct > 0 ? `Up ${pct.toFixed(0)}%` : `Down ${Math.abs(pct).toFixed(0)}%`;
    };

    const lines = [
      `Health Trends (last ${entries.length} days)`,
      `${"=".repeat(45)}`,
      "",
      `Metric        Recent Avg    Trend`,
      `${"─".repeat(45)}`,
      `Water         ${avgRecent.water.toFixed(1)} glasses  ${trend(avgRecent.water, avgOlder.water)}`,
      `Sleep         ${avgRecent.sleep.toFixed(1)} hours    ${trend(avgRecent.sleep, avgOlder.sleep)}`,
      `Steps         ${Math.round(avgRecent.steps).toLocaleString()}       ${trend(avgRecent.steps, avgOlder.steps)}`,
    ];

    if (avgRecent.mood > 0 && avgOlder.mood > 0) {
      lines.push(`Mood          ${avgRecent.mood.toFixed(1)}/5        ${trend(avgRecent.mood, avgOlder.mood)}`);
    }

    return {
      success: true,
      output: lines.join("\n"),
      data: { recent: avgRecent, older: avgOlder, dataPoints: entries.length },
    };
  }

  // ─── Streak Helpers ───────────────────────────────────────────────────

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

  private calculateBestStreak(
    store: HealthStore,
    predicate: (entry: HealthEntry) => boolean
  ): number {
    let best = 0;
    let current = 0;
    const today = new Date();

    for (let i = 0; i < 365; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split("T")[0]!;
      const entry = store.entries[dateStr];

      if (entry && predicate(entry)) {
        current++;
        if (current > best) best = current;
      } else {
        current = 0;
      }
    }

    return best;
  }

  // ─── Parsing Helpers ──────────────────────────────────────────────────

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
    const exerciseTypes = Object.keys(CALORIES_PER_MINUTE);
    const lower = value.toLowerCase();
    const type = exerciseTypes.find((t) => lower.includes(t)) ?? "general";

    return { type, duration };
  }

  // ─── Date Helpers ─────────────────────────────────────────────────────

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
        updatedAt: new Date().toISOString(),
      };
    }
    return store.entries[date]!;
  }

  // ─── Storage ──────────────────────────────────────────────────────────

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
