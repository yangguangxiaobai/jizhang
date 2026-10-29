/**
 * Independent review regressions for the merged import batch.
 *
 * Every case here was first reproduced against the implementation as it stood, then fixed. They
 * deliberately use hand-written payloads instead of the shared fixtures so they cannot pass by
 * inheriting an assumption from the feature's own suites:
 *
 *   1. `/` in the order-id column is the export's "no order id" placeholder. Treating it as an id
 *      collapsed distinct no-order rows into one movement (or into a row that could never be
 *      booked) under the fake ledger id `wx-/`.
 *   2. A review issued for the server-resolved fallback used to succeed while the identical
 *      confirmation failed with "missing category", because the unresolved set was stored.
 *   3. A new-category parent was not re-validated, so an expense leaf could be created under an
 *      income category (the hand-create path rejects that).
 *   4. A file rebuild kept the previous AI suggestions in storage while clearing every `ai_*`
 *      column, advertising suggestions no row referenced any more.
 *   5. Conflict decisions naming an unknown or duplicated group made the "explicit decision"
 *      requirement trivially satisfiable.
 *   6. The review response reported the client-supplied view revision, which the server had
 *      already replaced, so the client could never re-read the view it was handed.
 */
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeDatabase, type Db } from '../src/db/index.js';
import { ImportBatchService } from '../src/services/import-batch-service.js';

const HEADER = '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注';
const CID = 'conversation-regression';
const EXPENSE = 'builtin-expense-other';

function csv(rows: string[]): Buffer {
  return Buffer.from([HEADER, ...rows].join('\n'), 'utf8');
}

function fileEntry(fileName: string, bytes: Buffer) {
  return { fileName, source: 'auto' as const, bytes };
}

interface RowShape {
  item_id: string;
  identity_kind: string;
  ledger_id: string;
  amount_cents: number;
  conflict_kind: string | null;
  ai_status: string;
  ai_new_suggestion_id: string | null;
}

let db: Db;
let service: ImportBatchService;
let dataDir: string;

function create(files: ReturnType<typeof fileEntry>[], requestId = `req-${Math.random().toString(36).slice(2)}`) {
  return service.create(CID, { files, analyse: false, clientRequestId: requestId });
}

function rowsOf(batchId: string): RowShape[] {
  return db
    .prepare(
      `SELECT item_id, identity_kind, ledger_id, amount_cents, conflict_kind, ai_status, ai_new_suggestion_id
         FROM assistant_import_batch_rows WHERE batch_id = ? ORDER BY ordinal`,
    )
    .all(batchId) as RowShape[];
}

function viewOf(batchId: string) {
  return service.get(CID, batchId);
}

function reviewForWithView(batchId: string, itemId: string, viewRevision: string) {
  const view = viewOf(batchId);
  return service.review(CID, batchId, {
    version: view.version,
    analysisRevision: view.analysis.analysisRevision,
    viewRevision,
    selectedItemIds: [itemId],
    categoryAssignments: { [itemId]: { kind: 'existing', categoryId: EXPENSE } },
    noteOverrides: {},
    approvedCategories: [],
    conflictDecisions: [],
  });
}

function reviewFor(
  batchId: string,
  selectedItemIds: string[],
  overrides: Partial<Parameters<ImportBatchService['review']>[2]> = {},
) {
  const view = viewOf(batchId);
  const assignments: Record<string, { kind: 'existing'; categoryId: string }> = {};
  for (const itemId of selectedItemIds) assignments[itemId] = { kind: 'existing', categoryId: EXPENSE };
  return service.review(CID, batchId, {
    version: view.version,
    analysisRevision: view.analysis.analysisRevision,
    viewRevision: view.viewRevision,
    selectedItemIds,
    categoryAssignments: assignments,
    noteOverrides: {},
    approvedCategories: [],
    conflictDecisions: [],
    ...overrides,
  });
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeDatabase(db, null);
  dataDir = mkdtempSync(join(tmpdir(), 'import-batch-regression-'));
  service = new ImportBatchService({ db, dataDir, now: () => 0 });
  db.prepare(
    "INSERT INTO assistant_conversations (id, title, archived, created_at, updated_at) VALUES (?, '', 0, 1, 1)",
  ).run(CID);
});

