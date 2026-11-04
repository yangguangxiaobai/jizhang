import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { closeDatabase, initializeDatabase, type Db } from '../src/db/index.js';
import { SESSION_COOKIE } from '../src/plugins/auth.js';
import { AuthService } from '../src/services/auth-service.js';

const USERNAME = 'quiz';
const PASSWORD = 'correct horse battery staple';
const CSRF = { 'x-requested-with': 'fetch' } as const;
const ACCOUNT = 'builtin-default-account';
const NOW = Date.UTC(2026, 9, 27, 4, 0, 0);

describe('salary-operation-replay-regression', () => {
  let db: Db;
  let app: FastifyInstance;
  let cookie: string;

  async function login(): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: CSRF,
      payload: { username: USERNAME, password: PASSWORD },
    });
    return (response.cookies as { name: string; value: string }[]).find(
      (c) => c.name === SESSION_COOKIE,
    )?.value as string;
  }

  function authed() {
    return { ...CSRF, Cookie: `${SESSION_COOKIE}=${cookie}` };
  }

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    initializeDatabase(db, null);

    const config = loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      JIZHANG_USERNAME: USERNAME,
      JIZHANG_PASSWORD_HASH: 'unused',
      DATA_DIR: './data',
    });
    const authService = new AuthService(db, {
      sessionTtlDays: config.sessionTtlDays,
      now: () => NOW,
    });
    await authService.setPassword(USERNAME, PASSWORD);

    app = buildApp({
      config,
      db,
      authService,
      now: () => NOW,
    });
    await app.ready();
    cookie = await login();
  });

  afterEach(async () => {
    await app.close();
    closeDatabase(db);
  });

  it('legacy unkeyed pending requests never post again', async () => {
    const input = {
      accountId: ACCOUNT,
      amountCents: 500000,
      date: NOW,
      note: 'legacy salary',
    };

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/salaries',
      headers: authed(),
      payload: input,
    });
    expect(first.statusCode).toBe(410);
    expect(first.json().error.code).toBe('FEATURE_RETIRED');

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/salaries',
      headers: authed(),
      payload: input,
    });
    expect(second.statusCode).toBe(410);
    expect(second.json().error.code).toBe('FEATURE_RETIRED');

    const salariesCount = (db.prepare('SELECT COUNT(*) AS c FROM salary_records WHERE deleted = 0').get() as { c: number }).c;
    expect(salariesCount).toBe(0);
  });

  it('keyed requests are idempotent on retry, account balance increases once, no regular income transactions', async () => {
    const balanceBeforeRes = await app.inject({
      method: 'GET',
      url: '/api/v1/accounts/balances',
      headers: authed(),
    });
    const balanceBeforeJson = balanceBeforeRes.json() as { items: { accountId: string; balanceCents: number }[] };
    const initialBalance = balanceBeforeJson.items.find((i) => i.accountId === ACCOUNT)?.balanceCents ?? 0;

    const opId = randomUUID();
    const input = {
      contractVersion: 1,
      expectedFundConfigRevision: 0,
      accountId: ACCOUNT,
      amountCents: 1000000,
      date: NOW,
      note: 'keyed salary',
      operationId: opId,
    };

    // First POST
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/salaries',
      headers: authed(),
      payload: input,
    });
    expect(first.statusCode).toBe(201);
    const salary1 = first.json() as { id: string; amountCents: number };
    expect(salary1.amountCents).toBe(1000000);

    // Second POST with exact same key and payload (e.g. lost response retry)
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/salaries',
      headers: authed(),
      payload: input,
    });
    expect(second.statusCode).toBe(201);
    const salary2 = second.json() as { id: string; amountCents: number };
    expect(salary2.id).toBe(salary1.id);

    // Exactly 1 salary row added
    const salariesCount = (db.prepare('SELECT COUNT(*) AS c FROM salary_records WHERE deleted = 0').get() as { c: number }).c;
    expect(salariesCount).toBe(1);

    // Account balance increased by exactly 1000000 cents
    const balanceAfterRes = await app.inject({
      method: 'GET',
      url: '/api/v1/accounts/balances',
      headers: authed(),
    });
    const balanceAfterJson = balanceAfterRes.json() as { items: { accountId: string; balanceCents: number }[] };
    const updatedBalance = balanceAfterJson.items.find((i) => i.accountId === ACCOUNT)?.balanceCents ?? 0;
    expect(updatedBalance).toBe(initialBalance + 1000000);

    // Regular transactions with type=1 (income) should be 0 (salaries don't write ordinary income transactions)
    const incomeTxCount = (db.prepare("SELECT COUNT(*) AS c FROM transactions WHERE type = 1").get() as { c: number }).c;
    expect(incomeTxCount).toBe(0);

    // GET operation lookup returns the committed result
    const lookup = await app.inject({
      method: 'GET',
      url: `/api/v1/financial-planning/operations/${opId}`,
      headers: authed(),
    });
    expect(lookup.statusCode).toBe(200);
    const lookupJson = lookup.json() as { operation: { operationId: string; response: { id: string } } };
    expect(lookupJson.operation.operationId).toBe(opId);
    expect(lookupJson.operation.response.id).toBe(salary1.id);
  });

  it('rejects same operationId with conflicting payload with 409', async () => {
    const opId = randomUUID();
    const input1 = {
      contractVersion: 1,
      expectedFundConfigRevision: 0,
      accountId: ACCOUNT,
      amountCents: 1000000,
      date: NOW,
      note: 'first',
      operationId: opId,
    };
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/v1/salaries',
      headers: authed(),
      payload: input1,
    });
    expect(res1.statusCode).toBe(201);

    const input2 = {
      contractVersion: 1,
      expectedFundConfigRevision: 0,
      accountId: ACCOUNT,
      amountCents: 2000000,
      date: NOW,
      note: 'conflicting second',
      operationId: opId,
    };
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/v1/salaries',
      headers: authed(),
      payload: input2,
    });
    expect(res2.statusCode).toBe(409);
  });

  it('salary failure does not attempt financial plan period confirmation', async () => {
    const periodsCountBefore = (db.prepare('SELECT COUNT(*) AS c FROM financial_periods').get() as { c: number }).c;
    const opId = randomUUID();

    // Invalid salary amount
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/salaries',
      headers: authed(),
      payload: {
        accountId: ACCOUNT,
        contractVersion: 1,
        expectedFundConfigRevision: 0,
        amountCents: -100,
        date: NOW,
        operationId: opId,
      },
    });
    expect(res.statusCode).toBe(400);

    const periodsCountAfter = (db.prepare('SELECT COUNT(*) AS c FROM financial_periods').get() as { c: number }).c;
    expect(periodsCountAfter).toBe(periodsCountBefore);

    const salariesCount = (db.prepare('SELECT COUNT(*) AS c FROM salary_records WHERE deleted = 0').get() as { c: number }).c;
    expect(salariesCount).toBe(0);
  });

  it('fresh legacy salary requests are retired without writes', async () => {
    // Get default template modules and delete one referenced category
    const defaultTpl = db.prepare('SELECT modules_json FROM budget_templates WHERE is_default = 1 AND deleted = 0').get() as { modules_json: string } | undefined;
    expect(defaultTpl).toBeDefined();
    const modules = JSON.parse(defaultTpl!.modules_json) as { categoryId: string }[];
    expect(modules.length).toBeGreaterThan(0);
    const firstModule = modules[0];
    if (!firstModule) throw new Error('Default template must have a module');
    const deletedCategoryId = firstModule.categoryId;

    // Soft delete this category
    db.prepare('UPDATE categories SET deleted = 1 WHERE id = ?').run(deletedCategoryId);

    const salariesCountBefore = (db.prepare('SELECT COUNT(*) AS c FROM salary_records').get() as { c: number }).c;
    const allocationsCountBefore = (db.prepare('SELECT COUNT(*) AS c FROM budget_allocations').get() as { c: number }).c;
    const periodsCountBefore = (db.prepare('SELECT COUNT(*) AS c FROM financial_periods').get() as { c: number }).c;
    const operationsCountBefore = (db.prepare('SELECT COUNT(*) AS c FROM financial_operations').get() as { c: number }).c;

    const opId = randomUUID();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/salaries',
      headers: authed(),
      payload: {
        accountId: ACCOUNT,
        amountCents: 1000000,
        date: NOW,
        operationId: opId,
      },
    });

    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe('FEATURE_RETIRED');

    // Verify zero writes occurred
    const salariesCountAfter = (db.prepare('SELECT COUNT(*) AS c FROM salary_records').get() as { c: number }).c;
    const allocationsCountAfter = (db.prepare('SELECT COUNT(*) AS c FROM budget_allocations').get() as { c: number }).c;
    const periodsCountAfter = (db.prepare('SELECT COUNT(*) AS c FROM financial_periods').get() as { c: number }).c;
    const operationsCountAfter = (db.prepare('SELECT COUNT(*) AS c FROM financial_operations').get() as { c: number }).c;

    expect(salariesCountAfter).toBe(salariesCountBefore);
    expect(allocationsCountAfter).toBe(allocationsCountBefore);
    expect(periodsCountAfter).toBe(periodsCountBefore);
    expect(operationsCountAfter).toBe(operationsCountBefore);
  });
});
