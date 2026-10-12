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
  created_at: string;
}

function sanitizeDetails(details?: Record<string, any>): string | null {
  if (!details) return null;
  const clone = JSON.parse(JSON.stringify(details));

  const sanitizeObj = (obj: any) => {
    if (!obj || typeof obj !== 'object') return;
    for (const key of Object.keys(obj)) {
      const lower = key.toLowerCase();
      if (
        lower.includes('phone') ||
        lower.includes('token') ||
        lower.includes('jwt') ||
        lower.includes('secret') ||
        lower.includes('credential') ||
        lower.includes('password') ||
        lower.includes('auth') ||
        lower.includes('private')
      ) {
        obj[key] = '[REDACTED]';
      } else if (typeof obj[key] === 'object') {
        sanitizeObj(obj[key]);
      }
    }
  };

  sanitizeObj(clone);
  return JSON.stringify(clone);
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
    const sanitizedDetails = sanitizeDetails(entry.details);

    const stmt = db.prepare(`
      INSERT INTO audit_logs (id, proposal_id, actor_type, actor_id, action, proposal_hash, details)
      VALUES (@id, @proposal_id, @actor_type, @actor_id, @action, @proposal_hash, @details)
    `);

    stmt.run({
      id,
      proposal_id: entry.proposal_id,
      actor_type: entry.actor_type,
      actor_id: entry.actor_id || null,
      action: entry.action,
      proposal_hash: entry.proposal_hash || null,
      details: sanitizedDetails,
    });

    return db.prepare('SELECT * FROM audit_logs WHERE id = ?').get(id) as AuditLog;
  },

  getByProposalId: (proposalId: string): AuditLog[] => {
    return db.prepare('SELECT * FROM audit_logs WHERE proposal_id = ? ORDER BY created_at ASC').all(proposalId) as AuditLog[];
  },
};
