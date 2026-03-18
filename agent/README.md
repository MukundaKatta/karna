# @karna/agent

Core agent execution engine that orchestrates the AI conversation loop.

## Architecture

The agent follows a **context → LLM → tools → reply** loop:

1. **Context Building** — Assembles system prompt, memory, and conversation history
2. **LLM Routing** — Sends context to the configured model (Anthropic, OpenAI)
3. **Tool Execution** — Processes tool calls with approval workflows
4. **Reply Delivery** — Returns the final response to the gateway

## Key Modules

| Module | Description |
|---|---|
| `src/runtime.ts` | Main agent execution loop |
| `src/context/` | Context building and system prompts |
| `src/memory/` | Semantic memory with vector search |
| `src/models/` | LLM provider routing |
| `src/skills/` | Skill loading and matching |
| `src/tools/` | Tool registry and execution |
| `src/voice/` | Speech-to-text and text-to-speech |

## Dependencies

- **@anthropic-ai/sdk** — Claude API
- **openai** — OpenAI API
- **playwright** — Browser automation tools
- **@modelcontextprotocol/sdk** — MCP integration
- **googleapis** — Google services integration

## Development

```bash
pnpm dev    # Run with tsx in watch mode
pnpm build  # Compile TypeScript
```
