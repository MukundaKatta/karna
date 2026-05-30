import { describe, it, expect, beforeEach } from "vitest";
import {
  Tracer,
  Span,
  InMemorySpanExporter,
  buildSpanTree,
  exportSpanTreeJson,
  generateTraceId,
  generateSpanId,
  type SpanData,
} from "../../gateway/src/observability/spans.js";

describe("spans (vendor-neutral tracing)", () => {
  describe("ID generation", () => {
    it("generates 32-hex-char trace IDs", () => {
      const id = generateTraceId();
      expect(id).toMatch(/^[0-9a-f]{32}$/);
    });

    it("generates 16-hex-char span IDs", () => {
      const id = generateSpanId();
      expect(id).toMatch(/^[0-9a-f]{16}$/);
    });

    it("generates unique IDs", () => {
      expect(generateTraceId()).not.toBe(generateTraceId());
      expect(generateSpanId()).not.toBe(generateSpanId());
    });
  });

  describe("Tracer + Span lifecycle", () => {
    let exporter: InMemorySpanExporter;
    let tracer: Tracer;

    beforeEach(() => {
      exporter = new InMemorySpanExporter();
      tracer = new Tracer(exporter);
    });

    it("creates a root span with a fresh trace id", () => {
      const span = tracer.startSpan("agent.turn");
      expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
      expect(span.parentSpanId).toBeUndefined();
    });

    it("exports a span to the exporter on end", () => {
      const span = tracer.startSpan("model.call");
      span.end();
      expect(exporter.size).toBe(1);
      const data = exporter.getSpans()[0]!;
      expect(data.name).toBe("model.call");
      expect(data.status.code).toBe("ok");
      expect(data.endTimeUnixMs).toBeDefined();
      expect(data.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("nests child spans under the same trace", () => {
      const root = tracer.startSpan("agent.turn");
      const child = tracer.startSpan("tool.exec", { parent: root });
      expect(child.traceId).toBe(root.traceId);
      expect(child.parentSpanId).toBe(root.spanId);
    });

    it("supports Span.startChild for nesting", () => {
      const root = tracer.startSpan("agent.turn");
      const child = root.startChild("memory.write");
      child.end();
      root.end();
      expect(child.traceId).toBe(root.traceId);
      expect(child.parentSpanId).toBe(root.spanId);
      expect(exporter.size).toBe(2);
    });

    it("records attributes and events", () => {
      const span = tracer.startSpan("tool.exec");
      span.setAttribute("tool", "web_search").setAttributes({ count: 3, ok: true });
      span.addEvent("retry", { attempt: 2 });
      span.end();
      const data = exporter.getSpans()[0]!;
      expect(data.attributes.tool).toBe("web_search");
      expect(data.attributes.count).toBe(3);
      expect(data.attributes.ok).toBe(true);
      expect(data.events).toHaveLength(1);
      expect(data.events[0]!.name).toBe("retry");
      expect(data.events[0]!.attributes.attempt).toBe(2);
    });

    it("records exceptions and sets error status", () => {
      const span = tracer.startSpan("tool.exec");
      span.recordException(new Error("boom"));
      span.end();
      const data = exporter.getSpans()[0]!;
      expect(data.status.code).toBe("error");
      expect(data.status.message).toBe("boom");
      expect(data.events[0]!.name).toBe("exception");
      expect(data.events[0]!.attributes["exception.message"]).toBe("boom");
    });

    it("is idempotent on repeated end()", () => {
      const span = tracer.startSpan("x");
      span.end();
      span.end();
      expect(exporter.size).toBe(1);
    });

    it("ignores mutation after end (recording stops)", () => {
      const span = tracer.startSpan("x");
      span.end();
      span.setAttribute("late", "value");
      expect(span.isRecording).toBe(false);
      const data = exporter.getSpans()[0]!;
      expect(data.attributes.late).toBeUndefined();
    });
  });

  describe("withSpan", () => {
    it("auto-ends a sync span and returns the value", () => {
      const exporter = new InMemorySpanExporter();
      const tracer = new Tracer(exporter);
      const result = tracer.withSpan("compute", (span) => {
        span.setAttribute("phase", "sync");
        return 42;
      });
      expect(result).toBe(42);
      expect(exporter.size).toBe(1);
      expect(exporter.getSpans()[0]!.status.code).toBe("ok");
    });

    it("records exceptions for sync throws and rethrows", () => {
      const exporter = new InMemorySpanExporter();
      const tracer = new Tracer(exporter);
      expect(() =>
        tracer.withSpan("boom", () => {
          throw new Error("nope");
        }),
      ).toThrow("nope");
      expect(exporter.getSpans()[0]!.status.code).toBe("error");
    });

    it("auto-ends an async span", async () => {
      const exporter = new InMemorySpanExporter();
      const tracer = new Tracer(exporter);
      const result = await tracer.withSpan("async-op", async () => {
        return "done";
      });
      expect(result).toBe("done");
      expect(exporter.size).toBe(1);
      expect(exporter.getSpans()[0]!.status.code).toBe("ok");
    });

    it("records exceptions for async rejections", async () => {
      const exporter = new InMemorySpanExporter();
      const tracer = new Tracer(exporter);
      await expect(
        tracer.withSpan("async-boom", async () => {
          throw new Error("async-nope");
        }),
      ).rejects.toThrow("async-nope");
      expect(exporter.getSpans()[0]!.status.code).toBe("error");
    });
  });

  describe("autoFlush=false buffering", () => {
    it("buffers finished spans until flush()", () => {
      const exporter = new InMemorySpanExporter();
      const tracer = new Tracer(exporter, { autoFlush: false });
      tracer.startSpan("a").end();
      tracer.startSpan("b").end();
      expect(exporter.size).toBe(0);
      tracer.flush();
      expect(exporter.size).toBe(2);
    });

    it("flushes on shutdown", () => {
      const exporter = new InMemorySpanExporter();
      const tracer = new Tracer(exporter, { autoFlush: false });
      tracer.startSpan("a").end();
      tracer.shutdown();
      // shutdown flushes, then the exporter's shutdown resets it.
      expect(exporter.size).toBe(0);
    });
  });

  describe("InMemorySpanExporter", () => {
    it("filters spans by trace id", () => {
      const exporter = new InMemorySpanExporter();
      const tracer = new Tracer(exporter);
      const root = tracer.startSpan("turn");
      tracer.startSpan("child", { parent: root }).end();
      root.end();
      const other = tracer.startSpan("other");
      other.end();

      const traceSpans = exporter.getTrace(root.traceId);
      expect(traceSpans).toHaveLength(2);
      expect(traceSpans.every((s) => s.traceId === root.traceId)).toBe(true);
    });

    it("evicts oldest spans beyond maxSpans", () => {
      const exporter = new InMemorySpanExporter(3);
      const tracer = new Tracer(exporter);
      for (let i = 0; i < 5; i++) tracer.startSpan(`s${i}`).end();
      expect(exporter.size).toBe(3);
    });
  });

  describe("span tree export", () => {
    function makeSpan(
      spanId: string,
      parentSpanId: string | undefined,
      startTimeUnixMs: number,
      name = spanId,
    ): SpanData {
      return {
        traceId: "trace-1",
        spanId,
        parentSpanId,
        name,
        kind: "internal",
        startTimeUnixMs,
        endTimeUnixMs: startTimeUnixMs + 1,
        durationMs: 1,
        attributes: {},
        events: [],
        status: { code: "ok" },
      };
    }

    it("builds a parent/child tree from a flat span list", () => {
      const spans: SpanData[] = [
        makeSpan("root", undefined, 100),
        makeSpan("a", "root", 110),
        makeSpan("b", "root", 120),
        makeSpan("a1", "a", 115),
      ];
      const tree = buildSpanTree(spans);
      expect(tree).toHaveLength(1);
      const root = tree[0]!;
      expect(root.spanId).toBe("root");
      expect(root.children.map((c) => c.spanId)).toEqual(["a", "b"]);
      const a = root.children[0]!;
      expect(a.children).toHaveLength(1);
      expect(a.children[0]!.spanId).toBe("a1");
    });

    it("orders siblings by start time", () => {
      const spans: SpanData[] = [
        makeSpan("root", undefined, 0),
        makeSpan("late", "root", 300),
        makeSpan("early", "root", 100),
        makeSpan("mid", "root", 200),
      ];
      const tree = buildSpanTree(spans);
      expect(tree[0]!.children.map((c) => c.spanId)).toEqual(["early", "mid", "late"]);
    });

    it("treats spans with missing parents as roots", () => {
      const spans: SpanData[] = [
        makeSpan("orphan", "ghost-parent", 100),
        makeSpan("root", undefined, 50),
      ];
      const tree = buildSpanTree(spans);
      expect(tree.map((n) => n.spanId).sort()).toEqual(["orphan", "root"]);
    });

    it("exports the tree as JSON round-trippable to the same structure", () => {
      const exporter = new InMemorySpanExporter();
      const tracer = new Tracer(exporter);
      const root = tracer.startSpan("agent.turn");
      const model = root.startChild("model.call", { kind: "client" });
      const tool = root.startChild("tool.exec");
      model.end();
      tool.end();
      root.end();

      const json = exportSpanTreeJson(exporter.getTrace(root.traceId));
      const parsed = JSON.parse(json);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe("agent.turn");
      expect(parsed[0].children).toHaveLength(2);
      const childNames = parsed[0].children.map((c: { name: string }) => c.name);
      expect(childNames).toContain("model.call");
      expect(childNames).toContain("tool.exec");
    });

    it("supports pretty-printed JSON", () => {
      const spans = [makeSpan("root", undefined, 0)];
      const pretty = exportSpanTreeJson(spans, true);
      expect(pretty).toContain("\n");
      expect(pretty).toContain('  "spanId"');
    });
  });
});
