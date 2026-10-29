/**
 * Merged import batch: protocol boundaries that do not need a full HTTP round trip.
 *
 * These cover the caps that decide whether a batch is accepted at all, the refund/gross-expense
 * rule, the XLSX decompression ceiling, and the additive message allowlist. They are the tests most
 * likely to catch a silent regression in a value nobody looks at until production.
 */
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeDatabase, type Db } from '../src/db/index.js';
import { ImportBatchService } from '../src/services/import-batch-service.js';
import { ImportBatchLimitError, type ImportBatchRowDto } from '../src/services/import-batch-types.js';
import { normalizeAssistantContent } from '../src/services/assistant-types.js';
import { parsePlatformBills } from '@jizhang/shared';
import { xlsxToCsvText, XlsxLimitError } from '../src/services/xlsx-lite.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const HEADER = '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注';

let db: Db;
let batches: ImportBatchService;
let dataDir: string;
let conversationId: string;

function csv(rows: string[]): Buffer {
  return Buffer.from([HEADER, ...rows].join(String.fromCharCode(10)), 'utf8');
}

function rows(count: number, prefix: string): string[] {
  return Array.from({ length: count }, (_, index) => {
    const day = String((index % 28) + 1).padStart(2, '0');
    return `2026-09-${day} 12:${String(index % 60).padStart(2, '0')}:00,商户消费,商户${index},商品,支出,10.00,零钱,支付成功,${prefix}${index},,/`;
  });
}

function create(files: { fileName: string; source: 'auto' | 'wechat' | 'alipay'; bytes: Buffer }[], requestId = 'r-1') {
  return batches.create(conversationId, {
    files: files.map((file) => ({ fileName: file.fileName, source: file.source, bytes: file.bytes })),
    analyse: false,
    clientRequestId: requestId,
  });
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeDatabase(db, null);
  dataDir = mkdtempSync(join(tmpdir(), 'import-batch-limits-'));
  batches = new ImportBatchService({ db, dataDir, now: () => 0 });
  conversationId = 'conversation-1';
  db.prepare("INSERT INTO assistant_conversations (id, title, archived, created_at, updated_at) VALUES (?, '', 0, 1, 1)").run(
    conversationId,
  );
});

