// ─── Plugin Registration ────────────────────────────────────────────────────
//
// Core plugin interface and registration context.
// Plugins use this to register channels, tools, and skills with Karna.
//
// ─────────────────────────────────────────────────────────────────────────────

import type { Logger } from "@karna/shared";
import type { ChannelAdapter } from "./channel.js";
import type { ToolPlugin } from "./tool.js";
import type { SkillPlugin } from "./skill.js";

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Context provided to plugins during registration.
 * Plugins use this to register their components and access shared services.
 */
export interface PluginContext {
  /**
   * Register a channel adapter.
   * The adapter will be started/stopped with the gateway lifecycle.
   */
  registerChannel(adapter: ChannelAdapter): void;

  /**
   * Register a tool that the AI agent can invoke.
   */
  registerTool(tool: ToolPlugin): void;

  /**
   * Register a skill (higher-level capability).
   */
  registerSkill(skill: SkillPlugin): void;

  /**
   * Get the plugin's configuration from the Karna config.
   * Returns the config section for this plugin.
   */
  getConfig(): Record<string, unknown>;

  /**
   * Get a logger instance scoped to this plugin.
   */
  getLogger(): Logger;

  /**
   * Get a shared service by name (for inter-plugin communication).
   */
  getService?<T = unknown>(name: string): T | undefined;

  /**
   * Register a shared service that other plugins can consume.
   */
  registerService?<T = unknown>(name: string, service: T): void;

  /**
   * Subscribe to lifecycle events.
   */
  onShutdown?(handler: () => Promise<void>): void;
}

// ─── Plugin Interface ───────────────────────────────────────────────────────

/**
 * The core plugin interface. Every Karna plugin must implement this.
 *
 * A plugin is a bundle of channels, tools, and/or skills that extends
 * Karna's capabilities. Plugins are loaded at startup and registered
 * with the runtime.
 *
 * @example
 * ```ts
 * import { definePlugin } from "@karna/plugin-sdk";
 *
 * export default definePlugin({
 *   name: "my-plugin",
 *   version: "1.0.0",
 *   async register(context) {
 *     const config = context.getConfig();
 *     const logger = context.getLogger();
 *
 *     context.registerTool({
 *       name: "my_tool",
 *       description: "Does something useful",
 *       riskLevel: "low",
 *       parameters: { type: "object", properties: {}, required: [] },
 *       async execute(input) {
 *         return { output: "done", isError: false };
 *       },
 *     });
 *
 *     logger.info("My plugin registered successfully");
 *   },
 * });
 * ```
 */
export interface KarnaPlugin {
  /** Unique plugin name. */
  name: string;

  /** Plugin version (semver). */
  version: string;

  /** Optional description. */
  description?: string;

  /** Plugin author. */
  author?: string;

  /** Plugins this depends on (by name). */
  dependencies?: string[];

  /**
   * Register the plugin's components with Karna.
   * Called once during startup. Use the context to register
   * channels, tools, skills, and services.
   */
  register(context: PluginContext): Promise<void>;

  /**
   * Optional cleanup when the plugin is unloaded.
   */
  unregister?(): Promise<void>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Create a KarnaPlugin with type inference.
 */
export function definePlugin(plugin: KarnaPlugin): KarnaPlugin {
  return plugin;
}
