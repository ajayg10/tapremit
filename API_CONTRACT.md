# TapRemit Backend API Contract

**Base URL**: `http://localhost:3000` (Local Dev) / `https://api.tapremit.xyz` (Production Placeholder)  
**Target Chain**: Monad Testnet (`chainId: 10143`)  
**Specification Version**: Hackathon Submission v1.0  

---

## 1. Authentication & Security Model

- **Session Type**: Bearer JSON Web Token (JWT) in HTTP `Authorization` header:
  ```http
  Authorization: Bearer <token>
  ```
- **Algorithms**: `HS256` strictly enforced.
- **Passkey / WebAuthn & Mock Modes**:
  - In `MOCK_AUTH=true` mode, `POST /auth/login/finish` accepts `{ "handle": "...", "response": { "mock": true } }` for 1-click testnet judge access.
  - In real WebAuthn mode, credentials follow `@simplewebauthn` standards.
- **Privacy & Rate Limiting**:
  - Sensitive parameters (passwords, tokens, phone numbers) are never returned in public endpoints.
  - Rate limiting is keyed by client IP (via `trust proxy`) and per-handle.

---

## 2. Proposal Lifecycle & Status Reference

### Proposal Statuses (`status`)

| Status Value | Suggested UI Label | Description & Recommended UI Action |
|:---|:---|:---|
| `draft` | **Draft** | Agent is preparing parameters; not ready for execution. |
| `awaiting_approval` | **Awaiting Approval** | Ready for human review. Render **Approve** and **Reject** buttons with canonical integrity hash and policy reasons. |
| `approved` | **Approved (Executing)** | Sender confirmed the transfer; relayer is claiming nonce and constructing transaction. Show loading spinner. |
| `submitted` | **Broadcasted to Monad** | Transaction was accepted into the Monad testnet mempool. Show MonadVision explorer link. |
| `confirmed` | **Confirmed on Monad** | Verified on-chain with finalized receipt. Render green confirmation badge. |
| `simulated_confirmed` | **Simulated Confirmation** | Mock executor completed instant testnet simulation. Render blue confirmation badge. |
| `rejected` | **Rejected** | Explicitly dismissed by the sender. |
| `policy_denied` | **Blocked by Policy** | Guardrail limits exceeded (per-transaction or 24h rolling limit). Render red warning badge. |
| `expired` | **Expired** | Proposal TTL (default 15 mins) lapsed prior to human approval. Prompt user to re-generate. |
| `failed` | **Settlement Failed** | On-chain revert, contract recipient rejection, or exhausted balance. Display error details. |

### Execution Substates (`execution_substate`)

| Substate Value | Suggested UI Label | Meaning |
|:---|:---|:---|
| `awaiting_broadcast` | **Preparing Transaction** | Signed transaction created; awaiting node submission. |
| `broadcast_accepted` | **In Mempool** | Accepted by primary RPC node; awaiting block inclusion. |
| `broadcasted_unknown` | **Broadcast Sent (Pending)** | Ambiguous RPC response; safe retry/poll in background. |
| `included_pending_finality` | **Included in Block** | Block height reported; waiting for Monad finality confirmation. |
| `not_found_needs_review` | **Verification In Progress** | Search window exceeded; can trigger manual `reconcile`. |

---

## 3. Endpoints

### 3.1 Health & Diagnostics

#### `GET /health`
Returns system status, active adapter modes, and network info without exposing any secrets. Responds immediately even if RPC is unreachable.

- **Headers**: None
- **Response `200 OK`**:
```json
{
  "status": "ok",
  "timestamp": "2026-10-13T16:30:00.000Z",
  "uptime": 142.5,
  "adapters": {
    "chain": "testnet",
    "executor": "testnet",
    "auth": "mock",
    "llm": "mock"
  },
  "network": {
    "name": "Monad Testnet",
    "chainId": 10143,
    "asset": "MON"
  }
}
```

```powershell
curl.exe -s http://localhost:3000/health
```

---

#### `GET /system/status`
Returns active execution limits, caps, relayer address, and transfer pause status.

