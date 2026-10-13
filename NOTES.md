# NOTES.md (Living Memory)

## 1. Current status
Phase 0, 1, 2, 3, AI Agent Proposal Flow (Phases B-F), Phase G (Approval & Audit Correctness Gaps), Phase 4 (Monad Payment Executor & Deployment Readiness), and Phase UI (Judge Web UI with live MON limits, dynamic sync, and verified browser E2E testing) completed and verified (87 backend tests passing, frontend cleanly compiled with 0 TypeScript errors). Live on-chain settlement on Monad testnet verified with real transaction hash and MonadVision block explorer integration.

## 2. Phase log
- [x] Phase 0: Scaffold
- [x] Phase 1: Chain connection
- [x] Phase 2: Database and users
- [x] Phase 3: Auth (passkey & mock judge flow)
- [x] Phase Agent: AI Agent proposal flow, deterministic policy engine, proposal hashing, approval state machine, append-only audit trail
- [x] Phase G: Approval and audit correctness gaps (CAS transitions, approval-time policy recheck, denied vs rejected separation, audit hash chain, allowlist redaction)
- [x] Phase 4: Monad testnet native transfer executor, nonce management, robust receipt polling, finality verification, startup sweep, and deployment readiness
- [x] Phase UI: Full judge-ready Web UI (Sign in, Dashboard with live MON limits, Proposal Review, Receipt & Timeline, dynamic sent/received history)
- [ ] Phase 5: Aurora Intents adapter
- [ ] Phase 6: History and live status
- [ ] Phase 7: Hardening and docs

## 3. Verified facts
- **Monad testnet public RPC**: `https://testnet-rpc.monad.xyz`, chain id 10143, native token MON. Verified on 2026-09-30. Source: https://docs.monad.xyz/developer-essentials/testnets
- **Backup public RPCs**: `https://rpc.ankr.com/monad_testnet` and `https://rpc-testnet.monadinfra.com`
- **Testnet explorer**: https://testnet.monadscan.com, **faucet**: https://faucet.monad.xyz (from Monad docs)
- **Mainnet reference** (NOT used by this project): chain id 143, https://rpc.monad.xyz
- **Monad Gas Charging Model**: Monad charges upfront `gas_paid = gas_limit * price_per_gas`, NOT `gas_used`. Unused gas is NOT refunded for execution below the limit. Source: https://docs.monad.xyz/developer-essentials/gas-pricing (Section: "Gas limit, not gas used"). Plain native EOA-to-EOA MON transfers require strictly 21,000 gas. Transfers to contract addresses trigger fallback code which fails if gas is capped at 21,000; hence TapRemit checks `eth_getCode` and explicitly rejects contract addresses.
- **Monad Nonce & Mempool Architecture**: Transaction lifecycle and speculative execution in Monad consensus are documented at https://docs.monad.xyz/monad-arch/consensus/local-mempool#transaction-lifecycle-in-monad and JSON-RPC block tags at https://docs.monad.xyz/reference/json-rpc/overview#block-tags. Note: The section title "Deferred nonce and balance validation" cited previously does not exist as an explicit heading in the overview page; the underlying behavior is part of Monad's pipelined execution architecture.
- **Monad Finality Model**: Monad blocks progress through `Proposed -> Voted -> Finalized -> Verified`. The `latest` tag represents Proposed (speculative execution without consensus vote). Finality must be asserted against the `finalized` tag, and `receipt.blockHash` must strictly match `getBlockByNumber('finalized').hash`. Source: https://docs.monad.xyz/reference/json-rpc/overview#block-tags

## 4. Open questions and TODOs
- UI Phase missing read endpoints to confirm with user: `GET /proposals` (list user proposals for dashboard) and `GET /system/status` (adapter configuration flags for persistent badges).
- AUSD testnet address and decimals.
- Mera SDK package and usage.
- Aurora Intents testnet support.
- Alchemy Monad endpoint.
- Whether a PWA qualifies for the Agora mobile-app bounty.
- Whether testnet is acceptable for submission (ask organizers on Discord).
- Phone verification (OTP) needs to be implemented to secure phone-based lookups.

