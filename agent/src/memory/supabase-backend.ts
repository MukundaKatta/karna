import type { SupabaseClient } from "@supabase/supabase-js";
import pino from "pino";
import type { MemoryEntry } from "@karna/shared/types/memory.js";
import { searchMemories } from "@karna/supabase";
import type { MemoryBackend, MemorySearchParams, SaveMemoryInput, ScoredMemory } from "./store.js";

const logger = pino({ name: "supabase-memory-backend" });

function mapPriorityToImportance(priority?: SaveMemoryInput["priority"]): number {
  switch (priority) {
    case "critical":
      return 1.0;
    case "high":
      return 0.85;
    case "low":
      return 0.25;
    default:
      return 0.5;
  }
}

function mapImportanceToPriority(importance?: number): MemoryEntry["priority"] {
  if ((importance ?? 0.5) >= 0.95) return "critical";
  if ((importance ?? 0.5) >= 0.75) return "high";
  if ((importance ?? 0.5) <= 0.3) return "low";
  return "normal";
}

function mapRowToEntry(row: Record<string, unknown>): MemoryEntry {
  const createdAt = Date.parse(String(row["created_at"] ?? Date.now()));
  const updatedAt = Date.parse(String(row["updated_at"] ?? row["created_at"] ?? Date.now()));
  const accessedAt = Date.parse(String(row["accessed_at"] ?? row["last_accessed_at"] ?? row["created_at"] ?? Date.now()));
  const expiresAtRaw = row["expires_at"];
  const expiresAt = expiresAtRaw ? Date.parse(String(expiresAtRaw)) : undefined;

  return {
    id: String(row["id"]),
    sessionId: row["source_session_id"] ? String(row["source_session_id"]) : undefined,
    userId: undefined,
    content: String(row["content"] ?? ""),
    summary: undefined,
    embedding: Array.isArray(row["embedding"]) ? (row["embedding"] as number[]) : undefined,
    source: "conversation",
    priority: mapImportanceToPriority(typeof row["importance"] === "number" ? row["importance"] : undefined),
    tags: [],
    category: row["category"] ? String(row["category"]) : undefined,
    relatedMessageIds: [],
    relatedMemoryIds: [],
    createdAt: Number.isNaN(createdAt) ? Date.now() : createdAt,
    updatedAt: Number.isNaN(updatedAt) ? Date.now() : updatedAt,
    accessedAt: Number.isNaN(accessedAt) ? Date.now() : accessedAt,
    expiresAt: expiresAt !== undefined && !Number.isNaN(expiresAt) ? expiresAt : undefined,
    accessCount: Number(row["access_count"] ?? 0),
    decayFactor: Number(row["decay_factor"] ?? 1),
  };
}

export class SupabaseMemoryBackend implements MemoryBackend {
  constructor(private readonly client: SupabaseClient) {}

  async save(input: SaveMemoryInput): Promise<MemoryEntry> {
    const payload = {
      agent_id: input.agentId,
      content: input.content,
      category: input.category ?? null,
      source_session_id: input.sessionId ?? null,
      embedding: input.embedding ?? null,
      importance: mapPriorityToImportance(input.priority),
      expires_at: input.expiresAt ? new Date(input.expiresAt).toISOString() : null,
    };

    const { data, error } = await this.client
      .from("memories")
      .insert(payload)
      .select("*")
      .single();

    if (error || !data) {
      logger.error({ error, agentId: input.agentId }, "Failed to save memory to Supabase");
      throw error ?? new Error("Failed to save memory");
    }

    return mapRowToEntry(data as Record<string, unknown>);
  }

  async search(params: MemorySearchParams): Promise<ScoredMemory[]> {
    const rows = await searchMemories(this.client, {
      agentId: params.agentId,
      embedding: params.embedding,
      matchCount: params.limit,
      matchThreshold: params.minRelevance,
      category: params.category,
    });

    return (rows ?? []).map((row: Record<string, unknown>) => {
      const entry = mapRowToEntry(row);
      return {
        ...entry,
        score: Number(row["similarity"] ?? row["score"] ?? 0),
      };
    });
  }

  async getById(id: string): Promise<MemoryEntry | null> {
    const { data, error } = await this.client
      .from("memories")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;
    return mapRowToEntry(data as Record<string, unknown>);
  }

  async listByAgent(agentId: string): Promise<MemoryEntry[]> {
    const { data, error } = await this.client
      .from("memories")
      .select("*")
      .eq("agent_id", agentId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return (data ?? []).map((row) => mapRowToEntry(row as Record<string, unknown>));
  }

  async delete(id: string): Promise<boolean> {
    const { error, count } = await this.client
      .from("memories")
      .delete({ count: "exact" })
      .eq("id", id);

    if (error) throw error;
    return (count ?? 0) > 0;
  }

  async updateAccessedAt(id: string): Promise<void> {
    const current = await this.getById(id);
    if (!current) return;

    const { error } = await this.client
      .from("memories")
      .update({
        accessed_at: new Date().toISOString(),
        access_count: current.accessCount + 1,
      })
      .eq("id", id);

    if (error) {
      logger.warn({ error, id }, "Failed to update memory access metadata");
    }
  }
}
