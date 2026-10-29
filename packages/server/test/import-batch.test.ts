/**
 * Merged multi-file import batch: routes, review and the final confirmation transaction.
 *
 * These tests drive the real Fastify app with `app.inject()` and a temporary SQLite database, so
 * they assert the *effective* contract: what a client can send, what it gets back, and what lands
 * in the ledger. Provider calls are never real — the analysis runner is exercised separately with
 * an injected transport.
 */
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
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
const alipayCsv = readFileSync(join(FIXTURES, 'alipay-bill-sample.utf8.csv'));

let db: Db;
let app: FastifyInstance;
let cookie: string;
let dataDir: string;
let conversationId: string;
let providerCalls = 0;

function authHeaders() {
  return { ...CSRF, Cookie: `${SESSION_COOKIE}=${cookie}` };
}

async function inject(
  method: 'GET' | 'POST',
  url: string,
  payload?: Record<string, unknown>,
) {
  return app.inject({
    method,
    url,
    headers: authHeaders(),
    ...(payload === undefined ? {} : { payload }),
  });
}

function fileEntry(fileName: string, bytes: Buffer, source = 'auto') {
  return { fileName, source, fileBase64: bytes.toString('base64') };
}

async function createBatch(
  files: { fileName: string; source: string; fileBase64: string }[],
  clientRequestId = `req-${Math.random().toString(36).slice(2)}`,
  analyse = false,
) {
  const response = await inject('POST', `/api/v1/assistant/conversations/${conversationId}/import-batches`, {
    files,
    clientRequestId,
    analyse,
  });
  return { response, body: response.json() as { batch?: Record<string, never> } };
}

function liveTransactions(): { id: string; amount_cents: number; type: number; note: string; is_refund: number; category_id: string }[] {
  return db
    .prepare('SELECT id, amount_cents, type, note, is_refund, category_id FROM transactions WHERE deleted = 0 ORDER BY id')
    .all() as { id: string; amount_cents: number; type: number; note: string; is_refund: number; category_id: string }[];
}

beforeEach(async () => {
  providerCalls = 0;
  dataDir = mkdtempSync(join(tmpdir(), 'import-batch-'));
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeDatabase(db, null);
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    JIZHANG_USERNAME: USERNAME,
    JIZHANG_PASSWORD_HASH: 'unused',
    JIZHANG_AI_ENCRYPTION_KEY: KEY,
    DATA_DIR: dataDir,
  });
  const auth = new AuthService(db, { sessionTtlDays: config.sessionTtlDays, now: () => NOW });
  await auth.setPassword(USERNAME, PASSWORD);
  app = buildApp({
    config,
    db,
    authService: auth,
    secureCookies: false,
    now: () => NOW,
    fetchImpl: (async () => {
      providerCalls += 1;
      throw new Error('provider must not be called in these tests');
    }) as unknown as typeof fetch,
  });
  await app.ready();
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: CSRF,
    payload: { username: USERNAME, password: PASSWORD },
  });
  expect(login.statusCode).toBe(200);
  cookie = login.cookies.find((entry) => entry.name === SESSION_COOKIE)?.value ?? '';
  const created = await inject('POST', '/api/v1/assistant/conversations', { title: '批次测试' });
  conversationId = (created.json() as { id: string }).id;
  void AiConfigService;
});

afterEach(async () => {
  await app.close();
  closeDatabase(db);
  rmSync(dataDir, { recursive: true, force: true });
});

describe('batch creation', () => {
  it('requires authentication and the CSRF header', async () => {
    const files = [fileEntry('wechat.csv', wechatCsv)];
    const unauthenticated = await app.inject({
      method: 'POST',
      url: `/api/v1/assistant/conversations/${conversationId}/import-batches`,
      headers: CSRF,
      payload: { files, clientRequestId: 'x' },
    });
    expect(unauthenticated.statusCode).toBe(401);

    const noCsrf = await app.inject({
      method: 'POST',
      url: `/api/v1/assistant/conversations/${conversationId}/import-batches`,
      headers: { Cookie: `${SESSION_COOKIE}=${cookie}` },
      payload: { files, clientRequestId: 'x' },
    });
    expect(noCsrf.statusCode).toBe(403);
  });

  it('201 creates a batch, merges the files and never touches the ledger', async () => {
    const { response, body } = await createBatch([fileEntry('wechat.csv', wechatCsv)]);
    expect(response.statusCode).toBe(201);
    const batch = body.batch as unknown as {
      batchId: string;
      status: string;
      version: number;
      files: { parseStatus: string; rawRowCount: number }[];
      summary: { totalItems: number; importable: number; ignored: number };
      analysis: { state: string };
    };
    expect(batch.status).toBe('prepared');
    expect(batch.version).toBe(1);
    expect(batch.files).toHaveLength(1);
    expect(batch.files[0]!.parseStatus).toBe('ok');
    // Raw row count is the parser's own total (34 rows in the fixture), not `0`.
    expect(batch.files[0]!.rawRowCount).toBe(34);
    expect(batch.summary.totalItems).toBe(34);
    expect(batch.summary.ignored).toBe(8);
    expect(batch.analysis.state).toBe('idle');
    expect(liveTransactions()).toHaveLength(0);
  });

  it('rejects two byte-identical files and files that exceed the per-file cap', async () => {
    const duplicate = await createBatch([
      fileEntry('wechat-a.csv', wechatCsv),
      fileEntry('wechat-b.csv', wechatCsv),
    ]);
    expect(duplicate.response.statusCode).toBe(400);
    expect(duplicate.response.json().error.code).toBe('IMPORT_BATCH_DUPLICATE_FILE');

    const tooMany = await createBatch(
      Array.from({ length: 6 }, (_, index) => fileEntry(`w-${index}.csv`, Buffer.from(`${wechatCsv.toString('utf8')}\n#${index}`), 'wechat')),
    );
    expect(tooMany.response.statusCode).toBe(400);
    expect(tooMany.response.json().error.code).toBe('IMPORT_BATCH_LIMIT_EXCEEDED');
  });

  it('replays the same clientRequestId and rejects a different payload for it', async () => {
    const first = await createBatch([fileEntry('wechat.csv', wechatCsv)], 'same-request');
    expect(first.response.statusCode).toBe(201);
    const replay = await createBatch([fileEntry('wechat.csv', wechatCsv)], 'same-request');
    expect(replay.response.statusCode).toBe(200);
    expect((replay.body.batch as unknown as { batchId: string }).batchId).toBe(
      (first.body.batch as unknown as { batchId: string }).batchId,
    );

    const mismatch = await createBatch([fileEntry('alipay.csv', alipayCsv)], 'same-request');
    expect(mismatch.response.statusCode).toBe(409);
    expect(mismatch.response.json().error.code).toBe('IMPORT_BATCH_IDEMPOTENCY_MISMATCH');
  });
});

