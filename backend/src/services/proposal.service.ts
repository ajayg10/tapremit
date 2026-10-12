import crypto from 'crypto';
import { proposalsRepo, Proposal, ProposalStatus } from '../db/proposals.repository';
import { auditRepo } from '../db/audit.repository';
import { PaymentExecutor } from '../adapters/payment/PaymentExecutor';
import { MockPaymentExecutor } from '../adapters/payment/MockPaymentExecutor';
import { env } from '../config/env';

export function computeCanonicalProposalHash(data: {
  id: string;
  user_id: string;
  recipient_id: string;
  recipient_handle: string;
  amount: string;
  asset: string;
  purpose: string | null;
  created_at: string;
}): string {
  // Deterministic JSON string of the exact financial fields
  const canonicalString = JSON.stringify({
    id: data.id,
    user_id: data.user_id,
    recipient_id: data.recipient_id,
    recipient_handle: data.recipient_handle.toLowerCase(),
    amount: data.amount,
    asset: data.asset,
    purpose: data.purpose || null,
    created_at: data.created_at,
  });

  return crypto.createHash('sha256').update(canonicalString).digest('hex');
}

export class ProposalService {
  private paymentExecutor: PaymentExecutor;

  constructor(executor?: PaymentExecutor) {
    this.paymentExecutor = executor || (env.MOCK_PAYMENT_EXECUTOR ? new MockPaymentExecutor() : new MockPaymentExecutor());
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

    // Check expiry dynamically
    if (proposal.status === 'awaiting_approval' && new Date(proposal.expires_at) <= new Date()) {
      proposalsRepo.updateStatus(proposal.id, ['awaiting_approval'], 'expired');
      auditRepo.log({
        proposal_id: proposal.id,
        actor_type: 'system',
        action: 'expired',
        proposal_hash: proposal.proposal_hash,
        details: { reason: 'Proposal TTL expired before approval' },
      });
      return proposalsRepo.getById(id)!;
    }

    return proposal;
  }

  async approveProposal(id: string, requestingUserId: string, clientProvidedHash?: string): Promise<{ proposal: Proposal; receipt: any }> {
    const proposal = this.getProposal(id, requestingUserId);

    // Enforce terminal and state machine checks
    if (proposal.status === 'expired') {
      throw { status: 400, message: 'Cannot approve expired proposal' };
    }
    if (proposal.status === 'rejected') {
      throw { status: 400, message: 'Cannot approve rejected proposal' };
    }
    if (proposal.status !== 'awaiting_approval') {
      throw { status: 400, message: `Invalid state transition: Cannot approve proposal in '${proposal.status}' status` };
    }

    // Verify expiry timestamp
    if (new Date(proposal.expires_at) <= new Date()) {
      proposalsRepo.updateStatus(proposal.id, ['awaiting_approval'], 'expired');
      auditRepo.log({
        proposal_id: proposal.id,
        actor_type: 'system',
        action: 'expired',
        proposal_hash: proposal.proposal_hash,
        details: { reason: 'Proposal TTL expired during approval attempt' },
      });
      throw { status: 400, message: 'Cannot approve expired proposal' };
    }

    // Verify integrity hash (Tamper Detection)
    const expectedHash = computeCanonicalProposalHash({
      id: proposal.id,
      user_id: proposal.user_id,
      recipient_id: proposal.recipient_id,
      recipient_handle: proposal.recipient_handle,
      amount: proposal.amount,
      asset: proposal.asset,
      purpose: proposal.purpose,
      created_at: proposal.created_at,
    });

    if (clientProvidedHash && clientProvidedHash !== proposal.proposal_hash) {
      throw { status: 400, message: 'Proposal hash mismatch: Client reviewed a different version of the proposal' };
    }

    if (proposal.proposal_hash !== expectedHash) {
      throw { status: 400, message: 'Proposal integrity check failed: Content was modified after creation' };
    }

    // Check policy decision was not DENY
    if (proposal.policy_decision === 'DENY') {
      throw { status: 400, message: 'Cannot approve proposal that was denied by policy engine' };
    }

    // State transition: awaiting_approval -> approved
    const approvedSuccess = proposalsRepo.updateStatus(proposal.id, ['awaiting_approval'], 'approved');
    if (!approvedSuccess) {
      throw { status: 409, message: 'Proposal state conflict: Already processed or status changed' };
    }

    auditRepo.log({
      proposal_id: proposal.id,
      actor_type: 'user',
      actor_id: requestingUserId,
      action: 'approved',
      proposal_hash: proposal.proposal_hash,
      details: {
        approval_method: 'explicit_human_confirmation',
        amount: proposal.display_amount,
        asset: proposal.asset,
        recipient_handle: proposal.recipient_handle,
      },
    });

    // State transition: approved -> submitted
    proposalsRepo.updateStatus(proposal.id, ['approved'], 'submitted');
    auditRepo.log({
      proposal_id: proposal.id,
      actor_type: 'system',
      action: 'execution_submitted',
      proposal_hash: proposal.proposal_hash,
      details: { executor: this.paymentExecutor.name },
    });

    // Run execution adapter
    try {
      const receipt = await this.paymentExecutor.executePayment(proposal);

      const finalStatus: ProposalStatus = receipt.status === 'simulated_confirmed' ? 'simulated_confirmed' : 'confirmed';
      proposalsRepo.updateStatus(proposal.id, ['submitted'], finalStatus, {
        execution_tx_hash: receipt.txHash,
      });

      auditRepo.log({
        proposal_id: proposal.id,
        actor_type: 'system',
        action: receipt.isSimulated ? 'execution_simulated_confirmed' : 'execution_confirmed',
        proposal_hash: proposal.proposal_hash,
        details: {
          tx_hash: receipt.txHash,
          network: receipt.network,
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
        proposal_id: proposal.id,
        actor_type: 'system',
        action: 'execution_failed',
        proposal_hash: proposal.proposal_hash,
        details: { error: err.message },
      });

      throw { status: 502, message: 'Execution failed: ' + err.message };
    }
  }

  rejectProposal(id: string, requestingUserId: string, reason?: string): Proposal {
    const proposal = this.getProposal(id, requestingUserId);

    if (proposal.status !== 'awaiting_approval') {
      throw { status: 400, message: `Cannot reject proposal in '${proposal.status}' status` };
    }

    const updated = proposalsRepo.updateStatus(proposal.id, ['awaiting_approval'], 'rejected');
    if (!updated) {
      throw { status: 409, message: 'Proposal state conflict: Already processed or status changed' };
    }

    auditRepo.log({
      proposal_id: proposal.id,
      actor_type: 'user',
      actor_id: requestingUserId,
      action: 'rejected',
      proposal_hash: proposal.proposal_hash,
      details: { rejection_reason: reason || 'Rejected by user' },
    });

    return proposalsRepo.getById(id)!;
  }
}

export const proposalService = new ProposalService();
