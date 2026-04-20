import { definePlugin, defineTool, defineSkill, type PluginContext } from "../src/index.js";

export function registerEchoPlugin(context: PluginContext): void {
  context.registerTool(
    defineTool({
      name: "echo_text",
      description: "Echo back a short text payload for plugin smoke tests.",
      riskLevel: "low",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text to echo back" },
        },
        required: ["text"],
        additionalProperties: false,
      },
      async execute(input) {
        return {
          output: { echoed: String(input.text ?? "") },
          isError: false,
          durationMs: 0,
        };
      },
    }),
  );

  context.registerSkill(
    defineSkill({
      name: "echo-helper",
      description: "Responds with a short echo via the plugin SDK.",
      triggers: [{ type: "command", value: "/echo", description: "Echo helper command" }],
      async handler(skillContext) {
        return {
          success: true,
          response: `Echo: ${skillContext.input}`,
          data: { source: "echo-plugin" },
        };
      },
    }),
  );
}

export default definePlugin({
  name: "echo-plugin",
  version: "0.1.0",
  description: "Minimal example plugin for end-to-end SDK registration tests.",
  async register(context) {
    registerEchoPlugin(context);
    context.getLogger().info("Echo plugin registered");
  },
});
