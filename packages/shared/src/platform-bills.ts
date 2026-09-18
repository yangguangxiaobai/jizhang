/**
 * Platform bill parsing (WeChat / Alipay exports).
 *
 * Pure string → structured rows. Encoding (GBK→UTF-8) and XLSX unzipping are the
 * server's job; this module only sees Unicode text so it can run in tests and the
 * browser without Node builtins.
 *
 * Real samples (2026-09): Alipay CSV has a long preamble then
 * `交易时间,交易分类,交易对方,...`; WeChat xlsx/csv has a preamble then
 * `交易时间,交易类型,交易对方,商品,收/支,金额(元),...`. Neutral rows use
 * `收/支 = /` (WeChat) or `不计收支` (Alipay).
 */
import { parseCsv } from './csv.js';
import { TYPE_EXPENSE, TYPE_INCOME } from './types.js';

export type PlatformBillSource = 'wechat' | 'alipay';

export interface PlatformBillRow {
  readonly dateLabel: string;
  readonly type: number;
  readonly amountCents: number;
  readonly note: string;
  readonly sourceCategory: string;
  readonly counterparty: string;
  readonly externalId: string | null;
  readonly rawDirection: string;
  readonly rawStatus: string;
  readonly ignored: boolean;
  readonly ignoreReason: string | null;
  /** Suggested application category name (seeded name). */
  readonly categoryName: string;
  readonly accountName: string;
  /** Stable transactions.id */
  readonly id: string;
}

export interface ParsePlatformBillsResult {
  readonly source: PlatformBillSource;
  readonly rows: readonly PlatformBillRow[];
  readonly total: number;
  readonly importable: number;
  readonly ignored: number;
  readonly dateFrom: string | null;
  readonly dateTo: string | null;
  readonly expenseCents: number;
  readonly incomeCents: number;
}

const EXPENSE = TYPE_EXPENSE;
const INCOME = TYPE_INCOME;

/** Header cell aliases → canonical field. */
const HEADER_ALIASES: Record<string, string> = {
  '交易时间': 'time',
  '交易分类': 'category',
  '交易类型': 'tradeType',
  '交易对方': 'counterparty',
  '对方账号': 'counterAccount',
  '商品': 'goods',
  '商品说明': 'goods',
  '收/支': 'direction',
  '金额': 'amount',
  '金额(元)': 'amount',
  '金额（元）': 'amount',
  '支付方式': 'payMethod',
  '收/付款方式': 'payMethod',
  '当前状态': 'status',
  '交易状态': 'status',
  '交易单号': 'orderId',
  '交易订单号': 'orderId',
  '商户单号': 'merchantId',
  '商家订单号': 'merchantId',
  '备注': 'remark',
};

const WECHAT_ACCOUNT = '微信';
const ALIPAY_ACCOUNT = '支付宝';

/** Category keyword map: first hit wins. Applied to note + counterparty + sourceCategory. */
const EXPENSE_KEYWORDS: ReadonlyArray<readonly [string, string]> = [
  ['餐饮', '餐饮'],
  ['吃饭', '餐饮'],
  ['饭', '餐饮'],
  ['咖啡', '餐饮'],
  ['奶茶', '餐饮'],
  ['外卖', '餐饮'],
  ['美团', '餐饮'],
  ['饿了么', '餐饮'],
  ['肯德基', '餐饮'],
  ['麦当劳', '餐饮'],
  ['火锅', '餐饮'],
  ['烧烤', '餐饮'],
  ['小吃', '餐饮'],
  ['果蔬菜', '餐饮'],
  ['水果', '餐饮'],
  ['餐饮美食', '餐饮'],

  ['地铁', '交通'],
  ['公交', '交通'],
  ['打车', '交通'],
  ['滴滴', '交通'],
  ['高铁', '交通'],
  ['火车', '交通'],
  ['机票', '交通'],
  ['加油', '交通'],
  ['停车', '交通'],
  ['出行', '交通'],

  ['房租', '住房'],
  ['水费', '住房'],
  ['电费', '住房'],
  ['燃气', '住房'],
  ['物业', '住房'],
  ['宽带', '住房'],

  ['淘宝', '购物'],
  ['天猫', '购物'],
  ['京东', '购物'],
  ['拼多多', '购物'],
  ['购物', '购物'],
  ['超市', '购物'],
  ['便利店', '购物'],
  ['日用百货', '购物'],
  ['数码', '购物'],
  ['衣服', '购物'],

  ['电影', '娱乐'],
  ['游戏', '娱乐'],
  ['会员', '娱乐'],
  ['娱乐', '娱乐'],
  ['门票', '娱乐'],
  ['旅游', '娱乐'],
];

const INCOME_KEYWORDS: ReadonlyArray<readonly [string, string]> = [
  ['工资', '工资'],
  ['薪资', '工资'],
  ['奖金', '工资'],
  ['退款', '退款'],
];

/** Platform trade categories that are never personal expense (income still allowed). */
const SKIP_SOURCE_CATEGORIES = new Set([
  '投资理财',
  '不计收支',
  '充值提现',
  '账户转存',
  '信用借还',
]);

