-- ─── Usage Tracking ─────────────────────────────────────────────────────────
-- Daily usage tracking per user/agent for billing and limit enforcement.

CREATE TABLE usage_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  messages INTEGER NOT NULL DEFAULT 0,
  tokens_in BIGINT NOT NULL DEFAULT 0,
  tokens_out BIGINT NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, agent_id, date)
);

-- Indexes
CREATE INDEX idx_usage_daily_user ON usage_daily(user_id);
CREATE INDEX idx_usage_daily_agent ON usage_daily(agent_id);
CREATE INDEX idx_usage_daily_date ON usage_daily(date);
CREATE INDEX idx_usage_daily_user_date ON usage_daily(user_id, date);
CREATE INDEX idx_usage_daily_user_agent_date ON usage_daily(user_id, agent_id, date);

-- Helper function to upsert daily usage (atomic increment)
CREATE OR REPLACE FUNCTION increment_usage_daily(
  p_user_id UUID,
  p_agent_id UUID,
  p_date DATE,
  p_messages INTEGER DEFAULT 0,
  p_tokens_in BIGINT DEFAULT 0,
  p_tokens_out BIGINT DEFAULT 0,
  p_cost_cents INTEGER DEFAULT 0
)
RETURNS void AS $$
BEGIN
  INSERT INTO usage_daily (user_id, agent_id, date, messages, tokens_in, tokens_out, cost_cents)
  VALUES (p_user_id, p_agent_id, p_date, p_messages, p_tokens_in, p_tokens_out, p_cost_cents)
  ON CONFLICT (user_id, agent_id, date)
  DO UPDATE SET
    messages = usage_daily.messages + EXCLUDED.messages,
    tokens_in = usage_daily.tokens_in + EXCLUDED.tokens_in,
    tokens_out = usage_daily.tokens_out + EXCLUDED.tokens_out,
    cost_cents = usage_daily.cost_cents + EXCLUDED.cost_cents,
    updated_at = now();
END;
$$ LANGUAGE plpgsql;

-- Get total monthly usage for a user
CREATE OR REPLACE FUNCTION get_monthly_usage(
  p_user_id UUID,
  p_month DATE DEFAULT date_trunc('month', CURRENT_DATE)::DATE
)
RETURNS TABLE (
  total_messages BIGINT,
  total_tokens_in BIGINT,
  total_tokens_out BIGINT,
  total_cost_cents BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(messages)::BIGINT, 0) AS total_messages,
    COALESCE(SUM(tokens_in), 0) AS total_tokens_in,
    COALESCE(SUM(tokens_out), 0) AS total_tokens_out,
    COALESCE(SUM(cost_cents)::BIGINT, 0) AS total_cost_cents
  FROM usage_daily
  WHERE user_id = p_user_id
    AND date >= p_month
    AND date < (p_month + INTERVAL '1 month')::DATE;
END;
$$ LANGUAGE plpgsql;

-- Updated at trigger
CREATE OR REPLACE FUNCTION update_usage_daily_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_usage_daily_updated_at
  BEFORE UPDATE ON usage_daily
  FOR EACH ROW
  EXECUTE FUNCTION update_usage_daily_updated_at();

-- Row Level Security
ALTER TABLE usage_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY usage_daily_select_own ON usage_daily
  FOR SELECT USING (auth.uid() = user_id);

-- Partition hint: for high-volume production, consider partitioning by month
-- CREATE TABLE usage_daily_2026_03 PARTITION OF usage_daily FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
