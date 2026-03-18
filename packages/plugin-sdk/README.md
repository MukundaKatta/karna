# @karna/plugin-sdk

Public SDK for building Karna plugins, including channel adapters, tools, and skills.

## Installation

```bash
npm install @karna/plugin-sdk
```

## Usage

### Channel Adapter

```typescript
import { ChannelAdapter } from '@karna/plugin-sdk';

class MyAdapter extends ChannelAdapter {
  async connect() { /* ... */ }
  async send(message) { /* ... */ }
  async disconnect() { /* ... */ }
}
```

### Tool Plugin

```typescript
import { defineToolPlugin } from '@karna/plugin-sdk';

export default defineToolPlugin({
  name: 'my-tool',
  description: 'Does something useful',
  parameters: z.object({ input: z.string() }),
  handler: async (params, ctx) => {
    return { result: 'done' };
  },
});
```

### Skill Plugin

```typescript
import { defineSkillPlugin } from '@karna/plugin-sdk';

export default defineSkillPlugin({
  name: 'my-skill',
  trigger: '/my-command',
  handler: async (args, ctx) => {
    return 'Skill response';
  },
});
```

## API

- `ChannelAdapter` — Base class for channel integrations
- `defineToolPlugin()` — Define a tool plugin
- `defineSkillPlugin()` — Define a skill plugin
- `registerPlugin()` — Register a plugin with the runtime
