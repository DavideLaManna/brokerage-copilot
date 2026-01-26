# PRD: LLM-Assisted Options Trading Copilot (Compliance-First)

**Document version:** 0.2
**Last updated:** 2026-01-25
**Status:** Planning - User Story Breakdown
**Audience:** Builder/founder + engineering + security/compliance

---

## Introduction

Build an "Options Trading Copilot" that uses an LLM + deterministic tooling to assist with options trading workflows. The system ingests market/portfolio data, produces structured trade ideas and position management recommendations, and can automate "housekeeping" actions under strict guardrails.

**Core value proposition:** Discipline + time compression
- Fewer manual steps (no screenshots, no hand-typing orders)
- Consistent exit rules and risk caps
- Research synthesis with traceable sources
- Full audit trail of what the model suggested vs what the human did

**Critical compliance note:** This PRD covers only *legal, supportable* systems using **official brokerage APIs** and normal market-data/news sources. No reverse-engineering, no private APIs, no TOS violations.

---

## Goals

1. **Reduce manual labor** in options trading workflows (monitoring, scanning, order entry, repricing)
2. **Reduce emotion-driven mistakes** via systematic guardrails and repeatable decision structure
3. **Improve portfolio awareness**: exposure, Greeks, concentration, event risk, liquidity
4. **Provide explainable outputs**: "why this trade," "why this exit," and the data used
5. **Human-in-the-loop by default**: system proposes, user approves (with limited safe automation for housekeeping)

---

## Non-Goals (Out of Scope)

- Guaranteeing profit or any specific return profile
- Running fully autonomous trading with no human oversight as default mode
- Anything involving reverse engineering broker apps or using private/undocumented endpoints
- Acting as a registered investment adviser or providing personalized investment advice to the public
- Supporting market orders by default (limit orders only for safety)
- Full automation (Phase 3) in initial releases

---

## Target Users

### Persona A: Active retail options trader
- Trades weekly/monthly, wants faster research + better exits
- Needs constant monitoring but has a day job

### Persona B: "Part-time" trader
- Checks 1–3 times/day
- Wants "portfolio health + do I need to act?" summaries and a short action list

### Persona C: Builder/power user
- Wants programmable risk rules, custom scanners, and audit logs
- Comfortable with APIs and data pipelines

---

## User Stories

### Phase 0: Foundation (Read-Only + Paper Trading)

#### US-001: Project setup and architecture

**Description:** As a developer, I need the initial project structure so I can begin building modular components.

**Acceptance Criteria:**
- [ ] Create project directory structure (api, ui, services, adapters, storage)
- [ ] Initialize Git repository with .gitignore for secrets
- [ ] Set up package.json/requirements.txt with initial dependencies
- [ ] Create README with architecture diagram and component descriptions
- [ ] Set up environment variable template (.env.example)
- [ ] Typecheck/lint passes

#### US-002: Broker adapter interface

**Description:** As a developer, I need a unified broker adapter interface so I can support multiple brokers with consistent code.

**Acceptance Criteria:**
- [ ] Define TypeScript/Python interface for broker operations (positions, orders, quotes, chains)
- [ ] Include methods: `getPositions()`, `getOpenOrders()`, `getQuote()`, `getOptionChain()`, `placeOrder()`, `cancelOrder()`
- [ ] Document expected error types and rate limits
- [ ] Add adapter factory pattern for broker selection
- [ ] Typecheck/lint passes

#### US-003: Secure credential storage

**Description:** As a user, I need my broker API credentials stored securely so they cannot be exposed in logs or code.

**Acceptance Criteria:**
- [ ] Implement secrets vault or encrypted storage (e.g., AWS Secrets Manager, Doppler, or encrypted JSON)
- [ ] Never log tokens or secrets
- [ ] Implement token refresh logic for OAuth providers
- [ ] Add credential validation on startup
- [ ] Document setup process in README
- [ ] Typecheck/lint passes

#### US-004: Connect to broker (read-only, single broker MVP)

**Description:** As a user, I want to connect my Tradier (or Alpaca/tastytrade) account so the system can read my portfolio.

