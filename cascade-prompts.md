# AgentGuardian — Cascade Prompt Sequence
> Run these prompts in Windsurf Cascade IN ORDER. Wait for each to complete before pasting the next.

---

## PROMPT 0 — Project Setup & Shared Utils
```
You have access to the full project folder. 

First, read these files completely before doing anything:
- MASTER-BUILD.md
- DESIGN.md
- ui-integration.md

Then do the following:

1. Create the folder structure:
   ui/
   ui/js/

2. Create ui/js/env.js:
   - window.ENV_SUPABASE_URL — read the value from .env or supabase config in the project
   - window.ENV_SUPABASE_ANON_KEY — same
   - window.ENV_ARC_RPC_URL — read from .env or hardhat config
   - window.ENV_AGENT_REGISTRY — read deployed address from deployments/ or .env
   - window.ENV_INSURANCE_POOL — same
   - window.ENV_UNDERWRITER_DAO — same
   - window.ENV_BATCH_VERIFIER — same
   - window.ENV_COGNITION_VERIFIER — same
   - If any address is not yet deployed, set it to '0x0000000000000000000000000000000000000000' as placeholder

3. Create ui/js/abis.js with these exact minimal ABIs:
   - AGENT_REGISTRY_ABI: totalSupply, getReputation, tokenURI, ownerOf
   - INSURANCE_POOL_ABI: totalStaked, activePolicyCount, totalClaims, getStake, getEarnings, stake, unstake
   - UNDERWRITER_DAO_ABI: activeUnderwriterCount, totalRagntStaked, pendingApplicationCount, getPendingApplications, castBackingVote
   - BATCH_VERIFIER_ABI: queueDepth, MAX_BATCH
   - COGNITION_VERIFIER_ABI: modelCommitment
   Export all as named exports.

4. Create ui/js/client.js:
   - Import createClient from supabase-js CDN esm
   - Import ethers from ethers v6 CDN esm
   - Export: supabase client, provider (JsonRpcProvider), getContract(address, abi), getSigner(), timeAgo(isoString), truncate(addr, chars=6), fmtUSD(val)
   - All values read from window.ENV_* set in env.js

5. Run the following Supabase SQL migrations (use the Supabase client or find the migration runner in the project):
   CREATE TABLE IF NOT EXISTS vaccine_fingerprints (
     id SERIAL PRIMARY KEY,
     decision_hash TEXT NOT NULL,
     context_hash TEXT,
     composite_key TEXT,
     tier TEXT NOT NULL CHECK (tier IN ('SOFT','HARD','PERMANENT')),
     agent_address TEXT,
     slash_amount NUMERIC,
     added_at TIMESTAMPTZ DEFAULT NOW(),
     expires_at TIMESTAMPTZ,
     pruned BOOLEAN DEFAULT false
   );
   CREATE INDEX IF NOT EXISTS idx_vaccine_tier ON vaccine_fingerprints (tier, expires_at);
   CREATE INDEX IF NOT EXISTS idx_vaccine_hash ON vaccine_fingerprints (decision_hash);

   CREATE TABLE IF NOT EXISTS layer_config (
     id SERIAL PRIMARY KEY,
     layer_id TEXT UNIQUE NOT NULL,
     enabled BOOLEAN DEFAULT true,
     status TEXT DEFAULT 'Active',
     config_json JSONB,
     updated_at TIMESTAMPTZ DEFAULT NOW()
   );
   INSERT INTO layer_config (layer_id, enabled, status) VALUES
     ('zkml', true, 'Active'),
     ('council', true, 'Active'),
     ('vaccine', true, 'Learning'),
     ('firewall', false, 'Disabled')
   ON CONFLICT (layer_id) DO NOTHING;

   CREATE TABLE IF NOT EXISTS node_access_requests (
     id SERIAL PRIMARY KEY,
     wallet TEXT NOT NULL,
     reason TEXT,
     status TEXT DEFAULT 'pending',
     created_at TIMESTAMPTZ DEFAULT NOW()
   );

6. Rename any existing code.html files:
   - The code.html with "NEURAL-SYMBOLIC VERIFICATION" content → ui/neural-symbolic.html
   - The code.html with "Insurance Pool & Underwriter DAO" content → ui/insurance-pool.html
   - Any other existing HTML screens → rename to match ui/[screen-name].html

Confirm when done by listing the ui/ folder contents.
```

---

## PROMPT 1 — Dashboard
```
Read: MASTER-BUILD.md, DESIGN.md, ui-integration.md (Screen 1 — Dashboard section)

Create ui/dashboard.html from scratch. This is the main landing page after login.

DESIGN RULES (from DESIGN.md — follow exactly):
- Background: #e8eaf0, font: Plus Jakarta Sans
- Raised cards: box-shadow 6px 6px 12px rgba(0,0,0,0.08), -6px -6px 12px rgba(255,255,255,0.6)
- Pressed/inset: box-shadow inset 4px 4px 8px rgba(0,0,0,0.06), inset -4px -4px 8px rgba(255,255,255,0.5)
- Primary: #6366f1, Tertiary: #7c3aed
- All neomorphic elements must share the same #e8eaf0 background
- No borders, no gradients on neomorphic elements
- Minimum 12px border-radius on all cards

LAYOUT (match the dashboard screenshot exactly):
- Fixed left sidebar (w-64): AgentGuardian logo + shield icon, nav links (Dashboard active, Threat Intel, Agents, System Logs, Settings), "Lock System" button at bottom, Support link
- Top bar: search input (inset style), DEFCON badge (green dot), "THREATS BLOCKED 2,849,102" counter, notification bell, settings icon, avatar
- Main content:
  - Row 1: 5 metric cards (Total Agents, Txs Secured, ZK Success %, Gas Savings ETH, Insurance Pool $)
  - Center: "Transaction Security Timeline" bar chart (Chart.js, full width minus right panel)
  - Right panel: "Security Layers" list (Smart Contract Scanner, Multi-Sig Validator, Risk Oracle, Slashing Engine) each with status dot and latency/quorum text
  - Bottom row left: "Council Consensus" donut gauge (84% QUORUM)
  - Bottom row right: "ZK Proof Performance" with 3 progress bars (Generation Time, Verification Time, Proof Size)

DATA WIRING (add <script type="module"> at bottom):
Import from ui/js/client.js and ui/js/abis.js and ui/js/env.js

1. DEFCON badge: SELECT defcon_level FROM sentinel_alerts ORDER BY created_at DESC LIMIT 1
2. Threats Blocked: SELECT COUNT(*) FROM cross_chain_freezes WHERE status='PROPAGATED'
3. Total Agents: agentRegistry.totalSupply() — contract read
4. Txs Secured: SELECT COUNT(*) FROM council_sessions WHERE approved=true
5. ZK Success %: SELECT COUNT(*) FILTER (WHERE approved=true)::float / COUNT(*) * 100 FROM council_sessions
6. Gas Savings: SELECT SUM(gas_saved_pct) FROM aggregation_batches (average, display as ETH)
7. Insurance Pool: insurancePool.totalStaked() formatted as USD
8. Transaction Security Timeline chart: SELECT DATE_TRUNC('hour', created_at) as hour, COUNT(*) FROM council_sessions GROUP BY hour ORDER BY hour DESC LIMIT 24 — Chart.js bar, color #818cf8
9. Council Consensus gauge: latest council_sessions row, parse consensus field for approval %
10. ZK Proof Performance bars: SELECT AVG(latency_ms) FROM aggregation_batches ORDER BY created_at DESC LIMIT 10
11. Slashing Engine status: insurancePool.totalSlashed() > 0 ? 'Active' : 'Standby'

Error handling: all data calls wrapped in try/catch. Show "--" on error. Show skeleton pulse animation while loading.

Use Chart.js from CDN. Use supabase-js from CDN esm. Use ethers v6 from CDN esm.
All in a single self-contained HTML file.
```