- **Headers**: None
- **Response `200 OK`**:
```json
{
  "isRealChain": true,
  "activeAsset": "MON",
  "adapters": {
    "auth": "mock",
    "llm": "mock",
    "executor": "testnet",
    "chain": "testnet"
  },
  "limits": {
    "perTxLimitAusd": 50,
    "dailyLimitAusd": 200,
    "perTxLimitMon": 0.1,
    "dailyLimitMon": 1.0,
    "globalDailyLimitMon": 2.0,
    "maxTestnetTransferMon": 0.2,
    "pauseRealTransfers": false,
    "proposalTtlSeconds": 900
  },
  "network": {
    "name": "Monad Testnet",
    "chainId": 10143,
    "asset": "MON"
  },
  "relayer": {
    "address": "0x836DF4117d96B860939627B7288a0e5C51fEFD53"
  }
}
```

```powershell
curl.exe -s http://localhost:3000/system/status
```

---

#### `GET /chain/status`
Queries the live Monad testnet RPC for current block height, chain ID, and measured round-trip latency.

- **Headers**: None
- **Response `200 OK`**:
```json
{
  "chainId": 10143,
  "blockNumber": "15420911",
  "latencyMs": 142,
  "client": "Monad Testnet Public RPC",
  "isMock": false
}
```

```powershell
curl.exe -s http://localhost:3000/chain/status
```

---

### 3.2 Authentication

#### `POST /auth/login/start`
Initiates WebAuthn authentication ceremony or mock challenge.

- **Request Body**:
```json
{
  "handle": "alice_agent"
}
```
- **Response `200 OK`**:
```json
{
  "challenge": "mock_challenge_alice_agent_1728837000000"
}
```
- **Errors**: `400 Bad Request` if handle format is invalid.

```powershell
curl.exe -s -X POST http://localhost:3000/auth/login/start `
  -H "Content-Type: application/json" `
  -d '{\"handle\":\"alice_agent\"}'
```

---

#### `POST /auth/login/finish`
Verifies authenticator response and issues a JWT token.

- **Request Body**:
```json
{
  "handle": "alice_agent",
  "response": { "mock": true }
}
```
- **Response `200 OK`**:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```
- **Errors**: `400 Bad Request` if credentials fail verification.

```powershell
curl.exe -s -X POST http://localhost:3000/auth/login/finish `
  -H "Content-Type: application/json" `
  -d '{\"handle\":\"alice_agent\",\"response\":{\"mock\":true}}'
```

---

#### `POST /auth/register/start`
Begins registration of a new user.

- **Request Body**:
```json
{
  "handle": "new_user",
  "display_name": "New User",
  "phone": "+14155552699"
}
```
- **Response `200 OK`**: WebAuthn registration options.
- **Errors**: `409 Conflict` if handle already exists.

---

#### `POST /auth/register/finish`
Completes registration and returns JWT session token.

- **Request Body**:
```json
{
  "handle": "new_user",
  "response": { ... }
}
```
- **Response `200 OK`**: `{ "token": "..." }`

---

#### `GET /auth/me`
Fetches current authenticated profile.

- **Headers**: `Authorization: Bearer <token>`
- **Response `200 OK`**:
```json
{
  "id": "76d1e4eb-91da-45ca-ae29-5fc186001717",
  "handle": "alice_agent",
  "display_name": "Alice",
  "phone": "+14155552671",
  "wallet_address": "0x1111111111111111111111111111111111111111",
  "created_at": "2026-10-13T10:00:00.000Z"
}
```
- **Errors**: `401 Unauthorized` if token is invalid or expired.

```powershell
curl.exe -s http://localhost:3000/auth/me `
  -H "Authorization: Bearer $TOKEN"
```

---

### 3.3 Users & Directory

#### `POST /users/lookup` (Recommended) or `GET /users/lookup?handle=...`
Lookup public user info by handle or phone. **Never returns wallet address, internal id, or phone number.**

- **Headers**: `Authorization: Bearer <token>`
- **Request Body (`POST`)**:
```json
{
  "handle": "riya"
}
```
- **Response `200 OK`**:
```json
{
  "handle": "riya",
  "display_name": "Riya Patel"
}
```
- **Errors**: `404 Not Found` if user does not exist.

```powershell
curl.exe -s -X POST http://localhost:3000/users/lookup `
  -H "Authorization: Bearer $TOKEN" `
  -H "Content-Type: application/json" `
  -d '{\"handle\":\"riya\"}'
