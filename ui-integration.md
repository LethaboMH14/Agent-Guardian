# AgentGuardian — UI Integration Specification
> **Purpose:** Maps every UI screen to its exact backend data sources so Windsurf Cascade can wire the full stack in one session.
> **Design System:** Neomorphic / Soft UI — see `DESIGN.md`. All surfaces use `#e8eaf0`, raised shadow `6px 6px 12px rgba(0,0,0,0.08), -6px -6px 12px rgba(255,255,255,0.6)`, pressed shadow `inset 4px 4px 8px rgba(0,0,0,0.06), inset -4px -4px 8px rgba(255,255,255,0.5)`. Font: Plus Jakarta Sans. Primary: `#6366f1`. Never mix flat design with neomorphic.
> **Stack:** ethers.js (v6) for contract reads, `@supabase/supabase-js` for DB queries, environment variables from `.env`.

---

## Global Shell (shared across all screens)

### File: `ui/shell.html` or shared `<head>` / nav partial

**Top Bar — live data:**
| Element | Source | Contract / Table | Method / Query |
|---------|--------|-----------------|----------------|
| DEFCON badge (e.g. "DEFCON-5") | `sentinel.ts` state | Supabase `sentinel_alerts` | `SELECT defcon_level ORDER BY created_at DESC LIMIT 1` |
| "THREATS BLOCKED" counter | Supabase `cross_chain_freezes` | — | `SELECT COUNT(*) WHERE status = 'PROPAGATED'` |
| Notification bell count | Supabase `sentinel_alerts` + `symbolic_checks` | — | Count unread rows created in last 24h |

**Sidebar active state:** driven by `window.location.pathname` — highlight the matching `<a>` with the pressed neomorphic shadow.

**"New Analysis" / "New Proof" CTA:** Opens a modal; no backend call on open.

---

## Screen 1 — Dashboard
**File:** `ui/dashboard.html`
**Nav label:** Dashboard
**Reference screenshot:** Image 2 (AgentGuardian dashboard with 5 metric cards + bar chart + security layers)

### Metric Cards (top row)
| Card | Contract | Method | Fallback |
|------|----------|--------|----------|
| Total Agents | `AgentRegistry.sol` | `agentRegistry.totalSupply()` | — |
| Txs Secured | `AgentGuardian.sol` | Supabase `council_sessions` → `SELECT COUNT(*) WHERE approved = true` | — |
| ZK Success % | Supabase `council_sessions` | `SELECT COUNT(*) WHERE approved=true / COUNT(*)` | — |
| Gas Savings (ETH) | Supabase `aggregation_batches` | `SELECT SUM(gas_saved_pct * gas_used) / 1e18` | — |
| Insurance Pool ($) | `InsurancePool.sol` | `insurancePool.totalStaked()` → format as USD at $1/USDC | — |

### Transaction Security Timeline (bar chart)
- **Source:** Supabase `council_sessions`
- **Query:** `SELECT DATE_TRUNC('hour', created_at) as hour, COUNT(*) as count FROM council_sessions GROUP BY hour ORDER BY hour DESC LIMIT 24`
- **Render:** Use `Chart.js` bar chart. X-axis = hour labels (00:00–24:00). Bars = transaction count per hour. Accent color `#818cf8` (lighter indigo).

### Security Layers panel (right column)
| Layer | Live status field | Source |
|-------|------------------|--------|
| Smart Contract Scanner | Always "Active" — static | — |
| Multi-Sig Validator | Council quorum % | Supabase `council_sessions` latest row → `consensus` field |
| Risk Oracle | Always "Active • Updating" — static | — |
| Slashing Engine | `InsurancePool.sol` | `insurancePool.totalSlashed()` > 0 → "Active", else "Standby" |

### Council Consensus gauge
- **Source:** Supabase `council_sessions`
- **Query:** Latest session → parse `consensus` JSON field for approval % 
- **Render:** SVG donut / CSS conic-gradient. Show percentage + "QUORUM" label.

### ZK Proof Performance
- **Source:** Supabase `aggregation_batches`
- **Query:** `SELECT AVG(latency_ms) as gen_time FROM aggregation_batches ORDER BY created_at DESC LIMIT 10`
- **Static fallback values** (hardcode until live): Generation 142ms, Verification 45ms, Proof Size 192 bytes.

---

## Screen 2 — System Logs
**File:** `ui/system-logs.html`
**Nav label:** System Logs
**Reference screenshot:** Image 1

### Top bar metrics
| Element | Source | Query |
|---------|--------|-------|
| Events/Sec (LIVE badge) | Supabase realtime subscription | `council_sessions` + `cross_chain_freezes` insert events — count events per second using rolling window |
| Critical Alerts count | Supabase `sentinel_alerts` | `SELECT COUNT(*) WHERE severity >= 2 AND created_at > NOW() - INTERVAL '1 hour'` |

### Quick Filters (chips)
- "All Sources" — no filter
- "API Gateway" — filter `council_sessions` where `agent` matches known gateway agents
- "Auth Service" — filter cross-chain freeze events
- "Agents" — filter by `council_sessions.agent`