afterEach(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('materialised item cap', () => {
  it('accepts exactly 500 merged items', () => {
    const result = create([
      { fileName: 'five.csv', source: 'auto', bytes: csv(rows(500, 'CAP-')) },
    ]);
    expect(result.batch.summary.totalItems).toBe(500);
    expect(result.batch.status).toBe('prepared');
  });

  it('rejects 501 items outright instead of cropping', () => {
    expect(() => create([{ fileName: 'over.csv', source: 'auto', bytes: csv(rows(501, 'OVER-')) }])).toThrow(
      ImportBatchLimitError,
    );
    // Nothing was stored: a rejected batch leaves no partial workspace behind.
    const count = (db.prepare('SELECT COUNT(*) AS c FROM assistant_import_batches').get() as { c: number }).c;
    expect(count).toBe(0);
  });

  it('counts ignored and pre-existing rows toward the 500 cap', () => {
    // 500 materialised rows including neutral ones: the cap is on the review list, not on inserts.
    // 20 rule-ignored rows with distinct order ids: they still occupy the review list.
    const neutral = Array.from(
      { length: 20 },
      (_, index) => `2026-09-10 10:${String(index).padStart(2, '0')}:00,转账,自己,商品,/,10.00,零钱,已转账,NEUTRAL-${index},,/`,
    );
    const result = create([
      { fileName: 'mixed.csv', source: 'auto', bytes: csv([...neutral, ...rows(480, 'MIXED-')]) },
    ]);
    expect(result.batch.summary.totalItems).toBe(500);
    expect(result.batch.summary.ignored).toBeGreaterThan(0);
  });

  it('rejects a batch whose files exceed the total byte budget', () => {
    // Five ~2 MiB files: each is inside the per-file cap, the sum is not.
    const filler = '商品,'.repeat(2000);
    const big = (index: number) =>
      Buffer.from(
        `${HEADER}\n2026-09-10 10:${String(index).padStart(2, '0')}:00,商户,${filler}${filler},支出,10.00,零钱,支付成功,BIG${index},,/`,
        'utf8',
      );
    const files = Array.from({ length: 5 }, (_, index) => ({
      fileName: `big-${index}.csv`,
      source: 'auto' as const,
      bytes: Buffer.concat([big(index), Buffer.alloc(2 * 1024 * 1024, ' ')]),
    }));
    const total = files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
    expect(total).toBeGreaterThan(8 * 1024 * 1024);
    expect(() => create(files)).toThrow(ImportBatchLimitError);
  });
});

describe('refund and gross expense', () => {
  it('keeps a refunded purchase as a gross expense and the refund as refund income', () => {
    const result = create([
      {
        fileName: 'refund.csv',
        source: 'auto',
        bytes: csv([
          '2026-09-13 10:00:00,商户消费,商家,商品,支出,150.00,零钱,已全额退款,ORIGINAL-1,,/',
          '2026-09-13 11:00:00,商户退款,商家,退款,收入,30.00,零钱,已退款,REFUND-1,,/',
        ]),
      },
    ]);
    const items = batches
      .rows(conversationId, result.batch.batchId, { limit: 50 })
      .items as unknown as ImportBatchRowDto[];
    const original = items.find((item) => item.amountCents === 15000)!;
    const refund = items.find((item) => item.amountCents === 3000)!;
    // The refunded expense is NOT reduced, hidden or turned into income.
    expect(original.type).toBe(0);
    expect(original.isRefund).toBe(false);
    expect(original.refundWarning).not.toBeNull();
    // The refund keeps its own identity and refund flag.
    expect(refund.type).toBe(1);
    expect(refund.isRefund).toBe(true);
    expect(result.batch.summary.expenseCents).toBe(15000);
    expect(result.batch.summary.incomeCents).toBe(3000);
  });

  it('does not admit a pending refund status as completed money movement', () => {
    const result = create([
      {
        fileName: 'pending-refund.csv',
        source: 'auto',
        bytes: csv(['2026-09-13 10:00:00,商户退款,商家,退款,收入,30.00,零钱,退款中,PENDING-1,,/']),
      },
    ]);
    const items = batches.rows(conversationId, result.batch.batchId, { limit: 50 }).items as unknown as ImportBatchRowDto[];
    expect(items[0]!.ignored).toBe(true);
    expect(items[0]!.ignoreReason).toContain('状态');
  });
});

describe('XLSX decompression ceiling', () => {
  /** A structurally valid single-entry zip whose declared uncompressed size is `size`. */
  function zipWithPayload(payload: Buffer): Buffer {
    const compressed = deflateRawSync(payload, { level: 9 });
    const name = Buffer.from('xl/worksheets/sheet1.xml', 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(payload.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(payload.length, 24);
    central.writeUInt16LE(name.length, 28);
    const centralOffset = local.length + name.length + compressed.length;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(central.length + name.length, 12);
    eocd.writeUInt32LE(centralOffset, 16);
    return Buffer.concat([local, name, compressed, central, name, eocd]);
  }

  it('refuses an entry whose declared output exceeds the per-entry ceiling', () => {
    const declared = 9 * 1024 * 1024;
    const payload = Buffer.from(
      `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${'x'.repeat(declared - 120)}</t></is></c></row></sheetData></worksheet>`,
      'utf8',
    );
    const archive = zipWithPayload(payload);
    expect(() => xlsxToCsvText(archive, { maxEntryBytes: 8 * 1024 * 1024, maxTotalBytes: 16 * 1024 * 1024 })).toThrow(
      XlsxLimitError,
    );
  });

  it('refuses when the shared accumulator is already spent, even for a small entry', () => {
    const small = Buffer.from(
      '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>hi</t></is></c></row></sheetData></worksheet>',
      'utf8',
    );
    expect(() =>
      xlsxToCsvText(zipWithPayload(small), { maxEntryBytes: 8 * 1024 * 1024, maxTotalBytes: 1 }),
    ).toThrow(XlsxLimitError);
  });

  it('enforces worksheet row, column and cell limits before materializing the rows', () => {
    const valid = Buffer.from(
      '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>ok</t></is></c></row></sheetData></worksheet>',
      'utf8',
    );
    expect(() => xlsxToCsvText(zipWithPayload(valid), { maxRows: 1, maxColumns: 64, maxCellChars: 1000 })).not.toThrow();
    const tooManyRows = Buffer.from(
      '<worksheet><sheetData><row r="2"><c r="A2"><v>1</v></c></row></sheetData></worksheet>',
      'utf8',
    );
    expect(() => xlsxToCsvText(zipWithPayload(tooManyRows), { maxRows: 1 })).toThrow(XlsxLimitError);
    const tooManyColumns = Buffer.from(
      '<worksheet><sheetData><row r="1"><c r="BM1"><v>1</v></c></row></sheetData></worksheet>',
      'utf8',
    );
    expect(() => xlsxToCsvText(zipWithPayload(tooManyColumns), { maxColumns: 64 })).toThrow(XlsxLimitError);
    const longCell = Buffer.from(
      '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>oversized</t></is></c></row></sheetData></worksheet>',
      'utf8',
    );
    expect(() => xlsxToCsvText(zipWithPayload(longCell), { maxCellChars: 4 })).toThrow(XlsxLimitError);
  });

  it('refuses a truncated archive rather than reading past the file', () => {
    const payload = Buffer.from('<worksheet><sheetData/></worksheet>', 'utf8');
    const archive = zipWithPayload(payload);
    const truncated = archive.subarray(0, archive.length - 10);
    expect(() => xlsxToCsvText(truncated, { maxTotalBytes: 16 * 1024 * 1024 })).toThrow();
  });

  it('keeps the unbounded legacy behaviour when no budget is passed', () => {
    const payload = Buffer.from(
      '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>ok</t></is></c></row></sheetData></worksheet>',
      'utf8',
    );
    const archive = zipWithPayload(payload);
    expect(() => xlsxToCsvText(archive)).not.toThrow();
  });

  it('parses the real WeChat fixture through the shared parser unchanged', () => {
    const text = readFileSync(join(FIXTURES, 'wechat-bill-sample.csv'), 'utf8');
    const result = parsePlatformBills(text, 'wechat', { maxRows: 3000, maxColumns: 64, maxCellChars: 1000 });
    expect(result.total).toBe(34);
  });
});

describe('assistant message allowlist', () => {
  it('accepts the additive importBatch metadata on a text message', () => {
    const normalized = normalizeAssistantContent('text', {
      version: 1,
      text: '已读取 2 个账单文件。',
      importBatch: { batchId: 'b-1', version: 1, status: 'prepared', files: [{ fileName: 'a.csv' }] },
    });
    expect(normalized.importBatch).toBeDefined();
    expect(normalized.text).toBe('已读取 2 个账单文件。');
    expect(JSON.stringify(normalized)).not.toMatch(/reviewToken/);
  });

  it('still requires a card on a tool-card message', () => {
    expect(() => normalizeAssistantContent('tool-card', { version: 1, text: 'x', importBatch: { batchId: 'b' } })).toThrow();
  });

  it('refuses a token-shaped key inside the metadata', () => {
    expect(() =>
      normalizeAssistantContent('text', { version: 1, text: 'x', importBatch: { reviewToken: 'nope' } }),
    ).toThrow();
  });
});

describe('batch-wide XLSX inflation ceiling', () => {
  /** A single-entry zip whose payload inflates to roughly `size` bytes of compressible text. */
  function zipWithPayload(payload: Buffer): Buffer {
    const compressed = deflateRawSync(payload, { level: 9 });
    const name = Buffer.from('xl/worksheets/sheet1.xml', 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(payload.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(payload.length, 24);
    central.writeUInt16LE(name.length, 28);
    const centralOffset = local.length + name.length + compressed.length;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(central.length + name.length, 12);
    eocd.writeUInt32LE(centralOffset, 16);
    return Buffer.concat([local, name, compressed, central, name, eocd]);
  }

  it('counts every file in the batch against one shared accumulator', () => {
    // Three files, each individually inside the 8 MiB per-entry ceiling, whose combined payload
    // is over 16 MiB: only the shared counter can catch this.
    const perFile = 5_600_000;
    const files = Array.from({ length: 3 }, (_, index) => ({
      fileName: `spread-${index}.xlsx`,
      source: 'auto' as const,
      // Unique payloads, so the rejection is about the shared ceiling and not duplicate bytes.
      bytes: zipWithPayload(
        Buffer.from(
          `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${'x'.repeat(perFile)}${index}</t></is></c></row></sheetData></worksheet>`,
          'utf8',
        ),
      ),
    }));
    expect(perFile * 3).toBeGreaterThan(16 * 1024 * 1024);
    expect(() => create(files)).toThrow(ImportBatchLimitError);
    const count = (db.prepare('SELECT COUNT(*) AS c FROM assistant_import_batches').get() as { c: number }).c;
    expect(count).toBe(0);
  });

  it('accepts a single file well inside the ceiling', () => {
    const payload = Buffer.from(
      `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${'y'.repeat(500_000)}</t></is></c></row></sheetData></worksheet>`,
      'utf8',
    );
    const archive = zipWithPayload(payload);
    expect(() => xlsxToCsvText(archive, { maxEntryBytes: 8 * 1024 * 1024, maxTotalBytes: 16 * 1024 * 1024, counter: { total: 0 } })).not.toThrow();
  });
});
