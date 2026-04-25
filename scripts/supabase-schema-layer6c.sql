-- =====================================================================
-- Layer 6C: Supabase SQL Schema — Cross-Chain Sentinel Telemetry
-- =====================================================================
-- Run this in Supabase SQL Editor

-- ── cross_chain_freezes: All propagation events with GUID tracking ──────
CREATE TABLE IF NOT EXISTS cross_chain_freezes (
  id SERIAL PRIMARY KEY,
  guid TEXT NOT NULL UNIQUE,
  agent_address TEXT NOT NULL,
  source_chain TEXT NOT NULL,
  destination_chains TEXT[],
  msg_type TEXT NOT NULL,
  severity INTEGER,
  slash_reason_hash TEXT,
  zk_proof_hash TEXT,
  reputation_delta INTEGER,
  status TEXT DEFAULT 'PENDING',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cross_chain_freezes_guid ON cross_chain_freezes (guid);
CREATE INDEX IF NOT EXISTS idx_cross_chain_freezes_agent ON cross_chain_freezes (agent_address);

-- ── cross_chain_confirmations: Per-GUID delivery confirmation + latency ───
CREATE TABLE IF NOT EXISTS cross_chain_confirmations (
  id SERIAL PRIMARY KEY,
  guid TEXT NOT NULL REFERENCES cross_chain_freezes(guid),
  destination_chain TEXT NOT NULL,
  confirmed BOOLEAN DEFAULT false,
  latency_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cross_chain_confirmations_guid ON cross_chain_confirmations (guid);

-- ── sentinel_heartbeats: Chain liveness status per poll ─────────────────
CREATE TABLE IF NOT EXISTS sentinel_heartbeats (
  id SERIAL PRIMARY KEY,
  chain TEXT NOT NULL,
  status TEXT NOT NULL,
  chain_status JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sentinel_heartbeats_chain ON sentinel_heartbeats (chain);

-- ── sentinel_alerts: DEFCON escalation events ───────────────────────────
CREATE TABLE IF NOT EXISTS sentinel_alerts (
  id SERIAL PRIMARY KEY,
  alert_type TEXT NOT NULL,
  severity INTEGER NOT NULL,
  defcon_level INTEGER,
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sentinel_alerts_severity ON sentinel_alerts (severity);

-- ── sentinel_appeals: Appeal lifecycle tracking ─────────────────────────
CREATE TABLE IF NOT EXISTS sentinel_appeals (
  id SERIAL PRIMARY KEY,
  agent_address TEXT NOT NULL,
  freeze_guid TEXT REFERENCES cross_chain_freezes(guid),
  reason TEXT,
  status TEXT DEFAULT 'ACTIVE',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sentinel_appeals_agent ON sentinel_appeals (agent_address);