## 5. Decisions
- Phone lookup is POST `/users/lookup` with a JSON body; GET `/users/lookup?handle=...` is handle-only.
- The first claimant of a phone number owns the lookup, as there is currently no OTP verification. This is spoofable and must not be presented as secure.
- Expected 4xx errors are logged at WARN.
- Using JWT for short-lived sessions after WebAuthn/Passkey auth.
- AI Agent output is strictly untrusted: parsed by strict Zod schema, recipient handles resolved against internal DB (never trusting model mappings).
- Proposal approval cryptographically binds to a canonical SHA-256 hash of proposal fields (`proposal_hash`); any modification fails verification.
- Canonical proposal hash includes `id`, `user_id`, `recipient_id`, `recipient_handle`, `amount`, `asset`, `network`, `origin`, `purpose`, `expires_at`, `created_at`.
- State transitions are compare-and-swap (`UPDATE proposals SET status = @to, updated_at = @now WHERE id = @id AND status IN (...)`) to prevent concurrent double-approvals.
- Policy engine evaluates both at proposal creation and again atomically at human approval time inside SQLite transaction.
- Status `denied` (by deterministic policy engine) is distinct from `rejected` (by human user).
- `audit_logs` maintains a cryptographic tamper-evident hash chain (`prev_hash` + `entry_hash`) ordered by SQLite `rowid`, with DB triggers enforcing append-only behavior (no UPDATE, no DELETE).
- Audit log details are strictly allowlist-filtered before storage to prevent sensitive data leakage.
- Mock payments explicitly label settlement as `SIMULATED` with `sim_0x...` tx hashes.
- Canonical proposal hash includes `recipient_wallet` in addition to handle/amount/network.
- Immutability of `users.wallet_address` is strictly enforced by SQLite trigger `users_wallet_address_immutable` (BEFORE UPDATE OF wallet_address).
- `GLOBAL_DAILY_LIMIT_MON` (default 2.0 MON) is enforced both in the policy engine and inside the executor.
- Fail closed on stuck transactions: Real sends refuse execution if any proposal is in `broadcasted_unknown` or `not_found_needs_review`, unless `OPERATOR_OVERRIDE_ALLOW_SENDS=true`. Normal mempool acceptance uses `broadcast_accepted` and does not lock subsequent sends.
- Substate distinction: `broadcast_accepted` (node returned tx hash, awaiting inclusion) vs `broadcasted_unknown` (ambiguous transport drop/timeout). Only true ambiguity and `not_found_needs_review` trigger the stuck-proposal lock and nonce ambiguity flag. Normal sends never show "unknown" in the API.
- Finality verification: Re-queries receipt on every poll; resets substate to `broadcasted_unknown` if receipt disappears; only marks `confirmed` when `receipt.blockNumber <= finalizedBlockNumber` AND `receipt.blockHash === finalizedBlock.hash`.

## 6. Known issues / lessons
- `https://rpc-devnet.monad.xyz` and `https://rpc.testnet.monad.xyz` do not resolve (ENOTFOUND), never use them.
- Phone numbers leaked through `req.url` and SQL verbose logging; fixed in Phase 2 follow-up.
- Phone numbers leaked through `app.ts` spreading `req` in `pinoHttp` serializers, exposing `req.raw.body`. Fixed by explicitly picking safe properties for `req` serializer and adding comprehensive pino redact paths.
- Auth routes lacked rate limits and `login/start` allowed handle enumeration; fixed by adding `express-rate-limit` and returning identical generic responses for known/unknown handles.
- `DEBUG_SQL` caveat: better-sqlite3 verbose logging must stay disabled for sensitive data. The earlier claim that better-sqlite3 verbose never exposes parameters was wrong.
- `better-sqlite3@13.0.3` lacks prebuilt binaries on Windows for Node 24 and triggered node-gyp build failures without VS C++ tools. Resolved by using Node 20 LTS via `fnm` and pinning `better-sqlite3@11.8.1`, which contains official prebuilts.