/** Expense-side money-movement / wealth keywords. Never applied to platform-labelled 收入. */
const SKIP_EXPENSE_KEYWORDS = [
  '转入零钱通',
  '零钱通',
  '余额宝',
  '信用卡还款',
  '还款',
  '提现',
  '充值',
  '理财',
];

/** Statuses that mean the row is not a completed new movement to book. */
const SKIP_STATUS_KEYWORDS = ['失败', '关闭', '异常', '已退款', '全额退款', '退款成功'];

/** WeChat/Alipay success (and WeChat transfer receipt) statuses. */
const SUCCESS_STATUS = /成功|存入|已收钱|已转账|到账/;

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function detectPlatformBillSource(text: string): PlatformBillSource | 'jizhang' | 'unknown' {
  const t = stripBom(text);
  if (/交易单号|微信支付账单|微信昵称/.test(t) && /交易对方|商品|收\/支/.test(t)) return 'wechat';
  if (/支付宝|交易订单号|交易分类/.test(t) && /收\/支|商品说明/.test(t)) return 'alipay';
  if (/^id,date,type,amount/m.test(t) || /,isRefund/.test(t)) return 'jizhang';
  return 'unknown';
}

function normalizeHeaderCell(cell: string): string {
  return cell.replace(/\s+/g, '').replace(/\(元\)|（元）/g, '(元)');
}

function mapHeader(cells: readonly string[]): Map<string, number> {
  const map = new Map<string, number>();
  cells.forEach((raw, index) => {
    const key = HEADER_ALIASES[normalizeHeaderCell(raw)] ?? HEADER_ALIASES[raw.trim()];
    if (key !== undefined && !map.has(key)) map.set(key, index);
  });
  return map;
}

function headerScore(cells: readonly string[]): number {
  const m = mapHeader(cells);
  let score = 0;
  for (const k of ['time', 'amount', 'direction', 'orderId', 'goods', 'tradeType', 'category']) {
    if (m.has(k)) score += 1;
  }
  return score;
}

/** Finds the header row among the first 80 physical CSV rows (Alipay preamble is long). */
export function locatePlatformHeaderRow(text: string): { index: number; map: Map<string, number> } | null {
  const rows = parseCsv(stripBom(text));
  let best: { index: number; map: Map<string, number>; score: number } | null = null;
  const limit = Math.min(rows.length, 80);
  for (let i = 0; i < limit; i += 1) {
    const cells = rows[i] ?? [];
    const score = headerScore(cells);
    if (score >= 3 && (best === null || score > best.score)) {
      best = { index: i, map: mapHeader(cells), score };
    }
  }
  return best === null ? null : { index: best.index, map: best.map };
}

function parseAmountCents(raw: string): number | null {
  const cleaned = raw
    .replace(/[¥￥,，\s]/g, '')
    .replace(/^\+/, '')
    .trim();
  if (cleaned === '' || cleaned === '/' || cleaned === '-') return null;
  // Alipay/WeChat sometimes use parentheses for negatives — treat as abs amount + direction.
  const bare = cleaned.replace(/^\((.*)\)$/, '$1');
  if (!/^-?\d+(\.\d{1,2})?$/.test(bare)) return null;
  const yuan = Number(bare);
  if (!Number.isFinite(yuan)) return null;
  return Math.round(Math.abs(yuan) * 100);
}

