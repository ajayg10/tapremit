import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { runMigrations } from '../db/migrate';
import { usersRepo } from '../db/users.repository';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

describe('System and Proposals List API', () => {
  let user: any;
  let token: string;

  beforeAll(() => {
    runMigrations();
    user = usersRepo.create({ handle: 'system_tester', display_name: 'SysTester', phone: '+19998887777' });
    token = jwt.sign({ sub: user.id }, env.JWT_SECRET, { expiresIn: '1h', algorithm: 'HS256' });
  });

  it('GET /system/status should return active adapter flags and limits', async () => {
    const res = await request(app).get('/system/status');
    expect(res.status).toBe(200);
    expect(res.body.adapters).toBeDefined();
    expect(res.body.adapters.auth).toBe(env.MOCK_AUTH ? 'mock' : 'webauthn');
    expect(res.body.adapters.llm).toBe(env.MOCK_LLM ? 'mock' : 'real');
    expect(res.body.adapters.executor).toBe(env.MOCK_PAYMENT_EXECUTOR ? 'mock' : 'testnet');
    expect(res.body.adapters.chain).toBe(env.MOCK_CHAIN ? 'mock' : 'testnet');
    expect(res.body.limits).toBeDefined();
    expect(res.body.limits.perTxLimitAusd).toBe(env.PER_TX_LIMIT_AUSD);
    expect(res.body.limits.dailyLimitAusd).toBe(env.DAILY_LIMIT_AUSD);
    expect(res.body.network.name).toBe('Monad Testnet');
  });

  it('GET /proposals should require authentication', async () => {
    const res = await request(app).get('/proposals');
    expect(res.status).toBe(401);
  });

  it('GET /proposals should return array of user proposals', async () => {
    const res = await request(app)
      .get('/proposals')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.proposals)).toBe(true);
  });
});
