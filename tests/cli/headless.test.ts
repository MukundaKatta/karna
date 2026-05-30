import { describe, expect, it } from "vitest";
import {
  runHeadless,
  validatePrompt,
  serializeEnvelope,
  makeEnvelope,
  HEADLESS_EXIT_CODES,
  HEADLESS_ENVELOPE_VERSION,
  type HeadlessRuntimeClient,
  type HeadlessRunResult,
} from "../../apps/cli/src/lib/headless.js";

// ─── Fake clients ─────────────────────────────────────────────────────────────

class FakeClient implements HeadlessRuntimeClient {
  readonly sessionId: string;
  closed = false;
  lastPrompt?: string;
  constructor(
    private readonly impl: (prompt: string, signal?: AbortSignal) => Promise<HeadlessRunResult>,
    sessionId = "sess-123",
  ) {
    this.sessionId = sessionId;
  }
  async run(prompt: string, signal?: AbortSignal): Promise<HeadlessRunResult> {
    this.lastPrompt = prompt;
    return this.impl(prompt, signal);
  }
  close(): void {
    this.closed = true;
  }
}

// ─── validatePrompt ───────────────────────────────────────────────────────────

describe("validatePrompt", () => {
  it("trims and accepts a valid prompt", () => {
    expect(validatePrompt("  hello  ")).toEqual({ ok: true, prompt: "hello" });
  });

  it("rejects empty / whitespace prompts", () => {
    expect(validatePrompt("   ")).toMatchObject({ ok: false });
    expect(validatePrompt("")).toMatchObject({ ok: false });
    expect(validatePrompt(null)).toMatchObject({ ok: false });
    expect(validatePrompt(undefined)).toMatchObject({ ok: false });
  });

  it("rejects over-long prompts", () => {
    const result = validatePrompt("x".repeat(32_001));
    expect(result.ok).toBe(false);
  });
});

// ─── runHeadless: happy path ──────────────────────────────────────────────────

describe("runHeadless", () => {
  it("returns an ok envelope and exit 0 for a successful run", async () => {
    const client = new FakeClient(async () => ({
      output: "Hello there",
      finishReason: "stop",
      tools: [{ toolName: "search", isError: false, durationMs: 42 }],
      usage: { inputTokens: 10, outputTokens: 5 },
    }));

    const { envelope, exitCode } = await runHeadless({ prompt: "hi", client, now: () => 0 });

    expect(exitCode).toBe(HEADLESS_EXIT_CODES.success);
    expect(envelope.status).toBe("ok");
    expect(envelope.output).toBe("Hello there");
    expect(envelope.finishReason).toBe("stop");
    expect(envelope.sessionId).toBe("sess-123");
    expect(envelope.tools).toEqual([{ toolName: "search", isError: false, durationMs: 42 }]);
    expect(envelope.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(envelope.error).toBeNull();
    expect(client.closed).toBe(true);
    expect(client.lastPrompt).toBe("hi");
  });

  it("encodes an empty prompt as a usage error (exit 2) without calling run", async () => {
    let called = false;
    const client = new FakeClient(async () => {
      called = true;
      return { output: "", finishReason: null, tools: [], usage: null };
    });

    const { envelope, exitCode } = await runHeadless({ prompt: "   ", client });

    expect(called).toBe(false);
    expect(exitCode).toBe(HEADLESS_EXIT_CODES.usage);
    expect(envelope.status).toBe("error");
    expect(envelope.output).toBe("");
    expect(client.closed).toBe(true);
  });

  it("maps an agent-level error to status error and exit 1", async () => {
    const client = new FakeClient(async () => ({
      output: "partial",
      finishReason: "error",
      tools: [],
      usage: null,
      error: "model failure",
    }));

    const { envelope, exitCode } = await runHeadless({ prompt: "hi", client });

    expect(exitCode).toBe(HEADLESS_EXIT_CODES.agentError);
    expect(envelope.status).toBe("error");
    expect(envelope.output).toBe(""); // output suppressed on error
    expect(envelope.error).toBe("model failure");
  });

  it("maps a thrown transport error to a connection failure (exit 3)", async () => {
    const client = new FakeClient(async () => {
      throw new Error("ECONNREFUSED");
    });

    const { envelope, exitCode } = await runHeadless({ prompt: "hi", client });

    expect(exitCode).toBe(HEADLESS_EXIT_CODES.connection);
    expect(envelope.status).toBe("error");
    expect(envelope.error).toBe("ECONNREFUSED");
    expect(client.closed).toBe(true);
  });

  it("times out (exit 4) and aborts the client signal", async () => {
    let aborted = false;
    const client = new FakeClient(
      (_prompt, signal) =>
        new Promise<HeadlessRunResult>((resolve) => {
          signal?.addEventListener("abort", () => {
            aborted = true;
            resolve({ output: "", finishReason: null, tools: [], usage: null });
          });
        }),
    );

    const { envelope, exitCode } = await runHeadless({ prompt: "hi", client, timeoutMs: 5 });

    expect(exitCode).toBe(HEADLESS_EXIT_CODES.timeout);
    expect(envelope.status).toBe("timeout");
    expect(envelope.error).toMatch(/timed out/i);
    expect(aborted).toBe(true);
  });
});

// ─── Envelope shape / serialization ───────────────────────────────────────────

describe("envelope serialization", () => {
  it("produces a stable, ordered single-line JSON shape", () => {
    const envelope = makeEnvelope({
      status: "ok",
      sessionId: "s1",
      output: "hi",
      finishReason: "stop",
      tools: [{ toolName: "t", isError: false, durationMs: 1 }],
      usage: { inputTokens: 2, outputTokens: 3 },
      durationMs: 7,
    });

    const json = serializeEnvelope(envelope);
    expect(json).toBe(
      '{"version":1,"status":"ok","output":"hi","finishReason":"stop","sessionId":"s1",' +
        '"tools":[{"toolName":"t","isError":false,"durationMs":1}],' +
        '"usage":{"inputTokens":2,"outputTokens":3},"error":null,"durationMs":7}',
    );
    expect(JSON.parse(json).version).toBe(HEADLESS_ENVELOPE_VERSION);
  });

  it("round-trips through JSON.parse with the documented fields", () => {
    const envelope = makeEnvelope({ status: "timeout", sessionId: "s2", error: "boom", durationMs: 3 });
    const parsed = JSON.parse(serializeEnvelope(envelope)) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      version: 1,
      status: "timeout",
      output: "",
      finishReason: null,
      sessionId: "s2",
      tools: [],
      usage: null,
      error: "boom",
      durationMs: 3,
    });
  });

  it("omits undefined tool durationMs in serialized output", () => {
    const envelope = makeEnvelope({
      status: "ok",
      sessionId: "s",
      tools: [{ toolName: "t", isError: true }],
      durationMs: 0,
    });
    const parsed = JSON.parse(serializeEnvelope(envelope)) as { tools: Array<Record<string, unknown>> };
    expect(parsed.tools[0]).toEqual({ toolName: "t", isError: true });
  });
});