### Recent Activity Stream
- **Source:** Merge of three Supabase tables, ordered by `created_at DESC`, limit 50:
  1. `sentinel_alerts` → severity maps to badge: severity=3 → `CRITICAL` (red), severity=2 → `WARN` (amber), severity=1 → `INFO` (purple)
  2. `council_sessions` → approved=true → `INFO "Agent Deployment Successful"`, approved=false → `WARN`
  3. `cross_chain_freezes` → status='PROPAGATED' → `CRITICAL "Cross-Chain Freeze Propagated"`
- **Realtime:** Subscribe to all three tables with `supabase.channel('activity').on('postgres_changes', ...)` — prepend new rows to the list without full reload.
- **"View Details" link:** Opens a slide-over panel showing the full JSON row.

### Filter button
- Renders a dropdown: date range picker + severity multi-select. Appends `.gte('created_at', from).lte('created_at', to).in('severity', [...])` to Supabase queries.

### Export button
- Calls `supabase.from('sentinel_alerts').select('*').csv()` and triggers browser download.

---

## Screen 3 — Agent Registry (Silk Security variant)
**File:** `ui/agent-registry.html`
**Nav label:** Agents (in Silk Security nav) or "Agent Registry"
**Reference screenshot:** Image 3 (NEXUS-7 detail page)

### Agent header card
- **Source:** `AgentRegistry.sol`
- `agentRegistry.ownerOf(tokenId)` → wallet address
- `agentRegistry.getReputation(tokenId)` → reputation score (0–1000)
- `agentRegistry.tokenURI(tokenId)` → metadata JSON (name, description)
- **Trust Level:** score > 800 → "Excellent", 600–800 → "Good", < 600 → "At Risk"

