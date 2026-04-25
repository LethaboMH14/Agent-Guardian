-- =====================================================================
-- Layer 4: Supabase SQL Schema — MCP Tool Layer (Council + Feedback)
-- =====================================================================
-- Run this in Supabase SQL Editor

-- ── council_sessions: one row per council deliberation session ─────────
CREATE TABLE IF NOT EXISTS council_sessions (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent TEXT NOT NULL,
  recipient TEXT NOT NULL,
  amount TEXT NOT NULL,
  reason TEXT,
  approved BOOLEAN,
  outcome TEXT,
  consensus TEXT,
  total_cost NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_council_sessions_agent ON council_sessions (agent);

-- ── council_votes: one row per council agent vote ───────────────────────
CREATE TABLE IF NOT EXISTS council_votes (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent_role TEXT NOT NULL,
  model TEXT NOT NULL,
  decision TEXT NOT NULL,
  confidence INTEGER,
  reasoning TEXT,
  flags TEXT,
  latency_ms INTEGER,
  cost_usdc NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_council_votes_session ON council_votes (session_id);