```

---

### 3.4 AI Agent & Payment Intent

#### `POST /agent/propose`
Translates natural language intent (e.g. *"Send 0.01 MON to @riya for design wireframes"*) into a structured, policy-checked payment proposal.

- **Headers**: `Authorization: Bearer <token>`
- **Request Body**:
```json
{
  "instruction": "Send 0.01 MON to @riya for design wireframes sprint 2",
  "idempotency_key": "unique-client-req-91823"
}
```
- **Response `200 OK` (Proposal Created)**:
```json
{
  "type": "PROPOSAL",
  "proposal": {
    "id": "e9fb443b-3127-448f-8919-6ae741a396eb",
    "user_id": "76d1e4eb-91da-45ca-ae29-5fc186001717",
    "origin": "agent",
    "recipient_handle": "riya",
    "recipient_id": "18cf1bd1-314b-4b13-90d5-b6d3b3844f2d",
    "recipient_wallet": "0x2222222222222222222222222222222222222222",
    "amount": "10000000000000000",
    "display_amount": "0.01",
    "asset": "MON",
    "network": "Monad Testnet",
    "purpose": "design wireframes sprint 2",
    "proposal_hash": "a243003b5f7e7f781a967520e74fec9faefbc278385bb50a221295b95ba07fc2",
    "status": "awaiting_approval",
    "policy_decision": "REQUIRE_APPROVAL",
    "policy_reasons": [
      { "rule": "ASSET_WHITELIST", "decision": "ALLOW", "reason": "Asset is supported (MON)." },
      { "rule": "AMOUNT_BOUNDS", "decision": "ALLOW", "reason": "Amount is within valid positive bounds." },
      { "rule": "PER_TX_LIMIT", "decision": "ALLOW", "reason": "Within per-transaction limit of 0.1 MON." },
      { "rule": "DAILY_ROLLING_LIMIT", "decision": "ALLOW", "reason": "Within rolling 24-hour limit." }
    ],
    "expires_at": "2026-10-13T16:45:00.000Z",
    "execution_mode": "testnet",
    "execution_substate": null,
    "execution_nonce": null,
    "execution_tx_hash": null,
    "execution_error": null,
    "created_at": "2026-10-13T16:30:00.000Z",
    "updated_at": "2026-10-13T16:30:00.000Z"
  },
  "provider": "MockLLMAdapter",
  "isMock": true
}
```

- **Response `200 OK` (Clarification Needed)**:
```json
{
  "type": "CLARIFICATION",
  "message": "Please specify the amount you want to send.",
  "provider": "MockLLMAdapter",
  "isMock": true
}
```

```powershell
curl.exe -s -X POST http://localhost:3000/agent/propose `
  -H "Authorization: Bearer $TOKEN" `
  -H "Content-Type: application/json" `
  -d '{\"instruction\":\"Send 0.01 MON to @riya for wireframes\"}'
```

---

### 3.5 Proposals & Settlement

#### `GET /proposals`
Lists proposals where the user is sender OR recipient (most recent first).

- **Headers**: `Authorization: Bearer <token>`
- **Query Params**: `?limit=20` (max 100)
- **Response `200 OK`**:
```json
{
  "proposals": [ ... ]
}
```

```powershell
curl.exe -s "http://localhost:3000/proposals?limit=10" `
  -H "Authorization: Bearer $TOKEN"
```

---

#### `GET /proposals/:id`
Fetch single proposal details.

- **Headers**: `Authorization: Bearer <token>`
- **Response `200 OK`**: Single proposal object.
- **Errors**: `403 Forbidden` if user is neither sender nor recipient. `404 Not Found`.

---

#### `POST /proposals/:id/approve`
Approves and triggers execution. Validates the canonical `proposal_hash` before signing.

- **Headers**: `Authorization: Bearer <token>`
- **Request Body**:
```json
{
  "proposal_hash": "a243003b5f7e7f781a967520e74fec9faefbc278385bb50a221295b95ba07fc2",
  "confirm_new_recipient": true
}
```
*(Note: `confirm_new_recipient: true` is required if this is the first transaction to this recipient)*.

