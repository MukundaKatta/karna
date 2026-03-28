// ─── Skill Loader ─────────────────────────────────────────────────────────
//
// Loads skills from SKILL.md files (YAML frontmatter + markdown body)
// and their corresponding TypeScript handler modules.
//
// ───────────────────────────────────────────────────────────────────────────

import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import pino from "pino";
import type { SkillMetadata } from "@karna/shared/types/skill.js";

const logger = pino({ name: "skill-loader" });

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Parsed frontmatter from a SKILL.md file.
 */
export interface SkillFrontmatter {
  name: string;
  description: string;
  version: string;
  author?: string;
  tags?: string[];
  category?: string;
  icon?: string;
  triggers: Array<{
    type: "command" | "pattern" | "event" | "schedule";
    value: string;
    description?: string;
  }>;
  actions: Array<{
    name: string;
    description: string;
    parameters?: Record<string, unknown>;
    riskLevel?: "low" | "medium" | "high" | "critical";
  }>;
  dependencies?: string[];
  permissions?: string[];
  requiredTools?: string[];
  enabled?: boolean;
  singleton?: boolean;
  maxConcurrency?: number;
}

/**
 * Context passed to skill handlers during execution.
 */
export interface SkillContext {
  sessionId: string;
  agentId: string;
  userId?: string;
  config?: Record<string, unknown>;
  /** Execute a registered tool by name. Injected by the runtime. */
  callTool?: (toolName: string, input: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Result from executing a skill action.
 */
export interface SkillResult {
  success: boolean;
  output: string;
  data?: Record<string, unknown>;
  error?: string;
}

/**
 * Interface that all skill handlers must implement.
 */
export interface SkillHandler {
  /** Called once when the skill is loaded. */
  initialize?(context: SkillContext): Promise<void>;

  /** Execute the skill with the given action and input. */
  execute(
    action: string,
    input: Record<string, unknown>,
    context: SkillContext
  ): Promise<SkillResult>;

  /** Called when the skill is being unloaded. */
  dispose?(): Promise<void>;
}

/**
 * A fully loaded skill instance with metadata, instructions, and handler.
 */
export interface LoadedSkill {
  /** Unique skill identifier derived from directory name. */
  id: string;
  /** Parsed metadata from frontmatter. */
  metadata: SkillMetadata;
  /** The markdown body of SKILL.md (natural-language instructions). */
  instructions: string;
  /** The skill handler instance. */
  handler: SkillHandler;
  /** Filesystem path where the skill was loaded from. */
  loadPath: string;
}

// ─── Frontmatter Parser ──────────────────────────────────────────────────

/**
 * Parse YAML frontmatter from a SKILL.md file.
 * Expects `---` delimiters around the YAML block.
 */
function parseFrontmatter(content: string): {
  frontmatter: SkillFrontmatter;
  body: string;
} {
  const trimmed = content.trim();

  if (!trimmed.startsWith("---")) {
    throw new Error("SKILL.md must start with YAML frontmatter delimited by ---");
  }

  const endIndex = trimmed.indexOf("---", 3);
  if (endIndex === -1) {
    throw new Error("SKILL.md frontmatter is missing closing --- delimiter");
  }

  const yamlBlock = trimmed.slice(3, endIndex).trim();
  const body = trimmed.slice(endIndex + 3).trim();

  // Simple YAML parser for the subset we need (avoids extra dependency)
  const frontmatter = parseSimpleYaml(yamlBlock) as unknown as SkillFrontmatter;

  if (!frontmatter.name) {
    throw new Error("SKILL.md frontmatter must include a 'name' field");
  }
  if (!frontmatter.triggers || frontmatter.triggers.length === 0) {
    throw new Error("SKILL.md frontmatter must include at least one trigger");
  }

  return { frontmatter, body };
}

/**
 * Minimal YAML parser that handles the structure used in SKILL.md files.
 * Supports: strings, numbers, booleans, arrays of objects/strings, nested objects.
 */
function parseSimpleYaml(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmedLine = line.trim();

    // Skip empty lines and comments
    if (!trimmedLine || trimmedLine.startsWith("#")) {
      i++;
      continue;
    }

    const indent = line.length - line.trimStart().length;

    // Top-level key
    if (indent === 0) {
      const colonIdx = trimmedLine.indexOf(":");
      if (colonIdx === -1) {
        i++;
        continue;
      }

      const key = trimmedLine.slice(0, colonIdx).trim();
      const valueStr = trimmedLine.slice(colonIdx + 1).trim();

      if (valueStr) {
        // Inline value
        result[key] = parseYamlValue(valueStr);
      } else {
        // Check if next lines are array items or nested object
        const collected = collectNestedBlock(lines, i + 1);
        result[key] = collected.value;
        i = collected.nextIndex;
        continue;
      }
    }

    i++;
  }

  return result;
}

function parseYamlValue(value: string): unknown {
  // Remove surrounding quotes
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  // Inline array: [a, b, c]
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((item) => parseYamlValue(item.trim()));
  }

