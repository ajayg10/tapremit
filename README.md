# TapRemit ⚡

> **Trust-First Programmable Payments & Remittance on Monad Testnet**  
> *Monad Metropolis Hackathon — Track: Consumer Products & Payments*

[![Monad Testnet](https://img.shields.io/badge/Monad%20Testnet-Chain%2010143-7C3AED.svg)](https://testnet.monadscan.com)
[![Status](https://img.shields.io/badge/Settlement-Live%20On--Chain-059669.svg)](https://testnet.monadscan.com/tx/0xbd6b5c662e81579ddc7027fefa2b5ef5f65e6bceab32adc4d3cb1152dfcefd92)
[![Tests](https://img.shields.io/badge/Tests-87%20Passed-blue.svg)]()
[![License](https://img.shields.io/badge/License-MIT-gray.svg)]()

---

## 📌 Executive Summary

Autonomous AI agents will soon handle digital commerce, bills, remittances, and peer-to-peer transfers. However, granting autonomous agents direct, unconstrained access to private keys creates catastrophic financial risks: prompt injection, hallucinated recipient addresses, drain attacks, and reorg double-spends.

**TapRemit** is a trust-first payment infrastructure designed specifically for Monad. It introduces a **cryptographic human-in-the-loop authorization pipeline** and a **robust testnet execution engine** that enforces strict safety limits, cryptographic proposal binding, append-only hash chains, and consensus-level Monad finality.

### 🔗 Live On-Chain Settlement Proof
- **Network**: Monad Testnet (Chain ID `10143`)
- **Relayer Address**: [`0x836DF4117d96B860939627B7288a0e5C51fEFD53`](https://testnet.monadscan.com/address/0x836DF4117d96B860939627B7288a0e5C51fEFD53)
- **Verified Finalized Transfer**: [`0xbd6b5c662e81579ddc7027fefa2b5ef5f65e6bceab32adc4d3cb1152dfcefd92`](https://testnet.monadscan.com/tx/0xbd6b5c662e81579ddc7027fefa2b5ef5f65e6bceab32adc4d3cb1152dfcefd92)

---

## 🛡️ The 4-Layer Defense Model

TapRemit operates on a **zero-trust AI architecture**: the AI agent is treated as an untrusted proposal generator. Execution only occurs after passing four rigorous security gates:

```
[ Natural Language Prompt ]
            │
            ▼
┌────────────────────────────────────────────────────────┐
│ 1. Deterministic Safety Policy Engine                   │
│    • Asset Whitelist: MON & AUSD                       │
│    • Per-Tx Limit: 0.1 MON                             │
│    • Rolling 24h User Budget: 1.0 MON                  │
│    • Global Relayer Cap: 2.0 MON                       │
│    • First-Time Recipient Quarantine (Mandatory Human) │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ 2. Cryptographic Proposal Binding (SHA-256)            │
│    • Binds: ID, Sender, Recipient Wallet, Amount,      │
│      Asset, Network, Purpose, TTL                      │
│    • Any parameter mutation invalidates approval       │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ 3. Append-Only Tamper-Evident Hash Chain               │
│    • SHA-256 chained audit trail (prev_hash + entry)   │
│    • Enforced by SQLite DB Triggers (No UPDATE/DELETE) │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ 4. Monad Consensus Finality Engine                     │
│    • Local signing & Write-Ahead submission            │
│    • Mutex-serialized monotonic nonce tracking         │
│    • Re-fetches receipts to detect speculative drops   │
│    • Verifies receipt.blockHash === finalized.hash     │
└────────────────────────────────────────────────────────┘
```

---

## 🏛️ Real vs. Mocked Architecture Matrix

We believe in complete transparency about what runs live on-chain versus what is simulated in this prototype:

| Component | Status | Implementation Details |
| :--- | :---: | :--- |
| **Monad Testnet Settlement** | **100% REAL** | Real native `MON` transfers signed locally via `viem`, broadcast to Monad Testnet RPC, and polled against consensus finality. |
| **Monad Finality Engine** | **100% REAL** | Implements Monad's 4-tier lifecycle (`Proposed -> Voted -> Finalized`). Matches receipt block against `getBlockByNumber('finalized')`. |
| **Write-Ahead Persistence** | **100% REAL** | Locally pre-computes tx hash, stores signed bytes, nonce, and hash in SQLite before mempool broadcast to ensure zero-loss crash recovery. |
| **Fail-Closed Stuck Lock** | **100% REAL** | Blocks concurrent sends if an ambiguous transport error occurs (`broadcasted_unknown`) until on-chain reconciliation. |
| **Deterministic Policy Engine** | **100% REAL** | Strict rules engine evaluating per-tx limits, rolling 24h spending, and first-time recipient confirmations. |
| **Hash-Chained Audit Trail** | **100% REAL** | SQLite triggers `audit_logs_no_update` and `audit_logs_no_delete` enforce cryptographic append-only provenance. |
| **Wallet Immutability** | **100% REAL** | SQLite trigger `users_wallet_address_immutable` prohibits modifying a registered address once set. |
| **AI LLM Extraction** | **MOCK** | Uses `MockLLMAdapter` with deterministic regex parsing to prevent rate limits and model downtime during judge evaluation. |
| **Passkey / WebAuthn** | **MOCK / HYBRID** | `@simplewebauthn` backend adapter exists; UI includes 1-click demo accounts (`@alice_agent`, `@riya`, `@bob_builder`) for frictionless testing. |

---

## 📱 User Experience & Workflow

The TapRemit application provides a polished, mobile-friendly interface:

1. **1-Click Judge Sign-In**: Instant login as seeded personas with real Monad testnet addresses.
2. **Natural English Prompting**: State payment intentions naturally (*"send 0.05 MON to @riya for dinner"*).
3. **Transparent Policy Review**: Live inspection of every safety rule evaluated by the engine.
4. **First-Time Recipient Protection**: When sending to a new contact, the user must explicitly confirm authorization via a dedicated checkbox before signing.
5. **Real-Time Settlement Tracking**: Watch the transaction transition live from `SUBMITTED (BROADCAST ACCEPTED)` $\rightarrow$ `INCLUDED (AWAITING FINALITY)` $\rightarrow$ `MONAD FINALIZED`.
6. **Explorer & Provenance Verification**: Click through directly to MonadScan, inspect block numbers, and audit the cryptographic event chain.
7. **Two-Way History**: Both sender and recipient accounts immediately display sent and received remittance history.

---

## 🛠️ Technology Stack

- **Blockchain**: Monad Testnet (Chain ID `10143`), `viem` v2.57
- **Backend**: Node.js 20 LTS, Express, TypeScript, Better-SQLite3, Zod, Pino Logger
- **Frontend**: Next.js 14 App Router, Tailwind CSS, Lucide Icons
- **Testing**: Vitest, Supertest (87 comprehensive unit & integration tests)

---

## 🚀 Local Quickstart Guide

### 1. Prerequisites
- Node.js 20 LTS (recommended via `fnm` or `nvm`)
- PowerShell (Windows) or Bash (macOS/Linux)

### 2. Backend Setup
```bash
cd backend
npm install

# Copy environment example
cp .env.example .env

# Run database migrations and seed demo accounts
npm run migrate
npm run seed

# Start backend dev server (Port 3000)
npm run dev
```

### 3. Frontend Setup
```bash
cd ../frontend
npm install

# Start frontend Next.js server (Port 3001)
npm run dev
```

Open **[http://localhost:3001](http://localhost:3001)** in your browser.

### 4. Running the Test Suite
The repository includes 87 tests verifying everything from ambiguous RPC network errors to speculative block drops and tamper resistance:

```bash
cd backend
npm test
```

---

## 🎯 Hackathon Checklist & Deliverables

- [x] **Monad Testnet Native Execution**: Real MON transfers executed on chain ID 10143.
- [x] **Speculative Reorg & Finality Handling**: Re-fetching receipt each poll and asserting consensus finality.
- [x] **Crash Recovery**: Write-ahead transaction persistence and startup reconcile sweep.
- [x] **Cryptographic Proposal Binding**: Tamper-proof SHA-256 canonical hash verification.
- [x] **Auditability**: DB trigger-enforced hash chain with full timeline playback.
- [x] **Responsive Mobile Web UI**: Clean dashboard, review screens, and explorer deep links.

---

## 📄 License
MIT © 2026 TapRemit Team
