-- ─── API Keys ───────────────────────────────────────────────────────────────
-- Stores hashed API keys for programmatic access to the Karna Cloud API.
-- The raw key is shown to the user exactly once at creation time.

CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL, -- First 12 chars for identification (e.g. "karna_abc123")
  permissions TEXT[] NOT NULL DEFAULT ARRAY['read', 'write'],
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash) WHERE revoked_at IS NULL;
CREATE INDEX idx_api_keys_expires_at ON api_keys(expires_at) WHERE expires_at IS NOT NULL AND revoked_at IS NULL;

-- Row Level Security
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY api_keys_select_own ON api_keys
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY api_keys_insert_own ON api_keys
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY api_keys_update_own ON api_keys
  FOR UPDATE USING (auth.uid() = user_id);