afterEach(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('regression: the `/` order-id placeholder is never an identity', () => {
  it('keeps two identical no-order rows apart instead of booking a single fake movement', () => {
    const bytes = csv([
      '2026-09-13,商户消费,甲公司,商品,支出,10.00,零钱,支付成功,/,/,/',
      '2026-09-13,商户消费,甲公司,商品,支出,10.00,零钱,支付成功,/,/,/',
    ]);
    const { batch } = create([fileEntry('a.csv', bytes)]);
    const rows = rowsOf(batch.batchId);
    // Before the fix these two were a single `platform_order` item on the literal ledger id `wx-/`.
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.identity_kind === 'occurrence')).toBe(true);
    expect(rows.every((row) => !row.ledger_id.includes('/'))).toBe(true);
    expect(new Set(rows.map((row) => row.ledger_id)).size).toBe(2);
  });

  it('does not turn two different no-order movements into an unbookable fact conflict', () => {
    const bytes = csv([
      '2026-09-13 10:00:00,商户消费,甲公司,商品,支出,10.00,零钱,支付成功,/,/,/',
      '2026-09-13 11:00:00,商户消费,甲公司,商品,支出,20.00,零钱,支付成功,/,/,/',
    ]);
    const { batch } = create([fileEntry('a.csv', bytes)]);
    const rows = rowsOf(batch.batchId);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.conflict_kind === null)).toBe(true);
    const review = reviewFor(batch.batchId, rows.map((row) => row.item_id));
    expect(review.summary.expenseCents).toBe(3000);
  });
});

describe('regression: review and confirm agree on the server-resolved fallback', () => {
  it('confirms a review that omitted the client-side assignments', () => {
    const bytes = csv(['2026-09-13 10:00:00,商户消费,商户,商品,支出,10.00,零钱,支付成功,ORDER-1,,/']);
    const { batch } = create([fileEntry('a.csv', bytes)]);
    const row = rowsOf(batch.batchId)[0]!;
    const review = reviewFor(batch.batchId, [row.item_id], { categoryAssignments: {} });
    // The pre-fix bug: this exact confirmation answered IMPORT_BATCH_CATEGORY_REQUIRED.
    const confirmed = service.confirm(CID, batch.batchId, {
      reviewToken: review.reviewToken,
      expectedVersion: viewOf(batch.batchId).version,
      files: [{ fileIndex: 0, bytes }],
    });
    expect(confirmed.result.inserted).toBe(1);
    expect(confirmed.result.excluded).toBe(0);
  });

  it('drops an override for a row the user unselected instead of failing the confirmation', () => {
    const bytes = csv([
      '2026-09-13 10:00:00,商户消费,商户,商品,支出,10.00,零钱,支付成功,ORDER-1,,/',
      '2026-09-14 10:00:00,商户消费,商户2,商品,支出,20.00,零钱,支付成功,ORDER-2,,/',
    ]);
    const { batch } = create([fileEntry('a.csv', bytes)]);
    const rows = rowsOf(batch.batchId);
    const review = reviewFor(batch.batchId, [rows[0]!.item_id], {
      noteOverrides: { [rows[1]!.item_id]: '这条不导入' },
    });
    const confirmed = service.confirm(CID, batch.batchId, {
      reviewToken: review.reviewToken,
      expectedVersion: viewOf(batch.batchId).version,
      files: [{ fileIndex: 0, bytes }],
    });
    expect(confirmed.result.inserted).toBe(1);
    const written = db.prepare('SELECT note FROM transactions WHERE deleted = 0').all() as { note: string }[];
    expect(written.map((row) => row.note)).not.toContain('这条不导入');
  });
});