---

## PROMPT 2 — System Logs
```
Read: MASTER-BUILD.md, DESIGN.md, ui-integration.md (Screen 2 — System Logs section)

Create ui/system-logs.html from scratch.

DESIGN RULES: Same neomorphic rules as dashboard. Same sidebar. Same top bar.

LAYOUT (match System Logs screenshot):
- Page title "System Logs" + subtitle "Real-time audit trail and system events across all agent networks."
- Top right: "Filter" button (raised neomorphic) + "Export" button (raised neomorphic)
- Row of 3 stat cards: Events/Sec (with LIVE green badge), Critical Alerts (with +12% badge), Quick Filters chip group (All Sources, API Gateway, Auth Service, Agents)
- Main card: "Recent Activity Stream" — list of log entries, each with: timestamp (monospace), severity badge (CRITICAL=red, INFO=purple, WARN=amber), title, description (monospace font), "View Details" link

SIDEBAR for this screen: Dashboard, Threat Intel, Agents, System Logs (ACTIVE — pressed inset), Settings

DATA WIRING (script type="module"):
1. Events/Sec: subscribe to supabase realtime on council_sessions + cross_chain_freezes + sentinel_alerts. Count INSERT events per second using a rolling 5-second window. Update DOM every second.

2. Critical Alerts: SELECT COUNT(*) FROM sentinel_alerts WHERE severity >= 2 AND created_at > NOW() - INTERVAL '1 hour'

3. Activity Stream — merge 3 queries, sort by created_at DESC, limit 50:
   a. FROM sentinel_alerts: map severity 3→CRITICAL(red), 2→WARN(amber), 1→INFO(purple)
   b. FROM council_sessions: approved=true→INFO "Agent Deployment Successful", approved=false→WARN "Agent Action Blocked"
   c. FROM cross_chain_freezes: status='PROPAGATED'→CRITICAL "Cross-Chain Freeze Propagated"
   
   Render each as a card with left colored border strip matching severity color.

4. Realtime: supabase.channel('activity-stream').on('postgres_changes', { event: 'INSERT', schema: 'public' }, payload => prepend new row to list with fade-in animation)

5. Quick Filter chips: clicking a chip filters the displayed list client-side by source type. "All Sources" clears filter.

6. "View Details" link: opens a <dialog> modal showing the full JSON of that row, formatted with syntax highlighting (use highlight.js from CDN or simple <pre> with color).

7. Export button: fetch all matching rows as CSV and trigger download via Blob URL.

All in single self-contained HTML file.
```

---

## PROMPT 3 — Batch Proof Engine
```
Read: MASTER-BUILD.md, DESIGN.md, ui-integration.md (Screen 10 — Batch Proof Engine section)

Create ui/batch-proofs.html from scratch.

DESIGN RULES: Same neomorphic system. Sidebar nav: Insurance (top), Batch Proofs (ACTIVE), Analytics. Top bar with AgentGuardian branding.

LAYOUT (match Batch Proofs screenshot):
- Top right hero card: "Lifetime Gas Saved" with fuel pump icon and "1,240.5 ETH" large number
- Page title "Batch Proof Engine" + subtitle "SnarkPack Aggregation System"
- Large hero stat card: "AVERAGE GAS REDUCTION" centered, "68.2%" in giant indigo text, lightning bolt icon, explanatory text
- Row below: "Aggregation Queue" card (left, shows "8/32 Proofs Pending", progress bar, "Force Submit Now" button) + "Execution Comparison" card (right, 3 sub-cards: Without Batching →500k Gas, SnarkPack O(log n), Net Result -67.5%)
- Bottom row: "Gas Savings by Batch Size" bar chart (left) + "Throughput Timeline (24h)" line chart (right)
- "Recent Batches" table at bottom

DATA WIRING:
1. Lifetime Gas Saved: SELECT SUM(gas_used * gas_saved_pct / 100) / 1e18 FROM aggregation_batches → format "X,XXX.X ETH"
2. Average Gas Reduction: SELECT AVG(gas_saved_pct) FROM aggregation_batches → "XX.X%"
3. Queue depth: batchVerifier.queueDepth() and batchVerifier.MAX_BATCH() — contract reads
4. Gas Savings by Batch Size chart: SELECT proof_count, AVG(gas_saved_pct) FROM aggregation_batches GROUP BY proof_count ORDER BY proof_count — Chart.js bar, bars get darker shade of #6366f1 as proof_count increases
5. Throughput Timeline: SELECT DATE_TRUNC('hour', created_at) as hour, COUNT(*) FROM aggregation_batches GROUP BY hour ORDER BY hour DESC LIMIT 24 — Chart.js line, color #6366f1
6. Recent Batches table: SELECT * FROM aggregation_batches ORDER BY created_at DESC LIMIT 10 — show batch_id as "#BP-XXXX", gas_saved_pct in green, nullifier IS NOT NULL → green "Verified" badge with dot
7. "Force Submit Now" button: calls proofAggregator.flushQueue() via getSigner() — show wallet connect prompt if no wallet, show tx hash toast on success

All in single self-contained HTML file.
```