  // Boolean
  if (value === "true") return true;
  if (value === "false") return false;

  // Number
  const num = Number(value);
  if (!isNaN(num) && value !== "") return num;

  return value;
}

function collectNestedBlock(
  lines: string[],
  startIdx: number
): { value: unknown; nextIndex: number } {
  if (startIdx >= lines.length) {
    return { value: null, nextIndex: startIdx };
  }

  const firstLine = lines[startIdx]!;
  const trimmedFirst = firstLine.trim();

  // Array items start with -
  if (trimmedFirst.startsWith("- ")) {
    return collectArray(lines, startIdx);
  }

  // Nested object
  return collectObject(lines, startIdx);
}

function collectArray(
  lines: string[],
  startIdx: number
): { value: unknown[]; nextIndex: number } {
  const result: unknown[] = [];
  let i = startIdx;
  const baseIndent = lines[startIdx]!.length - lines[startIdx]!.trimStart().length;

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith("#")) {
      i++;
      continue;
    }

    const indent = line.length - line.trimStart().length;
    if (indent < baseIndent) break;

    if (indent === baseIndent && trimmedLine.startsWith("- ")) {
      const itemContent = trimmedLine.slice(2).trim();

      // Check if this array item has inline key:value (object item)
      const colonIdx = itemContent.indexOf(":");
      if (colonIdx !== -1 && !itemContent.startsWith('"') && !itemContent.startsWith("'")) {
        // Object item - collect all properties for this array element
        const obj: Record<string, unknown> = {};
        const key = itemContent.slice(0, colonIdx).trim();
        const val = itemContent.slice(colonIdx + 1).trim();
        obj[key] = val ? parseYamlValue(val) : null;

        // Collect continuation lines for this object
        i++;
        while (i < lines.length) {
          const nextLine = lines[i]!;
          const nextTrimmed = nextLine.trim();
          if (!nextTrimmed || nextTrimmed.startsWith("#")) {
            i++;
            continue;
          }
          const nextIndent = nextLine.length - nextLine.trimStart().length;
          if (nextIndent <= baseIndent) break;

          const nextColonIdx = nextTrimmed.indexOf(":");
          if (nextColonIdx !== -1) {
            const nk = nextTrimmed.slice(0, nextColonIdx).trim();
            const nv = nextTrimmed.slice(nextColonIdx + 1).trim();
            obj[nk] = nv ? parseYamlValue(nv) : null;
          }
          i++;
        }

        result.push(obj);
        continue;
      } else {
        // Simple value
        result.push(parseYamlValue(itemContent));
        i++;
        continue;
      }
    }

    // If we get here with wrong indent, break
    if (indent === baseIndent && !trimmedLine.startsWith("-")) break;

    i++;
  }

  return { value: result, nextIndex: i };
}

function collectObject(
  lines: string[],
  startIdx: number
): { value: Record<string, unknown>; nextIndex: number } {
  const result: Record<string, unknown> = {};
  let i = startIdx;
  const baseIndent = lines[startIdx]!.length - lines[startIdx]!.trimStart().length;

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith("#")) {
      i++;
      continue;
    }

    const indent = line.length - line.trimStart().length;
    if (indent < baseIndent) break;

    if (indent === baseIndent) {
      const colonIdx = trimmedLine.indexOf(":");
      if (colonIdx !== -1) {
        const key = trimmedLine.slice(0, colonIdx).trim();
        const val = trimmedLine.slice(colonIdx + 1).trim();
        result[key] = val ? parseYamlValue(val) : null;
      }
    }

    i++;
  }

  return { value: result, nextIndex: i };
}

// ─── Metadata Conversion ────────────────────────────────────────────────

/**
 * Convert parsed frontmatter into a SkillMetadata object.
 */
