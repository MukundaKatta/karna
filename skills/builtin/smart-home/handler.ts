// ─── Smart Home Skill Handler ─────────────────────────────────────────────
//
// Controls smart home devices via the Home Assistant REST API.
// Supports lights, thermostat, locks, cameras, and scene activation.
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
}

// ─── Constants ──────────────────────────────────────────────────────────────

const API_TIMEOUT_MS = 10_000;

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
};

// ─── Handler ────────────────────────────────────────────────────────────────

export class SmartHomeHandler implements SkillHandler {
  private config: HomeAssistantConfig | null = null;

  async initialize(context: SkillContext): Promise<void> {
    logger.info({ sessionId: context.sessionId }, "Smart home skill initialized");

    // Extract Home Assistant config from context
    const haConfig = context.config?.["homeAssistant"] as Record<string, unknown> | undefined;
    if (haConfig?.["url"] && haConfig?.["token"]) {
      this.config = {
        url: (haConfig["url"] as string).replace(/\/$/, ""),
        token: haConfig["token"] as string,
      };
      logger.info({ url: this.config.url }, "Home Assistant configured");
    } else {
      logger.warn("Home Assistant URL and token not configured. Skill will run in stub mode.");
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
        default:
          return {
            success: false,
            output: `Unknown action: ${action}`,
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
    logger.info("Smart home skill disposed");
  }

  // ─── Actions ────────────────────────────────────────────────────────────

  private async controlLights(input: Record<string, unknown>): Promise<SkillResult> {
    const entity = this.resolveEntity(input["entity"] as string, "light");
    const state = (input["state"] as string)?.toLowerCase() ?? "toggle";
    const brightness = input["brightness"] as number | undefined;
    const color = input["color"] as string | undefined;

    if (!entity) {
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

    const service = state === "off" ? "turn_off" : state === "toggle" ? "toggle" : "turn_on";
    const result = await this.callService("light", service, serviceData);

    if (!result.success) return result;

    let message = `Light ${entity}: ${service.replace("turn_", "")}`;
    if (brightness !== undefined) message += ` (brightness: ${brightness})`;
    if (color) message += ` (color: ${color})`;

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
      results.push(`Temperature set to ${temperature}°`);
    }

    if (results.length === 0) {
      return {
        success: false,
        output: "Specify temperature and/or mode for the thermostat.",
        error: "No parameters",
      };
    }

    return {
      success: true,
      output: `Thermostat (${entity}): ${results.join(", ")}`,
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
      return {
        success: false,
        output: "Specify action: lock or unlock.",
        error: "Invalid action",
      };
    }

    const result = await this.callService("lock", action, { entity_id: entity });
    if (!result.success) return result;

    return {
      success: true,
      output: `Lock ${entity}: ${action}ed successfully`,
      data: { entity, action },
    };
  }

  private async getCameraStatus(input: Record<string, unknown>): Promise<SkillResult> {
    const entity = this.resolveEntity(input["entity"] as string, "camera");

    if (!entity) {
      return { success: false, output: "Specify which camera to check.", error: "Missing entity" };
    }

    const state = await this.getEntityState(entity);
    if (!state.success) return state;

    const deviceState = state.data?.["state"] as DeviceState | undefined;
    if (!deviceState) {
      return { success: true, output: `Camera ${entity}: state unknown` };
    }

    const lines = [
      `Camera: ${entity}`,
      `Status: ${deviceState.state}`,
    ];

    if (deviceState.attributes["entity_picture"]) {
      lines.push(`Snapshot: ${this.config?.url}${deviceState.attributes["entity_picture"]}`);
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

    const state = await this.getEntityState(entity);
    if (!state.success) return state;

    return {
      success: true,
      output: `Status for ${entity}: ${JSON.stringify(state.data, null, 2)}`,
      data: state.data,
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
        output: `[Stub] Would call ${domain}.${service} with ${JSON.stringify(data)}. Configure homeAssistant.url and homeAssistant.token to connect.`,
        data: { stub: true, domain, service, data },
      };
    }

    const url = `${this.config.url}/api/services/${domain}/${service}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          { status: response.status, body: errorText, domain, service },
          "Home Assistant API error"
        );
        return {
          success: false,
          output: `Home Assistant returned ${response.status}: ${errorText}`,
          error: `HTTP ${response.status}`,
        };
      }

      const result = (await response.json()) as unknown;
      logger.info({ domain, service, entity: data["entity_id"] }, "HA service called successfully");

      return {
        success: true,
        output: `${domain}.${service} executed successfully`,
        data: result as Record<string, unknown>,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("abort")) {
        return { success: false, output: "Home Assistant API call timed out", error: "Timeout" };
      }
      return { success: false, output: `Failed to reach Home Assistant: ${message}`, error: message };
    }
  }

  private async getEntityState(entityId: string): Promise<SkillResult> {
    if (!this.config) {
      return {
        success: true,
        output: `[Stub] Would get state for ${entityId}. Configure homeAssistant to connect.`,
        data: { stub: true, entityId },
      };
    }

    const url = `${this.config.url}/api/states/${entityId}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return {
          success: false,
          output: `Failed to get state for ${entityId}: HTTP ${response.status}`,
          error: `HTTP ${response.status}`,
        };
      }

      const state = (await response.json()) as DeviceState;
      return {
        success: true,
        output: `${entityId}: ${state.state}`,
        data: { state } as unknown as Record<string, unknown>,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, output: `Failed to reach Home Assistant: ${message}`, error: message };
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

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

    return null;
  }
}

export default SmartHomeHandler;
