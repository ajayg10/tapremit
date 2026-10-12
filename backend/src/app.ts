import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { logger } from './utils/logger';
import { errorHandler } from './middleware/errorHandler';
import healthRouter from './routes/health';
import chainRouter from './routes/chain';
import usersRouter from './routes/users';
import authRouter from './routes/auth';
import agentRouter from './routes/agent';
import proposalsRouter from './routes/proposals';

const app = express();

// Middlewares
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(
  pinoHttp({
    logger,
    autoLogging: process.env.NODE_ENV !== 'test' || process.env.ENABLE_TEST_LOGGING === 'true',
    serializers: {
      req: (req) => {
        return {
          id: req.id,
          method: req.method,
          url: req.url ? req.url.split('?')[0] : undefined,
          headers: req.headers,
          remoteAddress: req.remoteAddress,
          remotePort: req.remotePort,
        };
      }
    }
  })
);

// Routes
app.use('/health', healthRouter);
app.use('/chain', chainRouter);
app.use('/users', usersRouter);
app.use('/auth', authRouter);
app.use('/agent', agentRouter);
app.use('/proposals', proposalsRouter);

// Error Handling
app.use(errorHandler);

export default app;
