-- Enable read access for anon role on all UI-facing tables

CREATE POLICY "anon_read_sentinel_alerts" ON sentinel_alerts
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_read_council_sessions" ON council_sessions
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_read_cross_chain_freezes" ON cross_chain_freezes
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_read_sentinel_heartbeats" ON sentinel_heartbeats
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_read_council_votes" ON council_votes
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_read_aggregation_batches" ON aggregation_batches
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_read_vaccine_fingerprints" ON vaccine_fingerprints
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_read_layer_config" ON layer_config
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_read_symbolic_checks" ON symbolic_checks
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_read_agent_batch_participations" ON agent_batch_participations
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_read_underwriter_dao_events" ON underwriter_dao_events
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_read_sentinel_appeals" ON sentinel_appeals
  FOR SELECT TO anon USING (true);

-- Also allow anon inserts for node_access_requests (Architecture page CTA)
CREATE POLICY "anon_insert_node_access_requests" ON node_access_requests
  FOR INSERT TO anon WITH CHECK (true);

-- Allow anon updates on layer_config (Settings page toggles)
CREATE POLICY "anon_update_layer_config" ON layer_config
  FOR UPDATE TO anon USING (true);
