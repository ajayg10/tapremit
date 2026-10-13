import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { logger } from './utils/logger';
import { env } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import healthRouter from './routes/health';
import chainRouter from './routes/chain';
import usersRouter from './routes/users';
import authRouter from './routes/auth';
import agentRouter from './routes/agent';
import proposalsRouter from './routes/proposals';
import systemRouter from './routes/system';

const app = express();

// Trust reverse proxy (e.g. Nginx, Cloudflare, Fly, Railway) so rate limiters use real client IP
app.set('trust proxy', 1);

// Middlewares
app.use(helmet());

// CORS allowlist from FRONTEND_ORIGIN (comma-separated, no wildcard in production)
const allowedOrigins = env.FRONTEND_ORIGIN
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow curl / server-to-server requests without Origin header
      if (!origin) return callback(null, true);
      const normalizedOrigin = origin.replace(/\/$/, '');
      if (env.NODE_ENV !== 'production') {
        return callback(null, true);
      }
      if (allowedOrigins.includes(normalizedOrigin)) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);
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
app.use('/system', systemRouter);
app.use('/users', usersRouter);
app.use('/auth', authRouter);
app.use('/agent', agentRouter);
app.use('/proposals', proposalsRouter);

// Error Handling
app.use(errorHandler);

export default app;
