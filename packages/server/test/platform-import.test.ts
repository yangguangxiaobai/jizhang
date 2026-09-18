/**
 * WeChat / Alipay platform bill import against the real 2026-09 export shapes.
 *
 * Contract under test:
 *   * GBK Alipay bytes and UTF-8 WeChat CSV both land
 *   * neutral / 不计收支 / 理财 / 信用借还 / refunded rows are ignored, not fatal
 *   * 微信/支付宝 accounts are created on first import
 *   * re-import is idempotent (stable platform order ids)
 *   * dry-run writes nothing
 *   * the native transactions CSV import path stays untouched
 */
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeDatabase, type Db } from '../src/db/index.js';
import { PortabilityService } from '../src/services/portability-service.js';
import { ValidationError } from '../src/services/transaction-service.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const wechatText = readFileSync(join(fixturesDir, 'wechat-bill-sample.csv'));
const alipayGbk = readFileSync(join(fixturesDir, 'alipay-bill-sample.csv'));
const alipayUtf8 = readFileSync(join(fixturesDir, 'alipay-bill-sample.utf8.csv'), 'utf8');

let db: Db;
let service: PortabilityService;
let dataDir: string;

function liveTxnCount(): number {
  return (
    db.prepare('SELECT COUNT(*) AS c FROM transactions WHERE deleted = 0').get() as { c: number }
  ).c;
}

function findAccountByName(name: string): { id: string; type: number; deleted: number } | undefined {
  return db
    .prepare('SELECT id, type, deleted FROM accounts WHERE name = ?')
    .get(name) as { id: string; type: number; deleted: number } | undefined;
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeDatabase(db, null);
  dataDir = mkdtempSync(join(tmpdir(), 'jizhang-platform-import-'));
  service = new PortabilityService(db, { dataDir });
});

afterEach(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('importPlatformBills — WeChat UTF-8 CSV', () => {
  it('imports bookable rows, creates the 微信 account, ignores neutral/refunds', () => {
    const result = service.importPlatformBills(wechatText, { source: 'auto' });

    expect(result.source).toBe('wechat');
    expect(result.total).toBe(34);
    expect(result.ignored).toBe(10);
    expect(result.importable).toBe(24);
    expect(result.inserted).toBe(24);
    expect(result.skipped).toBe(0);
    expect(result.accountsCreated).toBe(1);

    const account = findAccountByName('微信');
    expect(account).toBeDefined();
    expect(account?.type).toBe(4); // ACCOUNT_TYPE_WECHAT
    expect(account?.deleted).toBe(0);

    expect(liveTxnCount()).toBe(24);

    // Idempotent re-import
    const again = service.importPlatformBills(wechatText, { source: 'wechat' });
    expect(again.inserted).toBe(0);
    expect(again.skipped).toBe(24);
    expect(liveTxnCount()).toBe(24);
  });

  it('dry-run reports counts without writing', () => {
    const preview = service.importPlatformBills(wechatText, { source: 'auto', dryRun: true });
    expect(preview.dryRun).toBe(true);
    expect(preview.inserted).toBe(24);
    expect(preview.accountsCreated).toBe(1);
    expect(liveTxnCount()).toBe(0);
    expect(findAccountByName('微信')).toBeUndefined();
  });
});

describe('importPlatformBills — Alipay GBK bytes', () => {
  it('decodes GBK and imports only the three bookable rows', () => {
    const result = service.importPlatformBills(alipayGbk, { source: 'auto' });

    expect(result.source).toBe('alipay');
    expect(result.encoding).toBe('gbk');
    expect(result.total).toBe(14);
    expect(result.importable).toBe(3);
    expect(result.inserted).toBe(3);
    expect(result.ignored).toBe(11);
    expect(result.accountsCreated).toBe(1);

    const account = findAccountByName('支付宝');
    expect(account?.type).toBe(3); // ACCOUNT_TYPE_ALIPAY

    const rows = db
      .prepare(
        `SELECT t.id, t.type, t.amount_cents, t.note, a.name AS account_name, c.name AS category_name
           FROM transactions t
           JOIN accounts a ON a.id = t.account_id
           JOIN categories c ON c.id = t.category_id
          WHERE t.deleted = 0`,
      )
      .all() as {
      id: string;
      type: number;
      amount_cents: number;
      note: string;
      account_name: string;
      category_name: string;
    }[];

    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.account_name === '支付宝')).toBe(true);

    const pupu = rows.find((r) => r.id === 'ali-2026091623001449281404290055');
    expect(pupu).toBeDefined();
    expect(pupu?.type).toBe(0);
    expect(pupu?.amount_cents).toBe(6627);
    expect(pupu?.category_name).toBe('购物');

    const income = rows.find((r) => r.type === 1);
    expect(income?.amount_cents).toBe(13);

    const again = service.importPlatformBills(alipayGbk, { source: 'auto' });
    expect(again.inserted).toBe(0);
    expect(again.skipped).toBe(3);
    expect(liveTxnCount()).toBe(3);
  });

  it('accepts already-decoded UTF-8 Alipay text', () => {
    const result = service.importPlatformBills(alipayUtf8, { source: 'alipay' });
    expect(result.encoding).toBe('utf-8');
    expect(result.inserted).toBe(3);
  });
});

describe('importPlatformBills — error and coexistence', () => {
  it('rejects unrecognised text when source is auto', () => {
    expect(() => service.importPlatformBills('not a bill', { source: 'auto' })).toThrow(
      ValidationError,
    );
  });

  it('does not break the native CSV import path', () => {
    service.importPlatformBills(alipayGbk, { source: 'alipay' });
    const accounts = db.prepare('SELECT name FROM accounts WHERE deleted = 0').all() as {
      name: string;
    }[];
    const categories = db
      .prepare('SELECT name, type FROM categories WHERE deleted = 0')
      .all() as { name: string; type: number }[];

    const accountName = '默认账户';
    const expenseCat = categories.find((c) => c.name === '其他' && c.type === 0)?.name;
    const csv = [
      'id,date,type,amount,category,account,note,tags,isRefund',
      `native-1,2026-09-01,expense,12.50,${expenseCat},${accountName},午饭,,false`,
    ].join('\n');

    const result = service.importTransactionsCsv(csv);
    expect(result.inserted).toBe(1);
    expect(liveTxnCount()).toBe(4);
    expect(accounts.some((a) => a.name === accountName)).toBe(true);
  });
});
