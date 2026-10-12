import { Proposal } from '../../db/proposals.repository';

export interface ExecutionReceipt {
  status: 'confirmed' | 'simulated_confirmed' | 'failed';
  txHash: string;
  network: string;
  asset: string;
  amount: string;
  isSimulated: boolean;
  timestamp: string;
  details?: string;
}

export interface PaymentExecutor {
  name: string;
  isMock: boolean;
  executePayment(proposal: Proposal): Promise<ExecutionReceipt>;
}
