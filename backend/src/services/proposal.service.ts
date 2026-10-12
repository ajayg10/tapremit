import crypto from 'crypto';
import { db } from '../db/db';
import { proposalsRepo, Proposal, ProposalStatus } from '../db/proposals.repository';
import { auditRepo } from '../db/audit.repository';
import { policyService } from './policy.service';
import { PaymentExecutor } from '../adapters/payment/PaymentExecutor';
import { MockPaymentExecutor } from '../adapters/payment/MockPaymentExecutor';
import { env } from '../config/env';

// ---------------------------------------------------------------------------
// Canonical proposal hash — covers every financial and metadata field that
// must not change after creation. origin, network, and expires_at are included
// so a replay with a different expiry or on a different network is detectable.
// ---------------------------------------------------------------------------
export function computeCanonicalProposalHash(data: {
  id: string;
  user_id: string;
  recipient_id: string;
  recipient_handle: string;
  amount: string;       // base-unit integer string
  asset: string;
  network: string;
  origin: string;
  purpose: string | null;
  expires_at: string;
  created_at: string;
}): string {
  const canonicalString = JSON.stringify({
    id:               data.id,
    user_id:          data.user_id,
    recipient_id:     data.recipient_id,
    recipient_handle: data.recipient_handle.toLowerCase(),
    amount:           data.amount,
    asset:            data.asset,
    network:          data.network,
    origin:           data.origin,
    purpose:          data.purpose || null,
    expires_at:       data.expires_at,
    created_at:       data.created_at,
  });

  return crypto.createHash('sha256').update(canonicalString).digest('hex');
}

export class ProposalService {
  private paymentExecutor: PaymentExecutor;

  constructor(executor?: PaymentExecutor) {
    this.paymentExecutor = executor || new MockPaymentExecutor();
  }

  setPaymentExecutor(executor: PaymentExecutor) {
    this.paymentExecutor = executor;
  }

  getExecutor(): PaymentExecutor {
    return this.paymentExecutor;
  }

  getProposal(id: string, requestingUserId: string): Proposal {
    const proposal = proposalsRepo.getById(id);
    if (!proposal) {
      throw { status: 404, message: 'Proposal not found' };
    }

    // IDOR protection: User A cannot view User B's proposal
    if (proposal.user_id !== requestingUserId) {
      throw { status: 403, message: 'Forbidden: You do not have access to this proposal' };
    }

    // Enforce expiry at read time (server-side, lazy sweep)
    if (proposal.status === 'awaiting_approval' && new Date(proposal.expires_at) <= new Date()) {
      proposalsRepo.updateStatus(proposal.id, ['awaiting_approval'], 'expired');
      auditRepo.log({
        proposal_id: proposal.id,
        actor_type:  'system',
        action:      'expired',
        proposal_hash: proposal.proposal_hash,
        details: { reason: 'Proposal TTL expired before approval' },
      });
      return proposalsRepo.getById(id)!;
    }

    return proposal;
  }

