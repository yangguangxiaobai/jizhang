import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { closeDatabase, initializeDatabase, type Db } from '../src/db/index.js';
import { SESSION_COOKIE } from '../src/plugins/auth.js';
import { AuthService } from '../src/services/auth-service.js';
import { seedHistoricalSalary } from './support/historical-salary-fixture.js';
import { allocateSalaryCents } from '@jizhang/shared';
import { AiConfigService } from '../src/services/ai-config-service.js';
import { decryptAiSecret, encryptAiSecret } from '../src/services/ai-crypto.js';
import { extractAiResponsePath, renderAiJsonTemplate } from '../src/services/ai-provider-service.js';

const USERNAME = 'quiz';
const PASSWORD = 'correct horse battery staple';
const CSRF = { 'x-requested-with': 'fetch' } as const;
const NOW = Date.UTC(2026, 8, 21, 12, 0, 0);
const ENCRYPTION_KEY = 'ab'.repeat(32);
const API_KEY = 'provider-secret-for-tests';

let db: Db;
let app: FastifyInstance;
let cookie: string;
let providerBody: unknown;
let providerHeaders: Headers;
let monthlyProvider = false;
let invalidMonthlyEvidence = false;

function authed() {
  return { ...CSRF, Cookie: `${SESSION_COOKIE}=${cookie}` };
}

async function inject(
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  payload?: Record<string, unknown>,
) {
  return app.inject({
    method,
    url,
    headers: authed(),
    ...(payload === undefined ? {} : { payload }),
  });
}

function providerResponse(): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              type: 'expense',
              amountYuan: '35',
              date: '2026-09-20',
              note: '午饭',
              categoryId: 'builtin-expense-food',
              accountId: 'builtin-default-account',
              tags: ['午餐'],
              confidence: 0.96,
              reason: '用户描述了午饭消费。',
              missing: [],
            }),
          },
        },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function monthlyProviderResponse(): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: {
                text: '本月记录清晰，支出集中在主要分类。',
                evidenceIds: invalidMonthlyEvidence
                  ? ['unknown.fact']
                  : ['monthly.income', 'monthly.expense'],
              },
              highlights: [
                {
                  text: '餐饮是本月的主要支出分类。',
                  evidenceIds: ['category.builtin-expense-food'],
                },
              ],
              risks: [],
              suggestions: [
                {
                  text: '继续关注下月的分类占比变化。',
                  evidenceIds: ['trend.2026-09'],
                },
              ],
            }),
          },
        },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
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
    JIZHANG_AI_ENCRYPTION_KEY: ENCRYPTION_KEY,
    DATA_DIR: './data',
  });
  const authService = new AuthService(db, { sessionTtlDays: config.sessionTtlDays, now: () => NOW });
  await authService.setPassword(USERNAME, PASSWORD);

  providerBody = undefined;
  providerHeaders = new Headers();
  monthlyProvider = false;
  invalidMonthlyEvidence = false;
  const fetchImpl: typeof fetch = async (_input, init) => {
    if (typeof init?.body === 'string') providerBody = JSON.parse(init.body) as unknown;
    providerHeaders = new Headers(init?.headers);
    return monthlyProvider ? monthlyProviderResponse() : providerResponse();
  };

  app = buildApp({
    config,
    db,
    authService,
    secureCookies: false,
    now: () => NOW,
    fetchImpl,
  });
  await app.ready();

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: CSRF,
    payload: { username: USERNAME, password: PASSWORD },
  });
  cookie = (login.cookies as { name: string; value: string }[]).find(
    (item) => item.name === SESSION_COOKIE,
  )?.value as string;
});

afterEach(async () => {
  await app.close();
  closeDatabase(db);
});

describe('AI secret cryptography', () => {
  it('round-trips with AES-GCM and never stores plaintext in the envelope', () => {
    const encrypted = encryptAiSecret(API_KEY, ENCRYPTION_KEY);
    expect(JSON.stringify(encrypted)).not.toContain(API_KEY);
    expect(decryptAiSecret(encrypted, ENCRYPTION_KEY)).toBe(API_KEY);
    expect(() => decryptAiSecret(encrypted, 'cd'.repeat(32))).toThrow();
  });
});

