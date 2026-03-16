# Karna Skills

Skills are modular capabilities that extend Karna's abilities. Each skill is a self-contained unit with metadata, natural-language instructions, and a TypeScript handler.

## Directory Structure

```
skills/
├── builtin/              # Built-in skills shipped with Karna
│   ├── daily-briefing/
│   │   ├── SKILL.md      # Metadata + instructions
│   │   └── handler.ts    # TypeScript implementation
│   ├── expense-tracker/
│   ├── news-digest/
│   ├── code-reviewer/
│   ├── meeting-prep/
│   ├── health-tracker/
│   ├── travel-planner/
│   └── smart-home/
├── community/            # Community skill registry
│   └── registry.ts
└── README.md
```

## Creating a Skill

Every skill lives in its own directory and requires two files:

### 1. SKILL.md

A Markdown file with YAML frontmatter containing metadata, followed by natural-language instructions.

```markdown
---
name: My Skill
description: What this skill does
version: 1.0.0
author: Your Name
category: productivity
tags:
  - example
triggers:
  - type: command
    value: /myskill
    description: Trigger via slash command
  - type: pattern
    value: "keyword1|keyword2"
    description: Trigger on message pattern match
actions:
  - name: execute
    description: Primary action
    parameters:
      input:
        type: string
        description: Input parameter
dependencies:
  - web-search
requiredTools:
  - web_search
permissions:
  - file_read
---

# My Skill

Natural-language instructions for the LLM on how to use this skill.

## Behavior

Describe the expected behavior, formatting rules, and edge cases.
```

### Frontmatter Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Human-readable skill name |
| `description` | string | Yes | Brief description (max 2048 chars) |
| `version` | string | Yes | Semver version (e.g., "1.0.0") |
| `author` | string | No | Author name |
| `category` | string | No | Category for organization |
| `icon` | string | No | Emoji icon |
| `tags` | string[] | No | Tags for discoverability |
| `triggers` | array | Yes | At least one trigger (see below) |
| `actions` | array | Yes | At least one action (see below) |
| `dependencies` | string[] | No | Other skills this depends on |
| `requiredTools` | string[] | No | Tools needed at runtime |
| `permissions` | string[] | No | Required permissions |
| `enabled` | boolean | No | Default: true |
| `singleton` | boolean | No | Only one instance allowed |
| `maxConcurrency` | number | No | Max parallel executions (default: 5) |

### Trigger Types

| Type | Value | Description |
|------|-------|-------------|
| `command` | `/mycommand` | Exact slash command match |
| `pattern` | `"regex pattern"` | Regex matched against message content |
| `event` | `github.push` | Event name from webhook/integration |
| `schedule` | `heartbeat` | Triggered on periodic heartbeat |

### 2. handler.ts

A TypeScript file that exports a class implementing the `SkillHandler` interface:

```typescript
import type {
  SkillHandler,
  SkillContext,
  SkillResult,
} from "../../agent/src/skills/loader.js";

export class MySkillHandler implements SkillHandler {
  /**
   * Called once when the skill is loaded (optional).
   */
  async initialize(context: SkillContext): Promise<void> {
    // Set up resources, load config, etc.
  }

  /**
   * Execute a skill action. This is the main entry point.
   *
   * @param action - The action name from the SKILL.md actions list.
   * @param input - Parameters for the action.
   * @param context - Session and agent context.
   */
  async execute(
    action: string,
    input: Record<string, unknown>,
    context: SkillContext
  ): Promise<SkillResult> {
    switch (action) {
      case "execute":
        return {
          success: true,
          output: "Skill executed successfully",
          data: { /* optional structured data */ },
        };
      default:
        return {
          success: false,
          output: `Unknown action: ${action}`,
          error: `Action "${action}" is not supported`,
        };
    }
  }

  /**
   * Called when the skill is being unloaded (optional).
   */
  async dispose(): Promise<void> {
    // Clean up resources
  }
}

export default MySkillHandler;
```

### SkillResult Format

```typescript
interface SkillResult {
  success: boolean;       // Whether the action completed successfully
  output: string;         // Human-readable output text
  data?: Record<string, unknown>;  // Optional structured data
  error?: string;         // Error message if success is false
}
```

### SkillContext

```typescript
interface SkillContext {
  sessionId: string;               // Current session ID
  agentId: string;                 // Agent ID running the skill
  userId?: string;                 // User ID if available
  config?: Record<string, unknown>; // Skill-specific configuration
}
```

## Skill Matching

When a message arrives, the skill matcher checks all loaded skills:

1. **Command triggers** are checked first (exact prefix match, highest relevance)
2. **Pattern triggers** are matched via regex (relevance based on match length)
3. **Event triggers** are matched against the current event type
4. **Schedule triggers** are matched during heartbeat invocations

Multiple skills can match a single message. They are sorted by relevance score and the top matches are executed.

## Loading Skills

Skills are loaded by the agent at startup:

```typescript
import { loadBuiltinSkills, loadCustomSkills } from "./skills/loader.js";
import { matchSkills } from "./skills/matcher.js";

// Load all built-in skills
const builtins = await loadBuiltinSkills();

// Load custom skills from a directory
const custom = await loadCustomSkills("~/.karna/custom-skills");

// Match skills for a message
const allSkills = [...builtins, ...custom];
const matched = matchSkills(userMessage, allSkills);
```

## Community Skills

Install community skills via the registry:

```typescript
import { SkillRegistry } from "../skills/community/registry.js";

const registry = new SkillRegistry();
await registry.init();

// Discover skills
const skills = await registry.discover("weather");

// Install a skill
await registry.install("community.weather-alerts");

// Update a skill
await registry.update("community.weather-alerts");

// Uninstall a skill
await registry.uninstall("community.weather-alerts");
```

## Built-in Skills

| Skill | Command | Description |
|-------|---------|-------------|
| Daily Briefing | `/briefing` | Morning briefing with weather, calendar, news, tasks |
| Expense Tracker | `/expense` | Track and categorize personal expenses |
| News Digest | `/news` | Summarized news digest on configured topics |
| Code Reviewer | `/review` | Code analysis for bugs, security, performance, style |
| Meeting Prep | `/meeting-prep` | Context gathering for upcoming meetings |
| Health Tracker | `/health` | Track water, sleep, exercise, steps, mood |
| Travel Planner | `/travel` | Create travel itineraries with budget tracking |
| Smart Home | `/home` | Control Home Assistant devices |

## Best Practices

1. **Keep skills focused** — Each skill should do one thing well
2. **Handle errors gracefully** — Return `{ success: false, error: "..." }` instead of throwing
3. **Use pino for logging** — `import pino from "pino"; const logger = pino({ name: "skill:my-skill" });`
4. **Stub external dependencies** — Skills should work (with reduced functionality) even when tools are not available
5. **Cache when appropriate** — Avoid redundant API calls with time-based caching
6. **Document behavior in SKILL.md** — The markdown body is used as LLM instructions
7. **Validate all inputs** — Never trust user input; validate and sanitize
8. **Support natural language** — Pattern triggers should capture common phrasings
