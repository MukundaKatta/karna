import { describe, it, expect, beforeEach } from "vitest";
import { CanvasManager } from "../../gateway/src/canvas/server.js";

describe("CanvasManager", () => {
  let canvas: CanvasManager;

  beforeEach(() => {
    canvas = new CanvasManager(5);
  });

  it("creates canvas on push", () => {
    const state = canvas.push({ sessionId: "s1", content: "<h1>Hello</h1>" });
    expect(state.id).toBeTruthy();
    expect(state.content).toBe("<h1>Hello</h1>");
    expect(state.contentType).toBe("html");
    expect(state.version).toBe(1);
  });

  it("updates existing canvas on push", () => {
    canvas.push({ sessionId: "s1", content: "v1" });
    const state = canvas.push({ sessionId: "s1", content: "v2" });
    expect(state.content).toBe("v2");
    expect(state.version).toBe(2);
  });

  it("appends content when append=true", () => {
    canvas.push({ sessionId: "s1", content: "Hello " });
    const state = canvas.push({ sessionId: "s1", content: "World", append: true });
    expect(state.content).toBe("Hello World");
  });

  it("gets canvas state", () => {
    canvas.push({ sessionId: "s1", content: "test", title: "My Canvas" });
    const state = canvas.get("s1");
    expect(state?.title).toBe("My Canvas");
    expect(canvas.get("unknown")).toBeNull();
  });

  it("captures snapshots", () => {
    canvas.push({ sessionId: "s1", content: "snapshot me" });
    const snap = canvas.snapshot("s1", "before-edit");
    expect(snap?.label).toBe("before-edit");
    expect(snap?.content).toBe("snapshot me");

    const state = canvas.get("s1");
    expect(state?.snapshots).toHaveLength(1);
  });

  it("limits snapshots to maxSnapshots", () => {
    canvas.push({ sessionId: "s1", content: "test" });
    for (let i = 0; i < 10; i++) {
      canvas.snapshot("s1", `snap-${i}`);
    }
    const state = canvas.get("s1");
    expect(state?.snapshots.length).toBeLessThanOrEqual(5);
  });

  it("resets canvas", () => {
    canvas.push({ sessionId: "s1", content: "test" });
    expect(canvas.reset("s1")).toBe(true);
    expect(canvas.get("s1")).toBeNull();
    expect(canvas.reset("unknown")).toBe(false);
  });

  it("evaluates code (queues eval)", () => {
    canvas.push({ sessionId: "s1", content: "test" });
    const result = canvas.eval({ sessionId: "s1", code: "document.title" });
    expect(result.success).toBe(true);
    expect(result.evalId).toBeTruthy();
  });

  it("returns failure for eval on nonexistent canvas", () => {
    const result = canvas.eval({ sessionId: "unknown", code: "test" });
    expect(result.success).toBe(false);
  });

  it("renders HTML page", () => {
    canvas.push({ sessionId: "s1", content: "<h1>Title</h1>" });
    const html = canvas.renderHtml("s1");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<h1>Title</h1>");
  });

  it("renders markdown as pre-formatted", () => {
    canvas.push({ sessionId: "s1", content: "# Heading", contentType: "markdown" });
    const html = canvas.renderHtml("s1");
    expect(html).toContain("# Heading");
    expect(html).toContain("<pre");
  });

  it("returns null for unknown canvas render", () => {
    expect(canvas.renderHtml("unknown")).toBeNull();
  });

  it("tracks canvas count", () => {
    expect(canvas.size).toBe(0);
    canvas.push({ sessionId: "s1", content: "a" });
    canvas.push({ sessionId: "s2", content: "b" });
    expect(canvas.size).toBe(2);
  });
});
