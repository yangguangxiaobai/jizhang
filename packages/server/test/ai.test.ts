import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { closeDatabase, initializeDatabase, type Db } from '../src/db/index.js';
import { SESSION_COOKIE } from '../src/plugins/auth.js';
import { AuthService } from '../src/services/auth-service.js';
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
  const fetchImpl: typeof fetch = async (_input, init) => {
    if (typeof init?.body === 'string') providerBody = JSON.parse(init.body) as unknown;
    providerHeaders = new Headers(init?.headers);
    return providerResponse();
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
