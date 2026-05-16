import { nanoid } from "nanoid";
import type { ConnectedClient } from "../protocol/handler.js";

export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 30_000;

export interface ShutdownNotice {
  id: string;
  type: "server.shutdown";
  timestamp: number;
  payload: {
    signal: string;
    message: string;
    timeoutMs: number;
    retryable: true;
  };
}

export function buildShutdownNotice(
  signal: string,
  timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
): ShutdownNotice {
  return {
    id: nanoid(),
    type: "server.shutdown",
    timestamp: Date.now(),
    payload: {
      signal,
      message: "Gateway is restarting. Please reconnect shortly.",
      timeoutMs,
      retryable: true,
    },
  };
}

export function notifyClientsOfShutdown(
  clients: Iterable<ConnectedClient>,
  signal: string,
  timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
): number {
  const notice = JSON.stringify(buildShutdownNotice(signal, timeoutMs));
  let notified = 0;

  for (const client of clients) {
    try {
      client.ws.send(notice);
      notified += 1;
    } catch {
      // Best effort only; the close frame below still drains the socket.
    }
  }

  return notified;
}

export function closeClientsForShutdown(clients: Map<string, ConnectedClient>): number {
  let closed = 0;

  for (const [clientId, client] of clients) {
    try {
      client.ws.close(1001, "Server shutting down");
      closed += 1;
    } catch {
      // Ignore errors closing connections during shutdown.
    }
    clients.delete(clientId);
  }

  return closed;
}

export function trackInFlight<T>(
  inFlight: Set<Promise<unknown>>,
  operation: Promise<T>,
): Promise<T> {
  inFlight.add(operation);
  operation.finally(() => {
    inFlight.delete(operation);
  });
  return operation;
}

export async function waitForInFlight(
  inFlight: Set<Promise<unknown>>,
  timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
): Promise<"completed" | "timeout"> {
  if (inFlight.size === 0) return "completed";

  const timeout = new Promise<"timeout">((resolve) => {
    setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const drained = Promise.allSettled(Array.from(inFlight)).then(() => "completed" as const);

  return Promise.race([drained, timeout]);
}
