/**
 * Gateway MCP module (#544).
 *
 * Exposes selected karna tools as an MCP server. This module is additive and
 * does not alter default gateway startup — mount {@link McpServer} explicitly
 * (e.g. on an HTTP route) only when `McpExposeConfig.enabled` is true.
 */
export * from './server.js';

// Client-side MCP modules (#543, #545, #546, #553) — additive, transport-agnostic.
export * from './client-core.js';
export * from './registry-bridge.js';
export * from './health.js';
