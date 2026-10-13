import app from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import { runMigrations } from './db/migrate';
import { proposalService } from './services/proposal.service';
import { MonadPaymentExecutor } from './adapters/payment/MonadPaymentExecutor';

const startServer = async () => {
  runMigrations();

  if (!env.MOCK_PAYMENT_EXECUTOR) {
    const executor = proposalService.getExecutor();
    if (executor instanceof MonadPaymentExecutor) {
      try {
        await executor.initializeNonce();
      } catch (err: any) {
        logger.error({ err }, 'Failed to initialize Monad relayer nonce on startup');
      }
    }
  }

  if (env.SEED_ON_BOOT) {
    try {
      logger.info('SEED_ON_BOOT=true: running idempotent demo account seeder...');
      const { seedDemoData } = await import('./db/seed');
      seedDemoData();
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed during SEED_ON_BOOT');
      process.exit(1);
    }
  }

  const activeAdapters = {
    chain: env.MOCK_CHAIN ? 'mock' : 'real (Monad Testnet RPC)',
    executor: env.MOCK_PAYMENT_EXECUTOR ? 'mock' : 'real (Monad Relayer)',
    auth: env.MOCK_AUTH ? 'mock' : 'real (WebAuthn)',
    llm: env.MOCK_LLM ? 'mock' : 'real (OpenAI / Anthropic)',
  };
  logger.info({ adapters: activeAdapters }, 'Active system adapters');

  if (env.MOCK_AUTH) {
    logger.warn('⚠️ MOCK_AUTH is enabled: authentication is NOT secure and demo login bypass is active.');
  }

  try {
    app.listen(env.PORT, () => {
      logger.info(`🚀 Server running on port ${env.PORT} in ${env.NODE_ENV} mode`);
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to start server');
    process.exit(1);
  }
};

startServer();
