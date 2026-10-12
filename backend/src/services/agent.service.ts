import { v4 as uuidv4 } from 'uuid';
import { LLMAdapter } from '../adapters/llm/LLMAdapter';
import { MockLLMAdapter } from '../adapters/llm/MockLLMAdapter';
import { usersRepo } from '../db/users.repository';
import { proposalsRepo, Proposal } from '../db/proposals.repository';
import { auditRepo } from '../db/audit.repository';
import { policyService } from './policy.service';
import { computeCanonicalProposalHash } from './proposal.service';
import { env } from '../config/env';

export class AgentService {
  private llmAdapter: LLMAdapter;

  constructor(adapter?: LLMAdapter) {
    this.llmAdapter = adapter || new MockLLMAdapter();
  }

  setLLMAdapter(adapter: LLMAdapter) {
    this.llmAdapter = adapter;
  }

  getAdapter(): LLMAdapter {
    return this.llmAdapter;
  }

  async proposePayment(params: {
    userId: string;
    instruction: string;
    idempotencyKey?: string;
  }): Promise<
    | { type: 'CLARIFICATION'; message: string; provider: string; isMock: boolean }
    | { type: 'PROPOSAL'; proposal: Proposal; provider: string; isMock: boolean }
  > {
    const { userId, instruction, idempotencyKey } = params;

    // 1. Idempotency Check
    if (idempotencyKey) {
      const existing = proposalsRepo.getByIdempotencyKey(idempotencyKey);
      if (existing) {
        if (existing.user_id !== userId) {
          throw { status: 403, message: 'Idempotency key collision' };
        }
        return {
          type: 'PROPOSAL',
          proposal: existing,
          provider: this.llmAdapter.providerName,
          isMock: this.llmAdapter.isMock,
        };
      }
    }

    // 2. Call Isolated LLM Adapter
    let parseResult;
    try {
      parseResult = await this.llmAdapter.parseInstruction(instruction);
    } catch (err: any) {
      if (err?.name === 'ZodError' || err?.issues) {
        throw {
          status: 422,
          message: 'Model output rejected: Output contains invalid or unexpected fields',
        };
      }
      throw err;
    }

    // If clarification needed
    if (parseResult.type === 'CLARIFICATION') {
      return {
        type: 'CLARIFICATION',
        message: parseResult.message,
        provider: this.llmAdapter.providerName,
        isMock: this.llmAdapter.isMock,
      };
    }

    // 3. Server-Side Identity Resolution (Never trust model for account mapping)
    const recipient = usersRepo.getByHandle(parseResult.recipient_handle);
    if (!recipient) {
      throw {
        status: 404,
        message: `Recipient handle '@${parseResult.recipient_handle}' was not found in the TapRemit user registry`,
      };
    }

    if (recipient.id === userId) {
      throw {
        status: 400,
        message: 'Cannot create a payment proposal to yourself',
      };
    }

    // 4. Construct Proposal Structure
    const proposalId = uuidv4();
    const amountBaseUnits = BigInt(parseResult.amount);
    const displayAmountNum = Number(amountBaseUnits) / 1_000_000;
    const displayAmount = displayAmountNum.toString();
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + env.PROPOSAL_TTL_SECONDS * 1000).toISOString();

    const proposalHash = computeCanonicalProposalHash({
      id: proposalId,
      user_id: userId,
      recipient_id: recipient.id,
      recipient_handle: recipient.handle,
      amount: parseResult.amount,
      asset: parseResult.asset,
      purpose: parseResult.purpose || null,
      created_at: createdAt,
    });

    // 5. Evaluate Deterministic Policy Engine (LLM has zero authority)
    const policyResult = policyService.evaluate({
      userId,
      recipientId: recipient.id,
      amountBaseUnits,
      displayAmount: displayAmountNum,
      asset: parseResult.asset,
      origin: 'agent',
      expiresAt,
    });

    // Status assignment
    const status = policyResult.decision === 'DENY' ? 'rejected' : 'awaiting_approval';

    // 6. Save Proposal
    const proposal = proposalsRepo.create({
      id: proposalId,
      user_id: userId,
      origin: 'agent',
      recipient_handle: recipient.handle,
      recipient_id: recipient.id,
      recipient_wallet: recipient.wallet_address,
      amount: parseResult.amount,
      display_amount: displayAmount,
      asset: parseResult.asset,
      network: 'Monad Testnet',
      purpose: parseResult.purpose || null,
      proposal_hash: proposalHash,
      status,
      policy_decision: policyResult.decision,
      policy_reasons: JSON.stringify(policyResult.reasons),
      idempotency_key: idempotencyKey || null,
      expires_at: expiresAt,
      created_at: createdAt,
    });

    // 7. Append Audit Logs
    auditRepo.log({
      proposal_id: proposalId,
      actor_type: 'user',
      actor_id: userId,
      action: 'instruction_received',
      proposal_hash: proposalHash,
      details: {
        instruction_length: instruction.length,
        has_idempotency_key: !!idempotencyKey,
      },
    });

    auditRepo.log({
      proposal_id: proposalId,
      actor_type: 'agent',
      action: 'proposal_created',
      proposal_hash: proposalHash,
      details: {
        provider: this.llmAdapter.providerName,
        recipient_handle: recipient.handle,
        amount: displayAmount,
        asset: parseResult.asset,
      },
    });

    auditRepo.log({
      proposal_id: proposalId,
      actor_type: 'policy_engine',
      action: 'policy_evaluated',
      proposal_hash: proposalHash,
      details: {
        decision: policyResult.decision,
        reasons_count: policyResult.reasons.length,
        outcomes: policyResult.reasons.map(r => ({ rule: r.rule, decision: r.decision })),
      },
    });

    return {
      type: 'PROPOSAL',
      proposal,
      provider: this.llmAdapter.providerName,
      isMock: this.llmAdapter.isMock,
    };
  }
}

export const agentService = new AgentService();