describe('AI configuration routes', () => {
  it('redacts the secret and stores only ciphertext', async () => {
    const initial = await inject('GET', '/api/v1/ai/config');
    expect(initial.statusCode).toBe(200);
    expect(initial.json().configured).toBe(false);

    const saved = await inject('PUT', '/api/v1/ai/config', {
      enabled: true,
      mode: 'chat-completions',
      name: '测试 provider',
      url: 'https://provider.example.test/v1/chat/completions',
      method: 'POST',
      model: 'test-model',
      timeoutMs: 10_000,
      headers: { 'X-Test-Header': 'ok' },
      auth: { kind: 'bearer' },
      bodyTemplate: null,
      responsePath: 'choices[0].message.content',
      secret: API_KEY,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.body).not.toContain(API_KEY);
    expect(saved.json().hasSecret).toBe(true);

    const raw = db
      .prepare('SELECT value_json FROM settings WHERE key = ?')
      .get('ai.provider.v1') as { value_json: string };
    expect(raw.value_json).not.toContain(API_KEY);
    expect((await inject('GET', '/api/v1/ai/config')).json()).toMatchObject({
      configured: true,
      enabled: true,
      hasSecret: true,
      model: 'test-model',
    });
  });

  it('keeps the route behind the session guard', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/ai/config' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: expect.any(String) as string },
    });
  });

  it('requires the separate encryption key before saving a secret', () => {
    const service = new AiConfigService(db, { aiEncryptionKey: undefined, production: false, now: () => NOW });
    expect(() =>
      service.save({
        enabled: true,
        mode: 'chat-completions',
        name: 'missing key',
        url: 'https://provider.example.test/chat',
        method: 'POST',
        model: 'test-model',
        timeoutMs: 10_000,
        headers: {},
        auth: { kind: 'bearer' },
        bodyTemplate: null,
        responsePath: 'choices[0].message.content',
        secret: API_KEY,
      }),
    ).toThrow(/加密密钥/);
  });

  it('accepts raw allowlisted placeholders in a custom JSON body', () => {
    const service = new AiConfigService(db, {
      aiEncryptionKey: ENCRYPTION_KEY,
      production: false,
      now: () => NOW,
    });
    expect(
      service.save({
        enabled: true,
        mode: 'custom',
        name: 'custom',
        url: 'http://127.0.0.1:1234/infer',
        method: 'POST',
        model: 'local-model',
        timeoutMs: 10_000,
        headers: {},
        auth: { kind: 'none' },
        bodyTemplate: '{"prompt":{{input}},"categories":{{categories}}}',
        responsePath: 'result',
      }).mode,
    ).toBe('custom');
  });
});

describe('AI transaction drafts', () => {
  it('fills a normalized draft without writing a transaction or leaking the secret', async () => {
    await inject('PUT', '/api/v1/ai/config', {
      enabled: true,
      mode: 'chat-completions',
      name: 'test',
      url: 'https://provider.example.test/chat',
      method: 'POST',
      model: 'test-model',
      timeoutMs: 10_000,
      headers: {},
      auth: { kind: 'bearer' },
      bodyTemplate: null,
      responsePath: 'choices[0].message.content',
      secret: API_KEY,
    });

    const before = (db.prepare('SELECT COUNT(*) AS count FROM transactions').get() as { count: number }).count;
    const response = await inject('POST', '/api/v1/ai/transaction-draft', {
      input: '昨天午饭 35 元，默认账户支付',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      type: 0,
      amountCents: 3500,
      categoryId: 'builtin-expense-food',
      accountId: 'builtin-default-account',
      note: '午饭',
      tags: ['午餐'],
      missing: [],
    });
    expect((db.prepare('SELECT COUNT(*) AS count FROM transactions').get() as { count: number }).count).toBe(before);
    expect(providerHeaders.get('authorization')).toBe(`Bearer ${API_KEY}`);
    expect(JSON.stringify(providerBody)).not.toContain(API_KEY);
  });
});