function parseDateLabel(raw: string): string | null {
  const s = raw.trim().replace(/\//g, '-');
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m === null) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function categorizeExpense(text: string, sourceCategory: string): string {
  const hay = `${text} ${sourceCategory}`;
  for (const [kw, name] of EXPENSE_KEYWORDS) {
    if (hay.includes(kw)) return name;
  }
  return '其他';
}

function categorizeIncome(text: string): string {
  const hay = text;
  for (const [kw, name] of INCOME_KEYWORDS) {
    if (hay.includes(kw)) return name;
  }
  return '其他收入';
}

function simpleHash(input: string): string {
  // FNV-1a 32-bit ×2 → 16 hex chars. Enough for import dedup, not crypto.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

function ignoreReasonFor(input: {
  source: PlatformBillSource;
  direction: string;
  status: string;
  tradeType: string;
  goods: string;
  counterparty: string;
  sourceCategory: string;
  amountCents: number | null;
}): string | null {
  const { source, direction, status, tradeType, goods, counterparty, sourceCategory, amountCents } = input;

  if (amountCents === null || amountCents <= 0) return '金额无效';

  const dir = direction.trim();
  if (source === 'alipay') {
    if (dir === '不计收支' || dir === '') return '不计收支';
  } else if (dir !== '收入' && dir !== '支出') {
    return '中性交易';
  }

  // Refunded/failed rows are not new money movement, on either direction.
  if (SKIP_STATUS_KEYWORDS.some((k) => status.includes(k))) {
    return '状态非成功或已退款';
  }
  // WeChat uses 对方已收钱 / 已转账 for completed outflows; Alipay uses 交易成功/支付成功.
  if (status !== '' && !SUCCESS_STATUS.test(status)) {
    return `状态:${status}`;
  }

  // Platform-labelled income (WeChat 转账/群收款, Alipay 转账红包等) is bookable even when
  // the goods text mentions 提现 — the platform already classified it as 收入.
  if (dir === '收入') return null;

  if (SKIP_SOURCE_CATEGORIES.has(sourceCategory)) {
    return `分类:${sourceCategory}`;
  }

  const blob = `${tradeType} ${goods} ${counterparty}`;
  if (tradeType.includes('转入') || /零钱通|余额宝/.test(blob)) {
    return '资金划转/理财';
  }
  if (SKIP_EXPENSE_KEYWORDS.some((k) => tradeType.includes(k) || goods.includes(k))) {
    return '充值提现还款';
  }

  return null;
}

export function parsePlatformBills(text: string, sourceHint?: PlatformBillSource | 'auto'): ParsePlatformBillsResult {
  const stripped = stripBom(text);
  const detected = detectPlatformBillSource(stripped);
  let source: PlatformBillSource;
  if (sourceHint !== undefined && sourceHint !== 'auto') source = sourceHint;
  else if (detected === 'wechat' || detected === 'alipay') source = detected;
  else throw new Error('无法识别账单来源：请选择「微信」或「支付宝」，或确认文件为对应平台导出。');

  const located = locatePlatformHeaderRow(stripped);
  if (located === null) {
    throw new Error('未找到账单表头（需要包含「交易时间」「金额」「收/支」等列）。');
  }

  const table = parseCsv(stripped);
  const { map } = located;
  const get = (cells: readonly string[], field: string): string => {
    const idx = map.get(field);
    return idx === undefined ? '' : (cells[idx] ?? '').trim();
  };

  const accountName = source === 'wechat' ? WECHAT_ACCOUNT : ALIPAY_ACCOUNT;
  const rows: PlatformBillRow[] = [];
  let expenseCents = 0;
  let incomeCents = 0;
  let dateFrom: string | null = null;
  let dateTo: string | null = null;

  for (let i = located.index + 1; i < table.length; i += 1) {
    const cells = table[i] ?? [];
    if (cells.length === 0 || cells.every((c) => c.trim() === '')) continue;
    // Footer separators
    if (cells[0]?.includes('---') || cells[0]?.startsWith('共') ) continue;

    const timeRaw = get(cells, 'time');
    const dateLabel = parseDateLabel(timeRaw);
    if (dateLabel === null) continue;

    const direction = get(cells, 'direction');
    const status = get(cells, 'status');
    const tradeType = get(cells, 'tradeType');
    const goods = get(cells, 'goods');
    const counterparty = get(cells, 'counterparty');
    const sourceCategory = get(cells, 'category');
    const remark = get(cells, 'remark');
    const orderIdRaw = get(cells, 'orderId');
    const amountCents = parseAmountCents(get(cells, 'amount'));

    const ignore = ignoreReasonFor({
      source,
      direction,
      status,
      tradeType,
      goods,
      counterparty,
      sourceCategory,
      amountCents,
    });

    const isIncome = direction.trim() === '收入';
    const noteParts = [goods, counterparty !== '/' && counterparty !== '' ? counterparty : '', remark !== '/' ? remark : '']
      .filter((p) => p !== '' && p !== '/')
      .filter((p, idx, arr) => arr.indexOf(p) === idx);
    const note = noteParts.join(' · ').slice(0, 200);

    const amount = amountCents ?? 0;
    const type = isIncome ? INCOME : EXPENSE;
    const categoryName = isIncome
      ? categorizeIncome(`${note} ${sourceCategory} ${tradeType}`)
      : categorizeExpense(`${note} ${sourceCategory} ${tradeType}`, sourceCategory);

    const orderId = orderIdRaw.replace(/\s+/g, '') !== '' ? orderIdRaw.replace(/\s+/g, '') : null;
    const id =
      orderId !== null && orderId !== '/'
        ? `${source === 'wechat' ? 'wx' : 'ali'}-${orderId}`.slice(0, 64)
        : `pb-${source}-${simpleHash(`${dateLabel}|${type}|${amount}|${note}`)}`;

    rows.push({
      dateLabel,
      type,
      amountCents: amount,
      note: note || (isIncome ? '平台收入' : '平台支出'),
      sourceCategory,
      counterparty,
      externalId: orderId,
      rawDirection: direction,
      rawStatus: status,
      ignored: ignore !== null,
      ignoreReason: ignore,
      categoryName,
      accountName,
      id,
    });

    if (ignore === null && amount > 0) {
      if (isIncome) incomeCents += amount;
      else expenseCents += amount;
    }
    if (dateFrom === null || dateLabel < dateFrom) dateFrom = dateLabel;
    if (dateTo === null || dateLabel > dateTo) dateTo = dateLabel;
  }

  const importable = rows.filter((r) => !r.ignored).length;
  return {
    source,
    rows,
    total: rows.length,
    importable,
    ignored: rows.length - importable,
    dateFrom,
    dateTo,
    expenseCents,
    incomeCents,
  };
}