**Acceptance Criteria:**
- [ ] Implement OAuth or token-based authentication for chosen broker
- [ ] Successfully retrieve and display account balance and buying power
- [ ] Handle auth errors gracefully with user-friendly messages
- [ ] Store tokens securely using US-003 infrastructure
- [ ] Add "disconnect" functionality
- [ ] Typecheck/lint passes

#### US-005: Fetch and display open positions

**Description:** As a user, I want to see all my open options positions in a dashboard so I can review my portfolio at a glance.

**Acceptance Criteria:**
- [ ] Fetch positions from broker API
- [ ] Display: symbol, contract details (strike/expiry/type), quantity, avg cost, current mark, P&L
- [ ] Update positions on page refresh (manual for now)
- [ ] Handle empty positions state
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

#### US-006: Fetch and display open orders

**Description:** As a user, I want to see my open orders so I know what's pending execution.

**Acceptance Criteria:**
- [ ] Fetch open orders from broker API
- [ ] Display: symbol, contract, side (buy/sell), quantity, limit price, order type, status, time placed
- [ ] Handle empty orders state
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

#### US-007: Fetch option chains

**Description:** As a developer, I need to retrieve option chains so the system can analyze available strikes and expirations.

**Acceptance Criteria:**
- [ ] Implement `getOptionChain(symbol, minDTE, maxDTE)` in broker adapter
- [ ] Return strikes, expirations, bid/ask, volume, open interest
- [ ] Include Greeks (delta, theta, vega, gamma) and IV when available from broker
- [ ] Cache chain data with TTL (5-15 minutes)
- [ ] Typecheck/lint passes

#### US-008: Basic dashboard UI

**Description:** As a user, I want a web dashboard that shows my account summary, positions, and orders in one place.

**Acceptance Criteria:**
- [ ] Create dashboard layout with sections: Account Summary, Positions, Orders
- [ ] Account summary shows: net liquidation, buying power, daily P&L
- [ ] Positions table uses data from US-005
- [ ] Orders table uses data from US-006
- [ ] Responsive design (mobile-friendly)
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

#### US-009: Risk configuration storage

**Description:** As a user, I need to set my risk limits so the system enforces them on all operations.

**Acceptance Criteria:**
- [ ] Create config schema: max risk per trade (%), max risk per underlying (%), max daily loss ($), max open positions (count), max contracts per position, allowed DTE range (min/max days)
- [ ] Store config in database per user/account
- [ ] Provide UI form to edit risk settings
- [ ] Validate inputs (percentages 0-100, positive numbers)
- [ ] Display current config on dashboard
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

#### US-010: Historical price data retrieval (COMPLETED)

**Description:** As a developer, I need historical price bars so the system can compute technical indicators.

**Acceptance Criteria:**
- [x] Implement `getHistoricalBars(symbol, interval, lookback)` in market data service
- [x] Support at least daily and hourly intervals
- [x] Cache historical data with appropriate TTL
- [x] Handle provider errors gracefully
- [x] Typecheck/lint passes

---

### Phase 1: Trade Recommendations + Manual Execution

#### US-011: Risk engine - pre-trade validation

**Description:** As a user, I need the system to block orders that violate my risk limits so I don't accidentally over-leverage.

**Acceptance Criteria:**
- [ ] Implement pre-trade check function: `validateOrder(order, config, currentPositions)`
- [ ] Block if: risk per trade > config.maxRiskPerTrade, concentration exceeds limit, buying power insufficient, DTE outside allowed range, liquidity too low (spread > threshold)
- [ ] Return detailed rejection reason for each failed check
- [ ] Log all validation attempts (pass/fail)
- [ ] Typecheck/lint passes

#### US-012: Liquidity scoring

**Description:** As a trader, I need to see liquidity metrics so I can avoid illiquid options that are hard to exit.

**Acceptance Criteria:**
- [ ] Compute bid-ask spread percentage: `(ask - bid) / mid * 100`
- [ ] Flag contracts with spread > 5% as "low liquidity warning"
- [ ] Display volume and open interest for each contract
- [ ] Add liquidity score to option chain display
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

#### US-013: Portfolio exposure calculator

**Description:** As a user, I want to see my total exposure by underlying so I know if I'm over-concentrated.

**Acceptance Criteria:**
- [ ] Aggregate positions by underlying symbol
- [ ] Calculate total notional exposure and risk (max loss) per underlying
- [ ] Display as "Exposure by Underlying" panel on dashboard
- [ ] Highlight underlyings exceeding concentration limit from config
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