---

## PROMPT 4 — Council Deliberation
```
Read: MASTER-BUILD.md, DESIGN.md, ui-integration.md (Screen 4 — Council Deliberation section)

Create ui/council-deliberation.html from scratch.

DESIGN RULES: Same neomorphic system. Use Silk Security sidebar style: Silk Security header, Dashboard, System Status, Agent Registry, ZK-ML, Council (ACTIVE), Vaccine, Settings.

LAYOUT (match Council Deliberation screenshot):
- Page title "Council Deliberation" + subtitle "Monitoring multi-agent consensus protocol in real-time."
- Left column (40%):
  - "Transaction Proposal" card: shows TX ID, status badge (CLEAN/PENDING/BLOCKED), Amount in USDC, Recipient (truncated address), Reason
  - "Consensus Status" card: "X/3 Votes Required", progress bar, vote tally (APPROVE green count, REJECT red count, PENDING grey count)
  - "ZK Proof Pipeline" card: 4 stage progress bar (INGEST → CIRCUIT GEN → PROVE → VERIFY), active stage glows indigo
- Right column (60%): "Council Chamber" — one card per council agent:
  - Agent name + model name badge (e.g. "LLAMA-3-70B")
  - Status badge: APPROVE (green) / REJECT (red) / DELIBERATING (amber, pulsing dot)
  - Terminal-style reasoning text block (monospace, dark bg)
  - CONFIDENCE label + progress bar (green if approved, amber if deliberating)

DATA WIRING:
- Read session_id from URL param: const sessionId = new URLSearchParams(window.location.search).get('session')
- If no session_id, query latest: SELECT * FROM council_sessions ORDER BY created_at DESC LIMIT 1

1. Transaction Proposal: SELECT * FROM council_sessions WHERE session_id = $sessionId
2. Council votes: SELECT * FROM council_votes WHERE session_id = $sessionId ORDER BY created_at ASC
3. Consensus status: count APPROVE/REJECT/null from council_votes rows
4. ZK Pipeline: SELECT * FROM aggregation_batches WHERE session_id = $sessionId (or closest match) — map fields to stage completion
5. REALTIME: supabase.channel('council-' + sessionId).on('postgres_changes', { event: '*', schema: 'public', table: 'council_votes', filter: 'session_id=eq.' + sessionId }, payload => { update the matching agent card with new vote/confidence/reasoning, animate transition from DELIBERATING to final state })
6. When approved_count >= 2: auto-update Transaction Proposal badge from PENDING to CLEAN with a green flash animation

All in single self-contained HTML file.
```

---

## PROMPT 5 — ZK-ML Cognition Proof Engine
```
Read: MASTER-BUILD.md, DESIGN.md, ui-integration.md (Screen 5 — ZK-ML section)

Create ui/zk-ml.html from scratch.

DESIGN RULES: Same neomorphic system. Use Guardian Prime sidebar: "Guardian Prime / V3.1 Institutional", + New Proof button, ZK-ML Dive (ACTIVE), Vaccine Shield, Circuit Viz, Merkle Tree, Audit Node, System Status, Settings.

LAYOUT (match ZK-ML screenshot):
- Top section: "Circuit Architecture" card with label "relu.circom" — SVG diagram showing private inputs (pre[0], pre[1], ..., pre[7]) flowing into processing pipeline nodes (ReLU Layer → CognitionLayer → ModelCommitment). Each node is a neomorphic raised card. Arrows are SVG paths.
- Right sidebar metrics: Performance card (Xms/proof + mini bar chart of last 7 proofs), Success Rate card (XX.XX% + circular gauge), Security Events card (0 Critical + last audit sync time)
- "Proof Explorer" section: filter button, table with columns ID, Agent, Amount, decisionHash, commitment, Time, Status — VERIFIED=green badge, PENDING=grey badge, eye icon action
- "Trusted Setup Parameters" accordion at bottom (collapsed by default): shows protocol, curve, nPublic, IC count from verification_key.json

DATA WIRING:
1. Performance: SELECT latency_ms FROM aggregation_batches ORDER BY created_at DESC LIMIT 7 — show AVG as "Xms/proof", last 7 as mini sparkline bars (use inline SVG bars)
2. Success Rate: SELECT COUNT(*) FILTER (WHERE approved=true)::float / COUNT(*) * 100 FROM council_sessions — circular SVG gauge, stroke-dashoffset animation
3. Security Events: SELECT COUNT(*) FROM sentinel_alerts WHERE severity >= 2 AND created_at > NOW() - INTERVAL '24 hours'
4. Last audit sync: SELECT created_at FROM sentinel_heartbeats ORDER BY created_at DESC LIMIT 1 → timeAgo()
5. Proof Explorer table: SELECT ab.*, cs.amount, cs.agent FROM agent_batch_participations abp JOIN aggregation_batches ab ON abp.batch_id = ab.batch_id JOIN council_sessions cs ON cs.session_id = abp.session_id ORDER BY ab.created_at DESC LIMIT 20
6. Trusted Setup: fetch('/api/vkey') — create a simple Express/Next route that reads circuits/build/verification_key.json and returns it. If route doesn't exist, read the file directly from the project and inline the values.
7. Circuit diagram: STATIC SVG — hardcode the relu.circom structure. No data fetch needed.

All in single self-contained HTML file.
```

---

