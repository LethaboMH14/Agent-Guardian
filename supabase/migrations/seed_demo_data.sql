-- sentinel_alerts demo data
INSERT INTO sentinel_alerts (defcon_level, severity, message, alert_type, created_at)
VALUES
  (1, 1, 'System nominal — all agents operating within parameters', 'INFO', NOW()),
  (1, 2, 'High risk alert: Smart Contract V2 anomaly detected', 'WARNING', NOW() - INTERVAL '10 minutes'),
  (1, 2, 'Council auto-reject: Proposal #492 exceeded risk threshold', 'WARNING', NOW() - INTERVAL '1 hour'),
  (1, 1, 'Policy update: Gas limit thresholds adjusted', 'INFO', NOW() - INTERVAL '3 hours')
ON CONFLICT DO NOTHING;

-- council_sessions demo data  
INSERT INTO council_sessions 
  (session_id, agent, recipient, amount, reason, approved, consensus, created_at)
VALUES
  ('sess-001', '0xAlpha...1234', '0xUniswap...Router', '1250', 'Arb: Uniswap > Curve', true, '{"approve":3,"reject":0}', NOW() - INTERVAL '2 minutes'),
  ('sess-002', '0xBeta...5678', '0xCurve...Pool', '840', 'Liquidity Provision', true, '{"approve":3,"reject":0}', NOW() - INTERVAL '15 minutes'),
  ('sess-003', '0xGamma...9012', '0xEscrow...Vault', '3100', 'Council Escrow Release', null, '{"approve":2,"reject":0,"pending":1}', NOW() - INTERVAL '1 hour'),
  ('sess-004', '0xAlpha...1234', '0xBalancer...Vault', '120500', 'Rebalance Portfolio', true, '{"approve":3,"reject":0}', NOW() - INTERVAL '4 hours'),
  ('sess-005', '0xDelta...3456', '0xHighRisk...Addr', '500', 'High risk transfer', false, '{"approve":0,"reject":3}', NOW() - INTERVAL '6 hours')
ON CONFLICT DO NOTHING;

-- council_votes demo data
INSERT INTO council_votes
  (session_id, agent_role, model, decision, reasoning, confidence, created_at)
VALUES
  ('sess-001', 'Risk Agent', 'LLAMA-3-70B', 'APPROVE', 
   'Analyzing historical tx volume... Wallet rep: AAA. Velocity: Normal. Conclusion: Risk profile acceptable.', 
   94.2, NOW() - INTERVAL '2 minutes'),
  ('sess-001', 'Compliance Agent', 'GEMINI-PRO', 'APPROVE',
   'Checking OFAC blocklist... clear. Verifying KYC status... valid. Rule 4A: Exempted.',
   98.7, NOW() - INTERVAL '2 minutes'),
  ('sess-001', 'Execution Agent', 'MISTRAL-8X7B', 'APPROVE',
   'Simulating routing paths and gas optimization... Route viable. Gas: 45k.',
   87.3, NOW() - INTERVAL '1 minute')
ON CONFLICT DO NOTHING;

-- cross_chain_freezes demo data
INSERT INTO cross_chain_freezes
  (msg_type, source_chain, destination_chains, zk_proof_hash, status, created_at, guid, agent_address)
VALUES
  ('FREEZE', 'Ethereum', ARRAY['Arb', 'Opt', 'Base'], '0xproof1', 'PROPAGATED', NOW() - INTERVAL '5 minutes', 'guid-001', '0x8A...2F1'),
  ('WARN', 'Arbitrum', ARRAY['Ethereum'], '0xproof2', 'PROPAGATED', NOW() - INTERVAL '20 minutes', 'guid-002', '0x1C...9B4'),
  ('FREEZE', 'Base', ARRAY['Ethereum', 'Arbitrum', 'Polygon'], '0xproof3', 'PROPAGATED', NOW() - INTERVAL '1 hour', 'guid-003', '0x5F...E22')
ON CONFLICT DO NOTHING;

-- sentinel_heartbeats demo data
INSERT INTO sentinel_heartbeats (chain, chain_status, status, created_at)
VALUES
  ('Ethereum', '{"status":"ONLINE","latency":45}', 'ONLINE', NOW()),
  ('Arbitrum', '{"status":"ONLINE","latency":12}', 'ONLINE', NOW()),
  ('Base', '{"status":"ONLINE","latency":8}', 'ONLINE', NOW()),
  ('Polygon', '{"status":"ONLINE","latency":23}', 'ONLINE', NOW())
ON CONFLICT DO NOTHING;