#### US-014: Portfolio Greeks aggregation

**Description:** As an options trader, I want to see my aggregate portfolio Greeks so I understand my directional and time-decay exposure.

**Acceptance Criteria:**
- [ ] Sum delta, theta, vega, gamma across all positions
- [ ] Display in "Portfolio Greeks" panel on dashboard
- [ ] Update when positions change
- [ ] Handle missing Greeks gracefully (show "N/A")
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

#### US-015: TradeProposal schema and storage

**Description:** As a developer, I need a structured format for trade recommendations so they can be validated, logged, and executed consistently.

**Acceptance Criteria:**
- [ ] Define `TradeProposal` schema: strategy_type, underlying, contracts (list), thesis (bullets), catalysts, entry_plan (limit/slippage/TIF), exit_plan (targets/stops), risk (max loss estimate), confidence (low/med/high), data_used (sources + timestamps), proposal_id (UUID), created_at
- [ ] Create database table for trade proposals
- [ ] Implement CRUD operations
- [ ] Add status field: draft / approved / rejected / executed
- [ ] Typecheck/lint passes

#### US-016: LLM tool - get portfolio snapshot

**Description:** As an LLM agent, I need a tool to retrieve current portfolio state so I can analyze it.

**Acceptance Criteria:**
- [ ] Implement `get_portfolio_snapshot()` tool returning: positions (symbol, qty, cost, mark, PnL, Greeks), open orders, account summary, exposure by underlying, portfolio Greeks
- [ ] Return as structured JSON
- [ ] Include data timestamp
- [ ] Add to MCP tool registry (or equivalent tool protocol)
- [ ] Typecheck/lint passes

#### US-017: LLM tool - get option chain

**Description:** As an LLM agent, I need a tool to fetch option chains so I can analyze strikes and liquidity.

**Acceptance Criteria:**
- [ ] Implement `get_option_chain(symbol, minDTE, maxDTE)` tool
- [ ] Return strikes, expirations, bid/ask, Greeks, volume, OI, liquidity score
- [ ] Filter by DTE range
- [ ] Include data timestamp
- [ ] Typecheck/lint passes

#### US-018: LLM tool - compute technical indicators

**Description:** As an LLM agent, I need a tool to calculate technical indicators so I can assess trend and momentum.

**Acceptance Criteria:**
- [ ] Implement `compute_technicals(symbol, indicators)` tool
- [ ] Support: RSI (14-day default), moving averages (20/50/200), ATR (14-day)
- [ ] Return indicator values + interpretation hints (e.g., "RSI > 70: overbought")
- [ ] Use historical data from US-010
- [ ] Typecheck/lint passes

#### US-019: Portfolio review agent prompt

**Description:** As a user, I want to ask "review my portfolio" and get an analysis with recommended actions.

**Acceptance Criteria:**
- [ ] Implement LLM agent prompt template for portfolio review
- [ ] Agent calls `get_portfolio_snapshot()` and analyzes: P&L, risk exposure, concentration, Greeks, upcoming events
- [ ] Returns action list (hold/trim/exit/hedge) with rationale
- [ ] Output includes data timestamps and sources
- [ ] Agent does NOT execute any orders
- [ ] Typecheck/lint passes

#### US-020: Chat interface for agent interaction

**Description:** As a user, I want to chat with the copilot to request reviews and recommendations.

**Acceptance Criteria:**
- [ ] Create chat UI component on dashboard
- [ ] Support commands: "review positions", "analyze portfolio", "show exposure"
- [ ] Display agent responses with markdown formatting
- [ ] Show loading state during LLM processing
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

#### US-021: Draft order builder

**Description:** As a developer, I need a function to create draft orders from TradeProposals so they can be validated before execution.

**Acceptance Criteria:**
- [ ] Implement `buildDraftOrder(proposal)` function
- [ ] Convert proposal contracts to broker order format
- [ ] Apply entry_plan limit price and TIF
- [ ] Generate client-side idempotency key (UUID)
- [ ] Return order object ready for validation
- [ ] Typecheck/lint passes

#### US-022: Order preview and approval UI

**Description:** As a user, I want to review and approve orders before execution so I maintain control.

