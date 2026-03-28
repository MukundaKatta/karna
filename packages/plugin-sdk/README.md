# Karna Plugin SDK

Build custom plugins for the Karna AI Agent Platform.

## Quick Start

```typescript
import { definePlugin, type PluginContext } from "@karna/plugin-sdk";

export default definePlugin({
  name: "my-plugin",
  version: "1.0.0",
  description: "My custom Karna plugin",

  async activate(ctx: PluginContext) {
    // Register a custom tool
    ctx.registerTool({
      name: "my_tool",
      description: "Does something useful",
      parameters: { type: "object", properties: {} },
      riskLevel: "low",
      async execute(input) {
        return { output: "Hello from my plugin!", isError: false, durationMs: 0 };
      },
    });

    // Register a custom skill
    ctx.registerSkill({
      name: "my-skill",
      triggers: [{ type: "command", value: "/myskill" }],
      async execute(action, input) {
        return { output: "Skill executed!", success: true };
      },
    });
  },

  async deactivate() {
    // Cleanup
  },
});
```

## Plugin Types

### Tools
Register custom tools that the agent can call during conversations.

### Skills
Register skills with triggers (commands, patterns, events, schedules).

### Channels
Register custom messaging channel adapters.

## Publishing

1. Create your plugin package
2. Add `karna-plugin` keyword to package.json
3. Publish to npm: `npm publish`
4. Users install via: `karna marketplace install your-plugin`

## API Reference

### PluginContext

| Method | Description |
|--------|------------|
| `registerTool(tool)` | Register a custom tool |
| `registerSkill(skill)` | Register a custom skill |
| `registerChannel(channel)` | Register a channel adapter |
| `getConfig(key)` | Get plugin configuration |
| `log(level, message)` | Log a message |

## License

MIT
