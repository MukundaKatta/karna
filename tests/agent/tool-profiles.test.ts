import { describe, it, expect } from "vitest";
import { getToolProfile, expandToolGroups, TOOL_PROFILES, TOOL_GROUPS } from "../../agent/src/tools/profiles.js";

describe("Tool Profiles", () => {
  it("full profile has no restrictions", () => {
    const profile = getToolProfile("full");
    expect(profile.allowList).toBeUndefined();
    expect(profile.denyList).toBeUndefined();
  });

  it("coding profile includes dev tools", () => {
    const profile = getToolProfile("coding");
    expect(profile.allowList).toContain("shell_exec");
    expect(profile.allowList).toContain("file_read");
    expect(profile.allowList).toContain("file_write");
    expect(profile.allowList).toContain("apply_patch");
    expect(profile.allowList).toContain("code_exec");
  });

  it("messaging profile includes communication tools", () => {
    const profile = getToolProfile("messaging");
    expect(profile.allowList).toContain("message");
    expect(profile.allowList).toContain("email_send");
    expect(profile.allowList).toContain("sessions_send");
    expect(profile.allowList).not.toContain("shell_exec");
  });

  it("minimal profile is read-only", () => {
    const profile = getToolProfile("minimal");
    expect(profile.allowList).toContain("file_read");
    expect(profile.allowList).toContain("memory_search");
    expect(profile.allowList).not.toContain("file_write");
    expect(profile.allowList).not.toContain("shell_exec");
  });

  describe("Tool Groups", () => {
    it("group:fs contains file tools", () => {
      expect(TOOL_GROUPS["group:fs"]).toContain("file_read");
      expect(TOOL_GROUPS["group:fs"]).toContain("file_write");
      expect(TOOL_GROUPS["group:fs"]).toContain("apply_patch");
    });

    it("group:sessions contains session tools", () => {
      expect(TOOL_GROUPS["group:sessions"]).toContain("sessions_list");
      expect(TOOL_GROUPS["group:sessions"]).toContain("sessions_spawn");
      expect(TOOL_GROUPS["group:sessions"]).toContain("session_status");
    });

    it("group:automation contains cron and gateway", () => {
      expect(TOOL_GROUPS["group:automation"]).toContain("cron");
      expect(TOOL_GROUPS["group:automation"]).toContain("gateway_restart");
    });
  });

  describe("expandToolGroups", () => {
    it("expands group references", () => {
      const expanded = expandToolGroups(["group:fs", "web_search"]);
      expect(expanded).toContain("file_read");
      expect(expanded).toContain("file_write");
      expect(expanded).toContain("web_search");
    });

    it("deduplicates", () => {
      const expanded = expandToolGroups(["group:fs", "file_read"]);
      const count = expanded.filter((t) => t === "file_read").length;
      expect(count).toBe(1);
    });

    it("passes through non-group names", () => {
      const expanded = expandToolGroups(["my_custom_tool"]);
      expect(expanded).toEqual(["my_custom_tool"]);
    });
  });
});
