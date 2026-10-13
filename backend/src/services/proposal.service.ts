import crypto from 'crypto';
import { db } from '../db/db';
import { proposalsRepo, Proposal, ProposalStatus } from '../db/proposals.repository';
import { auditRepo } from '../db/audit.repository';
import { policyService } from './policy.service';
import { PaymentExecutor } from '../adapters/payment/PaymentExecutor';
import { MockPaymentExecutor } from '../adapters/payment/MockPaymentExecutor';
import { MonadPaymentExecutor } from '../adapters/payment/MonadPaymentExecutor';
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
  recipient_wallet?: string | null;
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
    recipient_wallet: data.recipient_wallet ? data.recipient_wallet.toLowerCase() : null,
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
    if (executor) {
      this.paymentExecutor = executor;
    } else {
      this.paymentExecutor = env.MOCK_PAYMENT_EXECUTOR
        ? new MockPaymentExecutor()
        : new MonadPaymentExecutor();
    }
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

    // Lazy background reconcile: if proposal is submitted, check on-chain status
    if (proposal.status === 'submitted' && this.paymentExecutor.reconcilePayment) {
      this.paymentExecutor.reconcilePayment(proposal).catch(() => {});
    }

    return proposal;
  }

  async approveProposal(
    id: string,
    requestingUserId: string,
    clientProvidedHash?: string,
    confirmNewRecipient?: boolean
  ): Promise<{ proposal: Proposal; receipt: any }> {
    // -----------------------------------------------------------------------
    // Pre-flight checks (outside the transaction — stateless verifications)
    // -----------------------------------------------------------------------
    const proposal = this.getProposal(id, requestingUserId);

    // Confirm new recipient server-side check
    const isKnownRecipient = proposalsRepo.hasTransactedWith(proposal.user_id, proposal.recipient_id);
    if (!isKnownRecipient && !confirmNewRecipient) {
      throw {
        status: 400,
        message: 'First-time recipient transfer requires explicit confirmation (confirm_new_recipient: true)',
      };
    }

    if (proposal.status === 'denied') {
      throw { status: 400, message: 'Cannot approve denied proposal' };
    }
    if (proposal.status === 'rejected') {
      throw { status: 400, message: 'Cannot approve rejected proposal' };
    }
    if (proposal.status !== 'awaiting_approval') {
      throw { status: 400, message: `Invalid state transition: Cannot approve proposal in '${proposal.status}' status` };
    }

    // Execution mode and asset match verification
    const activeMode = this.paymentExecutor.isMock ? 'mock' : 'testnet';
    if (proposal.execution_mode !== activeMode) {
      throw {
        status: 400,
        message: `Proposal execution mode mismatch: proposal mode '${proposal.execution_mode}' does not match active executor mode '${activeMode}'`,
      };
    }
    if (proposal.asset !== this.paymentExecutor.supportedAsset) {
      throw {
        status: 400,
        message: `Proposal asset mismatch: proposal asset '${proposal.asset}' cannot be executed by '${this.paymentExecutor.name}' (supported: '${this.paymentExecutor.supportedAsset}')`,
      };
    }

    // Fail closed: Check stuck transactions if in real testnet mode
    if (activeMode === 'testnet') {
      const stuck = proposalsRepo.getStuckProposals();
      if (stuck.length > 0 && !env.OPERATOR_OVERRIDE_ALLOW_SENDS) {
        throw {
          status: 503,
          message: `Real transfers are blocked: Proposal ${stuck[0].id} is in stuck state '${stuck[0].execution_substate}'. Resolve stuck transactions or set OPERATOR_OVERRIDE_ALLOW_SENDS=true to proceed.`,
        };
      }
    }

    // Expiry re-check
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

    // Integrity check: recompute canonical hash including recipient_wallet
    const expectedHash = computeCanonicalProposalHash({
      id:               proposal.id,
      user_id:          proposal.user_id,
      recipient_id:     proposal.recipient_id,
      recipient_handle: proposal.recipient_handle,
      recipient_wallet: proposal.recipient_wallet,
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
    // -----------------------------------------------------------------------
    type TxOutcome = { kind: 'approved' } | { kind: 'conflict' } | { kind: 'denied'; denyReason: string };

    const txOutcome = db.transaction((): TxOutcome => {
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

      // CAS: awaiting_approval → approved
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

      if (this.paymentExecutor.isMock) {
        // In mock mode, transition approved -> submitted before simulation
        proposalsRepo.updateStatus(proposal.id, ['approved'], 'submitted');
        auditRepo.log({
          proposal_id:    proposal.id,
          actor_type:     'system',
          action:         'execution_submitted',
          proposal_hash:  proposal.proposal_hash,
          details: { executor: this.paymentExecutor.name },
        });
      }

      return { kind: 'approved' };
    })();

    if (txOutcome.kind === 'denied') {
      throw { status: 400, message: `Proposal denied by policy re-check: ${txOutcome.denyReason}` };
    }
    if (txOutcome.kind === 'conflict') {
      throw { status: 409, message: 'Proposal state conflict: Already processed or status changed' };
    }

    // -----------------------------------------------------------------------
    // Payment execution (async, outside DB transaction)
    // -----------------------------------------------------------------------
    const approvedProposal = proposalsRepo.getById(proposal.id)!;
    try {
      const receipt = await this.paymentExecutor.executePayment(approvedProposal);

      if (receipt.status === 'confirmed' || receipt.status === 'simulated_confirmed') {
        const finalStatus: ProposalStatus = receipt.isSimulated ? 'simulated_confirmed' : 'confirmed';
        proposalsRepo.updateStatus(proposal.id, ['submitted'], finalStatus, {
          execution_tx_hash: receipt.txHash,
          execution_substate: null,
        });

        auditRepo.log({
          proposal_id:    proposal.id,
          actor_type:     'system',
          action:         receipt.isSimulated ? 'execution_simulated_confirmed' : 'execution_confirmed',
          proposal_hash:  proposal.proposal_hash,
          details: {
            tx_hash:                receipt.txHash,
            network:                receipt.network,
            is_simulated:           receipt.isSimulated,
            finalized_block_number: receipt.finalizedBlockNumber,
            finalized_block_hash:   receipt.finalizedBlockHash,
            explorer_link:          receipt.explorerLink,
          },
        });
      } else if (receipt.status === 'failed') {
        proposalsRepo.updateStatus(proposal.id, ['submitted'], 'failed', {
          execution_tx_hash: receipt.txHash,
          execution_substate: null,
          execution_error: receipt.details || 'On-chain execution reverted',
        });

        auditRepo.log({
          proposal_id:    proposal.id,
          actor_type:     'system',
          action:         'execution_failed',
          proposal_hash:  proposal.proposal_hash,
          details: {
            tx_hash:                receipt.txHash,
            finalized_block_number: receipt.finalizedBlockNumber,
            finalized_block_hash:   receipt.finalizedBlockHash,
            error:                  receipt.details || 'On-chain execution reverted',
          },
        });
      }

      return {
        proposal: proposalsRepo.getById(proposal.id)!,
        receipt,
      };
    } catch (err: any) {
      const cleanError = (err?.message || 'Execution error')
        .replace(/https?:\/\/[^\s]+/gi, '[REDACTED_URL]')
        .replace(/0x[a-fA-F0-9]{64}/g, '[REDACTED_KEY]');
      const code = err?.code || 'EXECUTION_ERROR';

      const isTemporary =
        code === 'TRANSFERS_PAUSED' ||
        code === 'STUCK_TRANSACTIONS_BLOCK' ||
        code === 'NONCE_AMBIGUOUS_BLOCK' ||
        code === 'INSUFFICIENT_RELAYER_BALANCE';

      if (isTemporary) {
        // Revert to awaiting_approval so it is retryable once operator unpauses or clears stuck nonce / funds
        proposalsRepo.updateStatus(proposal.id, ['submitted', 'approved'], 'awaiting_approval', {
          execution_error: cleanError,
          execution_substate: null,
        });
        auditRepo.log({
          proposal_id: proposal.id,
          actor_type: 'system',
          action: 'execution_paused',
          proposal_hash: proposal.proposal_hash,
          details: { error: cleanError, code },
        });
        throw { status: 503, message: cleanError };
      } else {
        // Terminal failure (contract recipient, cap exceeded, balance insufficient, etc.)
        proposalsRepo.updateStatus(proposal.id, ['submitted', 'approved'], 'failed', {
          execution_error: cleanError,
          execution_substate: null,
        });
        auditRepo.log({
          proposal_id: proposal.id,
          actor_type: 'system',
          action: 'execution_failed',
          proposal_hash: proposal.proposal_hash,
          details: { error: cleanError, code },
        });
        throw { status: err?.status || 400, message: cleanError };
      }
    }
  }

  async reconcileProposal(
    id: string,
    requestingUserId: string
  ): Promise<{ proposal: Proposal; receipt?: any }> {
    const proposal = this.getProposal(id, requestingUserId);
    if (proposal.status !== 'submitted') {
      return { proposal };
    }

    if (!this.paymentExecutor.reconcilePayment) {
      throw { status: 400, message: 'Active executor does not support reconciliation' };
    }

    const receipt = await this.paymentExecutor.reconcilePayment(proposal);
    return {
      proposal: proposalsRepo.getById(id)!,
      receipt,
    };
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