describe('regression: a new-category parent is validated in every phase', () => {
  function createBatchWithoutOther() {
    // Removing both fallback leaves forces the server-fallback suggestion that must be approved.
    db.prepare("UPDATE categories SET deleted = 1 WHERE name IN ('其他', '其他收入')").run();
    const bytes = csv(['2026-09-13 10:00:00,商户消费,商户,商品,支出,10.00,零钱,支付成功,ORDER-1,,/']);
    const { batch } = create([fileEntry('a.csv', bytes)]);
    const row = rowsOf(batch.batchId)[0]!;
    return { batch, row, bytes };
  }

  function suggestionIdOf(batchId: string): string {
    const items = service.categories(CID, batchId, undefined).items;
    const suggestion = items.find((item) => item.type === 0);
    expect(suggestion).toBeDefined();
    return suggestion!.suggestionId;
  }

  it('refuses an income category as the parent of a new expense category', () => {
    const { batch, row } = createBatchWithoutOther();
    const suggestionId = suggestionIdOf(batch.batchId);
    expect(() =>
      reviewFor(batch.batchId, [row.item_id], {
        categoryAssignments: { [row.item_id]: { kind: 'suggestion', suggestionId } },
        approvedCategories: [
          { suggestionId, resolution: 'create', reuseCategoryId: null, name: '新支出类', type: 0, parentId: 'builtin-income-salary' },
        ],
      }),
    ).toThrowError(/父级/);
  });

  it('refuses an unknown parent instead of failing later on the foreign key', () => {
    const { batch, row } = createBatchWithoutOther();
    const suggestionId = suggestionIdOf(batch.batchId);
    expect(() =>
      reviewFor(batch.batchId, [row.item_id], {
        categoryAssignments: { [row.item_id]: { kind: 'suggestion', suggestionId } },
        approvedCategories: [
          { suggestionId, resolution: 'create', reuseCategoryId: null, name: '另一个', type: 0, parentId: 'no-such-parent' },
        ],
      }),
    ).toThrowError(/父级/);
  });
});

describe('regression: a file rebuild clears the AI suggestions it orphaned', () => {
  it('removes AI suggestion rows so no suggestion outlives its rows', () => {
    const bytes = csv(['2026-09-13 10:00:00,商户消费,商户,商品,支出,10.00,零钱,支付成功,ORDER-1,,/']);
    const { batch } = create([fileEntry('a.csv', bytes)]);
    const fence = service.beginAnalysis(CID, batch.batchId, 'owner-1');
    const itemId = rowsOf(batch.batchId)[0]!.item_id;
    service.publishAnalysis(batch.batchId, 'owner-1', fence.batch.version, fence.revision, {
      state: 'complete',
      providerCalls: 1,
      recommendations: [{ itemId, include: true, reason: 'x', categoryId: null, newSuggestionId: 'nc-ai-1' }],
      suggestions: [
        { suggestionId: 'nc-ai-1', origin: 'ai', name: '新分类', type: 0, parentId: null, relatedItemIds: [itemId] },
      ],
    });
    expect(service.categories(CID, batch.batchId, undefined).items.some((item) => item.origin === 'ai')).toBe(true);

    const changed = csv([
      '2026-09-13 10:00:00,商户消费,商户,商品,支出,10.00,零钱,支付成功,ORDER-1,,/',
      '2026-09-14 10:00:00,商户消费,商户2,商品,支出,30.00,零钱,支付成功,ORDER-2,,/',
    ]);
    service.mutateFiles(CID, batch.batchId, 'replace', 0, {
      expectedVersion: 1,
      clientRequestId: 'rebuild-1',
      files: [fileEntry('a.csv', changed)],
    });

    expect(rowsOf(batch.batchId).every((row) => row.ai_status === 'none')).toBe(true);
    expect(rowsOf(batch.batchId).every((row) => row.ai_new_suggestion_id === null)).toBe(true);
    const items = service.categories(CID, batch.batchId, undefined).items;
    expect(items.some((item) => item.origin === 'ai')).toBe(false);
  });
});

