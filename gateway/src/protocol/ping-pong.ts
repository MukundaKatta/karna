export const DEFAULT_WS_PING_INTERVAL_MS = 30_000;
export const DEFAULT_WS_PONG_TIMEOUT_MS = 10_000;

export interface PingableWebSocket {
  ping(): void;
  close(code?: number, reason?: string): void;
  on(event: "pong" | "close" | "error", listener: (...args: unknown[]) => void): unknown;
}

export interface WebSocketPingPongOptions {
  pingIntervalMs?: number;
  pongTimeoutMs?: number;
  onPingError?: (error: unknown) => void;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

export interface WebSocketPingPongController {
  stop(): void;
}

export function startWebSocketPingPong(
  socket: PingableWebSocket,
  options: WebSocketPingPongOptions = {},
): WebSocketPingPongController {
  if (options.pingIntervalMs != null && options.pingIntervalMs <= 0) {
    throw new Error(
      `pingIntervalMs must be a positive number, got ${options.pingIntervalMs}`,
    );
  }
  if (options.pongTimeoutMs != null && options.pongTimeoutMs <= 0) {
    throw new Error(
      `pongTimeoutMs must be a positive number, got ${options.pongTimeoutMs}`,
    );
  }

  const pingIntervalMs = options.pingIntervalMs ?? DEFAULT_WS_PING_INTERVAL_MS;
  const pongTimeoutMs = options.pongTimeoutMs ?? DEFAULT_WS_PONG_TIMEOUT_MS;
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;

  let stopped = false;
  let pongTimer: ReturnType<typeof setTimeout> | null = null;

  const clearPongTimer = () => {
    if (!pongTimer) return;
    clearTimeoutFn(pongTimer);
    pongTimer = null;
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearIntervalFn(interval);
    clearPongTimer();
  };

  const interval = setIntervalFn(() => {
    if (stopped) return;

    clearPongTimer();
    pongTimer = setTimeoutFn(() => {
      stop();
      socket.close(1001, "WebSocket pong timeout");
    }, pongTimeoutMs);

    try {
      socket.ping();
    } catch (error) {
      options.onPingError?.(error);
      stop();
      socket.close(1011, "WebSocket ping failed");
    }
  }, pingIntervalMs);

  socket.on("pong", clearPongTimer);
  socket.on("close", stop);
  socket.on("error", stop);

  return { stop };
}
