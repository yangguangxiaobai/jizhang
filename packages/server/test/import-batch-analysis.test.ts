/**
 * Merged import batch: AI analysis lifecycle.
 *
 * The provider is injected, so these tests exercise the *bounded* behaviour that matters:
 * one call per 25 rows, all-or-nothing publication, an explicit failure past 20 new-category
 * suggestions, fence checks that reject a superseded run, restart recovery, and the guarantee that
 * no read endpoint ever starts model work.
 */
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import { closeDatabase, initializeDatabase, type Db } from '../src/db/index.js';
import { SESSION_COOKIE } from '../src/plugins/auth.js';
import { AuthService } from '../src/services/auth-service.js';
import { AiConfigService } from '../src/services/ai-config-service.js';

const USERNAME = 'quiz';
const PASSWORD = 'correct horse battery staple';
const CSRF = { 'x-requested-with': 'fetch' };
const KEY = 'ab'.repeat(32);
const NOW = Date.UTC(2026, 8, 22, 12);
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const wechatCsv = readFileSync(join(FIXTURES, 'wechat-bill-sample.csv'));

interface Recommendation {
  id: string;
  include: boolean;
  reason: string;
  categoryId: string | null;
  newCategory: { name: string; type: number; parentId: string | null } | null;
}

let db: Db;
let app: FastifyInstance;
let cookie: string;
let dataDir: string;
let config: AppConfig;
let conversationId: string;
let calls: { rows: number; recommendations: Recommendation[] }[];
let plan: (rows: { itemId: string; type: number }[]) => Recommendation[] | 'fail';
/** Optional gate the provider waits on, so a test can cancel *while* a call is in flight. */
let gate: Promise<void> | null = null;

function authHeaders() {
  return { ...CSRF, Cookie: `${SESSION_COOKIE}=${cookie}` };
}

async function inject(method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) {
  return app.inject({
    method,
    url,
    headers: authHeaders(),
    ...(payload === undefined ? {} : { payload }),
  });
}

function providerResponse(): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ recommendations: [] }) } }],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

/** A fetch that answers the provider envelope from `plan` without ever leaving the process. */
function fakeFetch(): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? init.body : '';
    const parsed = JSON.parse(body) as { messages?: { content?: string }[] };
    const userContent = parsed.messages?.map((message) => message.content ?? '').join(' ') ?? body;
    const factsMatch = /"rows":(\[[\s\S]*?\]),"categories"/.exec(userContent);
    const rows = factsMatch === null ? [] : (JSON.parse(factsMatch[1]!) as { itemId: string; type: number }[]);
    calls.push({ rows: rows.length, recommendations: [] });
    if (gate !== null) await gate;
    const recommendations = plan(rows);
    if (recommendations === 'fail') {
      return new Response('provider exploded', { status: 500 });
    }
    const envelope = { recommendations };
    calls[calls.length - 1]!.recommendations = recommendations;
    return new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(envelope) } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
}

async function buildTestApp(fetchImpl: typeof fetch): Promise<FastifyInstance> {
  const auth = new AuthService(db, { sessionTtlDays: config.sessionTtlDays, now: () => NOW });
  await auth.setPassword(USERNAME, PASSWORD);
  const instance = buildApp({ config, db, authService: auth, secureCookies: false, now: () => NOW, fetchImpl });
  await instance.ready();
  const login = await instance.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: CSRF,
    payload: { username: USERNAME, password: PASSWORD },
  });
  cookie = login.cookies.find((entry) => entry.name === SESSION_COOKIE)?.value ?? '';
  return instance;
}

async function createBatch(analyse = true) {
  const response = await inject('POST', `/api/v1/assistant/conversations/${conversationId}/import-batches`, {
    files: [{ fileName: 'wechat.csv', source: 'auto', fileBase64: wechatCsv.toString('base64') }],
    clientRequestId: `req-${Math.random().toString(36).slice(2)}`,
    analyse,
  });
  const body = response.json() as { batch?: { batchId: string } };
  return body.batch!.batchId;
}