## PROMPT 6 — Vaccine Shield
```
Read: MASTER-BUILD.md, DESIGN.md, ui-integration.md (Screen 6 — Vaccine Shield section)

Create ui/vaccine-shield.html from scratch.

DESIGN RULES: Same neomorphic system. Same Guardian Prime sidebar. Vaccine Shield is ACTIVE nav item.

LAYOUT (match Vaccine Shield screenshot):
- Page title "VACCINE SHIELD" + subtitle "Self-Immunizing Threat Defense Matrix"
- Left column: "Immunity Status" card — large percentage "99.8%" in indigo, "Network threat resilience score", two stat rows (Total Blacklisted count, Recent Blocks 24h count)
- Right column (large): "Sparse Merkle Tree Blacklist" card — scatter plot visualization showing fingerprint blocks as colored dots. Subtitle: "Visualizing level 6 depth fingerprint blocks"
- Row of 3 tier cards: SOFT TIER (amber, count, "Temporary cooldowns"), HARD TIER (red, count, "Requires manual review"), PERMANENT TIER (dark red, count, "Irrevocable network ban")
- "Active Blacklist Registry" table: DECISIONHASH, CONTEXTHASH, TIER badge, SLASH amount (red), ACTIONS eye icon
- Bottom row: "Hamming Distance Map" card (left, heat-map grid) + "Immunity Growth Timeline" card (right, line chart)

DATA WIRING:
1. Total Blacklisted: SELECT COUNT(*) FROM vaccine_fingerprints WHERE expires_at > NOW() OR tier='PERMANENT'
2. Recent Blocks 24h: SELECT COUNT(*) FROM vaccine_fingerprints WHERE added_at > NOW() - INTERVAL '24 hours'
3. Immunity Score: 1 - (recent_count / (SELECT COUNT(*) FROM vaccine_fingerprints)) → format as %
4. Tier counts: SELECT tier, COUNT(*) FROM vaccine_fingerprints WHERE (expires_at > NOW() OR tier='PERMANENT') GROUP BY tier
5. Scatter plot: SELECT decision_hash, context_hash, tier, added_at FROM vaccine_fingerprints ORDER BY added_at DESC LIMIT 50 — map to x/y coords, render on <canvas> using Canvas API. SOFT=rgba(245,158,11,0.6), HARD=rgba(220,38,38,0.8), PERM=rgba(153,27,27,1.0). Each dot is radius 6. On hover show tooltip with truncated hash + tier.
6. Active Blacklist table: SELECT * FROM vaccine_fingerprints WHERE tier IN ('HARD','PERMANENT') AND (expires_at > NOW() OR tier='PERMANENT') ORDER BY added_at DESC LIMIT 20
7. Hamming Distance Map: SELECT decision_hash FROM vaccine_fingerprints WHERE tier='HARD' ORDER BY added_at DESC LIMIT 10. For each pair compute client-side Hamming distance on hex string. Render as NxN grid on <canvas>. Color: distance 0=red, 8+=green (interpolate RGB). Show tooltip on cell hover.
8. Immunity Growth Timeline: SELECT DATE_TRUNC('day', added_at) as day, COUNT(*) FROM vaccine_fingerprints GROUP BY day ORDER BY day DESC LIMIT 30 — Chart.js line, cumulative sum for total immunity line, indigo color.

All in single self-contained HTML file.
```

---

## PROMPT 7 — Agent Registry
```
Read: MASTER-BUILD.md, DESIGN.md, ui-integration.md (Screen 3 — Agent Registry section)

Create ui/agent-registry.html from scratch.

DESIGN RULES: Same neomorphic system. Silk Security sidebar: Dashboard, System Status, Agent Registry (ACTIVE), ZK-ML, Council, Vaccine, Settings.

LAYOUT (match Agent Registry / NEXUS-7 screenshot):
- Breadcrumb: "Agent Registry > NEXUS-7"
- Agent header card (left 60%): avatar image (or placeholder circle with agent initials), agent name "NEXUS-7", green ACTIVE badge, wallet address truncated, description text, "Suspend Agent" button + "Explorer" button
- Reputation card (right 40%): "Reputation Score" label, large circular gauge showing score/1000, "Trust Level: Excellent/Good/At Risk" below
- Tab bar: Overview (active) / ZK Proofs / Council History / Vaccine Status / Configuration — neomorphic tab style
- Overview tab content:
  - 4 metric cards: Total Transactions (+12% badge), ZK Verified (+5% badge), Council Approvals, Escalations (-2% badge)
  - "30-Day Volume (USDC)" area chart (Chart.js, indigo fill)
  - "Security Vector" radar chart (Chart.js, 4 axes: Integrity, Logic, Latency, Data)
- Recent Execution Logs table: TX Hash, Action, ZK Status, Value, Time

DATA WIRING:
- Read agent address from URL: const agentAddr = new URLSearchParams(window.location.search).get('agent')
- If no agent param, load the most recently active agent from council_sessions

1. Agent metadata: agentRegistry.tokenURI(tokenId) → fetch JSON, extract name/description. If tokenId unknown, query SELECT agent FROM council_sessions ORDER BY created_at DESC LIMIT 1
2. Reputation score: agentRegistry.getReputation(tokenId) — if 0, derive from council_sessions success rate * 1000
3. Trust level: score > 800 → 'Excellent' (green), 600-800 → 'Good' (amber), <600 → 'At Risk' (red)
4. Metric cards: SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE approved=true) as zk_verified, COUNT(*) FILTER (WHERE consensus IS NOT NULL) as council_approvals, COUNT(*) FILTER (WHERE consensus LIKE '%ESCALATE%') as escalations FROM council_sessions WHERE agent = $agentAddr
5. 30-Day Volume chart: SELECT DATE_TRUNC('day', created_at) as day, SUM(CAST(amount AS NUMERIC)) as vol FROM council_sessions WHERE agent=$agentAddr AND created_at > NOW()-INTERVAL '30 days' GROUP BY day ORDER BY day — Chart.js area, fill rgba(99,102,241,0.15)
6. Security Vector radar: derive 4 scores client-side from the metric card data, render Chart.js radar, fill rgba(124,58,237,0.3)
7. Execution Logs table: SELECT session_id, reason, approved, amount, created_at FROM council_sessions WHERE agent=$agentAddr ORDER BY created_at DESC LIMIT 10 — approved=true→VERIFIED green badge, null→PENDING ZK badge
8. Suspend Agent button: calls agentRegistry.suspend(tokenId) via getSigner() — show confirmation modal first, show tx hash toast on success
9. ZK Proofs tab: SELECT ab.* FROM agent_batch_participations abp JOIN aggregation_batches ab ON abp.batch_id=ab.batch_id WHERE abp.agent_address=$agentAddr ORDER BY ab.created_at DESC LIMIT 20
10. Vaccine Status tab: SELECT * FROM vaccine_fingerprints WHERE agent_address=$agentAddr — if empty show "Clean — No blacklisted fingerprints" with green checkmark

All in single self-contained HTML file.
```