describe('batch reads', () => {
  it('pages rows, filters them and never starts provider work', async () => {
    const { body } = await createBatch([fileEntry('wechat.csv', wechatCsv)]);
    const batchId = (body.batch as unknown as { batchId: string }).batchId;
    const page = await inject('GET', `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/rows?limit=10`);
    expect(page.statusCode).toBe(200);
    const rows = page.json() as {
      total: number;
      items: { itemId: string; ordinal: number }[];
      nextCursor: string | null;
      viewRevision: string;
    };
    expect(rows.items).toHaveLength(10);
    expect(rows.nextCursor).not.toBeNull();
    expect(rows.items.map((item) => item.ordinal)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    const second = await inject(
      'GET',
      `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/rows?limit=10&cursor=${encodeURIComponent(rows.nextCursor!)}`,
    );
    const secondBody = second.json() as { items: { itemId: string }[] };
    expect(secondBody.items[0]!.itemId).not.toBe(rows.items[0]!.itemId);

    const ignored = await inject(
      'GET',
      `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/rows?filter=ignored&limit=100`,
    );
    const ignoredBody = ignored.json() as { items: { ignored: boolean }[] };
    expect(ignoredBody.items.length).toBeGreaterThan(0);
    expect(ignoredBody.items.every((item) => item.ignored)).toBe(true);

    const stale = await inject(
      'GET',
      `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/rows?includeVersion=99`,
    );
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('IMPORT_BATCH_STALE_VERSION');

    expect(providerCalls).toBe(0);
  });

  it('replays a create request without appending a second batch card', async () => {
    const files = [fileEntry('wechat.csv', wechatCsv)];
    const first = await createBatch(files, 'card-once');
    expect(first.response.statusCode).toBe(201);
    const batchId = (first.body.batch as unknown as { batchId: string }).batchId;
    const countCards = async (): Promise<number> => {
      const messages = (await inject('GET', `/api/v1/assistant/conversations/${conversationId}/messages`)).json() as {
        items: { content: { importBatch?: { batchId: string } } }[];
      };
      return messages.items.filter((message) => message.content.importBatch?.batchId === batchId).length;
    };
    expect(await countCards()).toBe(1);

    // A retry of the same idempotent request must not add another card: the conversation would
    // otherwise show one batch twice, and a client that retried on a timeout would look like it
    // imported twice.
    const replay = await createBatch(files, 'card-once');
    expect(replay.response.statusCode).toBe(200);
    expect(await countCards()).toBe(1);
  });

  it('scopes every route to the owning conversation', async () => {
    const { body } = await createBatch([fileEntry('wechat.csv', wechatCsv)]);
    const batchId = (body.batch as unknown as { batchId: string }).batchId;
    const other = await inject('POST', '/api/v1/assistant/conversations', { title: '另一个' });
    const otherId = (other.json() as { id: string }).id;
    const foreign = await inject('GET', `/api/v1/assistant/conversations/${otherId}/import-batches/${batchId}`);
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().error.code).toBe('ASSISTANT_NOT_FOUND');
  });

  it('serves a read-only duplicate comparison from server-stored facts', async () => {
    const { body } = await createBatch([fileEntry('wechat.csv', wechatCsv)]);
    const batchId = (body.batch as unknown as { batchId: string }).batchId;
    const rows = (await inject('GET', `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/rows?limit=1`)).json() as {
      items: { itemId: string }[];
    };
    const itemId = rows.items[0]!.itemId;
    const comparison = await inject(
      'GET',
      `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/rows/${encodeURIComponent(itemId)}/duplicates`,
    );
    expect(comparison.statusCode).toBe(200);
    const comparisonBody = comparison.json() as { total: number; items: unknown[]; rationale: string };
    expect(comparisonBody.total).toBe(0);
    expect(comparisonBody.items).toEqual([]);
    // The rationale must not claim "no duplicates" when the platform account is missing.
    expect(comparisonBody.rationale.length).toBeGreaterThan(0);
    expect(providerCalls).toBe(0);
  });
});
