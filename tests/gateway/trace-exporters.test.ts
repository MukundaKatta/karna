import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  encodeOtlpJson,
  encodeLangfuse,
  OtlpJsonExporter,
  PhoenixExporter,
  LangfuseExporter,
  MultiSpanExporter,
  SpanExporterAdapter,
  createExporters,
  type HttpPostFn,
  type HttpPostRequest,
} from "../../gateway/src/observability/exporters.js";
import { Tracer, type SpanData } from "../../gateway/src/observability/spans.js";

function makeSpan(overrides: Partial<SpanData> = {}): SpanData {
  return {
    traceId: "a".repeat(32),
    spanId: "b".repeat(16),
    name: "llm.call",
    kind: "client",
    startTimeUnixMs: 1_700_000_000_000,
    endTimeUnixMs: 1_700_000_000_500,
    durationMs: 500,
    attributes: { "llm.model": "claude", "llm.usage.input_tokens": 10, ok: true, ratio: 0.5 },
    events: [{ name: "first_token", timeUnixMs: 1_700_000_000_100, attributes: { idx: 1 } }],
    status: { code: "ok" },
    ...overrides,
  };
}

describe("OTLP/JSON encoding", () => {
  it("encodes a span into ResourceSpans with typed attributes & nano timestamps", () => {
    const out = encodeOtlpJson([makeSpan()], "my-svc") as any;
    const rs = out.resourceSpans[0];
    expect(rs.resource.attributes).toContainEqual({
      key: "service.name",
      value: { stringValue: "my-svc" },
    });
    const span = rs.scopeSpans[0].spans[0];
    expect(span.traceId).toBe("a".repeat(32));
    expect(span.spanId).toBe("b".repeat(16));
    expect(span.kind).toBe(3); // client
    expect(span.startTimeUnixNano).toBe("1700000000000000000");
    expect(span.endTimeUnixNano).toBe("1700000000500000000");
    expect(span.status.code).toBe(1); // ok

    const attrs: any[] = span.attributes;
    expect(attrs).toContainEqual({ key: "llm.model", value: { stringValue: "claude" } });
    expect(attrs).toContainEqual({ key: "llm.usage.input_tokens", value: { intValue: "10" } });
    expect(attrs).toContainEqual({ key: "ok", value: { boolValue: true } });
    expect(attrs).toContainEqual({ key: "ratio", value: { doubleValue: 0.5 } });

    expect(span.events[0].name).toBe("first_token");
    expect(span.events[0].timeUnixNano).toBe("1700000000100000000");
  });

  it("maps error status and includes parentSpanId only when present", () => {
    const withParent = encodeOtlpJson([
      makeSpan({ parentSpanId: "c".repeat(16), status: { code: "error", message: "boom" } }),
    ]) as any;
    const span = withParent.resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.parentSpanId).toBe("c".repeat(16));
    expect(span.status.code).toBe(2);
    expect(span.status.message).toBe("boom");

    const noParent = encodeOtlpJson([makeSpan()]) as any;
    expect(noParent.resourceSpans[0].scopeSpans[0].spans[0].parentSpanId).toBeUndefined();
  });
});

describe("Langfuse encoding", () => {
  it("emits a trace-create per traceId plus an observation per span", () => {
    const spans = [
      makeSpan({ spanId: "root".padEnd(16, "0"), parentSpanId: undefined, name: "agent.turn" }),
      makeSpan({ spanId: "child".padEnd(16, "0"), parentSpanId: "root".padEnd(16, "0") }),
    ];
    const out = encodeLangfuse(spans) as any;
    const batch: any[] = out.batch;
    const traceEvents = batch.filter((e) => e.type === "trace-create");
    const obs = batch.filter((e) => e.type === "observation-create");
    expect(traceEvents).toHaveLength(1);
    expect(traceEvents[0].body.id).toBe("a".repeat(32));
    expect(obs).toHaveLength(2);
    const child = obs.find((o) => o.body.id === "child".padEnd(16, "0"));
    expect(child.body.parentObservationId).toBe("root".padEnd(16, "0"));
    expect(child.body.type).toBe("SPAN");
  });

  it("sets ERROR level for errored spans", () => {
    const out = encodeLangfuse([makeSpan({ status: { code: "error", message: "x" } })]) as any;
    const obs = out.batch.find((e: any) => e.type === "observation-create");
    expect(obs.body.level).toBe("ERROR");
    expect(obs.body.statusMessage).toBe("x");
  });
});

