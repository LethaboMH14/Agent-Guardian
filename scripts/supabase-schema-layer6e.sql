-- =====================================================================
-- Layer 6E: Supabase SQL Schema — Symbolic Verification Telemetry
-- =====================================================================
-- Extends the existing Layer 4 schema with symbolic check data.
-- Run in Supabase SQL Editor after the Layer 4 and Layer 6D schemas.

-- ── symbolic_checks: one row per symbolic check ───────────────────────
CREATE TABLE IF NOT EXISTS symbolic_checks (
  id                  SERIAL PRIMARY KEY,
  cert_hash           TEXT         NOT NULL UNIQUE,
  status              TEXT         NOT NULL CHECK (status IN ('SAT','UNSAT')),
  agent_address       TEXT         NOT NULL,
  proposal_hash       TEXT         NOT NULL,
  property_set_hash   TEXT         NOT NULL,
  lyapunov_value      NUMERIC      NOT NULL DEFAULT 0,
  council_entropy     NUMERIC,
  loss_adjusted_ev    NUMERIC,
  satisfied_count     INTEGER,
  violated_count      INTEGER,
  violated_ids        TEXT[],
  gas_overhead        INTEGER,
  checked_at          TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sc_agent   ON symbolic_checks (agent_address);
CREATE INDEX IF NOT EXISTS idx_sc_status  ON symbolic_checks (status);
CREATE INDEX IF NOT EXISTS idx_sc_checked ON symbolic_checks (checked_at DESC);

-- ── agent_policies: registered safety property sets ──────────────────
CREATE TABLE IF NOT EXISTS agent_policies (
  id                SERIAL PRIMARY KEY,
  agent_address     TEXT   NOT NULL UNIQUE,
  per_tx_limit      TEXT   NOT NULL,
  daily_limit       TEXT   NOT NULL,
  weekly_limit      TEXT   NOT NULL,
  exposure_cap      TEXT   NOT NULL,
  min_reputation    INTEGER NOT NULL,
  property_set_hash TEXT   NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── Dashboard views ───────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_symbolic_summary AS
SELECT
  COUNT(*) AS total_checks,
  COUNT(*) FILTER (WHERE status = 'SAT')   AS sat_count,
  COUNT(*) FILTER (WHERE status = 'UNSAT') AS unsat_count,
  ROUND(COUNT(*) FILTER (WHERE status='SAT') * 100.0 / NULLIF(COUNT(*),0), 1) AS sat_pct,
  AVG(lyapunov_value)::NUMERIC(10,4) AS avg_lyapunov,
  AVG(council_entropy)::NUMERIC(10,4) AS avg_entropy,
  AVG(loss_adjusted_ev)::NUMERIC(18,6) AS avg_loss_adjusted_ev
FROM symbolic_checks;

CREATE OR REPLACE VIEW v_most_violated_properties AS
SELECT unnest(violated_ids) AS property_id, COUNT(*) AS violation_count
FROM symbolic_checks WHERE violated_count > 0
GROUP BY 1 ORDER BY 2 DESC;

CREATE OR REPLACE VIEW v_agent_symbolic_stats AS
SELECT
  agent_address,
  COUNT(*) AS total_checks,
  COUNT(*) FILTER (WHERE status = 'SAT') AS sat_count,
  AVG(lyapunov_value)::NUMERIC(10,3) AS avg_lyapunov,
  AVG(council_entropy)::NUMERIC(10,3) AS avg_entropy
FROM symbolic_checks GROUP BY agent_address ORDER BY total_checks DESC;
