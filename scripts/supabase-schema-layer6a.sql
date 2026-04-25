-- =====================================================================
-- Layer 6A: Supabase SQL Schema — Underwriter DAO Telemetry
-- =====================================================================
-- Run this in Supabase SQL Editor

-- ── underwriter_dao_events: All DAO events for feedback loop ───────────
CREATE TABLE IF NOT EXISTS underwriter_dao_events (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  underwriter_address TEXT,
  applicant_address TEXT,
  application_id INTEGER,
  backing_amount NUMERIC,
  slash_amount NUMERIC,
  reputation_delta INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_underwriter_dao_events_type ON underwriter_dao_events (event_type);
CREATE INDEX IF NOT EXISTS idx_underwriter_dao_events_underwriter ON underwriter_dao_events (underwriter_address);
