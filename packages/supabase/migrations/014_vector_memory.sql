-- 014: Enhanced memory with 3-tier system and RAG support
-- Requires pgvector extension (already enabled in 004_memory.sql)

-- Add tier and metadata columns to memories table
ALTER TABLE memories
  ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'long' CHECK (tier IN ('working', 'short', 'long')),
  ADD COLUMN IF NOT EXISTS access_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS decay_factor REAL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS accessed_at TIMESTAMPTZ DEFAULT NOW();

-- Create HNSW index for faster vector search (better than IVFFlat at this scale)
DROP INDEX IF EXISTS idx_memories_embedding;
CREATE INDEX IF NOT EXISTS idx_memories_embedding_hnsw
  ON memories USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Full-text search support for hybrid retrieval
ALTER TABLE memories ADD COLUMN IF NOT EXISTS fts tsvector;

UPDATE memories SET fts = to_tsvector('english', content) WHERE fts IS NULL;

CREATE INDEX IF NOT EXISTS idx_memories_fts ON memories USING gin(fts);

-- Trigger to auto-update fts column
CREATE OR REPLACE FUNCTION update_memories_fts() RETURNS TRIGGER AS $$
BEGIN
  NEW.fts := to_tsvector('english', NEW.content);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_memories_fts ON memories;
CREATE TRIGGER trg_memories_fts
  BEFORE INSERT OR UPDATE OF content ON memories
  FOR EACH ROW EXECUTE FUNCTION update_memories_fts();

-- Documents table for RAG ingestion tracking
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  title TEXT,
  source TEXT,
  document_type TEXT DEFAULT 'text',
  chunk_count INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_documents_agent_id ON documents(agent_id);

-- Document chunks table
CREATE TABLE IF NOT EXISTS document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  token_count INTEGER DEFAULT 0,
  embedding vector(1536),
  fts tsvector,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_agent_id ON document_chunks(agent_id);
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw
  ON document_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS idx_chunks_fts ON document_chunks USING gin(fts);

-- Trigger for document_chunks fts
CREATE OR REPLACE FUNCTION update_chunks_fts() RETURNS TRIGGER AS $$
BEGIN
  NEW.fts := to_tsvector('english', NEW.content);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_chunks_fts ON document_chunks;
CREATE TRIGGER trg_chunks_fts
  BEFORE INSERT OR UPDATE OF content ON document_chunks
  FOR EACH ROW EXECUTE FUNCTION update_chunks_fts();

-- RLS policies
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their agent documents"
  ON documents FOR ALL
  USING (agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid()));

CREATE POLICY "Users can manage their agent chunks"
  ON document_chunks FOR ALL
  USING (agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid()));
