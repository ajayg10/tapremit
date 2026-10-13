import crypto from 'crypto';
import { db } from './db';
import { v4 as uuidv4 } from 'uuid';

export type ActorType = 'user' | 'agent' | 'policy_engine' | 'system';

export interface AuditLog {
  id: string;
  proposal_id: string;
  actor_type: ActorType;
  actor_id: string | null;
  action: string;
  proposal_hash: string | null;
  details: string | null;
  prev_hash: string | null;
  entry_hash: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Allowlist: only the keys listed here may appear in stored details for each
// action. Any key not in the list is silently dropped before storage.
// An unknown action stores no details at all.
// ---------------------------------------------------------------------------
const DETAILS_ALLOWLIST: Record<string, readonly string[]> = {
  instruction_received:          ['instruction_length', 'has_idempotency_key'],
  proposal_created:              ['provider', 'recipient_handle', 'amount', 'asset'],
  policy_evaluated:              ['decision', 'reasons_count', 'outcomes'],
  approved:                      ['approval_method', 'amount', 'asset', 'recipient_handle'],
  rejected:                      ['rejection_reason'],
  denied:                        ['reason'],
  expired:                       ['reason'],
  execution_submitted:           ['executor'],
  execution_substate_changed:    ['from_substate', 'to_substate', 'nonce', 'tx_hash', 'details'],
  execution_simulated_confirmed: ['tx_hash', 'network', 'is_simulated'],
  execution_confirmed:           ['tx_hash', 'network', 'is_simulated', 'finalized_block_number', 'finalized_block_hash', 'explorer_link'],
  execution_failed:              ['error', 'code', 'tx_hash', 'finalized_block_number', 'finalized_block_hash'],
  execution_paused:              ['error', 'code'],
  policy_recheck_denied:         ['decision', 'rule', 'reason'],
  reconcile_sweep:               ['substate', 'details', 'tx_hash', 'reason'],
  reconcile_sweep_paused:        ['reason'],
} as const;

function filterDetails(action: string, details?: Record<string, any>): string | null {
  if (!details) return null;
  const allowed = DETAILS_ALLOWLIST[action];
  if (!allowed) return null; // unknown action → store nothing
  const filtered: Record<string, any> = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(details, key)) {
      filtered[key] = details[key];
    }
  }
  return Object.keys(filtered).length > 0 ? JSON.stringify(filtered) : null;
}

// ---------------------------------------------------------------------------
// Each entry has an entry_hash covering all of its own fields (including the
// prev_hash pointer). The next entry stores this as its prev_hash, forming a
// tamper-evident chain.
// ---------------------------------------------------------------------------
function computeEntryHash(fields: {
  id: string;
  proposal_id: string;
  actor_type: string;
  actor_id: string | null;
  action: string;
  proposal_hash: string | null;
  details: string | null;
  prev_hash: string | null;
  created_at: string;
}): string {
  return crypto.createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

export const auditRepo = {
  log: (entry: {
    id?: string;
    proposal_id: string;
    actor_type: ActorType;
    actor_id?: string | null;
    action: string;
    proposal_hash?: string | null;
    details?: Record<string, any>;
  }): AuditLog => {
    const id = entry.id || uuidv4();
    const createdAt = new Date().toISOString(); // set by app so it is known before hash
    const filteredDetails = filterDetails(entry.action, entry.details);

    // Fetch the entry_hash of the most recent prior entry for this proposal to
    // form the chain link. NULL for the first entry.
    // Use rowid so sub-millisecond writes maintain strict insertion order.
    const lastRow = db
      .prepare(
        'SELECT entry_hash FROM audit_logs WHERE proposal_id = ? ORDER BY rowid DESC LIMIT 1'
      )
      .get(entry.proposal_id) as { entry_hash: string | null } | undefined;
    const prevHash = lastRow?.entry_hash ?? null;

    const entryHash = computeEntryHash({
      id,
      proposal_id: entry.proposal_id,
      actor_type: entry.actor_type,
      actor_id: entry.actor_id ?? null,
      action: entry.action,
      proposal_hash: entry.proposal_hash ?? null,
      details: filteredDetails,
      prev_hash: prevHash,
      created_at: createdAt,
    });

    db.prepare(`
      INSERT INTO audit_logs
        (id, proposal_id, actor_type, actor_id, action, proposal_hash, details, prev_hash, entry_hash, created_at)
      VALUES
        (@id, @proposal_id, @actor_type, @actor_id, @action, @proposal_hash, @details, @prev_hash, @entry_hash, @created_at)
    `).run({
      id,
      proposal_id: entry.proposal_id,
      actor_type: entry.actor_type,
      actor_id: entry.actor_id ?? null,
      action: entry.action,
      proposal_hash: entry.proposal_hash ?? null,
      details: filteredDetails,
      prev_hash: prevHash,
      entry_hash: entryHash,
      created_at: createdAt,
    });

    return db.prepare('SELECT * FROM audit_logs WHERE id = ?').get(id) as AuditLog;
  },

  getByProposalId: (proposalId: string): AuditLog[] => {
    return db
      .prepare('SELECT * FROM audit_logs WHERE proposal_id = ? ORDER BY rowid ASC')
      .all(proposalId) as AuditLog[];
  },

  // Walks every entry for a proposal in insertion order and verifies:
  // 1. The entry_hash matches a freshly-computed hash of the row's own fields.
  // 2. Each prev_hash matches the prior entry's entry_hash (null for the first).
  verifyAuditChain: (proposalId: string): { valid: boolean; error?: string } => {
    const entries = db
      .prepare('SELECT * FROM audit_logs WHERE proposal_id = ? ORDER BY rowid ASC')
      .all(proposalId) as AuditLog[];

    let prevHash: string | null = null;
    for (const entry of entries) {
      const expected = computeEntryHash({
        id: entry.id,
        proposal_id: entry.proposal_id,
        actor_type: entry.actor_type,
        actor_id: entry.actor_id,
        action: entry.action,
        proposal_hash: entry.proposal_hash,
        details: entry.details,
        prev_hash: entry.prev_hash,
        created_at: entry.created_at,
      });

      if (entry.entry_hash !== expected) {
        return { valid: false, error: `Entry ${entry.id} has invalid entry_hash (tamper detected)` };
      }
      if (entry.prev_hash !== prevHash) {
        return { valid: false, error: `Entry ${entry.id} has broken chain: prev_hash mismatch` };
      }
      prevHash = entry.entry_hash;
    }
    return { valid: true };
  },
};