function toSkillMetadata(id: string, fm: SkillFrontmatter): SkillMetadata {
  return {
    id,
    name: fm.name,
    description: fm.description ?? "",
    version: fm.version ?? "1.0.0",
    author: fm.author,
    tags: fm.tags ?? [],
    category: fm.category,
    icon: fm.icon,
    triggers: (fm.triggers ?? []).map((t) => ({
      type: t.type,
      value: t.value,
      description: t.description,
    })),
    actions: (fm.actions ?? []).map((a) => ({
      name: a.name,
      description: a.description,
      parameters: a.parameters,
      riskLevel: a.riskLevel ?? "low",
    })),
    requiredTools: fm.requiredTools ?? [],
    enabled: fm.enabled ?? true,
    singleton: fm.singleton ?? false,
    maxConcurrency: fm.maxConcurrency ?? 5,
    dependencies: fm.dependencies ?? [],
    permissions: fm.permissions ?? [],
  };
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Load a single skill from a directory containing SKILL.md and handler.ts.
 *
 * @param skillPath - Absolute path to the skill directory.
 * @returns The loaded skill instance.
 */
export async function loadSkill(skillPath: string): Promise<LoadedSkill> {
  const resolvedPath = resolve(skillPath);
  const skillId = resolvedPath.split("/").pop()!;

  logger.debug({ skillPath: resolvedPath, skillId }, "Loading skill");

  // 1. Read and parse SKILL.md
  const skillMdPath = join(resolvedPath, "SKILL.md");
  let skillMdContent: string;
  try {
    skillMdContent = await readFile(skillMdPath, "utf-8");
  } catch (error) {
    throw new Error(
      `Failed to read SKILL.md at ${skillMdPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const { frontmatter, body } = parseFrontmatter(skillMdContent);
  const metadata = toSkillMetadata(skillId, frontmatter);

  // 2. Load the handler module
  const handlerPath = join(resolvedPath, "handler.js");
  let handler: SkillHandler;
  try {
    const handlerModule = (await import(handlerPath)) as Record<string, unknown>;

    // Look for a default export or a class that implements SkillHandler
    const HandlerClass = handlerModule.default ?? Object.values(handlerModule)[0];

    if (typeof HandlerClass === "function") {
      handler = new (HandlerClass as new () => SkillHandler)();
    } else if (
      HandlerClass &&
      typeof HandlerClass === "object" &&
      "execute" in HandlerClass
    ) {
      handler = HandlerClass as SkillHandler;
    } else {
      throw new Error("Handler module must export a class or object with an execute method");
    }
  } catch (error) {
    throw new Error(
      `Failed to load handler at ${handlerPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  logger.info(
    { skillId, name: metadata.name, triggers: metadata.triggers.length },
    "Skill loaded successfully"
  );

  return {
    id: skillId,
    metadata,
    instructions: body,
    handler,
    loadPath: resolvedPath,
  };
}

/**
 * Scan a directory for skill subdirectories and load all valid skills.
 * Skips directories that fail to load (logs a warning).
 *
 * @param directory - Path to scan for skill directories.
 * @returns Array of successfully loaded skills.
 */
async function scanAndLoadSkills(directory: string): Promise<LoadedSkill[]> {
  const resolvedDir = resolve(directory);
  const skills: LoadedSkill[] = [];

  let entries: string[];
  try {
    entries = await readdir(resolvedDir);
  } catch (error) {
    logger.warn(
      { directory: resolvedDir, error: error instanceof Error ? error.message : String(error) },
      "Failed to read skill directory"
    );
    return [];
  }

  for (const entry of entries) {
    const entryPath = join(resolvedDir, entry);

    try {
      const entryStat = await stat(entryPath);
      if (!entryStat.isDirectory()) continue;

      // Check for SKILL.md
      const skillMdPath = join(entryPath, "SKILL.md");
      try {
        await stat(skillMdPath);
      } catch {
        logger.debug({ path: entryPath }, "Skipping directory without SKILL.md");
        continue;
      }

      const skill = await loadSkill(entryPath);
      skills.push(skill);
    } catch (error) {
      logger.warn(
        { entry, error: error instanceof Error ? error.message : String(error) },
        "Failed to load skill, skipping"
      );
    }
  }

  logger.info(
    { directory: resolvedDir, loaded: skills.length, total: entries.length },
    "Skill directory scan complete"
  );

  return skills;
}

/**
 * Load all built-in skills from the skills/builtin/ directory.
 *
 * @param builtinDir - Path to the builtin skills directory.
 *                     Defaults to the standard location relative to the project root.
 * @returns Array of loaded built-in skills.
 */
export async function loadBuiltinSkills(
  builtinDir?: string
): Promise<LoadedSkill[]> {
  const dir = builtinDir ?? resolve(import.meta.dirname, "../../../../skills/builtin");
  logger.info({ directory: dir }, "Loading built-in skills");
  return scanAndLoadSkills(dir);
}

/**
 * Load custom/community skills from a user-specified directory.
 *
 * @param customDir - Path to the custom skills directory.
 * @returns Array of loaded custom skills.
 */
export async function loadCustomSkills(customDir: string): Promise<LoadedSkill[]> {
  logger.info({ directory: customDir }, "Loading custom skills");
  return scanAndLoadSkills(customDir);
}
