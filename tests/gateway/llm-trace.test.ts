import { describe, it, expect, beforeEach } from "vitest";
import {
  LlmTraceRecorder,
  InMemoryLlmCaptureSink,
  defaultRedaction,
  noRedaction,
  REDACTED,
  type RedactionHook,
  type LlmRequestContext,
  type LlmCallRecord,
} from "../../gateway/src/observability/llm-trace.js";
import { Tracer, InMemorySpanExporter } from "../../gateway/src/observability/spans.js";

function makeRequest(overrides: Partial<LlmRequestContext> = {}): LlmRequestContext {
  return {
    params: { model: "claude-sonnet-4", temperature: 0.7, maxTokens: 1024 },
    system: "You are helpful.",
    messages: [{ role: "user", content: "Hello" }],
    tools: [{ name: "web_search", description: "search the web" }],
    ...overrides,
  };
}

describe("LlmTraceRecorder capture + replay", () => {
  let sink: InMemoryLlmCaptureSink;
  let recorder: LlmTraceRecorder;

  beforeEach(() => {
    sink = new InMemoryLlmCaptureSink();
    recorder = new LlmTraceRecorder({ sink, redact: noRedaction });
  });

  it("captures a full request/response via capture()", () => {
    const record = recorder.capture({
      sessionId: "sess-1",
      userId: "user-1",
      request: makeRequest(),
      response: {
        text: "Hi there",
        stopReason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
      },
    });

    expect(record.captureId).toBeTruthy();
    expect(record.sessionId).toBe("sess-1");
    expect(record.userId).toBe("user-1");
    expect(record.response?.text).toBe("Hi there");
    expect(record.durationMs).toBeGreaterThanOrEqual(0);
    expect(sink.size).toBe(1);
  });

  it("replay returns the exact captured request context", () => {
    const request = makeRequest();
    const record = recorder.capture({ request, response: { text: "ok" } });

    const replayed = recorder.replay(record.captureId);
    expect(replayed).toEqual(request);
    // Deep clone: mutating the replay must not corrupt the store.
    replayed!.messages.push({ role: "user", content: "extra" });
    expect(recorder.replay(record.captureId)!.messages).toHaveLength(1);
  });

  it("returns undefined replaying an unknown id", () => {
    expect(recorder.replay("nope")).toBeUndefined();
  });

  it("increments callIndex per session", () => {
    const r1 = recorder.capture({ sessionId: "s", request: makeRequest(), response: {} });
    const r2 = recorder.capture({ sessionId: "s", request: makeRequest(), response: {} });
    const other = recorder.capture({ sessionId: "other", request: makeRequest(), response: {} });
    expect(r1.callIndex).toBe(0);
    expect(r2.callIndex).toBe(1);
    expect(other.callIndex).toBe(0);
  });

  it("beginCall/complete records a success", () => {
    const handle = recorder.beginCall({ sessionId: "s", request: makeRequest() });
    const record = handle.complete({ text: "done", usage: { inputTokens: 3 } });
    expect(record.error).toBeUndefined();
    expect(record.response?.text).toBe("done");
    expect(recorder.getRecord(handle.captureId)?.response?.text).toBe("done");
  });

  it("beginCall/fail records an error", () => {
    const handle = recorder.beginCall({ sessionId: "s", request: makeRequest() });
    const record = handle.fail(new Error("model exploded"));
    expect(record.error).toBe("model exploded");
    expect(record.response).toBeUndefined();
  });

  it("queries records by session/user/trace", () => {
    recorder.capture({ sessionId: "a", userId: "u1", request: makeRequest(), response: {} });
    recorder.capture({ sessionId: "b", userId: "u2", request: makeRequest(), response: {} });
    expect(recorder.query({ sessionId: "a" })).toHaveLength(1);
    expect(recorder.query({ userId: "u2" })).toHaveLength(1);
    expect(recorder.query({})).toHaveLength(2);
  });
});

