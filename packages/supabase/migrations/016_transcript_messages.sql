-- Searchable imports for local JSONL session transcripts.

CREATE TABLE IF NOT EXISTS transcript_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  message_timestamp TIMESTAMPTZ NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  search_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(content, ''))
  ) STORED
);

CREATE INDEX IF NOT EXISTS idx_transcript_messages_session_id
  ON transcript_messages(session_id);

CREATE INDEX IF NOT EXISTS idx_transcript_messages_timestamp
  ON transcript_messages(message_timestamp);

CREATE INDEX IF NOT EXISTS idx_transcript_messages_search
  ON transcript_messages USING GIN(search_vector);

ALTER TABLE transcript_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY transcript_messages_service_role_all ON transcript_messages
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