describe('regression: conflict decisions are checked against the batch', () => {
  function conflictBatch() {
    // Two rows with the same order id and a different amount: a fact conflict group.
    const a = csv(['2026-09-13 10:00:00,商户消费,甲公司,商品,支出,10.00,零钱,支付成功,ORDER-1,,/']);
    const b = csv(['2026-09-13 10:00:00,商户消费,甲公司,商品,支出,99.00,零钱,支付成功,ORDER-1,,/']);
    const { batch } = create([fileEntry('a.csv', a), fileEntry('b.csv', b)]);
    return { batch, rows: rowsOf(batch.batchId) };
  }

  it('rejects a decision for a group that is not in the batch', () => {
    const { batch, rows } = conflictBatch();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.conflict_kind === 'fact_conflict')).toBe(true);
    const group = db
      .prepare('SELECT conflict_group AS g FROM assistant_import_batch_rows WHERE batch_id = ? LIMIT 1')
      .get(batch.batchId) as { g: string };
    expect(() =>
      reviewFor(batch.batchId, [rows[0]!.item_id], {
        conflictDecisions: [{ conflictGroup: `${group.g}-unknown`, chosenItemId: rows[0]!.item_id }],
      }),
    ).toThrowError(/冲突分组/);
  });

  it('rejects a decision whose chosen item belongs to a different conflict group', () => {
    // Two independent fact conflicts, so a real foreign item id exists to point at.
    const a = csv(['2026-09-13 10:00:00,商户消费,甲公司,商品,支出,10.00,零钱,支付成功,ORDER-1,,/']);
    const a2 = csv(['2026-09-13 10:00:00,商户消费,甲公司,商品,支出,99.00,零钱,支付成功,ORDER-1,,/']);
    const b = csv(['2026-09-14 10:00:00,商户消费,乙公司,商品,支出,20.00,零钱,支付成功,ORDER-2,,/']);
    const b2 = csv(['2026-09-14 10:00:00,商户消费,乙公司,商品,支出,88.00,零钱,支付成功,ORDER-2,,/']);
    const { batch } = create([
      fileEntry('a.csv', a),
      fileEntry('a2.csv', a2),
      fileEntry('b.csv', b),
      fileEntry('b2.csv', b2),
    ]);
    const rows = rowsOf(batch.batchId);
    const groups = new Map<string, string[]>();
    for (const row of db
      .prepare('SELECT item_id, conflict_group FROM assistant_import_batch_rows WHERE batch_id = ?')
      .all(batch.batchId) as { item_id: string; conflict_group: string }[]) {
      groups.set(row.conflict_group, [...(groups.get(row.conflict_group) ?? []), row.item_id]);
    }
    expect(groups.size).toBe(2);
    const [groupA, groupB] = [...groups.entries()];
    const chosenFromB = groupB![1][0]!;
    expect(rows).toHaveLength(4);
    expect(() =>
      reviewFor(batch.batchId, [groupA![1][0]!], {
        conflictDecisions: [{ conflictGroup: groupA![0], chosenItemId: chosenFromB }],
      }),
    ).toThrowError(/冲突选择/);
  });

  it('still books the single explicitly chosen member of a fact conflict', () => {
    const { batch, rows } = conflictBatch();
    const group = db
      .prepare('SELECT conflict_group AS g FROM assistant_import_batch_rows WHERE batch_id = ? LIMIT 1')
      .get(batch.batchId) as { g: string };
    const review = reviewFor(batch.batchId, [rows[0]!.item_id], {
      conflictDecisions: [{ conflictGroup: group.g, chosenItemId: rows[0]!.item_id }],
    });
    expect(review.summary.selected).toBe(1);
    expect(review.summary.expenseCents).toBe(rows[0]!.amount_cents);
  });
});

