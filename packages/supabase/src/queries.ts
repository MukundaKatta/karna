import type { SupabaseClient } from '@supabase/supabase-js';

/* ------------------------------------------------------------------ */
/*  Agents                                                            */
/* ------------------------------------------------------------------ */

export async function getAgent(client: SupabaseClient, agentId: string) {
  const { data, error } = await client
    .from('agents')
    .select('*')
    .eq('id', agentId)
    .single();

  if (error) throw error;
  return data;
}

/* ------------------------------------------------------------------ */
/*  Sessions                                                          */
/* ------------------------------------------------------------------ */

export async function createSession(
  client: SupabaseClient,
  params: {
    agentId: string;
    channel: string;
    channelId?: string;
    userId?: string;
  },
) {
  const { data, error } = await client
    .from('sessions')
    .insert({
      agent_id: params.agentId,
      channel: params.channel,
      channel_id: params.channelId ?? null,
      user_id: params.userId ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateSessionStats(
  client: SupabaseClient,
  sessionId: string,
  stats: {
    tokens: number;
    cost: number;
  },
) {
  const { error } = await client.rpc('update_session_stats', {
    p_session_id: sessionId,
    p_tokens: stats.tokens,
    p_cost: stats.cost,
  });

  // Fallback to manual update if RPC not available
  if (error) {
    const { error: updateError } = await client
      .from('sessions')
      .update({
        total_tokens: stats.tokens,
        total_cost: stats.cost,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId);

    if (updateError) throw updateError;
  }
}

/* ------------------------------------------------------------------ */
/*  Messages                                                          */
/* ------------------------------------------------------------------ */

export async function addMessage(
  client: SupabaseClient,
  params: {
    sessionId: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content?: string;
    toolCalls?: unknown;
    toolResults?: unknown;
    model?: string;
    promptTokens?: number;
    completionTokens?: number;
    cost?: number;
    latencyMs?: number;
  },
) {
  const { data, error } = await client
    .from('messages')
    .insert({
      session_id: params.sessionId,
      role: params.role,
      content: params.content ?? null,
      tool_calls: params.toolCalls ?? null,
      tool_results: params.toolResults ?? null,
      model: params.model ?? null,
      prompt_tokens: params.promptTokens ?? 0,
      completion_tokens: params.completionTokens ?? 0,
      cost: params.cost ?? 0,
      latency_ms: params.latencyMs ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/* ------------------------------------------------------------------ */
/*  Memories                                                          */
/* ------------------------------------------------------------------ */

export async function searchMemories(
  client: SupabaseClient,
  params: {
    agentId: string;
    embedding: number[];
    matchCount?: number;
    matchThreshold?: number;
    category?: string;
  },
) {
  const { data, error } = await client.rpc('match_memories', {
    p_agent_id: params.agentId,
    p_embedding: params.embedding,
    p_match_count: params.matchCount ?? 10,
    p_match_threshold: params.matchThreshold ?? 0.7,
    p_category: params.category ?? null,
  });

  if (error) throw error;
  return data;
}