**Acceptance Criteria:**
- [ ] Create "Order Approval" modal showing: contract details, side, quantity, limit price, estimated cost, max loss, risk check results (pass/fail with reasons)
- [ ] "Approve" button enabled only if all risk checks pass
- [ ] "Reject" button to dismiss
- [ ] Display proposal thesis and rationale
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

#### US-023: Place order via broker API (with idempotency)

**Description:** As a system, I need to place orders through the broker API without creating duplicates on retry.

**Acceptance Criteria:**
- [ ] Implement `placeOrder(order, idempotencyKey)` in broker adapter
- [ ] Use broker's idempotency mechanism if available, or store keys in local DB
- [ ] Return order ID from broker on success
- [ ] Handle errors: insufficient funds, invalid contract, rate limit, timeout
- [ ] Log order submission and broker response
- [ ] Typecheck/lint passes

#### US-024: Order execution flow (user approval → submission → confirmation)

**Description:** As a user, I want to approve an order in the UI and see it submitted to my broker successfully.

**Acceptance Criteria:**
- [ ] User clicks "Approve" in US-022 modal
- [ ] System runs pre-trade validation (US-011)
- [ ] If pass: call `placeOrder()` (US-023) with idempotency key
- [ ] Display success/error message with broker order ID or error details
- [ ] Update TradeProposal status to "executed" or "failed"
- [ ] Refresh positions and orders after execution
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

#### US-025: Cancel order functionality

**Description:** As a user, I want to cancel an open order so I can adjust my strategy.

**Acceptance Criteria:**
- [ ] Implement `cancelOrder(orderId)` in broker adapter
- [ ] Add "Cancel" button to each open order in UI
- [ ] Confirm cancellation with user (simple dialog)
- [ ] Display success/error message
- [ ] Refresh open orders list after cancellation
- [ ] Log cancellation action
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

#### US-026: Audit trail storage

**Description:** As a compliance-conscious user, I need every recommendation and action logged so I can review what happened and why.

**Acceptance Criteria:**
- [ ] Create `audit_log` table: timestamp, event_type (recommendation/approval/execution/rejection/cancellation), actor (agent/user), proposal_id, order_id, details (JSON), correlation_id
- [ ] Log every: LLM recommendation, user approval/rejection, order submission, broker response, cancellation
- [ ] Include data sources and timestamps in details
- [ ] Tag entries as `human_initiated` or `agent_initiated`
- [ ] Typecheck/lint passes

#### US-027: Decision journal UI

**Description:** As a user, I want to review past decisions and outcomes so I can learn and improve.

**Acceptance Criteria:**
- [ ] Create "Journal" page showing audit log entries grouped by day
- [ ] Display: proposals, approvals, executions, outcomes (fills)
- [ ] Filter by date range and event type
- [ ] Allow user to add manual notes to journal entries
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

---

### Phase 2: Automation (Housekeeping Only)

#### US-028: Order repricing engine

**Description:** As a trader, I want the system to suggest repricing stale limit orders closer to current mid-price.

**Acceptance Criteria:**
- [ ] Detect orders where limit price is > X% away from current mid (configurable, default 5%)
- [ ] Propose new limit price within configured band
- [ ] Generate `OrderModification` proposal with rationale
- [ ] Do not execute without approval (for now)
- [ ] Typecheck/lint passes

#### US-029: Auto-reprice approval setting

**Description:** As a user, I want to enable automatic repricing within a safe band so I don't miss fills on slow-moving orders.

**Acceptance Criteria:**
- [ ] Add config setting: `autoRepriceEnabled` (boolean), `autoRepriceBandPercent` (e.g., 2%)
- [ ] If enabled: system automatically modifies orders within band without approval
- [ ] Log all auto-reprice actions with clear "auto-housekeeping" tag
- [ ] Disable auto-reprice if any validation fails
- [ ] Display auto-reprice activity in UI notifications
- [ ] Typecheck/lint passes

#### US-030: Exit ladder builder

**Description:** As a user, I want to set up staged profit-taking orders so I can systematically lock in gains.

**Acceptance Criteria:**
- [ ] Implement `proposeExitLadder(position, targets)` function
- [ ] Targets example: [+25% premium, +50%, +100%]
- [ ] Generate multiple limit orders at calculated prices
- [ ] Validate each order against risk rules
- [ ] Return structured ladder proposal for approval
- [ ] Typecheck/lint passes

