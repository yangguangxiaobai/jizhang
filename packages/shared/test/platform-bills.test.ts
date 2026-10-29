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
  PlatformBillsLimitError,
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

  it('ignores neutral transfers but preserves refunded original and real refund', () => {
    const ignoredReasons = result.rows.filter((r) => r.ignored).map((r) => r.ignoreReason);
    expect(ignoredReasons).toContain('中性交易');
    expect(result.ignored).toBe(8);
    const refunded = result.rows.filter((r) => /退款/.test(r.rawStatus));
    expect(refunded).toHaveLength(2);
    expect(refunded.every((r) => !r.ignored)).toBe(true);
    expect(refunded.find((r) => r.type === 0)?.isRefund).toBe(false);
    expect(refunded.find((r) => r.type === 1)?.isRefund).toBe(true);
  });

  it('imports 群收款/转账 income and merchant/transfer expenses', () => {
    const importable = result.rows.filter((r) => !r.ignored);
    const incomes = importable.filter((r) => r.type === 1);
    const expenses = importable.filter((r) => r.type === 0);
    expect(incomes).toHaveLength(15);
    expect(expenses).toHaveLength(11);
    expect(result.importable).toBe(26);
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

describe('refund movement evidence', () => {  it('does not admit pending refund statuses merely because they mention refunds', () => {
    const header = '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注';
    for (const status of ['退款中', '退款处理中', '待退款', '退款审核中']) {
      const csv = `${header}\n2026-09-13 10:00:00,商户退款,商户,退款,收入,30,零钱,${status},pending-refund,,/`;
      expect(parsePlatformBills(csv, 'wechat').rows[0]).toMatchObject({ ignored: true, ignoreReason: `状态:${status}` });
    }
  });
  it('preserves gross purchases and actual partial refunds without manufacturing missing movements', () => {
    const result = parsePlatformBills(readFileSync(join(fixturesDir, 'refund-review.csv'), 'utf8'), 'wechat');
    expect(result.total).toBe(5);
    expect(result.expenseCents).toBe(15000);
    expect(result.incomeCents).toBe(3000);
    expect(result.rows.filter((r) => r.isRefund && !r.ignored)).toHaveLength(1);
    expect(result.rows.find((r) => r.id === 'wx-review-missing')).toMatchObject({ type: 0, amountCents: 5000, ignored: false, isRefund: false });
    expect(result.rows.find((r) => r.id === 'wx-review-missing')?.refundWarning).toBeTruthy();
    expect(result.rows.find((r) => r.id === 'wx-review-failed')?.ignored).toBe(true);
    expect(result.rows.find((r) => r.id === 'wx-review-neutral')?.ignored).toBe(true);
  });
});

describe('additive source metadata', () => {
  const result = parsePlatformBills(wechatCsv, 'wechat');

  it('records the physical data row, the full order id and the local time of day', () => {
    // The metadata is additive: the legacy fields keep their exact previous values.
    for (const row of result.rows) {
      expect(typeof row.sourceRow).toBe('number');
      expect(row.sourceRow as number).toBeGreaterThan(0);
      expect(row.fullExternalId).toBe(row.externalId);
      expect(row.sourceTimestamp === null || /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(row.sourceTimestamp as string)).toBe(true);
    }
    const first = result.rows[0]!;
    expect(first.externalId).toBe('4500000463202609184862617194');
    // The day label stays day-granular even though the timestamp keeps the clock time.
    expect(first.dateLabel).toBe(first.sourceTimestamp?.slice(0, 10));
  });

  it('keeps the time of day so two same-order rows at different minutes stay distinguishable', () => {
    const header = '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注';
    const csv = `${header}\n2026-09-13 10:00:00,商户,甲,商品,支出,30,零钱,支付成功,same-order,,/\n2026-09-13 10:05:00,商户,甲,商品,支出,30,零钱,支付成功,same-order,,/`;
    const rows = parsePlatformBills(csv, 'wechat').rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]?.sourceTimestamp).toBe('2026-09-13 10:00:00');
    expect(rows[1]?.sourceTimestamp).toBe('2026-09-13 10:05:00');
    expect(rows[0]?.dateLabel).toBe(rows[1]?.dateLabel);
  });

  it('returns null sourceTimestamp for a date-only export and null fullExternalId without an order id', () => {
    const header = '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注';
    const csv = `${header}\n2026-09-13,商户,甲,商品,支出,30,零钱,支付成功,,,/`;
    const row = parsePlatformBills(csv, 'wechat').rows[0]!;
    expect(row.sourceTimestamp).toBe('2026-09-13 00:00:00');
    expect(row.fullExternalId).toBeNull();
    expect(row.externalId).toBeNull();
  });

  it('treats `/` in the order-id cell as "no order id", never as an id', () => {
    // `/` is the export's placeholder for a movement without a platform order id. Returning it
    // verbatim made every such row share the literal ledger id `wx-/`.
    const header = '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注';
    const csv = `${header}\n2026-09-13,商户,甲,商品,支出,30,零钱,支付成功,/,/,/`;
    const row = parsePlatformBills(csv, 'wechat').rows[0]!;
    expect(row.externalId).toBeNull();
    expect(row.fullExternalId).toBeNull();
    expect(row.id.startsWith('pb-wechat-')).toBe(true);
  });
});