---

## PROMPT 8 — Cross-Chain Sentinel
```
Read: MASTER-BUILD.md, DESIGN.md, ui-integration.md (Screen 7 — Cross-Chain Sentinel section)

Create ui/cross-chain-sentinel.html from scratch.

DESIGN RULES: Same neomorphic system. AgentGuardian sidebar (Guardian Sentinel / Operational Center): Sentinel Ops, Symbolic Verifier, Chain Monitors (ACTIVE), Verification Logs, Network Settings. "New Analysis" button at bottom.

LAYOUT (match Cross-Chain Sentinel screenshot):
- Page title "CROSS-CHAIN SENTINEL" + green dot + "DEFCON-1 NORMAL" status text
- Top right: "Refresh Topology" button (raised neomorphic with refresh icon)
- Left column (60%):
  - "Network Routing Topology" card with "LIVE" badge — SVG world map (simple flat projection) with 4 chain nodes: Ethereum, Arbitrum, Base, Polygon. Each node is a colored circle with label. Lines connecting nodes to center.
  - Row below: "Message Breakdown" card (donut chart, total in center) + "Active Council Appeals" card (list of appeal items with countdown timers and vote dots)
- Right column (40%):
  - "System Threat Level" neomorphic circle gauge — large number 1-5, DEFCON label
  - (rest of right column is part of bottom section)
- Bottom: "Freeze Propagation History" table

DATA WIRING:
1. DEFCON level: SELECT defcon_level FROM sentinel_alerts ORDER BY created_at DESC LIMIT 1. Map: 1→green "DEFCON-1 NORMAL", 2→amber "DEFCON-2 ELEVATED", 3→orange "DEFCON-3 HIGH", 4→red "DEFCON-4 CRITICAL", 5→dark-red "DEFCON-5 MAX"
2. Network map: SELECT chain_status FROM sentinel_heartbeats ORDER BY created_at DESC LIMIT 1. Parse JSON field. Chain nodes hardcoded lat/long mapped to SVG x/y coordinates on a 730x260 SVG viewBox: Ethereum (220,100), Arbitrum (170,110), Base (80,115), Polygon (300,130). Node color: ONLINE=#10b981, DEGRADED=#f59e0b, OFFLINE=#dc2626. Draw SVG <line> from each node to center point (400,130).
3. Message Breakdown donut: SELECT msg_type, COUNT(*) FROM cross_chain_freezes GROUP BY msg_type — Chart.js doughnut. Colors: #6366f1 / #7c3aed / #dc2626. Total count in center.
4. Council Appeals: SELECT * FROM sentinel_appeals WHERE status='ACTIVE' ORDER BY expires_at ASC. For each show countdown (expires_at - NOW()) updated every second with setInterval. Vote dots: parse votes JSON field.
5. Threat Level gauge: same DEFCON number from query 1. Render as neomorphic pressed circle. Color ring: conic-gradient or SVG arc.
6. Freeze Propagation table: SELECT * FROM cross_chain_freezes ORDER BY created_at DESC LIMIT 20. Map: msg_type='FREEZE'→red FREEZE badge, 'WARN'→amber WARN badge. Show zk_proof_hash IS NOT NULL → ✅ green checkmark, else ⬜. Status 'PROPAGATED'→green badge.
7. Refresh Topology button: re-run query 2 and redraw SVG map. Animate nodes fading in.
8. Realtime: subscribe to sentinel_alerts for new DEFCON changes — update badge color immediately without reload.

All in single self-contained HTML file.
```

---

## PROMPT 9 — Neural-Symbolic Verification (upgrade existing)
```
Read: MASTER-BUILD.md, DESIGN.md, ui-integration.md (Screen 8 — Neural-Symbolic Verification section)

Open the existing file: ui/neural-symbolic.html

DO NOT change any HTML structure or CSS. The neomorphic layout and 3-column card design must stay exactly as-is.

Add the following ONLY:

1. At the top of <body>, add a <script src="ui/js/env.js"></script> tag
2. At the bottom of <body>, add <script type="module"> block:

DATA WIRING:
a. "Re-evaluate" button: on click, call supabase to fetch most recent pending council_session, then POST to /api/symbolic-check with that session_id. Show a loading spinner on the button while awaiting. Show toast "Re-evaluation queued" on success.

b. Lyapunov Stability card — append below the existing paragraph text:
   - Fetch: SELECT COUNT(*) FILTER (WHERE lyapunov_value=0)::float / COUNT(*) FROM symbolic_checks — show as "V(s)=0 rate: XX%"
   - Add a sparkline: fetch last 20 rows from symbolic_checks, render inline SVG row of 20 small circles (8px), green if lyapunov_value=0, red if not. Append inside the card.

c. Prospect Theory card — append below existing paragraph:
   - Fetch: SELECT COUNT(*) FROM symbolic_checks WHERE loss_adjusted_ev < 0 AND created_at > NOW()-INTERVAL '24 hours'
   - Show as: "X decisions blocked by loss-aversion gate today"

d. Shannon Entropy card — append below existing paragraph:
   - Fetch: SELECT AVG(council_entropy) FROM symbolic_checks
   - Show as a horizontal progress bar (0.0–1.0). Label: "Avg entropy: X.XX". Bar color: green if <0.5, amber if 0.5-0.8, red if >0.8.

e. After the 3-column grid section, INSERT a new section (append to main content, before closing </main>):
   "Property Verification Table" — neomorphic raised card:
   - Fetch: SELECT * FROM symbolic_checks ORDER BY created_at DESC LIMIT 10
   - Columns: CHECK ID (truncated), AGENT (truncated), STATUS (SAT=green badge, UNSAT=red badge), BITMASK (render as 10 colored dots: filled indigo = property satisfied, hollow red = violated), LYAPUNOV, LA-EV, ENTROPY, TIME
   - "View violations" link per UNSAT row: opens <dialog> modal listing which P1-P10 bits are 0 in satisfaction_bitmask

f. After that, INSERT "Violation History" chart section:
   - neomorphic raised card titled "Violation History (14 days)"
   - Fetch: SELECT DATE_TRUNC('day', created_at) as day, COUNT(*) as violations FROM symbolic_checks WHERE status='UNSAT' GROUP BY day ORDER BY day DESC LIMIT 14
   - Chart.js bar chart, color #dc2626, label "Violations per day"

All additions must use the same neomorphic card style as the existing cards.
```