### Metric cards (Total Transactions, ZK Verified, Council Approvals, Escalations)
- **Source:** Supabase `council_sessions` filtered by `agent = agentAddress`
- Total Txns: `SELECT COUNT(*)`
- ZK Verified: `SELECT COUNT(*) WHERE approved = true`
- Council Approvals: same as ZK Verified (they're linked)
- Escalations: `SELECT COUNT(*) WHERE consensus LIKE '%ESCALATE%'`

### 30-Day Volume chart
- **Source:** Supabase `council_sessions`
- **Query:** `SELECT DATE_TRUNC('day', created_at) as day, SUM(CAST(amount AS NUMERIC)) as volume WHERE agent = $addr AND created_at > NOW() - INTERVAL '30 days' GROUP BY day ORDER BY day`
- **Render:** Chart.js area chart. Fill with `rgba(99, 102, 241, 0.15)`.

### Security Vector radar chart
- **Axes:** Integrity, Logic, Latency, Data (4 axes)
- **Source:** Derived — Integrity = reputation/1000, Logic = ZK success rate, Latency = 1 - (avg_latency_ms / 500), Data = 1 - (escalations / total_txns)
- **Render:** Chart.js radar. Fill `rgba(124, 58, 237, 0.3)`.

### Tabs: ZK Proofs / Council History / Vaccine Status / Configuration

**ZK Proofs tab:**
- Supabase `agent_batch_participations` filtered by `agent_address`
- Show: batch_id, decision_hash, commitment, time, status (VERIFIED/PENDING)

**Council History tab:**
- Supabase `council_votes` JOIN `council_sessions` where `council_sessions.agent = agentAddress`
- Show: session_id, risk/compliance/execution votes, consensus, timestamp

**Vaccine Status tab:**
- Supabase `vaccine_fingerprints` (add this table from VaccineManager init) filtered by agent
- Show: fingerprint hash (truncated), tier, added_at, expires_at
- If no rows → show "Clean — No blacklisted fingerprints"

**Configuration tab:**
- Read-only display of `agentRegistry.tokenURI()` metadata fields
- `CognitionVerifier.modelCommitment(agentAddress)` → show truncated commitment hash

### Recent Execution Logs table
- **Source:** Supabase `council_sessions` + `agent_batch_participations`
- Columns: TX Hash (from `decision_hash`), Action (from `reason`), ZK Status, Value (`amount` + "USDC"), Time

### Suspend Agent button
- Calls `agentRegistry.suspend(tokenId)` — write tx, requires wallet connection (MetaMask/WalletConnect)
- Show confirmation modal first

---

## Screen 4 — Council Deliberation
**File:** `ui/council-deliberation.html`
**Nav label:** Council
**Reference screenshot:** Image 4

### Transaction Proposal card (left)
- **Source:** URL param `?session=SESSION_ID` → Supabase `council_sessions WHERE session_id = $id`
- Display: amount, recipient (truncated address), reason
- Status badge: `approved=null` → "PENDING", `approved=true` → "CLEAN", `approved=false` → "BLOCKED"

### Consensus Status
- **Source:** Supabase `council_votes WHERE session_id = $id`
- Count APPROVE / REJECT / PENDING votes
- Progress bar: `approved_count / total_required * 100`

### Council Chamber — agent cards
- **Source:** Supabase `council_votes WHERE session_id = $id`
- One card per row, ordered by `created_at`
- Agent role + model name from `agent_role` and `model` columns
- Decision badge: "APPROVE" (green), "REJECT" (red), "DELIBERATING" (amber — null decision)
- Reasoning: `reasoning` column — render as terminal/monospace text
- Confidence: `confidence` column → render as progress bar

### Realtime updates
- Subscribe to `council_votes` table for this `session_id`
- As new votes arrive, animate the card from "DELIBERATING" to final decision
- When `approved_count >= 2`, auto-update Transaction Proposal badge to "CLEAN"

### ZK Proof Pipeline progress bar
- **Source:** Supabase `aggregation_batches WHERE batch_id` matches session OR hardcode stages
- Stages: INGEST → CIRCUIT GEN → PROVE → VERIFY
- Map `created_at` presence to progress: if batch row exists → INGEST done, if `nullifier` non-null → VERIFY done
- Animate active stage with a pulsing indigo highlight

---

## Screen 5 — ZK-ML Cognition Proof Engine
**File:** `ui/zk-ml.html`
**Nav label:** ZK-ML Dive
**Reference screenshot:** Image 5

### Performance card (top right)
- **Source:** Supabase `aggregation_batches`
- `SELECT AVG(latency_ms) FROM aggregation_batches ORDER BY created_at DESC LIMIT 20` → show as "Xms/proof"
- Mini bar chart: last 7 data points, same query with per-row latency

### Success Rate gauge
- **Source:** Supabase `council_sessions`
- `SELECT (COUNT(*) FILTER (WHERE approved=true))::float / COUNT(*) * 100`
- Render as SVG circle gauge. Color: `#6366f1`.

### Security Events
- **Source:** Supabase `sentinel_alerts WHERE severity >= 2`
- `SELECT COUNT(*) WHERE created_at > NOW() - INTERVAL '24 hours'`
- "Last audit node sync" = most recent `sentinel_heartbeats.created_at`

### Circuit Architecture diagram
- **Static** — render from hardcoded data matching `relu.circom` structure:
  - Private Inputs: `pre[0]`, `pre[1]`, `...`, `pre[7]`
  - Processing Pipeline: `ReLU Layer (Non-linear Activation)` → `CognitionLayer (Poseidon Hash)` → `ModelCommitment (State Verification)`
- Render as SVG node graph using the neomorphic raised card style for each node

### Proof Explorer table
- **Source:** Supabase `agent_batch_participations` JOIN `aggregation_batches`
- Columns: ID (batch_id truncated), Agent (agent_address truncated), Amount (from council_sessions.amount), decisionHash, commitment, Time, Status
- Status: `aggregation_batches.nullifier IS NOT NULL` → "VERIFIED" (green badge), else "PENDING" (grey)
- Filter button: filter by agent address or date range

### Trusted Setup Parameters (accordion)
- **Static** — display from `circuits/build/verification_key.json`:
  - Protocol: groth16
  - Curve: bn128
  - nPublic: 2
  - IC count: 3
- Read file at page load via a `/api/vkey` endpoint (simple Express route serving the JSON)

---

## Screen 6 — Vaccine Shield
**File:** `ui/vaccine-shield.html`
**Nav label:** Vaccine Shield
**Reference screenshot:** Image 6

### Immunity Status
- **Source:** Supabase `vaccine_fingerprints` (custom table — add if not present)
- **Schema:** `(id, decision_hash, context_hash, tier, agent_address, added_at, expires_at, slash_amount)`
- `SELECT COUNT(*) WHERE tier = 'HARD' AND expires_at > NOW()` → Total Blacklisted
- `SELECT COUNT(*) WHERE added_at > NOW() - INTERVAL '24 hours'` → Recent Blocks (24h)
- Immunity Score = `1 - (recent_new_fingerprints / rolling_avg_fingerprints)` — show as percentage

### Three Tier cards (SOFT / HARD / PERMANENT)
| Tier | Query | Color |
|------|-------|-------|
| SOFT | `SELECT COUNT(*) WHERE tier='SOFT' AND expires_at > NOW()` | Amber `#f59e0b` |
| HARD | `SELECT COUNT(*) WHERE tier='HARD' AND expires_at > NOW()` | Red `#dc2626` |
| PERMANENT | `SELECT COUNT(*) WHERE tier='PERMANENT'` | Dark Red `#991b1b` |

### Sparse Merkle Tree Blacklist scatter plot
- **Source:** Supabase `vaccine_fingerprints` most recent 50 rows
- Map each row to a 2D point: x = `EXTRACT(epoch FROM added_at) % 1000`, y = `CAST(LEFT(decision_hash, 4) AS INTEGER) % 100`
- Color: SOFT=`rgba(245,158,11,0.6)`, HARD=`rgba(220,38,38,0.8)`, PERMANENT=`rgba(153,27,27,1.0)`
- Render with Canvas API or Chart.js scatter

### Active Blacklist Registry table
- **Source:** Supabase `vaccine_fingerprints WHERE (tier='HARD' OR tier='PERMANENT') AND (expires_at > NOW() OR tier='PERMANENT') ORDER BY added_at DESC LIMIT 20`
- Columns: DECISIONHASH (truncated 10 chars), CONTEXTHASH (truncated), TIER (colored badge), SLASH (slash_amount + " ETH" in red), ACTIONS (eye icon → detail modal)

### Hamming Distance Map (bottom left)
- **Source:** Supabase `vaccine_fingerprints` last 20 HARD entries
- For each pair, compute client-side Hamming distance on the hex string
- Render as a heat-map grid using Canvas: cell color intensity = distance (0=red, 8+=green)
- Tooltip: show both hashes + distance on hover

### Immunity Growth Timeline (bottom right)
- **Source:** Supabase `vaccine_fingerprints`
- `SELECT DATE_TRUNC('day', added_at) as day, COUNT(*) as new_fingerprints GROUP BY day ORDER BY day DESC LIMIT 30`
- Render as Chart.js line chart. Cumulative sum for the "total immunity" line.

---

## Screen 7 — Cross-Chain Sentinel
**File:** `ui/cross-chain-sentinel.html`
**Nav label:** Chain Monitors
**Reference screenshot:** Image 7

### DEFCON badge + Refresh Topology button
- **Source:** Supabase `sentinel_alerts ORDER BY created_at DESC LIMIT 1`
- `defcon_level` field: 1 → "DEFCON-1 NORMAL" (green), 2 → "DEFCON-2 ELEVATED" (amber), 3 → "DEFCON-3 HIGH" (red), 4 → "DEFCON-4 CRITICAL" (dark red), 5 → "DEFCON-5 MAX" (black)
- Refresh Topology button: re-fetches `sentinel_heartbeats` and redraws the map

### Network Routing Topology map
- **Source:** Supabase `sentinel_heartbeats ORDER BY created_at DESC LIMIT 1` — JSON field `chain_status`
- Render as an SVG world map (use a simple flat projection or `d3-geo`)
- Plot 4 chain nodes at hardcoded lat/long: Ethereum (51.5, -0.1), Arbitrum (40.7, -74.0), Base (37.8, -122.4), Polygon (19.1, 72.9)
- Node color: `chain_status[chain].status === 'ONLINE'` → `#10b981` (green), 'DEGRADED' → amber, 'OFFLINE' → red
- Draw lines between Arc (center) and each chain — line opacity = heartbeat recency (1.0 if < 5min, 0.4 if older)

### System Threat Level gauge
- **Source:** Same `sentinel_alerts` DEFCON level
- Render as neomorphic pressed circle with large number (1–5) + label
- Color: 1=green, 2=amber, 3=orange, 4=red, 5=dark-red

### Message Breakdown donut chart
- **Source:** Supabase `cross_chain_freezes`
- `SELECT msg_type, COUNT(*) GROUP BY msg_type` — map to:
  - `MSG_REP_UPDATE` = reputation syncs
  - `MSG_STATE_SYNC` = heartbeats
  - `MSG_FREEZE` = freeze events
- Total in center = sum of all
- Render with Chart.js doughnut. Colors: `#6366f1` / `#7c3aed` / `#dc2626`

### Active Council Appeals
- **Source:** Supabase `sentinel_appeals WHERE status = 'ACTIVE'`
- Show each appeal as a card: agent address (truncated), reason, time remaining (calculate from `expires_at - NOW()`), council votes (3 colored dots: green=approve, red=reject, grey=pending)
- Countdown timer: update every second using `setInterval`

### Freeze Propagation History table
- **Source:** Supabase `cross_chain_freezes ORDER BY created_at DESC LIMIT 20`
- Columns: EVENT ID, AGENT (truncated), SEVERITY (badge: FREEZE=red, WARN=amber), SOURCE (chain name), DESTINATIONS (comma-separated chains), ZK PROOF (✅ if `zk_proof_hash` non-null), STATUS (PROPAGATED=green badge)

---

## Screen 8 — Neural-Symbolic Verification
**File:** `ui/neural-symbolic.html`
**Nav label:** Symbolic Verifier
**Reference screenshot:** Image 8 (currently has 3 static philosophy cards)

### THIS SCREEN NEEDS THE MOST WORK — currently fully static

### Page header
- Layer badge "LAYER 6E" — static
- "Re-evaluate" button: triggers a fresh `SymbolicChecker.check()` call for the most recent pending session

### Three Philosophy Cards — make data-aware
Currently show Lyapunov / Prospect Theory / Shannon Entropy as static text. Augment with live stats:

**Lyapunov Stability card:**
- Add sub-stat: "V(s)=0 rate" = `SELECT COUNT(*) FILTER (WHERE lyapunov_value=0) / COUNT(*)` from Supabase `symbolic_checks`
- Add small sparkline: last 20 checks — green dot if lyapunov=0, red if not

**Prospect Theory card:**
- Add sub-stat: "LA-EV gated (last 24h)" = `SELECT COUNT(*) WHERE loss_adjusted_ev < 0 AND created_at > NOW() - INTERVAL '24 hours'` from `symbolic_checks`
- Show as "X decisions blocked by loss-aversion gate"

**Shannon Entropy card:**
- Add sub-stat: Average council entropy from `SELECT AVG(council_entropy) FROM symbolic_checks`
- Show entropy gauge (0.0 to 1.0 bar)

### Property Verification Table (NEW — add below the 3 cards)
- **Source:** Supabase `symbolic_checks ORDER BY created_at DESC LIMIT 10`
- Columns: CHECK ID, AGENT, PROPOSAL (truncated hash), STATUS (SAT=green/UNSAT=red badge), BITMASK (binary string e.g. "1111111111"), LYAPUNOV (0 or V value), LA-EV, ENTROPY, TIME
- "View violations" link → opens modal with `satisfaction_bitmask` breakdown showing which of P1–P10 failed

### Property Set Configuration (NEW — add as collapsible section)
- **Source:** Supabase `agent_policies`
- Show the 10 properties (P1–P10) as a table: name, category, threshold, hard_stop (✅/❌), current status
- Read-only — link to Settings to modify

### Violation History Chart (NEW)
- **Source:** Supabase `symbolic_checks WHERE status='UNSAT' GROUP BY DATE_TRUNC('day', created_at)`
- Chart.js bar chart: violations per day, last 14 days
- Color bars by most-violated property (use different shade of red)

---

## Screen 9 — Insurance Pool & Underwriter DAO
**File:** `ui/insurance-pool.html`
**Nav label:** Insurance
**Reference screenshot:** Image 9

### Tabs: Insurance Pool / Underwriter DAO
- Tab switching: CSS class toggle (`.neomorphic-tab.active` = pressed shadow)

#### Insurance Pool Tab

**Four metric cards:**
| Card | Source | Method |
|------|--------|--------|
| Total Staked | `InsurancePool.sol` | `insurancePool.totalStaked()` → format as "$X.XM" |
| Active Policies | `InsurancePool.sol` | `insurancePool.activePolicyCount()` |
| Claims | `InsurancePool.sol` | `insurancePool.totalClaims()` |
| Premium Revenue | Supabase `council_sessions` | `SELECT SUM(premium_amount)` — add `premium_amount` column or derive from staking |

**Pool Health gauge:**
- **Source:** `InsurancePool.sol` → `totalStaked() / totalLiability() * 100` = collateralization %
- If no `totalLiability()` function: use `totalStaked() / (activePolicyCount * avgPolicyValue) * 100`
- SVG circle gauge: green if > 200%, amber 100–200%, red < 100%

**Premium Pricing Model card:**
- **Static formula display** — `Premium = f(consensusScore, proofSuccessRate)` — no live data needed
- Explanatory text from MASTER-BUILD.md Layer 6A description

**My Staking Position:**
- **Source:** `InsurancePool.sol` → `insurancePool.getStake(connectedWalletAddress)`
- `insurancePool.getEarnings(connectedWalletAddress)` → earned amount + APY
- "Increase Stake" button → opens modal with amount input → calls `insurancePool.stake(amount)`
- "Withdraw" button → calls `insurancePool.unstake(amount)` after confirmation modal
- Both require wallet connection — show "Connect Wallet" state if no wallet

#### Underwriter DAO Tab

**DAO Overview metrics (NEW):**
| Metric | Source | Method |
|--------|--------|--------|
| Active Underwriters | `UnderwriterDAO.sol` | `underwriterDAO.activeUnderwriterCount()` |
| Total rAGNT Staked | `UnderwriterDAO.sol` | `underwriterDAO.totalRagntStaked()` |
| Pending Applications | `UnderwriterDAO.sol` | `underwriterDAO.pendingApplicationCount()` |
| Slashes This Epoch | Supabase `underwriter_dao_events` | `SELECT COUNT(*) WHERE event_type='SLASH' AND created_at > epoch_start` |

**Active Underwriters table:**
- **Source:** `UnderwriterDAO.sol` events + Supabase `underwriter_dao_events`
- `SELECT DISTINCT underwriter_address, reputation_score, total_exposure, backed_agents_count FROM underwriter_dao_events`
- Columns: ADDRESS, REPUTATION, EXPOSURE, BACKED AGENTS, BADGE (soulbound ✅/revoked ❌)

**Pending Applications:**
- **Source:** `UnderwriterDAO.sol` → `underwriterDAO.getPendingApplications()`
- Show applicant address, requested backers, AI council recommendation (APPROVE/REJECT from Supabase)
- "Vote" button (if connected wallet is an Underwriter) → calls `underwriterDAO.castBackingVote(applicationId, true/false)`

---

## Screen 10 — Batch Proof Engine
**File:** `ui/batch-proofs.html`
**Nav label:** Batch Proofs
**Reference screenshot:** Image 10

### Lifetime Gas Saved (top right hero)
- **Source:** Supabase `aggregation_batches`
- `SELECT SUM(gas_used * gas_saved_pct / 100) / 1e18 AS eth_saved`
- Format as "X,XXX.X ETH"

### Average Gas Reduction hero stat
- **Source:** Supabase `aggregation_batches`
- `SELECT AVG(gas_saved_pct)`
- Render large: "XX.X%"

### Aggregation Queue
- **Source:** `BatchVerifier.sol` → `batchVerifier.queueDepth()` (current), `batchVerifier.MAX_BATCH()` (max=32)
- Format as "X / 32 Proofs Pending"
- Progress bar: `queueDepth / 32 * 100`%
- "Force Submit Now" button → calls `proofAggregator.flushQueue()` — requires wallet connection

### Execution Comparison (static + semi-live)
- "Without Batching" ~500k Gas — static
- "SnarkPack" O(log n) Verification — static
- "Net Result" -67.5% Cost — derived from `AVG(gas_saved_pct)` above

### Gas Savings by Batch Size bar chart
- **Source:** Supabase `aggregation_batches`
- `SELECT proof_count, AVG(gas_saved_pct) FROM aggregation_batches GROUP BY proof_count ORDER BY proof_count`
- Render as Chart.js bar chart. X-axis: 4, 8, 16, 24, 32. Y-axis: 0–100%.
- Bars: gradient from `#a5b4fc` (light) to `#6366f1` (dark) as batch size grows

### Throughput Timeline line chart
- **Source:** Supabase `aggregation_queue_events`
- `SELECT DATE_TRUNC('hour', created_at) as hour, COUNT(*) as tx_count GROUP BY hour ORDER BY hour DESC LIMIT 24`
- Chart.js line chart, label: "Tx/Sec" (divide count by 3600)

### Recent Batches table
- **Source:** Supabase `aggregation_batches ORDER BY created_at DESC LIMIT 10`
- Columns: BATCH ID (`#BP-XXXX`), TIME (relative), PROOF COUNT, GAS SAVED (% in green), STATUS (`nullifier IS NOT NULL` → "Verified" green dot badge)
- "View All" link → full table with pagination

---

## Screen 11 — Analytics
**File:** `ui/analytics.html`
**Nav label:** Analytics
**Reference screenshot:** Image 11

### Time range selector
- Buttons: 7D / 30D / 90D / Custom
- All queries below accept a `?from=&to=` date range param

### Transaction Volume & Value chart (main, large)
- **Source:** Supabase `council_sessions`
- Two datasets:
  - Volume: `SELECT DATE_TRUNC('day', created_at), COUNT(*) GROUP BY day`
  - Value: `SELECT DATE_TRUNC('day', created_at), SUM(CAST(amount AS NUMERIC)) GROUP BY day`
- Render as Chart.js combo: bars for volume (color `#a5b4fc`), line for value (color `#6366f1`)

### Security Events panel (right)
- **Source:** Supabase `sentinel_alerts ORDER BY created_at DESC LIMIT 5`
- Each row: icon (triangle=high risk, shield=council, gear=policy), title, subtitle, time ago
- Map `severity`: 3 → red triangle "High Risk Alert", 2 → shield blue "Council Auto-Reject", 1 → gear grey "Policy Update"

### Threat Detection funnel
- **Source:** Supabase `council_sessions`
- Funnel data:
  - Proposals Evaluated: `SELECT COUNT(*)`
  - Flagged by Models: `SELECT COUNT(*) WHERE consensus LIKE '%ESCALATE%' OR approved=false`
  - Council Reviewed: `SELECT COUNT(*) WHERE consensus IS NOT NULL`
  - Blocked: `SELECT COUNT(*) WHERE approved=false`
- Render as horizontal stacked bar or funnel using Canvas/SVG

### Model Performance grouped bar chart
- **Source:** Supabase `council_votes`
- Three metric groups (Accuracy, Latency, Cost Eff.) × two models (GPT-4o, Claude/Groq)
- Accuracy: per model → `COUNT(*) FILTER (WHERE decision = consensus_decision) / COUNT(*)`
- Latency: `AVG(latency_ms)` per model — normalize to 0-1 scale
- Cost Eff: `1 / AVG(cost_usdc)` — normalized
- Render: Chart.js grouped bar. Two colors: `#818cf8` (GPT-4o) and `#a78bfa` (Groq)

---

## Screen 12 — Settings
**File:** `ui/settings.html`
**Nav label:** Settings
**Reference screenshot:** Image 12

### Tabs: General / Security Layers / Notifications / API & Keys / Network / Billing
- Tab switching via CSS class toggle

#### Security Layers tab (shown in screenshot)

**Layer cards — ZK-ML Verifier / Council Consensus / Prompt Vaccine / Semantic Policy Firewall:**

| Field | Source | Notes |
|-------|--------|-------|
| Status badge (Active/Learning/Disabled) | Supabase `agent_policies` or hardcoded env config | Store layer enable/disable state in a `layer_config` Supabase table |
| Toggle switch | Write to `layer_config` table | `UPDATE layer_config SET enabled = $val WHERE layer_id = $id` |
| "Configure" button | Opens a modal with layer-specific settings | |
| "Logs" button | Links to System Logs screen filtered by layer | |

**layer_config Supabase table (create if not exists):**
```sql
CREATE TABLE layer_config (
  id SERIAL PRIMARY KEY,
  layer_id TEXT UNIQUE NOT NULL,  -- 'zkml', 'council', 'vaccine', 'firewall'
  enabled BOOLEAN DEFAULT true,
  status TEXT DEFAULT 'Active',   -- 'Active', 'Learning', 'Disabled'
  config_json JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO layer_config (layer_id, enabled, status) VALUES
  ('zkml', true, 'Active'),
  ('council', true, 'Active'),
  ('vaccine', true, 'Learning'),
  ('firewall', false, 'Disabled');
```

#### General tab
- Organization name, wallet address (read from connected wallet), chain selector (Arc Testnet / Mainnet)
- All fields: neomorphic inset input style

#### API & Keys tab
- Show masked API keys from env vars (last 4 chars visible)
- "Regenerate" button per key (calls a `/api/rotate-key` endpoint)
- Never expose full keys in frontend

---

## Screen 13 — System Architecture
**File:** `ui/architecture.html`
**Nav label:** Architecture (in Guardian Core nav)
**Reference screenshot:** Image 13

### Architecture pipeline (center column)
- **Static** — render the 10-layer stack from MASTER-BUILD.md as interactive cards
- Each layer card: icon + name + subtitle + LATENCY badge (if applicable)
- Click a layer card → scrolls to or expands detail panel
- Layer 3: Council card → border-left `#7c3aed` (tertiary/violet)
- Layer 1: ZK-ML card → border-left `#10b981` (green)
- Layer 6B: Vaccine card → border-left `#dc2626` (red)
- Arrows between cards: SVG `<path>` with indigo stroke

**Live latency data:**
- Human Principal: static "12ms"
- Orchestrator: Supabase `council_sessions` → `AVG(total_cost * 1000)` as proxy, or static
- Layer 1 ZK-ML: Supabase `aggregation_batches` → `AVG(latency_ms)` → show as "Xms"

### Cross-Cutting Systems (right panel)
- Static cards: Layer 4 MCP, Layer 5 Feedback, Layer 6A Underwriter, Layer 6C Sentinel
- Each shows description from MASTER-BUILD.md

### "Request Node Access" button
- Opens a modal: wallet address auto-filled, textarea for reason
- Submits to Supabase `node_access_requests (wallet, reason, created_at)`

---

## Screen 14 — Layer 6F Research
**File:** `ui/layer6f-research.html`
**Nav label:** Layer 6F Research (in Guardian Core nav)
**Reference screenshot:** Image 14

### Status badge: "RESEARCH PHASE"
- Static — hardcoded. No live data.

### Three feature cards (Training Data Compliance / Protocol Verification / Weight Integrity)
- **Static** — text from MASTER-BUILD.md Layer 6F section

### "Powered by Advanced Folding" section
- **Static** — text from MASTER-BUILD.md
- Checklist items: Sub-linear verification time, O(1) recursion overhead, Distributed prover networking

### Infinity logo animation
- CSS animation: rotating conic-gradient or SVG stroke-dashoffset animation
- Colors: indigo `#6366f1` → violet `#7c3aed`

### Path to Production timeline
- **Static** — four milestones from MASTER-BUILD.md:
  - 1: Q2 2026 — Folding Scheme Benchmarks
  - 2: Q4 2026 — Single-Node Verifiable Training
  - 3: Q2 2027 — Distributed Prover Cluster
  - 4: Q4 2027 — Layer 6F Mainnet Integration
- Render as horizontal stepper. Step 1 = current (indigo circle). Steps 2–4 = grey.

---

## Shared Utility Layer

### File: `ui/js/client.js` (create this file)

```javascript
// Supabase client
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
export const supabase = createClient(
  window.ENV_SUPABASE_URL,     // injected via <script>window.ENV_SUPABASE_URL='...'</script>
  window.ENV_SUPABASE_ANON_KEY
)

// ethers.js provider (read-only — no wallet required for reads)
import { ethers } from 'https://cdn.jsdelivr.net/npm/ethers@6/dist/ethers.min.js'
export const provider = new ethers.JsonRpcProvider(window.ENV_ARC_RPC_URL)

// Contract factory helpers
export function getContract(address, abi) {
  return new ethers.Contract(address, abi, provider)
}

// Wallet signer (for write operations)
export async function getSigner() {
  if (!window.ethereum) throw new Error('No wallet found')
  await window.ethereum.request({ method: 'eth_requestAccounts' })
  const browserProvider = new ethers.BrowserProvider(window.ethereum)
  return browserProvider.getSigner()
}

// Relative time helper
export function timeAgo(isoString) {
  const diff = Date.now() - new Date(isoString).getTime()
  if (diff < 60000) return `${Math.floor(diff/1000)}s ago`
  if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`
  return `${Math.floor(diff/3600000)}h ago`
}

