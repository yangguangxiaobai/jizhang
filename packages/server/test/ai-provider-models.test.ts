import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { closeDatabase, initializeDatabase, type Db } from '../src/db/index.js';
import { SESSION_COOKIE } from '../src/plugins/auth.js';
import { AuthService } from '../src/services/auth-service.js';
import { AiConfigService } from '../src/services/ai-config-service.js';
import { AiProviderService } from '../src/services/ai-provider-service.js';
import type { AiProviderConfigInput } from '../src/services/ai-types.js';

const CSRF = { 'x-requested-with': 'fetch' };
const SECRET = 'model-list-secret-never-return';
const KEY = 'ab'.repeat(32);
const URL = 'https://provider.example.test/gateway/v1/chat/completions?api-version=2026';
let db: Db;
let app: FastifyInstance;
let cookie: string;
let configs: AiConfigService;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

function snapshot() {
  return db.prepare('SELECT * FROM settings ORDER BY key').all();
}
function save(input: AiProviderConfigInput = {}) {
  configs.save({ enabled: false, url: URL, model: '', secret: SECRET, ...input });
}
function list() {
  return app.inject({ method: 'POST', url: '/api/v1/ai/models', headers: { ...CSRF, Cookie: cookie } });
}
function json(payload: unknown) {
  return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
}

beforeEach(async () => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeDatabase(db, null);
  const config = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', JIZHANG_USERNAME: 'quiz', JIZHANG_PASSWORD_HASH: 'unused', JIZHANG_AI_ENCRYPTION_KEY: KEY, DATA_DIR: './data' });
  const authService = new AuthService(db, { sessionTtlDays: config.sessionTtlDays });
  await authService.setPassword('quiz', 'model-list-test-password');
  fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => json({ data: [] }));
  app = buildApp({ config, db, authService, secureCookies: false, fetchImpl: fetchMock });
  await app.ready();
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: CSRF, payload: { username: 'quiz', password: 'model-list-test-password' } });
  cookie = `${SESSION_COOKIE}=${login.cookies.find((item) => item.name === SESSION_COOKIE)?.value}`;
  configs = new AiConfigService(db, { aiEncryptionKey: KEY, production: false, now: () => 12345 });
});
afterEach(async () => {
  vi.useRealTimers();
  await app.close();
  closeDatabase(db);
});

