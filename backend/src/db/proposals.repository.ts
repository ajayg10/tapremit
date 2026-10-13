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

export type ProposalExecutionSubstate =
  | 'awaiting_broadcast'
  | 'broadcast_accepted'
  | 'broadcasted_unknown'
  | 'included_pending_finality'
  | 'not_found_needs_review';

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
  execution_mode: 'mock' | 'testnet';
  execution_substate: ProposalExecutionSubstate | null;
  execution_nonce: number | null;
  execution_signed_tx: string | null;
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
    execution_mode?: 'mock' | 'testnet';
    execution_substate?: ProposalExecutionSubstate | null;
    execution_nonce?: number | null;
    execution_signed_tx?: string | null;
    execution_tx_hash?: string | null;
    created_at?: string;
  }): Proposal => {
    const createdAt = data.created_at || new Date().toISOString();
    const executionMode = data.execution_mode || 'mock';
    const stmt = db.prepare(`
      INSERT INTO proposals (
        id, user_id, origin, recipient_handle, recipient_id, recipient_wallet,
        amount, display_amount, asset, network, purpose, proposal_hash,
        status, policy_decision, policy_reasons, idempotency_key, expires_at,
        execution_mode, execution_substate, execution_nonce, execution_signed_tx, execution_tx_hash, created_at
      ) VALUES (
        @id, @user_id, @origin, @recipient_handle, @recipient_id, @recipient_wallet,
        @amount, @display_amount, @asset, @network, @purpose, @proposal_hash,
        @status, @policy_decision, @policy_reasons, @idempotency_key, @expires_at,
        @execution_mode, @execution_substate, @execution_nonce, @execution_signed_tx, @execution_tx_hash, @created_at
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
      execution_mode: executionMode,
      execution_substate: data.execution_substate || null,
      execution_nonce: data.execution_nonce ?? null,
      execution_signed_tx: data.execution_signed_tx || null,
      execution_tx_hash: data.execution_tx_hash || null,
      created_at: createdAt,
    });

    return proposalsRepo.getById(data.id)!;
  },

  getById: (id: string): Proposal | undefined => {
    return db.prepare('SELECT * FROM proposals WHERE id = ?').get(id) as Proposal | undefined;
  },

  listByUserId: (userId: string, limit: number = 20): Proposal[] => {
    return db
      .prepare('SELECT * FROM proposals WHERE user_id = ? OR recipient_id = ? ORDER BY rowid DESC LIMIT ?')
      .all(userId, userId, limit) as Proposal[];
  },

  getByIdempotencyKey: (key: string): Proposal | undefined => {
    return db.prepare('SELECT * FROM proposals WHERE idempotency_key = ?').get(key) as Proposal | undefined;
  },

  updateStatus: (
    id: string,
    allowedCurrentStatuses: ProposalStatus[],
    newStatus: ProposalStatus,
    extra?: {
      execution_tx_hash?: string | null;
      execution_error?: string | null;
      execution_substate?: ProposalExecutionSubstate | null;
      execution_nonce?: number | null;
      execution_signed_tx?: string | null;
    }
  ): boolean => {
    const placeholders = allowedCurrentStatuses.map(() => '?').join(',');
    const hasHash = extra && 'execution_tx_hash' in extra;
    const hasError = extra && 'execution_error' in extra;
    const hasNonce = extra && 'execution_nonce' in extra;
    const hasSignedTx = extra && 'execution_signed_tx' in extra;

    const stmt = db.prepare(`
      UPDATE proposals
      SET status = ?,
          execution_tx_hash = CASE WHEN ? = 1 THEN ? ELSE execution_tx_hash END,
          execution_error = CASE WHEN ? = 1 THEN ? ELSE execution_error END,
          execution_substate = ?,
          execution_nonce = CASE WHEN ? = 1 THEN ? ELSE execution_nonce END,
          execution_signed_tx = CASE WHEN ? = 1 THEN ? ELSE execution_signed_tx END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status IN (${placeholders})
    `);

    const result = stmt.run(
      newStatus,
      hasHash ? 1 : 0,
      extra?.execution_tx_hash ?? null,
      hasError ? 1 : 0,
      extra?.execution_error ?? null,
      extra?.execution_substate !== undefined ? extra.execution_substate : null,
      hasNonce ? 1 : 0,
      extra?.execution_nonce ?? null,
      hasSignedTx ? 1 : 0,
      extra?.execution_signed_tx ?? null,
      id,
      ...allowedCurrentStatuses
    );

    return result.changes > 0;
  },

  updateExecutionSubstate: (
    id: string,
    substate: ProposalExecutionSubstate | null,
    extra?: {
      execution_tx_hash?: string | null;
      execution_error?: string | null;
      execution_nonce?: number | null;
      execution_signed_tx?: string | null;
    }
  ): boolean => {
    const stmt = db.prepare(`
      UPDATE proposals
      SET execution_substate = ?,
          execution_tx_hash = COALESCE(?, execution_tx_hash),
          execution_error = COALESCE(?, execution_error),
          execution_nonce = COALESCE(?, execution_nonce),
          execution_signed_tx = COALESCE(?, execution_signed_tx),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    const result = stmt.run(
      substate,
      extra?.execution_tx_hash || null,
      extra?.execution_error || null,
      extra?.execution_nonce ?? null,
      extra?.execution_signed_tx || null,
      id
    );

    return result.changes > 0;
  },

  writeAheadSubmission: (
    id: string,
    data: {
      status: 'submitted';
      execution_substate: 'awaiting_broadcast';
      execution_tx_hash: string;
      execution_nonce: number;
      execution_signed_tx: string;
    }
  ): boolean => {
    const updatedAt = new Date().toISOString();
    const result = db.prepare(`
      UPDATE proposals
      SET status = @status,
          execution_substate = @execution_substate,
          execution_tx_hash = @execution_tx_hash,
          execution_nonce = @execution_nonce,
          execution_signed_tx = @execution_signed_tx,
          updated_at = @updated_at
      WHERE id = @id AND status = 'approved'
    `).run({
      id,
      status: data.status,
      execution_substate: data.execution_substate,
      execution_tx_hash: data.execution_tx_hash,
      execution_nonce: data.execution_nonce,
      execution_signed_tx: data.execution_signed_tx,
      updated_at: updatedAt,
    });
    return result.changes > 0;
  },

  getHighestExecutionNonce: (): number | null => {
    const row = db
      .prepare('SELECT MAX(execution_nonce) as max_nonce FROM proposals WHERE execution_nonce IS NOT NULL')
      .get() as { max_nonce: number | null } | undefined;
    return row?.max_nonce ?? null;
  },

  getStuckProposals: (): Proposal[] => {
    return db
      .prepare(`
        SELECT * FROM proposals
        WHERE execution_mode = 'testnet'
          AND execution_substate IN ('broadcasted_unknown', 'not_found_needs_review')
      `)
      .all() as Proposal[];
  },

  listUnreconciled: (): Proposal[] => {
    return db
      .prepare(`
        SELECT * FROM proposals
        WHERE execution_mode = 'testnet'
          AND (status = 'submitted' OR execution_substate IN ('awaiting_broadcast', 'broadcast_accepted', 'broadcasted_unknown', 'included_pending_finality', 'not_found_needs_review'))
      `)
      .all() as Proposal[];
  },

  getRolling24hTotalAmount: (userId: string, asset: string = 'AUSD'): bigint => {
    const windowStartIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const rows = db.prepare(`
      SELECT amount FROM proposals
      WHERE user_id = ?
        AND asset = ?
        AND COALESCE(updated_at, created_at) >= ?
        AND status IN ('approved', 'submitted', 'confirmed', 'simulated_confirmed')
    `).all(userId, asset, windowStartIso) as { amount: string }[];

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

  getRolling24hGlobalTotalAmount: (asset: string = 'MON'): bigint => {
    const windowStartIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const rows = db.prepare(`
      SELECT amount FROM proposals
      WHERE asset = ?
        AND COALESCE(updated_at, created_at) >= ?
        AND status IN ('submitted', 'confirmed', 'simulated_confirmed')
    `).all(asset, windowStartIso) as { amount: string }[];

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

export function toPublicProposal(proposal: Proposal) {
  const { execution_signed_tx, ...safeProposal } = proposal;
  let sender_handle: string | undefined;
  try {
    if (proposal.user_id) {
      const sender = db.prepare('SELECT handle FROM users WHERE id = ?').get(proposal.user_id) as { handle: string } | undefined;
      if (sender) {
        sender_handle = sender.handle;
      }
    }
  } catch {
    // fallback gracefully
  }
  return {
    ...safeProposal,
    sender_handle,
    policy_reasons:
      typeof safeProposal.policy_reasons === 'string'
        ? JSON.parse(safeProposal.policy_reasons || '[]')
        : safeProposal.policy_reasons,
  };
}
