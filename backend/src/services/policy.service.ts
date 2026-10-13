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

    const isRealExecutor = !env.MOCK_PAYMENT_EXECUTOR;
    const allowedAsset = isRealExecutor ? 'MON' : 'AUSD';

    // 1. Asset verification
    if (isRealExecutor && context.asset !== 'MON') {
      outcomes.push({
        rule: 'ASSET_WHITELIST',
        decision: 'DENY',
        reason: `Asset '${context.asset}' is not permitted in real testnet mode. Only native 'MON' is supported.`,
      });
    } else if (!isRealExecutor && context.asset !== 'AUSD' && context.asset !== 'MON') {
      outcomes.push({
        rule: 'ASSET_WHITELIST',
        decision: 'DENY',
        reason: `Asset '${context.asset}' is not supported. Permitted assets: AUSD, MON.`,
      });
    } else {
      outcomes.push({
        rule: 'ASSET_WHITELIST',
        decision: 'ALLOW',
        reason: `Asset '${context.asset}' is supported on active network.`,
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

    // Determine limits and scaling based on asset
    const isMon = context.asset === 'MON';
    const decimals = isMon ? 18 : 6;
    const perTxLimitVal = isMon ? env.PER_TX_LIMIT_MON : env.PER_TX_LIMIT_AUSD;
    const dailyLimitVal = isMon ? env.DAILY_LIMIT_MON : env.DAILY_LIMIT_AUSD;
    const multiplier = 10n ** BigInt(decimals);

    // Compute base units limit without float precision loss
    const perTxLimitBaseUnits = BigInt(Math.round(perTxLimitVal * 1_000_000)) * (10n ** BigInt(decimals - 6));

    // 3. Per-transaction limit
    if (context.amountBaseUnits > perTxLimitBaseUnits) {
      outcomes.push({
        rule: 'PER_TX_LIMIT',
        decision: 'DENY',
        reason: `Amount (${context.displayAmount} ${context.asset}) exceeds per-transaction limit of ${perTxLimitVal} ${context.asset}.`,
        metadata: { limit: perTxLimitVal, requested: context.displayAmount },
      });
    } else {
      outcomes.push({
        rule: 'PER_TX_LIMIT',
        decision: 'ALLOW',
        reason: `Within per-transaction limit of ${perTxLimitVal} ${context.asset}.`,
      });
    }

    // 4. Rolling 24-hour spending limit
    const rolling24hTotal = proposalsRepo.getRolling24hTotalAmount(context.userId, context.asset);
    const dailyLimitBaseUnits = BigInt(Math.round(dailyLimitVal * 1_000_000)) * (10n ** BigInt(decimals - 6));
    const projectedTotal = rolling24hTotal + context.amountBaseUnits;

    if (projectedTotal > dailyLimitBaseUnits) {
      const rollingTotalDisplay = Number(rolling24hTotal / (10n ** BigInt(decimals - 6))) / 1_000_000;
      outcomes.push({
        rule: 'DAILY_ROLLING_LIMIT',
        decision: 'DENY',
        reason: `Transaction would exceed rolling 24-hour limit of ${dailyLimitVal} ${context.asset} (Current 24h total: ${rollingTotalDisplay} ${context.asset}).`,
        metadata: {
          limit: dailyLimitVal,
          currentTotal: rollingTotalDisplay,
          requested: context.displayAmount,
        },
      });
    } else {
      const currentSpentDisplay = Number(rolling24hTotal / (10n ** BigInt(decimals - 6))) / 1_000_000;
      outcomes.push({
        rule: 'DAILY_ROLLING_LIMIT',
        decision: 'ALLOW',
        reason: `Within rolling 24-hour limit (${currentSpentDisplay} / ${dailyLimitVal} ${context.asset} spent).`,
      });
    }

    // 4b. Global Daily Limit (for MON)
    if (isMon) {
      const global24hTotal = proposalsRepo.getRolling24hGlobalTotalAmount('MON');
      const globalLimitBaseUnits = BigInt(Math.round(env.GLOBAL_DAILY_LIMIT_MON * 1_000_000)) * (10n ** 12n);
      if (global24hTotal + context.amountBaseUnits > globalLimitBaseUnits) {
        const globalSpentDisplay = Number(global24hTotal / (10n ** 12n)) / 1_000_000;
        outcomes.push({
          rule: 'GLOBAL_DAILY_LIMIT',
          decision: 'DENY',
          reason: `Transaction would exceed global daily limit of ${env.GLOBAL_DAILY_LIMIT_MON} MON across all relayer sends (Current: ${globalSpentDisplay} MON).`,
          metadata: { limit: env.GLOBAL_DAILY_LIMIT_MON, current: globalSpentDisplay },
        });
      } else {
        outcomes.push({
          rule: 'GLOBAL_DAILY_LIMIT',
          decision: 'ALLOW',
          reason: `Within global daily relayer limit of ${env.GLOBAL_DAILY_LIMIT_MON} MON.`,
        });
      }
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