// Address truncation helper
export function truncate(addr, chars = 6) {
  if (!addr) return '—'
  return `${addr.slice(0, chars)}...${addr.slice(-4)}`
}

// Number formatting
export function fmtUSD(val) {
  if (val >= 1e6) return `$${(val/1e6).toFixed(1)}M`
  if (val >= 1e3) return `$${(val/1e3).toFixed(1)}K`
  return `$${val.toFixed(2)}`
}
```

### File: `ui/js/abis.js` (create this file)

```javascript
// Minimal ABIs — only the functions needed by the UI
export const AGENT_REGISTRY_ABI = [
  "function totalSupply() view returns (uint256)",
  "function getReputation(uint256 tokenId) view returns (uint256)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function ownerOf(uint256 tokenId) view returns (address)"
]

export const INSURANCE_POOL_ABI = [
  "function totalStaked() view returns (uint256)",
  "function activePolicyCount() view returns (uint256)",
  "function totalClaims() view returns (uint256)",
  "function getStake(address user) view returns (uint256)",
  "function getEarnings(address user) view returns (uint256)",
  "function stake(uint256 amount)",
  "function unstake(uint256 amount)"
]

export const UNDERWRITER_DAO_ABI = [
  "function activeUnderwriterCount() view returns (uint256)",
  "function totalRagntStaked() view returns (uint256)",
  "function pendingApplicationCount() view returns (uint256)",
  "function getPendingApplications() view returns (address[])",
  "function castBackingVote(uint256 applicationId, bool approve)"
]

