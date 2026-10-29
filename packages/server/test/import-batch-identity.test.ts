/**
 * Pure identity / merge / ordering rules for the merged platform-bill import.
 *
 * These are the facts the whole feature rests on, so they are tested without a database:
 * what counts as the same movement, what must never be merged, and which conflicts force the
 * user to decide instead of the server guessing.
 */
import { describe, expect, it } from 'vitest';
import type { PlatformBillRow, PlatformBillSource } from '@jizhang/shared';
import {
  canonicalJson,
  compareItems,
  digestOf,
  identifyRow,
  itemIdCollisions,
  legacyLedgerId,
  ledgerStatusOf,
  mergeRows,
  simpleHash,
  type IdentityInput,
  type MergedItem,
} from '../src/services/import-batch-identity.js';

const FILE_A = 'a'.repeat(64);
const FILE_B = 'b'.repeat(64);
const ACCOUNT = 'account-wechat';

function row(overrides: Partial<PlatformBillRow> = {}): PlatformBillRow {
  return {
    dateLabel: '2026-09-15',
    type: 0,
    amountCents: 1850,
    note: '瑞幸咖啡',
    sourceCategory: '餐饮美食',
    counterparty: '瑞幸咖啡',
    externalId: 'ORDER-1',
    rawDirection: '支出',
    rawStatus: '支付成功',
    isRefund: false,
    refundWarning: null,
    ignored: false,
    ignoreReason: null,
    categoryName: '餐饮',
    accountName: '微信',
    id: 'wx-ORDER-1',
    sourceRow: 12,
    fullExternalId: 'ORDER-1',
    sourceTimestamp: '2026-09-15 12:03:41',
    ...overrides,
  };
}

function input(overrides: Partial<IdentityInput> = {}): IdentityInput {
  const platformRow = overrides.row ?? row();
  const merged: IdentityInput = {
    fileIndex: 0,
    fileName: 'wechat-09.xlsx',
    fileSha256: FILE_A,
    source: 'wechat' as PlatformBillSource,
    sourceRow: 12,
    comparisonAccountId: ACCOUNT,
    fullExternalId: platformRow.fullExternalId ?? null,
    row: platformRow,
    ...overrides,
  };
  return merged;
}

const NO_MERGE = { existingIds: new Set<string>(), ledgerNotesById: {} as Record<string, string> };

describe('canonical JSON and digests', () => {
  it('sorts object keys, so a reordered payload has the same digest', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(digestOf({ b: 1, a: 2 })).toBe(digestOf({ a: 2, b: 1 }));
  });

  it('preserves array order, because a fact vector is ordered', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it('reproduces the legacy parser hash exactly', () => {
    // `platform-bills.ts` builds `pb-{source}-{simpleHash(dateLabel|type|amount|note)}`;
    // the advisory-only legacy match depends on that staying byte-identical.
    expect(legacyLedgerId('wechat', row())).toBe(
      `pb-wechat-${simpleHash('2026-09-15|0|1850|瑞幸咖啡')}`,
    );
  });

  it('treats only failed/closed/unknown status as a blocked movement', () => {
    expect(ledgerStatusOf(null)).toBe('ok');
    expect(ledgerStatusOf('状态非成功')).toBe('blocked');
    expect(ledgerStatusOf('状态:已关闭')).toBe('blocked');
    expect(ledgerStatusOf('金额无效')).toBe('blocked');
    // Bookkeeping-rule ignores describe a completed movement the user may still select.
    expect(ledgerStatusOf('中性交易')).toBe('ok');
    expect(ledgerStatusOf('分类:投资理财')).toBe('ok');
  });
});

