-- ─── Cloud Users ────────────────────────────────────────────────────────────
-- Extends Supabase Auth with Karna Cloud-specific profile data.

CREATE TABLE cloud_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'basic', 'pro', 'team')),
  stripe_customer_id TEXT UNIQUE,
  razorpay_customer_id TEXT UNIQUE,
  usage_reset_at TIMESTAMPTZ NOT NULL DEFAULT (date_trunc('month', now()) + INTERVAL '1 month'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_cloud_users_user_id ON cloud_users(user_id);
CREATE INDEX idx_cloud_users_email ON cloud_users(email);
CREATE INDEX idx_cloud_users_stripe_customer ON cloud_users(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX idx_cloud_users_razorpay_customer ON cloud_users(razorpay_customer_id) WHERE razorpay_customer_id IS NOT NULL;
CREATE INDEX idx_cloud_users_plan ON cloud_users(plan);

-- Add owner_id to agents table for cloud multi-tenancy
ALTER TABLE agents ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_agents_owner_id ON agents(owner_id) WHERE owner_id IS NOT NULL;

-- Updated at trigger
CREATE OR REPLACE FUNCTION update_cloud_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cloud_users_updated_at
  BEFORE UPDATE ON cloud_users
  FOR EACH ROW
  EXECUTE FUNCTION update_cloud_users_updated_at();

-- Row Level Security
ALTER TABLE cloud_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY cloud_users_select_own ON cloud_users
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY cloud_users_update_own ON cloud_users
  FOR UPDATE USING (auth.uid() = user_id);