describe('regression: the summary counts real merges, not conflicts', () => {
  it('does not count a fact conflict as a merged group', () => {
    // Same order id, different amount: two items, one conflict group, zero merges. The old SQL
    // grouping by ledger id reported this as a merge, so a conflicted batch claimed to have
    // folded rows that were in fact still two separate decisions.
    const a = csv(['2026-09-13 10:00:00,商户消费,甲公司,商品,支出,10.00,零钱,支付成功,ORDER-1,,/']);
    const b = csv(['2026-09-13 10:00:00,商户消费,甲公司,商品,支出,99.00,零钱,支付成功,ORDER-1,,/']);
    const { batch } = create([fileEntry('a.csv', a), fileEntry('b.csv', b)]);
    const summary = viewOf(batch.batchId).summary;
    expect(summary.totalItems).toBe(2);
    expect(summary.mergedGroups).toBe(0);
    expect(summary.conflictGroups).toBe(1);
    expect(summary.sourceRecords).toBe(2);
  });

  it('still counts a cross-file merge of identical facts', () => {
    // Same order and facts, but a different note per file, so the bytes differ and the two exports
    // are legal inputs that must collapse into one item with both sources.
    const a = csv(['2026-09-13 10:00:00,商户消费,甲公司,商品,支出,10.00,零钱,支付成功,ORDER-1,,/']);
    const b = csv(['2026-09-13 10:00:00,商户消费,甲公司,商品【重复导出】,支出,10.00,零钱,支付成功,ORDER-1,,/']);
    const { batch } = create([fileEntry('a.csv', a), fileEntry('b.csv', b)]);
    const summary = viewOf(batch.batchId).summary;
    expect(summary.totalItems).toBe(1);
    expect(summary.mergedGroups).toBe(1);
    expect(summary.conflictGroups).toBe(0);
    expect(summary.sourceRecords).toBe(2);
  });
});

describe('regression: a confirmation replay is identified by file index', () => {
  it('returns the original result when the same files are resent in a different array order', () => {
    const a = csv(['2026-09-13 10:00:00,商户消费,甲公司,商品,支出,10.00,零钱,支付成功,ORDER-A,,/']);
    const b = csv(['2026-09-14 10:00:00,商户消费,乙公司,商品,支出,20.00,零钱,支付成功,ORDER-B,,/']);
    const { batch } = create([fileEntry('a.csv', a), fileEntry('b.csv', b)]);
    const rows = rowsOf(batch.batchId);
    const review = reviewFor(batch.batchId, rows.map((row) => row.item_id));
    const first = service.confirm(CID, batch.batchId, {
      reviewToken: review.reviewToken,
      expectedVersion: viewOf(batch.batchId).version,
      files: [
        { fileIndex: 0, bytes: a },
        { fileIndex: 1, bytes: b },
      ],
    });
    expect(first.result.inserted).toBe(2);

    // Same bytes, same fileIndex values, different array order: still the same confirmed payload.
    const replay = service.confirm(CID, batch.batchId, {
      reviewToken: review.reviewToken,
      expectedVersion: 1,
      files: [
        { fileIndex: 1, bytes: b },
        { fileIndex: 0, bytes: a },
      ],
    });
    expect(replay.replayed).toBe(true);
    expect(replay.result.inserted).toBe(2);
    const live = db.prepare('SELECT COUNT(*) AS c FROM transactions WHERE deleted = 0').get() as { c: number };
    expect(live.c).toBe(2);
  });
});

describe('regression: the review response describes the view the token is bound to', () => {
  it('rejects a stale live view and permits review after an explicit reread', () => {
    const bytes = csv(['2026-09-13 10:00:00,商户消费,商户,商品,支出,10.00,零钱,支付成功,ORDER-1,,/']);
    const { batch } = create([fileEntry('a.csv', bytes)]);
    const row = rowsOf(batch.batchId)[0]!;
    const initialView = viewOf(batch.batchId);
    // Another legitimate catalogue write occurs after the caller's read.
    db.prepare(
      "INSERT INTO categories (id, name, type, icon, color, sort_order, is_builtin, deleted, updated_at) VALUES ('c-regression', '直播', 0, 'other', 0, 97, 0, 0, 0)",
    ).run();
    expect(() => reviewForWithView(batch.batchId, row.item_id, initialView.viewRevision)).toThrow(/重新读取/);

    const rebasedView = viewOf(batch.batchId);
    expect(rebasedView.viewRevision).not.toBe(initialView.viewRevision);
    const reviewed = service.review(CID, batch.batchId, {
      version: rebasedView.version,
      analysisRevision: rebasedView.analysis.analysisRevision,
      viewRevision: rebasedView.viewRevision,
      selectedItemIds: [row.item_id],
      categoryAssignments: { [row.item_id]: { kind: 'existing', categoryId: EXPENSE } },
      noteOverrides: {},
      approvedCategories: [],
      conflictDecisions: [],
    });
    expect(reviewed.viewRevision).toBe(rebasedView.viewRevision);
  });
});
