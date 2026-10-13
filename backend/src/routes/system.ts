import { Router, Request, Response } from 'express';
import { env } from '../config/env';

const router = Router();

router.get('/status', (_req: Request, res: Response) => {
  res.json({
    isRealChain: !env.MOCK_CHAIN,
    activeAsset: env.MOCK_PAYMENT_EXECUTOR ? 'AUSD' : 'MON',
    adapters: {
      auth: env.MOCK_AUTH ? 'mock' : 'webauthn',
      llm: env.MOCK_LLM ? 'mock' : 'real',
      executor: env.MOCK_PAYMENT_EXECUTOR ? 'mock' : 'testnet',
      chain: env.MOCK_CHAIN ? 'mock' : 'testnet',
    },
    limits: {
      perTxLimitAusd: env.PER_TX_LIMIT_AUSD,
      dailyLimitAusd: env.DAILY_LIMIT_AUSD,
      perTxLimitMon: env.PER_TX_LIMIT_MON,
      dailyLimitMon: env.DAILY_LIMIT_MON,
      globalDailyLimitMon: env.GLOBAL_DAILY_LIMIT_MON,
      maxTestnetTransferMon: env.MAX_TESTNET_TRANSFER_MON,
      pauseRealTransfers: env.PAUSE_REAL_TRANSFERS,
      proposalTtlSeconds: env.PROPOSAL_TTL_SECONDS,
    },
    network: {
      name: 'Monad Testnet',
      chainId: 10143,
      asset: env.MOCK_PAYMENT_EXECUTOR ? 'AUSD' : 'MON',
    },
    relayer: {
      address: env.RELAYER_ADDRESS || '0x836DF4117d96B860939627B7288a0e5C51fEFD53',
    },
  });
});

export default router;
