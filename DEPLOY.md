# TapRemit Deployment & Operations Guide

This guide details configuration, compilation, runtime deployment, and operational procedures for hosting the TapRemit backend on Monad Testnet for hackathon evaluation and public staging.

---

## 1. Prerequisites & Engines

- **Runtime**: Node.js `^20.0.0` (LTS)
- **Database**: SQLite (WAL mode, embedded via `better-sqlite3`)
- **Network Access**: Outbound HTTPS to Monad Testnet RPC endpoints

---

## 2. Environment Variables Reference

> **CRITICAL SECURITY RULE**: Never check in real values, private keys, or credentials. Store all values securely in environment secret managers or local uncommitted `.env` files.

### Core & Server
| Variable Name | Purpose |
|:---|:---|
| `PORT` | Local network port Express listens on (default: `3000`). |
| `NODE_ENV` | Environment identifier (`production`, `development`, or `test`). In `production`, strict checks enforce strong JWT secrets, non-wildcard CORS, and explicit seed wallet addresses. |
| `FRONTEND_ORIGIN` | Comma-separated list of allowed web origins for CORS (e.g. `https://tapremit.app,https://staging.tapremit.app`). In `production`, wildcard `*` is rejected. |
| `DATABASE_PATH` | Path to SQLite database file. Parent directory is created automatically on boot if missing (default: `./data/tapremit.db`). |
| `DEBUG_SQL` | Toggle SQL query parameter logging. Must be kept `false` in production. |

### Authentication & Sessions
| Variable Name | Purpose |
|:---|:---|
| `JWT_SECRET` | Secret key used to sign session JWTs. In `production`, startup fails if missing or shorter than 32 characters. |
| `JWT_EXPIRY` | Token duration (e.g. `1h`, `24h`). |
| `MOCK_AUTH` | When `true`, enables mock challenge flow allowing 1-click login for hackathon judges and evaluators without physical WebAuthn hardware passkeys. |
| `WEBAUTHN_RP_ID` | Relying Party identifier for WebAuthn passkeys (e.g. `tapremit.app` or `localhost`). |
| `WEBAUTHN_RP_NAME` | Display name presented in passkey prompts (`TapRemit`). |
| `WEBAUTHN_ORIGIN` | Authorized origin for WebAuthn ceremony validation. |

### Blockchain & Settlement Adapters
| Variable Name | Purpose |
|:---|:---|
| `MOCK_CHAIN` | When `false`, reads live block numbers, chain ID, and RPC latency from Monad testnet. |
| `MOCK_PAYMENT_EXECUTOR` | When `false`, executes live transfers on Monad testnet via relayer; when `true`, simulates transfers instantly in memory. |
| `MOCK_LLM` | When `true`, uses deterministic keyword parser for demo commands; when `false`, calls production LLM APIs. |
| `RPC_PRIMARY_URL` | Monad testnet JSON-RPC endpoint for sending signed raw transactions and querying status. |
| `RPC_FALLBACK_URL` | Secondary Monad testnet JSON-RPC endpoint used for resilient read fallbacks. |
| `EXPLORER_BASE_URL` | MonadVision block explorer base URL used to generate clickable transaction links. |
| `RELAYER_ADDRESS` | Public Ethereum-style address (`0x...`) of the funded relayer. |
| `RELAYER_PRIVATE_KEY` | Hex private key for the relayer account (used to sign testnet transactions). |

### Financial Safety & Guardrails
| Variable Name | Purpose |
|:---|:---|
| `PAUSE_REAL_TRANSFERS` | Emergency killswitch. When `true`, all on-chain broadcasts are paused immediately. |
| `PER_TX_LIMIT_MON` | Maximum MON allowed for a single transaction proposal. |
| `DAILY_LIMIT_MON` | Maximum MON allowed for a single user over a rolling 24-hour window. |
| `GLOBAL_DAILY_LIMIT_MON` | System-wide cap on total MON disbursed by the relayer across all users within 24 hours. |
| `MAX_TESTNET_TRANSFER_MON` | Hard ceiling on individual transfers enforced by the relayer executor. |
| `PROPOSAL_TTL_SECONDS` | Time-to-live for proposals before they expire if unapproved (default: `900`s = 15m). |
| `OPERATOR_OVERRIDE_ALLOW_SENDS` | Emergency operator flag to bypass stuck-transaction locks during recovery. |

### Demo Account Seeding
| Variable Name | Purpose |
|:---|:---|
| `SEED_ON_BOOT` | When `true`, runs idempotent seeder on server startup to create demo accounts if not present. |
| `SEED_ALICE_WALLET` | Wallet address assigned to demo user `@alice_agent`. |
| `SEED_RIYA_WALLET` | Wallet address assigned to demo user `@riya`. |
| `SEED_BOB_WALLET` | Wallet address assigned to demo user `@bob_builder`. |
| `SEED_CHARLIE_WALLET` | Wallet address assigned to demo user `@charlie`. |

---

## 3. Build & Run Procedures

### Production Compilation
Compile TypeScript to standalone CommonJS in `dist/`:
```bash
npm run build
```
This compiles the application using the project `tsconfig.json` into `./dist`.

### Production Execution
Run the compiled output with zero dev dependencies:
```bash
NODE_ENV=production npm start
```
Or directly:
```bash
NODE_ENV=production node dist/server.js
```

---