## 7. Environment variables
| Variable | Purpose | Required | Default |
|----------|---------|----------|---------|
| PORT | Server port | Optional | 3000 |
| NODE_ENV | Environment mode | Optional | development |
| MOCK_CHAIN | Use mock chain adapter | Optional | true |
| MONAD_RPC_URL | Monad testnet RPC URL | Required if MOCK_CHAIN=false | - |
| RPC_PRIMARY_URL | Primary Monad RPC URL | Optional | https://testnet-rpc.monad.xyz |
| RPC_FALLBACK_URL | Fallback Monad RPC URL | Optional | https://rpc.ankr.com/monad_testnet |
| EXPLORER_BASE_URL | Block explorer URL | Optional | https://testnet.monadscan.com |
| RELAYER_ADDRESS | Public address of relayer EOA | Required if MOCK_PAYMENT_EXECUTOR=false | - |
| RELAYER_PRIVATE_KEY | Private key of relayer EOA | Required if MOCK_PAYMENT_EXECUTOR=false | - |
| PAUSE_REAL_TRANSFERS | Emergency switch pausing real on-chain transfers | Optional | false |
| MAX_TESTNET_TRANSFER_MON | Hard per-tx cap for manual/real transfers | Optional | 0.2 |
| GLOBAL_DAILY_LIMIT_MON | Aggregate rolling 24h limit across all relayer sends | Optional | 2.0 |
| PER_TX_LIMIT_MON | Policy per-transaction limit for MON | Optional | 0.1 |
| DAILY_LIMIT_MON | Policy per-user rolling 24h limit for MON | Optional | 1.0 |
| OPERATOR_OVERRIDE_ALLOW_SENDS | Override stuck transaction lock | Optional | false |
| MONAD_FINALITY_CONFIRMATION_TIMEOUT_MS | Timeout for receipt polling | Optional | 30000 |
| DB_PATH | Path to SQLite DB | Optional | ./data/tapremit.db |
| DEBUG_SQL | Enable SQLite query logging | Optional | false |
| MOCK_AUTH | Use mock auth adapter | Optional | true |
| WEBAUTHN_RP_ID | WebAuthn Relying Party ID | Optional | localhost |
| WEBAUTHN_RP_NAME | WebAuthn Relying Party Name | Optional | TapRemit |
| WEBAUTHN_ORIGIN | WebAuthn Origin URL | Optional | http://localhost:3000 |
| JWT_SECRET | Secret for signing JWTs | Required if MOCK_AUTH=false | mock_... |
| JWT_EXPIRY | JWT expiration time | Optional | 1h |
| AUTH_RATE_LIMIT_MAX | Max auth requests per window | Optional | 20 |
| AUTH_RATE_LIMIT_WINDOW_MS | Auth rate limit window (ms) | Optional | 900000 |
| AUTH_IP_RATE_LIMIT_MAX | Max auth requests per IP (overall) | Optional | 60 |
| AUTH_IP_RATE_LIMIT_WINDOW_MS | Auth IP rate limit window (ms) | Optional | 900000 |
| ME_RATE_LIMIT_MAX | Max requests for /auth/me per window | Optional | 120 |
| ME_RATE_LIMIT_WINDOW_MS | /auth/me rate limit window (ms) | Optional | 60000 |
| MOCK_LLM | Use mock LLM adapter | Optional | true |
| MOCK_PAYMENT_EXECUTOR | Use mock payment executor | Optional | true |
| PER_TX_LIMIT_AUSD | Max AUSD per transaction | Optional | 50 |
| MAX_REBROADCAST_AGE_MS | Maximum age of stored signed tx eligible for startup rebroadcast (ms) | Optional | 600000 |
| NOT_FOUND_WINDOW_MS | Window before missing receipt transitions to not_found_needs_review (ms) | Optional | 300000 |
| PROPOSAL_TTL_SECONDS | Proposal expiry TTL in seconds | Optional | 900 |