describe('AI monthly evaluation', () => {
  it('uses current-natural-month aggregates, returns evidence, and does not write the ledger', async () => {
    await inject('PUT', '/api/v1/ai/config', {
      enabled: true,
      mode: 'chat-completions',
      name: 'monthly test',
      url: 'https://provider.example.test/chat',
      method: 'POST',
      model: 'test-model',
      timeoutMs: 10_000,
      headers: {},
      auth: { kind: 'bearer' },
      bodyTemplate: null,
      responsePath: 'choices[0].message.content',
      secret: API_KEY,
    });

    const transaction = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      headers: authed(),
      payload: {
        type: 0,
        amountCents: 3_500,
        categoryId: 'builtin-expense-food',
        accountId: 'builtin-default-account',
        date: Date.UTC(2026, 8, 10),
        note: 'PRIVATE_MONTH_NOTE',
      },
    });
    expect(transaction.statusCode).toBe(201);

    // Salary row seeded directly with its frozen module snapshot: fresh legacy salary
    // writes are retired, but the monthly evaluation still reads the historical budget.
    const defaultTemplate = db
      .prepare('SELECT modules_json FROM budget_templates WHERE is_default = 1 AND deleted = 0 LIMIT 1')
      .get() as { modules_json: string } | undefined;
    const templateModules =
      defaultTemplate === undefined
        ? []
        : (JSON.parse(defaultTemplate.modules_json) as { categoryId: string; ratio: number }[]);
    seedHistoricalSalary(db, {
      accountId: 'builtin-default-account',
      amountCents: 100_000,
      date: Date.UTC(2026, 8, 5),
      allocations: allocateSalaryCents(100_000, templateModules),
    });

    const before = (db.prepare('SELECT COUNT(*) AS count FROM transactions').get() as { count: number }).count;
    monthlyProvider = true;
    const response = await inject('POST', '/api/v1/ai/monthly-evaluation');

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.period.month).toBe('2026-09');
    expect(body.period.from).toBeLessThan(body.period.to);
    expect(body.facts.monthly).toMatchObject({
      incomeCents: 100_000,
      netExpenseCents: 3_500,
      incomeEvidenceId: 'monthly.income',
      expenseEvidenceId: 'monthly.expense',
    });
    expect(body.facts.categories[0]).toMatchObject({
      categoryId: 'builtin-expense-food',
      amountCents: 3_500,
      evidenceId: 'category.builtin-expense-food',
    });
    expect(body.facts.budget).toMatchObject({ totalBudgetCents: expect.any(Number) });
    expect(body.evaluation.summary.evidenceIds).toEqual(['monthly.income', 'monthly.expense']);
    expect((db.prepare('SELECT COUNT(*) AS count FROM transactions').get() as { count: number }).count).toBe(before);
    expect(JSON.stringify(providerBody)).not.toContain('PRIVATE_MONTH_NOTE');
    expect(JSON.stringify(providerBody)).not.toContain(API_KEY);
  });

  it('is protected by the authenticated route boundary', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/monthly-evaluation',
      headers: CSRF,
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: expect.any(String) as string },
    });
  });

  it('rejects provider evidence that is not present in the server facts', async () => {
    await inject('PUT', '/api/v1/ai/config', {
      enabled: true,
      mode: 'chat-completions',
      name: 'monthly evidence test',
      url: 'https://provider.example.test/chat',
      method: 'POST',
      model: 'test-model',
      timeoutMs: 10_000,
      headers: {},
      auth: { kind: 'bearer' },
      bodyTemplate: null,
      responsePath: 'choices[0].message.content',
      secret: API_KEY,
    });
    monthlyProvider = true;
    invalidMonthlyEvidence = true;

    const response = await inject('POST', '/api/v1/ai/monthly-evaluation');
    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({
      error: { code: 'AI_RESPONSE_INVALID', message: expect.any(String) as string },
    });
  });
});

describe('AI custom template helpers', () => {
  it('renders allowlisted variables and extracts a bounded response path', () => {
    const context = {
      input: '午饭 35 元',
      categories: [{ id: 'food', name: '餐饮', type: 0 }],
      accounts: [{ id: 'default', name: '默认账户', type: 0 }],
      model: 'test-model',
      today: '2026-09-21',
      responseSchema: { type: 'object' },
    };
    const body = renderAiJsonTemplate('{"text":"{{input}}","items":"{{categories}}"}', context);
    expect(body).toEqual({ text: '午饭 35 元', items: JSON.stringify(context.categories) });
    expect(extractAiResponsePath({ choices: [{ message: { content: 'ok' } }] }, 'choices[0].message.content')).toBe('ok');
  });
});
