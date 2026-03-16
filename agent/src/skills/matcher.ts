// ─── Skill Matcher ────────────────────────────────────────────────────────
//
// Determines which skills are relevant for a given message or event.
// Checks command triggers, message pattern triggers, and heartbeat/schedule
// triggers to find matching skills and rank them by relevance.
//
// ───────────────────────────────────────────────────────────────────────────

import pino from "pino";
import type { LoadedSkill } from "./loader.js";

const logger = pino({ name: "skill-matcher" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MatchedSkill {
  /** The matched skill instance. */
  skill: LoadedSkill;
  /** Which trigger caused the match. */
  matchedTrigger: {
    type: "command" | "pattern" | "event" | "schedule";
    value: string;
  };
  /** Relevance score from 0.0 to 1.0 (higher = more relevant). */
  relevance: number;
  /** Extracted parameters from the match (e.g., command arguments). */
  extractedParams: Record<string, string>;
}

export interface MatchOptions {
  /** Current event type for event-based matching. */
  eventType?: string;
  /** Whether this is a heartbeat/scheduled invocation. */
  isHeartbeat?: boolean;
  /** Maximum number of skills to return. */
  maxResults?: number;
  /** Minimum relevance score to include (0.0 - 1.0). */
  minRelevance?: number;
}

// ─── Matcher ────────────────────────────────────────────────────────────────

/**
 * Determine which skills are relevant for the given message.
 *
 * Matching strategy:
 * 1. Command triggers: exact prefix match (e.g., "/briefing" matches message starting with "/briefing")
 * 2. Pattern triggers: regex match against message content
 * 3. Event triggers: match against the current event type
 * 4. Schedule triggers: match on heartbeat invocations
 *
 * @param message - The user's message or event content.
 * @param skills - All available skills to match against.
 * @param options - Optional matching configuration.
 * @returns Array of matched skills sorted by relevance (highest first).
 */
export function matchSkills(
  message: string,
  skills: LoadedSkill[],
  options: MatchOptions = {}
): MatchedSkill[] {
  const {
    eventType,
    isHeartbeat = false,
    maxResults = 5,
    minRelevance = 0.0,
  } = options;

  const matches: MatchedSkill[] = [];
  const normalizedMessage = message.trim().toLowerCase();

  for (const skill of skills) {
    if (!skill.metadata.enabled) {
      continue;
    }

    let bestMatch: MatchedSkill | null = null;

    for (const trigger of skill.metadata.triggers) {
      let match: MatchedSkill | null = null;

      switch (trigger.type) {
        case "command":
          match = matchCommand(normalizedMessage, message, trigger.value, skill);
          break;

        case "pattern":
          match = matchPattern(normalizedMessage, trigger.value, skill);
          break;

        case "event":
          if (eventType) {
            match = matchEvent(eventType, trigger.value, skill);
          }
          break;

        case "schedule":
          if (isHeartbeat) {
            match = matchSchedule(trigger.value, skill);
          }
          break;
      }

      if (match && (!bestMatch || match.relevance > bestMatch.relevance)) {
        bestMatch = match;
      }
    }

    if (bestMatch && bestMatch.relevance >= minRelevance) {
      matches.push(bestMatch);
    }
  }

  // Sort by relevance (descending)
  matches.sort((a, b) => b.relevance - a.relevance);

  // Limit results
  const limited = matches.slice(0, maxResults);

  if (limited.length > 0) {
    logger.debug(
      {
        message: normalizedMessage.slice(0, 80),
        matchCount: limited.length,
        skills: limited.map((m) => ({
          id: m.skill.id,
          trigger: m.matchedTrigger.type,
          relevance: m.relevance,
        })),
      },
      "Skills matched"
    );
  }

  return limited;
}

// ─── Command Matching ────────────────────────────────────────────────────

function matchCommand(
  normalizedMessage: string,
  originalMessage: string,
  commandValue: string,
  skill: LoadedSkill
): MatchedSkill | null {
  const command = commandValue.toLowerCase();

  // Exact command match: message starts with the command
  if (
    normalizedMessage === command ||
    normalizedMessage.startsWith(command + " ")
  ) {
    // Extract arguments after the command
    const argsStr = originalMessage.trim().slice(commandValue.length).trim();
    const extractedParams: Record<string, string> = {};
    if (argsStr) {
      extractedParams["args"] = argsStr;
    }

    return {
      skill,
      matchedTrigger: { type: "command", value: commandValue },
      relevance: 1.0, // Exact command matches get highest relevance
      extractedParams,
    };
  }

  return null;
}

// ─── Pattern Matching ────────────────────────────────────────────────────

function matchPattern(
  normalizedMessage: string,
  patternValue: string,
  skill: LoadedSkill
): MatchedSkill | null {
  try {
    const regex = new RegExp(patternValue, "i");
    const match = normalizedMessage.match(regex);

    if (match) {
      const extractedParams: Record<string, string> = {};

      // Store named groups or indexed groups
      if (match.groups) {
        Object.assign(extractedParams, match.groups);
      } else {
        match.forEach((group, index) => {
          if (index > 0 && group) {
            extractedParams[`group${index}`] = group;
          }
        });
      }

      // Calculate relevance based on how much of the message matched
      const matchLength = match[0]?.length ?? 0;
      const relevance = Math.min(
        0.9,
        0.3 + (matchLength / normalizedMessage.length) * 0.6
      );

      return {
        skill,
        matchedTrigger: { type: "pattern", value: patternValue },
        relevance,
        extractedParams,
      };
    }
  } catch (error) {
    logger.warn(
      { pattern: patternValue, skillId: skill.id, error: String(error) },
      "Invalid regex pattern in skill trigger"
    );
  }

  return null;
}

// ─── Event Matching ──────────────────────────────────────────────────────

function matchEvent(
  eventType: string,
  triggerValue: string,
  skill: LoadedSkill
): MatchedSkill | null {
  if (eventType.toLowerCase() === triggerValue.toLowerCase()) {
    return {
      skill,
      matchedTrigger: { type: "event", value: triggerValue },
      relevance: 0.95,
      extractedParams: { eventType },
    };
  }

  return null;
}

// ─── Schedule Matching ───────────────────────────────────────────────────

function matchSchedule(
  scheduleValue: string,
  skill: LoadedSkill
): MatchedSkill | null {
  // For heartbeat triggers, always match on heartbeat invocations
  if (scheduleValue === "heartbeat" || scheduleValue === "*") {
    return {
      skill,
      matchedTrigger: { type: "schedule", value: scheduleValue },
      relevance: 0.5, // Lower relevance since heartbeat triggers are ambient
      extractedParams: {},
    };
  }

  // Cron-like schedule matching could be added here
  // For now, treat any non-heartbeat schedule as not matching
  return null;
}