#### US-031: Exit ladder UI

**Description:** As a user, I want to click "Set Exit Ladder" on a position and approve a set of profit-taking orders.

**Acceptance Criteria:**
- [ ] Add "Exit Ladder" button to each position row
- [ ] Open modal with default ladder targets (configurable)
- [ ] Preview all orders (quantities, prices, targets)
- [ ] Approve all or cancel
- [ ] Submit approved ladder orders in batch
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

#### US-032: Event-driven alert triggers

**Description:** As a user, I want to be alerted when key events occur (big price moves, premium targets hit) so I can act quickly.

**Acceptance Criteria:**
- [ ] Define trigger types: underlying_move (±X%), premium_target (+50%/+100%), earnings_approaching (N days), bid_ask_widening (spread > threshold), portfolio_drawdown (loss > limit)
- [ ] Store user trigger preferences in config
- [ ] Implement polling or webhook-based monitoring
- [ ] Generate alert with recommended action
- [ ] Display alerts in UI notification center
- [ ] Typecheck/lint passes

#### US-033: Alert action proposals

**Description:** As a user, when an alert fires, I want a pre-built order ready for approval so I can act fast.

**Acceptance Criteria:**
- [ ] When trigger fires, agent analyzes situation
- [ ] Generate TradeProposal for recommended action (trim/exit/hedge)
- [ ] Display alert in UI with proposal preview
- [ ] One-click approval flow
- [ ] Tag as "alert-driven" in audit log
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

---

### Phase 3: Advanced (P2 / Future)

#### US-034: Multi-leg spread support

**Description:** As an experienced trader, I want to trade spreads (verticals, calendars) to limit risk and reduce capital requirements.

**Acceptance Criteria:**
- [ ] Extend TradeProposal schema to support multi-leg strategies
- [ ] Validate broker account supports spread orders (e.g., Alpaca level 3)
- [ ] Implement spread order building and validation
- [ ] Update risk engine to calculate spread max loss
- [ ] Display spread orders clearly in UI (show both legs)
- [ ] Typecheck/lint passes

#### US-035: Research ingestion pipeline - web/news

**Description:** As a user, I want the system to ingest relevant news and research so trade ideas are informed by catalysts.

**Acceptance Criteria:**
- [ ] Implement web scraper for allowed news sources (e.g., Bloomberg, Reuters, company press releases)
- [ ] Extract headline, date, body text
- [ ] Deduplicate by URL hash
- [ ] Store in `research_notes` table with source, timestamp, symbol tags
- [ ] Summarize long articles using LLM (token-efficient)
- [ ] Typecheck/lint passes

#### US-036: Research ingestion - PDF filings

**Description:** As a user, I want the system to process SEC filings and earnings reports so I can reference key data points.

**Acceptance Criteria:**
- [ ] Implement PDF download and text extraction
- [ ] Chunk long documents (e.g., 10-K) into sections
- [ ] Summarize each section with LLM
- [ ] Extract structured facts: earnings dates, guidance numbers, key risks
- [ ] Store extracted data with citation (page/section)
- [ ] Typecheck/lint passes

#### US-037: Research retrieval for trade ideas

**Description:** As an LLM agent, I need a tool to retrieve relevant research notes when generating trade ideas.

**Acceptance Criteria:**
- [ ] Implement `search_research(symbol, keywords)` tool
- [ ] Return relevant notes with source citations and timestamps
- [ ] Include in TradeProposal `data_used` field
- [ ] Support vector search (optional, P2)
- [ ] Typecheck/lint passes

#### US-038: Automated scanner for new candidates

**Description:** As a user, I want the system to scan for new trade candidates matching my criteria so I find opportunities faster.

**Acceptance Criteria:**
- [ ] Define scanner filters: DTE range, liquidity minimums, technical setup (RSI/trend), catalyst presence, IV rank (if available)
- [ ] Run scanner on schedule or on-demand
- [ ] Return ranked list of candidates with scores
- [ ] Generate preliminary TradeProposal for top candidates
- [ ] Display in "Candidates" tab on dashboard
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

#### US-039: Performance attribution