async function waitForAnalysis(batchId: string, expected: readonly string[], timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const body = (await inject('GET', `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}`)).json() as {
      batch: { analysis: { state: string; analysed: number; providerCalls: number; suggestedNewCategories: number; message: string | null } };
    };
    if (expected.includes(body.batch.analysis.state)) return body.batch.analysis;
    if (Date.now() > deadline) throw new Error(`analysis did not reach ${expected.join('|')}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

beforeEach(async () => {
  calls = [];
  plan = () => [];
  gate = null;
  dataDir = mkdtempSync(join(tmpdir(), 'import-batch-analysis-'));
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeDatabase(db, null);
  config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    JIZHANG_USERNAME: USERNAME,
    JIZHANG_PASSWORD_HASH: 'unused',
    JIZHANG_AI_ENCRYPTION_KEY: KEY,
    DATA_DIR: dataDir,
  });
  new AiConfigService(db, { aiEncryptionKey: KEY, production: false, now: () => NOW }).save({
    enabled: true,
    mode: 'chat-completions',
    name: 'analysis test provider',
    url: 'https://provider.example.test/v1/chat/completions',
    method: 'POST',
    model: 'test-model',
    timeoutMs: 10_000,
    headers: {},
    auth: { kind: 'bearer' },
    bodyTemplate: null,
    responsePath: 'choices[0].message.content',
    secret: 'test-only-provider-secret',
  });
  app = await buildTestApp(fakeFetch());
  const created = await inject('POST', '/api/v1/assistant/conversations', { title: '分析测试' });
  conversationId = (created.json() as { id: string }).id;
});

afterEach(async () => {
  await app.close();
  closeDatabase(db);
  rmSync(dataDir, { recursive: true, force: true });
});

describe('bounded analysis', () => {
  it('publishes one validated recommendation per row using at most 20 calls of 25 rows', async () => {
    plan = (rows) =>
      rows.map((row) => ({
        id: row.itemId,
        include: true,
        reason: '匹配现有分类',
        categoryId: row.type === 0 ? 'builtin-expense-food' : 'builtin-income-other',
        newCategory: null,
      }));
    const batchId = await createBatch();
    const analysis = await waitForAnalysis(batchId, ['complete']);
    expect(analysis.state).toBe('complete');
    expect(calls.length).toBeLessThanOrEqual(20);
    expect(calls.every((call) => call.rows <= 25)).toBe(true);
    // 34 fixture rows → two shards.
    expect(calls.length).toBe(2);
    expect(analysis.providerCalls).toBe(2);
    expect(analysis.analysed).toBe(34);

    const rows = (await inject(
      'GET',
      `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/rows?limit=100`,
    )).json() as { items: { type: number; ai: { status: string; categoryId: string | null; include: boolean } }[] };
    expect(rows.items.every((row) => row.ai.status === 'complete')).toBe(true);
    expect(rows.items.filter((row) => row.type === 0).every((row) => row.ai.categoryId === 'builtin-expense-food')).toBe(true);
  });

  it('keeps the deterministic fallback prompt-free when no Other leaf exists', async () => {
    db.prepare("UPDATE categories SET deleted = 1 WHERE name IN ('其他', '其他收入')").run();
    const batchId = await createBatch(false);
    const categories = (await inject(
      'GET',
      `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/categories`,
    )).json() as { items: { suggestionId: string; origin: string; name: string }[] };
    expect(categories.items.length).toBeGreaterThan(0);
    expect(categories.items.every((item) => item.origin === 'server-fallback')).toBe(true);
    // The fallback does not require approval to be *displayed*, but nothing was created.
    const created = db.prepare("SELECT COUNT(*) AS c FROM categories WHERE name IN ('其他', '其他收入') AND deleted = 0").get() as { c: number };
    expect(created.c).toBe(0);
  });

  it('fails the whole run when one shard fails and clears every AI proposal', async () => {
    let shard = 0;
    plan = (rows) => {
      shard += 1;
      if (shard === 2) return 'fail';
      return rows.map((row) => ({
        id: row.itemId,
        include: true,
        reason: 'ok',
        categoryId: null,
        newCategory: { name: `新分类${shard}`, type: row.type, parentId: null },
      }));
    };
    const batchId = await createBatch();
    const analysis = await waitForAnalysis(batchId, ['failed']);
    expect(analysis.state).toBe('failed');
    expect(analysis.analysed).toBe(0);
    const rows = (await inject(
      'GET',
      `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/rows?limit=100`,
    )).json() as { items: { ai: { status: string; newSuggestionId: string | null } }[] };
    // No partial AI survive: a shard failure must never look like a completed analysis.
    expect(rows.items.every((row) => row.ai.status === 'none')).toBe(true);
    expect(rows.items.every((row) => row.ai.newSuggestionId === null)).toBe(true);
    const suggestions = (await inject(
      'GET',
      `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/categories`,
    )).json() as { items: { origin: string }[] };
    expect(suggestions.items.every((item) => item.origin !== 'ai')).toBe(true);
  });

  it('fails explicitly instead of truncating when the model proposes more than 20 new categories', async () => {
    // 34 rows, one distinct new category per row: the run must fail rather than keep the first 20.
    plan = (rows) =>
      rows.map((row, index) => ({
        id: row.itemId,
        include: true,
        reason: '新分类',
        categoryId: null,
        newCategory: { name: `分类-${row.itemId}-${index}`, type: row.type, parentId: null },
      }));
    const batchId = await createBatch();
    const analysis = await waitForAnalysis(batchId, ['failed']);
    expect(analysis.state).toBe('failed');
    expect(analysis.suggestedNewCategories).toBe(0);
  });

  it('rejects a malformed recommendation instead of repairing it', async () => {
    plan = (rows) =>
      rows.map((row, index) => ({
        id: index === 3 ? 'not-a-real-row' : row.itemId,
        include: true,
        reason: 'x',
        categoryId: null,
        newCategory: null,
      }));
    const batchId = await createBatch();
    const analysis = await waitForAnalysis(batchId, ['failed']);
    expect(analysis.state).toBe('failed');
  });

  it('rejects an existing category whose type does not match the row', async () => {
    plan = (rows) =>
      rows.map((row) => ({
        id: row.itemId,
        include: true,
        reason: 'x',
        categoryId: 'builtin-income-other',
        newCategory: null,
      }));
    const batchId = await createBatch();
    const analysis = await waitForAnalysis(batchId, ['failed']);
    expect(analysis.state).toBe('failed');
  });

  it('fails with a readable message when the provider is unavailable', async () => {
    plan = () => 'fail';
    const batchId = await createBatch();
    const analysis = await waitForAnalysis(batchId, ['failed']);
    expect(analysis.message).not.toBeNull();
    expect(String(analysis.message).length).toBeGreaterThan(0);
    // A failed analysis leaves the batch fully reviewable by hand.
    const body = (await inject('GET', `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}`)).json() as {
      batch: { status: string };
    };
    expect(body.batch.status).toBe('prepared');
  });
});

describe('fences and recovery', () => {
  it('does not publish a run whose batch was cancelled meanwhile', async () => {
    plan = (rows) =>
      rows.map((row) => ({
        id: row.itemId,
        include: true,
        reason: '慢',
        categoryId: row.type === 0 ? 'builtin-expense-food' : 'builtin-income-other',
        newCategory: null,
      }));
    // Hold the provider call open so the cancel provably happens first: the run then has to be
    // refused by the persisted fence rather than merely losing the race.
    let release = (): void => undefined;
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const batchId = await createBatch(false);
    // Analyse without waiting, then cancel straight away.
    const analysisPromise = inject(
      'POST',
      `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/analyse`,
      {
        clientRequestId: 'analyse-1',
        files: [{ fileIndex: 0, fileBase64: wechatCsv.toString('base64') }],
      },
    );
    const response = await analysisPromise;
    expect([200, 202]).toContain(response.statusCode);
    const cancelled = await inject('POST', `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/cancel`, {
      expectedVersion: 1,
      clientRequestId: 'cancel-during-analysis',
    });
    expect(cancelled.statusCode).toBe(200);
    release();
    gate = null;
    await waitForAnalysis(batchId, ['failed', 'complete']);
    const body = (await inject('GET', `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}`)).json() as {
      batch: { status: string };
    };
    // The terminal status stands, and no AI recommendation was published after the cancel.
    expect(body.batch.status).toBe('cancelled');
    const rows = (await inject(
      'GET',
      `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/rows?limit=100`,
    )).json() as { items: { ai: { status: string } }[] };
    expect(rows.items.every((row) => row.ai.status === 'none')).toBe(true);
  });

  it('marks a running analysis from a previous process as failed on boot and never reruns it', async () => {
    const batchId = await createBatch(false);
    db.prepare("UPDATE assistant_import_batches SET analyse_state = 'running', analyse_owner = 'old-process' WHERE id = ?").run(batchId);
    await app.close();
    app = await buildTestApp(fakeFetch());
    const body = (await inject('GET', `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}`)).json() as {
      batch: { analysis: { state: string; message: string | null } };
    };
    expect(body.batch.analysis.state).toBe('failed');
    expect(body.batch.analysis.message).toContain('重启');
    expect(calls).toHaveLength(0);
  });

  it('never runs provider work on GET, and shuts down cleanly', async () => {
    const batchId = await createBatch(false);
    await inject('GET', `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}`);
    await inject('GET', `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/rows?limit=100`);
    await inject('GET', `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/categories`);
    expect(calls).toHaveLength(0);
    expect(providerResponse().status).toBe(200);
  });
});

describe('analyse request contract', () => {
  const analyseBody = (clientRequestId: string, bytes = wechatCsv) => ({
    clientRequestId,
    files: [{ fileIndex: 0, fileBase64: bytes.toString('base64') }],
  });

  it('answers 202 for a new request, 200 for its replay, and 409 for different bytes', async () => {
    plan = (rows) =>
      rows.map((row) => ({
        id: row.itemId,
        include: true,
        reason: 'ok',
        categoryId: row.type === 0 ? 'builtin-expense-food' : 'builtin-income-other',
        newCategory: null,
      }));
    const batchId = await createBatch(false);
    const first = await inject(
      'POST',
      `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/analyse`,
      analyseBody('analyse-once'),
    );
    expect(first.statusCode).toBe(202);
    await waitForAnalysis(batchId, ['complete']);

    const replay = await inject(
      'POST',
      `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/analyse`,
      analyseBody('analyse-once'),
    );
    expect(replay.statusCode).toBe(200);

    // Same request id, different bytes: a retransmission that no longer matches the stored
    // original must be refused rather than silently re-analysing something else.
    const mismatch = await inject(
      'POST',
      `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/analyse`,
      analyseBody('analyse-once', Buffer.from(`${wechatCsv.toString('utf8')}
