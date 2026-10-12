import { db } from './db';

export type ProposalStatus =
  | 'proposed'
  | 'policy_checked'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'           // human rejected
  | 'denied'             // policy engine denied (creation or approval-time re-check)
  | 'expired'
  | 'submitted'
  | 'confirmed'
  | 'failed'
  | 'simulated_confirmed';

export interface Proposal {
  id: string;
  user_id: string;
  origin: 'user' | 'agent';
  recipient_handle: string;
  recipient_id: string;
  recipient_wallet: string | null;
  amount: string; // integer base-units string
  display_amount: string;
  asset: string;
  network: string;
  purpose: string | null;
  proposal_hash: string;
  status: ProposalStatus;
  policy_decision: 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';
  policy_reasons: string; // JSON string
  idempotency_key: string | null;
  expires_at: string;
  execution_tx_hash: string | null;
  execution_error: string | null;
  created_at: string;
  updated_at: string;
}

export const proposalsRepo = {
  create: (data: {
    id: string;
    user_id: string;
    origin: 'user' | 'agent';
    recipient_handle: string;
    recipient_id: string;
    recipient_wallet?: string | null;
    amount: string;
    display_amount: string;
    asset: string;
    network: string;
    purpose?: string | null;
    proposal_hash: string;
    status: ProposalStatus;
    policy_decision: 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';
    policy_reasons: string;
    idempotency_key?: string | null;
    expires_at: string;
    created_at?: string;
  }): Proposal => {
    const createdAt = data.created_at || new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO proposals (
        id, user_id, origin, recipient_handle, recipient_id, recipient_wallet,
        amount, display_amount, asset, network, purpose, proposal_hash,
        status, policy_decision, policy_reasons, idempotency_key, expires_at, created_at
      ) VALUES (
        @id, @user_id, @origin, @recipient_handle, @recipient_id, @recipient_wallet,
        @amount, @display_amount, @asset, @network, @purpose, @proposal_hash,
        @status, @policy_decision, @policy_reasons, @idempotency_key, @expires_at, @created_at
      )
    `);

    stmt.run({
      id: data.id,
      user_id: data.user_id,
      origin: data.origin,
      recipient_handle: data.recipient_handle,
      recipient_id: data.recipient_id,
      recipient_wallet: data.recipient_wallet || null,
      amount: data.amount,
      display_amount: data.display_amount,
      asset: data.asset,
      network: data.network,
      purpose: data.purpose || null,
      proposal_hash: data.proposal_hash,
      status: data.status,
      policy_decision: data.policy_decision,
      policy_reasons: data.policy_reasons,
      idempotency_key: data.idempotency_key || null,
      expires_at: data.expires_at,
      created_at: createdAt,
    });

    return proposalsRepo.getById(data.id)!;
  },

  getById: (id: string): Proposal | undefined => {
    return db.prepare('SELECT * FROM proposals WHERE id = ?').get(id) as Proposal | undefined;
  },

  getByIdempotencyKey: (key: string): Proposal | undefined => {
    return db.prepare('SELECT * FROM proposals WHERE idempotency_key = ?').get(key) as Proposal | undefined;
  },

  updateStatus: (
    id: string,
    allowedCurrentStatuses: ProposalStatus[],
    newStatus: ProposalStatus,
    extra?: { execution_tx_hash?: string | null; execution_error?: string | null }
  ): boolean => {
    const placeholders = allowedCurrentStatuses.map(() => '?').join(',');
    const stmt = db.prepare(`
      UPDATE proposals
      SET status = ?,
          execution_tx_hash = COALESCE(?, execution_tx_hash),
          execution_error = COALESCE(?, execution_error),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status IN (${placeholders})
    `);

    const result = stmt.run(
      newStatus,
      extra?.execution_tx_hash || null,
      extra?.execution_error || null,
      id,
      ...allowedCurrentStatuses
    );

    return result.changes > 0;
  },

  getRolling24hTotalAmount: (userId: string): bigint => {
    // Count only settled statuses so multiple pending proposals can coexist;
    // the approval-time policy re-check is the enforcement point for the daily limit.
    const rows = db.prepare(`
      SELECT amount FROM proposals
      WHERE user_id = ?
        AND created_at >= datetime('now', '-24 hours')
        AND status IN ('submitted', 'confirmed', 'simulated_confirmed')
    `).all(userId) as { amount: string }[];

    let total = 0n;
    for (const row of rows) {
      try {
        total += BigInt(row.amount);
      } catch {
        // ignore malformed
      }
    }
    return total;
  },

  hasTransactedWith: (userId: string, recipientId: string): boolean => {
    const row = db.prepare(`
      SELECT id FROM proposals
      WHERE user_id = ?
        AND recipient_id = ?
        AND status IN ('confirmed', 'simulated_confirmed')
      LIMIT 1
    `).get(userId, recipientId);

    return !!row;
  },
};
