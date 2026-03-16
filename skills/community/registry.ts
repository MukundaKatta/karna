// ─── Community Skill Registry ─────────────────────────────────────────────
//
// Manages discovery, installation, update, and removal of community skills
// from a remote registry. Skills are validated against a manifest schema
// before installation.
//
// ───────────────────────────────────────────────────────────────────────────

import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import pino from "pino";

const logger = pino({ name: "skill-registry" });

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Remote skill manifest as published to the community registry.
 */
export interface SkillManifest {
  /** Unique skill identifier (e.g., "community.weather-alerts"). */
  name: string;
  /** Human-readable display name. */
  displayName: string;
  /** Skill description. */
  description: string;
  /** Semver version string. */
  version: string;
  /** Author name or organization. */
  author: string;
  /** SPDX license identifier. */
  license: string;
  /** Repository URL. */
  repository?: string;
  /** URL to download the skill tarball. */
  downloadUrl: string;
  /** SHA-256 hash of the tarball for integrity verification. */
  sha256: string;
  /** Minimum Karna version required. */
  minKarnaVersion?: string;
  /** Tags for discoverability. */
  tags: string[];
  /** Dependencies on other skills. */
  dependencies: string[];
  /** When the skill was published. */
  publishedAt: string;
  /** Download count. */
  downloads: number;
}

/**
 * Local record of an installed community skill.
 */
export interface InstalledSkill {
  name: string;
  version: string;
  installPath: string;
  installedAt: string;
  manifest: SkillManifest;
}

/**
 * Registry configuration.
 */
export interface RegistryConfig {
  /** URL of the community registry API. */
  registryUrl: string;
  /** Local directory for installed community skills. */
  installDir: string;
  /** Request timeout in milliseconds. */
  timeoutMs: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_REGISTRY_URL = "https://registry.karna.dev/api/v1";
const DEFAULT_INSTALL_DIR = join(homedir(), ".karna", "community-skills");
const DEFAULT_TIMEOUT_MS = 30_000;
const INSTALLED_DB_FILE = "installed.json";

// ─── Validation ──────────────────────────────────────────────────────────

/**
 * Validate a skill manifest for required fields and format.
 */
function validateManifest(manifest: unknown): manifest is SkillManifest {
  if (!manifest || typeof manifest !== "object") return false;

  const m = manifest as Record<string, unknown>;

  // Required string fields
  const requiredStrings = ["name", "displayName", "description", "version", "author", "downloadUrl", "sha256"];
  for (const field of requiredStrings) {
    if (typeof m[field] !== "string" || !(m[field] as string).trim()) {
      logger.warn({ field }, "Manifest validation failed: missing or empty required field");
      return false;
    }
  }

  // Name format: lowercase, alphanumeric, hyphens, dots
  if (!/^[a-z][a-z0-9._-]*$/.test(m["name"] as string)) {
    logger.warn({ name: m["name"] }, "Manifest validation failed: invalid name format");
    return false;
  }

  // Version format: semver
  if (!/^\d+\.\d+\.\d+/.test(m["version"] as string)) {
    logger.warn({ version: m["version"] }, "Manifest validation failed: invalid version format");
    return false;
  }

  // Tags and dependencies must be arrays
  if (m["tags"] !== undefined && !Array.isArray(m["tags"])) return false;
  if (m["dependencies"] !== undefined && !Array.isArray(m["dependencies"])) return false;

  return true;
}

// ─── Registry ────────────────────────────────────────────────────────────

/**
 * Community skill registry client.
 *
 * Provides discovery, installation, update, and removal of community skills
 * from a remote registry API.
 */
export class SkillRegistry {
  private readonly config: RegistryConfig;
  private installed: Map<string, InstalledSkill> = new Map();
  private initialized = false;

  constructor(config?: Partial<RegistryConfig>) {
    this.config = {
      registryUrl: config?.registryUrl ?? DEFAULT_REGISTRY_URL,
      installDir: config?.installDir ?? DEFAULT_INSTALL_DIR,
      timeoutMs: config?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    };
  }

