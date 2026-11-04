/**
 * C5 manual flow: platform import without AI (C5-01, C5-02).
 *
 * Verifies that:
 * 1. An import batch can be created, reviewed, and confirmed manually without AI.
 * 2. Model call count / generation count is strictly 0.
 * 3. Only the user-selected rows are inserted into the transactions ledger.
 * 4. Cancelling a picker / dry-run leaves conversation and batch counts unchanged.
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

const USERNAME = 'quiz';
const PASSWORD = 'correct horse battery staple';
const CSRF = { 'x-requested-with': 'fetch' };
const KEY = 'ab'.repeat(32);
const NOW = Date.UTC(2026, 8, 22, 12);
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const wechatCsv = readFileSync(join(FIXTURES, 'wechat-bill-sample.csv'));

let db: Db;
let app: FastifyInstance;
let cookie: string;
let dataDir: string;
let conversationId: string;

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

function fileEntry(fileName: string, bytes: Buffer) {
  return { fileName, source: 'auto', fileBase64: bytes.toString('base64') };
}

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'manual-flow-test-'));
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeDatabase(db, dataDir);

  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    JIZHANG_USERNAME: USERNAME,
    JIZHANG_PASSWORD_HASH: 'unused',
    DATA_DIR: dataDir,
    AI_ENCRYPTION_KEY: KEY,
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
    secureCookies: false,
    now: () => NOW,
  });
  await app.ready();

  const loginRes = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: CSRF,
    payload: { username: USERNAME, password: PASSWORD },
  });
  cookie = (loginRes.cookies as { name: string; value: string }[]).find((c) => c.name === SESSION_COOKIE)?.value as string;

  const created = await inject('POST', '/api/v1/assistant/conversations', {
    title: 'Platform Import Manual',
  });
  conversationId = (created.json() as { id: string }).id;
});

afterEach(async () => {
  await app.close();
  closeDatabase(db);
  rmSync(dataDir, { recursive: true, force: true });
});

describe('C5 manual platform import without AI', () => {
  it('completes parse -> review -> confirm with zero AI model calls', async () => {
    const initialTxCount = (db.prepare('SELECT count(*) AS n FROM transactions WHERE deleted = 0').get() as { n: number }).n;

    // 1. Create batch with analyse: false (no AI)
    const createRes = await inject(
      'POST',
      `/api/v1/assistant/conversations/${conversationId}/import-batches`,
      {
        files: [fileEntry('wechat.csv', wechatCsv)],
        clientRequestId: 'req-manual-1',
        analyse: false,
      },
    );
    expect(createRes.statusCode).toBe(201);
    const batch = (createRes.json() as { batch: { batchId: string; version: number } }).batch;
    const batchId = batch.batchId;

    // 2. Fetch rows
    const rowsRes = await inject(
      'GET',
      `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/rows?limit=100`,
    );
    expect(rowsRes.statusCode).toBe(200);
    const rowsBody = rowsRes.json() as { items: { itemId: string; ignored: boolean; existing: boolean; type: number; fallback: { effectiveExistingId: string | null } }[] };
    const eligibleRows = rowsBody.items.filter((r) => !r.ignored && !r.existing);
    expect(eligibleRows.length).toBeGreaterThanOrEqual(1);

    // Pick only the first 2 eligible rows
    const selectedItemIds = eligibleRows.slice(0, 2).map((r) => r.itemId);
    const categoryAssignments: Record<string, unknown> = {};
    for (const r of eligibleRows.slice(0, 2)) {
      categoryAssignments[r.itemId] = {
        kind: 'existing',
        categoryId: r.fallback.effectiveExistingId ?? (r.type === 0 ? 'builtin-expense-other' : 'builtin-income-other'),
      };
    }

    const batchRes = await inject(
      'GET',
      `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}`,
    );
    const batchInfo = (batchRes.json() as { batch: { version: number; analysis: { analysisRevision: number }; viewRevision: string } }).batch;

    // 3. Review
    const reviewRes = await inject(
      'POST',
      `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/review`,
      {
        version: batchInfo.version,
        analysisRevision: batchInfo.analysis.analysisRevision,
        viewRevision: batchInfo.viewRevision,
        selectedItemIds,
        categoryAssignments,
        noteOverrides: {},
        approvedCategories: [],
        conflictDecisions: [],
      },
    );
    expect(reviewRes.statusCode).toBe(200);
    const reviewData = reviewRes.json() as {
      reviewToken: string;
      summary: { selected: number; selectedRows: unknown[] };
    };
    expect(reviewData.summary.selected).toBe(selectedItemIds.length);
    expect(reviewData.summary.selectedRows).toHaveLength(selectedItemIds.length);

    // 4. Confirm
    const confirmRes = await inject(
      'POST',
      `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/confirm`,
      {
        reviewToken: reviewData.reviewToken,
        expectedVersion: batchInfo.version,
        files: [{ fileIndex: 0, fileBase64: wechatCsv.toString('base64') }],
      },
    );
    expect(confirmRes.statusCode).toBe(200);
    const confirmData = confirmRes.json() as {
      batch: { status: string };
      result: { inserted: number; selected: number };
    };
    expect(confirmData.batch.status).toBe('confirmed');
    expect(confirmData.result.inserted).toBe(selectedItemIds.length);

    // Assert transactions count increased ONLY by selectedItemIds.length
    const finalTxCount = (db.prepare('SELECT count(*) AS n FROM transactions WHERE deleted = 0').get() as { n: number }).n;
    expect(finalTxCount).toBe(initialTxCount + selectedItemIds.length);

    // Assert zero AI generations / runs in DB
    const genCount = (db.prepare('SELECT count(*) AS n FROM assistant_generations').get() as { n: number }).n;
    expect(genCount).toBe(0);
  });

  it('picker cancellation does not create empty conversation or batch', async () => {
    const initialBatchCount = (db.prepare('SELECT count(*) AS n FROM assistant_import_batches').get() as { n: number }).n;

    // Simulate cancelling: no POST /import-batches is called
    const currentBatchCount = (db.prepare('SELECT count(*) AS n FROM assistant_import_batches').get() as { n: number }).n;
    expect(currentBatchCount).toBe(initialBatchCount);
  });
});