---

## PROMPT 10 — Insurance Pool & Underwriter DAO (upgrade existing)
```
Read: MASTER-BUILD.md, DESIGN.md, ui-integration.md (Screen 9 — Insurance Pool section)

Open the existing file: ui/insurance-pool.html

DO NOT change any HTML structure or CSS. Preserve the neomorphic layout exactly.

Add the following ONLY:

1. At the top of <body>, add env.js script tag
2. At bottom, add <script type="module"> block:

INSURANCE POOL TAB data wiring:
a. Total Staked card: insurancePool.totalStaked() → ethers.formatUnits(val, 6) → fmtUSD()
b. Active Policies card: insurancePool.activePolicyCount()
c. Claims card: insurancePool.totalClaims()
d. Premium Revenue card: SELECT SUM(premium_amount) FROM council_sessions — if column missing use SELECT COUNT(*) * 50 as estimate
e. Pool Health gauge (the SVG circle already exists):
   - insurancePool.totalStaked() / (insurancePool.activePolicyCount() * 10000) * 100 = collateralization %
   - Update the <span> showing "340%" with live value
   - Update SVG stroke-dashoffset: dashoffset = 283 - (min(pct, 100) / 100 * 283) — wait, the full circle at 340% should show near-full arc. Calculate: arc = min(pct / 400 * 283, 265). Set circle stroke-dashoffset = 283 - arc.
   - Color: >200%=#10b981 (green), 100-200%=#f59e0b (amber), <100%=#dc2626 (red)
f. My Staking Position:
   - getSigner() to get connected wallet address — if no wallet, show "Connect Wallet" button styled as neomorphic raised
   - insurancePool.getStake(walletAddress) → format as fmtUSD()
   - insurancePool.getEarnings(walletAddress) → show as "+$X,XXX (X.X% APY)"
   - "Increase Stake" button: on click open <dialog> modal with amount input (neomorphic inset style) + confirm button → insurancePool.stake(parseUnits(amount, 6)) → show tx hash toast
   - "Withdraw" button: on click open <dialog> modal → insurancePool.unstake(parseUnits(amount, 6)) → show tx hash toast

UNDERWRITER DAO TAB (tab already exists as button):
- Wire the tab click to show/hide content sections
- Create the Underwriter DAO content section (hidden by default, shown when tab clicked):
  - 4 metric cards row: Active Underwriters (underwriterDAO.activeUnderwriterCount()), Total rAGNT Staked (underwriterDAO.totalRagntStaked()), Pending Applications (underwriterDAO.pendingApplicationCount()), Slashes This Epoch (SELECT COUNT(*) FROM underwriter_dao_events WHERE event_type='SLASH' AND created_at > NOW()-INTERVAL '7 days')
  - Active Underwriters table: SELECT DISTINCT underwriter_address, reputation_score, total_exposure FROM underwriter_dao_events ORDER BY reputation_score DESC LIMIT 10
  - Pending Applications list: underwriterDAO.getPendingApplications() → for each address show a card with "Vote Approve / Reject" buttons (if connected wallet is underwriter)

All in same neomorphic style. All additions must match existing card padding and shadow styles.
```

---

## PROMPT 11 — Analytics
```
Read: MASTER-BUILD.md, DESIGN.md, ui-integration.md (Screen 11 — Analytics section)

Create ui/analytics.html from scratch.

DESIGN RULES: Same neomorphic system. Sidebar: AgentGuardian / AI Security Suite, Dashboard, Security, Analytics (ACTIVE), Settings. "Upgrade Plan" button at bottom.

LAYOUT (match Analytics screenshot):
- Top bar: search input only (no DEFCON in this variant), notification bell, avatar
- Page title "ANALYTICS" + subtitle "Performance & Security Metrics Dashboard"
- Time range selector top right: 7D (active, indigo), 30D, 90D, Custom — neomorphic tab style
- Main grid:
  - Left (large, 65%): "TRANSACTION VOLUME & VALUE" card with combo chart (bars=volume, line=value). Legend: Volume(Count) purple circle, Value(USD) dark indigo circle.
  - Right (35%): "SECURITY EVENTS" card — list of 3 recent events, each with icon circle, title, subtitle, time ago
  - Bottom left (40%): "THREAT DETECTION" card — horizontal funnel visualization (4 stacked bars getting shorter: Proposals Evaluated, Flagged by Models, Council Reviewed, Blocked)
  - Bottom right (60%): "MODEL PERFORMANCE" card — grouped bar chart (3 groups: Accuracy, Latency, Cost Eff.) with 2 bars each (GPT-4o=#818cf8, Claude/Groq=#a78bfa)

DATA WIRING:
- Read time range from active tab. Default: 7 days. On tab click re-fetch all data.
- const from = new Date(Date.now() - days * 86400000).toISOString()

1. Transaction Volume & Value combo chart:
   Volume: SELECT DATE_TRUNC('day', created_at) as day, COUNT(*) FROM council_sessions WHERE created_at > $from GROUP BY day ORDER BY day
   Value: SELECT DATE_TRUNC('day', created_at) as day, SUM(CAST(amount AS NUMERIC)) FROM council_sessions WHERE created_at > $from GROUP BY day ORDER BY day
   Chart.js: type 'bar' for volume (dataset 1, yAxisID: 'y1', color: rgba(129,140,248,0.7)), type 'line' for value (dataset 2, yAxisID: 'y2', color: #6366f1, tension: 0.4)

2. Security Events list: SELECT * FROM sentinel_alerts WHERE created_at > $from ORDER BY created_at DESC LIMIT 5
   severity=3 → red triangle icon + "High Risk Alert", severity=2 → blue shield icon + "Council Auto-Reject", severity=1 → grey gear icon + "Policy Update"

3. Threat Detection funnel: SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE approved IS NOT NULL) as reviewed, COUNT(*) FILTER (WHERE approved=false) as blocked FROM council_sessions WHERE created_at > $from
   Flagged = reviewed * 0.25 (estimate if no direct column)
   Render as 4 horizontal bars, each full-width div with width proportional to count. Colors: darkening indigo shades.

4. Model Performance chart: SELECT model, AVG(latency_ms) as avg_latency, COUNT(*) FILTER (WHERE decision = (SELECT consensus FROM council_sessions cs WHERE cs.session_id = council_votes.session_id))::float / COUNT(*) as accuracy FROM council_votes WHERE created_at > $from GROUP BY model
   Normalize scores 0-1, render Chart.js grouped bar. Groups: Accuracy, Latency (inverted), Cost Eff (static estimate per model).

5. Time range tabs: on click update $from, re-fetch all 4 datasets, update all charts via chart.data.datasets[].data = [...] then chart.update()

All in single self-contained HTML file. Use Chart.js from CDN.
```