**Description:** As a user, I want to see which types of trades perform best so I can refine my strategy.

**Acceptance Criteria:**
- [ ] Track realized P&L by: strategy type, underlying, DTE bucket, catalyst category, hold duration
- [ ] Display in "Performance" dashboard
- [ ] Show win rate, avg win/loss, max drawdown
- [ ] Identify patterns (e.g., "trades held > 30 days outperform")
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

#### US-040: Kill switch

**Description:** As a user, I need an emergency kill switch so I can immediately stop all automation and cancel orders if something goes wrong.

**Acceptance Criteria:**
- [ ] Add "Kill Switch" button (prominent, red)
- [ ] On activation: disable all automation, cancel all open orders (configurable), switch to read-only mode, log kill switch event with reason
- [ ] Require manual re-enable with confirmation
- [ ] Notify user of status
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

---

## Functional Requirements

### Brokerage Integration
- **FR-B1:** Connect brokerage account via OAuth/token and store securely (US-003, US-004)
- **FR-B2:** Read positions, orders, balances, trade history (US-005, US-006)
- **FR-B3:** Place/cancel/modify orders (US-023, US-025)
- **FR-B4:** Idempotency and dry-run validation (US-023)

### Market Data
- **FR-M1:** Real-time or near-real-time quotes (US-004)
- **FR-M2:** Option chain retrieval with Greeks/IV (US-007)
- **FR-M3:** Historical price bars for technicals (US-010)
- **FR-M4:** Liquidity scoring (US-012)

### Research (Phase 3)
- **FR-R1:** Web/news ingestion with deduplication (US-035)
- **FR-R2:** PDF ingestion and summarization (US-036)
- **FR-R3:** Research retrieval tool (US-037)

### LLM Agent
- **FR-A1:** Portfolio review with action recommendations (US-019)
- **FR-A2:** Order repricing suggestions (US-028)
- **FR-A3:** Trade idea generation from scanner (US-038)
- **FR-A4:** Structured TradeProposal output (US-015)

### Risk & Safety
- **FR-S1:** Pre-trade validation against risk limits (US-011)
- **FR-S2:** Hard limits: risk per trade, concentration, daily loss, position count, DTE range (US-009, US-011)
- **FR-S3:** Liquidity minimums enforcement (US-012)
- **FR-S4:** Limit orders only by default (config)
- **FR-S5:** Kill switch (US-040)
- **FR-S6:** Read-only mode fallback (US-004)

### Audit & Compliance
- **FR-H1:** Log all recommendations, approvals, executions (US-026)
- **FR-H2:** Tag human vs agent actions (US-026)
- **FR-H3:** Decision journal with notes (US-027)

---

## Technical Considerations

### Supported Brokers (MVP: Pick ONE)
- **Alpaca** (Options Trading API + sandbox)
- **Tradier** (production + sandbox, Greeks via ORATS)
- **tastytrade** (market data + trading API)
- **Interactive Brokers** (broad support, higher complexity)

### Architecture Components
1. **Client UI**: Web dashboard + chat panel + approval screens
2. **API Backend**: Auth, portfolio service, order service (idempotent)
3. **Broker Adapter**: One adapter per broker (pluggable)
4. **Market Data Service**: Quotes, chains, historical bars
5. **Research Pipeline**: Fetch → extract → summarize → store (Phase 3)
6. **LLM Orchestrator**: Tool registry (MCP-compatible recommended)
7. **Risk Engine**: Deterministic validation + policy enforcement
8. **Storage**: Postgres (positions, orders, config, audit), Redis (cache), Object store (PDFs - Phase 3)

### Security
- Secrets in vault/KMS, never in logs
- Least-privilege tokens (read-only vs trade-enabled)
- Prompt-injection hardening: strip instructions from scraped content, separate data from instructions, enforce tool policies in deterministic code
- Allowlist tool calls and outbound domains

### Performance Targets
- Portfolio refresh: <5s typical
- Draft trade proposal: <30s typical (depends on LLM + providers)

---

## Design Considerations

### Dashboard Layout
- Top: Account summary (net liq, buying power, daily P&L)
- Left sidebar: Navigation (Dashboard, Positions, Journal, Candidates, Settings)
- Main area tabs: Positions table, Open Orders table, Risk Panel (exposure + Greeks + alerts)
- Right panel: Chat interface

