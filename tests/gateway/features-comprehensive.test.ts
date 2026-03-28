import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const KARNA_ROOT = "/Users/ubl/karna";

/**
 * Comprehensive feature verification test suite.
 * Validates that all OpenClaw-equivalent features exist in Karna.
 */

describe("OpenClaw Feature Parity — Comprehensive Verification", () => {
  describe("1. Gateway Control Plane", () => {
    it("gateway index.ts exists with Fastify server", () => {
      const src = readFileSync(join(KARNA_ROOT, "gateway/src/index.ts"), "utf-8");
      expect(src).toMatch(/fastify/i);
      expect(src).toMatch(/WebSocket|ws/);
    });

    it("has /health endpoint", () => {
      const src = readFileSync(join(KARNA_ROOT, "gateway/src/index.ts"), "utf-8");
      expect(src).toMatch(/\/health/);
    });

    it("has /metrics endpoint", () => {
      const src = readFileSync(join(KARNA_ROOT, "gateway/src/index.ts"), "utf-8");
      expect(src).toMatch(/\/metrics/);
    });

    it("has WebSocket route", () => {
      const src = readFileSync(join(KARNA_ROOT, "gateway/src/index.ts"), "utf-8");
      expect(src).toMatch(/\/ws/);
    });

    it("has graceful shutdown", () => {
      const src = readFileSync(join(KARNA_ROOT, "gateway/src/index.ts"), "utf-8");
      expect(src).toMatch(/SIGTERM|SIGINT|shutdown/i);
    });
  });

  describe("2. Multi-Channel Messaging (13 channels)", () => {
    const channels = [
      "telegram", "discord", "slack", "whatsapp", "sms",
      "imessage", "webchat", "signal", "google-chat",
      "teams", "matrix", "irc", "line",
    ];

    for (const ch of channels) {
      it(`${ch} adapter exists`, () => {
        const adapterFile = ch === "webchat" ? "server.ts" : "adapter.ts";
        expect(existsSync(join(KARNA_ROOT, `channels/${ch}/src/${adapterFile}`))).toBe(true);
      });
    }
  });

  describe("3. Multi-Agent Routing", () => {
    it("session manager supports multiple agents", () => {
      const src = readFileSync(join(KARNA_ROOT, "gateway/src/session/manager.ts"), "utf-8");
      expect(src).toMatch(/agentId/);
    });

    it("sessions_list tool exists", () => {
      expect(existsSync(join(KARNA_ROOT, "agent/src/tools/builtin/sessions.ts"))).toBe(true);
    });

    it("sessions_send tool exists for cross-session messaging", () => {
      const src = readFileSync(join(KARNA_ROOT, "agent/src/tools/builtin/sessions.ts"), "utf-8");
      expect(src).toMatch(/sessions_send/);
    });

    it("sessions_spawn tool exists", () => {
      expect(existsSync(join(KARNA_ROOT, "agent/src/tools/builtin/gateway-control.ts"))).toBe(true);
      const src = readFileSync(join(KARNA_ROOT, "agent/src/tools/builtin/gateway-control.ts"), "utf-8");
      expect(src).toMatch(/sessions_spawn|session_spawn/);
    });
  });

  describe("4. Workspace Configuration Files", () => {
    it("workspace loader exists", () => {
      expect(existsSync(join(KARNA_ROOT, "agent/src/workspace/loader.ts"))).toBe(true);
    });

    it("supports SOUL.md equivalent (personality)", () => {
      const src = readFileSync(join(KARNA_ROOT, "agent/src/workspace/loader.ts"), "utf-8");
      expect(src).toMatch(/SOUL|soul|persona|personality/i);
    });

    it("supports AGENTS.md equivalent", () => {
      const src = readFileSync(join(KARNA_ROOT, "agent/src/workspace/loader.ts"), "utf-8");
      expect(src).toMatch(/AGENTS|agents|agent\.md/i);
    });

    it("supports TOOLS.md equivalent", () => {
      const src = readFileSync(join(KARNA_ROOT, "agent/src/workspace/loader.ts"), "utf-8");
      expect(src).toMatch(/TOOLS|tools/i);
    });

    it("supports MEMORY.md equivalent", () => {
      const src = readFileSync(join(KARNA_ROOT, "agent/src/workspace/loader.ts"), "utf-8");
      expect(src).toMatch(/MEMORY|memory/i);
    });

    it("workspace loader test exists", () => {
      expect(existsSync(join(KARNA_ROOT, "tests/agent/workspace-loader.test.ts"))).toBe(true);
    });
  });

  describe("5. Skills System", () => {
    it("skills directory exists with built-in skills", () => {
      expect(existsSync(join(KARNA_ROOT, "skills/builtin"))).toBe(true);
    });

    it("code-reviewer skill exists", () => {
      expect(existsSync(join(KARNA_ROOT, "skills/builtin/code-reviewer/handler.ts"))).toBe(true);
    });

    it("news-digest skill exists", () => {
      expect(existsSync(join(KARNA_ROOT, "skills/builtin/news-digest/handler.ts"))).toBe(true);
    });

    it("community skill registry exists", () => {
      expect(existsSync(join(KARNA_ROOT, "skills/community/registry.ts"))).toBe(true);
    });
  });

  describe("6. Memory System", () => {
    it("memory manager exists", () => {
      const found =
        existsSync(join(KARNA_ROOT, "agent/src/memory/manager.ts")) ||
        existsSync(join(KARNA_ROOT, "agent/src/memory/index.ts")) ||
        existsSync(join(KARNA_ROOT, "gateway/src/memory/rag-pipeline.ts"));
      expect(found).toBe(true);
    });

    it("memory search tool exists", () => {
      expect(existsSync(join(KARNA_ROOT, "agent/src/tools/builtin/memory-tools.ts"))).toBe(true);
    });

    it("RAG pipeline exists", () => {
      const found =
        existsSync(join(KARNA_ROOT, "gateway/src/memory/rag-pipeline.ts")) ||
        existsSync(join(KARNA_ROOT, "agent/src/memory/rag-pipeline.ts")) ||
        existsSync(join(KARNA_ROOT, "agent/src/rag/pipeline.ts"));
      expect(found).toBe(true);
    });

    it("daily memory logs exist", () => {
      expect(existsSync(join(KARNA_ROOT, "agent/src/memory/daily-log.ts"))).toBe(true);
    });
  });

  describe("7. Built-in Tools", () => {
    const expectedTools = [
      "agent/src/tools/builtin/shell.ts",
      "agent/src/tools/builtin/files.ts",
      "agent/src/tools/builtin/web-search.ts",
      "agent/src/tools/builtin/image-generate.ts",
      "agent/src/tools/builtin/apply-patch.ts",
      "agent/src/tools/builtin/sessions.ts",
      "agent/src/tools/builtin/memory-tools.ts",
      "agent/src/tools/builtin/message.ts",
      "agent/src/tools/builtin/gateway-control.ts",
    ];

    for (const toolPath of expectedTools) {
      it(`${toolPath.split("/").pop()} exists`, () => {
        expect(existsSync(join(KARNA_ROOT, toolPath))).toBe(true);
      });
    }
  });

  describe("8. Canvas / A2UI", () => {
    it("canvas module exists", () => {
      expect(existsSync(join(KARNA_ROOT, "gateway/src/canvas/server.ts"))).toBe(true);
    });

    it("canvas test exists", () => {
      expect(existsSync(join(KARNA_ROOT, "tests/gateway/canvas.test.ts"))).toBe(true);
    });
  });

  describe("9. Voice Pipeline", () => {
    it("voice pipeline exists", () => {
      expect(existsSync(join(KARNA_ROOT, "agent/src/voice/index.ts"))).toBe(true);
    });

    it("STT exists", () => {
      expect(existsSync(join(KARNA_ROOT, "agent/src/voice/stt.ts"))).toBe(true);
    });

    it("TTS exists", () => {
      expect(existsSync(join(KARNA_ROOT, "agent/src/voice/tts.ts"))).toBe(true);
    });
  });

  describe("10. Cron Scheduler", () => {
    it("cron scheduler exists", () => {
      expect(existsSync(join(KARNA_ROOT, "gateway/src/cron/scheduler.ts"))).toBe(true);
    });

    it("cron scheduler test exists", () => {
      expect(existsSync(join(KARNA_ROOT, "tests/gateway/cron-scheduler.test.ts"))).toBe(true);
    });
  });

  describe("11. Session Management", () => {
    it("session manager exists", () => {
      expect(existsSync(join(KARNA_ROOT, "gateway/src/session/manager.ts"))).toBe(true);
    });

    it("session tools exist for agents", () => {
      expect(existsSync(join(KARNA_ROOT, "agent/src/tools/builtin/sessions.ts"))).toBe(true);
    });
  });

  describe("12. MCP Integration", () => {
    it("MCP server exists", () => {
      expect(existsSync(join(KARNA_ROOT, "gateway/src/mcp/server.ts"))).toBe(true);
    });

    it("MCP registration exists", () => {
      expect(existsSync(join(KARNA_ROOT, "gateway/src/mcp/index.ts"))).toBe(true);
    });
  });

  describe("13. Model Failover", () => {
    it("model failover module exists", () => {
      expect(existsSync(join(KARNA_ROOT, "agent/src/models/failover.ts"))).toBe(true);
    });

    it("model failover test exists", () => {
      expect(existsSync(join(KARNA_ROOT, "tests/agent/model-failover.test.ts"))).toBe(true);
    });
  });

  describe("14. Presence / Typing Indicators", () => {
    it("presence manager exists", () => {
      expect(existsSync(join(KARNA_ROOT, "gateway/src/presence/manager.ts"))).toBe(true);
    });

    it("presence test exists", () => {
      expect(existsSync(join(KARNA_ROOT, "tests/gateway/presence-manager.test.ts"))).toBe(true);
    });
  });

  describe("15. Chat Commands", () => {
    it("commands module exists", () => {
      expect(existsSync(join(KARNA_ROOT, "gateway/src/commands/handler.ts"))).toBe(true);
    });

    it("commands test exists", () => {
      expect(existsSync(join(KARNA_ROOT, "tests/gateway/commands.test.ts"))).toBe(true);
    });
  });

  describe("16. Access Policies (DM + Group Routing)", () => {
    it("access policies module exists", () => {
      expect(existsSync(join(KARNA_ROOT, "gateway/src/access/policies.ts"))).toBe(true);
    });

    it("access policies test exists", () => {
      expect(existsSync(join(KARNA_ROOT, "tests/gateway/access-policies.test.ts"))).toBe(true);
    });
  });

  describe("17. Audit Logging", () => {
    it("audit logger exists", () => {
      expect(existsSync(join(KARNA_ROOT, "gateway/src/audit/logger.ts"))).toBe(true);
    });

    it("audit logger test exists", () => {
      expect(existsSync(join(KARNA_ROOT, "tests/gateway/audit-logger.test.ts"))).toBe(true);
    });
  });

  describe("18. Environment Validation", () => {
    it("validate-env module exists", () => {
      expect(existsSync(join(KARNA_ROOT, "gateway/src/config/validate-env.ts"))).toBe(true);
    });

    it("validate-env test exists", () => {
      expect(existsSync(join(KARNA_ROOT, "tests/gateway/validate-env.test.ts"))).toBe(true);
    });
  });

  describe("19. Payments Integration", () => {
    it("stripe provider exists", () => {
      expect(existsSync(join(KARNA_ROOT, "packages/payments/src/stripe.ts"))).toBe(true);
    });

    it("plans definition exists", () => {
      expect(existsSync(join(KARNA_ROOT, "packages/payments/src/plans.ts"))).toBe(true);
    });
  });

  describe("20. Plugin SDK", () => {
    it("plugin SDK exists", () => {
      expect(existsSync(join(KARNA_ROOT, "packages/plugin-sdk/src/plugin.ts"))).toBe(true);
    });

    it("plugin SDK exports channel, tool, skill", () => {
      const src = readFileSync(join(KARNA_ROOT, "packages/plugin-sdk/src/index.ts"), "utf-8");
      expect(src).toMatch(/ChannelAdapter/);
      expect(src).toMatch(/ToolPlugin/);
      expect(src).toMatch(/SkillPlugin/);
    });
  });

  describe("21. Web Dashboard", () => {
    it("Next.js web app exists", () => {
      expect(existsSync(join(KARNA_ROOT, "apps/web/package.json"))).toBe(true);
    });

    it("dashboard page exists", () => {
      expect(existsSync(join(KARNA_ROOT, "apps/web/app/dashboard/page.tsx"))).toBe(true);
    });

    it("WebSocket client exists", () => {
      expect(existsSync(join(KARNA_ROOT, "apps/web/lib/ws.ts"))).toBe(true);
    });
  });

  describe("22. Mobile App", () => {
    it("Expo mobile app exists", () => {
      expect(existsSync(join(KARNA_ROOT, "apps/mobile/package.json"))).toBe(true);
    });

    it("mobile gateway client exists", () => {
      expect(existsSync(join(KARNA_ROOT, "apps/mobile/lib/gateway-client.ts"))).toBe(true);
    });
  });

  describe("23. CLI", () => {
    it("CLI app exists", () => {
      expect(existsSync(join(KARNA_ROOT, "apps/cli/package.json"))).toBe(true);
    });

    it("CLI has gateway command", () => {
      expect(existsSync(join(KARNA_ROOT, "apps/cli/src/commands/gateway.ts"))).toBe(true);
    });
  });

  describe("24. Cloud API", () => {
    it("cloud API exists", () => {
      expect(existsSync(join(KARNA_ROOT, "apps/cloud/src/index.ts"))).toBe(true);
    });

    it("auth routes exist", () => {
      expect(existsSync(join(KARNA_ROOT, "apps/cloud/src/routes/auth.ts"))).toBe(true);
    });

    it("rate limiting exists", () => {
      expect(existsSync(join(KARNA_ROOT, "apps/cloud/src/middleware/rate-limit.ts"))).toBe(true);
    });
  });

  describe("25. Docker Support", () => {
    it("docker-compose.yml exists", () => {
      expect(existsSync(join(KARNA_ROOT, "docker-compose.yml"))).toBe(true);
    });

    it("gateway Dockerfile exists", () => {
      expect(existsSync(join(KARNA_ROOT, "gateway/Dockerfile"))).toBe(true);
    });
  });

  describe("26. Tool Profiles", () => {
    it("tool profiles module exists", () => {
      expect(existsSync(join(KARNA_ROOT, "agent/src/tools/profiles.ts"))).toBe(true);
    });

    it("tool profiles test exists", () => {
      expect(existsSync(join(KARNA_ROOT, "tests/agent/tool-profiles.test.ts"))).toBe(true);
    });
  });

  describe("27. Elevated Shell Mode", () => {
    it("shell tool supports elevated mode", () => {
      const src = readFileSync(join(KARNA_ROOT, "agent/src/tools/builtin/shell.ts"), "utf-8");
      expect(src).toMatch(/elevated|setElevatedMode/i);
    });

    it("elevated shell test exists", () => {
      expect(existsSync(join(KARNA_ROOT, "tests/agent/elevated-shell.test.ts"))).toBe(true);
    });
  });

  describe("28. Apply Patch Tool", () => {
    it("apply_patch tool exists", () => {
      expect(existsSync(join(KARNA_ROOT, "agent/src/tools/builtin/apply-patch.ts"))).toBe(true);
    });

    it("apply_patch test exists", () => {
      expect(existsSync(join(KARNA_ROOT, "tests/agent/apply-patch.test.ts"))).toBe(true);
    });
  });

  describe("29. Image Generation", () => {
    it("image_generate tool exists", () => {
      expect(existsSync(join(KARNA_ROOT, "agent/src/tools/builtin/image-generate.ts"))).toBe(true);
    });
  });

  describe("30. Auth Token Rotation", () => {
    it("auth rotation module exists", () => {
      // Auth rotation is tested in tests/agent/auth-rotation.test.ts
      // The actual implementation is in gateway/src/protocol/auth.ts
      expect(existsSync(join(KARNA_ROOT, "gateway/src/protocol/auth.ts"))).toBe(true);
    });

    it("auth rotation test exists", () => {
      expect(existsSync(join(KARNA_ROOT, "tests/agent/auth-rotation.test.ts"))).toBe(true);
    });
  });

  describe("31. Gmail Pub/Sub Integration", () => {
    it("Gmail Pub/Sub module exists", () => {
      expect(existsSync(join(KARNA_ROOT, "gateway/src/integrations/gmail-pubsub.ts"))).toBe(true);
    });

    it("Gmail Pub/Sub test exists", () => {
      expect(existsSync(join(KARNA_ROOT, "tests/gateway/gmail-pubsub.test.ts"))).toBe(true);
    });
  });
});
