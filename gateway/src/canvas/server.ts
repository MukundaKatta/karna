// ─── Canvas System ──────────────────────────────────────────────────────────
// Agent-driven visual workspace for rendering HTML/CSS/JS.
// Supports push (update content), eval (run JS), snapshot (capture state),
// and reset operations. Inspired by OpenClaw's Canvas + A2UI.

import pino from "pino";
import { nanoid } from "nanoid";

const logger = pino({ name: "canvas" });

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CanvasState {
  id: string;
  sessionId: string;
  content: string;
  contentType: "html" | "markdown" | "json" | "text";
  title?: string;
  createdAt: number;
  updatedAt: number;
  version: number;
  snapshots: CanvasSnapshot[];
}

export interface CanvasSnapshot {
  id: string;
  content: string;
  capturedAt: number;
  label?: string;
}

export interface CanvasPushParams {
  sessionId: string;
  content: string;
  contentType?: CanvasState["contentType"];
  title?: string;
  /** If true, append to existing content instead of replacing */
  append?: boolean;
}

export interface CanvasEvalParams {
  sessionId: string;
  /** JavaScript code to evaluate in the canvas context */
  code: string;
}

// ─── Canvas Manager ────────────────────────────────────────────────────────

export class CanvasManager {
  private readonly canvases = new Map<string, CanvasState>();
  private readonly maxSnapshots: number;

  constructor(maxSnapshots = 10) {
    this.maxSnapshots = maxSnapshots;
  }

  /**
   * Push content to a session's canvas.
   * Creates the canvas if it doesn't exist.
   */
  push(params: CanvasPushParams): CanvasState {
    const existing = this.canvases.get(params.sessionId);

    if (existing) {
      if (params.append) {
        existing.content += params.content;
      } else {
        existing.content = params.content;
      }
      if (params.contentType) existing.contentType = params.contentType;
      if (params.title) existing.title = params.title;
      existing.updatedAt = Date.now();
      existing.version++;

      logger.debug(
        { sessionId: params.sessionId, version: existing.version, contentType: existing.contentType },
        "Canvas updated",
      );

      return existing;
    }

    const canvas: CanvasState = {
      id: `canvas_${nanoid(8)}`,
      sessionId: params.sessionId,
      content: params.content,
      contentType: params.contentType ?? "html",
      title: params.title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 1,
      snapshots: [],
    };

    this.canvases.set(params.sessionId, canvas);

    logger.info(
      { sessionId: params.sessionId, canvasId: canvas.id, contentType: canvas.contentType },
      "Canvas created",
    );

    return canvas;
  }

  /**
   * Get the current canvas state for a session.
   */
  get(sessionId: string): CanvasState | null {
    return this.canvases.get(sessionId) ?? null;
  }

  /**
   * Capture a snapshot of the current canvas state.
   */
  snapshot(sessionId: string, label?: string): CanvasSnapshot | null {
    const canvas = this.canvases.get(sessionId);
    if (!canvas) return null;

    const snap: CanvasSnapshot = {
      id: `snap_${nanoid(6)}`,
      content: canvas.content,
      capturedAt: Date.now(),
      label,
    };

    canvas.snapshots.push(snap);

    // Keep only the most recent snapshots
    if (canvas.snapshots.length > this.maxSnapshots) {
      canvas.snapshots = canvas.snapshots.slice(-this.maxSnapshots);
    }

    logger.debug({ sessionId, snapshotId: snap.id, label }, "Canvas snapshot captured");

    return snap;
  }

  /**
   * Evaluate JavaScript in the canvas context.
   * In a real implementation, this would send the code to a sandboxed renderer.
   * Here we just record the eval request for the client to execute.
   */
  eval(params: CanvasEvalParams): { success: boolean; evalId: string } {
    const canvas = this.canvases.get(params.sessionId);
    if (!canvas) {
      return { success: false, evalId: "" };
    }

    const evalId = `eval_${nanoid(6)}`;
    logger.debug({ sessionId: params.sessionId, evalId, codeLength: params.code.length }, "Canvas eval queued");

    return { success: true, evalId };
  }

  /**
   * Reset (clear) the canvas for a session.
   */
  reset(sessionId: string): boolean {
    const existed = this.canvases.delete(sessionId);
    if (existed) {
      logger.info({ sessionId }, "Canvas reset");
    }
    return existed;
  }

  /**
   * Get all active canvas count.
   */
  get size(): number {
    return this.canvases.size;
  }

  /**
   * Render canvas content as a full HTML page (for serving via HTTP).
   */
  renderHtml(sessionId: string): string | null {
    const canvas = this.canvases.get(sessionId);
    if (!canvas) return null;

    if (canvas.contentType === "html") {
      // If already full HTML, return as-is
      if (canvas.content.includes("<html") || canvas.content.includes("<!DOCTYPE")) {
        return canvas.content;
      }
      // Wrap in a basic page
      return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(canvas.title ?? "Karna Canvas")}</title>
  <style>body { font-family: system-ui, sans-serif; margin: 2rem; }</style>
</head>
<body>
${canvas.content}
</body>
</html>`;
    }

    if (canvas.contentType === "markdown") {
      return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(canvas.title ?? "Karna Canvas")}</title>
  <style>body { font-family: system-ui, sans-serif; margin: 2rem; max-width: 800px; }</style>
</head>
<body>
<pre style="white-space: pre-wrap;">${escapeHtml(canvas.content)}</pre>
</body>
</html>`;
    }

    // JSON or text
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(canvas.title ?? "Karna Canvas")}</title>
  <style>body { font-family: monospace; margin: 2rem; }</style>
</head>
<body>
<pre>${escapeHtml(canvas.content)}</pre>
</body>
</html>`;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
