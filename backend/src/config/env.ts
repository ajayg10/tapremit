import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables from .env file if present
dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('3000').transform((val) => parseInt(val, 10)),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  MOCK_CHAIN: z.enum(['true', 'false']).default('true').transform((val) => val === 'true'),
  MONAD_RPC_URL: z.string().url().optional(),
  DB_PATH: z.string().default(process.env.NODE_ENV === 'test' ? ':memory:' : './data/tapremit.db'),
  DEBUG_SQL: z.enum(['true', 'false']).default('false').transform((val) => val === 'true'),
  MOCK_AUTH: z.enum(['true', 'false']).default('true').transform((val) => val === 'true'),
  WEBAUTHN_RP_ID: z.string().default('localhost'),
  WEBAUTHN_RP_NAME: z.string().default('TapRemit'),
  WEBAUTHN_ORIGIN: z.string().default('http://localhost:3000'),
  JWT_SECRET: z.string().default('mock_secret_for_development_only_123'),
  JWT_EXPIRY: z.string().default('1h'),
  MOCK_LLM: z.enum(['true', 'false']).default('true').transform((val) => val === 'true'),
  MOCK_PAYMENT_EXECUTOR: z.enum(['true', 'false']).default('true').transform((val) => val === 'true'),
  PER_TX_LIMIT_AUSD: z.string().default('50').transform((val) => parseFloat(val)),
  DAILY_LIMIT_AUSD: z.string().default('200').transform((val) => parseFloat(val)),
  PROPOSAL_TTL_SECONDS: z.string().default('900').transform((val) => parseInt(val, 10)),
}).refine(data => data.MOCK_CHAIN === true || !!data.MONAD_RPC_URL, {
  message: "MONAD_RPC_URL is required when MOCK_CHAIN is false",
  path: ["MONAD_RPC_URL"]
}).refine(data => data.MOCK_AUTH === true || data.JWT_SECRET.length >= 32, {
  message: "JWT_SECRET must be at least 32 characters when MOCK_AUTH is false",
  path: ["JWT_SECRET"]
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error('❌ Invalid environment variables:', _env.error.format());
  process.exit(1);
}

export const env = _env.data;
