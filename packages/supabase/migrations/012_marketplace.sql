-- ─── Skill Marketplace ──────────────────────────────────────────────────────
-- Tables for the Karna skill marketplace: published skills, reviews, and purchases.

-- Published Skills
CREATE TABLE published_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0.0',
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  source_url TEXT,
  icon_url TEXT,
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  readme TEXT,
  downloads INTEGER NOT NULL DEFAULT 0,
  rating NUMERIC(2, 1) NOT NULL DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
  review_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for published_skills
CREATE INDEX idx_published_skills_developer ON published_skills(developer_id);
CREATE INDEX idx_published_skills_category ON published_skills(category) WHERE status = 'published';
CREATE INDEX idx_published_skills_status ON published_skills(status);
CREATE INDEX idx_published_skills_rating ON published_skills(rating DESC) WHERE status = 'published';
CREATE INDEX idx_published_skills_downloads ON published_skills(downloads DESC) WHERE status = 'published';
CREATE INDEX idx_published_skills_price ON published_skills(price_cents) WHERE status = 'published';
CREATE INDEX idx_published_skills_name_search ON published_skills USING gin(to_tsvector('english', name || ' ' || description));

-- Skill Reviews
CREATE TABLE skill_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  skill_id UUID NOT NULL REFERENCES published_skills(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, skill_id)
);

-- Indexes for skill_reviews
CREATE INDEX idx_skill_reviews_skill ON skill_reviews(skill_id);
CREATE INDEX idx_skill_reviews_user ON skill_reviews(user_id);
CREATE INDEX idx_skill_reviews_rating ON skill_reviews(skill_id, rating);

-- Skill Purchases (revenue tracking)
CREATE TABLE skill_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  skill_id UUID NOT NULL REFERENCES published_skills(id) ON DELETE CASCADE,
  price_paid INTEGER NOT NULL CHECK (price_paid >= 0),
  developer_earnings INTEGER NOT NULL DEFAULT 0,
  platform_earnings INTEGER NOT NULL DEFAULT 0,
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, skill_id)
);

-- Indexes for skill_purchases
CREATE INDEX idx_skill_purchases_user ON skill_purchases(user_id);
CREATE INDEX idx_skill_purchases_skill ON skill_purchases(skill_id);
CREATE INDEX idx_skill_purchases_developer ON skill_purchases(skill_id, purchased_at);

-- Helper function to increment download count atomically
CREATE OR REPLACE FUNCTION increment_skill_downloads(skill_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE published_skills
  SET downloads = downloads + 1
  WHERE id = skill_id;
END;
$$ LANGUAGE plpgsql;

-- Updated at trigger for published_skills
CREATE OR REPLACE FUNCTION update_published_skills_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_published_skills_updated_at
  BEFORE UPDATE ON published_skills
  FOR EACH ROW
  EXECUTE FUNCTION update_published_skills_updated_at();

-- Row Level Security
ALTER TABLE published_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_purchases ENABLE ROW LEVEL SECURITY;

-- Published skills: anyone can read published, developers can manage their own
CREATE POLICY published_skills_select_all ON published_skills
  FOR SELECT USING (status = 'published' OR auth.uid() = developer_id);

CREATE POLICY published_skills_insert_own ON published_skills
  FOR INSERT WITH CHECK (auth.uid() = developer_id);

CREATE POLICY published_skills_update_own ON published_skills
  FOR UPDATE USING (auth.uid() = developer_id);

-- Reviews: anyone can read, users can manage their own
CREATE POLICY skill_reviews_select_all ON skill_reviews
  FOR SELECT USING (true);

CREATE POLICY skill_reviews_insert_own ON skill_reviews
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY skill_reviews_update_own ON skill_reviews
  FOR UPDATE USING (auth.uid() = user_id);

-- Purchases: users can see their own
CREATE POLICY skill_purchases_select_own ON skill_purchases
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY skill_purchases_insert_own ON skill_purchases
  FOR INSERT WITH CHECK (auth.uid() = user_id);