---

## PROMPT 12 — Settings
```
Read: MASTER-BUILD.md, DESIGN.md, ui-integration.md (Screen 12 — Settings section)

Create ui/settings.html from scratch.

DESIGN RULES: Same neomorphic system. Sidebar: AgentGuardian / AI Security Suite, Dashboard, Security, Analytics, Settings (ACTIVE). "Upgrade Plan" button at bottom.

LAYOUT (match Settings screenshot):
- Page title "SETTINGS" + subtitle "Configure your guardian network parameters and security layers."
- Tab bar: General / Security Layers (active) / Notifications / API & Keys / Network / Billing — neomorphic tab pills in a row
- Security Layers tab content (shown by default):
  - 3-column card grid: ZK-ML Verifier, Council Consensus, Prompt Vaccine
  - 1 card below (full left): Semantic Policy Firewall (disabled state)
  - Each card: icon circle (neomorphic pressed), title, status dot + label (Active=green, Learning=amber, Disabled=grey), description text, toggle switch (right-aligned in header), "Configure" button + "Logs" button (side by side, neomorphic raised style)
  - Toggle switch: custom CSS toggle using the neomorphic pressed track + raised thumb style. No flat toggles.

DATA WIRING:
1. On page load: SELECT * FROM layer_config — map each row to its card
   - zkml → ZK-ML Verifier card
   - council → Council Consensus card
   - vaccine → Prompt Vaccine card
   - firewall → Semantic Policy Firewall card
   
2. Toggle switch interaction: on change UPDATE layer_config SET enabled=$val, status=$status, updated_at=NOW() WHERE layer_id=$id via supabase.from('layer_config').update({enabled, status}).eq('layer_id', id)
   - enabled=true + was 'Disabled' → set status='Active'
   - enabled=false → set status='Disabled'
   - Show optimistic UI update (update DOM immediately, revert on error)

3. "Configure" button: opens a <dialog> modal specific to each layer:
   - ZK-ML: show model_commitment hash (read-only), threshold slider (neomorphic slider style)
   - Council: show quorum_required number input, timeout_seconds input
   - Vaccine: show tier thresholds (SOFT/HARD/PERM score cutoffs)
   - Firewall: show policy_regex text inputs
   On save: UPDATE layer_config SET config_json=$json WHERE layer_id=$id

4. "Logs" button: navigate to system-logs.html?filter=$layerId

5. General tab (hidden until clicked):
   - Organization name input (neomorphic inset)
   - Connected wallet address display (read from getSigner() or show "Not connected")
   - Chain selector dropdown (neomorphic raised dropdown): Arc Testnet / Arc Mainnet
   - "Save Changes" button

6. API & Keys tab (hidden until clicked):
   - Fetch masked keys from /api/keys endpoint (create simple route returning {name, maskedValue} array)
   - Each key row: key name, masked value (show last 4 chars: "••••••••••••abcd"), "Regenerate" button → POST /api/rotate-key?name=$name → show new masked value
   - Warning: "Never expose full API keys in the frontend"

All in single self-contained HTML file.
```

---

## PROMPT 13 — System Architecture
```
Read: MASTER-BUILD.md, DESIGN.md, ui-integration.md (Screen 13 — Architecture section)

Create ui/architecture.html from scratch.

DESIGN RULES: Same neomorphic system. Sidebar: AgentGuardian logo, Guardian Core / V6.2.0-Alpha header, Overview, Architecture (ACTIVE), Threat Matrix, Layer 6F Research, System Health. Bottom: "Request Node Access" button, Documentation link, Legal link.

LAYOUT (match Architecture screenshot):
- Top bar: search "Search architecture node...", history icon button, settings icon button, avatar
- Page title "System Architecture" centered, subtitle "Interactive visualization of the 10-layer AgentGuardian execution pipeline."
- Center column (60%): vertical pipeline of layer cards, connected by SVG arrows (indigo, downward pointing)
  - Human Principal card: person icon, "Human Principal", "Intent Generation & Authentication", right-aligned LATENCY badge "12ms"
  - Arrow ↓
  - Orchestrator card: hub icon, "Orchestrator", "Task Routing & State Management"
  - Arrow ↓
  - Layer 3: Council card: LEFT BORDER violet #7c3aed (4px), scales icon, "Layer 3: Council", "Consensus & Policy Evaluation"
  - Layer 1: ZK-ML card: LEFT BORDER green #10b981, lock icon, "Layer 1: ZK-ML", "Zero-Knowledge Inference Proofs"
  - Layer 6B: Vaccine card: LEFT BORDER red #dc2626, vaccine icon, "Layer 6B: Vaccine", "Adversarial Prompt Injection Defense"
  - Layer 2: Smart Contracts card: document icon, "Layer 2: Smart Contracts", "On-Chain Execution & Settlement", right-aligned GAS EST. badge "~45k"
  Each card: neomorphic raised, padding 20px, click → highlight with indigo box-shadow pulse animation
  
- Right column (40%): "CROSS-CUTTING SYSTEMS" header
  - Layer 4: MCP card (icon, title, description from MASTER-BUILD.md)
  - Layer 5: Feedback card
  - Layer 6A: Underwriter card (orange icon)
  - Layer 6C: Sentinel card (red eye icon)
  Each is a smaller neomorphic raised card.

DATA WIRING (minimal — mostly static):
1. Orchestrator card latency: SELECT AVG(latency_ms) FROM aggregation_batches ORDER BY created_at DESC LIMIT 10 → show as "Xms" in LATENCY badge
2. Layer 1 ZK-ML latency: same query → show as "Xms"  
3. Smart Contracts gas: static "~45k" — or fetch latest gas estimate from a hardhat gas report if available in the project

4. "Request Node Access" button in sidebar: on click open <dialog> modal:
   - Wallet address field (auto-fill from getSigner() if connected, else text input)
   - Reason textarea (neomorphic inset)
   - Submit button → supabase.from('node_access_requests').insert({wallet, reason}) → show "Request submitted" toast, close modal

5. Layer card click interactions:
   - On click: add indigo glow box-shadow to clicked card (box-shadow: 0 0 0 3px #6366f1)
   - Scroll right column to show relevant cross-cutting card if applicable
   - Show a small detail panel below the clicked card (slide down animation) with full description from MASTER-BUILD.md

All in single self-contained HTML file.
```

