-- =====================================================================
-- Layer 6F: Supabase SQL Schema — Verifiable Training Telemetry
-- =====================================================================
-- Run this in Supabase SQL Editor

-- ── training_registrations: Full provenance per agent ───────────────────
CREATE TABLE IF NOT EXISTS training_registrations (
  id SERIAL PRIMARY KEY,
  agent_address TEXT NOT NULL,
  merkle_root TEXT NOT NULL,
  architecture_hash TEXT NOT NULL,
  proof_hash TEXT,
  epsilon_bound NUMERIC,
  lambda_reg NUMERIC,
  loss_value NUMERIC,
  tee_provider TEXT,
  tee_attestation_hash TEXT,
  training_code_hash TEXT,
  verified BOOLEAN DEFAULT false,
  revoked BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_training_registrations_agent ON training_registrations (agent_address);
CREATE INDEX IF NOT EXISTS idx_training_registrations_verified ON training_registrations (verified);

-- ── training_spot_checks: Spot-check lifecycle ─────────────────────────
CREATE TABLE IF NOT EXISTS training_spot_checks (
  id SERIAL PRIMARY KEY,
  agent_address TEXT NOT NULL,
  batch_seed TEXT NOT NULL,
  auditor_address TEXT,
  proof_hash TEXT,
  status TEXT DEFAULT 'PENDING',
  issued_at TIMESTAMPTZ DEFAULT NOW(),
  fulfilled_at TIMESTAMPTZ,
  passed BOOLEAN
);
CREATE INDEX IF NOT EXISTS idx_training_spot_checks_agent ON training_spot_checks (agent_address);
CREATE INDEX IF NOT EXISTS idx_training_spot_checks_status ON training_spot_checks (status);
