/**
 * Platform bill parsing against the real 2026-09 WeChat / Alipay export shapes.
 *
 * The fixtures are UTF-8 CSV mirrors of the user's exports (WeChat xlsx → CSV;
 * Alipay GBK decoded). Assertions follow the platforms' own preamble counts:
 * WeChat 34 rows (15 income / 11 expense / 8 neutral), Alipay 14 rows
 * (1 income / 4 expense / 9 不计收支).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  detectPlatformBillSource,
  locatePlatformHeaderRow,
  parsePlatformBills,
} from '../src/platform-bills.js';

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../server/test/fixtures',
);

const wechatCsv = readFileSync(join(fixturesDir, 'wechat-bill-sample.csv'), 'utf8');
const alipayCsv = readFileSync(join(fixturesDir, 'alipay-bill-sample.utf8.csv'), 'utf8');

describe('detectPlatformBillSource', () => {
  it('detects WeChat from the real export', () => {
    expect(detectPlatformBillSource(wechatCsv)).toBe('wechat');
  });

  it('detects Alipay from the real export', () => {
    expect(detectPlatformBillSource(alipayCsv)).toBe('alipay');
  });

  it('rejects unknown text', () => {
    expect(detectPlatformBillSource('hello,world')).toBe('unknown');
  });
});

describe('locatePlatformHeaderRow', () => {
  it('finds the WeChat header after the preamble', () => {
    const located = locatePlatformHeaderRow(wechatCsv);
    expect(located).not.toBeNull();
    expect(located?.map.get('time')).toBe(0);
    expect(located?.map.get('amount')).toBe(5);
    expect(located?.map.get('direction')).toBe(4);
  });

  it('finds the Alipay header past a long preamble (~46 lines)', () => {
    const located = locatePlatformHeaderRow(alipayCsv);
    expect(located).not.toBeNull();
    expect(located?.map.get('time')).toBe(0);
    expect(located?.map.get('category')).toBe(1);
    expect(located?.map.get('direction')).toBe(5);
    expect(located?.map.get('orderId')).toBe(9);
  });
});

describe('parsePlatformBills — WeChat', () => {
  const result = parsePlatformBills(wechatCsv, 'auto');

  it('detects source and row totals', () => {
    expect(result.source).toBe('wechat');
    expect(result.total).toBe(34);
  });

  it('ignores neutral 零钱通 transfers and fully refunded pairs', () => {
    const ignoredReasons = result.rows.filter((r) => r.ignored).map((r) => r.ignoreReason);
    expect(ignoredReasons).toContain('中性交易');
    expect(ignoredReasons).toContain('状态非成功或已退款');
    // 8 neutral + 2 refund sides
    expect(result.ignored).toBe(10);
  });

  it('imports 群收款/转账 income and merchant/transfer expenses', () => {
    const importable = result.rows.filter((r) => !r.ignored);
    const incomes = importable.filter((r) => r.type === 1);
    const expenses = importable.filter((r) => r.type === 0);
    expect(incomes).toHaveLength(14);
    expect(expenses).toHaveLength(10);
    expect(result.importable).toBe(24);
  });

  it('maps food-like merchants to 餐饮 and grocery to 购物', () => {
    const meituan = result.rows.find((r) => r.counterparty === '美团' && !r.ignored);
    expect(meituan?.categoryName).toBe('餐饮');
    const fruit = result.rows.find((r) => r.counterparty === '新鲜果蔬菜' && !r.ignored);
    expect(fruit?.categoryName).toBe('餐饮');
    const discount = result.rows.find((r) => r.counterparty.includes('拾贰生活'));
    expect(discount?.categoryName).toBe('购物');
  });

  it('treats 对方已收钱 / 已转账 as completed outflows', () => {
    const received = result.rows.find((r) => r.rawStatus === '对方已收钱' && r.amountCents === 8666);
    expect(received).toBeDefined();
    expect(received?.ignored).toBe(false);
    expect(received?.type).toBe(0);

    const qr = result.rows.find((r) => r.counterparty === '孤舟');
    expect(qr?.ignored).toBe(false);
    expect(qr?.type).toBe(0);
  });

  it('builds stable wx- ids from the trade order number', () => {
    const first = result.rows.find((r) => r.externalId === '4500000463202609184862617194');
    expect(first?.id).toBe('wx-4500000463202609184862617194');
    expect(first?.ignored).toBe(true);
  });

  it('uses account 微信 and scrapes amounts without ¥', () => {
    expect(result.rows.every((r) => r.accountName === '微信')).toBe(true);
    const food = result.rows.find((r) => r.counterparty === '新鲜果蔬菜');
    expect(food?.amountCents).toBe(800);
  });
});

describe('parsePlatformBills — Alipay', () => {
  const result = parsePlatformBills(alipayCsv, 'auto');

  it('detects source and totals from the real GBK export shape', () => {
    expect(result.source).toBe('alipay');
    expect(result.total).toBe(14);
  });

  it('skips 不计收支, 投资理财, 信用借还 and zero-amount rows', () => {
    const reasons = new Set(result.rows.filter((r) => r.ignored).map((r) => r.ignoreReason));
    // Alipay labels 余额宝/理财 rows as 不计收支, so that is the reason that fires first.
    expect(reasons.has('不计收支')).toBe(true);
    expect(reasons.has('分类:信用借还')).toBe(true);
    expect(reasons.has('金额无效')).toBe(true);
    expect(result.ignored).toBe(11);
  });

  it('imports the three bookable rows: two expenses + one income', () => {
    const importable = result.rows.filter((r) => !r.ignored);
    expect(importable).toHaveLength(3);

    const pupu = importable.find((r) => r.counterparty === '朴朴超市');
    expect(pupu?.type).toBe(0);
    expect(pupu?.amountCents).toBe(6627);
    expect(pupu?.categoryName).toBe('购物');
    expect(pupu?.externalId).toBe('2026091623001449281404290055');

    const meituan = importable.find((r) => r.counterparty === '美团');
    expect(meituan?.type).toBe(0);
    expect(meituan?.amountCents).toBe(1400);
    expect(meituan?.categoryName).toBe('餐饮');

    const withdraw = importable.find(
      (r) => r.note.includes('淘宝签到提现') || r.counterparty.includes('淘宝'),
    );
    expect(withdraw?.type).toBe(1);
    expect(withdraw?.amountCents).toBe(13);
    expect(withdraw?.categoryName).toBe('其他收入');
  });

  it('strips trailing tabs from Alipay order ids and prefixes ali-', () => {
    const pupu = result.rows.find((r) => r.counterparty === '朴朴超市' && !r.ignored);
    expect(pupu?.externalId).toBe('2026091623001449281404290055');
    expect(pupu?.id).toBe('ali-2026091623001449281404290055');
  });

  it('uses account 支付宝', () => {
    expect(result.rows.every((r) => r.accountName === '支付宝')).toBe(true);
  });

  it('is idempotent: parsing twice yields the same ids', () => {
    const again = parsePlatformBills(alipayCsv, 'alipay');
    expect(again.rows.map((r) => r.id)).toEqual(result.rows.map((r) => r.id));
  });
});

describe('parsePlatformBills — explicit source override', () => {
  it('honours source=wechat even when detection might differ', () => {
    const forced = parsePlatformBills(wechatCsv, 'wechat');
    expect(forced.source).toBe('wechat');
  });
});