describe('optional parser budgets', () => {
  it('is unbounded by default: no limits means the previous behaviour', () => {
    expect(() => parsePlatformBills(wechatCsv, 'wechat')).not.toThrow();
    expect(parsePlatformBills(wechatCsv, 'wechat').rows.length).toBe(34);
  });

  it('rejects, never crops, when raw data rows exceed the budget', () => {
    expect(() => parsePlatformBills(wechatCsv, 'wechat', { maxRows: 10 })).toThrow(PlatformBillsLimitError);
    try {
      parsePlatformBills(wechatCsv, 'wechat', { maxRows: 10 });
    } catch (error) {
      expect((error as PlatformBillsLimitError).kind).toBe('rows');
    }
  });

  it('enforces column and cell budgets from the header scan onward', () => {
    const longCell = 'x'.repeat(40);
    const header = '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注';
    const csv = `${header}\n2026-09-13 10:00:00,商户,甲,${longCell},支出,30,零钱,支付成功,o-1,,/`;
    expect(() => parsePlatformBills(csv, 'wechat', { maxCellChars: 10 })).toThrow(PlatformBillsLimitError);
    try {
      parsePlatformBills(csv, 'wechat', { maxCellChars: 10 });
    } catch (error) {
      expect((error as PlatformBillsLimitError).kind).toBe('cell');
    }
    try {
      parsePlatformBills(csv, 'wechat', { maxColumns: 3 });
    } catch (error) {
      expect((error as PlatformBillsLimitError).kind).toBe('columns');
    }
  });

  it('rejects the whole document when aggregate rows exceed the batch limit before cropping', () => {
    const header = '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注';
    const document = `${header}\n${Array.from({ length: 4 }, (_, i) => `2026-09-13 10:00:0${i},商户,甲,商品,支出,30,零钱,支付成功,o-${i},,/`).join('\n')}`;
    expect(() => parsePlatformBills(document, 'wechat', { maxRows: 10, maxTotalRows: 3 })).toThrow(PlatformBillsLimitError);
  });

  it('aborts on the cooperative deadline checkpoint instead of running unbounded', () => {
    let ticks = 0;
    const now = () => {
      ticks += 1;
      return ticks * 1000;
    };
    try {
      parsePlatformBills(wechatCsv, 'wechat', { deadlineMs: 1, now });
      throw new Error('expected a deadline failure');
    } catch (error) {
      expect(error).toBeInstanceOf(PlatformBillsLimitError);
      expect((error as PlatformBillsLimitError).kind).toBe('deadline');
    }
  });

  it('accepts the fixture inside a generous budget without changing its rows', () => {
    const limited = parsePlatformBills(wechatCsv, 'wechat', {
      maxRows: 3000,
      maxColumns: 64,
      maxCellChars: 1000,
      deadlineMs: 3000,
    });
    const plain = parsePlatformBills(wechatCsv, 'wechat');
    expect(limited.rows.map((row) => row.id)).toEqual(plain.rows.map((row) => row.id));
    expect(limited.rows.map((row) => row.sourceRow)).toEqual(plain.rows.map((row) => row.sourceRow));
  });

  it('applies the same shape budgets to the header locator', () => {
    expect(() => locatePlatformHeaderRow(wechatCsv, { maxColumns: 3 })).toThrow(PlatformBillsLimitError);
    expect(locatePlatformHeaderRow(wechatCsv, { maxColumns: 64 })?.index).toBe(17);
  });
});
