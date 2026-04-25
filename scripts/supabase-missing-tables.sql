-- Supabase migration for missing tables
-- Run this in Supabase SQL Editor or via CLI

CREATE TABLE IF NOT EXISTS vaccine_fingerprints (
  id SERIAL PRIMARY KEY,
  decision_hash TEXT NOT NULL,
  context_hash TEXT,
  composite_key TEXT,
  tier TEXT NOT NULL CHECK (tier IN ('SOFT','HARD','PERMANENT')),
  agent_address TEXT,
  slash_amount NUMERIC,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  pruned BOOLEAN DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_vaccine_tier ON vaccine_fingerprints (tier, expires_at);
CREATE INDEX IF NOT EXISTS idx_vaccine_hash ON vaccine_fingerprints (decision_hash);

CREATE TABLE IF NOT EXISTS layer_config (
  id SERIAL PRIMARY KEY,
  layer_id TEXT UNIQUE NOT NULL,
  enabled BOOLEAN DEFAULT true,
  status TEXT DEFAULT 'Active',
  config_json JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO layer_config (layer_id, enabled, status) VALUES
  ('zkml', true, 'Active'),
  ('council', true, 'Active'),
  ('vaccine', true, 'Learning'),
  ('firewall', false, 'Disabled')
ON CONFLICT (layer_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS node_access_requests (
  id SERIAL PRIMARY KEY,
  wallet TEXT NOT NULL,
  reason TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
