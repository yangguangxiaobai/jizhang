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
import { parseCsv, CsvLimitError, type ParseCsvLimits } from './csv.js';
import { TYPE_EXPENSE, TYPE_INCOME } from './types.js';

export type PlatformBillSource = 'wechat' | 'alipay';

/**
 * Optional, feature-scoped parser budgets. Omit every field to get the historical
 * unbounded behaviour: the legacy single-file import path passes no options and must
 * keep behaving exactly as before.
 *
 * `maxRows` counts raw data rows (every physical row after the located header row).
 * `deadlineMs` is a *cooperative* checkpoint (a `Date.now()` comparison every N rows),
 * not a preemptive interrupt — this module is synchronous by design.
 */
export interface ParsePlatformBillsLimits {
  readonly maxRows?: number;
  readonly maxColumns?: number;
  readonly maxCellChars?: number;
  readonly deadlineMs?: number;
  /** Aggregate raw-row cap for the merged-batch path. */
  readonly maxTotalRows?: number;
  /** Injectable clock (tests pin it); defaults to `Date.now`. */
  readonly now?: () => number;
}

/** Machine-readable budget failure, so the caller can map it to a limit error. */
export type PlatformBillsLimitKind = 'rows' | 'columns' | 'cell' | 'deadline';

export class PlatformBillsLimitError extends Error {
  readonly kind: PlatformBillsLimitKind;

  constructor(kind: PlatformBillsLimitKind, message: string) {
    super(message);
    this.name = 'PlatformBillsLimitError';
    this.kind = kind;
  }
}

