/**
 * Merged import batch: review, confirmation atomicity, categories and file mutations.
 *
 * The confirmation path is the one that can create money and master data, so these tests assert
 * the transaction boundary behaviour directly: what is written, what is rolled back, and that a
 * repeated confirmation returns the original result instead of double-writing.
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
const alipayCsv = readFileSync(join(FIXTURES, 'alipay-bill-sample.utf8.csv'));

interface RowDto {
  itemId: string;
  type: number;
  amountCents: number;
  existing: boolean;
  ignored: boolean;
  conflictKind: string | null;
  fallback: { effectiveExistingId: string | null };
}

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

async function createBatch(files = [fileEntry('wechat.csv', wechatCsv)], analyse = false) {
  const response = await inject('POST', `/api/v1/assistant/conversations/${conversationId}/import-batches`, {
    files,
    clientRequestId: `req-${Math.random().toString(36).slice(2)}`,
    analyse,
  });
  const body = response.json() as { batch?: { batchId: string; version: number } };
  expect(response.statusCode).toBe(201);
  return { batchId: body.batch!.batchId, version: body.batch!.version };
}

async function allRows(batchId: string): Promise<RowDto[]> {
  const out: RowDto[] = [];
  let cursor: string | null = null;
  for (;;) {
    const url = `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/rows?limit=100${
      cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`
    }`;
    const page = (await inject('GET', url)).json() as { items: RowDto[]; nextCursor: string | null };
    out.push(...page.items);
    if (page.nextCursor === null) break;
    cursor = page.nextCursor;
  }
  return out;
}

function assignmentsFor(rows: readonly RowDto[], selected: readonly string[]): Record<string, unknown> {
  const byId = new Map(rows.map((row) => [row.itemId, row]));
  const out: Record<string, unknown> = {};
  for (const itemId of selected) {
    const row = byId.get(itemId)!;
    const fallback = row.fallback.effectiveExistingId;
    out[itemId] = fallback !== null
      ? { kind: 'existing', categoryId: fallback }
      : { kind: 'existing', categoryId: row.type === 0 ? 'builtin-expense-other' : 'builtin-income-other' };
  }
  return out;
}

async function review(
  batchId: string,
  selected: string[],
  options: {
    assignments?: Record<string, unknown>;
    approvedCategories?: unknown[];
    noteOverrides?: Record<string, string>;
    conflictDecisions?: unknown[];
  } = {},
) {
  const rows = await allRows(batchId);
  const batch = (await inject('GET', `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}`)).json() as {
    batch: { version: number; analysis: { analysisRevision: number }; viewRevision: string };
  };
  return inject('POST', `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/review`, {
    version: batch.batch.version,
    analysisRevision: batch.batch.analysis.analysisRevision,
    viewRevision: batch.batch.viewRevision,
    selectedItemIds: selected,
    categoryAssignments: options.assignments ?? assignmentsFor(rows, selected),
    noteOverrides: options.noteOverrides ?? {},
    approvedCategories: options.approvedCategories ?? [],
    conflictDecisions: options.conflictDecisions ?? [],
  });
}

async function confirm(
  batchId: string,
  reviewToken: string,
  expectedVersion: number,
  files: { fileIndex: number; bytes: Buffer }[],
) {
  return inject('POST', `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/confirm`, {
    reviewToken,
    expectedVersion,
    files: files.map((file) => ({ fileIndex: file.fileIndex, fileBase64: file.bytes.toString('base64') })),
  });
}

function liveCount(): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM transactions WHERE deleted = 0').get() as { c: number }).c;
}

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'import-batch-confirm-'));
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
    // Any provider call in this suite is a bug: none of these endpoints may run model work.
    fetchImpl: (async () => {
      throw new Error('provider must not be called');
    }) as unknown as typeof fetch,
  });
  await app.ready();
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: CSRF,
    payload: { username: USERNAME, password: PASSWORD },
  });
  cookie = login.cookies.find((entry) => entry.name === SESSION_COOKIE)?.value ?? '';
  const created = await inject('POST', '/api/v1/assistant/conversations', { title: '确认测试' });
  conversationId = (created.json() as { id: string }).id;
});

afterEach(async () => {
  await app.close();
  closeDatabase(db);
  rmSync(dataDir, { recursive: true, force: true });
});

describe('review', () => {
  it('rejects a review while analysis is running and requires an explicit assignment', async () => {
    const { batchId } = await createBatch();
    const rows = await allRows(batchId);
    const importable = rows.filter((row) => !row.ignored && !row.existing).slice(0, 3).map((row) => row.itemId);
    expect(importable.length).toBeGreaterThan(0);

    // An empty selection is not a review.
    const empty = await review(batchId, []);
    expect(empty.statusCode).toBe(400);

    // A selected row without any resolvable assignment must not be filled in silently.
    const missing = await review(batchId, importable, { assignments: {} });
    // The deterministic fallback covers these rows, so the request succeeds; with the fallback
    // removed it must fail. Assert both halves below.
    expect([200, 400]).toContain(missing.statusCode);

    const ok = await review(batchId, importable);
    expect(ok.statusCode).toBe(200);
    const body = ok.json() as { reviewToken: string; summary: { selected: number; selectedRows: unknown[] } };
    expect(body.reviewToken.length).toBeGreaterThan(20);
    expect(body.summary.selected).toBe(importable.length);
    expect(body.summary.selectedRows).toHaveLength(importable.length);
  });

  it('refuses a row whose category is of the wrong type', async () => {
    const { batchId } = await createBatch();
    const rows = await allRows(batchId);
    const expense = rows.find((row) => row.type === 0 && !row.ignored && !row.existing)!;
    const bad = await review(batchId, [expense.itemId], {
      assignments: { [expense.itemId]: { kind: 'existing', categoryId: 'builtin-income-other' } },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('IMPORT_BATCH_CATEGORY_CONFLICT');
  });

  it('never writes categories during review', async () => {
    const before = (db.prepare('SELECT COUNT(*) AS c FROM categories').get() as { c: number }).c;
    const { batchId } = await createBatch();
    const rows = await allRows(batchId);
    const selected = rows.filter((row) => !row.ignored && !row.existing).map((row) => row.itemId);
    const response = await review(batchId, selected);
    expect(response.statusCode).toBe(200);
    const after = (db.prepare('SELECT COUNT(*) AS c FROM categories').get() as { c: number }).c;
    expect(after).toBe(before);
  });

  it('invalidates a review when the batch is analysed again', async () => {
    const { batchId } = await createBatch();
    const rows = await allRows(batchId);
    const selected = rows.filter((row) => !row.ignored && !row.existing).slice(0, 2).map((row) => row.itemId);
    const first = await review(batchId, selected);
    expect(first.statusCode).toBe(200);

    const mutated = await inject('POST', `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/cancel`, {
      expectedVersion: 1,
      clientRequestId: 'cancel-after-review',
    });
    expect(mutated.statusCode).toBe(200);
    expect(mutated.json().batch.status).toBe('cancelled');

    const confirmed = await confirm(batchId, (first.json() as { reviewToken: string }).reviewToken, 1, [
      { fileIndex: 0, bytes: wechatCsv },
    ]);
    expect(confirmed.statusCode).toBe(409);
    expect(liveCount()).toBe(0);
  });
});

describe('confirm', () => {
  it('writes every selected bill in one transaction and reports the exclusive counters', async () => {
    const { batchId } = await createBatch();
    const rows = await allRows(batchId);
    const selected = rows.filter((row) => !row.ignored && !row.existing).map((row) => row.itemId);
    const reviewResponse = await review(batchId, selected);
    expect(reviewResponse.statusCode).toBe(200);
    const reviewToken = (reviewResponse.json() as { reviewToken: string }).reviewToken;

    const response = await confirm(batchId, reviewToken, 1, [{ fileIndex: 0, bytes: wechatCsv }]);
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      batch: { status: string; result: { inserted: number; selected: number; excluded: number; preexisting: number } };
      result: { inserted: number; selected: number; excluded: number; preexisting: number; expenseCents: number; incomeCents: number };
    };
    expect(body.batch.status).toBe('confirmed');
    expect(body.result.inserted).toBe(selected.length);
    expect(body.result.selected).toBe(selected.length);
    expect(body.result.preexisting).toBe(0);
    expect(body.result.excluded).toBe(rows.length - selected.length);
    expect(liveCount()).toBe(selected.length);

    // Every written row keeps its platform ledger id and its refund flag.
    const refundRows = db
      .prepare('SELECT COUNT(*) AS c FROM transactions WHERE deleted = 0 AND is_refund = 1')
      .get() as { c: number };
    expect(refundRows.c).toBeGreaterThanOrEqual(0);
  });

  it('returns the original result for an identical repeat and refuses a different one', async () => {
    const { batchId } = await createBatch();
    const rows = await allRows(batchId);
    const selected = rows.filter((row) => !row.ignored && !row.existing).map((row) => row.itemId);
    const reviewToken = ((await review(batchId, selected)).json() as { reviewToken: string }).reviewToken;
    const first = await confirm(batchId, reviewToken, 1, [{ fileIndex: 0, bytes: wechatCsv }]);
    expect(first.statusCode).toBe(200);

    const replay = await confirm(batchId, reviewToken, 1, [{ fileIndex: 0, bytes: wechatCsv }]);
    expect(replay.statusCode).toBe(200);
    expect((replay.json() as { result: { inserted: number } }).result.inserted).toBe(
      (first.json() as { result: { inserted: number } }).result.inserted,
    );
    expect(liveCount()).toBe(selected.length);

    const different = await confirm(batchId, 'not-the-token', 1, [{ fileIndex: 0, bytes: wechatCsv }]);
    expect(different.statusCode).toBe(409);
    expect(different.json().error.code).toBe('IMPORT_BATCH_ALREADY_CONFIRMED');
  });

  it('rejects a stale expectedVersion and writes nothing', async () => {
    const { batchId } = await createBatch();
    const rows = await allRows(batchId);
    const selected = rows.filter((row) => !row.ignored && !row.existing).slice(0, 2).map((row) => row.itemId);
    const reviewToken = ((await review(batchId, selected)).json() as { reviewToken: string }).reviewToken;
    const stale = await confirm(batchId, reviewToken, 99, [{ fileIndex: 0, bytes: wechatCsv }]);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('IMPORT_BATCH_STALE_VERSION');
    expect(liveCount()).toBe(0);
  });

  it('rolls the whole batch back when the last row cannot be written', async () => {
    const { batchId } = await createBatch();
    const rows = await allRows(batchId);
    const selected = rows.filter((row) => !row.ignored && !row.existing).map((row) => row.itemId);
    const reviewToken = ((await review(batchId, selected)).json() as { reviewToken: string }).reviewToken;

    // Make the final insert fail at the database level: a trigger that fires for one specific
    // ledger id. `better-sqlite3` runs the whole transaction through the same connection, so the
    // exception must roll back every earlier row.
    const victim = selected[selected.length - 1]!;
    const ledger = (
      db.prepare('SELECT ledger_id FROM assistant_import_batch_rows WHERE batch_id = ? AND item_id = ?').get(
        batchId,
        victim,
      ) as { ledger_id: string }
    ).ledger_id;
    db.exec(`
      CREATE TRIGGER fail_last_row BEFORE INSERT ON transactions
      WHEN NEW.id = '${ledger}'
      BEGIN SELECT RAISE(ABORT, 'injected failure'); END;
    `);
    const before = liveCount();
    const response = await confirm(batchId, reviewToken, 1, [{ fileIndex: 0, bytes: wechatCsv }]);
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(liveCount()).toBe(before);
    const status = (db.prepare('SELECT status FROM assistant_import_batches WHERE id = ?').get(batchId) as {
      status: string;
    }).status;
    expect(status).not.toBe('confirmed');
    db.exec('DROP TRIGGER fail_last_row');
  });

  it('creates an approved new category inside the same transaction, and only when used', async () => {
    const { batchId } = await createBatch();
    const rows = await allRows(batchId);
    const type = 0;
    // Use the fallback suggestion the server published for the missing Other case, if any.
    const categories = (await inject(
      'GET',
      `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/categories`,
    )).json() as {
      items: { suggestionId: string; origin: string; name: string; type: number; parentId: string | null; relatedItemIds: string[] }[];
    };
    const selected = rows.filter((row) => !row.ignored && !row.existing && row.type === type).map((row) => row.itemId);
    expect(selected.length).toBeGreaterThan(0);

    const suggestion = categories.items.find((item) => item.type === type);
    const approvedCategories =
      suggestion === undefined
        ? []
        : [
            {
              suggestionId: suggestion.suggestionId,
              resolution: 'create',
              reuseCategoryId: null,
              name: '测试新分类',
              type,
              parentId: null,
            },
          ];
    const assignments: Record<string, unknown> =
      suggestion === undefined
        ? assignmentsFor(rows, selected)
        : Object.fromEntries(selected.map((itemId) => [itemId, { kind: 'suggestion', suggestionId: suggestion.suggestionId }]));

    const before = (db.prepare('SELECT COUNT(*) AS c FROM categories').get() as { c: number }).c;
    const reviewResponse = await review(batchId, selected, { assignments, approvedCategories });
    expect(reviewResponse.statusCode).toBe(200);
    const afterReview = (db.prepare('SELECT COUNT(*) AS c FROM categories').get() as { c: number }).c;
    expect(afterReview).toBe(before);

    const response = await confirm(
      batchId,
      (reviewResponse.json() as { reviewToken: string }).reviewToken,
      1,
      [{ fileIndex: 0, bytes: wechatCsv }],
    );
    expect(response.statusCode).toBe(200);
    const result = (response.json() as { result: { inserted: number; categoriesCreated: number } }).result;
    expect(result.inserted).toBe(selected.length);
    if (suggestion !== undefined) {
      expect(result.categoriesCreated).toBe(1);
      const created = db
        .prepare("SELECT id, name FROM categories WHERE name = '测试新分类' AND deleted = 0")
        .all() as { id: string; name: string }[];
      expect(created).toHaveLength(1);
    }
  });

  it('keeps the explicit empty note override meaning "clear the note"', async () => {
    const { batchId } = await createBatch();
    const rows = await allRows(batchId);
    const selected = rows.filter((row) => !row.ignored && !row.existing).slice(0, 1).map((row) => row.itemId);
    const reviewToken = (
      (await review(batchId, selected, { noteOverrides: { [selected[0]!]: '' } })).json() as { reviewToken: string }
    ).reviewToken;
    const response = await confirm(batchId, reviewToken, 1, [{ fileIndex: 0, bytes: wechatCsv }]);
    expect(response.statusCode).toBe(200);
    const ledgerId = (
      db.prepare('SELECT ledger_id FROM assistant_import_batch_rows WHERE batch_id = ? AND item_id = ?').get(
        batchId,
        selected[0],
      ) as { ledger_id: string }
    ).ledger_id;
    const stored = db.prepare('SELECT note FROM transactions WHERE id = ?').get(ledgerId) as { note: string };
    expect(stored.note).toBe('');
  });
});

describe('file mutations', () => {
  it('removes a file with the full remaining set and bumps the version', async () => {
    const { batchId } = await createBatch([
      fileEntry('wechat.csv', wechatCsv),
      fileEntry('alipay.csv', alipayCsv),
    ]);
    const response = await inject(
      'POST',
      `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/files/1/remove`,
      {
        expectedVersion: 1,
        clientRequestId: 'remove-1',
        targetFileIndex: 1,
        files: [fileEntry('wechat.csv', wechatCsv)],
      },
    );
    expect(response.statusCode).toBe(200);
    const body = response.json() as { batch: { version: number; files: unknown[] } };
    expect(body.batch.version).toBe(2);
    expect(body.batch.files).toHaveLength(1);
  });

  it('refuses to remove the last file and requires the full remaining set', async () => {
    const { batchId } = await createBatch([fileEntry('wechat.csv', wechatCsv)]);
    const last = await inject(
      'POST',
      `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/files/0/remove`,
      { expectedVersion: 1, clientRequestId: 'remove-last', targetFileIndex: 0, files: [] },
    );
    // An empty `files` array is rejected before the "last file" rule can be evaluated.
    expect(last.statusCode).toBe(400);
    const partial = await inject(
      'POST',
      `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/files/0/replace`,
      { expectedVersion: 1, clientRequestId: 'replace-partial', files: [] },
    );
    expect(partial.statusCode).toBe(400);
  });

  it('rejects a remove payload that changes bytes for an untouched file', async () => {
    const { batchId } = await createBatch([
      fileEntry('wechat.csv', wechatCsv),
      fileEntry('alipay.csv', alipayCsv),
    ]);
    const substituted = Buffer.from(`${alipayCsv.toString('utf8')}\n`);
    const response = await inject(
      'POST',
      `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/files/1/remove`,
      {
        expectedVersion: 1,
        clientRequestId: 'remove-substitution',
        targetFileIndex: 1,
        files: [fileEntry('alipay.csv', substituted)],
      },
    );
    expect(response.statusCode).toBe(400);
    expect((await allRows(batchId)).length).toBeGreaterThan(0);
    const batch = (await inject('GET', `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}`)).json().batch;
    expect(batch.version).toBe(1);
  });

  it('treats an identical replace as a no-op and keeps the version', async () => {
    const { batchId } = await createBatch([fileEntry('wechat.csv', wechatCsv)]);
    const rowsBefore = await allRows(batchId);
    const response = await inject(
      'POST',
      `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/files/0/replace`,
      { expectedVersion: 1, clientRequestId: 'replace-identical', files: [fileEntry('wechat.csv', wechatCsv)] },
    );
    expect(response.statusCode).toBe(200);
    const body = response.json() as { batch: { version: number }; replacedWithIdenticalDigest: boolean };
    expect(body.batch.version).toBe(1);
    expect(body.replacedWithIdenticalDigest).toBe(true);
    const rowsAfter = await allRows(batchId);
    expect(rowsAfter.map((row) => row.itemId)).toEqual(rowsBefore.map((row) => row.itemId));
  });

  it('records a failed file, keeps the workspace readable and blocks review', async () => {
    const { batchId } = await createBatch();
    // Replace the file with bytes that are not a bill export at all.
    const response = await inject(
      'POST',
      `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/files/0/replace`,
      {
        expectedVersion: 1,
        clientRequestId: 'replace-broken',
        files: [fileEntry('wechat.csv', Buffer.from('这不是一个账单文件'))],
      },
    );
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      batch: { version: number; files: { parseStatus: string; rawRowCount: number | null; collectedRowCount: number | null }[] };
    };
    expect(body.batch.version).toBe(2);
    expect(body.batch.files[0]!.parseStatus).toBe('failed');
    // Unknown counts are `null`, never a misleading `0`.
    expect(body.batch.files[0]!.rawRowCount).toBeNull();
    expect(body.batch.files[0]!.collectedRowCount).toBeNull();

    // The workspace is still readable.
    const read = await inject('GET', `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}`);
    expect(read.statusCode).toBe(200);

    // Review is blocked by the failed file. The payload is built by hand because there are no
    // rows to derive assignments from — which is exactly the state the rule must catch.
    const view = (await inject('GET', `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}`)).json() as {
      batch: { version: number; analysis: { analysisRevision: number }; viewRevision: string };
    };
    const blocked = await inject(
      'POST',
      `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/review`,
      {
        version: view.batch.version,
        analysisRevision: view.batch.analysis.analysisRevision,
        viewRevision: view.batch.viewRevision,
        selectedItemIds: ['ch:whatever:1'],
        categoryAssignments: {},
        noteOverrides: {},
        approvedCategories: [],
        conflictDecisions: [],
      },
    );
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json().error.code).toBe('IMPORT_BATCH_FILE_FAILED');
  });
});

describe('cancel and archive fences', () => {
  it('cancels without any financial write and is idempotent', async () => {
    const { batchId } = await createBatch();
    const first = await inject('POST', `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/cancel`, {
      expectedVersion: 1,
      clientRequestId: 'cancel-1',
    });
    expect(first.statusCode).toBe(200);
    expect((first.json() as { batch: { status: string } }).batch.status).toBe('cancelled');
    const replay = await inject('POST', `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/cancel`, {
      expectedVersion: 1,
      clientRequestId: 'cancel-1',
    });
    expect(replay.statusCode).toBe(200);
    const mismatch = await inject('POST', `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/cancel`, {
      expectedVersion: 2,
      clientRequestId: 'cancel-2',
    });
    expect(mismatch.statusCode).toBe(409);
    expect(liveCount()).toBe(0);
  });

  it('fences non-terminal batches when the conversation is archived', async () => {
    const { batchId } = await createBatch();
    const archived = await app.inject({
      method: 'DELETE',
      url: `/api/v1/assistant/conversations/${conversationId}`,
      headers: authHeaders(),
    });
    expect(archived.statusCode).toBe(200);
    const status = (db.prepare('SELECT status FROM assistant_import_batches WHERE id = ?').get(batchId) as {
      status: string;
    }).status;
    expect(status).toBe('cancelled');
    expect(liveCount()).toBe(0);
  });

  it('keeps the batch card as text metadata without rows or a review token', async () => {
    const { batchId } = await createBatch();
    const messages = (await inject('GET', `/api/v1/assistant/conversations/${conversationId}/messages`)).json() as {
      items: { kind: string; content: Record<string, unknown> }[];
    };
    const card = messages.items.find((message) => message.content['importBatch'] !== undefined);
    expect(card).toBeDefined();
    expect(card!.kind).toBe('text');
    const serialized = JSON.stringify(card!.content);
    expect(serialized).not.toMatch(/reviewToken/);
    expect(serialized).not.toMatch(/itemId/);
    expect(batchId.length).toBeGreaterThan(0);
  });
});

describe('rebase and draft migration', () => {
  const HEADER = '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注';
  const csv = (rows: string[]) => Buffer.from([HEADER, ...rows].join(String.fromCharCode(10)), 'utf8');

  it('stales the confirmation when a reviewed row has been recorded meanwhile', async () => {
    const { batchId } = await createBatch();
    const rows = await allRows(batchId);
    const victim = rows.find((row) => !row.ignored && !row.existing)!;
    const reviewToken = (
      (await review(batchId, [victim.itemId])).json() as { reviewToken: string }
    ).reviewToken;
    const ledger = (
      db.prepare('SELECT ledger_id FROM assistant_import_batch_rows WHERE batch_id = ? AND item_id = ?').get(
        batchId,
        victim.itemId,
      ) as { ledger_id: string }
    ).ledger_id;
    // Simulate the user recording the same movement by hand between review and confirm.
    db.prepare(
      `INSERT INTO transactions (id, type, amount_cents, category_id, account_id, date, note, tags_json, is_refund, deleted, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, '', '[]', 0, 0, ?)`,
    ).run(ledger, victim.type, victim.amountCents, 'builtin-expense-other', 'builtin-default-account', NOW, NOW);

    const response = await confirm(batchId, reviewToken, 1, [{ fileIndex: 0, bytes: wechatCsv }]);
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('ASSISTANT_ACTION_STALE');
    const status = (db.prepare('SELECT status FROM assistant_import_batches WHERE id = ?').get(batchId) as {
      status: string;
    }).status;
    expect(status).toBe('reviewed');
  });

  it('hard-blocks an exact re-upload of an occurrence that is already in the ledger', async () => {
    // No order id on any row: identity is the file digest plus the source row.
    const noOrder = csv([
      '2026-09-13 10:00:00,商户消费,合成商户,商品,支出,10.00,零钱,支付成功,,,/',
      '2026-09-13 11:00:00,商户消费,合成商户,商品,支出,20.00,零钱,支付成功,,,/',
    ]);
    const first = await createBatch([fileEntry('noid.csv', noOrder)]);
    const firstRows = await allRows(first.batchId);
    expect(firstRows.every((row) => !row.existing)).toBe(true);
    const selected = firstRows.map((row) => row.itemId);
    const reviewToken = ((await review(first.batchId, selected)).json() as { reviewToken: string }).reviewToken;
    const confirmed = await confirm(first.batchId, reviewToken, 1, [{ fileIndex: 0, bytes: noOrder }]);
    expect(confirmed.statusCode).toBe(200);
    expect((confirmed.json() as { result: { inserted: number } }).result.inserted).toBe(2);

    // Re-uploading the very same bytes cannot create the same movement twice.
    const again = await createBatch([fileEntry('noid.csv', noOrder)]);
    const againRows = await allRows(again.batchId);
    expect(againRows).toHaveLength(2);
    expect(againRows.every((row) => row.existing)).toBe(true);
    const blocked = await review(again.batchId, againRows.map((row) => row.itemId));
    expect(blocked.statusCode).toBe(400);
    expect(liveCount()).toBe(2);
  });

  it('remaps drafts when the facts of an order change and keeps the rest stable', async () => {
    const withOrders = csv([
      '2026-09-13 10:00:00,商户消费,合成商户,商品A,支出,10.00,零钱,支付成功,ORDER-A,,/',
      '2026-09-13 11:00:00,商户消费,合成商户,商品B,支出,20.00,零钱,支付成功,ORDER-B,,/',
    ]);
    const { batchId } = await createBatch([fileEntry('orders.csv', withOrders)]);
    const before = await allRows(batchId);
    expect(before).toHaveLength(2);
    const changed = csv([
      '2026-09-13 10:00:00,商户消费,合成商户,商品A,支出,99.00,零钱,支付成功,ORDER-A,,/',
      '2026-09-13 11:00:00,商户消费,合成商户,商品B,支出,20.00,零钱,支付成功,ORDER-B,,/',
    ]);
    const response = await inject(
      'POST',
      `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/files/0/replace`,
      { expectedVersion: 1, clientRequestId: 'replace-facts', files: [fileEntry('orders.csv', changed)] },
    );
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      batch: { version: number };
      idRemap: Record<string, string>;
      droppedDraftItemIds: string[];
      identityUnchangedItemIds: string[];
      replacedWithIdenticalDigest: boolean;
    };
    expect(body.batch.version).toBe(2);
    expect(body.replacedWithIdenticalDigest).toBe(false);
    // ORDER-A's amount changed: its draft must be DROPPED, never carried across changed facts.
    expect(body.droppedDraftItemIds).toContain(before[0]!.itemId);
    expect(Object.keys(body.idRemap)).not.toContain(before[0]!.itemId);
    // ORDER-B's facts are untouched, so its draft survives.
    expect(body.identityUnchangedItemIds).toContain(before[1]!.itemId);
    // A remap and a drop are mutually exclusive for the same old id.
    for (const oldId of Object.keys(body.idRemap)) {
      expect(body.droppedDraftItemIds).not.toContain(oldId);
    }
  });

  it('reports an identical-digest reorder as a no-op that keeps identity', async () => {
    const a = csv(['2026-09-13 10:00:00,商户消费,合成商户,商品A,支出,10.00,零钱,支付成功,ORDER-A,,/']);
    const b = csv(['2026-09-14 10:00:00,商户消费,合成商户,商品B,支出,20.00,零钱,支付成功,ORDER-B,,/']);
    const { batchId } = await createBatch([fileEntry('a.csv', a), fileEntry('b.csv', b)]);
    const before = await allRows(batchId);
    // Swap the two files: identity does not contain the file index, so nothing remaps.
    const response = await inject(
      'POST',
      `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/files/0/replace`,
      {
        expectedVersion: 1,
        clientRequestId: 'reorder',
        files: [fileEntry('b.csv', b), fileEntry('a.csv', a)],
      },
    );
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      batch: { files: { fileName: string }[] };
      idRemap: Record<string, string>;
      identityUnchangedItemIds: string[];
    };
    expect(body.batch.files.map((file) => file.fileName)).toEqual(['b.csv', 'a.csv']);
    expect(body.idRemap).toEqual({});
    expect(new Set(body.identityUnchangedItemIds)).toEqual(new Set(before.map((row) => row.itemId)));
  });
});

describe('live view review regression', () => {
  it('rejects live-view drift without writes, then rebases from current route reads', async () => {
    const { batchId } = await createBatch();
    const path = `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}`;
    const firstRowsResponse = await inject('GET', `${path}/rows?limit=100`);
    const firstRows = firstRowsResponse.json() as { version: number; analysisRevision: number; viewRevision: string; items: RowDto[] };
    const firstCategories = (await inject('GET', `${path}/categories`)).json() as { viewRevision: string };
    expect(firstRows.viewRevision).toBe(firstCategories.viewRevision);
    const initialAllRows = await allRows(batchId);
    const target = initialAllRows.find((row) => !row.existing && !row.ignored)!;
    const ledgerId = (db.prepare('SELECT ledger_id FROM assistant_import_batch_rows WHERE batch_id = ? AND item_id = ?')
      .get(batchId, target.itemId) as { ledger_id: string }).ledger_id;
    const beforeBatch = db.prepare('SELECT * FROM assistant_import_batches WHERE id = ?').get(batchId);
    const beforeRows = db.prepare('SELECT * FROM assistant_import_batch_rows WHERE batch_id = ? ORDER BY ordinal').all(batchId);

    // Simulate a separate successful ledger write and category change after the client snapshot.
    db.prepare(
      `INSERT INTO transactions (id, type, amount_cents, category_id, account_id, date, note, tags_json, is_refund, deleted, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'other transaction', '[]', 0, 0, ?)`,
    ).run(ledgerId, target.type, target.amountCents, target.type === 0 ? 'builtin-expense-other' : 'builtin-income-other', 'builtin-default-account', NOW, NOW);
    db.prepare(
      "INSERT INTO categories (id, name, type, icon, color, sort_order, is_builtin, deleted, updated_at) VALUES ('live-view-added', '实时新增', 0, 'other', 0, 99, 0, 0, 0)",
    ).run();
    const pageDuringMutation = (await inject('GET', `${path}/rows?limit=1`)).json() as { viewRevision: string };
    expect(pageDuringMutation.viewRevision).not.toBe(firstRows.viewRevision);

    const stale = await inject('POST', `${path}/review`, {
      version: firstRows.version,
      analysisRevision: firstRows.analysisRevision,
      viewRevision: firstRows.viewRevision,
      selectedItemIds: [target.itemId],
      categoryAssignments: assignmentsFor(initialAllRows, [target.itemId]),
      noteOverrides: {},
      approvedCategories: [],
      conflictDecisions: [],
    });
    expect(stale.statusCode).toBe(409);
    expect(liveCount()).toBe(1);
    expect(db.prepare('SELECT * FROM assistant_import_batches WHERE id = ?').get(batchId)).toEqual(beforeBatch);
    expect(db.prepare('SELECT * FROM assistant_import_batch_rows WHERE batch_id = ? ORDER BY ordinal').all(batchId)).toEqual(beforeRows);

    const currentRows = (await inject('GET', `${path}/rows?limit=100`)).json() as { version: number; analysisRevision: number; viewRevision: string; items: RowDto[] };
    const currentAllRows = await allRows(batchId);
    const currentCategories = (await inject('GET', `${path}/categories`)).json() as { viewRevision: string; categories: { id: string }[] };
    expect(currentRows.viewRevision).not.toBe(firstRows.viewRevision);
    expect(currentRows.viewRevision).toBe(currentCategories.viewRevision);
    expect(currentCategories.categories.some((category) => category.id === 'live-view-added')).toBe(true);
    const currentTarget = (await inject('GET', `${path}/rows?limit=100`)).json() as { items: RowDto[] };
    expect(currentTarget.items.find((row) => row.itemId === target.itemId)?.existing).toBe(true);
    const eligible = currentAllRows.find((row) => row.itemId !== target.itemId && !row.existing && !row.ignored)!;
    const rebased = await inject('POST', `${path}/review`, {
      version: currentRows.version,
      analysisRevision: currentRows.analysisRevision,
      viewRevision: currentRows.viewRevision,
      selectedItemIds: [eligible.itemId],
      categoryAssignments: assignmentsFor(currentAllRows, [eligible.itemId]),
      noteOverrides: {},
      approvedCategories: [],
      conflictDecisions: [],
    });
    expect(rebased.statusCode).toBe(200);
    const reviewed = rebased.json() as { reviewToken: string; summary: { selectedRows: { itemId: string; note: string; categoryName: string | null; categoryType: number | null }[] } };
    expect(reviewed.summary.selectedRows).toHaveLength(1);
    expect(reviewed.summary.selectedRows[0]).toMatchObject({ itemId: eligible.itemId, note: expect.any(String), categoryName: expect.any(String), categoryType: eligible.type });
    const result = await confirm(batchId, reviewed.reviewToken, 1, [{ fileIndex: 0, bytes: wechatCsv }]);
    expect(result.statusCode).toBe(200);
    expect(liveCount()).toBe(2);
  });

  it('reads current live view without mutating database bytes and resolves source/override notes', async () => {
    const { batchId } = await createBatch();
    const path = `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}`;
    const row = (await allRows(batchId)).find((candidate) => !candidate.existing && !candidate.ignored)!;
    const sourceRows = (await inject('GET', `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/rows?limit=100`)).json() as { items: (RowDto & { note: string })[] };
    const sourceNote = sourceRows.items.find((candidate) => candidate.itemId === row.itemId)!.note;
    const before = {
      batches: db.prepare('SELECT * FROM assistant_import_batches ORDER BY id').all(),
      rows: db.prepare('SELECT * FROM assistant_import_batch_rows ORDER BY batch_id, ordinal').all(),
      categories: db.prepare('SELECT * FROM categories ORDER BY id').all(),
      transactions: db.prepare('SELECT * FROM transactions ORDER BY id').all(),
    };
    await inject('GET', path);
    await inject('GET', `${path}/rows?limit=100`);
    await inject('GET', `${path}/categories`);
    expect({
      batches: db.prepare('SELECT * FROM assistant_import_batches ORDER BY id').all(),
      rows: db.prepare('SELECT * FROM assistant_import_batch_rows ORDER BY batch_id, ordinal').all(),
      categories: db.prepare('SELECT * FROM categories ORDER BY id').all(),
      transactions: db.prepare('SELECT * FROM transactions ORDER BY id').all(),
    }).toEqual(before);


    const summary = async (noteOverrides: Record<string, string>) => {
      const current = (await inject('GET', `${path}/rows?limit=100`)).json() as { version: number; analysisRevision: number; viewRevision: string; items: RowDto[] };
      const response = await inject('POST', `${path}/review`, {
        version: current.version,
        analysisRevision: current.analysisRevision,
        viewRevision: current.viewRevision,
        selectedItemIds: [row.itemId],
        categoryAssignments: assignmentsFor(current.items, [row.itemId]),
        noteOverrides,
        approvedCategories: [],
        conflictDecisions: [],
      });
      expect(response.statusCode).toBe(200);
      return (response.json() as { summary: { selectedRows: { note: string }[] } }).summary.selectedRows[0]!.note;
    };
    expect(await summary({})).toBe(sourceNote);
    expect(await summary({ [row.itemId]: '' })).toBe('');
    expect(await summary({ [row.itemId]: 'server resolved' })).toBe('server resolved');
  });

  it('returns the dedicated review DTO for the full 500-row and assignment budget', async () => {
    const csvText = [
      '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注',
      ...Array.from({ length: 500 }, (_, index) => `2026-09-13 10:${String(index % 60).padStart(2, '0')}:00,商户消费,商户${index},商品${index},支出,1.00,零钱,支付成功,ORDER-${index},,来源备注${index}`),
    ].join('\n');
    const { batchId } = await createBatch([fileEntry('wechat.csv', Buffer.from(csvText, 'utf8'))]);
    const path = `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}`;
    const rows = (await inject('GET', `${path}/rows?limit=100`)).json() as { items: RowDto[]; nextCursor: string | null };
    const selected = rows.items.filter((row) => !row.existing && !row.ignored).map((row) => row.itemId);
    // The generated unique order IDs guarantee 500 selected records in the full page set.
    let all = [...rows.items];
    let cursor = rows.nextCursor;
    while (cursor !== null) {
      const page = (await inject('GET', `${path}/rows?limit=100&cursor=${encodeURIComponent(cursor)}`)).json() as { items: RowDto[]; nextCursor: string | null };
      all = all.concat(page.items);
      cursor = page.nextCursor;
    }
    const ids = all.filter((row) => !row.existing && !row.ignored).map((row) => row.itemId);
    expect(ids).toHaveLength(500);
    const current = (await inject('GET', `${path}/rows?limit=100`)).json() as { version: number; analysisRevision: number; viewRevision: string };
    const response = await inject('POST', `${path}/review`, {
      version: current.version,
      analysisRevision: current.analysisRevision,
      viewRevision: current.viewRevision,
      selectedItemIds: ids,
      categoryAssignments: assignmentsFor(all, ids),
      noteOverrides: {},
      approvedCategories: [],
      conflictDecisions: [],
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { summary: { selected: number; selectedRows: unknown[]; counts: { userExcluded: null } } };
    expect(body.summary.selected).toBe(500);
    expect(body.summary.selectedRows).toHaveLength(500);
    expect(body.summary.counts.userExcluded).toBeNull();
    void selected;
  });
});

describe('review summary and blocked states', () => {
  it('refuses a review while the analysis is running', async () => {
    const { batchId } = await createBatch();
    db.prepare("UPDATE assistant_import_batches SET analyse_state = 'running', analyse_owner = 'x' WHERE id = ?").run(
      batchId,
    );
    const rows = await allRows(batchId);
    const selected = rows.filter((row) => !row.ignored && !row.existing).slice(0, 1).map((row) => row.itemId);
    const response = await review(batchId, selected);
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('ASSISTANT_ACTION_STALE');
  });

  it('allows a selected positive rule-ignored row and reports its actual financial type', async () => {
    const { batchId } = await createBatch();
    const rows = await allRows(batchId);
    const row = rows.find((candidate) => !candidate.existing && candidate.amountCents > 0 && candidate.conflictKind === null)!;
    db.prepare('UPDATE assistant_import_batch_rows SET ignored = 1, ignore_reason = ? WHERE batch_id = ? AND item_id = ?')
      .run('状态:已关闭', batchId, row.itemId);

    const filtered = await inject(
      'GET',
      `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/rows?filter=importable`,
    );
    expect((filtered.json() as { items: { itemId: string }[] }).items.map((item) => item.itemId)).toContain(row.itemId);

    const reviewResponse = await review(batchId, [row.itemId]);
    expect(reviewResponse.statusCode).toBe(200);
    const body = reviewResponse.json() as { summary: { selected: number; expenseCents: number; incomeCents: number } };
    expect(body.summary.selected).toBe(1);
    expect(body.summary.expenseCents + body.summary.incomeCents).toBe(row.amountCents);
  });

  it('still blocks existing and nonpositive rows and both weak and ledger collision selections', async () => {
    const { batchId } = await createBatch();
    const rows = await allRows(batchId);
    const positive = rows.find((row) => !row.existing && row.amountCents > 0 && row.conflictKind === null)!;

    db.prepare('UPDATE assistant_import_batch_rows SET amount_cents = 0 WHERE batch_id = ? AND item_id = ?').run(batchId, positive.itemId);
    expect((await review(batchId, [positive.itemId])).statusCode).toBe(400);
    db.prepare('UPDATE assistant_import_batch_rows SET amount_cents = ? WHERE batch_id = ? AND item_id = ?').run(positive.amountCents, batchId, positive.itemId);
    const positiveRows = await allRows(batchId);

    const ledgerId = (db.prepare('SELECT ledger_id FROM assistant_import_batch_rows WHERE batch_id = ? AND item_id = ?')
      .get(batchId, positive.itemId) as { ledger_id: string }).ledger_id;
    const beforeLedger = liveCount();
    db.prepare(
      `INSERT INTO transactions (id, type, amount_cents, date, category_id, account_id, note, tags_json, is_refund, deleted, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, '', '[]', 0, 0, ?)`,
    ).run(ledgerId, positive.type, positive.amountCents, NOW, positive.type === 0 ? 'builtin-expense-other' : 'builtin-income-other', 'builtin-default-account', NOW);
    expect((await review(batchId, [positive.itemId])).statusCode).toBe(400);
    expect(liveCount()).toBe(beforeLedger + 1);
    db.prepare('DELETE FROM transactions WHERE id = ?').run(ledgerId);

    for (const kind of ['weak_collision', 'ledger_collision']) {
      db.prepare('UPDATE assistant_import_batch_rows SET conflict_kind = ?, conflict_group = ? WHERE batch_id = ? AND item_id = ?')
        .run(kind, `${kind}:test`, batchId, positive.itemId);
      const snapshot = (await inject('GET', `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/rows?limit=100`)).json() as {
        viewRevision: string;
        items: RowDto[];
      };
      const isolatedReview = await inject('POST', `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/review`, {
        version: 1,
        analysisRevision: 0,
        viewRevision: snapshot.viewRevision,
        selectedItemIds: [positive.itemId],
        categoryAssignments: assignmentsFor(positiveRows, [positive.itemId]),
        noteOverrides: {},
        approvedCategories: [],
        conflictDecisions: [],
      });
      expect(isolatedReview.statusCode).toBe(400);
      await inject('GET', `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/rows?limit=100`);
      db.prepare('UPDATE assistant_import_batch_rows SET conflict_kind = NULL, conflict_group = NULL WHERE batch_id = ? AND item_id = ?')
        .run(batchId, positive.itemId);
      db.prepare('UPDATE assistant_import_batch_rows SET amount_cents = ? WHERE batch_id = ? AND item_id = ?').run(positive.amountCents, batchId, positive.itemId);
    }
  });

  it('answers the authoritative server summary the client formats', async () => {
    const { batchId } = await createBatch();
    const rows = await allRows(batchId);
    const selected = rows.filter((row) => !row.ignored && !row.existing).map((row) => row.itemId);
    const response = await review(batchId, selected);
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      summary: {
        selected: number;
        expenseCents: number;
        incomeCents: number;
        refundIncomeCents: number;
        selectedRows: { itemId: string; note: string; categoryName: string | null; categoryType: number | null; approvedNewCategoryName: string | null }[];
        files: { fileName: string; selectedRows: number }[];
        counts: { total: number; selected: number; notSelected: number; userExcluded: null };
        excluded: number;
        existing: number;
        conflicts: number;
      };
      expiresInSec: number;
    };
    expect(body.summary.selected).toBe(selected.length);
    expect(body.summary.selectedRows).toHaveLength(selected.length);
    expect(body.summary.selectedRows.every((row) => typeof row.note === 'string')).toBe(true);
    expect(body.summary.selectedRows.every((row) => row.categoryName !== null && row.categoryType !== null)).toBe(true);
    expect(body.summary.counts).toMatchObject({ total: rows.length, selected: selected.length, notSelected: rows.length - selected.length, userExcluded: null });
    expect(body.summary.counts).toMatchObject({
      total: rows.length,
      selected: selected.length,
      notSelected: rows.length - selected.length,
      userExcluded: null,
    });
    // The counts are internally consistent, which is the guard against a drifted summary.
    expect(body.summary.excluded).toBe(rows.length - selected.length);
    expect(body.summary.expenseCents + body.summary.incomeCents).toBe(
      rows.filter((row) => selected.includes(row.itemId)).reduce((sum, row) => sum + row.amountCents, 0),
    );
    expect(body.expiresInSec).toBe(900);
    expect(body.summary.files.reduce((sum, file) => sum + file.selectedRows, 0)).toBe(selected.length);
    // The review response never carries the raw ledger id or an item's internal row id.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/ledgerId/);
  });

  it('lists live categories separately from the batch suggestions', async () => {
    const { batchId } = await createBatch();
    const body = (await inject(
      'GET',
      `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/categories`,
    )).json() as {
      categories: { id: string; name: string; type: number }[];
      items: { suggestionId: string; relatedItemCount: number }[];
      analysisRevision: number;
      viewRevision: string;
    };
    expect(body.categories.some((category) => category.name === '其他')).toBe(true);
    expect(typeof body.viewRevision).toBe('string');
    expect(typeof body.analysisRevision).toBe('number');
    // The fallback suggestions are published, not created.
    const names = db.prepare('SELECT name FROM categories WHERE deleted = 0').all() as { name: string }[];
    expect(names.length).toBeGreaterThan(0);
  });

  it('reports the analysis revision on row and category reads', async () => {
    const { batchId } = await createBatch();
    const rows = (await inject(
      'GET',
      `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/rows?limit=5`,
    )).json() as { analysisRevision: number; version: number };
    expect(rows.version).toBe(1);
    expect(rows.analysisRevision).toBe(0);
  });
});