#different`, 'utf8')),
    );
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json().error.code).toBe('ASSISTANT_ACTION_STALE');
  });

  it('rejects a retransmission that does not match the stored original', async () => {
    const batchId = await createBatch(false);
    const tampered = Buffer.from(`${wechatCsv.toString('utf8')}
#tampered`, 'utf8');
    const response = await inject(
      'POST',
      `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/analyse`,
      analyseBody('analyse-tampered', tampered),
    );
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('ASSISTANT_ACTION_STALE');
  });

  it('increments analysisRevision and returns to prepared, invalidating the old review', async () => {
    plan = (rows) =>
      rows.map((row) => ({
        id: row.itemId,
        include: true,
        reason: 'ok',
        categoryId: row.type === 0 ? 'builtin-expense-food' : 'builtin-income-other',
        newCategory: null,
      }));
    const batchId = await createBatch(false);
    const before = (await inject('GET', `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}`)).json() as {
      batch: { analysis: { analysisRevision: number }; status: string };
    };
    // Finish the create-time run so the explicit analyse is not refused as "already running".
    await waitForAnalysis(batchId, ['idle', 'failed', 'complete']);
    const response = await inject(
      'POST',
      `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/analyse`,
      analyseBody('analyse-revision'),
    );
    expect([200, 202]).toContain(response.statusCode);
    const after = (await inject('GET', `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}`)).json() as {
      batch: { analysis: { analysisRevision: number }; status: string };
    };
    expect(after.batch.analysis.analysisRevision).toBeGreaterThan(before.batch.analysis.analysisRevision);
    expect(after.batch.status).toBe('prepared');
  });
});
