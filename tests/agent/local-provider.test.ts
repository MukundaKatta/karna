import { describe, it, expect, vi } from "vitest";
import { LocalProvider } from "../../agent/src/models/local-provider.js";
import type { ChatParams, StreamEvent } from "../../agent/src/models/provider.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const baseParams: ChatParams = {
  model: "llama3",
  messages: [{ role: "user", content: "hi" }],
};

describe("LocalProvider (#595)", () => {
  it("strips trailing slashes and posts to /chat/completions", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: "hello" } }], usage: { prompt_tokens: 3, completion_tokens: 1 } }),
    );
    const p = new LocalProvider({ baseUrl: "http://localhost:11434/v1/", fetchImpl: fetchImpl as unknown as typeof fetch });
    const events = await collect(p.chat(baseParams));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
    expect((init as RequestInit).method).toBe("POST");
    expect(events.find((e) => e.type === "text")).toMatchObject({ text: "hello" });
    const usage = events.find((e) => e.type === "usage");
    expect(usage).toMatchObject({ inputTokens: 3, outputTokens: 1 });
    expect(events[events.length - 1]).toEqual({ type: "done" });
  });

  it("emits tool_use events parsed from the response", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        choices: [
          {
            message: {
              tool_calls: [{ id: "c1", function: { name: "search", arguments: '{"q":"x"}' } }],
            },
          },
        ],
      }),
    );
    const p = new LocalProvider({ baseUrl: "http://x", fetchImpl: fetchImpl as unknown as typeof fetch });
    const events = await collect(p.chat(baseParams));
    const tool = events.find((e) => e.type === "tool_use");
    expect(tool).toMatchObject({ type: "tool_use", id: "c1", name: "search", input: { q: "x" } });
  });

  it("sets the Authorization header only when an apiKey is given", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ choices: [{ message: { content: "ok" } }] }));
    const p = new LocalProvider({ baseUrl: "http://x", apiKey: "secret", fetchImpl: fetchImpl as unknown as typeof fetch });
    await collect(p.chat(baseParams));
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer secret");
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "bad" }, false, 500));
    const p = new LocalProvider({ baseUrl: "http://x", fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(collect(p.chat(baseParams))).rejects.toThrow();
  });

  it("throws when neither model nor defaultModel is set, before fetching", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ choices: [{ message: { content: "ok" } }] }));
    const p = new LocalProvider({ baseUrl: "http://x", fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(collect(p.chat({ messages: [{ role: "user", content: "hi" }], model: "" }))).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
