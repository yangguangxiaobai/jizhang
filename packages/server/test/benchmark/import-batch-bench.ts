/**
 * Local budget calibration for the merged import batch.
 *
 * Run with:
 *   node --expose-gc node_modules/.bin/tsx packages/server/test/benchmark/import-batch-bench.ts
 *
 * This is a *synthetic* benchmark with generated CSVs and XLSX archives. It exists to show what the
 * implemented budgets actually cost in this process, not to certify real exports: the protocol
 * explicitly requires that no safety claim is made until real (redacted) samples have been run.
 * It never touches the network, a provider, a production database or any real bill file.
 */
import Database from 'better-sqlite3';
import { deflateRawSync } from 'node:zlib';
import { initializeDatabase, type Db } from '../../src/db/index.js';
import { ImportBatchService } from '../../src/services/import-batch-service.js';
import { ImportBatchLimitError } from '../../src/services/import-batch-types.js';

interface ScenarioResult {
  readonly name: string;
  readonly outcome: string;
  readonly items: number | null;
  readonly parseMs: number;
  readonly heapDeltaMiB: number;
}

function gcNow(): void {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (typeof gc === 'function') gc();
}

function heapMiB(): number {
  return process.memoryUsage().heapUsed / 1024 / 1024;
}

const HEADER = '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注';

/** A synthetic WeChat CSV with `rows` bookable expense rows. */
function syntheticCsv(rows: number, orderPrefix: string): Buffer {
  const lines: string[] = [HEADER];
  for (let index = 0; index < rows; index += 1) {
    const day = String((index % 28) + 1).padStart(2, '0');
    lines.push(
      `2026-09-${day} 12:${String(index % 60).padStart(2, '0')}:00,商户消费,合成商户${index % 50},商品${index},支出,` +
        `${((index % 900) + 1).toFixed(2)},零钱,支付成功,${orderPrefix}${index},,`,
    );
  }
  return Buffer.from(lines.join('\n'), 'utf8');
}

/** A minimal but structurally valid XLSX archive whose single entry inflates to `bytes` of text. */
function syntheticXlsx(bytes: number): Buffer {
  const payload = Buffer.from(
    `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${'x'.repeat(Math.max(0, bytes - 120))}</t></is></c></row></sheetData></worksheet>`,
    'utf8',
  );
  const compressed = deflateRawSync(payload, { level: 9 });
  const name = Buffer.from('xl/worksheets/sheet1.xml', 'utf8');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(payload.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(payload.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const centralOffset = local.length + name.length + compressed.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + name.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, name, compressed, central, name, eocd]);
}

function service(db: Db) {
  return new ImportBatchService({ db, dataDir: '.', now: () => Date.now() });
}

function runCreate(
  name: string,
  files: { fileName: string; source: 'auto'; bytes: Buffer }[],
): ScenarioResult {
  const db = new Database(':memory:');
  initializeDatabase(db, null);
  const batches = service(db);
  const conversationId = 'bench-conversation';
  db.prepare(
    "INSERT INTO assistant_conversations (id, title, archived, created_at, updated_at) VALUES (?, '', 0, 1, 1)",
  ).run(conversationId);
  gcNow();
  const before = heapMiB();
  const started = Date.now();
  let outcome: string;
  let items: number | null = null;
  try {
    const result = batches.create(conversationId, {
      files: files.map((file) => ({ ...file, source: file.source })),
      analyse: false,
      clientRequestId: `bench-${name}`,
    });
    items = result.batch.summary.totalItems;
    outcome = `accepted (${items} items)`;
  } catch (error) {
    outcome =
      error instanceof ImportBatchLimitError
        ? `rejected IMPORT_BATCH_LIMIT_EXCEEDED: ${error.message}`
        : `rejected ${String((error as Error).name)}: ${(error as Error).message}`;
  }
  const parseMs = Date.now() - started;
  const heapDeltaMiB = heapMiB() - before;
  db.close();
  return { name, outcome, items, parseMs, heapDeltaMiB };
}

const results: ScenarioResult[] = [
  runCreate(
    '5 files x 100 rows (CSV): the 500-item cap boundary',
    Array.from({ length: 5 }, (_, index) => ({
      fileName: `bench-${index}.csv`,
      source: 'auto' as const,
      bytes: syntheticCsv(100, `BENCH${index}-`),
    })),
  ),
  runCreate('1 file x 501 rows (CSV): one over the item cap', [
    { fileName: 'over.csv', source: 'auto', bytes: syntheticCsv(501, 'OVER-') },
  ]),
  runCreate('1 file x 3001 raw rows (CSV)', [
    { fileName: 'rows.csv', source: 'auto', bytes: syntheticCsv(3001, 'ROWS-') },
  ]),
  runCreate('1 file x 64 MiB inflated XLSX (zip expansion)', [
    { fileName: 'bomb.xlsx', source: 'auto', bytes: syntheticXlsx(64 * 1024 * 1024) },
  ]),
];

process.stdout.write(
  [
    'scenario | outcome | items | parseMs | heapDeltaMiB',
    ...results.map(
      (result) =>
        `${result.name} | ${result.outcome} | ${result.items ?? '-'} | ${result.parseMs} | ${result.heapDeltaMiB.toFixed(1)}`,
    ),
  ].join('\n') + '\n',
);