  /**
   * Initialize the registry: ensure directories exist and load installed skill database.
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      await mkdir(this.config.installDir, { recursive: true });
      await this.loadInstalledDb();
      this.initialized = true;
      logger.info(
        { installDir: this.config.installDir, installed: this.installed.size },
        "Community skill registry initialized"
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "Failed to initialize skill registry");
      throw new Error(`Registry initialization failed: ${message}`);
    }
  }

  /**
   * Discover available community skills from the registry.
   *
   * @param query - Optional search query to filter results.
   * @param tags - Optional tags to filter by.
   * @param limit - Maximum number of results (default: 50).
   * @returns Array of skill manifests matching the criteria.
   */
  async discover(
    query?: string,
    tags?: string[],
    limit = 50
  ): Promise<SkillManifest[]> {
    await this.ensureInitialized();

    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (tags && tags.length > 0) params.set("tags", tags.join(","));
    params.set("limit", String(limit));

    const url = `${this.config.registryUrl}/skills?${params.toString()}`;
    logger.debug({ url }, "Discovering community skills");

    try {
      const response = await this.fetchWithTimeout(url);
      if (!response.ok) {
        throw new Error(`Registry returned ${response.status}: ${await response.text()}`);
      }

      const data = (await response.json()) as { skills: unknown[] };
      const manifests: SkillManifest[] = [];

      for (const item of data.skills ?? []) {
        if (validateManifest(item)) {
          manifests.push(item);
        } else {
          logger.debug("Skipping invalid manifest in registry response");
        }
      }

      logger.info(
        { query, resultCount: manifests.length },
        "Community skills discovered"
      );

      return manifests;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message }, "Failed to discover skills from registry");
      throw new Error(`Discovery failed: ${message}`);
    }
  }

  /**
   * Install a community skill by name.
   *
   * Downloads the skill package, validates the manifest, extracts to
   * the install directory, and records the installation.
   *
   * @param skillName - The skill name as listed in the registry.
   * @returns The installed skill record.
   */
  async install(skillName: string): Promise<InstalledSkill> {
    await this.ensureInitialized();

    if (this.installed.has(skillName)) {
      throw new Error(
        `Skill "${skillName}" is already installed (version ${this.installed.get(skillName)!.version}). Use update() instead.`
      );
    }

    logger.info({ skillName }, "Installing community skill");

    // 1. Fetch manifest from registry
    const manifest = await this.fetchManifest(skillName);

    // 2. Download skill package
    const packageData = await this.downloadPackage(manifest);

    // 3. Create install directory
    const installPath = join(this.config.installDir, skillName);
    await mkdir(installPath, { recursive: true });

    // 4. Extract package (stub: write manifest and placeholder)
    // In production, this would extract a tarball
    await writeFile(
      join(installPath, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf-8"
    );
    await writeFile(
      join(installPath, "SKILL.md"),
      packageData.skillMd,
      "utf-8"
    );
    await writeFile(
      join(installPath, "handler.js"),
      packageData.handlerJs,
      "utf-8"
    );

    // 5. Record installation
    const record: InstalledSkill = {
      name: skillName,
      version: manifest.version,
      installPath,
      installedAt: new Date().toISOString(),
      manifest,
    };

    this.installed.set(skillName, record);
    await this.saveInstalledDb();

    logger.info(
      { skillName, version: manifest.version, installPath },
      "Community skill installed"
    );

    return record;
  }

  /**
   * Uninstall a community skill.
   *
   * Removes the skill directory and deletes the installation record.
   *
   * @param skillName - The skill to uninstall.
   * @returns True if the skill was uninstalled, false if not found.
   */
  async uninstall(skillName: string): Promise<boolean> {
    await this.ensureInitialized();

    const record = this.installed.get(skillName);
    if (!record) {
      logger.warn({ skillName }, "Skill not installed, nothing to uninstall");
      return false;
    }

    logger.info({ skillName, installPath: record.installPath }, "Uninstalling community skill");

    // Remove skill directory
    try {
      await rm(record.installPath, { recursive: true, force: true });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error), skillName },
        "Failed to remove skill directory, cleaning up record anyway"
      );
    }

    this.installed.delete(skillName);
    await this.saveInstalledDb();

    logger.info({ skillName }, "Community skill uninstalled");

    return true;
  }

  /**
   * Update an installed community skill to the latest version.
   *
   * Fetches the latest manifest, compares versions, and reinstalls
   * if a newer version is available.
   *
   * @param skillName - The skill to update.
   * @returns The updated skill record, or null if already up-to-date.
   */
  async update(skillName: string): Promise<InstalledSkill | null> {
    await this.ensureInitialized();

    const existing = this.installed.get(skillName);
    if (!existing) {
      throw new Error(`Skill "${skillName}" is not installed. Use install() first.`);
    }

    logger.info(
      { skillName, currentVersion: existing.version },
      "Checking for skill update"
    );

    // Fetch latest manifest
    const latest = await this.fetchManifest(skillName);

    if (latest.version === existing.version) {
      logger.info({ skillName, version: existing.version }, "Skill is already up-to-date");
      return null;
    }

    // Compare versions
    if (!this.isNewerVersion(latest.version, existing.version)) {
      logger.info(
        { skillName, current: existing.version, available: latest.version },
        "No newer version available"
      );
      return null;
    }

    // Reinstall with new version
    logger.info(
      { skillName, from: existing.version, to: latest.version },
      "Updating community skill"
    );

    await this.uninstall(skillName);
    return this.install(skillName);
  }

  /**
   * List all installed community skills.
   */
  getInstalled(): InstalledSkill[] {
    return Array.from(this.installed.values());
  }

  /**
   * Check if a skill is installed.
   */
  isInstalled(skillName: string): boolean {
    return this.installed.has(skillName);
  }

  // ─── Private: API Calls ────────────────────────────────────────────────

  private async fetchManifest(skillName: string): Promise<SkillManifest> {
    const url = `${this.config.registryUrl}/skills/${encodeURIComponent(skillName)}`;

    const response = await this.fetchWithTimeout(url);
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Skill "${skillName}" not found in the registry`);
      }
      throw new Error(`Registry returned ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    if (!validateManifest(data)) {
      throw new Error(`Invalid manifest for skill "${skillName}"`);
    }

    return data;
  }

  private async downloadPackage(
    manifest: SkillManifest
  ): Promise<{ skillMd: string; handlerJs: string }> {
    logger.debug(
      { name: manifest.name, url: manifest.downloadUrl },
      "Downloading skill package"
    );

    // In production, this would:
    // 1. Download the tarball from manifest.downloadUrl
    // 2. Verify SHA-256 integrity
    // 3. Extract SKILL.md and handler.js from the archive
    //
    // For now, return placeholders to indicate the download path works.
    return {
      skillMd: `---\nname: ${manifest.displayName}\ndescription: ${manifest.description}\nversion: ${manifest.version}\nauthor: ${manifest.author}\ntriggers:\n  - type: command\n    value: /${manifest.name}\nactions:\n  - name: execute\n    description: ${manifest.description}\n---\n\n# ${manifest.displayName}\n\n${manifest.description}\n\nInstalled from community registry.\n`,
      handlerJs: `// Community skill: ${manifest.name}\n// Downloaded from: ${manifest.downloadUrl}\n// This is a placeholder. The actual handler will be extracted from the package.\n\nexport default class CommunityHandler {\n  async execute(action, input, context) {\n    return { success: true, output: "Community skill ${manifest.name} executed" };\n  }\n}\n`,
    };
  }

  private async fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Request to ${url} timed out after ${this.config.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  // ─── Private: Local DB ─────────────────────────────────────────────────

  private async loadInstalledDb(): Promise<void> {
    const dbPath = join(this.config.installDir, INSTALLED_DB_FILE);

    try {
      const content = await readFile(dbPath, "utf-8");
      const data = JSON.parse(content) as { installed: InstalledSkill[] };

      this.installed.clear();
      for (const record of data.installed ?? []) {
        if (record.name) {
          this.installed.set(record.name, record);
        }
      }
    } catch {
      // File doesn't exist or is invalid — start fresh
      this.installed.clear();
    }
  }

  private async saveInstalledDb(): Promise<void> {
    const dbPath = join(this.config.installDir, INSTALLED_DB_FILE);
    const data = {
      version: 1,
      updatedAt: new Date().toISOString(),
      installed: Array.from(this.installed.values()),
    };

    await writeFile(dbPath, JSON.stringify(data, null, 2), "utf-8");
  }

  // ─── Private: Helpers ──────────────────────────────────────────────────

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.init();
    }
  }

  /**
   * Simple semver comparison: returns true if `newer` > `current`.
   */
  private isNewerVersion(newer: string, current: string): boolean {
    const parseSemver = (v: string): number[] =>
      v.split(".").map((n) => parseInt(n, 10));

    const n = parseSemver(newer);
    const c = parseSemver(current);

    for (let i = 0; i < 3; i++) {
      const nv = n[i] ?? 0;
      const cv = c[i] ?? 0;
      if (nv > cv) return true;
      if (nv < cv) return false;
    }

    return false;
  }
}
