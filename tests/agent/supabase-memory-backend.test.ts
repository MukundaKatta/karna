import { describe, it, expect, vi, beforeEach } from "vitest";
import { SupabaseMemoryBackend } from "../../agent/src/memory/supabase-backend.js";

function createClient(overrides?: {
  insertRow?: Record<string, unknown>;
  getRow?: Record<string, unknown> | null;
  searchRows?: Record<string, unknown>[];
}) {
  const insertRow = overrides?.insertRow ?? {
    id: "mem-1",
    content: "Remember this",
    created_at: "2026-04-20T00:00:00.000Z",
    updated_at: "2026-04-20T00:00:00.000Z",
    accessed_at: "2026-04-20T00:00:00.000Z",
    access_count: 0,
    decay_factor: 1,
    source_session_id: "session-1",
    category: "preference",
    importance: 0.85,
  };
  const getRow = overrides?.getRow ?? insertRow;
  const searchRows = overrides?.searchRows ?? [
    {
      ...insertRow,
      similarity: 0.91,
    },
  ];

  const eqSingle = vi.fn().mockResolvedValue({ data: getRow, error: null });
  const updateEq = vi.fn().mockResolvedValue({ error: null });
  const deleteEq = vi.fn().mockResolvedValue({ error: null, count: 1 });
  let lastUpdatePayload: Record<string, unknown> | null = null;

  const client = {
    from: vi.fn((_table: string) => ({
      insert: vi.fn((_payload: unknown) => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: insertRow, error: null }),
        })),
      })),
      select: vi.fn((_cols?: string) => ({
        eq: vi.fn((_col: string, _val: string) => ({
          maybeSingle: eqSingle,
        })),
      })),
      delete: vi.fn((_opts?: unknown) => ({
        eq: deleteEq,
      })),
      update: vi.fn((payload: unknown) => {
        lastUpdatePayload = payload as Record<string, unknown>;
        return ({
        eq: updateEq,
        });
      }),
    })),
    rpc: vi.fn().mockResolvedValue({ data: searchRows, error: null }),
  };

  return { client, eqSingle, updateEq, getLastUpdatePayload: () => lastUpdatePayload };
}

describe("SupabaseMemoryBackend", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("saves and maps memory rows into MemoryEntry shape", async () => {
    const { client } = createClient();
    const backend = new SupabaseMemoryBackend(client as never);

    const entry = await backend.save({
      agentId: "agent-1",
      content: "Remember this",
      source: "conversation",
      priority: "high",
      sessionId: "session-1",
      category: "preference",
    });

    expect(entry.id).toBe("mem-1");
    expect(entry.sessionId).toBe("session-1");
    expect(entry.priority).toBe("high");
    expect(entry.source).toBe("conversation");
    expect(entry.category).toBe("preference");
  });

  it("searches memories through the pgvector RPC and preserves scores", async () => {
    const { client } = createClient();
    const backend = new SupabaseMemoryBackend(client as never);

    const results = await backend.search({
      agentId: "agent-1",
      embedding: [0.1, 0.2, 0.3],
      limit: 5,
      minRelevance: 0.8,
      category: "preference",
    });

    expect(client.rpc).toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0]?.score).toBe(0.91);
  });

  it("increments access_count when updating access metadata", async () => {
    const { client, updateEq, getLastUpdatePayload } = createClient({
      getRow: {
        id: "mem-1",
        content: "Remember this",
        created_at: "2026-04-20T00:00:00.000Z",
        updated_at: "2026-04-20T00:00:00.000Z",
        accessed_at: "2026-04-20T00:00:00.000Z",
        access_count: 4,
        decay_factor: 1,
        importance: 0.5,
      },
    });
    const backend = new SupabaseMemoryBackend(client as never);

    await backend.updateAccessedAt("mem-1");

    expect(updateEq).toHaveBeenCalled();
    expect(getLastUpdatePayload()?.["access_count"]).toBe(5);
  });
});
