-- Fix RLS policies for all tables
ALTER TABLE sentinel_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read_sentinel_alerts" ON sentinel_alerts;
CREATE POLICY "anon_read_sentinel_alerts" ON sentinel_alerts
  FOR SELECT USING (true);

ALTER TABLE council_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read_council_sessions" ON council_sessions;
CREATE POLICY "anon_read_council_sessions" ON council_sessions
  FOR SELECT USING (true);

ALTER TABLE council_votes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read_council_votes" ON council_votes;
CREATE POLICY "anon_read_council_votes" ON council_votes
  FOR SELECT USING (true);

ALTER TABLE cross_chain_freezes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read_cross_chain_freezes" ON cross_chain_freezes;
CREATE POLICY "anon_read_cross_chain_freezes" ON cross_chain_freezes
  FOR SELECT USING (true);

ALTER TABLE sentinel_heartbeats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read_sentinel_heartbeats" ON sentinel_heartbeats;
CREATE POLICY "anon_read_sentinel_heartbeats" ON sentinel_heartbeats
  FOR SELECT USING (true);

ALTER TABLE aggregation_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read_aggregation_batches" ON aggregation_batches;
CREATE POLICY "anon_read_aggregation_batches" ON aggregation_batches
  FOR SELECT USING (true);

ALTER TABLE vaccine_fingerprints ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read_vaccine_fingerprints" ON vaccine_fingerprints;
CREATE POLICY "anon_read_vaccine_fingerprints" ON vaccine_fingerprints
  FOR SELECT USING (true);

ALTER TABLE layer_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read_layer_config" ON layer_config;
CREATE POLICY "anon_read_layer_config" ON layer_config
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "anon_update_layer_config" ON layer_config;
CREATE POLICY "anon_update_layer_config" ON layer_config
  FOR UPDATE USING (true);

ALTER TABLE symbolic_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read_symbolic_checks" ON symbolic_checks;
CREATE POLICY "anon_read_symbolic_checks" ON symbolic_checks
  FOR SELECT USING (true);

ALTER TABLE agent_batch_participations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read_agent_batch_participations" ON agent_batch_participations;
CREATE POLICY "anon_read_agent_batch_participations" ON agent_batch_participations
  FOR SELECT USING (true);

ALTER TABLE underwriter_dao_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read_underwriter_dao_events" ON underwriter_dao_events;
CREATE POLICY "anon_read_underwriter_dao_events" ON underwriter_dao_events
  FOR SELECT USING (true);

ALTER TABLE sentinel_appeals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_read_sentinel_appeals" ON sentinel_appeals;
CREATE POLICY "anon_read_sentinel_appeals" ON sentinel_appeals
  FOR SELECT USING (true);

ALTER TABLE node_access_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_insert_node_access_requests" ON node_access_requests;
CREATE POLICY "anon_insert_node_access_requests" ON node_access_requests
  FOR INSERT WITH CHECK (true);