*Note: When deploying behind a reverse proxy (e.g., Vercel, Nginx), `trust proxy` must be configured in Express so the rate limiter sees real client IPs. Limiter counters are stored in memory and reset on server restart.*

## 8. API contract
- **GET /health**
  - **Auth**: None
  - **Response**: `{ "status": "ok", "timestamp": "...", "uptime": 123.45 }`

- **GET /chain/status**
  - **Auth**: None
  - **Response**: `{ "blockNumber": 66789166, "latencyMs": 517 }`

- **POST /auth/register/start**
  - **Auth**: None
  - **Request**: `{ "handle": "alice", "display_name": "Alice", "phone": "+1234" }`
  - **Response**: WebAuthn options or mock challenge

- **POST /auth/register/finish**
  - **Auth**: None
  - **Request**: `{ "handle": "alice", "response": {...} }`
  - **Response**: `{ "token": "jwt..." }`

- **POST /auth/login/start**
  - **Auth**: None
  - **Request**: `{ "handle": "alice" }`
  - **Response**: WebAuthn options or mock challenge

- **POST /auth/login/finish**
  - **Auth**: None
  - **Request**: `{ "handle": "alice", "response": {...} }`
  - **Response**: `{ "token": "jwt..." }`

- **GET /auth/me**
  - **Auth**: Required (JWT Bearer)
  - **Response**: `{ "id": "...", "handle": "alice", "display_name": "Alice", "phone": "+1234", "wallet_address": null }`

- **GET /users/lookup?handle=...**
  - **Auth**: Required (JWT Bearer)
  - **Response**: `{ "handle": "alice", "display_name": "Alice" }`

- **POST /users/lookup**
  - **Auth**: Required (JWT Bearer)
  - **Request**: `{ "phone": "+1234567890" }` or `{ "handle": "alice" }`
  - **Response**: `{ "handle": "alice", "display_name": "Alice" }`

- **GET /system/status**
  - **Auth**: None
  - **Response**: `{ "adapters": { "auth": "mock", "llm": "mock", "executor": "mock", "chain": "mock" }, "limits": { "perTxLimitAusd": 50, "dailyLimitAusd": 200, "proposalTtlSeconds": 900 }, "network": { "name": "Monad Testnet", "chainId": 10143, "asset": "AUSD" } }`

- **POST /agent/propose**
  - **Auth**: Required (JWT Bearer)
  - **Request**: `{ "instruction": "send 5 test AUSD to @riya for design", "idempotency_key": "optional-key" }`
  - **Response**: `{ "type": "PROPOSAL", "proposal": { "id": "...", "amount": "5000000", "display_amount": "5", "asset": "AUSD", "status": "awaiting_approval", "proposal_hash": "...", "policy_decision": "REQUIRE_APPROVAL", "policy_reasons": [...] }, "provider": "MockLLM...", "isMock": true }` or `{ "type": "CLARIFICATION", "message": "...", "provider": "...", "isMock": true }`

- **GET /proposals**
  - **Auth**: Required (JWT Bearer)
  - **Response**: `{ "proposals": [{ "id": "...", "amount": "...", "display_amount": "...", "asset": "AUSD", "status": "...", "recipient_handle": "..." }] }`

- **GET /proposals/:id**
  - **Auth**: Required (JWT Bearer, sender only)
  - **Response**: Proposal object with parsed `policy_reasons`

- **POST /proposals/:id/approve**
  - **Auth**: Required (JWT Bearer, sender only)
  - **Request**: `{ "proposal_hash": "..." }` (optional client reviewed hash)
  - **Response**: `{ "proposal": { "status": "simulated_confirmed", ... }, "receipt": { "status": "simulated_confirmed", "txHash": "sim_0x...", "isSimulated": true } }`