---

## PROMPT 14 — Layer 6F Research
```
Read: MASTER-BUILD.md (Layer 6F section specifically), DESIGN.md, ui-integration.md (Screen 14 — Layer 6F Research section)

Create ui/layer6f-research.html from scratch.

DESIGN RULES: Same neomorphic system. Same Guardian Core sidebar. Layer 6F Research is ACTIVE nav item. This page is mostly static — minimal data fetching.

LAYOUT (match Layer 6F screenshot exactly):
- Top bar: search, history, settings, avatar
- Sidebar: same Guardian Core sidebar as architecture.html
- "RESEARCH PHASE" pill badge (amber/orange, pulsing dot) centered at top of content
- Page title "LAYER 6F — VERIFIABLE TRAINING PIPELINE" (large, centered, bold)
- Subtitle "The Final Frontier: Prove Not Just Inference, But Training Itself" (indigo colored)
- Introduction paragraph (from MASTER-BUILD.md Layer 6F description)
- 3 feature cards row (neomorphic raised):
  - Training Data Compliance: stack icon, title, description
  - Protocol Verification: branching icon, title, description  
  - Weight Integrity: chip icon, title, description
- "Powered by Advanced Folding" section (2-column):
  - Left: heading, paragraph, 3 checklist items (indigo checkmark circle + text):
    - Sub-linear verification time
    - O(1) recursion overhead
    - Distributed prover networking
  - Right: neomorphic raised card with animated infinity symbol (SVG ∞ with rotating conic-gradient stroke, indigo→violet, animation: spin 3s linear infinite)
- "Path to Production" timeline (centered):
  - Heading "Path to Production"
  - 4 step circles in a row connected by lines:
    - Step 1 (filled indigo circle, current): "Q2 2026" below, "Folding Scheme Benchmarks" caption
    - Step 2 (grey outlined circle): "Q4 2026", "Single-Node Verifiable Training"
    - Step 3 (grey outlined circle): "Q2 2027", "Distributed Prover Cluster"  
    - Step 4 (grey outlined circle): "Q4 2027", "Layer 6F Mainnet Integration"
  - Connecting lines between circles: grey dashed line, 1px

NO DATA WIRING needed for this page. Everything is static from MASTER-BUILD.md.

The only interactive element: clicking a future step circle shows a tooltip/popover with "Estimated: [date] — Subject to research outcomes" in a neomorphic raised tooltip.

The "RESEARCH PHASE" badge should pulse: CSS animation opacity 1→0.6→1 every 2 seconds.

All in single self-contained HTML file.
```

---

## PROMPT 15 — Final Polish & Navigation Wiring
```
Read: MASTER-BUILD.md, DESIGN.md, all files in ui/ folder

You now have all 14 screens built. Do the following final wiring pass:

1. SHARED NAVIGATION: Every sidebar <a> link must point to the correct relative file path. Wire all nav links across all HTML files:
   - dashboard.html → ui/dashboard.html
   - system-logs.html → ui/system-logs.html
   - zk-ml.html → ui/zk-ml.html (from Silk Security and Guardian Prime navs)
   - vaccine-shield.html → ui/vaccine-shield.html
   - cross-chain-sentinel.html → ui/cross-chain-sentinel.html
   - neural-symbolic.html → ui/neural-symbolic.html
   - insurance-pool.html → ui/insurance-pool.html
   - batch-proofs.html → ui/batch-proofs.html
   - analytics.html → ui/analytics.html
   - settings.html → ui/settings.html
   - architecture.html → ui/architecture.html
   - layer6f-research.html → ui/layer6f-research.html
   - agent-registry.html → ui/agent-registry.html
   - council-deliberation.html → ui/council-deliberation.html

2. ACTIVE STATE: Each page's sidebar must apply the pressed inset shadow to the correct nav item matching the current page. Use window.location.pathname to detect current page.

3. GLOBAL TOP BAR DATA: Create a shared function loadTopBar() in ui/js/client.js that:
   - Fetches DEFCON level from sentinel_alerts
   - Fetches threats blocked count from cross_chain_freezes
   - Fetches unread alert count for notification bell badge
   Import and call this in every page that has the top bar.

4. COUNCIL SESSIONS → AGENT REGISTRY LINK: In the Recent Execution Logs tables and activity streams, make each agent address a clickable link → agent-registry.html?agent=$address

5. COUNCIL SESSIONS → DELIBERATION LINK: In any table showing session_id, make it a clickable link → council-deliberation.html?session=$sessionId

6. TOAST NOTIFICATION SYSTEM: Create a shared toast() function in client.js:
   - Appends a fixed-position div (bottom-right, z-index 9999)
   - Neomorphic raised style, indigo border-left
   - Auto-dismisses after 4 seconds with fade-out animation
   - Usage: toast('Transaction submitted', 'success') or toast('Error connecting wallet', 'error')
   Import and use toast() in all write operation buttons across all pages.

7. LOADING SKELETONS: In every data-fetching section, show a skeleton pulse div while loading:
   .skeleton { background: linear-gradient(90deg, #dcdee4 25%, #e8eaf0 50%, #dcdee4 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; }
   @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
   Replace skeleton with real content on data load.

8. ERROR STATES: If any Supabase query returns an error, show inline: a small red text "Failed to load — retry" with a retry button that re-runs the fetch.

9. Create ui/index.html that redirects to ui/dashboard.html (meta refresh or JS redirect).

10. Verify all Chart.js instances are destroyed before re-initializing on data refresh (chart.destroy() before new Chart()) to prevent canvas re-use errors.

Report any broken imports, missing tables, or contract calls that returned errors during this session.
```
