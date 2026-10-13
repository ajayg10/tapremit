# TapRemit — 2-Minute Demo Script for Hackathon Video 🎬

Follow this script step-by-step for a crisp, convincing 2-minute demo video.

---

### Step 0: Setup Before Hitting Record
1. Ensure both backend and frontend servers are running:
   - Backend: `http://localhost:3000`
   - Frontend: `http://localhost:3001`
2. Open **[http://localhost:3001](http://localhost:3001)** in Chrome/Brave.
3. Open MonadScan in a second tab: `https://testnet.monadscan.com`

---

### Part 1: The Hook & Problem Statement (0:00 – 0:25)
- **What to show**: Landing page / Sign In screen (`localhost:3001`).
- **What to say**:
  > *"Hi judges, welcome to TapRemit. Autonomous AI agents are starting to manage our digital lives—from paying contractors to booking flights and sending remittances. But giving an AI agent direct, unconstrained access to a private key is a financial nightmare: prompt injection, hallucinated wallet addresses, and accidental double-spends.*
  >
  > *TapRemit solves this on Monad testnet with a zero-trust cryptographic human-in-the-loop payment pipeline."*

---

### Part 2: Persona Sign-In & Natural Language Prompt (0:25 – 0:50)
- **What to show**:
  1. Click **Sign In as @alice_agent**.
  2. Point out the header badges: `Monad Testnet (10143) [Live]` and `Asset: MON`.
  3. In the Payment Instruction Box, enter:
     `send 0.05 MON to @riya for dinner`
  4. Click **Propose Payment**.
- **What to say**:
  > *"We sign in as Alice. Alice interacts with an AI agent using natural English. Notice the live network badge showing Monad Testnet Chain ID 10143. When we submit the prompt, the agent generates a proposal—but crucially, it cannot execute it directly."*

---

### Part 3: Safety Guardrails & Cryptographic Binding (0:50 – 1:20)
- **What to show**:
  1. Show the **Review Payment Proposal** screen.
  2. Scroll down through the **Policy Evaluation Card** (Asset Whitelist, Per-Tx limit of 0.1 MON, Rolling 24h limit, Global Relayer limit).
  3. Point out the **Cryptographic Proposal Hash (SHA-256)**:
     `f68ee...`
  4. Point out the recipient wallet address and 1-click copy button.
- **What to say**:
  > *"Before execution, TapRemit runs a 4-layer defense. First, our Deterministic Policy Engine validates safety bounds: per-transaction caps, 24-hour spending velocity, and contact whitelists.*
  >
  > *Second, we compute a canonical SHA-256 hash that binds the exact amount, recipient wallet, asset, and expiration. If an attacker modifies even a single parameter in transit, approval is rejected instantly."*

---

### Part 4: Monad Consensus Finality & Live Explorer Proof (1:20 – 1:45)
- **What to show**:
  1. Click **Approve & Sign Hash (0.05 MON)**.
  2. Watch the live status progression:
     - `SUBMITTED (BROADCAST ACCEPTED)`
     - `INCLUDED (AWAITING FINALITY)`
     - `MONAD FINALIZED` (Green badge).
  3. Click **View on Explorer** and show the transaction confirmed on MonadScan!
  4. Scroll down to show the **Full Audit Timeline & Provenance** hash chain.
- **What to say**:
  > *"When Alice approves, our Monad Executor takes over. It signs locally with atomic write-ahead persistence and monotonic nonce protection.*
  >
  > *Because Monad uses speculative pipelined execution, seeing a receipt in a proposed block isn't enough. TapRemit re-fetches receipts and only marks the payment confirmed when receipt blockHash matches consensus finality.*
  >
  > *Here is the live transaction on MonadScan, and here is the immutable, trigger-enforced hash chain documenting every state transition."*

---

### Part 5: Two-Way History & Closing (1:45 – 2:05)
- **What to show**:
  1. Click Sign Out, then sign in as `@riya`.
  2. Point to the recent transactions list showing the 0.05 MON received from `@alice_agent`.
- **What to say**:
  > *"Finally, when Riya signs into her dashboard, the payment is immediately reflected in her remittance history.*
  >
  > *TapRemit brings trust, auditability, and institutional-grade safety to AI payments on Monad. Thank you!"*
