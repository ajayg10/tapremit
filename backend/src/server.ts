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

  if (env.MOCK_AUTH) {
    if (env.NODE_ENV === 'production') {
      logger.error('Cannot start in production with MOCK_AUTH=true. It is insecure by design.');
      process.exit(1);
    }
    logger.warn('MOCK_AUTH is on: authentication is NOT secure');
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