## 4. Recommended Deployment Profiles

### Profile A: Safe Public-Demo (Recommended for Hackathon Judges)
This profile provides live, on-chain Monad testnet execution while allowing judges to test without setting up hardware passkeys, with strict financial caps to protect testnet faucet funds.

```ini
NODE_ENV=production
PORT=3000
FRONTEND_ORIGIN=https://tapremit.vercel.app,http://localhost:3001
JWT_SECRET=production_secret_key_minimum_32_characters_long_for_hackathon
JWT_EXPIRY=2h

# Adapters
MOCK_AUTH=true                 # Enables 1-click judge evaluation
MOCK_CHAIN=false                # Real Monad testnet block & chain verification
MOCK_PAYMENT_EXECUTOR=false     # Real Monad testnet relayer settlement
MOCK_LLM=true                   # Deterministic fast NL parser

# Relayer
RELAYER_ADDRESS=0x...
RELAYER_PRIVATE_KEY=0x...

# Safe Lowered Caps (protects faucet balance)
PER_TX_LIMIT_MON=0.05
DAILY_LIMIT_MON=0.2
GLOBAL_DAILY_LIMIT_MON=1.0
MAX_TESTNET_TRANSFER_MON=0.1
PAUSE_REAL_TRANSFERS=false

# Auto-seed demo accounts
SEED_ON_BOOT=true
SEED_ALICE_WALLET=0x1111111111111111111111111111111111111111
SEED_RIYA_WALLET=0x2222222222222222222222222222222222222222
SEED_BOB_WALLET=0x3333333333333333333333333333333333333333
SEED_CHARLIE_WALLET=0x4444444444444444444444444444444444444444
```

### Profile B: Full Mock Demo (Zero-Dependency Staging)
Runs entirely in memory with no RPC or relayer keys required.

```ini
NODE_ENV=production
MOCK_AUTH=true
MOCK_CHAIN=true
MOCK_PAYMENT_EXECUTOR=true
MOCK_LLM=true
SEED_ON_BOOT=true
```

---

## 5. Emergency Procedures: Pausing Real Transfers

If the relayer balance is depleted, network congestion occurs, or an anomaly is detected, pause real transfers immediately:

1. Update the environment:
   ```ini
   PAUSE_REAL_TRANSFERS=true
   ```
2. Restart the backend process:
   ```bash
   pm2 restart tapremit-backend
   # or docker restart tapremit-backend
   ```
3. **Behavior while paused**:
   - `GET /system/status` reports `"pauseRealTransfers": true`.
   - Any attempt to approve a proposal immediately reverts to `awaiting_approval` and returns `503 Service Unavailable`.
   - **No transaction is signed, no nonce is consumed, and no funds are spent.**
   - Once unpaused (`PAUSE_REAL_TRANSFERS=false`), pending proposals can be approved normally.

---

## 6. Post-Deploy Smoke-Test Checklist

Run these quick checks against the deployed backend URL to verify operational health:

- [ ] **1. Health Check & Adapter Verification**:
  ```powershell
  curl.exe -s https://api.tapremit.xyz/health
  ```
  *Expected*: HTTP 200 with `"status": "ok"` and expected adapter modes.
- [ ] **2. Live Monad Testnet Connectivity**:
  ```powershell
  curl.exe -s https://api.tapremit.xyz/chain/status
  ```
  *Expected*: HTTP 200 with `"chainId": 10143` and advancing `blockNumber`.
- [ ] **3. Security Headers Check**:
  ```powershell
  curl.exe -s -I https://api.tapremit.xyz/health
  ```
  *Expected*: Response includes `X-Content-Type-Options: nosniff`, `Strict-Transport-Security`, and Helmet protection headers.
- [ ] **4. CORS Policy Check**:
  ```powershell
  curl.exe -s -H "Origin: https://evil-site.com" https://api.tapremit.xyz/health
  ```
  *Expected*: Origin is rejected or CORS headers omitted for disallowed origins.
- [ ] **5. Demo Account Login**:
  ```powershell
  curl.exe -s -X POST https://api.tapremit.xyz/auth/login/finish `
    -H "Content-Type: application/json" `
    -d '{\"handle\":\"alice_agent\",\"response\":{\"mock\":true}}'
  ```
  *Expected*: HTTP 200 with JWT `token`.
- [ ] **6. Profile Retrieval**:
  ```powershell
  curl.exe -s https://api.tapremit.xyz/auth/me `
    -H "Authorization: Bearer <TOKEN>"
  ```
  *Expected*: HTTP 200 returning `@alice_agent` details.
- [ ] **7. Recipient Lookup**:
  ```powershell
  curl.exe -s -X POST https://api.tapremit.xyz/users/lookup `
    -H "Authorization: Bearer <TOKEN>" `
    -H "Content-Type: application/json" `
    -d '{\"handle\":\"riya\"}'
  ```
  *Expected*: HTTP 200 with `handle` and `display_name` only.
- [ ] **8. Payment Proposal Generation**:
  ```powershell
  curl.exe -s -X POST https://api.tapremit.xyz/agent/propose `
    -H "Authorization: Bearer <TOKEN>" `
    -H "Content-Type: application/json" `
    -d '{\"instruction\":\"Send 0.01 MON to @riya for wireframes\"}'
  ```
  *Expected*: HTTP 200 with `type: "PROPOSAL"` and status `awaiting_approval`.
