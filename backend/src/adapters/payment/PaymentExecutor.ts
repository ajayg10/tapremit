import { Proposal } from '../../db/proposals.repository';

export interface ExecutionReceipt {
  status: 'confirmed' | 'simulated_confirmed' | 'failed' | 'unknown' | 'submitted';
  txHash: string;
  network: string;
  asset: string;
  amount: string;
  isSimulated: boolean;
  timestamp: string;
  finalizedBlockNumber?: number;
  finalizedBlockHash?: string;
  explorerLink?: string;
  details?: string;
}

export interface PaymentExecutor {
  name: string;
  isMock: boolean;
  supportedAsset: string;
  executePayment(proposal: Proposal): Promise<ExecutionReceipt>;
  reconcilePayment?(proposal: Proposal): Promise<ExecutionReceipt>;
}