describe('saved provider model listing route', () => {
  it('requires both a session and mutation CSRF and makes no unauthenticated upstream call', async () => {
    save();
    const noSession = await app.inject({ method: 'POST', url: '/api/v1/ai/models', headers: CSRF });
    expect(noSession.statusCode).toBe(401);
    expect(noSession.json()).toEqual({ error: { code: 'UNAUTHORIZED', message: expect.any(String) } });
    const noCsrf = await app.inject({ method: 'POST', url: '/api/v1/ai/models', headers: { Cookie: cookie } });
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json()).toEqual({ error: { code: 'CSRF_REQUIRED', message: expect.any(String) } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses a saved disabled blank-model connection, GET/auth/prefix/query only, returning minimal deduplicated ids without mutation', async () => {
    save({ headers: { 'X-Project': 'project-1' } });
    expect(() => configs.getStoredOrThrow()).toThrow();
    const before = snapshot();
    const ledger = db.prepare('SELECT * FROM transactions').all();
    fetchMock.mockResolvedValue(json({ object: 'list', data: [{ id: ' model-a ', owned_by: SECRET }, { id: 'model-a' }, { id: 'model-b' }] }));
    const response = await list();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [{ id: 'model-a' }, { id: 'model-b' }] });
    expect(response.body).not.toContain(SECRET);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://provider.example.test/gateway/v1/models?api-version=2026');
    expect(init).toMatchObject({ method: 'GET', redirect: 'error', signal: expect.any(AbortSignal) });
    expect(init?.body).toBeUndefined();
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe(`Bearer ${SECRET}`);
    expect(headers.get('X-Project')).toBe('project-1');
    expect(headers.get('Accept')).toBe('application/json');
    expect(snapshot()).toEqual(before);
    expect(db.prepare('SELECT * FROM transactions').all()).toEqual(ledger);
  });

  it.each([
    ['chat-completions', 'https://provider.example.test/v1/chat/completions/', 'https://provider.example.test/v1/models'],
    ['responses', 'https://provider.example.test/proxy/openai/v1/responses?x=1', 'https://provider.example.test/proxy/openai/v1/models?x=1'],
    ['responses', 'http://localhost:9000/responses/', 'http://localhost:9000/models'],
  ] as const)('derives %s models endpoint without changing origin', async (mode, url, expected) => {
    save({ mode, url, auth: { kind: 'none' } });
    expect((await list()).json()).toEqual({ items: [] });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(expected);
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has('authorization')).toBe(false);
  });

  it('reuses saved custom authentication header', async () => {
    save({ auth: { kind: 'header', headerName: 'X-Provider-Secret' } });
    expect((await list()).statusCode).toBe(200);
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('X-Provider-Secret')).toBe(SECRET);
  });

  it('ignores supplied destination/model/secret and never saves draft request fields', async () => {
    save();
    const before = snapshot();
    const response = await app.inject({ method: 'POST', url: '/api/v1/ai/models', headers: { ...CSRF, Cookie: cookie }, payload: { url: 'https://attacker.test/responses', model: 'changed', secret: 'changed' } });
    expect(response.statusCode).toBe(200);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('provider.example.test/gateway/v1/models');
    expect(snapshot()).toEqual(before);
  });

  it('rejects missing config and missing saved credential before any call', async () => {
    expect((await list()).json().error.code).toBe('AI_NOT_CONFIGURED');
    save({ secret: '', clearSecret: true });
    expect((await list()).json().error.code).toBe('AI_SECRET_UNAVAILABLE');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { mode: 'custom' }, { method: 'GET' }, { mode: 'responses' },
    { url: 'https://provider.test/v1/chat/completions/extra' },
    { url: 'https://provider.test/v1/chat/completions#secret' },
    { url: `https://user:${SECRET}@provider.test/v1/chat/completions` },
    { url: 'https://provider.test/v1/{{model}}/chat/completions' },
    { url: 'https://provider.test/v1/chat/completions?x=%7B%7Bmodel%7D%7D' },
    { url: 'https://provider.test/v1/%63hat/completions' },
    { url: 'https://provider.test/v1/../chat/completions' },
    { url: 'https://provider.test//chat/completions' },
    { url: 'https://provider.test/v1/chat\\completions' },
    { url: 'file:///chat/completions' }, { url: 'not-a-url' }, { url: '' },
  ] satisfies AiProviderConfigInput[])('rejects unsupported/ambiguous saved config %j with no upstream call', async (input) => {
    save(input);
    const before = snapshot();
    const response = await list();
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: { code: 'AI_CONFIG_INVALID', message: expect.stringContaining('手动') } });
    expect(response.body).not.toContain(SECRET);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(snapshot()).toEqual(before);
  });

  it('also lists an enabled saved provider without changing its selected model', async () => {
    save({ enabled: true, model: 'keep-selected' });
    const before = snapshot();
    expect((await list()).statusCode).toBe(200);
    expect(snapshot()).toEqual(before);
    expect(configs.summary().model).toBe('keep-selected');
  });

  it('redacts invalid saved header/config details before making any call', async () => {
    save();
    const saved = configs.getStoredForModelListingOrThrow();
    db.prepare('UPDATE settings SET value_json = ? WHERE key = ?').run(JSON.stringify({ ...saved, headers: { [`bad ${SECRET}`]: 'value' } }), 'ai.provider.v1');
    const response = await list();
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('AI_CONFIG_INVALID');
    expect(response.body).not.toContain(SECRET);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rechecks production HTTPS even for a disabled saved connection', () => {
    save({ url: 'http://provider.test/v1/chat/completions' });
    const production = new AiConfigService(db, { aiEncryptionKey: KEY, production: true });
    expect(() => production.getStoredForModelListingOrThrow()).toThrow(/HTTPS/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([null, [], { items: [] }, { data: null }, { data: [{}] }, { data: [null] }, { data: [{ id: 1 }] }, { data: [{ id: '  ' }] }, { data: [{ id: 'a'.repeat(201) }] }, { data: [{ id: '\nmodel' }] }, { data: [{ id: 'a\u007fb' }] }, { data: [{ id: 'a\u0085b' }] }, { data: Array.from({ length: 2001 }, () => ({ id: 'duplicate' })) }])('rejects malformed/over-cap raw list without partial output', async (payload) => {
    save();
    const before = snapshot();
    fetchMock.mockResolvedValue(json(payload));
    const response = await list();
    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: { code: 'AI_RESPONSE_INVALID', message: 'Internal Server Error' } });
    expect(snapshot()).toEqual(before);
  });

  it('accepts the exact 2000 raw row / 200 id character caps', async () => {
    save();
    const id = 'm'.repeat(200);
    fetchMock.mockResolvedValue(json({ data: Array.from({ length: 2000 }, () => ({ id })) }));
    expect((await list()).json()).toEqual({ items: [{ id }] });
  });

  it.each([401, 403, 429, 500, 302])('redacts HTTP %s body/status text and never retries or follows redirects', async (status) => {
    save();
    const before = snapshot();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(SECRET)); }, cancel });
    fetchMock.mockResolvedValue(new Response(body, { status, statusText: SECRET, headers: { location: 'https://attacker.test' } }));
    const response = await list();
    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe('AI_PROVIDER_ERROR');
    expect(response.body).not.toContain(SECRET);
    expect(cancel).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(snapshot()).toEqual(before);
  });

  it('redacts arbitrary thrown network errors', async () => {
    save();
    fetchMock.mockRejectedValue(new Error(`${SECRET} ${URL}`));
    const response = await list();
    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe('AI_PROVIDER_ERROR');
    expect(response.body).not.toContain(SECRET);
    expect(response.body).not.toContain('provider.example');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid JSON safely', async () => {
    save();
    fetchMock.mockResolvedValue(new Response(`not json ${SECRET}`));
    const response = await list();
    expect(response.json().error.code).toBe('AI_RESPONSE_INVALID');
    expect(response.body).not.toContain(SECRET);
  });

  it('accepts exactly 2MiB including harmless provider metadata', async () => {
    save();
    const base = JSON.stringify({ data: [], extra: '' });
    const text = JSON.stringify({ data: [], extra: 'x'.repeat(2 * 1024 * 1024 - Buffer.byteLength(base)) });
    expect(Buffer.byteLength(text)).toBe(2 * 1024 * 1024);
    fetchMock.mockResolvedValue(new Response(text));
    expect((await list()).json()).toEqual({ items: [] });
  });

  it('rejects a missing response body safely', async () => {
    save();
    fetchMock.mockResolvedValue(new Response(null));
    const response = await list();
    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe('AI_PROVIDER_ERROR');
  });

  it('rejects invalid UTF-8 without exposing upstream bytes', async () => {
    save();
    fetchMock.mockResolvedValue(new Response(new Uint8Array([0xff, 0xfe])));
    const response = await list();
    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe('AI_PROVIDER_ERROR');
  });

  it.each(['declared', 'streamed'] as const)('enforces 2MiB %s body cap and cancels the response', async (kind) => {
    save();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); }, cancel });
    fetchMock.mockResolvedValue(new Response(body, { headers: kind === 'declared' ? { 'content-length': String(2 * 1024 * 1024 + 1) } : {} }));
    const response = await list();
    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe('AI_PROVIDER_ERROR');
    expect(cancel).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['headers', 'body'] as const)('bounds stalled %s even when transport ignores abort, without retries or config changes', async (stage) => {
    save({ timeoutMs: 3000 });
    const before = snapshot();
    const cancel = vi.fn();
    if (stage === 'headers') fetchMock.mockImplementation(() => new Promise<Response>(() => undefined));
    else fetchMock.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({ cancel })));
    vi.useFakeTimers();
    const saved = configs.getStoredForModelListingOrThrow();
    const pending = new AiProviderService(fetchMock).listModels(saved, configs.getSecretOrThrow(saved));
    const assertion = expect(pending).rejects.toMatchObject({ statusCode: 504, code: 'AI_PROVIDER_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(3000);
    await assertion;
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    if (stage === 'body') expect(cancel).toHaveBeenCalled();
    expect(snapshot()).toEqual(before);
    expect(vi.getTimerCount()).toBe(0);
  });
});
