CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  persona TEXT,
  system_prompt TEXT,
  model_primary TEXT DEFAULT 'claude-sonnet-4-6',
  model_fallback TEXT DEFAULT 'claude-haiku-4-5',
  model_local TEXT,
  heartbeat_interval INTEGER DEFAULT 1800,
  heartbeat_checklist TEXT,
  tools_allowlist TEXT[],
  tools_denylist TEXT[],
  sandbox_mode BOOLEAN DEFAULT true,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now()
);
