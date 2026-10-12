import { auditRepo, AuditLog } from '../db/audit.repository';
import { proposalsRepo } from '../db/proposals.repository';

export interface TimelineEvent {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  humanDescription: string;
  isSimulated: boolean;
  metadata?: any;
}

export const auditService = {
  getTimeline: (proposalId: string, requestingUserId: string): { timeline: TimelineEvent[]; proposal: any } => {
    const proposal = proposalsRepo.getById(proposalId);
    if (!proposal) {
      throw { status: 404, message: 'Proposal not found' };
    }

    if (proposal.user_id !== requestingUserId && proposal.recipient_id !== requestingUserId) {
      throw { status: 403, message: 'Forbidden: You do not have access to this proposal audit timeline' };
    }

    const logs = auditRepo.getByProposalId(proposalId);
    const timeline: TimelineEvent[] = logs.map((log: AuditLog) => {
      let parsedDetails: any = null;
      try {
        if (log.details) parsedDetails = JSON.parse(log.details);
      } catch {}

      let description = '';
      let isSimulated = false;

      switch (log.action) {
        case 'instruction_received':
          description = `User submitted payment instruction.`;
          break;
        case 'proposal_created':
          description = `AI agent proposed payment of ${proposal.display_amount} ${proposal.asset} to @${proposal.recipient_handle}.`;
          break;
        case 'policy_evaluated':
          const decision = parsedDetails?.decision || proposal.policy_decision;
          description = `Policy engine evaluated rules: ${decision}. Explicit human authorization required.`;
          break;
        case 'approved':
          description = `Human user reviewed and approved proposal. Integrity hash validated.`;
          break;
        case 'rejected':
          description = `Proposal was rejected. Reason: ${parsedDetails?.rejection_reason || 'Rejected by user'}.`;
          break;
        case 'expired':
          description = `Proposal expired before approval and was cancelled.`;
          break;
        case 'execution_submitted':
          description = `Payment execution submitted to ${parsedDetails?.executor || 'settlement engine'}.`;
          break;
        case 'execution_simulated_confirmed':
          isSimulated = true;
          description = `[SIMULATED] Mock payment executor simulated testnet confirmation. Tx: ${parsedDetails?.tx_hash || 'N/A'}`;
          break;
        case 'execution_confirmed':
          description = `On-chain transaction confirmed on ${parsedDetails?.network || 'Monad Testnet'}. Tx: ${parsedDetails?.tx_hash}`;
          break;
        case 'execution_failed':
          description = `Execution failed: ${parsedDetails?.error || 'Unknown error'}`;
          break;
        default:
          description = `${log.action} performed by ${log.actor_type}.`;
      }

      return {
        id: log.id,
        timestamp: log.created_at,
        actor: log.actor_type,
        action: log.action,
        humanDescription: description,
        isSimulated,
        metadata: parsedDetails,
      };
    });

    return {
      proposal: {
        id: proposal.id,
        status: proposal.status,
        recipient_handle: proposal.recipient_handle,
        amount: proposal.display_amount,
        asset: proposal.asset,
        network: proposal.network,
        proposal_hash: proposal.proposal_hash,
        policy_decision: proposal.policy_decision,
        policy_reasons: JSON.parse(proposal.policy_reasons || '[]'),
        created_at: proposal.created_at,
        expires_at: proposal.expires_at,
        execution_tx_hash: proposal.execution_tx_hash,
      },
      timeline,
    };
  },
};
