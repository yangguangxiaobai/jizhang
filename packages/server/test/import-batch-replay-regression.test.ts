/**
 * Prior-repair regressions for the merged bill import (P09).
 *
 * Two confirmed defects are pinned here, both reproduced earlier on an isolated in-memory
 * database:
 *   * F01 — a file removal that already committed could not replay its original keyed result,
 *     because the current-index / last-file / full-remaining-set guards ran *before* the keyed
 *     operation lookup. An exact retry therefore received HTTP 400 although the removal had
 *     committed (and the batch version had already moved to 2).
 *   * F02 — Review counted *proposals* instead of distinct planned category entities: two
 *     approved suggestions renamed to the same new [name, type, parent] entity reported two
 *     categories to create while Confirm created exactly one.
 *
 * The tests drive the real Fastify app through `app.inject()` against `:memory:` SQLite only.
 * No listener, no provider call, no real `data/` database.
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
const refundCsv = readFileSync(join(FIXTURES, 'refund-review.csv'));

interface RowDto {
  itemId: string;
  type: number;
  amountCents: number;
  existing: boolean;
  ignored: boolean;
  conflictKind: string | null;
  fallback: { effectiveExistingId: string | null };
}

interface MutationOutcomeDto {
  idRemap: Record<string, string>;
  droppedDraftItemIds: string[];
  identityUnchangedItemIds: string[];
  replacedWithIdenticalDigest: boolean;
  notices: { code: string; itemId: string; detail: string }[];
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

async function createBatch(files: { fileName: string; source: string; fileBase64: string }[]) {
  const response = await inject('POST', `/api/v1/assistant/conversations/${conversationId}/import-batches`, {
    files,
    clientRequestId: `req-${Math.random().toString(36).slice(2)}`,
    analyse: false,
  });
  expect(response.statusCode).toBe(201);
  const body = response.json() as { batch: { batchId: string; version: number } };
  return { batchId: body.batch.batchId, version: body.batch.version };
}

async function allRows(batchId: string): Promise<RowDto[]> {
  const out: RowDto[] = [];
  let cursor: string | null = null;
  for (;;) {
    const url =
      `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/rows?limit=100` +
      (cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`);
    const page = (await inject('GET', url)).json() as { items: RowDto[]; nextCursor: string | null };
    out.push(...page.items);
    if (page.nextCursor === null) break;
    cursor = page.nextCursor;
  }
  return out;
}

async function review(
  batchId: string,
  selected: string[],
  options: {
    assignments: Record<string, unknown>;
    approvedCategories?: unknown[];
  },
) {
  const batch = (await inject('GET', `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}`))
    .json() as { batch: { version: number; analysis: { analysisRevision: number }; viewRevision: string } };
  return inject('POST', `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/review`, {
    version: batch.batch.version,
    analysisRevision: batch.batch.analysis.analysisRevision,
    viewRevision: batch.batch.viewRevision,
    selectedItemIds: selected,
    categoryAssignments: options.assignments,
    noteOverrides: {},
    approvedCategories: options.approvedCategories ?? [],
    conflictDecisions: [],
  });
}

async function removeFile(
  batchId: string,
  fileIndex: number,
  input: {
    expectedVersion: number;
    clientRequestId: string;
    files: { fileName: string; source: string; fileBase64: string }[];
  },
) {
  return inject(
    'POST',
    `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/files/${fileIndex}/remove`,
    {
      expectedVersion: input.expectedVersion,
      clientRequestId: input.clientRequestId,
      targetFileIndex: fileIndex,
      files: input.files,
    },
  );
}

function storedVersion(batchId: string): number {
  return (
    db.prepare('SELECT version FROM assistant_import_batches WHERE id = ?').get(batchId) as { version: number }
  ).version;
}

function storedOperationCount(batchId: string, operation: string): number {
  return (
    db
      .prepare('SELECT COUNT(*) AS c FROM assistant_import_batch_operations WHERE batch_id = ? AND operation = ?')
      .get(batchId, operation) as { c: number }
  ).c;
}

beforeEach(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'import-batch-replay-'));
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
  const created = await inject('POST', '/api/v1/assistant/conversations', { title: '重放回归' });
  conversationId = (created.json() as { id: string }).id;
});

afterEach(async () => {
  await app.close();
  closeDatabase(db);
  rmSync(dataDir, { recursive: true, force: true });
});

describe('F01 removed-file keyed replay', () => {
  it('removedFileRetryReturnsOriginalVersionForBothIndices: exact retry returns the original outcome and keeps version 2 for each removal index', async () => {
    // Index 1 of [wechat, alipay]: the replay's own index is out of range in the reduced list.
    {
      const { batchId } = await createBatch([fileEntry('wechat.csv', wechatCsv), fileEntry('alipay.csv', alipayCsv)]);
      const request = { expectedVersion: 1, clientRequestId: 'remove-index-1', files: [fileEntry('wechat.csv', wechatCsv)] };

      const first = await removeFile(batchId, 1, request);
      expect(first.statusCode).toBe(200);
      const firstBody = first.json() as { batch: { version: number; files: unknown[] } } & MutationOutcomeDto;
      expect(firstBody.batch.version).toBe(2);
      expect(firstBody.batch.files).toHaveLength(1);
      expect(storedVersion(batchId)).toBe(2);
      expect(storedOperationCount(batchId, 'remove')).toBe(1);

      // The response was "lost": the client repeats the exact original request.
      const replay = await removeFile(batchId, 1, request);
      expect(replay.statusCode).toBe(200);
      const replayBody = replay.json() as { batch: { version: number; files: unknown[] } } & MutationOutcomeDto;
      expect(replayBody.batch.version).toBe(2);
      expect(replayBody.batch.files).toHaveLength(1);
      expect(replayBody.idRemap).toEqual(firstBody.idRemap);
      expect(replayBody.droppedDraftItemIds).toEqual(firstBody.droppedDraftItemIds);
      expect(replayBody.identityUnchangedItemIds).toEqual(firstBody.identityUnchangedItemIds);
      expect(replayBody.replacedWithIdenticalDigest).toBe(firstBody.replacedWithIdenticalDigest);
      expect(replayBody.notices).toEqual(firstBody.notices);

      // The replay is an operation lookup, not a second mutation.
      expect(storedVersion(batchId)).toBe(2);
      expect(storedOperationCount(batchId, 'remove')).toBe(1);
    }

    // Index 0 of [wechat, alipay]: the replay trips the "cannot remove the last file" guard.
    {
      const { batchId } = await createBatch([fileEntry('wechat.csv', wechatCsv), fileEntry('alipay.csv', alipayCsv)]);
      const request = { expectedVersion: 1, clientRequestId: 'remove-index-0', files: [fileEntry('alipay.csv', alipayCsv)] };

      const first = await removeFile(batchId, 0, request);
      expect(first.statusCode).toBe(200);
      const firstBody = first.json() as { batch: { version: number; files: unknown[] } } & MutationOutcomeDto;
      expect(firstBody.batch.version).toBe(2);
      expect(firstBody.batch.files).toHaveLength(1);
      expect(storedVersion(batchId)).toBe(2);

      const replay = await removeFile(batchId, 0, request);
      expect(replay.statusCode).toBe(200);
      const replayBody = replay.json() as { batch: { version: number; files: unknown[] } } & MutationOutcomeDto;
      expect(replayBody.batch.version).toBe(2);
      expect(replayBody.idRemap).toEqual(firstBody.idRemap);
      expect(replayBody.droppedDraftItemIds).toEqual(firstBody.droppedDraftItemIds);
      expect(replayBody.identityUnchangedItemIds).toEqual(firstBody.identityUnchangedItemIds);
      expect(replayBody.replacedWithIdenticalDigest).toBe(firstBody.replacedWithIdenticalDigest);
      expect(replayBody.notices).toEqual(firstBody.notices);
      expect(storedVersion(batchId)).toBe(2);
      expect(storedOperationCount(batchId, 'remove')).toBe(1);
    }
  });

  it('removedFileRetryInLargerBatchReturnsOriginalOutcome: a first-index removal from a three-file batch replays after the remaining-set rule would fail', async () => {
    // [wechat, alipay, refund] -> [alipay, refund]. On replay the request carries two files but the
    // *current* list already has two, so a naive "files.length === previousFiles.length - 1" check
    // sees 2 !== 1 and rejects a legitimate retry.
    const { batchId } = await createBatch([
      fileEntry('wechat.csv', wechatCsv),
      fileEntry('alipay.csv', alipayCsv),
      fileEntry('refund.csv', refundCsv),
    ]);
    const request = {
      expectedVersion: 1,
      clientRequestId: 'remove-three-first',
      files: [fileEntry('alipay.csv', alipayCsv), fileEntry('refund.csv', refundCsv)],
    };

    const first = await removeFile(batchId, 0, request);
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as { batch: { version: number; files: unknown[] } } & MutationOutcomeDto;
    expect(firstBody.batch.version).toBe(2);
    expect(firstBody.batch.files).toHaveLength(2);
    expect(storedVersion(batchId)).toBe(2);

    const replay = await removeFile(batchId, 0, request);
    expect(replay.statusCode).toBe(200);
    const replayBody = replay.json() as { batch: { version: number; files: unknown[] } } & MutationOutcomeDto;
    expect(replayBody.batch.version).toBe(2);
    expect(replayBody.batch.files).toHaveLength(2);
    expect(replayBody.idRemap).toEqual(firstBody.idRemap);
    expect(replayBody.droppedDraftItemIds).toEqual(firstBody.droppedDraftItemIds);
    expect(replayBody.identityUnchangedItemIds).toEqual(firstBody.identityUnchangedItemIds);
    expect(replayBody.replacedWithIdenticalDigest).toBe(firstBody.replacedWithIdenticalDigest);
    expect(replayBody.notices).toEqual(firstBody.notices);
    expect(storedVersion(batchId)).toBe(2);
    expect(storedOperationCount(batchId, 'remove')).toBe(1);
  });

  it('a new removal request is still validated against current files and version', async () => {
    // The keyed replay path must not weaken the guards for a *fresh* request: an unrecorded key
    // still gets the current-index, last-file, remaining-set and version checks.
    const { batchId } = await createBatch([
      fileEntry('wechat.csv', wechatCsv),
      fileEntry('alipay.csv', alipayCsv),
      fileEntry('refund.csv', refundCsv),
    ]);
    const first = await removeFile(batchId, 1, {
      expectedVersion: 1,
      clientRequestId: 'remove-then-new-keys',
      files: [fileEntry('wechat.csv', wechatCsv), fileEntry('refund.csv', refundCsv)],
    });
    expect(first.statusCode).toBe(200);
    expect(storedVersion(batchId)).toBe(2);

    // A new key on a one-file batch: the last-file rule still fires. The payload is a *valid*
    // non-empty file array, so it gets past body parsing and is rejected by the batch rule itself.
    const { batchId: singleFileBatch } = await createBatch([fileEntry('wechat.csv', wechatCsv)]);
    const lastFile = await removeFile(singleFileBatch, 0, {
      expectedVersion: 1,
      clientRequestId: 'remove-new-key-last',
      files: [fileEntry('wechat.csv', wechatCsv)],
    });
    expect(lastFile.statusCode).toBe(400);
    expect(storedVersion(singleFileBatch)).toBe(1);
    expect(storedOperationCount(singleFileBatch, 'remove')).toBe(0);

    // A new key whose index is out of range of the *current* list: still invalid.
    const outOfRange = await removeFile(batchId, 5, {
      expectedVersion: 2,
      clientRequestId: 'remove-new-key-index',
      files: [fileEntry('wechat.csv', wechatCsv)],
    });
    expect(outOfRange.statusCode).toBe(400);

    // A new key that omits one of the surviving files: still the full-remaining-set rule.
    const partial = await removeFile(batchId, 0, {
      expectedVersion: 2,
      clientRequestId: 'remove-new-key-partial',
      files: [fileEntry('alipay.csv', alipayCsv)],
    });
    expect(partial.statusCode).toBe(400);

    // A new key with a stale expected version: passes the file-shape rules, then the CAS in the
    // write transaction rejects it — never a silent second mutation.
    const staleVersion = await removeFile(batchId, 0, {
      expectedVersion: 1,
      clientRequestId: 'remove-new-key-stale',
      files: [fileEntry('refund.csv', refundCsv)],
    });
    expect(staleVersion.statusCode).toBe(409);
    expect((staleVersion.json() as { error: { code: string } }).error.code).toBe('IMPORT_BATCH_STALE_VERSION');
    expect(storedVersion(batchId)).toBe(2);
    // Only the first, accepted removal published an operation record.
    expect(storedOperationCount(batchId, 'remove')).toBe(1);
  });

  it('a replayed removal still rejects a changed payload under the same key', async () => {
    const { batchId } = await createBatch([fileEntry('wechat.csv', wechatCsv), fileEntry('alipay.csv', alipayCsv)]);
    const request = { expectedVersion: 1, clientRequestId: 'remove-mismatch', files: [fileEntry('wechat.csv', wechatCsv)] };
    const first = await removeFile(batchId, 1, request);
    expect(first.statusCode).toBe(200);

    // Same key, different resulting file set: still an idempotency mismatch, never a silent success.
    const tampered = await removeFile(batchId, 1, { ...request, files: [fileEntry('alipay.csv', alipayCsv)] });
    expect(tampered.statusCode).toBe(409);
    expect((tampered.json() as { error: { code: string } }).error.code).toBe('IMPORT_BATCH_IDEMPOTENCY_MISMATCH');
    expect(storedVersion(batchId)).toBe(2);
    expect(storedOperationCount(batchId, 'remove')).toBe(1);
  });
});

describe('F02 review category entity counts', () => {
  it('duplicateRenamedSuggestionsCountOneEntity: two suggestions renamed to one new entity review as one creation and confirm one', async () => {
    const { batchId } = await createBatch([fileEntry('wechat.csv', wechatCsv)]);
    const rows = (await allRows(batchId))
      .filter((row) => !row.existing && !row.ignored && row.amountCents > 0 && row.conflictKind === null && row.type === 0)
      .slice(0, 2);
    expect(rows).toHaveLength(2);
    const [firstRow, secondRow] = rows as [RowDto, RowDto];

    // Two distinct, valid suggestions that the user renames to the SAME new [name, type, parent]
    // entity. Approval names are editable, so distinct proposals can converge at review time.
    const firstSuggestionId = 'sug-rename-first';
    const secondSuggestionId = 'sug-rename-second';
    const suggestionRecords = [
      {
        suggestionId: firstSuggestionId,
        origin: 'server-fallback' as const,
        name: '旧名甲',
        type: 0,
        parentId: null,
        relatedItemIds: [firstRow.itemId],
      },
      {
        suggestionId: secondSuggestionId,
        origin: 'server-fallback' as const,
        name: '旧名乙',
        type: 0,
        parentId: null,
        relatedItemIds: [secondRow.itemId],
      },
    ];
    db.prepare('UPDATE assistant_import_batches SET suggestions_json = ? WHERE id = ?').run(
      JSON.stringify(suggestionRecords),
      batchId,
    );
    for (const record of suggestionRecords) {
      db.prepare(
        `INSERT OR REPLACE INTO assistant_import_batch_categories
           (batch_id, suggestion_id, origin, name, type, parent_id, related_item_ids_json)
         VALUES (?, ?, 'server-fallback', ?, 0, NULL, ?)`,
      ).run(batchId, record.suggestionId, record.name, JSON.stringify(record.relatedItemIds));
    }

    const sharedName = '统一后的新分类';
    const approvedCategories = [
      {
        suggestionId: firstSuggestionId,
        resolution: 'create' as const,
        reuseCategoryId: null,
        name: sharedName,
        type: 0,
        parentId: null,
      },
      {
        suggestionId: secondSuggestionId,
        resolution: 'create' as const,
        reuseCategoryId: null,
        name: sharedName,
        type: 0,
        parentId: null,
      },
    ];
    const assignments: Record<string, unknown> = {
      [firstRow.itemId]: { kind: 'suggestion', suggestionId: firstSuggestionId },
      [secondRow.itemId]: { kind: 'suggestion', suggestionId: secondSuggestionId },
    };

    const reviewResponse = await review(batchId, [firstRow.itemId, secondRow.itemId], {
      assignments,
      approvedCategories,
    });
    expect(reviewResponse.statusCode).toBe(200);
    const reviewed = reviewResponse.json() as {
      reviewToken: string;
      summary: {
        categoriesToCreate: { name: string; type: number; selectedRows: number }[];
        categoriesToReuse: unknown[];
      };
    };
    // Review must speak in the same distinct-entity units Confirm writes.
    expect(reviewed.summary.categoriesToCreate).toHaveLength(1);
    expect(reviewed.summary.categoriesToCreate[0]?.name).toBe(sharedName);
    expect(reviewed.summary.categoriesToCreate[0]?.selectedRows).toBe(2);
    expect(reviewed.summary.categoriesToReuse).toHaveLength(0);

    const confirmed = await inject(
      'POST',
      `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/confirm`,
      {
        reviewToken: reviewed.reviewToken,
        expectedVersion: 1,
        files: [{ fileIndex: 0, fileBase64: wechatCsv.toString('base64') }],
      },
    );
    expect(confirmed.statusCode).toBe(200);
    const result = (confirmed.json() as {
      result: { categoriesCreated: number; categoriesReused: number; inserted: number };
    }).result;
    expect(result.categoriesCreated).toBe(1);
    expect(result.categoriesReused).toBe(0);
    expect(result.inserted).toBe(2);

    const created = db
      .prepare('SELECT COUNT(*) AS c FROM categories WHERE name = ? AND deleted = 0')
      .get(sharedName) as { c: number };
    expect(created.c).toBe(1);
  });

  it('plannedCategoryEntityIdentityIncludesTypeAndParent: same name with a different type or parent stays a separate entity', async () => {
    // The entity key must be [name, type, parent], not the name alone: two approved suggestions can
    // legitimately share a display name while describing different entities, and merging them would
    // under-report what confirmation actually creates.
    const { batchId } = await createBatch([fileEntry('wechat.csv', wechatCsv)]);
    const rows = (await allRows(batchId))
      .filter((row) => !row.existing && !row.ignored && row.amountCents > 0 && row.conflictKind === null && row.type === 0)
      .slice(0, 2);
    expect(rows).toHaveLength(2);
    const [firstRow, secondRow] = rows as [RowDto, RowDto];

    // A live expense root is a valid parent for a new expense leaf (`requireParentId` rule).
    const parentName = '统一父级';
    const parentId = 'test-parent-expense';
    db.prepare(
      `INSERT INTO categories (id, name, type, parent_id, icon, color, sort_order, is_builtin, deleted, updated_at)
       VALUES (?, ?, 0, NULL, 'other', 0xff9e9e9e, 100, 0, 0, ?)`,
    ).run(parentId, parentName, NOW);

    const firstSuggestionId = 'sug-scope-second';
    const secondSuggestionId = 'sug-scope-first';
    const suggestionRecords = [
      {
        suggestionId: firstSuggestionId,
        origin: 'server-fallback' as const,
        name: '旧名甲',
        type: 0,
        parentId: null,
        relatedItemIds: [firstRow.itemId],
      },
      {
        suggestionId: secondSuggestionId,
        origin: 'server-fallback' as const,
        name: '旧名乙',
        type: 0,
        parentId: null,
        relatedItemIds: [secondRow.itemId],
      },
    ];
    db.prepare('UPDATE assistant_import_batches SET suggestions_json = ? WHERE id = ?').run(
      JSON.stringify(suggestionRecords),
      batchId,
    );
    for (const record of suggestionRecords) {
      db.prepare(
        `INSERT OR REPLACE INTO assistant_import_batch_categories
           (batch_id, suggestion_id, origin, name, type, parent_id, related_item_ids_json)
         VALUES (?, ?, 'server-fallback', ?, 0, NULL, ?)`,
      ).run(batchId, record.suggestionId, record.name, JSON.stringify(record.relatedItemIds));
    }

    const sharedName = '同名但父级不同';
    const approvedCategories = [
      {
        suggestionId: firstSuggestionId,
        resolution: 'create' as const,
        reuseCategoryId: null,
        name: sharedName,
        type: 0,
        parentId: null,
      },
      {
        suggestionId: secondSuggestionId,
        resolution: 'create' as const,
        reuseCategoryId: null,
        name: sharedName,
        type: 0,
        parentId,
      },
    ];
    const assignments: Record<string, unknown> = {
      [firstRow.itemId]: { kind: 'suggestion', suggestionId: firstSuggestionId },
      [secondRow.itemId]: { kind: 'suggestion', suggestionId: secondSuggestionId },
    };

    const reviewResponse = await review(batchId, [firstRow.itemId, secondRow.itemId], {
      assignments,
      approvedCategories,
    });
    expect(reviewResponse.statusCode).toBe(200);
    const reviewed = reviewResponse.json() as {
      reviewToken: string;
      summary: { categoriesToCreate: { name: string; type: number; selectedRows: number }[]; categoriesToReuse: unknown[] };
    };
    // Same display name, different parent => two distinct entities, so two creations.
    expect(reviewed.summary.categoriesToCreate).toHaveLength(2);
    expect(reviewed.summary.categoriesToCreate.every((entry) => entry.name === sharedName)).toBe(true);
    expect(reviewed.summary.categoriesToCreate.map((entry) => entry.selectedRows).sort()).toEqual([1, 1]);
    expect(reviewed.summary.categoriesToReuse).toHaveLength(0);

    const confirmed = await inject(
      'POST',
      `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/confirm`,
      {
        reviewToken: reviewed.reviewToken,
        expectedVersion: 1,
        files: [{ fileIndex: 0, fileBase64: wechatCsv.toString('base64') }],
      },
    );
    expect(confirmed.statusCode).toBe(200);
    const result = (confirmed.json() as {
      result: { categoriesCreated: number; categoriesReused: number; inserted: number };
    }).result;
    expect(result.categoriesCreated).toBe(2);
    expect(result.categoriesReused).toBe(0);
    expect(result.inserted).toBe(2);
    // Confirmation really made two rows under that display name with different parents.
    const created = db
      .prepare('SELECT parent_id FROM categories WHERE name = ? AND deleted = 0 ORDER BY parent_id')
      .all(sharedName) as { parent_id: string | null }[];
    expect(created.map((row) => row.parent_id).sort()).toEqual([null, parentId].sort());
  });

  it('convergedCreationsAndExistingReuseAreCountedSeparately: a planned creation and a live reuse are never double-counted', async () => {
    // One row is assigned straight to a live category; the other is approved as a NEW entity that
    // converges on two renamed suggestions. Reuse counts the live entity once, creation counts the
    // planned entity once, and confirmation reports that same split.
    const { batchId } = await createBatch([fileEntry('wechat.csv', wechatCsv)]);
    const rows = (await allRows(batchId))
      .filter((row) => !row.existing && !row.ignored && row.amountCents > 0 && row.conflictKind === null && row.type === 0)
      .slice(0, 3);
    expect(rows).toHaveLength(3);
    const [existingRow, firstRow, secondRow] = rows as [RowDto, RowDto, RowDto];

    const firstSuggestionId = 'sug-mix-first';
    const secondSuggestionId = 'sug-mix-second';
    const suggestionRecords = [
      {
        suggestionId: firstSuggestionId,
        origin: 'server-fallback' as const,
        name: '旧名甲',
        type: 0,
        parentId: null,
        relatedItemIds: [firstRow.itemId],
      },
      {
        suggestionId: secondSuggestionId,
        origin: 'server-fallback' as const,
        name: '旧名乙',
        type: 0,
        parentId: null,
        relatedItemIds: [secondRow.itemId],
      },
    ];
    db.prepare('UPDATE assistant_import_batches SET suggestions_json = ? WHERE id = ?').run(
      JSON.stringify(suggestionRecords),
      batchId,
    );
    for (const record of suggestionRecords) {
      db.prepare(
        `INSERT OR REPLACE INTO assistant_import_batch_categories
           (batch_id, suggestion_id, origin, name, type, parent_id, related_item_ids_json)
         VALUES (?, ?, 'server-fallback', ?, 0, NULL, ?)`,
      ).run(batchId, record.suggestionId, record.name, JSON.stringify(record.relatedItemIds));
    }

    const sharedName = '收敛的新分类';
    const approvedCategories = [
      { suggestionId: firstSuggestionId, resolution: 'create' as const, reuseCategoryId: null, name: sharedName, type: 0, parentId: null },
      { suggestionId: secondSuggestionId, resolution: 'create' as const, reuseCategoryId: null, name: sharedName, type: 0, parentId: null },
    ];
    const assignments: Record<string, unknown> = {
      [existingRow.itemId]: { kind: 'existing', categoryId: 'builtin-expense-food' },
      [firstRow.itemId]: { kind: 'suggestion', suggestionId: firstSuggestionId },
      [secondRow.itemId]: { kind: 'suggestion', suggestionId: secondSuggestionId },
    };

    const reviewResponse = await review(batchId, [existingRow.itemId, firstRow.itemId, secondRow.itemId], {
      assignments,
      approvedCategories,
    });
    expect(reviewResponse.statusCode).toBe(200);
    const reviewed = reviewResponse.json() as {
      reviewToken: string;
      summary: {
        categoriesToCreate: { name: string; selectedRows: number }[];
        categoriesToReuse: { categoryId: string; selectedRows: number }[];
      };
    };
    expect(reviewed.summary.categoriesToCreate).toHaveLength(1);
    expect(reviewed.summary.categoriesToCreate[0]?.name).toBe(sharedName);
    expect(reviewed.summary.categoriesToCreate[0]?.selectedRows).toBe(2);
    expect(reviewed.summary.categoriesToReuse).toHaveLength(1);
    expect(reviewed.summary.categoriesToReuse[0]?.categoryId).toBe('builtin-expense-food');
    expect(reviewed.summary.categoriesToReuse[0]?.selectedRows).toBe(1);

    const confirmed = await inject(
      'POST',
      `/api/v1/assistant/conversations/${conversationId}/import-batches/${batchId}/confirm`,
      {
        reviewToken: reviewed.reviewToken,
        expectedVersion: 1,
        files: [{ fileIndex: 0, fileBase64: wechatCsv.toString('base64') }],
      },
    );
    expect(confirmed.statusCode).toBe(200);
    const result = (confirmed.json() as {
      result: { categoriesCreated: number; categoriesReused: number; inserted: number };
    }).result;
    expect(result.categoriesCreated).toBe(1);
    expect(result.categoriesReused).toBe(1);
    expect(result.inserted).toBe(3);
  });
});