describe("LlmTraceRecorder redaction", () => {
  it("default redaction masks secret-keyed values and token-shaped strings", () => {
    const sink = new InMemoryLlmCaptureSink();
    const recorder = new LlmTraceRecorder({ sink }); // default redaction
    const record = recorder.capture({
      sessionId: "s",
      request: {
        params: {
          model: "claude-sonnet-4",
          extra: { apiKey: "super-secret-value", authorization: "Bearer abc" },
        },
        messages: [{ role: "user", content: "my key is sk-ABCDEF0123456789ABCDEF" }],
      },
      response: { text: "noted" },
    });

    const stored = recorder.getRecord(record.captureId)!;
    expect(stored.redacted).toBe(true);
    const extra = stored.request.params.extra as Record<string, unknown>;
    expect(extra.apiKey).toBe(REDACTED);
    expect(extra.authorization).toBe(REDACTED);
    const msg = stored.request.messages[0]!.content as string;
    expect(msg).toContain(REDACTED);
    expect(msg).not.toContain("sk-ABCDEF0123456789ABCDEF");
  });

  it("noRedaction preserves content verbatim", () => {
    const recorder = new LlmTraceRecorder({ redact: noRedaction });
    const record = recorder.capture({
      request: { params: { model: "m", extra: { apiKey: "keep" } }, messages: [] },
      response: {},
    });
    const extra = recorder.getRecord(record.captureId)!.request.params.extra as Record<string, unknown>;
    expect(extra.apiKey).toBe("keep");
  });

  it("custom redaction hook is applied and flagged redacted", () => {
    const hook: RedactionHook = (r) => ({ ...r, request: { ...r.request, system: "X" } });
    const recorder = new LlmTraceRecorder({ redact: hook });
    const record = recorder.capture({ request: makeRequest(), response: {} });
    const stored = recorder.getRecord(record.captureId)!;
    expect(stored.request.system).toBe("X");
    expect(stored.redacted).toBe(true); // forced even though hook forgot
  });

  it("drops the capture fail-closed when the redaction hook throws", () => {
    const sink = new InMemoryLlmCaptureSink();
    const throwing: RedactionHook = () => {
      throw new Error("hook boom");
    };
    const recorder = new LlmTraceRecorder({ sink, redact: throwing });
    const record = recorder.capture({ request: makeRequest(), response: {} });
    // The returned draft exists, but nothing was persisted.
    expect(record.captureId).toBeTruthy();
    expect(sink.size).toBe(0);
    expect(recorder.getRecord(record.captureId)).toBeUndefined();
  });
});

describe("LlmTraceRecorder span correlation", () => {
  it("opens and ends an llm.call span correlated to the record", () => {
    const exporter = new InMemorySpanExporter();
    const tracer = new Tracer(exporter);
    const recorder = new LlmTraceRecorder({ tracer, redact: noRedaction });

    const record = recorder.capture({
      sessionId: "s",
      request: makeRequest(),
      response: { usage: { inputTokens: 12, outputTokens: 8, costUsd: 0.002 } },
    });

    expect(record.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(record.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(exporter.size).toBe(1);
    const span = exporter.getSpans()[0]!;
    expect(span.name).toBe("llm.call");
    expect(span.kind).toBe("client");
    expect(span.attributes["llm.model"]).toBe("claude-sonnet-4");
    expect(span.attributes["llm.usage.input_tokens"]).toBe(12);
    expect(span.attributes["karna.capture_id"]).toBe(record.captureId);
    expect(span.endTimeUnixMs).toBeDefined();
  });

  it("nests the llm.call span under a provided parent", () => {
    const exporter = new InMemorySpanExporter();
    const tracer = new Tracer(exporter);
    const recorder = new LlmTraceRecorder({ tracer, redact: noRedaction });
    const root = tracer.startSpan("agent.turn");

    const record = recorder.capture({ request: makeRequest(), response: {}, parent: root });
    root.end();

    expect(record.traceId).toBe(root.traceId);
    const llmSpan = exporter.getSpans().find((s) => s.name === "llm.call")!;
    expect(llmSpan.parentSpanId).toBe(root.spanId);
  });

  it("marks the span errored when the call fails", () => {
    const exporter = new InMemorySpanExporter();
    const tracer = new Tracer(exporter);
    const recorder = new LlmTraceRecorder({ tracer, redact: noRedaction });
    const handle = recorder.beginCall({ request: makeRequest() });
    handle.fail(new Error("timeout"));
    const span = exporter.getSpans()[0]!;
    expect(span.status.code).toBe("error");
    expect(span.status.message).toBe("timeout");
  });
});
