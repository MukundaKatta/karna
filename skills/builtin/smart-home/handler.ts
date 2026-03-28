// ─── Smart Home Skill Handler ─────────────────────────────────────────────
//
// Controls smart home devices via the Home Assistant REST API.
// Supports lights, thermostat, locks, cameras, scenes, and device
// discovery. Gracefully degrades when HA is not configured.
//
// ───────────────────────────────────────────────────────────────────────────

import pino from "pino";
import type {
  SkillHandler,
  SkillContext,
  SkillResult,
} from "../../../agent/src/skills/loader.js";

const logger = pino({ name: "skill:smart-home" });

// ─── Types ──────────────────────────────────────────────────────────────────

interface HomeAssistantConfig {
  url: string;
  token: string;
}

interface DeviceState {
  entityId: string;
  state: string;
  attributes: Record<string, unknown>;
  lastChanged: string;
  friendlyName?: string;
}

interface DeviceGroup {
  domain: string;
  entities: DeviceState[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const API_TIMEOUT_MS = 10_000;
const MAX_RETRY_ATTEMPTS = 2;

const COLOR_MAP: Record<string, [number, number, number]> = {
  red: [255, 0, 0],
  green: [0, 255, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  purple: [128, 0, 128],
  orange: [255, 165, 0],
  pink: [255, 192, 203],
  white: [255, 255, 255],
  warm: [255, 180, 107],
  cool: [200, 220, 255],
  cyan: [0, 255, 255],
  magenta: [255, 0, 255],
  lavender: [180, 150, 255],
  coral: [255, 127, 80],
};

const SUPPORTED_DOMAINS = [
  "light", "switch", "climate", "lock", "camera",
  "scene", "automation", "cover", "fan", "media_player",
];

// ─── Handler ────────────────────────────────────────────────────────────────

export class SmartHomeHandler implements SkillHandler {
  private config: HomeAssistantConfig | null = null;
  private deviceCache: Map<string, DeviceState> = new Map();
  private cacheTimestamp = 0;
  private readonly CACHE_TTL_MS = 60_000; // 1 minute

  async initialize(context: SkillContext): Promise<void> {
    logger.info({ sessionId: context.sessionId }, "Smart home skill initialized");

    // Extract Home Assistant config from context or environment
    const haConfig = context.config?.["homeAssistant"] as Record<string, unknown> | undefined;

    const url =
      (haConfig?.["url"] as string) ??
      process.env["HOME_ASSISTANT_URL"] ??
      process.env["HA_URL"];
    const token =
      (haConfig?.["token"] as string) ??
      process.env["HOME_ASSISTANT_TOKEN"] ??
      process.env["HA_TOKEN"];

    if (url && token) {
      this.config = {
        url: url.replace(/\/$/, ""),
        token,
      };
      logger.info({ url: this.config.url }, "Home Assistant configured");

      // Test connectivity
      try {
        const testResult = await this.apiRequest("GET", "/api/");
        if (testResult.success) {
          logger.info("Home Assistant connection verified");
        } else {
          logger.warn("Home Assistant connection test failed, will retry on demand");
        }
      } catch {
        logger.warn("Could not connect to Home Assistant at startup");
      }
    } else {
      logger.warn("Home Assistant URL and/or token not configured. Set HOME_ASSISTANT_URL and HOME_ASSISTANT_TOKEN env vars, or configure homeAssistant in agent config.");
    }
  }

  async execute(
    action: string,
    input: Record<string, unknown>,
    context: SkillContext
  ): Promise<SkillResult> {
    logger.debug({ action, sessionId: context.sessionId }, "Executing smart home action");

    try {
      switch (action) {
        case "lights":
          return this.controlLights(input);
        case "thermostat":
          return this.controlThermostat(input);
        case "lock":
          return this.controlLock(input);
        case "camera":
          return this.getCameraStatus(input);
        case "scene":
          return this.activateScene(input);
        case "status":
          return this.getStatus(input);
        case "devices":
        case "list":
          return this.listDevices(input);
        case "toggle":
          return this.toggleEntity(input);
        default:
          return {
            success: false,
            output: `Unknown action: ${action}. Available: lights, thermostat, lock, camera, scene, status, devices, toggle`,
            error: `Action "${action}" is not supported`,
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message, action }, "Smart home action failed");
      return { success: false, output: `Failed: ${message}`, error: message };
    }
  }

  async dispose(): Promise<void> {
    this.config = null;
    this.deviceCache.clear();
    logger.info("Smart home skill disposed");
  }

  // ─── Actions ────────────────────────────────────────────────────────────

  private async controlLights(input: Record<string, unknown>): Promise<SkillResult> {
    const entity = this.resolveEntity(input["entity"] as string, "light");
    const state = (input["state"] as string)?.toLowerCase() ?? "toggle";
    const brightness = input["brightness"] as number | undefined;
    const color = input["color"] as string | undefined;
    const transition = input["transition"] as number | undefined;

    if (!entity) {
      // If no entity specified, try to list available lights
      const devices = await this.listDomainEntities("light");
      if (devices.length > 0) {
        const names = devices.map((d) => `  - ${d.entityId} (${d.friendlyName ?? d.state})`);
        return {
          success: false,
          output: `Specify which light to control. Available lights:\n${names.join("\n")}`,
          error: "Missing entity",
        };
      }
      return { success: false, output: "Specify which light to control.", error: "Missing entity" };
    }

    const serviceData: Record<string, unknown> = { entity_id: entity };

    if (brightness !== undefined) {
      serviceData["brightness"] = Math.max(0, Math.min(255, brightness));
    }

    if (color) {
      const rgb = this.parseColor(color);
      if (rgb) {
        serviceData["rgb_color"] = rgb;
      }
    }

    if (transition !== undefined) {
      serviceData["transition"] = Math.max(0, Math.min(300, transition));
    }

    const service = state === "off" ? "turn_off" : state === "toggle" ? "toggle" : "turn_on";
    const result = await this.callService("light", service, serviceData);

    if (!result.success) return result;

    let message = `Light ${this.friendlyName(entity)}: ${service.replace("turn_", "")}`;
    if (brightness !== undefined) message += ` (brightness: ${brightness})`;
    if (color) message += ` (color: ${color})`;
    if (transition !== undefined) message += ` (transition: ${transition}s)`;

    return {
      success: true,
      output: message,
      data: { entity, service, serviceData },
    };
  }

  private async controlThermostat(input: Record<string, unknown>): Promise<SkillResult> {
    const temperature = input["temperature"] as number | undefined;
    const mode = (input["mode"] as string)?.toLowerCase();
    const entity = this.resolveEntity(input["entity"] as string, "climate") ?? "climate.thermostat";

    const results: string[] = [];

    if (mode) {
      const validModes = ["heat", "cool", "auto", "off", "fan_only", "dry"];
      if (!validModes.includes(mode)) {
        return {
          success: false,
          output: `Invalid mode "${mode}". Valid modes: ${validModes.join(", ")}`,
          error: "Invalid mode",
        };
      }

      const result = await this.callService("climate", "set_hvac_mode", {
        entity_id: entity,
        hvac_mode: mode,
      });
      if (!result.success) return result;
      results.push(`Mode set to ${mode}`);
    }

    if (temperature !== undefined) {
      if (temperature < 10 || temperature > 35) {
        return {
          success: false,
          output: `Temperature ${temperature} is out of safe range (10-35). Adjust manually if needed.`,
          error: "Out of range",
        };
      }

      const result = await this.callService("climate", "set_temperature", {
        entity_id: entity,
        temperature,
      });
      if (!result.success) return result;
      results.push(`Temperature set to ${temperature} degrees`);
    }

    if (results.length === 0) {
      // Show current thermostat state
      const state = await this.getEntityState(entity);
      if (state.success && state.data) {
        const ds = state.data["state"] as DeviceState | undefined;
        if (ds) {
          const currentTemp = ds.attributes["current_temperature"] ?? "?";
          const targetTemp = ds.attributes["temperature"] ?? "?";
          const hvacMode = ds.state;
          return {
            success: true,
            output: `Thermostat (${this.friendlyName(entity)}): ${hvacMode}\n  Current: ${currentTemp} degrees | Target: ${targetTemp} degrees`,
            data: { entity, state: ds } as unknown as Record<string, unknown>,
          };
        }
      }
      return {
        success: false,
        output: "Specify temperature and/or mode for the thermostat.",
        error: "No parameters",
      };
    }

    return {
      success: true,
      output: `Thermostat (${this.friendlyName(entity)}): ${results.join(", ")}`,
      data: { entity, temperature, mode },
    };
  }

  private async controlLock(input: Record<string, unknown>): Promise<SkillResult> {
    const entity = this.resolveEntity(input["entity"] as string, "lock");
    const action = (input["action"] as string)?.toLowerCase();

    if (!entity) {
      return { success: false, output: "Specify which lock to control.", error: "Missing entity" };
    }

    if (action !== "lock" && action !== "unlock") {
      // Show current state
      const state = await this.getEntityState(entity);
      if (state.success) {
        return {
          success: true,
          output: `Lock ${this.friendlyName(entity)}: currently ${(state.data?.["state"] as DeviceState)?.state ?? "unknown"}. Specify action: lock or unlock.`,
          data: state.data,
        };
      }
      return {
        success: false,
        output: "Specify action: lock or unlock.",
        error: "Invalid action",
      };
    }

    logger.info({ entity, action }, "Lock control requested (high-risk action)");

    const result = await this.callService("lock", action, { entity_id: entity });
    if (!result.success) return result;

    return {
      success: true,
      output: `Lock ${this.friendlyName(entity)}: ${action}ed successfully`,
      data: { entity, action },
    };
  }

  private async getCameraStatus(input: Record<string, unknown>): Promise<SkillResult> {
    const entity = this.resolveEntity(input["entity"] as string, "camera");

    if (!entity) {
      const cameras = await this.listDomainEntities("camera");
      if (cameras.length > 0) {
        const lines = cameras.map(
          (c) => `- ${c.friendlyName ?? c.entityId}: ${c.state}`
        );
        return {
          success: true,
          output: `Available cameras:\n${lines.join("\n")}`,
          data: { cameras } as unknown as Record<string, unknown>,
        };
      }
      return { success: false, output: "Specify which camera to check.", error: "Missing entity" };
    }

    const state = await this.getEntityState(entity);
    if (!state.success) return state;

    const deviceState = state.data?.["state"] as DeviceState | undefined;
    if (!deviceState) {
      return { success: true, output: `Camera ${this.friendlyName(entity)}: state unknown` };
    }

    const lines = [
      `Camera: ${deviceState.friendlyName ?? entity}`,
      `Status: ${deviceState.state}`,
    ];

    if (deviceState.attributes["entity_picture"]) {
      lines.push(`Snapshot: ${this.config?.url}${deviceState.attributes["entity_picture"]}`);
    }
    if (deviceState.attributes["motion_detection"]) {
      lines.push(`Motion detection: ${deviceState.attributes["motion_detection"]}`);
    }
    if (deviceState.attributes["brand"]) {
      lines.push(`Brand: ${deviceState.attributes["brand"]}`);
    }

    return {
      success: true,
      output: lines.join("\n"),
      data: { entity, state: deviceState } as unknown as Record<string, unknown>,
    };
  }

  private async activateScene(input: Record<string, unknown>): Promise<SkillResult> {
    const name = (input["name"] as string) ?? "";
    if (!name) {
      // List available scenes
      const scenes = await this.listDomainEntities("scene");
      if (scenes.length > 0) {
        const names = scenes.map((s) => `  - ${s.friendlyName ?? s.entityId}`);
        return {
          success: false,
          output: `Specify a scene name. Available scenes:\n${names.join("\n")}`,
          error: "Missing scene",
        };
      }
      return { success: false, output: "Specify a scene name to activate.", error: "Missing scene" };
    }

    const entity = `scene.${name.toLowerCase().replace(/\s+/g, "_")}`;
    const result = await this.callService("scene", "turn_on", { entity_id: entity });

    if (!result.success) return result;

    return {
      success: true,
      output: `Scene "${name}" activated (${entity})`,
      data: { entity, name },
    };
  }

  private async getStatus(input: Record<string, unknown>): Promise<SkillResult> {
    const entity = input["entity"] as string;
    if (!entity) {
      return { success: false, output: "Specify an entity or area to check status.", error: "Missing entity" };
    }

    // Resolve the entity if it's a short name
    const resolved = entity.includes(".") ? entity : null;
    if (!resolved) {
      // Search across domains
      const matches = await this.searchEntities(entity);
      if (matches.length === 0) {
        return { success: false, output: `No devices found matching "${entity}".`, error: "Not found" };
      }
      if (matches.length === 1) {
        const state = await this.getEntityState(matches[0]!.entityId);
        return state;
      }

      const lines = matches.map(
        (m) => `- ${m.entityId}: ${m.state} (${m.friendlyName ?? ""})`
      );
      return {
        success: true,
        output: `Multiple devices found for "${entity}":\n${lines.join("\n")}`,
        data: { matches } as unknown as Record<string, unknown>,
      };
    }

    const state = await this.getEntityState(resolved);
    if (!state.success) return state;

    const ds = state.data?.["state"] as DeviceState | undefined;
    if (ds) {
      const attrLines = Object.entries(ds.attributes)
        .filter(([k]) => !k.startsWith("_"))
        .slice(0, 10)
        .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`);

      return {
        success: true,
        output: `${ds.friendlyName ?? resolved}: ${ds.state}\n${attrLines.join("\n")}`,
        data: state.data,
      };
    }

    return state;
  }

  private async listDevices(input: Record<string, unknown>): Promise<SkillResult> {
    const domain = input["domain"] as string | undefined;

    if (!this.config) {
      return {
        success: true,
        output: "Home Assistant is not configured. Set HOME_ASSISTANT_URL and HOME_ASSISTANT_TOKEN environment variables to connect.",
        data: { configured: false },
      };
    }

    const result = await this.apiRequest("GET", "/api/states");
    if (!result.success) return result;

    const states = result.data as DeviceState[] | undefined;
    if (!Array.isArray(states)) {
      return { success: true, output: "No devices found.", data: { devices: [] } };
    }

    // Group by domain
    const groups = new Map<string, DeviceState[]>();
    for (const state of states) {
      const entityId = (state as unknown as Record<string, unknown>)["entity_id"] as string ?? "";
      const entityDomain = entityId.split(".")[0] ?? "";

      if (domain && entityDomain !== domain) continue;
      if (!SUPPORTED_DOMAINS.includes(entityDomain)) continue;

      const ds: DeviceState = {
        entityId,
        state: (state as unknown as Record<string, unknown>)["state"] as string ?? "unknown",
        attributes: (state as unknown as Record<string, unknown>)["attributes"] as Record<string, unknown> ?? {},
        lastChanged: (state as unknown as Record<string, unknown>)["last_changed"] as string ?? "",
        friendlyName: ((state as unknown as Record<string, unknown>)["attributes"] as Record<string, unknown>)?.["friendly_name"] as string,
      };

      const group = groups.get(entityDomain) ?? [];
      group.push(ds);
      groups.set(entityDomain, group);
    }

    if (groups.size === 0) {
      return { success: true, output: domain ? `No ${domain} devices found.` : "No supported devices found." };
    }

    const lines: string[] = [`Smart Home Devices`, `${"=".repeat(50)}`, ""];

    for (const [dom, devices] of [...groups.entries()].sort()) {
      lines.push(`**${dom}** (${devices.length})`);
      for (const device of devices.slice(0, 20)) {
        const name = device.friendlyName ?? device.entityId;
        lines.push(`  - ${name}: ${device.state} (${device.entityId})`);
      }
      if (devices.length > 20) {
        lines.push(`  ... and ${devices.length - 20} more`);
      }
      lines.push("");
    }

    const totalCount = [...groups.values()].reduce((s, g) => s + g.length, 0);
    lines.push(`Total: ${totalCount} devices across ${groups.size} categories`);

    return {
      success: true,
      output: lines.join("\n"),
      data: { groups: Object.fromEntries([...groups.entries()].map(([k, v]) => [k, v.length])), totalCount },
    };
  }

  private async toggleEntity(input: Record<string, unknown>): Promise<SkillResult> {
    const entityId = input["entity"] as string;
    if (!entityId) {
      return { success: false, output: "Specify an entity to toggle.", error: "Missing entity" };
    }

    const resolved = entityId.includes(".") ? entityId : this.resolveEntity(entityId, "switch");
    if (!resolved) {
      return { success: false, output: "Could not resolve entity.", error: "Invalid entity" };
    }

    const domain = resolved.split(".")[0] ?? "switch";
    const result = await this.callService(domain, "toggle", { entity_id: resolved });

    if (!result.success) return result;

    return {
      success: true,
      output: `Toggled ${this.friendlyName(resolved)}`,
      data: { entity: resolved },
    };
  }

  // ─── Home Assistant API ────────────────────────────────────────────────

  private async callService(
    domain: string,
    service: string,
    data: Record<string, unknown>
  ): Promise<SkillResult> {
    if (!this.config) {
      logger.debug({ domain, service, data }, "Stub: would call HA service");
      return {
        success: true,
        output: `[Stub] Would call ${domain}.${service} with ${JSON.stringify(data)}. Configure HOME_ASSISTANT_URL and HOME_ASSISTANT_TOKEN to connect.`,
        data: { stub: true, domain, service, data },
      };
    }

    return this.apiRequest("POST", `/api/services/${domain}/${service}`, data);
  }

  private async getEntityState(entityId: string): Promise<SkillResult> {
    if (!this.config) {
      return {
        success: true,
        output: `[Stub] Would get state for ${entityId}. Configure Home Assistant to connect.`,
        data: { stub: true, entityId },
      };
    }

    // Check cache
    if (Date.now() - this.cacheTimestamp < this.CACHE_TTL_MS) {
      const cached = this.deviceCache.get(entityId);
      if (cached) {
        return {
          success: true,
          output: `${cached.friendlyName ?? entityId}: ${cached.state}`,
          data: { state: cached } as unknown as Record<string, unknown>,
        };
      }
    }

    const result = await this.apiRequest("GET", `/api/states/${entityId}`);
    if (!result.success) return result;

    const raw = result.data as Record<string, unknown> | undefined;
    if (!raw) return result;

    const state: DeviceState = {
      entityId,
      state: (raw["state"] as string) ?? "unknown",
      attributes: (raw["attributes"] as Record<string, unknown>) ?? {},
      lastChanged: (raw["last_changed"] as string) ?? "",
      friendlyName: ((raw["attributes"] as Record<string, unknown>)?.["friendly_name"] as string) ?? undefined,
    };

    // Update cache
    this.deviceCache.set(entityId, state);
    this.cacheTimestamp = Date.now();

    return {
      success: true,
      output: `${state.friendlyName ?? entityId}: ${state.state}`,
      data: { state } as unknown as Record<string, unknown>,
    };
  }

  private async apiRequest(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    attempt = 1
  ): Promise<SkillResult> {
    if (!this.config) {
      return {
        success: false,
        output: "Home Assistant is not configured.",
        error: "Not configured",
      };
    }

    const url = `${this.config.url}${path}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

      const options: RequestInit = {
        method,
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      };

      if (body && method !== "GET") {
        options.body = JSON.stringify(body);
      }

      const response = await fetch(url, options);
      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        logger.error(
          { status: response.status, body: errorText, path },
          "Home Assistant API error"
        );

        // Retry on 5xx errors
        if (response.status >= 500 && attempt < MAX_RETRY_ATTEMPTS) {
          logger.debug({ attempt }, "Retrying HA API request");
          return this.apiRequest(method, path, body, attempt + 1);
        }

        return {
          success: false,
          output: `Home Assistant returned ${response.status}: ${errorText.slice(0, 200)}`,
          error: `HTTP ${response.status}`,
        };
      }

      const result = (await response.json()) as unknown;
      logger.debug({ method, path }, "HA API call successful");

      return {
        success: true,
        output: `${method} ${path} succeeded`,
        data: result as Record<string, unknown>,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes("abort")) {
        return { success: false, output: "Home Assistant API call timed out", error: "Timeout" };
      }

      // Retry on network errors
      if (attempt < MAX_RETRY_ATTEMPTS) {
        logger.debug({ attempt, error: message }, "Retrying HA API request after network error");
        return this.apiRequest(method, path, body, attempt + 1);
      }

      return { success: false, output: `Failed to reach Home Assistant: ${message}`, error: message };
    }
  }

  // ─── Entity Helpers ───────────────────────────────────────────────────

  private async listDomainEntities(domain: string): Promise<DeviceState[]> {
    if (!this.config) return [];

    const result = await this.apiRequest("GET", "/api/states");
    if (!result.success || !Array.isArray(result.data)) return [];

    return (result.data as Array<Record<string, unknown>>)
      .filter((s) => {
        const eid = (s["entity_id"] as string) ?? "";
        return eid.startsWith(`${domain}.`);
      })
      .map((s) => ({
        entityId: (s["entity_id"] as string) ?? "",
        state: (s["state"] as string) ?? "unknown",
        attributes: (s["attributes"] as Record<string, unknown>) ?? {},
        lastChanged: (s["last_changed"] as string) ?? "",
        friendlyName: ((s["attributes"] as Record<string, unknown>)?.["friendly_name"] as string) ?? undefined,
      }));
  }

  private async searchEntities(query: string): Promise<DeviceState[]> {
    if (!this.config) return [];

    const result = await this.apiRequest("GET", "/api/states");
    if (!result.success || !Array.isArray(result.data)) return [];

    const lower = query.toLowerCase();
    return (result.data as Array<Record<string, unknown>>)
      .filter((s) => {
        const eid = ((s["entity_id"] as string) ?? "").toLowerCase();
        const fname = (((s["attributes"] as Record<string, unknown>)?.["friendly_name"] as string) ?? "").toLowerCase();
        return eid.includes(lower) || fname.includes(lower);
      })
      .slice(0, 10)
      .map((s) => ({
        entityId: (s["entity_id"] as string) ?? "",
        state: (s["state"] as string) ?? "unknown",
        attributes: (s["attributes"] as Record<string, unknown>) ?? {},
        lastChanged: (s["last_changed"] as string) ?? "",
        friendlyName: ((s["attributes"] as Record<string, unknown>)?.["friendly_name"] as string) ?? undefined,
      }));
  }

  private resolveEntity(name: string | undefined, domain: string): string | null {
    if (!name) return null;

    // If already a full entity ID, return as-is
    if (name.includes(".")) return name;

    // Normalize: "living room lights" -> "light.living_room_lights"
    const normalized = name
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "");

    return `${domain}.${normalized}`;
  }

  private friendlyName(entityId: string): string {
    const cached = this.deviceCache.get(entityId);
    if (cached?.friendlyName) return cached.friendlyName;
    // Convert entity_id to readable name: light.living_room -> Living Room
    const name = entityId.split(".")[1] ?? entityId;
    return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  private parseColor(color: string): [number, number, number] | null {
    const lower = color.toLowerCase().trim();

    // Named color
    if (COLOR_MAP[lower]) {
      return COLOR_MAP[lower]!;
    }

    // Hex color
    const hexMatch = color.match(/^#?([0-9a-f]{6})$/i);
    if (hexMatch) {
      const hex = hexMatch[1]!;
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ];
    }

    // RGB format: "255, 0, 128" or "rgb(255, 0, 128)"
    const rgbMatch = color.match(/(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/);
    if (rgbMatch) {
      return [
        Math.min(255, parseInt(rgbMatch[1]!, 10)),
        Math.min(255, parseInt(rgbMatch[2]!, 10)),
        Math.min(255, parseInt(rgbMatch[3]!, 10)),
      ];
    }

    return null;
  }
}

export default SmartHomeHandler;
