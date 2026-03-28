// ─── Spotify Control Tools ────────────────────────────────────────────────
//
// Uses AppleScript (osascript) to control the Spotify desktop app on macOS.
// Falls back to a helpful error on non-macOS platforms.

import { execFile } from "node:child_process";
import { z } from "zod";
import type { ToolDefinitionRuntime, ToolExecutionContext } from "../../registry.js";

const TIMEOUT_MS = 10_000;

// ─── Helpers ──────────────────────────────────────────────────────────────

function runOsascript(script: string): Promise<{ output: string; isError: boolean }> {
  if (process.platform !== "darwin") {
    return Promise.resolve({
      output: "Spotify control via AppleScript is only available on macOS.",
      isError: true,
    });
  }

  return new Promise((resolve) => {
    execFile(
      "osascript",
      ["-e", script],
      { timeout: TIMEOUT_MS },
      (error, stdout, stderr) => {
        if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
          resolve({ output: "osascript is not available.", isError: true });
          return;
        }
        if (error?.killed) {
          resolve({ output: `AppleScript timed out after ${TIMEOUT_MS}ms`, isError: true });
          return;
        }
        const err = (stderr || "").trim();
        if (error) {
          // Common: Spotify not running
          if (err.includes("not running") || err.includes("not opened")) {
            resolve({
              output: "Spotify is not running. Please open Spotify first.",
              isError: true,
            });
            return;
          }
          resolve({ output: err || `osascript failed with code ${(error as any).code}`, isError: true });
          return;
        }
        resolve({ output: (stdout || "").trim() || "(no output)", isError: false });
      }
    );
  });
}

// ─── spotify_now_playing ──────────────────────────────────────────────────

export const spotifyNowPlayingTool: ToolDefinitionRuntime = {
  name: "spotify_now_playing",
  description:
    "Get the currently playing track in Spotify (macOS only). " +
    "Returns track name, artist, album, and playback state.",
  parameters: {
    type: "object",
    properties: {},
  },
  riskLevel: "low",
  requiresApproval: false,
  timeout: TIMEOUT_MS,
  tags: ["integration", "spotify", "media"],

  async execute() {
    const script = `
      tell application "System Events"
        if not (exists process "Spotify") then
          return "Spotify is not running."
        end if
      end tell
      tell application "Spotify"
        set trackName to name of current track
        set trackArtist to artist of current track
        set trackAlbum to album of current track
        set trackDuration to duration of current track
        set playerPos to player position
        set playerState to player state as string
        set trackUrl to spotify url of current track
        return "{\\"track\\": \\"" & trackName & "\\", \\"artist\\": \\"" & trackArtist & "\\", \\"album\\": \\"" & trackAlbum & "\\", \\"state\\": \\"" & playerState & "\\", \\"position\\": " & (round playerPos) & ", \\"duration\\": " & (round (trackDuration / 1000)) & ", \\"url\\": \\"" & trackUrl & "\\"}"
      end tell
    `;
    return runOsascript(script);
  },
};

// ─── spotify_play_pause ───────────────────────────────────────────────────

export const spotifyPlayPauseTool: ToolDefinitionRuntime = {
  name: "spotify_play_pause",
  description: "Toggle play/pause in Spotify (macOS only).",
  parameters: {
    type: "object",
    properties: {},
  },
  riskLevel: "low",
  requiresApproval: false,
  timeout: TIMEOUT_MS,
  tags: ["integration", "spotify", "media"],

  async execute() {
    const script = `
      tell application "System Events"
        if not (exists process "Spotify") then
          return "Spotify is not running."
        end if
      end tell
      tell application "Spotify"
        playpause
        set s to player state as string
        return "Playback state: " & s
      end tell
    `;
    return runOsascript(script);
  },
};

// ─── spotify_next ─────────────────────────────────────────────────────────

export const spotifyNextTool: ToolDefinitionRuntime = {
  name: "spotify_next",
  description: "Skip to the next track in Spotify (macOS only).",
  parameters: {
    type: "object",
    properties: {},
  },
  riskLevel: "low",
  requiresApproval: false,
  timeout: TIMEOUT_MS,
  tags: ["integration", "spotify", "media"],

  async execute() {
    const script = `
      tell application "System Events"
        if not (exists process "Spotify") then
          return "Spotify is not running."
        end if
      end tell
      tell application "Spotify"
        next track
        delay 0.5
        set trackName to name of current track
        set trackArtist to artist of current track
        return "Now playing: " & trackName & " by " & trackArtist
      end tell
    `;
    return runOsascript(script);
  },
};

// ─── spotify_search_play ──────────────────────────────────────────────────

const SearchPlaySchema = z.object({
  query: z
    .string()
    .min(1)
    .describe("Song name, artist, or search query to play"),
  type: z
    .enum(["track", "album", "artist", "playlist"])
    .optional()
    .default("track")
    .describe("Type of content to search for (default: track)"),
});

export const spotifySearchPlayTool: ToolDefinitionRuntime = {
  name: "spotify_search_play",
  description:
    "Search for a song/album/artist/playlist on Spotify and play it (macOS only). " +
    "Uses Spotify's URI scheme to trigger search-and-play.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      type: {
        type: "string",
        enum: ["track", "album", "artist", "playlist"],
        description: "Content type (default: track)",
      },
    },
    required: ["query"],
  },
  inputSchema: SearchPlaySchema,
  riskLevel: "medium",
  requiresApproval: true,
  timeout: TIMEOUT_MS,
  tags: ["integration", "spotify", "media"],

  async execute(input) {
    const p = SearchPlaySchema.parse(input);
    const searchType = p.type ?? "track";
    const encodedQuery = encodeURIComponent(p.query);

    // Use Spotify's URI search to find and play content
    const script = `
      tell application "System Events"
        if not (exists process "Spotify") then
          tell application "Spotify" to activate
          delay 2
        end if
      end tell
      open location "spotify:search:${encodedQuery}"
      delay 1.5
      tell application "Spotify"
        set s to player state as string
        if s is not "playing" then
          play
        end if
        delay 1
        set trackName to name of current track
        set trackArtist to artist of current track
        return "Searching for '${p.query.replace(/'/g, "\\'")}' and playing: " & trackName & " by " & trackArtist
      end tell
    `;
    return runOsascript(script);
  },
};

// ─── Collected exports ────────────────────────────────────────────────────

export const spotifyTools: ToolDefinitionRuntime[] = [
  spotifyNowPlayingTool,
  spotifyPlayPauseTool,
  spotifyNextTool,
  spotifySearchPlayTool,
];
