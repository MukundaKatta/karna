import { describe, expect, it, vi } from "vitest";
import { startWebSocketPingPong } from "../../gateway/src/protocol/ping-pong.js";

class FakeSocket {
  ping = vi.fn();
  close = vi.fn();
  private listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  on(event: "pong" | "close" | "error", listener: (...args: unknown[]) => void): void {
    const existing = this.listeners.get(event) ?? [];
    existing.push(listener);
    this.listeners.set(event, existing);
  }

  emit(event: "pong" | "close" | "error"): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener();
    }
  }
}

describe("WebSocket ping/pong keepalive", () => {
  it("sends ping frames on the configured interval", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();

    const controller = startWebSocketPingPong(socket, {
      pingIntervalMs: 30_000,
      pongTimeoutMs: 10_000,
    });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(socket.ping).toHaveBeenCalledTimes(1);
    expect(socket.close).not.toHaveBeenCalled();

    socket.emit("pong");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(socket.close).not.toHaveBeenCalled();

    controller.stop();
    vi.useRealTimers();
  });

  it("closes half-open sockets when pong is missing", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();

    startWebSocketPingPong(socket, {
      pingIntervalMs: 30_000,
      pongTimeoutMs: 10_000,
    });

    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(socket.close).toHaveBeenCalledWith(1001, "WebSocket pong timeout");
    vi.useRealTimers();
  });

  it("stops timers when the socket closes", async () => {
    vi.useFakeTimers();
    const socket = new FakeSocket();

    startWebSocketPingPong(socket, {
      pingIntervalMs: 30_000,
      pongTimeoutMs: 10_000,
    });

    socket.emit("close");
    await vi.advanceTimersByTimeAsync(90_000);

    expect(socket.ping).not.toHaveBeenCalled();
    expect(socket.close).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