export interface PlatformBillRow {
  readonly dateLabel: string;
  readonly type: number;
  readonly amountCents: number;
  readonly note: string;
  readonly sourceCategory: string;
  readonly counterparty: string;
  /**
   * Platform order id, or `null` when the cell is empty or carries the `/` placeholder.
   * A placeholder is never an identity: `/` used to be returned verbatim, which made every
   * no-order row share the literal id `wx-/`.
   */
  readonly externalId: string | null;
  readonly rawDirection: string;
  readonly rawStatus: string;
  readonly isRefund: boolean;
  readonly refundWarning: string | null;
  readonly ignored: boolean;
  readonly ignoreReason: string | null;
  /** Suggested application category name (seeded name). */
  readonly categoryName: string;
  readonly accountName: string;
  /** Stable transactions.id */
  readonly id: string;
  /**
   * Additive source metadata (1-based physical data row, i.e. the row index inside the
   * parsed table). Absent on rows built by older callers; always set by
   * `parsePlatformBills`. The merged-batch feature uses it for canonical origin.
   */
  readonly sourceRow?: number;
  /** `externalId` made explicit; `null` when the export has no order id (empty or `/`). */
  readonly fullExternalId?: string | null;
  /**
   * Normalised `交易时间` including the time of day (`YYYY-MM-DD HH:MM:SS`), or `null`
   * when the export only carries a date. Used only for strong-identity equivalence and
   * conflict detection inside the merged batch — `transactions.date` stays day-granular.
   */
  readonly sourceTimestamp?: string | null;
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
const SKIP_STATUS_KEYWORDS = ['失败', '关闭', '异常'];

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
export function locatePlatformHeaderRow(
  text: string,
  limits?: ParsePlatformBillsLimits,
): { index: number; map: Map<string, number> } | null {
  const budget = budgetFrom(limits);
  const rows = parseCsvBounded(stripBom(text), limits, undefined, 81);
  let best: { index: number; map: Map<string, number>; score: number } | null = null;
  const limit = Math.min(rows.length, 80);
  for (let i = 0; i < limit; i += 1) {
    const cells = rows[i] ?? [];
    // The header scan only enforces shape budgets: the raw-row budget starts at the data.
    checkShapeBudget(budget, cells);
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
  const cents = Math.round(Math.abs(yuan) * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

function parseDateLabel(raw: string): string | null {
  const s = raw.trim().replace(/\//g, '-');
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m === null) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Normalises the raw `交易时间` cell to `YYYY-MM-DD HH:MM:SS`, or `null` when the export
 * only carries a date (the common `交易时间` shape is `2026-09-18 12:03:41`).
 *
 * Deliberately independent of `parseDateLabel`: the day label is a local calendar label
 * and must never be recomputed from an epoch, while this value keeps the time of day so two
 * same-order-id rows at different minutes are not silently treated as the same fact.
 */
function normalizeSourceTimestamp(raw: string): string | null {
  const s = raw.trim().replace(/\//g, '-');
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (match === null) return null;
  const [, y, mo, d, hh, mm, ss] = match;
  const date = parseDateLabel(`${y}-${mo}-${d}`);
  if (date === null) return null;
  if (hh === undefined) return `${date} 00:00:00`;
  const h = Number(hh);
  const m = Number(mm);
  const sec = ss === undefined ? 0 : Number(ss);
  if (h > 23 || m > 59 || sec > 59) return date;
  return `${date} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/**
 * Cooperative budget counter shared by both parsers. Never throws on its own; the caller
 * raises `PlatformBillsLimitError` so the failure mode is explicit rather than a truncation.
 */
interface ParseBudget {
  readonly maxRows: number | null;
  readonly maxColumns: number | null;
  readonly maxCellChars: number | null;
  readonly deadlineMs: number | null;
  readonly maxTotalRows: number | null;
  readonly now: () => number;
  readonly startedAt: number;
  rows: number;
  timedOut: boolean;
}

const CHECKPOINT_ROWS = 16;

function budgetFrom(limits: ParsePlatformBillsLimits | undefined): ParseBudget {
  const now = limits?.now ?? (() => Date.now());
  return {
    maxRows: positiveIntOrNull(limits?.maxRows),
    maxColumns: positiveIntOrNull(limits?.maxColumns),
    maxCellChars: positiveIntOrNull(limits?.maxCellChars),
    deadlineMs: positiveIntOrNull(limits?.deadlineMs),
    maxTotalRows: positiveIntOrNull(limits?.maxTotalRows),
    now,
    startedAt: now(),
    rows: 0,
    timedOut: false,
  };
}

function parseLimits(
  limits: ParsePlatformBillsLimits | undefined,
  maxRows = limits?.maxRows,
  stopAfterRows?: number,
): ParseCsvLimits | undefined {
  if (limits === undefined && stopAfterRows === undefined) return undefined;
  return {
    maxRows,
    maxColumns: limits?.maxColumns,
    maxCellChars: limits?.maxCellChars,
    stopAfterRows,
  };
}

function parseCsvBounded(
  text: string,
  limits: ParsePlatformBillsLimits | undefined,
  maxRows?: number,
  stopAfterRows?: number,
): string[][] {
  try {
    return parseCsv(text, parseLimits(limits, maxRows, stopAfterRows));
  } catch (error) {
    if (!(error instanceof CsvLimitError)) throw error;
    const messages: Record<CsvLimitError['kind'], string> = {
      rows: '账单数据行超出限制。',
      columns: '账单列数超出限制。',
      cell: '账单单元格超出限制。',
    };
    throw new PlatformBillsLimitError(error.kind, messages[error.kind]);
  }
}

function positiveIntOrNull(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** Column-count and cell-length guards (shape only; no row accounting). */
function checkShapeBudget(budget: ParseBudget, cells: readonly string[]): void {
  if (budget.maxColumns !== null && cells.length > budget.maxColumns) {
    throw new PlatformBillsLimitError(
      'columns',
      `账单列数超出限制（最多 ${budget.maxColumns} 列，本行 ${cells.length} 列）。`,
    );
  }
  if (budget.maxCellChars !== null) {
    for (const cell of cells) {
      if (cell.length > budget.maxCellChars) {
        throw new PlatformBillsLimitError(
          'cell',
          `账单单元格超出限制（最多 ${budget.maxCellChars} 字符）。`,
        );
      }
    }
  }
}

/**
 * One *raw data row* boundary: shape guards, the raw-row counter and the cooperative
 * deadline checkpoint. Counted for every non-empty physical row after the header — footer
 * lines included — so the bound covers actual parsing work rather than only materialised
 * transactions.
 */
function checkRowBudget(budget: ParseBudget, cells: readonly string[]): void {
  checkShapeBudget(budget, cells);
  budget.rows += 1;
  if (budget.maxRows !== null && budget.rows > budget.maxRows) {
    throw new PlatformBillsLimitError(
      'rows',
      `账单数据行超出限制（最多 ${budget.maxRows} 行）。请拆分文件后重试。`,
    );
  }
  if (budget.deadlineMs !== null && budget.rows % CHECKPOINT_ROWS === 0) {
    if (budget.now() - budget.startedAt > budget.deadlineMs) {
      budget.timedOut = true;
      throw new PlatformBillsLimitError('deadline', '账单解析超时，请拆分文件后重试。');
    }
  }
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
  }
  if (dir !== '收入' && dir !== '支出') {
    return '中性交易';
  }

  // Failed/closed rows cannot be booked. Refund status alone does not erase an original expense.
  if (SKIP_STATUS_KEYWORDS.some((k) => status.includes(k))) {
    return '状态非成功';
  }
  // WeChat uses 对方已收钱 / 已转账 for completed outflows; Alipay uses 交易成功/支付成功.
  if (status !== '' && !SUCCESS_STATUS.test(status) && !/^(?:已)?(?:全额|部分)?退款$/.test(status)) {
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

export function parsePlatformBills(
  text: string,
  sourceHint?: PlatformBillSource | 'auto',
  limits?: ParsePlatformBillsLimits,
): ParsePlatformBillsResult {
  const budget = budgetFrom(limits);
  const stripped = stripBom(text);
  const detected = detectPlatformBillSource(stripped);
  let source: PlatformBillSource;
  if (sourceHint !== undefined && sourceHint !== 'auto') source = sourceHint;
  else if (detected === 'wechat' || detected === 'alipay') source = detected;
  else throw new Error('无法识别账单来源：请选择「微信」或「支付宝」，或确认文件为对应平台导出。');

  const located = locatePlatformHeaderRow(stripped, limits);
  if (located === null) {
    throw new Error('未找到账单表头（需要包含「交易时间」「金额」「收/支」等列）。');
  }

  const maxMaterializedRows = limits === undefined
    ? undefined
    : Math.min(
        limits.maxRows === undefined ? Number.MAX_SAFE_INTEGER : limits.maxRows + located.index,
        limits.maxTotalRows === undefined ? Number.MAX_SAFE_INTEGER : limits.maxTotalRows + located.index,
      );
  const table = parseCsvBounded(stripped, limits, maxMaterializedRows);
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
    checkRowBudget(budget, cells);
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
      // `/` is the export's "no order id" placeholder, not an id: it must never participate in
      // identity, or every no-order row would share the literal ledger id `wx-/`.
      externalId: orderId === '/' ? null : orderId,
      rawDirection: direction,
      rawStatus: status,
      isRefund: isIncome && /退款/.test(`${tradeType} ${sourceCategory}`),
      refundWarning: !isIncome && /退款/.test(status) ? '原支出保留；退款状态不代表独立退款流水，请核对实际退款记录（不自动关联或生成）。' : null,
      ignored: ignore !== null,
      ignoreReason: ignore,
      categoryName,
      accountName,
      id,
      // Additive metadata for the merged-batch feature. `i` is the physical data-row index
      // inside the parsed table, which is the canonical origin the batch stores.
      sourceRow: i,
      fullExternalId: orderId === '/' ? null : orderId,
      sourceTimestamp: normalizeSourceTimestamp(timeRaw),
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
