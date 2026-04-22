import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const KARNA_ROOT = resolve(TESTS_DIR, "../..");

const CHANNELS = [
  "telegram",
  "discord",
  "slack",
  "whatsapp",
  "sms",
  "imessage",
  "webchat",
  "signal",
  "google-chat",
  "teams",
  "matrix",
  "irc",
  "line",
];

describe("Channel Adapters — Structure & Protocol Compliance", () => {
  for (const channel of CHANNELS) {
    describe(channel, () => {
      const dir = join(KARNA_ROOT, "channels", channel);
      const adapterPath =
        channel === "webchat"
          ? join(dir, "src", "server.ts")
          : join(dir, "src", "adapter.ts");

      it("has package.json", () => {
        expect(existsSync(join(dir, "package.json"))).toBe(true);
      });

      it("has adapter source file", () => {
        expect(existsSync(adapterPath)).toBe(true);
      });

      it("package.json has correct name", () => {
        const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
        expect(pkg.name).toBe(`@karna/channel-${channel}`);
      });

      it("package.json has build script", () => {
        const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
        expect(pkg.scripts?.build).toBeDefined();
      });

      it("adapter imports WebSocket", () => {
        const src = readFileSync(adapterPath, "utf-8");
        expect(src).toMatch(/import\s+.*WebSocket/);
      });

      it("adapter has gateway connection logic", () => {
        const src = readFileSync(adapterPath, "utf-8");
        expect(src).toMatch(/connectToGateway|gatewayUrl|gateway/i);
      });

      it("adapter handles connect message type", () => {
        const src = readFileSync(adapterPath, "utf-8");
        expect(src).toMatch(/["']connect["']|connect\.ack|type.*connect/);
      });

      it("adapter handles chat.message", () => {
        const src = readFileSync(adapterPath, "utf-8");
        expect(src).toMatch(/chat\.message/);
      });

      it("adapter handles agent.response", () => {
        const src = readFileSync(adapterPath, "utf-8");
        expect(src).toMatch(/agent\.response/);
      });

      it("adapter handles heartbeat", () => {
        const src = readFileSync(adapterPath, "utf-8");
        expect(src).toMatch(/heartbeat/);
      });

      it("adapter has reconnection logic", () => {
        const src = readFileSync(adapterPath, "utf-8");
        expect(src).toMatch(/reconnect|backoff|retry/i);
      });

      it("adapter has start() method", () => {
        const src = readFileSync(adapterPath, "utf-8");
        expect(src).toMatch(/async\s+start\s*\(/);
      });

      it("adapter has stop() method", () => {
        const src = readFileSync(adapterPath, "utf-8");
        expect(src).toMatch(/async\s+stop\s*\(|stop\s*\(/);
      });

      it("adapter has session management", () => {
        const src = readFileSync(adapterPath, "utf-8");
        expect(src).toMatch(/sessionId|session|Map.*string.*string/);
      });

      it("adapter has error handling", () => {
        const src = readFileSync(adapterPath, "utf-8");
        expect(src).toMatch(/catch|\.error\(|on\s*\(\s*["']error/);
      });

      it("adapter uses pino logger", () => {
        const src = readFileSync(adapterPath, "utf-8");
        expect(src).toMatch(/pino|logger/i);
      });
    });
  }

  describe("Cross-channel consistency", () => {
    it("all channels have consistent protocol message handling", () => {
      const requiredMessages = [
        "connect",
        "chat.message",
        "agent.response",
        "heartbeat",
      ];

      for (const channel of CHANNELS) {
        const adapterPath =
          channel === "webchat"
            ? join(KARNA_ROOT, "channels", channel, "src", "server.ts")
            : join(KARNA_ROOT, "channels", channel, "src", "adapter.ts");
        const src = readFileSync(adapterPath, "utf-8");

        for (const msg of requiredMessages) {
          expect(
            src.includes(msg),
            `${channel} missing protocol message: ${msg}`,
          ).toBe(true);
        }
      }
    });

    it("all channels handle stream responses", () => {
      for (const channel of CHANNELS) {
        const adapterPath =
          channel === "webchat"
            ? join(KARNA_ROOT, "channels", channel, "src", "server.ts")
            : join(KARNA_ROOT, "channels", channel, "src", "adapter.ts");
        const src = readFileSync(adapterPath, "utf-8");

        expect(
          src.match(/stream|chunk|partial|pending/i),
          `${channel} should handle streaming responses`,
        ).toBeTruthy();
      }
    });

    it("all channels include a client session id in connect messages", () => {
      for (const channel of CHANNELS) {
        const adapterPath =
          channel === "webchat"
            ? join(KARNA_ROOT, "channels", channel, "src", "server.ts")
            : join(KARNA_ROOT, "channels", channel, "src", "adapter.ts");
        const src = readFileSync(adapterPath, "utf-8");

        expect(
          src.match(/type:\s*["']connect["'][\s\S]{0,200}sessionId/),
          `${channel} should preserve adapter session ids during connect`,
        ).toBeTruthy();
      }
    });

    it("all channels can re-register active sessions after reconnect", () => {
      for (const channel of CHANNELS) {
        const adapterPath =
          channel === "webchat"
            ? join(KARNA_ROOT, "channels", channel, "src", "server.ts")
            : join(KARNA_ROOT, "channels", channel, "src", "adapter.ts");
        const src = readFileSync(adapterPath, "utf-8");

        expect(
          src.match(/reregister/i),
          `${channel} should restore active sessions when the gateway reconnects`,
        ).toBeTruthy();
      }
    });
  });
});

describe("New Channel Adapters — Feature Specifics", () => {
  describe("Signal adapter", () => {
    const src = readFileSync(
      join(KARNA_ROOT, "channels/signal/src/adapter.ts"),
      "utf-8",
    );

    it("uses signal-cli REST API", () => {
      expect(src).toMatch(/signal-cli|api\/v1|receive/i);
    });

    it("handles phone number session mapping", () => {
      expect(src).toMatch(/phone|number|sourceNumber/i);
    });
  });

  describe("Google Chat adapter", () => {
    const src = readFileSync(
      join(KARNA_ROOT, "channels/google-chat/src/adapter.ts"),
      "utf-8",
    );

    it("uses Google Chat API", () => {
      expect(src).toMatch(/googleapis|chat\.googleapis|serviceAccount/i);
    });

    it("handles webhook events", () => {
      expect(src).toMatch(/MESSAGE|ADDED_TO_SPACE|webhook/i);
    });
  });

  describe("Teams adapter", () => {
    const src = readFileSync(
      join(KARNA_ROOT, "channels/teams/src/adapter.ts"),
      "utf-8",
    );

    it("uses Bot Framework", () => {
      expect(src).toMatch(/botframework|Bot Framework|microsoft/i);
    });

    it("handles OAuth2 authentication", () => {
      expect(src).toMatch(/oauth2|token|appId|appPassword/i);
    });

    it("supports typing indicators", () => {
      expect(src).toMatch(/typing/i);
    });
  });

  describe("Matrix adapter", () => {
    const src = readFileSync(
      join(KARNA_ROOT, "channels/matrix/src/adapter.ts"),
      "utf-8",
    );

    it("uses Matrix protocol", () => {
      expect(src).toMatch(/matrix|homeserver|m\.room\.message/i);
    });

    it("supports room sync", () => {
      expect(src).toMatch(/sync|rooms/i);
    });

    it("auto-joins on invite", () => {
      expect(src).toMatch(/invite|join/i);
    });
  });

  describe("IRC adapter", () => {
    const src = readFileSync(
      join(KARNA_ROOT, "channels/irc/src/adapter.ts"),
      "utf-8",
    );

    it("handles IRC protocol", () => {
      expect(src).toMatch(/PRIVMSG|PING|PONG|JOIN|NICK/i);
    });

    it("handles message length limits", () => {
      expect(src).toMatch(/400|450|split|length/i);
    });

    it("supports TLS", () => {
      expect(src).toMatch(/tls|TLS|ssl/i);
    });
  });

  describe("LINE adapter", () => {
    const src = readFileSync(
      join(KARNA_ROOT, "channels/line/src/adapter.ts"),
      "utf-8",
    );

    it("uses LINE API", () => {
      expect(src).toMatch(/line|LINE|api\.line\.me|replyToken/i);
    });

    it("validates webhook signatures", () => {
      expect(src).toMatch(/HMAC|signature|verify|channelSecret/i);
    });

    it("handles message length limit", () => {
      expect(src).toMatch(/5000|truncat|limit/i);
    });
  });
});
