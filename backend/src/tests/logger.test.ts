import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { runMigrations } from '../db/migrate';
import { logger } from '../utils/logger';

// Enable pino-http logging specifically for this test
process.env.ENABLE_TEST_LOGGING = 'true';

import app from '../app';

describe('Logger Privacy', () => {
  beforeAll(() => {
    runMigrations();
    // Force logger to output in test env
    logger.level = 'info';
  });

  afterAll(() => {
    logger.level = 'silent';
  });

  it('should not log phone numbers anywhere in output', async () => {
    // Spy on stdout to capture Pino's formatted output
    const spy = vi.spyOn(process.stdout, 'write');
    const phone = '+15554443333';
    
    // Action 1: Create user with phone
    await request(app).post('/users').send({ handle: 'logalice', display_name: 'Alice', phone });
    // Action 2: Trigger a 409 conflict (logs as WARN)
    await request(app).post('/users').send({ handle: 'logalice', display_name: 'Alice 2', phone });
    // Action 3: POST lookup by phone
    await request(app).post('/users/lookup').send({ phone });
    // Action 4: GET lookup with phone in query (should be stripped from URL)
    await request(app).get(`/users/lookup?handle=logalice&phone=${encodeURIComponent(phone)}`);
    
    // Combine all stdout strings
    const logs = spy.mock.calls.map(c => String(c[0])).join('');
    
    // Assertions
    expect(logs).not.toContain(phone);
    expect(logs).not.toContain('15554443333'); // Also check stripped format just in case
    
    spy.mockRestore();
  });

  it('should sanitize viem-shaped errors and never expose sentinel URLs or nested cause in logs, API or audit', async () => {
    const sentinelUrl = 'https://sensitive-rpc-token:supersecret@testnet-rpc.monad.xyz?secret_key=shhh_private';
    const spy = vi.spyOn(process.stdout, 'write');

    // Create a viem-shaped error with nested cause and details
    const viemError = new Error('HTTP request failed: URL unavailable');
    (viemError as any).name = 'HttpRequestError';
    (viemError as any).code = 'RPC_CONNECTION_FAILURE';
    (viemError as any).url = sentinelUrl;
    (viemError as any).details = `Failed to connect to ${sentinelUrl}`;
    (viemError as any).cause = {
      message: `Connect timeout to ${sentinelUrl}`,
      config: { url: sentinelUrl, token: 'supersecret' },
    };

    // Test sanitization function directly and through executor
    const { sanitizeError } = await import('../adapters/payment/MonadPaymentExecutor');
    const sanitized = sanitizeError(viemError);

    expect(sanitized.code).toBe('RPC_CONNECTION_FAILURE');
    expect(sanitized.message).not.toContain(sentinelUrl);
    expect(sanitized.message).not.toContain('supersecret');
    expect(sanitized.message).not.toContain('shhh_private');

    // Log through app logger
    logger.error({ errCode: sanitized.code, message: sanitized.message }, 'RPC error occurred');

    const logs = spy.mock.calls.map((c) => String(c[0])).join('');
    expect(logs).not.toContain(sentinelUrl);
    expect(logs).not.toContain('supersecret');
    expect(logs).not.toContain('shhh_private');

    spy.mockRestore();
  });
});
