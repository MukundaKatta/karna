// ─── System Info Integration ──────────────────────────────────────────────
//
// Provides Karna with awareness of the user's system state:
// - Battery level, WiFi, Bluetooth, disk space
// - Running processes, active windows
// - Calendar events, current time/timezone
//
// ──────────────────────────────────────────────────────────────────────────

import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import type { ToolResult } from "../../registry.js";

const exec = promisify(execFile);
const TIMEOUT = 10000;

async function run(cmd: string, args: string[]): Promise<string> {
  const { stdout } = await exec(cmd, args, { timeout: TIMEOUT });
  return stdout.trim();
}

export const systemOverview = {
  name: "system_overview",
  description: "Get a comprehensive overview of the system: battery, WiFi, disk, memory, uptime",
  parameters: z.object({}),
  inputSchema: { type: "object" as const, properties: {}, required: [] },
  riskLevel: "low" as const,
  requiresApproval: false,
  tags: ["system", "info"],
  async execute(): Promise<ToolResult> {
    try {
      const sections: string[] = [];

      if (process.platform === "darwin") {
        // Battery
        try {
          const battery = await run("pmset", ["-g", "batt"]);
          const match = battery.match(/(\d+)%;/);
          const charging = battery.includes("charging") || battery.includes("AC Power");
          sections.push(`Battery: ${match?.[1] ?? "unknown"}%${charging ? " (charging)" : ""}`);
        } catch { sections.push("Battery: unavailable"); }

        // WiFi
        try {
          const wifi = await run("/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport", ["-I"]);
          const ssid = wifi.match(/\s+SSID: (.+)/)?.[1] ?? "disconnected";
          sections.push(`WiFi: ${ssid}`);
        } catch { sections.push("WiFi: unavailable"); }

        // Disk
        try {
          const disk = await run("df", ["-h", "/"]);
          const line = disk.split("\n")[1];
          const parts = line?.split(/\s+/);
          sections.push(`Disk: ${parts?.[3] ?? "?"} free of ${parts?.[1] ?? "?"}`);
        } catch { sections.push("Disk: unavailable"); }

        // Memory
        try {
          const mem = await run("sysctl", ["-n", "hw.memsize"]);
          const totalGB = (parseInt(mem) / 1024 / 1024 / 1024).toFixed(0);
          sections.push(`RAM: ${totalGB} GB total`);
        } catch { sections.push("RAM: unavailable"); }

        // Uptime
        try {
          const uptime = await run("uptime", []);
          const uptimeMatch = uptime.match(/up\s+(.+?),\s+\d+ user/);
          sections.push(`Uptime: ${uptimeMatch?.[1] ?? "unknown"}`);
        } catch { sections.push("Uptime: unavailable"); }

        // macOS version
        try {
          const ver = await run("sw_vers", ["-productVersion"]);
          sections.push(`macOS: ${ver}`);
        } catch {}
      }

      sections.push(`Time: ${new Date().toLocaleString()}`);
      sections.push(`Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
      sections.push(`Platform: ${process.platform} ${process.arch}`);
      sections.push(`Node: ${process.version}`);

      return { output: sections.join("\n"), isError: false, durationMs: 0 };
    } catch (err) {
      return { output: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true, durationMs: 0 };
    }
  },
};

export const runningApps = {
  name: "system_running_apps",
  description: "List all currently running applications on macOS",
  parameters: z.object({}),
  inputSchema: { type: "object" as const, properties: {}, required: [] },
  riskLevel: "low" as const,
  requiresApproval: false,
  tags: ["system", "apps"],
  async execute(): Promise<ToolResult> {
    try {
      if (process.platform !== "darwin") {
        return { output: "Only available on macOS", isError: true, durationMs: 0 };
      }
      const result = await run("osascript", [
        "-e",
        'tell application "System Events" to get name of every process whose background only is false',
      ]);
      const apps = result.split(", ").sort();
      return { output: `Running apps (${apps.length}):\n${apps.map((a) => `- ${a}`).join("\n")}`, isError: false, durationMs: 0 };
    } catch (err) {
      return { output: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true, durationMs: 0 };
    }
  },
};

export const activeWindow = {
  name: "system_active_window",
  description: "Get the currently focused/active window and application",
  parameters: z.object({}),
  inputSchema: { type: "object" as const, properties: {}, required: [] },
  riskLevel: "low" as const,
  requiresApproval: false,
  tags: ["system", "window"],
  async execute(): Promise<ToolResult> {
    try {
      if (process.platform !== "darwin") {
        return { output: "Only available on macOS", isError: true, durationMs: 0 };
      }
      const app = await run("osascript", [
        "-e",
        'tell application "System Events" to get name of first application process whose frontmost is true',
      ]);
      let windowTitle = "";
      try {
        windowTitle = await run("osascript", [
          "-e",
          `tell application "System Events" to get name of front window of application process "${app}"`,
        ]);
      } catch {}
      return {
        output: `Active app: ${app}${windowTitle ? `\nWindow: ${windowTitle}` : ""}`,
        isError: false,
        durationMs: 0,
      };
    } catch (err) {
      return { output: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true, durationMs: 0 };
    }
  },
};

export const systemInfoTools = [systemOverview, runningApps, activeWindow];
