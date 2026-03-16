import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type { SupabaseClient };

export function createSupabaseClient(
  url?: string,
  anonKey?: string,
): SupabaseClient {
  const supabaseUrl = url ?? process.env.SUPABASE_URL;
  const supabaseKey = anonKey ?? process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      'Missing Supabase credentials. Provide SUPABASE_URL and SUPABASE_ANON_KEY.',
    );
  }

  return createClient(supabaseUrl, supabaseKey);
}

export { createSession, addMessage, searchMemories, getAgent, updateSessionStats } from './queries.js';
