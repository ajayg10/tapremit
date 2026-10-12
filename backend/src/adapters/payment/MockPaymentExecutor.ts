import { PaymentExecutor, ExecutionReceipt } from './PaymentExecutor';
import { Proposal } from '../../db/proposals.repository';
import crypto from 'crypto';

export class MockPaymentExecutor implements PaymentExecutor {
  name = 'MockPaymentExecutor (Simulated Settlement)';
  isMock = true;

  // Option for tests to simulate failure
  private shouldFail = false;

  setShouldFail(fail: boolean) {
    this.shouldFail = fail;
  }

  async executePayment(proposal: Proposal): Promise<ExecutionReceipt> {
    if (this.shouldFail) {
      throw new Error('Simulated settlement failure: Insufficient mock relayer funds');
    }

    // Generate a deterministic simulated transaction hash
    const hash = 'sim_0x' + crypto.createHash('sha256').update(`${proposal.id}_${Date.now()}`).digest('hex');

    return {
      status: 'simulated_confirmed',
      txHash: hash,
      network: proposal.network || 'Monad Testnet (Simulated)',
      asset: proposal.asset,
      amount: proposal.amount,
      isSimulated: true,
      timestamp: new Date().toISOString(),
      details: 'SIMULATED: Transfer processed by local mock executor. No testnet tokens were moved.',
    };
  }
}