describe('strong identity (platform order id)', () => {
  it('derives itemId from the full order facts, without a source index', () => {
    const first = identifyRow(input());
    const second = identifyRow(input({ fileIndex: 3, fileName: 'other.xlsx', fileSha256: FILE_B }));
    expect(first.kind).toBe('strong');
    expect(first.itemId).toMatch(/^po:wechat:[a-f0-9]{32}$/);
    // Identity deliberately does not depend on the file index or the file bytes.
    expect(second.itemId).toBe(first.itemId);
    expect(first.ledgerId).toBe('wx-ORDER-1');
  });

  it('merges identical facts across files and keeps every source', () => {
    const merge = mergeRows(
      [
        input(),
        input({ fileIndex: 1, fileName: 'wechat-10.xlsx', fileSha256: FILE_B, sourceRow: 40 }),
      ],
      NO_MERGE,
    );
    expect(merge.items).toHaveLength(1);
    expect(merge.mergedGroups).toBe(1);
    expect(merge.items[0]!.sources).toHaveLength(2);
    expect(merge.items[0]!.sources.map((source) => source.fileName)).toEqual([
      'wechat-09.xlsx',
      'wechat-10.xlsx',
    ]);
    expect(merge.items[0]!.sources.every((source) => /^[ab]{64}:/.test(source.origin))).toBe(true);
  });

  it('is not a conflict when the note differs, but is one when an amount differs', () => {
    const noteOnly = mergeRows(
      [
        input(),
        input({ fileSha256: FILE_B, fileIndex: 1, fileName: 'b.xlsx', row: row({ note: '瑞幸咖啡（补开）' }) }),
      ],
      NO_MERGE,
    );
    expect(noteOnly.items).toHaveLength(1);
    expect(noteOnly.items[0]!.noteAlternatives).toEqual([
      { fileName: 'b.xlsx', note: '瑞幸咖啡（补开）' },
    ]);
    expect(noteOnly.conflictGroups).toBe(0);

    const amountDiffers = mergeRows(
      [input(), input({ fileSha256: FILE_B, fileIndex: 1, fileName: 'b.xlsx', row: row({ amountCents: 1900 }) })],
      NO_MERGE,
    );
    expect(amountDiffers.items).toHaveLength(2);
    expect(amountDiffers.conflictGroups).toBe(1);
    expect(amountDiffers.items.every((item) => item.conflictKind === 'fact_conflict')).toBe(true);
    expect(new Set(amountDiffers.items.map((item) => item.conflictGroup)).size).toBe(1);
  });

  it('treats the time of day as a financial fact', () => {
    const sameDayDifferentMinute = mergeRows(
      [
        input(),
        input({
          fileSha256: FILE_B,
          fileIndex: 1,
          fileName: 'b.xlsx',
          row: row({ sourceTimestamp: '2026-09-15 12:09:00' }),
        }),
      ],
      NO_MERGE,
    );
    expect(sameDayDifferentMinute.items).toHaveLength(2);
    expect(sameDayDifferentMinute.conflictGroups).toBe(1);
  });

  it('never treats two different sources of the same facts as an id collision', () => {
    const merge = mergeRows(
      [input(), input({ fileSha256: FILE_B, fileIndex: 1, fileName: 'b.xlsx', sourceRow: 44 })],
      NO_MERGE,
    );
    expect(itemIdCollisions(merge.items)).toEqual([]);
  });

  it('marks a ledger-id collision when two different order ids truncate to one ledger id', () => {
    // Both order ids are longer than the 64-character ledger-id column, so they truncate to the
    // same string while remaining two different orders.
    const longA = `${'9'.repeat(70)}AAA`;
    const longB = `${'9'.repeat(70)}BBB`;
    const merge = mergeRows(
      [
        input({ row: row({ externalId: longA, fullExternalId: longA, id: `wx-${longA}` }) }),
        input({
          fileSha256: FILE_B,
          fileIndex: 1,
          fileName: 'b.xlsx',
          sourceRow: 33,
          row: row({ externalId: longB, fullExternalId: longB, id: `wx-${longB}` }),
        }),
      ],
      NO_MERGE,
    );
    expect(merge.items).toHaveLength(2);
    expect(merge.items.every((item) => item.conflictKind === 'ledger_collision')).toBe(true);
  });

  it('uses the complete order id for equality, not the truncated ledger id', () => {
    // Both order ids are longer than the 64-character ledger-id column, so they truncate to the
    // same string while remaining two different orders.
    const longA = `${'9'.repeat(70)}AAA`;
    const longB = `${'9'.repeat(70)}BBB`;
    const merge = mergeRows(
      [
        input({ row: row({ externalId: longA, fullExternalId: longA, id: `wx-${longA}` }) }),
        input({ fileSha256: FILE_B, fileIndex: 1, fileName: 'b.xlsx', sourceRow: 34, row: row({ externalId: longB, fullExternalId: longB, id: `wx-${longB}` }) }),
      ],
      NO_MERGE,
    );
    const distinct = new Set(merge.items.map((item) => item.ledgerId));
    // The ledger ids may collide, but the items must never be silently folded into one.
    expect(merge.items).toHaveLength(2);
    expect(distinct.size).toBeLessThanOrEqual(2);
  });
});

