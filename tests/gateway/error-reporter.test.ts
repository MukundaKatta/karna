import { describe, expect, it } from "vitest";
import {
  ConsoleErrorReporter,
  InMemoryErrorReporter,
  NoopErrorReporter,
  REDACTED,
  buildErrorEvent,
  createErrorReporter,
  scrubContext,
  scrubString,
  scrubValue,
} from "../../gateway/src/observability/error-reporter.js";

describe("PII scrubbing", () => {
  it("redacts emails, cards, and bearer tokens in free text", () => {
    expect(scrubString("contact alice@example.com")).toBe(`contact ${REDACTED}`);
    expect(scrubString("card 4111 1111 1111 1111 ok")).toBe(`card ${REDACTED} ok`);
    expect(scrubString("card 4111111111111111 ok")).toBe(`card ${REDACTED} ok`);
    expect(scrubString("Authorization: Bearer abc.def-123")).toContain(`Bearer ${REDACTED}`);
  });

  it("redacts sensitive object keys wholesale and scrubs nested strings", () => {
    const out = scrubValue({
      password: "hunter2",
      apiKey: "sk-live-xyz",
      nested: { email: "bob@x.io", note: "fine" },
    }) as Record<string, any>;
    expect(out.password).toBe(REDACTED);
    expect(out.apiKey).toBe(REDACTED);
    expect(out.nested.email).toBe(REDACTED);
    expect(out.nested.note).toBe("fine");
  });

  it("handles circular references safely", () => {
    const obj: any = { a: 1 };
    obj.self = obj;
    const out = scrubValue(obj) as Record<string, any>;
    expect(out.a).toBe(1);
    expect(out.self).toBe("[CIRCULAR]");
  });

  it("scrubs context extra and tags", () => {
    const ctx = scrubContext({
      sessionId: "s1",
      extra: { token: "secret", msg: "email me at z@z.com" },
      tags: { authorization: "Bearer t", region: "us" },
    });
    expect(ctx.sessionId).toBe("s1");
    expect((ctx.extra as any).token).toBe(REDACTED);
    expect((ctx.extra as any).msg).toBe(`email me at ${REDACTED}`);
    expect(ctx.tags?.authorization).toBe(REDACTED);
    expect(ctx.tags?.region).toBe("us");
  });
});

describe("buildErrorEvent", () => {
  it("normalizes an Error and scrubs its message/stack", () => {
    const event = buildErrorEvent({
      message: "failed for user a@b.com",
      severity: "error",
      error: new Error("token leaked: Bearer xyz"),
      context: { traceId: "t1", release: "v1.2.3" },
    });
    expect(event.severity).toBe("error");
    expect(event.message).toContain(REDACTED);
    expect(event.exception?.type).toBe("Error");
    expect(event.exception?.message).toContain(`Bearer ${REDACTED}`);
    expect(event.context.traceId).toBe("t1");
    expect(event.context.release).toBe("v1.2.3");
    expect(event.eventId).toHaveLength(32);
  });
});

describe("reporters", () => {
  it("NoopErrorReporter captures nothing and returns empty ids", () => {
    const r = new NoopErrorReporter();
    expect(r.captureException(new Error("x"))).toBe("");
    expect(r.captureMessage("hi")).toBe("");
  });

  it("InMemoryErrorReporter buffers scrubbed events", () => {
    const r = new InMemoryErrorReporter();
    const id = r.captureException(new Error("boom a@b.com"), { sessionId: "s" });
    r.captureMessage("note", "info");
    expect(id).toHaveLength(32);
    expect(r.size).toBe(2);
    const events = r.getEvents();
    expect(events[0]?.exception?.message).toContain(REDACTED);
    expect(events[0]?.context.sessionId).toBe("s");
    expect(events[1]?.severity).toBe("info");
  });

  it("InMemoryErrorReporter respects maxEvents", () => {
    const r = new InMemoryErrorReporter({ maxEvents: 2 });
    r.captureMessage("1");
    r.captureMessage("2");
    r.captureMessage("3");
    expect(r.size).toBe(2);
    expect(r.getEvents().map((e) => e.message)).toEqual(["2", "3"]);
  });

  it("ConsoleErrorReporter returns a stable event id", () => {
    const r = new ConsoleErrorReporter();
    expect(r.captureException(new Error("x"))).toHaveLength(32);
  });
});

describe("createErrorReporter (config-gated)", () => {
  it("returns a no-op when disabled (default)", () => {
    const r = createErrorReporter();
    expect(r).toBeInstanceOf(NoopErrorReporter);
    expect(createErrorReporter({ enabled: false, backend: "memory" })).toBeInstanceOf(
      NoopErrorReporter,
    );
  });

  it("returns the configured backend when enabled", () => {
    expect(createErrorReporter({ enabled: true, backend: "memory" })).toBeInstanceOf(
      InMemoryErrorReporter,
    );
    expect(createErrorReporter({ enabled: true, backend: "console" })).toBeInstanceOf(
      ConsoleErrorReporter,
    );
    expect(createErrorReporter({ enabled: true, backend: "noop" })).toBeInstanceOf(
      NoopErrorReporter,
    );
  });
});
