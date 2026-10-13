export interface SystemStatus {
  adapters: {
    auth: 'mock' | 'webauthn';
    llm: 'mock' | 'real';
    executor: 'mock' | 'testnet';
    chain: 'mock' | 'testnet';
  };
  limits: {
    perTxLimitAusd: number;
    dailyLimitAusd: number;
    proposalTtlSeconds: number;
  };
  network: {
    name: string;
    chainId: number;
    asset: string;
  };
}

export interface User {
  id: string;
  handle: string;
  display_name: string;
  phone?: string | null;
  wallet_address?: string | null;
}

export type ProposalStatus =
  | 'proposed'
  | 'policy_checked'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'denied'
  | 'expired'
  | 'submitted'
  | 'confirmed'
  | 'failed'
  | 'simulated_confirmed';

export interface RuleOutcome {
  rule: string;
  decision: 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';
  reason: string;
  metadata?: Record<string, any>;
}

export interface Proposal {
  id: string;
  user_id: string;
  origin: 'user' | 'agent';
  recipient_handle: string;
  recipient_id: string;
  recipient_wallet: string | null;
  amount: string;
  display_amount: string;
  asset: string;
  network: string;
  purpose: string | null;
  proposal_hash: string;
  status: ProposalStatus;
  policy_decision: 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';
  policy_reasons: RuleOutcome[];
  idempotency_key: string | null;
  expires_at: string;
  execution_tx_hash: string | null;
  execution_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentProposeResponse {
  type: 'PROPOSAL' | 'CLARIFICATION';
  proposal?: Proposal;
  message?: string;
  provider: string;
  isMock: boolean;
}

export interface TimelineEvent {
  timestamp: string;
  actor: 'user' | 'agent' | 'policy_engine' | 'system';
  action: string;
  humanDescription: string;
  isSimulated: boolean;
}

export interface ProposalTimelineResponse {
  proposal: Proposal;
  timeline: TimelineEvent[];
}

export interface ApproveResponse {
  proposal: Proposal;
  receipt: {
    status: string;
    txHash: string;
    network?: string;
    isSimulated: boolean;
    details?: string;
  };
}