describe('weak identity (no order id)', () => {
  const weakRow = (overrides: Partial<PlatformBillRow> = {}) =>
    row({ externalId: null, fullExternalId: null, id: 'pb-wechat-deadbeef', ...overrides });

  it('derives itemId from the full file digest plus the source row', () => {
    const identity = identifyRow(input({ row: weakRow(), sourceRow: 7, fullExternalId: null }));
    expect(identity.kind).toBe('weak');
    expect(identity.itemId).toBe(`ch:${FILE_A.slice(0, 32)}:7`);
    expect(identity.ledgerId).toMatch(/^pb-wechat-[a-f0-9]{32}$/);
  });

  it('keeps genuinely different no-order occurrences separate even on the same day and amount', () => {
    const merge = mergeRows(
      [
        input({ row: weakRow({ note: '午餐' }), sourceRow: 7, fullExternalId: null }),
        input({ row: weakRow({ note: '停车' }), sourceRow: 8, fullExternalId: null }),
      ],
      NO_MERGE,
    );
    expect(merge.items).toHaveLength(2);
    expect(merge.items.every((item) => item.conflictKind === null)).toBe(true);
  });

  it('exact re-upload of the same occurrence maps to one ledger id (hard existing)', () => {
    const first = mergeRows(
      [input({ row: weakRow(), sourceRow: 7, fullExternalId: null })],
      NO_MERGE,
    ).items[0]!;
    const existingIds = new Set([first.ledgerId]);
    const again = mergeRows(
      [input({ row: weakRow(), sourceRow: 7, fullExternalId: null })],
      { existingIds, ledgerNotesById: {} },
    );
    expect(again.items[0]!.existing).toBe(true);
  });

  it('does not merge distinct no-order occurrences that share a day, type and amount', () => {
    // Two coffees on one day are two real bills. Occurrence ids include the source row, so they
    // stay separate and are both selectable.
    const merge = mergeRows(
      [
        input({ row: weakRow({ note: '早晨咖啡' }), sourceRow: 7, fullExternalId: null }),
        input({ row: weakRow({ note: '下午咖啡' }), sourceRow: 9, fullExternalId: null }),
      ],
      NO_MERGE,
    );
    expect(merge.items).toHaveLength(2);
    expect(merge.items.every((item) => item.identityKind === 'occurrence')).toBe(true);
    expect(new Set(merge.items.map((item) => item.ledgerId)).size).toBe(2);
  });

  it('flags a legacy pb- match as advisory, never as a hard duplicate', () => {
    const legacyId = legacyLedgerId('wechat', {
      ...row({ externalId: null, fullExternalId: null }),
      amountCents: 1850,
    } as PlatformBillRow);
    const merge = mergeRows([input({ row: row({ externalId: null, fullExternalId: null, id: 'pb-x' }), fullExternalId: null, sourceRow: 3 })], {
      existingIds: new Set([legacyId]),
      ledgerNotesById: { [legacyId]: '历史导入的同一笔' },
    });
    expect(merge.items[0]!.legacyLedgerMatch).toBe(true);
    expect(merge.items[0]!.possibleDuplicate).toBe(true);
    expect(merge.items[0]!.duplicateOfNote).toBe('历史导入的同一笔');
    // Advisory only: the row is still importable.
    expect(merge.items[0]!.existing).toBe(false);
    expect(merge.legacyLedgerMatches).toBe(1);
  });

  it('hard-blocks a strong identity already present under its ledger id', () => {
    const merge = mergeRows([input()], { existingIds: new Set(['wx-ORDER-1']), ledgerNotesById: {} });
    expect(merge.items[0]!.existing).toBe(true);
  });
});

describe('order and ordinal', () => {
  it('sorts date desc, then file, then source row, then item id', () => {
    const items = [
      { ...base(), dateLabel: '2026-09-14', fileIndex: 0, sourceRow: 1, itemId: 'a' },
      { ...base(), dateLabel: '2026-09-15', fileIndex: 1, sourceRow: 1, itemId: 'b' },
      { ...base(), dateLabel: '2026-09-15', fileIndex: 0, sourceRow: 2, itemId: 'c' },
      { ...base(), dateLabel: '2026-09-15', fileIndex: 0, sourceRow: 1, itemId: 'd' },
    ].sort(compareItems);
    expect(items.map((item) => item.itemId)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('assigns a dense ordinal in display order', () => {
    const merge = mergeRows(
      [
        input({ row: row({ dateLabel: '2026-09-01' }), sourceRow: 20 }),
        input({ row: row({ dateLabel: '2026-09-30', externalId: 'ORDER-2', fullExternalId: 'ORDER-2', id: 'wx-ORDER-2', amountCents: 100 }), sourceRow: 21 }),
      ],
      NO_MERGE,
    );
    expect(merge.items.map((item) => item.ordinal)).toEqual([0, 1]);
    expect(merge.items[0]!.dateLabel).toBe('2026-09-30');
  });
});

// Shared shape helper for the ordering test: a fully-populated item with overridable facts.
function base(): MergedItem {
  return mergeRows([input()], NO_MERGE).items[0]!;
}