export const BATCH_VERIFIER_ABI = [
  "function queueDepth() view returns (uint256)",
  "function MAX_BATCH() view returns (uint256)"
]

export const COGNITION_VERIFIER_ABI = [
  "function modelCommitment(address agent) view returns (bytes32)"
]
```

### File: `ui/js/env.js` (inject via server or build step)

```javascript
// In development: hardcode or load from .env via a /api/env endpoint
// In production: inject at build time via your bundler
window.ENV_SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co'
window.ENV_SUPABASE_ANON_KEY = 'YOUR-ANON-KEY'
window.ENV_ARC_RPC_URL = 'https://testnet.arc.xyz'
window.ENV_AGENT_REGISTRY = '0x...'
window.ENV_INSURANCE_POOL = '0x...'
window.ENV_UNDERWRITER_DAO = '0x...'
window.ENV_BATCH_VERIFIER = '0x...'
window.ENV_COGNITION_VERIFIER = '0x...'
window.ENV_SYMBOLIC_VERIFIER = '0x...'
```

---

## Missing Supabase Tables (create these before wiring UI)

The following tables are referenced in this spec but not in the current schema. Add them:

```sql
-- Vaccine fingerprint store (VaccineManager.ts should write to this)
CREATE TABLE vaccine_fingerprints (
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
CREATE INDEX ON vaccine_fingerprints (tier, expires_at);
CREATE INDEX ON vaccine_fingerprints (decision_hash);

-- Layer config (Settings screen toggles)
CREATE TABLE layer_config (
  id SERIAL PRIMARY KEY,
  layer_id TEXT UNIQUE NOT NULL,
  enabled BOOLEAN DEFAULT true,
  status TEXT DEFAULT 'Active',
  config_json JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Node access requests (Architecture screen CTA)
CREATE TABLE node_access_requests (
  id SERIAL PRIMARY KEY,
  wallet TEXT NOT NULL,
  reason TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Symbolic checks (Layer 6E)
-- Already defined in MASTER-BUILD.md scripts/supabase-schema-layer6e.sql
-- Ensure these columns exist: status, lyapunov_value, council_entropy, 
-- loss_adjusted_ev, satisfaction_bitmask, agent, proposal_hash, cert_hash

-- Underwriter DAO events (already in TypeScript layer)
-- Ensure table: underwriter_dao_events (event_type, underwriter_address, 
-- agent_address, amount, reputation_score, created_at)
```

---

## Integration Priority Order

Execute in this order to get a working demo fastest:

1. **`ui/js/client.js` + `ui/js/abis.js` + `ui/js/env.js`** — shared foundation, everything else depends on this
2. **Dashboard** — most impressive for demos, uses the most data sources
3. **System Logs** — realtime subscriptions prove the live stack works
4. **Batch Proof Engine** — directly maps to `aggregation_batches` table, clean 1:1 data mapping
5. **Council Deliberation** — realtime vote cards are the most visually compelling feature
6. **Agent Registry** — complex but high-value for demos
7. **Vaccine Shield** — add `vaccine_fingerprints` table first
8. **Cross-Chain Sentinel** — requires `sentinel_alerts` + `cross_chain_freezes` to have data
9. **Neural-Symbolic Verification** — requires `symbolic_checks` table to have data (run demo-symbolic.ts first)
10. **Insurance Pool** — requires deployed contract addresses
11. **Analytics, Settings, Architecture, Layer 6F** — polish pass last

---

## Windsurf Cascade Instructions

When executing this spec in Cascade, use this prompt structure:

```
Context files to load first (in this order):
1. MASTER-BUILD.md          — full system architecture
2. DESIGN.md                — neomorphic design rules  
3. ui-integration.md        — this file (data mapping)
4. ui/[screen].html         — the screen being wired

For each screen:
- Do NOT redesign the layout — preserve the existing neomorphic HTML exactly
- ONLY add: data-fetching JS, Chart.js renders, contract reads, Supabase queries
- Add a <script type="module"> block at the bottom of each HTML file
- Import from ui/js/client.js and ui/js/abis.js
- Wrap all data calls in try/catch — show skeleton loading state on error
- Use the exact Supabase table names and column names from this spec
- For contract reads: use the exact ABI function signatures from abis.js
```

---

*Generated: April 2026 — AgentGuardian v2.0 Council + ZK-ML Edition*
