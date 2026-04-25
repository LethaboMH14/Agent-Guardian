-- =====================================================================
-- Layer 6D: Supabase SQL Schema — Proof Aggregation Telemetry
-- =====================================================================
-- Run this in the Supabase SQL Editor alongside the existing tables
-- from Layer 4 (council_sessions, council_votes)
--
-- This extends the feedback loop to capture batch aggregation events,
-- enabling the metrics dashboard to show:
--   - Gas savings per batch
--   - Average batch size over time
--   - Aggregation latency trends
--   - Per-agent batch participation rates

-- ─────────────────────────────────────────────────────────────────
-- Table: aggregation_batches
-- One row per successfully verified batch
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS aggregation_batches (
  id                   SERIAL PRIMARY KEY,
  batch_nullifier      TEXT         NOT NULL UNIQUE,
  proof_count          INTEGER      NOT NULL CHECK (proof_count >= 2 AND proof_count <= 128),
  aggregation_time_ms  INTEGER,                      -- off-chain aggregation time
  estimated_gas_saved  NUMERIC,                      -- gas units saved vs naive
  estimated_usd_saved  NUMERIC GENERATED ALWAYS AS   -- auto-computed at $1500/ETH, 1 gwei
    (estimated_gas_saved * 1e-9 * 1500) STORED,
  batch_root           TEXT         NOT NULL,
  tx_hash              TEXT,                         -- on-chain tx if submitted
  agents               TEXT[],                       -- array of agent addresses in batch
  network              TEXT         DEFAULT 'arc-testnet',
  challenge            TEXT,                         -- Fiat-Shamir challenge (for debugging)
  ippa_proof_bytes     INTEGER,                      -- IPPA proof size in bytes
  created_at           TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aggregation_batches_created   ON aggregation_batches (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aggregation_batches_nullifier ON aggregation_batches (batch_nullifier);
CREATE INDEX IF NOT EXISTS idx_aggregation_batches_count     ON aggregation_batches (proof_count);

-- ─────────────────────────────────────────────────────────────────
-- Table: agent_batch_participations
-- Tracks per-agent batch history for reputation analytics
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_batch_participations (
  id               SERIAL PRIMARY KEY,
  agent_address    TEXT         NOT NULL,
  batch_nullifier  TEXT         NOT NULL REFERENCES aggregation_batches(batch_nullifier),
  leaf_index       INTEGER,
  decision_hash    TEXT,
  amount           NUMERIC,
  outcome          TEXT         DEFAULT 'verified',  -- 'verified' | 'rejected'
  created_at       TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_abp_agent   ON agent_batch_participations (agent_address);
CREATE INDEX IF NOT EXISTS idx_abp_batch   ON agent_batch_participations (batch_nullifier);

-- ─────────────────────────────────────────────────────────────────
-- Table: aggregation_queue_events
-- Tracks queue depth over time (for dashboard sparklines)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS aggregation_queue_events (
  id           SERIAL PRIMARY KEY,
  event_type   TEXT NOT NULL,   -- 'enqueue' | 'flush' | 'auto_flush'
  queue_depth  INTEGER,
  agent        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────
-- Views: dashboard queries
-- ─────────────────────────────────────────────────────────────────

-- Aggregation economics summary (for metrics dashboard)
CREATE OR REPLACE VIEW v_aggregation_economics AS
SELECT
  COUNT(*)                              AS total_batches,
  SUM(proof_count)                      AS total_proofs_aggregated,
  AVG(proof_count)::NUMERIC(10,2)       AS avg_batch_size,
  SUM(estimated_gas_saved)              AS total_gas_saved,
  SUM(estimated_usd_saved)::NUMERIC(18,8) AS total_usd_saved,
  AVG(aggregation_time_ms)::NUMERIC(10,2) AS avg_aggregation_ms,
  MAX(proof_count)                      AS largest_batch,
  MIN(proof_count)                      AS smallest_batch
FROM aggregation_batches
WHERE tx_hash IS NOT NULL;  -- only count successfully submitted batches

-- Per-agent aggregation activity
CREATE OR REPLACE VIEW v_agent_batch_stats AS
SELECT
  abp.agent_address,
  COUNT(DISTINCT abp.batch_nullifier)         AS batch_count,
  COUNT(*)                                     AS total_proof_participations,
  SUM(abp.amount)                              AS total_amount_in_batches,
  AVG(ab.proof_count)::NUMERIC(10,2)           AS avg_batch_size_participated,
  SUM(ab.estimated_gas_saved / ab.proof_count) AS agent_gas_saved_contribution
FROM agent_batch_participations abp
JOIN aggregation_batches ab ON abp.batch_nullifier = ab.batch_nullifier
GROUP BY abp.agent_address
ORDER BY batch_count DESC;

-- Hourly aggregation throughput (for time-series charts)
CREATE OR REPLACE VIEW v_aggregation_hourly AS
SELECT
  DATE_TRUNC('hour', created_at)              AS hour,
  COUNT(*)                                     AS batches,
  SUM(proof_count)                             AS proofs,
  SUM(estimated_gas_saved)                     AS gas_saved,
  AVG(aggregation_time_ms)::NUMERIC(10,2)      AS avg_agg_ms
FROM aggregation_batches
GROUP BY 1
ORDER BY 1 DESC;

-- ─────────────────────────────────────────────────────────────────
-- Supabase realtime subscription config
-- (for live dashboard updates without polling)
-- ─────────────────────────────────────────────────────────────────

-- Enable realtime on aggregation_batches for live dashboard:
-- In Supabase dashboard: Database → Replication → add aggregation_batches

-- ALTER TABLE aggregation_batches REPLICA IDENTITY FULL;
-- (run manually in Supabase SQL editor if realtime is needed)

-- ─────────────────────────────────────────────────────────────────
-- Seed: Economics reference table (for dashboard tooltips)
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS aggregation_economics_reference (
  batch_size        INTEGER PRIMARY KEY,
  naive_gas         INTEGER,
  batch_gas         INTEGER,
  gas_saved         INTEGER,
  savings_percent   NUMERIC(5,2)
);

INSERT INTO aggregation_economics_reference (batch_size, naive_gas, batch_gas, gas_saved, savings_percent)
VALUES
  (2,    460000,   280300,  179700,  39.07),
  (4,    920000,   280600,  639400,  69.50),
  (8,   1840000,   281200, 1558800,  84.72),
  (16,  3680000,   282400, 3397600,  92.33),
  (32,  7360000,   284800, 7075200,  96.13),
  (64, 14720000,   289600,14430400,  98.03),
  (128,29440000,   299200,29140800,  98.98)
ON CONFLICT (batch_size) DO NOTHING;
