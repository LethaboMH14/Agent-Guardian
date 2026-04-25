-- Drop existing tables with wrong schema
DROP TABLE IF EXISTS aggregation_batches CASCADE;
DROP TABLE IF EXISTS agent_batch_participations CASCADE;
DROP TABLE IF EXISTS symbolic_checks CASCADE;
DROP TABLE IF EXISTS underwriter_dao_events CASCADE;
DROP TABLE IF EXISTS sentinel_appeals CASCADE;

-- Create sequence first
CREATE SEQUENCE batch_id_seq START 8920;

-- aggregation_batches (Batch Proofs screen)
CREATE TABLE aggregation_batches (
  id SERIAL PRIMARY KEY,
  batch_id TEXT UNIQUE NOT NULL DEFAULT ('BP-' || LPAD(nextval('batch_id_seq')::TEXT, 4, '0')),
  proof_count INTEGER DEFAULT 0,
  gas_used NUMERIC DEFAULT 0,
  gas_saved_pct NUMERIC DEFAULT 0,
  latency_ms INTEGER DEFAULT 0,
  nullifier TEXT,
  session_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- agent_batch_participations (ZK-ML screen)
CREATE TABLE agent_batch_participations (
  id SERIAL PRIMARY KEY,
  batch_id TEXT REFERENCES aggregation_batches(batch_id),
  agent_address TEXT NOT NULL,
  session_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- symbolic_checks (Neural-Symbolic screen)
CREATE TABLE symbolic_checks (
  id SERIAL PRIMARY KEY,
  check_id TEXT UNIQUE NOT NULL,
  agent TEXT,
  proposal_hash TEXT,
  status TEXT CHECK (status IN ('SAT', 'UNSAT')),
  satisfaction_bitmask TEXT,
  lyapunov_value NUMERIC DEFAULT 0,
  loss_adjusted_ev NUMERIC DEFAULT 0,
  council_entropy NUMERIC DEFAULT 0,
  cert_hash TEXT,
  session_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- underwriter_dao_events (Insurance Pool / Underwriter DAO tab)
CREATE TABLE underwriter_dao_events (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  underwriter_address TEXT,
  agent_address TEXT,
  amount NUMERIC DEFAULT 0,
  reputation_score NUMERIC DEFAULT 0,
  total_exposure NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- sentinel_appeals (Cross-Chain Sentinel screen)
CREATE TABLE sentinel_appeals (
  id SERIAL PRIMARY KEY,
  agent_address TEXT NOT NULL,
  reason TEXT,
  status TEXT DEFAULT 'ACTIVE',
  votes JSONB DEFAULT '[]',
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add RLS policies for new tables
ALTER TABLE aggregation_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_batch_participations ENABLE ROW LEVEL SECURITY;
ALTER TABLE symbolic_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE underwriter_dao_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sentinel_appeals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read" ON aggregation_batches FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON agent_batch_participations FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON symbolic_checks FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON underwriter_dao_events FOR SELECT TO anon USING (true);
CREATE POLICY "anon_read" ON sentinel_appeals FOR SELECT TO anon USING (true);

-- Seed minimal demo data so screens show content immediately
INSERT INTO aggregation_batches 
  (batch_id, proof_count, gas_used, gas_saved_pct, latency_ms, nullifier, created_at)
VALUES
  ('BP-8924', 32, 16000000, 68.5, 142, '0xabc...def', NOW() - INTERVAL '2 minutes'),
  ('BP-8923', 24, 12000000, 64.2, 138, '0xdef...123', NOW() - INTERVAL '15 minutes'),
  ('BP-8922', 32, 16000000, 68.1, 145, '0x123...456', NOW() - INTERVAL '42 minutes'),
  ('BP-8921', 16, 8000000, 52.4, 151, '0x456...789', NOW() - INTERVAL '1 hour')
ON CONFLICT (batch_id) DO NOTHING;

INSERT INTO symbolic_checks
  (check_id, agent, status, satisfaction_bitmask, lyapunov_value, 
   loss_adjusted_ev, council_entropy, created_at)
VALUES
  ('SC-001', '0xAlpha', 'SAT', '1111111111', 0, 0.82, 0.23, NOW() - INTERVAL '5 minutes'),
  ('SC-002', '0xBeta', 'SAT', '1111111110', 0, 0.76, 0.31, NOW() - INTERVAL '12 minutes'),
  ('SC-003', '0xGamma', 'UNSAT', '1111011111', 0.4, -0.15, 0.67, NOW() - INTERVAL '1 hour')
ON CONFLICT (check_id) DO NOTHING;
