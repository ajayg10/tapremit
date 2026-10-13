import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables from .env file if present
dotenv.config();

const isTestEnv = !!process.env.VITEST || process.env.NODE_ENV === 'test';
if (isTestEnv && !process.env.TEST_WITH_REAL_CHAIN) {
  process.env.MOCK_PAYMENT_EXECUTOR = 'true';
  process.env.MOCK_CHAIN = 'true';
}

const envSchema = z.object({
  PORT: z.string().default('3000').transform((val) => parseInt(val, 10)),
  NODE_ENV: z.enum(['development', 'production', 'test']).default(isTestEnv ? 'test' : 'development'),
  MOCK_CHAIN: z.enum(['true', 'false']).default('true').transform((val) => val === 'true'),
  MONAD_RPC_URL: z.string().url().optional(),
  RPC_PRIMARY_URL: z.string().url().default('https://testnet-rpc.monad.xyz'),
  RPC_FALLBACK_URL: z.string().url().default('https://rpc.ankr.com/monad_testnet'),
  EXPLORER_BASE_URL: z.string().url().default('https://testnet.monadvision.com'),
  RELAYER_ADDRESS: z.string().optional(),
  RELAYER_PRIVATE_KEY: z.string().optional(),
  PAUSE_REAL_TRANSFERS: z.enum(['true', 'false']).default('false').transform((val) => val === 'true'),
  MAX_TESTNET_TRANSFER_MON: z.string().default('0.2').transform((val) => parseFloat(val)),
  GLOBAL_DAILY_LIMIT_MON: z.string().default('2.0').transform((val) => parseFloat(val)),
  PER_TX_LIMIT_MON: z.string().default('0.1').transform((val) => parseFloat(val)),
  DAILY_LIMIT_MON: z.string().default('1.0').transform((val) => parseFloat(val)),
  OPERATOR_OVERRIDE_ALLOW_SENDS: z.enum(['true', 'false']).default('false').transform((val) => val === 'true'),
  MONAD_FINALITY_CONFIRMATION_TIMEOUT_MS: z.string().default('30000').transform((val) => parseInt(val, 10)),
  NOT_FOUND_WINDOW_MS: z.string().default('300000').transform((val) => parseInt(val, 10)),
  MAX_REBROADCAST_AGE_MS: z.string().default('600000').transform((val) => parseInt(val, 10)),
  SEED_ALICE_WALLET: z.string().optional(),
  SEED_RIYA_WALLET: z.string().optional(),
  SEED_BOB_WALLET: z.string().optional(),
  SEED_CHARLIE_WALLET: z.string().optional(),
  DB_PATH: z.string().default('./data/tapremit.db').transform((val) => isTestEnv ? ':memory:' : val),
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
}).refine(data => data.MOCK_PAYMENT_EXECUTOR === true || !!data.RELAYER_PRIVATE_KEY, {
  message: "RELAYER_PRIVATE_KEY is required when MOCK_PAYMENT_EXECUTOR is false",
  path: ["RELAYER_PRIVATE_KEY"]
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error('❌ Invalid environment variables:', _env.error.format());
  process.exit(1);
}

export const env = _env.data;