### Order Approval Flow
- Clear order preview with risk checks (pass/fail badges)
- Color coding: green = pass, red = fail, yellow = warning
- "Approve All" disabled unless all checks pass
- Optional typed confirmation for large orders

### Mobile Considerations
- Responsive tables (collapse to cards on mobile)
- Critical actions (kill switch, order approval) easily accessible
- Read-only mode recommended for mobile

---

## Success Metrics

### Product Metrics (Primary)
- Minutes/day saved (self-reported + measured)
- % of tasks handled without manual data entry
- Order error rate (rejected/canceled due to validation failures)
- Guardrail breach rate (attempted vs blocked)

### Trading/Risk Metrics (Informational)
- Max drawdown
- Daily VaR proxy (basic)
- Exposure concentration
- "Exit discipline": % of positions with defined exit plan before entry
- Win rate and avg win/loss by strategy type (Phase 3)

---

## Risks and Mitigations

### Market Risk (Unavoidable)
- **Mitigation:** Hard caps, drawdown stops, diversification constraints

### Model Hallucination / Overconfidence
- **Mitigation:** Deterministic checks, citations required, "unknown" allowed, forced uncertainty flags, strict tool schemas

### Data Quality / Latency
- **Mitigation:** Multi-source sanity checks, timestamp gating, fallbacks

### Security and Account Takeover
- **Mitigation:** Vault, MFA, device binding, read-only by default, approval gates

### Regulatory / Compliance Drift
- **Mitigation:** Keep as "decision support" for personal use; if productized, engage counsel. Display OCC risk disclosure and require acknowledgment. FINRA rules govern options account approval for member firms.

---

## Open Questions

1. **Broker selection:** Which broker should be MVP priority? (Tradier recommended for sandbox + Greeks)
2. **LLM provider:** OpenAI, Anthropic, or local model? (Anthropic Claude recommended for tool use)
3. **Deployment:** Self-hosted vs cloud? (Self-hosted recommended for security)
4. **Paper trading:** Will chosen broker provide sandbox environment?
5. **Greeks calculation:** Rely on broker-provided Greeks or compute locally? (Broker-provided preferred for simplicity)
6. **Multi-account support:** Single account MVP or support multiple accounts from start?
7. **Real-time data:** Broker-provided streaming quotes or polling? (Polling acceptable for MVP)

---

## Appendix: Compliance and Regulatory Notes

### Options Disclosure Document (ODD)
In the US, investors must receive the OCC "Characteristics and Risks of Standardized Options" prior to options trading. Your product should:
- Link to ODD: https://www.theocc.com/Company-Information/Documents-and-Archives/Options-Disclosure-Document
- Require user acknowledgment before enabling trading

### FINRA Rules
If productized for others, you may be subject to FINRA rules on investment advice and supervision. Consult legal counsel.

### Personal Use vs Product
This PRD assumes **personal use** (decision support tool for yourself). If you plan to offer this as a service to others, you'll need:
- Legal review for investment adviser registration requirements
- Compliance workflows and disclosures
- Terms of service and risk disclaimers
- Potentially a registered broker-dealer relationship

---

## Phased Rollout Summary

| Phase | Focus | Key Stories |
|-------|-------|-------------|
| **Phase 0** | Foundation (read-only + paper) | US-001 to US-010: Connect broker, display portfolio, configure risk |
| **Phase 1** | Recommendations + Manual Execution | US-011 to US-027: Risk engine, agent tools, order approval, audit trail |
| **Phase 2** | Automation (housekeeping only) | US-028 to US-033: Auto-reprice, exit ladders, event alerts |
| **Phase 3** | Advanced (P2 / Future) | US-034 to US-040: Spreads, research pipeline, scanner, kill switch |

---

## Next Steps

1. **Choose broker** for MVP (recommend: Tradier for sandbox + Greeks)
2. **Set up development environment** (US-001)
3. **Implement Phase 0 stories** in order (US-001 through US-010)
4. **Test read-only functionality** with real account (or sandbox)
5. **Review and refine risk configuration** before enabling execution
6. **Proceed to Phase 1** only after Phase 0 is stable

---

**Document Status:** Ready for implementation planning. Start with Phase 0.