describe("Exporters over injected transport", () => {
  let post: ReturnType<typeof vi.fn> & HttpPostFn;
  let calls: HttpPostRequest[];

  beforeEach(() => {
    calls = [];
    post = vi.fn(async (req: HttpPostRequest) => {
      calls.push(req);
      return { status: 202 };
    }) as any;
  });

  it("OtlpJsonExporter posts OTLP body to configured url", async () => {
    const exp = new OtlpJsonExporter({ url: "https://collector/v1/traces" }, post);
    const result = await exp.export([makeSpan()]);
    expect(result.ok).toBe(true);
    expect(result.count).toBe(1);
    expect(result.status).toBe(202);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://collector/v1/traces");
    const parsed = JSON.parse(calls[0]!.body);
    expect(parsed.resourceSpans).toBeDefined();
    expect(calls[0]!.headers["content-type"]).toBe("application/json");
  });

  it("PhoenixExporter reuses OTLP encoding under its own backend id", async () => {
    const exp = new PhoenixExporter({ url: "https://phoenix/v1/traces" }, post);
    expect(exp.backend).toBe("phoenix");
    await exp.export([makeSpan()]);
    const parsed = JSON.parse(calls[0]!.body);
    expect(parsed.resourceSpans).toBeDefined();
  });

  it("LangfuseExporter sends batch shape with basic-auth header", async () => {
    const exp = new LangfuseExporter(
      { url: "https://langfuse/api/public/ingestion", publicKey: "pk", secretKey: "sk" },
      post,
    );
    await exp.export([makeSpan()]);
    const parsed = JSON.parse(calls[0]!.body);
    expect(parsed.batch).toBeDefined();
    const expectedAuth = "Basic " + Buffer.from("pk:sk").toString("base64");
    expect(calls[0]!.headers.authorization).toBe(expectedAuth);
  });

  it("merges extra config headers", async () => {
    const exp = new OtlpJsonExporter(
      { url: "u", headers: { "x-custom": "1" } },
      post,
    );
    await exp.export([makeSpan()]);
    expect(calls[0]!.headers["x-custom"]).toBe("1");
  });

  it("does not post when disabled", async () => {
    const exp = new OtlpJsonExporter({ url: "u", enabled: false }, post);
    const result = await exp.export([makeSpan()]);
    expect(result.ok).toBe(true);
    expect(result.count).toBe(0);
    expect(post).not.toHaveBeenCalled();
  });

  it("does not post for an empty span batch", async () => {
    const exp = new OtlpJsonExporter({ url: "u" }, post);
    const result = await exp.export([]);
    expect(result.count).toBe(0);
    expect(post).not.toHaveBeenCalled();
  });

  it("reports non-2xx as not-ok", async () => {
    const failing: HttpPostFn = async () => ({ status: 500, body: "err" });
    const exp = new OtlpJsonExporter({ url: "u" }, failing);
    const result = await exp.export([makeSpan()]);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(result.error).toBe("HTTP 500");
  });

  it("captures transport rejection as a failed result (no throw)", async () => {
    const throwing: HttpPostFn = async () => {
      throw new Error("network down");
    };
    const exp = new OtlpJsonExporter({ url: "u" }, throwing);
    const result = await exp.export([makeSpan()]);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("network down");
  });
});

describe("createExporters (config-driven)", () => {
  const post: HttpPostFn = async () => ({ status: 200 });

  it("builds only the configured + enabled exporters", () => {
    const exporters = createExporters(
      {
        otlp: { url: "o" },
        phoenix: { url: "p", enabled: false },
        langfuse: { url: "l", publicKey: "pk", secretKey: "sk" },
      },
      post,
    );
    expect(exporters.map((e) => e.backend).sort()).toEqual(["langfuse", "otlp"]);
  });

  it("returns empty when nothing configured", () => {
    expect(createExporters({}, post)).toHaveLength(0);
  });
});

describe("MultiSpanExporter", () => {
  it("fans out to all exporters", async () => {
    const post = vi.fn(async () => ({ status: 200 }));
    const multi = new MultiSpanExporter(
      createExporters({ otlp: { url: "o" }, phoenix: { url: "p" } }, post as any),
    );
    expect(multi.backends.sort()).toEqual(["otlp", "phoenix"]);
    const results = await multi.export([makeSpan()]);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(post).toHaveBeenCalledTimes(2);
  });
});

describe("SpanExporterAdapter (bridge to in-process sink)", () => {
  it("streams Tracer spans to an external exporter in the background", async () => {
    const post = vi.fn(async () => ({ status: 200 }));
    const external = new OtlpJsonExporter({ url: "u" }, post as any);
    const adapter = new SpanExporterAdapter(external);
    const tracer = new Tracer(adapter); // autoFlush -> export on span end

    tracer.startSpan("llm.call").end();
    await adapter.flush();

    expect(post).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse((post.mock.calls[0]![0] as HttpPostRequest).body);
    expect(parsed.resourceSpans[0].scopeSpans[0].spans[0].name).toBe("llm.call");
  });

  it("swallows background export errors without rejecting", async () => {
    const external = new OtlpJsonExporter({ url: "u" }, async () => {
      throw new Error("boom");
    });
    const adapter = new SpanExporterAdapter(external);
    adapter.export([makeSpan()]);
    await expect(adapter.flush()).resolves.toBeUndefined();
  });
});