- **POST /proposals/:id/reject**
  - **Auth**: Required (JWT Bearer, sender only)
  - **Request**: `{ "reason": "optional reason" }`
  - **Response**: Rejected proposal object

- **GET /proposals/:id/timeline**
  - **Auth**: Required (JWT Bearer, sender or recipient)
  - **Response**: `{ "proposal": {...}, "timeline": [{ "timestamp": "...", "actor": "agent|policy_engine|user|system", "action": "...", "humanDescription": "...", "isSimulated": boolean }] }`

## 9. Bounty proof
- **Agora**: Not started
- **Aurora**: Not started
- **Mera**: Placeholder. WebAuthn adapter implemented but untested with a real authenticator.

## 10. Operator Runbook: Clearing a Stuck Nonce

When the single relayer EOA has a stuck transaction (a broadcasted proposal in `broadcasted_unknown` or `not_found_needs_review`), all subsequent real transactions fail-closed with HTTP 503 to prevent nonce gaps or re-ordering failures.

### Symptoms
- API returns `HTTP 503`: `"Real transfers are blocked: Proposal <id> is in stuck state 'broadcasted_unknown'..."`
- Health/System status shows unreconciled or pending proposals.

### Step-by-Step Resolution
1. **Pause Real Transfers Immediately**:
   Set `PAUSE_REAL_TRANSFERS=true` in `.env` and restart the backend server so no incoming approvals attempt execution during investigation.
2. **Inspect the Stuck Proposal**:
   Query the database or proposal endpoint for the proposal's stored `execution_tx_hash` and `execution_nonce`:
   ```powershell
   # In SQLite or via API
   SELECT id, execution_tx_hash, execution_nonce, execution_substate, amount FROM proposals WHERE execution_substate IN ('broadcasted_unknown', 'not_found_needs_review');
   ```
3. **Verify On-Chain State via Explorer / Public RPC**:
   Check if the transaction hash was mined:
   ```powershell
   $rpc = "https://testnet-rpc.monad.xyz"
   $txHash = "<stored_execution_tx_hash>"
   $body = '{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionReceipt","params":["' + $txHash + '"]}'
   Invoke-RestMethod -Uri $rpc -Method POST -ContentType "application/json" -Body $body
   ```
   Check current on-chain relayer nonce:
   ```powershell
   $relayer = "0x836DF4117d96B860939627B7288a0e5C51fEFD53"
   $bodyNonce = '{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionCount","params":["' + $relayer + '","latest"]}'
   (Invoke-RestMethod -Uri $rpc -Method POST -ContentType "application/json" -Body $bodyNonce).result
   ```
4. **Resolution Paths**:
   - **Case A: Transaction was mined on-chain**:
     Trigger reconciliation via endpoint `POST /proposals/:id/reconcile` (or restart the backend server, which runs the startup sweep automatically). The sweep will verify finality, transition the proposal to `confirmed` or `failed`, clear `execution_substate`, and unblock the queue.
   - **Case B: Transaction was dropped or stuck in mempool with a low tip**:
     If the transaction never mined and blocks the nonce `N`:
     a. Issue a replacement transaction at the same nonce `N` with higher tip/gas to self (`0 MON` to relayer address) manually or via script.
     b. Once the replacement transaction confirms, run `POST /proposals/:id/reconcile` or update the database record to mark the original proposal as `failed` with substate cleared.
   - **Case C: Emergency Operator Override**:
     If an urgent transfer must proceed and the stuck transaction cannot be resolved immediately, set `OPERATOR_OVERRIDE_ALLOW_SENDS=true` in `.env` and restart the backend. *Warning*: Using this override risks subsequent transactions stalling if earlier nonces remain unmined.
5. **Resume Transfers**:
   Set `PAUSE_REAL_TRANSFERS=false` and remove `OPERATOR_OVERRIDE_ALLOW_SENDS` once normal operation is verified.