  async approveProposal(
    id: string,
    requestingUserId: string,
    clientProvidedHash?: string
  ): Promise<{ proposal: Proposal; receipt: any }> {
    // -----------------------------------------------------------------------
    // Pre-flight checks (outside the transaction — stateless verifications)
    // -----------------------------------------------------------------------
    const proposal = this.getProposal(id, requestingUserId);

    if (proposal.status === 'denied') {
      throw { status: 400, message: 'Cannot approve denied proposal' };
    }
    if (proposal.status === 'rejected') {
      throw { status: 400, message: 'Cannot approve rejected proposal' };
    }
    if (proposal.status !== 'awaiting_approval') {
      throw { status: 400, message: `Invalid state transition: Cannot approve proposal in '${proposal.status}' status` };
    }

    // Expiry re-check (redundant with getProposal, but also guards against the
    // small window between getProposal and the DB transaction below)
    if (new Date(proposal.expires_at) <= new Date()) {
      proposalsRepo.updateStatus(proposal.id, ['awaiting_approval'], 'expired');
      auditRepo.log({
        proposal_id: proposal.id,
        actor_type:  'system',
        action:      'expired',
        proposal_hash: proposal.proposal_hash,
        details: { reason: 'Proposal TTL expired during approval attempt' },
      });
      throw { status: 400, message: 'Cannot approve expired proposal' };
    }

    // Integrity check: recompute the canonical hash from stored fields
    const expectedHash = computeCanonicalProposalHash({
      id:               proposal.id,
      user_id:          proposal.user_id,
      recipient_id:     proposal.recipient_id,
      recipient_handle: proposal.recipient_handle,
      amount:           proposal.amount,
      asset:            proposal.asset,
      network:          proposal.network,
      origin:           proposal.origin,
      purpose:          proposal.purpose,
      expires_at:       proposal.expires_at,
      created_at:       proposal.created_at,
    });

    if (clientProvidedHash && clientProvidedHash !== proposal.proposal_hash) {
      throw { status: 400, message: 'Proposal hash mismatch: Client reviewed a different version of the proposal' };
    }
    if (proposal.proposal_hash !== expectedHash) {
      throw { status: 400, message: 'Proposal integrity check failed: Content was modified after creation' };
    }

    // -----------------------------------------------------------------------
    // Atomic DB transaction: policy re-run + compare-and-swap state flip
    //
    // All calls here are synchronous (better-sqlite3 + sync policy engine).
    // The payment executor runs AFTER the transaction commits.
    // -----------------------------------------------------------------------
    type TxOutcome = { kind: 'approved' } | { kind: 'conflict' } | { kind: 'denied'; denyReason: string };

    const txOutcome = db.transaction((): TxOutcome => {
      // Re-run the full policy engine against current DB state. This catches
      // the case where several pending proposals were created simultaneously
      // and approving them one by one would cumulatively exceed the daily limit.
      const recheck = policyService.evaluate({
        userId:           proposal.user_id,
        recipientId:      proposal.recipient_id,
        amountBaseUnits:  BigInt(proposal.amount),
        displayAmount:    Number(proposal.display_amount),
        asset:            proposal.asset,
        origin:           proposal.origin as 'user' | 'agent',
        expiresAt:        proposal.expires_at,
      });

      if (recheck.decision === 'DENY') {
        const denyRule = recheck.reasons.find(r => r.decision === 'DENY');
        // CAS: transition to denied so it can never be retried
        proposalsRepo.updateStatus(proposal.id, ['awaiting_approval'], 'denied');
        auditRepo.log({
          proposal_id:    proposal.id,
          actor_type:     'policy_engine',
          action:         'policy_recheck_denied',
          proposal_hash:  proposal.proposal_hash,
          details: {
            decision: 'DENY',
            rule:     denyRule?.rule ?? 'unknown',
            reason:   denyRule?.reason ?? 'Policy re-check failed at approval time',
          },
        });
        return { kind: 'denied', denyReason: denyRule?.reason ?? 'Policy re-check denied the proposal' };
      }

      // CAS: awaiting_approval → approved (exactly one row must change)
      const flipped = proposalsRepo.updateStatus(proposal.id, ['awaiting_approval'], 'approved');
      if (!flipped) {
        return { kind: 'conflict' };
      }

      auditRepo.log({
        proposal_id:    proposal.id,
        actor_type:     'user',
        actor_id:       requestingUserId,
        action:         'approved',
        proposal_hash:  proposal.proposal_hash,
        details: {
          approval_method:   'explicit_human_confirmation',
          amount:            proposal.display_amount,
          asset:             proposal.asset,
          recipient_handle:  proposal.recipient_handle,
        },
      });

      // approved → submitted
      proposalsRepo.updateStatus(proposal.id, ['approved'], 'submitted');
      auditRepo.log({
        proposal_id:    proposal.id,
        actor_type:     'system',
        action:         'execution_submitted',
        proposal_hash:  proposal.proposal_hash,
        details: { executor: this.paymentExecutor.name },
      });

      return { kind: 'approved' };
    })();

    if (txOutcome.kind === 'denied') {
      throw { status: 400, message: `Proposal denied by policy re-check: ${txOutcome.denyReason}` };
    }
    if (txOutcome.kind === 'conflict') {
      throw { status: 409, message: 'Proposal state conflict: Already processed or status changed' };
    }

    // -----------------------------------------------------------------------
    // Payment execution (async, outside the DB transaction)
    // -----------------------------------------------------------------------
    try {
      const receipt = await this.paymentExecutor.executePayment(proposal);
      const finalStatus: ProposalStatus =
        receipt.status === 'simulated_confirmed' ? 'simulated_confirmed' : 'confirmed';

      proposalsRepo.updateStatus(proposal.id, ['submitted'], finalStatus, {
        execution_tx_hash: receipt.txHash,
      });

      auditRepo.log({
        proposal_id:    proposal.id,
        actor_type:     'system',
        action:         receipt.isSimulated ? 'execution_simulated_confirmed' : 'execution_confirmed',
        proposal_hash:  proposal.proposal_hash,
        details: {
          tx_hash:      receipt.txHash,
          network:      receipt.network,
          is_simulated: receipt.isSimulated,
        },
      });

      return {
        proposal: proposalsRepo.getById(proposal.id)!,
        receipt,
      };
    } catch (err: any) {
      proposalsRepo.updateStatus(proposal.id, ['submitted'], 'failed', {
        execution_error: err.message,
      });
      auditRepo.log({
        proposal_id:    proposal.id,
        actor_type:     'system',
        action:         'execution_failed',
        proposal_hash:  proposal.proposal_hash,
        details: { error: err.message },
      });
      throw { status: 502, message: 'Execution failed: ' + err.message };
    }
  }

  rejectProposal(id: string, requestingUserId: string, reason?: string): Proposal {
    const proposal = this.getProposal(id, requestingUserId);

    if (proposal.status === 'denied') {
      throw { status: 400, message: `Cannot reject proposal in 'denied' status` };
    }
    if (proposal.status !== 'awaiting_approval') {
      throw { status: 400, message: `Cannot reject proposal in '${proposal.status}' status` };
    }

    const updated = proposalsRepo.updateStatus(proposal.id, ['awaiting_approval'], 'rejected');
    if (!updated) {
      throw { status: 409, message: 'Proposal state conflict: Already processed or status changed' };
    }

    auditRepo.log({
      proposal_id:    proposal.id,
      actor_type:     'user',
      actor_id:       requestingUserId,
      action:         'rejected',
      proposal_hash:  proposal.proposal_hash,
      details: { rejection_reason: reason || 'Rejected by user' },
    });

    return proposalsRepo.getById(id)!;
  }
}

export const proposalService = new ProposalService();