- **Response `200 OK`**:
```json
{
  "proposal": {
    "id": "e9fb443b-3127-448f-8919-6ae741a396eb",
    "status": "submitted",
    "execution_substate": "broadcast_accepted",
    "execution_tx_hash": "0xbd6b5c662e81579ddc7027fefa2b5ef5f65e6bceab32adc4d3cb1152dfcefd92",
    ...
  },
  "receipt": {
    "status": "submitted",
    "txHash": "0xbd6b5c662e81579ddc7027fefa2b5ef5f65e6bceab32adc4d3cb1152dfcefd92",
    "network": "Monad Testnet",
    "asset": "MON",
    "amount": "10000000000000000",
    "isSimulated": false,
    "explorerLink": "https://testnet.monadvision.com/tx/0xbd6b5c662e81579ddc7027fefa2b5ef5f65e6bceab32adc4d3cb1152dfcefd92"
  }
}
```
- **Errors**:
  - `400 Bad Request`: Hash mismatch, expired TTL, or `confirm_new_recipient` required.
  - `409 Conflict`: Proposal already processed or concurrent approval underway.
  - `503 Service Unavailable`: Transfers paused by operator (`PAUSE_REAL_TRANSFERS=true`) or pending stuck transaction. Reverts proposal safely to `awaiting_approval`.

```powershell
curl.exe -s -X POST http://localhost:3000/proposals/e9fb443b-3127-448f-8919-6ae741a396eb/approve `
  -H "Authorization: Bearer $TOKEN" `
  -H "Content-Type: application/json" `
  -d '{\"proposal_hash\":\"a243003b5f7e7f781a967520e74fec9faefbc278385bb50a221295b95ba07fc2\",\"confirm_new_recipient\":true}'
```

---

#### `POST /proposals/:id/reject`
Rejects the proposal.

- **Headers**: `Authorization: Bearer <token>`
- **Request Body**:
```json
{
  "reason": "Cancelled by user"
}
```
- **Response `200 OK`**: Proposal object with status `rejected`.

---

#### `POST /proposals/:id/reconcile`
Polls on-chain status for a submitted or ambiguous proposal without signing any new transaction.

- **Headers**: `Authorization: Bearer <token>`
- **Response `200 OK`**: Updated proposal and receipt.

---

#### `GET /proposals/:id/timeline`
Retrieves human-readable audit trail events for a proposal.

- **Headers**: `Authorization: Bearer <token>`
- **Response `200 OK`**:
```json
{
  "proposal": { "id": "...", "display_amount": "0.01", "asset": "MON" },
  "timeline": [
    {
      "id": "aud-1",
      "timestamp": "2026-10-13T16:30:00.000Z",
      "actor": "user",
      "action": "instruction_received",
      "humanDescription": "User submitted payment instruction.",
      "isSimulated": false
    },
    {
      "id": "aud-2",
      "timestamp": "2026-10-13T16:30:01.000Z",
      "actor": "agent",
      "action": "proposal_created",
      "humanDescription": "AI agent proposed payment of 0.01 MON to @riya.",
      "isSimulated": false
    },
    {
      "id": "aud-3",
      "timestamp": "2026-10-13T16:30:01.000Z",
      "actor": "policy_engine",
      "action": "policy_evaluated",
      "humanDescription": "Policy engine evaluated rules: REQUIRE_APPROVAL. Explicit human authorization required.",
      "isSimulated": false
    },
    {
      "id": "aud-4",
      "timestamp": "2026-10-13T16:31:00.000Z",
      "actor": "user",
      "action": "approved",
      "humanDescription": "Human user reviewed and approved proposal. Integrity hash validated.",
      "isSimulated": false
    },
    {
      "id": "aud-5",
      "timestamp": "2026-10-13T16:31:02.000Z",
      "actor": "system",
      "action": "execution_confirmed",
      "humanDescription": "Transaction confirmed on-chain. Tx: 0xbd6b5c662e81579ddc7027fefa2b5ef5f65e6bceab32adc4d3cb1152dfcefd92",
      "isSimulated": false
    }
  ]
}
```

```powershell
curl.exe -s http://localhost:3000/proposals/e9fb443b-3127-448f-8919-6ae741a396eb/timeline `
  -H "Authorization: Bearer $TOKEN"
```
