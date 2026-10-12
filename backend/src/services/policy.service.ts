import { env } from '../config/env';
import { proposalsRepo } from '../db/proposals.repository';

export interface RuleOutcome {
  rule: string;
  decision: 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';
  reason: string;
  metadata?: Record<string, any>;
}

export interface PolicyEvaluationResult {
  decision: 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';
  reasons: RuleOutcome[];
}

export interface PolicyEvaluationContext {
  userId: string;
  recipientId: string;
  amountBaseUnits: bigint;
  displayAmount: number;
  asset: string;
  origin: 'user' | 'agent';
  expiresAt?: string;
}

export class PolicyService {
  evaluate(context: PolicyEvaluationContext): PolicyEvaluationResult {
    const outcomes: RuleOutcome[] = [];

    // 1. Asset verification
    if (context.asset !== 'AUSD') {
      outcomes.push({
        rule: 'ASSET_WHITELIST',
        decision: 'DENY',
        reason: `Asset '${context.asset}' is not supported. Only AUSD is permitted.`,
      });
    } else {
      outcomes.push({
        rule: 'ASSET_WHITELIST',
        decision: 'ALLOW',
        reason: 'Asset is supported (AUSD).',
      });
    }

    // 2. Amount bounds (positive, non-zero)
    if (context.amountBaseUnits <= 0n) {
      outcomes.push({
        rule: 'AMOUNT_BOUNDS',
        decision: 'DENY',
        reason: 'Amount must be strictly greater than zero.',
      });
    } else {
      outcomes.push({
        rule: 'AMOUNT_BOUNDS',
        decision: 'ALLOW',
        reason: 'Amount is within valid positive bounds.',
      });
    }

    // 3. Per-transaction limit
    const perTxLimitBaseUnits = BigInt(Math.round(env.PER_TX_LIMIT_AUSD * 1_000_000));
    if (context.amountBaseUnits > perTxLimitBaseUnits) {
      outcomes.push({
        rule: 'PER_TX_LIMIT',
        decision: 'DENY',
        reason: `Amount (${context.displayAmount} AUSD) exceeds per-transaction limit of ${env.PER_TX_LIMIT_AUSD} AUSD.`,
        metadata: { limit: env.PER_TX_LIMIT_AUSD, requested: context.displayAmount },
      });
    } else {
      outcomes.push({
        rule: 'PER_TX_LIMIT',
        decision: 'ALLOW',
        reason: `Within per-transaction limit of ${env.PER_TX_LIMIT_AUSD} AUSD.`,
      });
    }

    // 4. Rolling 24-hour spending limit
    const rolling24hTotal = proposalsRepo.getRolling24hTotalAmount(context.userId);
    const dailyLimitBaseUnits = BigInt(Math.round(env.DAILY_LIMIT_AUSD * 1_000_000));
    const projectedTotal = rolling24hTotal + context.amountBaseUnits;

    if (projectedTotal > dailyLimitBaseUnits) {
      const rollingTotalDisplay = Number(rolling24hTotal) / 1_000_000;
      outcomes.push({
        rule: 'DAILY_ROLLING_LIMIT',
        decision: 'DENY',
        reason: `Transaction would exceed rolling 24-hour limit of ${env.DAILY_LIMIT_AUSD} AUSD (Current 24h total: ${rollingTotalDisplay} AUSD).`,
        metadata: {
          limit: env.DAILY_LIMIT_AUSD,
          currentTotal: rollingTotalDisplay,
          requested: context.displayAmount,
        },
      });
    } else {
      outcomes.push({
        rule: 'DAILY_ROLLING_LIMIT',
        decision: 'ALLOW',
        reason: `Within rolling 24-hour limit (${Number(rolling24hTotal) / 1_000_000} / ${env.DAILY_LIMIT_AUSD} AUSD spent).`,
      });
    }

    // 5. Known contacts / First-time recipient check
    const isKnownRecipient = proposalsRepo.hasTransactedWith(context.userId, context.recipientId);
    if (!isKnownRecipient) {
      outcomes.push({
        rule: 'KNOWN_CONTACT_POLICY',
        decision: 'REQUIRE_APPROVAL',
        reason: 'First-time recipient: extra confirmation required before transferring funds.',
      });
    } else {
      outcomes.push({
        rule: 'KNOWN_CONTACT_POLICY',
        decision: 'ALLOW',
        reason: 'Recipient is an existing contact with prior confirmed transfers.',
      });
    }

    // 6. Agent Mandatory Human Approval Rule
    if (context.origin === 'agent') {
      outcomes.push({
        rule: 'AGENT_MANDATORY_APPROVAL',
        decision: 'REQUIRE_APPROVAL',
        reason: 'AI agent proposals always require explicit human authorization; automated execution is disallowed.',
      });
    }

    // 7. Expiry check
    if (context.expiresAt && new Date(context.expiresAt) <= new Date()) {
      outcomes.push({
        rule: 'PROPOSAL_EXPIRY',
        decision: 'DENY',
        reason: 'Proposal has expired and can no longer be processed.',
      });
    }

    // Calculate aggregated decision:
    // If any DENY -> DENY
    // Else if any REQUIRE_APPROVAL -> REQUIRE_APPROVAL
    // Else -> ALLOW
    let finalDecision: 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY' = 'ALLOW';
    if (outcomes.some(o => o.decision === 'DENY')) {
      finalDecision = 'DENY';
    } else if (outcomes.some(o => o.decision === 'REQUIRE_APPROVAL')) {
      finalDecision = 'REQUIRE_APPROVAL';
    }

    return {
      decision: finalDecision,
      reasons: outcomes,
    };
  }
}

export const policyService = new PolicyService();
