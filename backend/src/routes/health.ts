import { Router, Request, Response } from 'express';
import { env } from '../config/env';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    adapters: {
      chain: env.MOCK_CHAIN ? 'mock' : 'testnet',
      executor: env.MOCK_PAYMENT_EXECUTOR ? 'mock' : 'testnet',
      auth: env.MOCK_AUTH ? 'mock' : 'webauthn',
      llm: env.MOCK_LLM ? 'mock' : 'real',
    },
    network: {
      name: 'Monad Testnet',
      chainId: 10143,
      asset: env.MOCK_PAYMENT_EXECUTOR ? 'AUSD' : 'MON',
    },
  });
});

export default router;
