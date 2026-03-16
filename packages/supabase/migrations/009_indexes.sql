CREATE INDEX idx_messages_session ON messages(session_id, created_at);

-- idx_memories_embedding already created in 004_memory.sql

CREATE INDEX idx_memories_agent ON memories(agent_id, category);

CREATE INDEX idx_tool_exec_session ON tool_executions(session_id, created_at);

CREATE INDEX idx_sessions_agent ON sessions(agent_id, last_message_at DESC);
