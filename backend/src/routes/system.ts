import { Router, Request, Response } from 'express';
import { env } from '../config/env';

const router = Router();

router.get('/status', (_req: Request, res: Response) => {
  res.json({
    adapters: {
      auth: env.MOCK_AUTH ? 'mock' : 'webauthn',
      llm: env.MOCK_LLM ? 'mock' : 'real',
      executor: env.MOCK_PAYMENT_EXECUTOR ? 'mock' : 'testnet',
      chain: env.MOCK_CHAIN ? 'mock' : 'testnet',
    },
    limits: {
      perTxLimitAusd: env.PER_TX_LIMIT_AUSD,
      dailyLimitAusd: env.DAILY_LIMIT_AUSD,
      proposalTtlSeconds: env.PROPOSAL_TTL_SECONDS,
    },
    network: {
      name: 'Monad Testnet',
      chainId: 10143,
      asset: 'AUSD',
    },
  });
});

export default router;
