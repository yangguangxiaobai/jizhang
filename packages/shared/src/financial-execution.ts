/**
 * Phase 1 财务执行规则：工资周期、用途映射、退款分摊与净执行（纯函数，无 IO）。
 *
 * ## 边界
 *
 * 这里只放**规则**：不读时钟、不读数据库、不发网络请求，也不写任何账本。
 * 服务端负责读取 SQLite 事实、校验引用、CAS/operationId 持久化；Android 只渲染。
 * 所有金额都是整数分，BigInt 作为中间量，输出前逐个断言仍在安全整数范围内。
 *
 * ## 与旧口径的区别（不要“顺手统一”）
 *
 * - `financial-plan.ts` 的 25/15/50/10 是**手工测算场景**，本模块是实际执行。
 * - 旧账本/信封仍是**毛额**；本模块输出显式的 `financial-net-v1` 净执行视图，
 *   不修改 `expenseContribution`、全局退款收入或旧工资分配。
 * - 退款按**原支出**的用途/周期归属，退款收入本身不是新的可分配工资。
 * - 自然月窗口不是 30 天，也不是服务端本地时区；周期边界使用显式 IANA 时区的
 *   日历运算，已确认窗口由服务端冻结后原样保留。
 *
 * 本文件不提供任何“实际划拨”能力：growth/reserve 永远返回 `not-connected`。
 */

/** 执行规则契约版本。所有新响应都带该版本。 */
export const FINANCIAL_EXECUTION_CONTRACT_VERSION = 1 as const;

/** 各项规则版本，服务端按此冻结/回放。 */
export const FINANCIAL_EXECUTION_RULES = Object.freeze({
  allocation: 'financial-allocation-bps-v1',
  cycle: 'financial-cycle-frozen-month-v1',
  purpose: 'financial-purpose-snapshot-v1',
  refund: 'financial-refund-splits-v1',
  execution: 'financial-net-v1',
} as const);

/** 四个用途的固定顺序；最大余数法并列时也按此顺序决胜。 */
const PURPOSE_ORDER = ['growth', 'reserve', 'essentials', 'joy'] as const;

/** 一个用途分到的钱（或一组比例）。 */
export interface PurposeAmounts {
  readonly growth: number;
  readonly reserve: number;
  readonly essentials: number;
  readonly joy: number;
}

/** 四个用途的比例，单位为基点（10000 = 100%）。 */
export type FinancialRatiosBps = PurposeAmounts;

/** 默认比例：25% / 15% / 50% / 10%。 */
export const DEFAULT_FINANCIAL_RATIOS_BPS: FinancialRatiosBps = Object.freeze({
  growth: 2500,
  reserve: 1500,
  essentials: 5000,
  joy: 1000,
});

/** 实际消费只允许落入这两个用途；growth/reserve 是资金划拨，不是消费。 */
export type SpendingPurpose = 'essentials' | 'joy';

/** 财务周期配置。自然月或每月 1..28 日起算。 */
export type FinancialCycle =
  | { readonly kind: 'natural-month' }
  | { readonly kind: 'start-day'; readonly day: number };

/** 纯规则错误码；HTTP 状态由服务端按上下文映射（这里不带 HTTP 语义）。 */
export type FinancialExecutionErrorCode =
  | 'INVALID_CONFIG'
  | 'INVALID_MONEY'
  | 'INVALID_RATIOS'
  | 'INVALID_CYCLE'
  | 'INVALID_TIME_ZONE'
  | 'INVALID_GROUP_MONTH'
  | 'WINDOW_CONFLICT'
  | 'INVALID_WINDOW'
  | 'INVALID_MAPPING'
  | 'INVALID_PURPOSE'
  | 'INVALID_REFUND_SPLITS'
  | 'INVALID_EXECUTION'
  | 'OVERFLOW';

/**
 * 输入不合法或派生金额超出安全整数范围。
 *
 * `code` 只表达纯规则的失败类别：
 * - `INVALID_*` → 服务端 400 FINANCIAL_INVALID；
 * - `WINDOW_CONFLICT` → 409 FINANCIAL_WINDOW_CONFLICT；
 * - 若服务端正在读取已持久化事实，可自行映射为 503 FINANCIAL_UNAVAILABLE。
 *
 * 消息只包含字段名，不回显用户的私有金额。
 */
export class FinancialExecutionInputError extends Error {
  readonly code: FinancialExecutionErrorCode;

  constructor(code: FinancialExecutionErrorCode, message: string) {
    super(message);
    this.name = 'FinancialExecutionInputError';
    this.code = code;
  }
}

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_BIGINT = -MAX_SAFE_BIGINT;
const RATIO_DENOMINATOR = 10_000n;
const MAX_REFUND_SPLITS = 100;
const HOUR_MS = 3_600_000;
/** ECMAScript Date 可表示的最大毫秒数（TimeClip 边界）。 */
const MAX_DATE_MS = 8_640_000_000_000_000;
/**
 * 支持 2000..9999 的工资周期。更早的 IANA 历史时区包含日期线回拨等
 * 非单调边界，本模块不承诺；现代 DST 的午夜跳过/重复仍按最早有效瞬间处理。
 */
const MIN_SUPPORTED_WINDOW_YEAR = 2000;

function fail(code: FinancialExecutionErrorCode, message: string): never {
  throw new FinancialExecutionInputError(code, message);
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('INVALID_MONEY', message);
  }
  return value as Record<string, unknown>;
}

function requireSafeInteger(value: unknown, field: string, minimum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    fail('INVALID_MONEY', `${field} must be a safe integer number of cents.`);
  }
  if (value < minimum) {
    fail('INVALID_MONEY', `${field} must be at least ${minimum}.`);
  }
  return value;
}

function requireNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    fail('INVALID_MONEY', `${field} must be a non-negative safe integer.`);
  }
  return value;
}

/** 校验时间戳既能安全表示，也落在 ECMAScript Date 的 TimeClip 范围内。 */
function requireDateMs(value: unknown, field: string): number {
  const epochMs = requireSafeInteger(value, field, 0);
  if (epochMs > MAX_DATE_MS) {
    fail('INVALID_WINDOW', `${field} must be within the ECMAScript Date range.`);
  }
  return epochMs;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail('INVALID_EXECUTION', `${field} must be a non-empty string.`);
  }
  return value;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    fail('INVALID_CONFIG', `${field} must be a boolean.`);
  }
  return value;
}

function requireSafeBigInt(value: bigint, what: string, allowNegative = false): number {
  if (!allowNegative && value < 0n) {
    fail('OVERFLOW', `The resulting ${what} must not be negative.`);
  }
  if (value > MAX_SAFE_BIGINT || value < MIN_SAFE_BIGINT) {
    fail('OVERFLOW', `The resulting ${what} exceeds the safe integer range.`);
  }
  return Number(value);
}

// ---------------------------------------------------------------------------
// 比例 / 配置
// ---------------------------------------------------------------------------

function parsePurposeAmounts(raw: unknown, field: string): PurposeAmounts {
  const record = requireRecord(raw, `${field} must be an object with four purpose amounts.`);
  const values = {} as Record<(typeof PURPOSE_ORDER)[number], number>;
  for (const purpose of PURPOSE_ORDER) {
    values[purpose] = requireSafeInteger(record[purpose], `${field}.${purpose}`, 0);
  }
  return {
    growth: values.growth,
    reserve: values.reserve,
    essentials: values.essentials,
    joy: values.joy,
  };
}

/**
 * 严格校验并归一化四个用途的基点比例：非负安全整数，且总和恰好 10000。
 *
 * 公开此函数供服务端在写库前复用，避免把同一套比例规则复制到路由层。
 */
export function validateFinancialRatiosBps(raw: unknown): FinancialRatiosBps {
  const ratios = parsePurposeAmounts(raw, 'ratiosBps');
  const total = BigInt(ratios.growth) + BigInt(ratios.reserve) + BigInt(ratios.essentials) + BigInt(ratios.joy);
  if (total !== RATIO_DENOMINATOR) {
    fail('INVALID_RATIOS', 'ratiosBps must sum to exactly 10000 basis points.');
  }
  return ratios;
}

function parseFinancialCycle(raw: unknown): FinancialCycle {
  const record = requireRecord(raw, 'cycle must be either natural-month or start-day.');
  const kind = record['kind'];
  if (kind === 'natural-month') {
    return { kind: 'natural-month' };
  }
  if (kind === 'start-day') {
    const day = requireNonNegativeInteger(record['day'], 'cycle.day');
    if (day < 1 || day > 28) {
      fail('INVALID_CYCLE', 'cycle.day must be an integer between 1 and 28.');
    }
    return { kind: 'start-day', day };
  }
  fail('INVALID_CYCLE', 'cycle.kind must be natural-month or start-day.');
}

export interface FinancialExecutionConfigInput {
  readonly enabled: boolean;
  readonly ratiosBps: FinancialRatiosBps;
  readonly essentialMonthlyCents: number | null;
  readonly targetMonths: number;
  readonly cycle: FinancialCycle;
  readonly timeZone: string;
}

/**
 * 校验财务执行配置（PUT /config 的业务字段，不含 `operationId`/`expectedRevision`）。
 *
 * - 比例必须四项非负且合计 10000 基点；
 * - `essentialMonthlyCents` 为 null 或正安全整数，且乘以 `targetMonths` 不溢出；
 * - `targetMonths` 为 1..120；
 * - `cycle` 与显式 IANA 时区必须合法。
 *
 * 多余的键被忽略（与旧 `validateFinancialPlanInputs` 的兼容风格一致）。
 */
export function validateFinancialExecutionConfig(raw: unknown): FinancialExecutionConfigInput {
  const record = requireRecord(raw, 'Financial execution config must be an object.');
  const enabled = requireBoolean(record['enabled'], 'enabled');
  const ratiosBps = validateFinancialRatiosBps(record['ratiosBps']);
  const targetMonths = requireNonNegativeInteger(record['targetMonths'], 'targetMonths');
  if (targetMonths < 1 || targetMonths > 120) {
    fail('INVALID_CONFIG', 'targetMonths must be an integer between 1 and 120.');
  }

  const essentialRaw = record['essentialMonthlyCents'];
  let essentialMonthlyCents: number | null;
  if (essentialRaw === null) {
    essentialMonthlyCents = null;
  } else {
    essentialMonthlyCents = requireSafeInteger(essentialRaw, 'essentialMonthlyCents', 1);
    if (BigInt(essentialMonthlyCents) * BigInt(targetMonths) > MAX_SAFE_BIGINT) {
      fail('OVERFLOW', 'essentialMonthlyCents multiplied by targetMonths exceeds the safe integer range.');
    }
  }

  return {
    enabled,
    ratiosBps,
    essentialMonthlyCents,
    targetMonths,
    cycle: parseFinancialCycle(record['cycle']),
    timeZone: requireTimeZone(record['timeZone']),
  };
}

// ---------------------------------------------------------------------------
// 精确分配
// ---------------------------------------------------------------------------

/**
 * 按整数基点比例把收入分到四个用途：最大余数法、非负、精确守恒。
 *
 * 分母是 10000；余数并列时按 growth、reserve、essentials、joy 的固定顺序决胜。
 * `incomeCents === 0` 时四项均为 0；负数、小数、非安全整数一律拒绝。
 */
export function allocateFinancialExecutionCents(
  incomeCents: number,
  ratiosBps: FinancialRatiosBps,
): PurposeAmounts {
  const income = BigInt(requireSafeInteger(incomeCents, 'incomeCents', 0));
  const ratios = validateFinancialRatiosBps(ratiosBps);

  const parts = PURPOSE_ORDER.map((purpose, index) => {
    const exact = income * BigInt(ratios[purpose]);
    return {
      purpose,
      index,
      base: exact / RATIO_DENOMINATOR,
      remainder: exact % RATIO_DENOMINATOR,
    };
  });

  let assigned = 0n;
  for (const part of parts) assigned += part.base;
  let leftover = income - assigned;
  if (leftover < 0n || leftover > BigInt(parts.length)) {
    fail('INVALID_RATIOS', 'ratiosBps produced an invalid largest-remainder allocation.');
  }

  const ranked = [...parts].sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    return a.index - b.index;
  });
  const bonus = new Map<string, number>();
  for (const part of ranked) {
    if (leftover === 0n) break;
    bonus.set(part.purpose, 1);
    leftover -= 1n;
  }
  if (leftover !== 0n) {
    fail('INVALID_RATIOS', 'ratiosBps produced an invalid largest-remainder allocation.');
  }

  const amounts = {} as Record<(typeof PURPOSE_ORDER)[number], number>;
  for (const part of parts) {
    amounts[part.purpose] = Number(part.base + BigInt(bonus.get(part.purpose) ?? 0));
  }
  return {
    growth: amounts.growth,
    reserve: amounts.reserve,
    essentials: amounts.essentials,
    joy: amounts.joy,
  };
}

// ---------------------------------------------------------------------------
// 显式时区日历运算（不依赖进程本地时区）
// ---------------------------------------------------------------------------

interface CivilDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

interface ZonedParts extends CivilDate {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const timeZoneFormatters = new Map<string, Intl.DateTimeFormat>();

function getTimeZoneFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = timeZoneFormatters.get(timeZone);
  if (cached !== undefined) return cached;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    fail('INVALID_TIME_ZONE', 'timeZone must be a valid explicit IANA time zone.');
  }
  timeZoneFormatters.set(timeZone, formatter);
  return formatter;
}

function requireTimeZone(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail('INVALID_TIME_ZONE', 'timeZone must be a valid explicit IANA time zone.');
  }
  // Intl 在部分运行时会接受 "+08:00" 之类的固定偏移；本契约要求显式 IANA 名称。
  if (value.startsWith('+') || value.startsWith('-')) {
    fail('INVALID_TIME_ZONE', 'timeZone must be a valid explicit IANA time zone.');
  }
  getTimeZoneFormatter(value);
  return value;
}

function civilToUtcMs(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getTime();
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

function requireValidCivilDate(year: number, month: number, day: number): void {
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    fail('INVALID_WINDOW', 'The requested calendar date does not exist.');
  }
}

function zonedPartsAt(epochMs: number, timeZone: string): ZonedParts {
  const formatter = getTimeZoneFormatter(timeZone);
  const date = new Date(epochMs);
  if (Number.isNaN(date.getTime())) {
    fail('INVALID_WINDOW', 'The requested timestamp is outside the ECMAScript Date range.');
  }
  const values: Record<string, number> = {};
  for (const part of formatter.formatToParts(date)) {
    if (
      part.type === 'year' ||
      part.type === 'month' ||
      part.type === 'day' ||
      part.type === 'hour' ||
      part.type === 'minute' ||
      part.type === 'second'
    ) {
      const parsed = Number(part.value);
      if (!Number.isInteger(parsed)) {
        fail('INVALID_TIME_ZONE', 'timeZone produced non-integer calendar parts.');
      }
      values[part.type] = parsed;
    }
  }
  const year = values['year'];
  const month = values['month'];
  const day = values['day'];
  const hour = values['hour'];
  const minute = values['minute'];
  const second = values['second'];
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  ) {
    fail('INVALID_TIME_ZONE', 'timeZone could not be resolved into calendar parts.');
  }
  return { year, month, day, hour: hour === 24 ? 0 : hour, minute, second };
}

/** 本地日期在显式时区中的“日序号”，用于比较/二分（与 UTC 零点对齐）。 */
function localDateOrdinal(epochMs: number, timeZone: string): number {
  const parts = zonedPartsAt(epochMs, timeZone);
  return civilToUtcMs(parts.year, parts.month, parts.day);
}

function localDateOf(epochMs: number, timeZone: string): CivilDate {
  const parts = zonedPartsAt(epochMs, timeZone);
  return { year: parts.year, month: parts.month, day: parts.day };
}

/**
 * 显式 IANA 时区中某个本地日历日的**最早有效瞬间**。
 *
 * DST 春季跳变可能让本地 00:00 不存在（例如 00:00 直接跳到 01:00），此时返回
 * 该日第一个存在的瞬间；秋季回拨让 00:00 出现两次时返回第一次。绝不使用
 * 30 天或“加 24 小时”之类的近似。
 */
function zonedDayStart(year: number, month: number, day: number, timeZone: string): number {
  requireValidCivilDate(year, month, day);
  const target = civilToUtcMs(year, month, day);
  const searchStart = target - 36 * HOUR_MS;
  const searchEnd = target + 36 * HOUR_MS;

  let seen: number | null = null;
  for (let at = searchStart; at <= searchEnd; at += HOUR_MS) {
    if (localDateOrdinal(at, timeZone) === target) {
      seen = at;
      break;
    }
  }
  if (seen === null) {
    fail('INVALID_WINDOW', 'The requested calendar date does not exist in the selected time zone.');
  }

  // 先向前退到前一个本地日，再二分找“本地日 >= 目标日”的第一个瞬间。
  let low = seen;
  while (low > searchStart && localDateOrdinal(low, timeZone) >= target) {
    low -= HOUR_MS;
  }
  let high = seen;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (localDateOrdinal(mid, timeZone) >= target) high = mid;
    else low = mid;
  }
  if (localDateOrdinal(high, timeZone) !== target) {
    fail('INVALID_WINDOW', 'The requested calendar date does not exist in the selected time zone.');
  }
  return high;
}

interface YearMonth {
  readonly year: number;
  readonly month: number;
}

const GROUP_MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

function parseGroupMonth(value: unknown): YearMonth {
  if (typeof value !== 'string') {
    fail('INVALID_GROUP_MONTH', 'groupMonth must be formatted as YYYY-MM.');
  }
  const match = GROUP_MONTH_PATTERN.exec(value);
  if (match === null) {
    fail('INVALID_GROUP_MONTH', 'groupMonth must be formatted as YYYY-MM.');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    year < MIN_SUPPORTED_WINDOW_YEAR ||
    year > 9999 ||
    month < 1 ||
    month > 12
  ) {
    fail('INVALID_GROUP_MONTH', 'groupMonth must be a valid calendar month between 2000-01 and 9999-12.');
  }
  return { year, month };
}

function addMonths(year: number, month: number, delta: number): YearMonth {
  const total = year * 12 + (month - 1) + delta;
  const nextYear = Math.floor(total / 12);
  const nextMonth = (total - nextYear * 12) + 1;
  if (nextYear < 1 || nextYear > 9999) {
    fail('INVALID_WINDOW', 'The window end leaves the supported calendar range.');
  }
  return { year: nextYear, month: nextMonth };
}

function formatGroupMonth(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

function sameCycle(a: FinancialCycle, b: FinancialCycle): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'natural-month') return true;
  return b.kind === 'start-day' && a.day === b.day;
}

// ---------------------------------------------------------------------------
// 周期窗口
// ---------------------------------------------------------------------------

export interface FinancialWindow {
  readonly cycleKey: string;
  readonly groupMonth: string;
  readonly start: number;
  readonly end: number;
  readonly timeZone: string;
  readonly cycle: FinancialCycle;
  readonly anchorSalaryId: string;
  readonly groupingRule: 'financial-cycle-frozen-month-v1';
  readonly legacyWindow: { readonly start: number; readonly end: number | null } | null;
  readonly warnings: readonly string[];
}

export interface FinancialSalaryDateFact {
  readonly salaryId: string;
  readonly date: number;
}

export interface FinancialCycleWindowInput {
  readonly cycle: FinancialCycle;
  readonly timeZone: string;
  /** 工资归属的自然月（`YYYY-MM`），不是展示用的周期标签。 */
  readonly groupMonth: string;
  /**
   * 该分组内的**全部**有效工资分配（不是仅前 200 个选中来源）。
   * anchor 必须取全量最早一天；200 的限制只属于一次确认的 selectedSources。
   */
  readonly salaries: readonly FinancialSalaryDateFact[];
  /** 服务端已匹配到的已确认窗口；存在时原样冻结返回。 */
  readonly existingWindow?: FinancialWindow | null;
  /** 旧预算窗口，仅用于差异提示，不参与新窗口计算。 */
  readonly legacyWindow?: { readonly start: number; readonly end: number | null } | null;
}

const WARNING_ORDER = [
  'LEGACY_WINDOW_DIFFERS',
  'SALARY_BEFORE_WINDOW',
  'GROUP_START_FROZEN',
  'CYCLE_SETTINGS_DIFFER',
] as const;

function normalizeWarnings(values: readonly string[]): string[] {
  const unique = new Set(values);
  const known = WARNING_ORDER.filter((warning) => unique.has(warning));
  const extras = [...unique].filter((warning) => !(WARNING_ORDER as readonly string[]).includes(warning)).sort();
  return [...known, ...extras];
}

function normalizeLegacyWindow(
  raw: unknown,
): { readonly start: number; readonly end: number | null } | null {
  if (raw === null || raw === undefined) return null;
  const record = requireRecord(raw, 'legacyWindow must contain start and end.');
  const start = requireSafeInteger(record['start'], 'legacyWindow.start', 0);
  const endRaw = record['end'];
  let end: number | null;
  if (endRaw === null) {
    end = null;
  } else {
    end = requireSafeInteger(endRaw, 'legacyWindow.end', 0);
    if (end <= start) {
      fail('INVALID_WINDOW', 'legacyWindow.end must be greater than legacyWindow.start.');
    }
  }
  return { start, end };
}

function parseFinancialWindow(raw: unknown): FinancialWindow {
  const record = requireRecord(raw, 'FinancialWindow must be an object.');
  const parsedGroupMonth = parseGroupMonth(record['groupMonth']);
  const groupMonth = formatGroupMonth(parsedGroupMonth.year, parsedGroupMonth.month);
  const start = requireSafeInteger(record['start'], 'window.start', 0);
  const end = requireSafeInteger(record['end'], 'window.end', 0);
  if (end <= start) {
    fail('INVALID_WINDOW', 'window.end must be greater than window.start.');
  }
  const cycleKey = requireNonEmptyString(record['cycleKey'], 'window.cycleKey');
  const anchorSalaryId = requireNonEmptyString(record['anchorSalaryId'], 'window.anchorSalaryId');
  const groupingRule = record['groupingRule'];
  if (groupingRule !== 'financial-cycle-frozen-month-v1') {
    fail('INVALID_WINDOW', 'window.groupingRule is not supported.');
  }
  const warningsRaw = record['warnings'];
  if (!Array.isArray(warningsRaw) || warningsRaw.some((warning) => typeof warning !== 'string')) {
    fail('INVALID_WINDOW', 'window.warnings must be an array of strings.');
  }
  return {
    cycleKey,
    groupMonth,
    start,
    end,
    timeZone: requireTimeZone(record['timeZone']),
    cycle: parseFinancialCycle(record['cycle']),
    anchorSalaryId,
    groupingRule: 'financial-cycle-frozen-month-v1',
    legacyWindow: normalizeLegacyWindow(record['legacyWindow']),
    warnings: normalizeWarnings(warningsRaw),
  };
}

interface SalaryFact {
  readonly salaryId: string;
  readonly date: number;
  readonly dateStart: number;
}

function parseSalaryFacts(
  raw: unknown,
  groupMonth: YearMonth,
  timeZone: string,
): SalaryFact[] {
  if (!Array.isArray(raw)) {
    fail('INVALID_WINDOW', 'salaries must be an array of salary date facts.');
  }
  const seen = new Set<string>();
  const facts: SalaryFact[] = [];
  for (const item of raw) {
    const record = requireRecord(item, 'Each salary fact must contain salaryId and date.');
    const salaryId = requireNonEmptyString(record['salaryId'], 'salaryId');
    if (seen.has(salaryId)) {
      fail('INVALID_WINDOW', 'salaryId must be unique within a window grouping.');
    }
    seen.add(salaryId);
    const date = requireDateMs(record['date'], 'salary.date');
    const local = localDateOf(date, timeZone);
    if (local.year !== groupMonth.year || local.month !== groupMonth.month) {
      fail('INVALID_WINDOW', 'Every salary must fall in the requested salary calendar month.');
    }
    facts.push({
      salaryId,
      date,
      dateStart: zonedDayStart(local.year, local.month, local.day, timeZone),
    });
  }
  return facts;
}

function earliestAnchor(facts: readonly SalaryFact[]): SalaryFact {
  const first = facts[0];
  if (first === undefined) {
    fail('INVALID_WINDOW', 'A new financial window requires at least one salary.');
  }
  let anchor = first;
  for (const fact of facts) {
    if (
      fact.dateStart < anchor.dateStart ||
      (fact.dateStart === anchor.dateStart && fact.salaryId < anchor.salaryId)
    ) {
      anchor = fact;
    }
  }
  return anchor;
}

/**
 * 计算/冻结一个工资周期窗口。
 *
 * - `natural-month`：起点 = 该分组内最早工资的本地日历日；终点 = 次月 1 日 00:00；
 * - `start-day`：工资归属**同一个工资自然月**，起点 = 该月配置日 1..28，终点 = 次月同日；
 * - 已有 `existingWindow` 由服务端按冻结的时区/周期匹配后传入，本函数原样保留边界并追加
 *   `GROUP_START_FROZEN` / `CYCLE_SETTINGS_DIFFER` 等提示；
 * - 绝不做 30 天近似；无效时区、无效月份、跨组工资、非法日历日期全部拒绝。
 */
export function resolveFinancialCycleWindow(input: FinancialCycleWindowInput): FinancialWindow {
  const record = requireRecord(input, 'FinancialCycleWindowInput must be an object.');
  const cycle = parseFinancialCycle(record['cycle']);
  const timeZone = requireTimeZone(record['timeZone']);
  const groupMonthDate = parseGroupMonth(record['groupMonth']);
  const groupMonth = formatGroupMonth(groupMonthDate.year, groupMonthDate.month);
  const salaries = parseSalaryFacts(record['salaries'], groupMonthDate, timeZone);
  const existingRaw = record['existingWindow'];
  const existing = existingRaw === null || existingRaw === undefined ? null : parseFinancialWindow(existingRaw);
  const legacyWindow = normalizeLegacyWindow(record['legacyWindow']);

  if (existing !== null) {
    if (existing.groupMonth !== groupMonth) {
      fail('WINDOW_CONFLICT', 'The existing window belongs to a different salary group month.');
    }
    const warnings = [...existing.warnings];
    warnings.push('GROUP_START_FROZEN');
    if (!sameCycle(existing.cycle, cycle) || existing.timeZone !== timeZone) {
      warnings.push('CYCLE_SETTINGS_DIFFER');
    }
    if (salaries.some((salary) => salary.dateStart < existing.start)) {
      warnings.push('SALARY_BEFORE_WINDOW');
    }
    return {
      ...existing,
      warnings: normalizeWarnings(warnings),
    };
  }

  const anchor = earliestAnchor(salaries);
  let start: number;
  let end: number;
  if (cycle.kind === 'natural-month') {
    const anchorDate = localDateOf(anchor.date, timeZone);
    start = zonedDayStart(anchorDate.year, anchorDate.month, anchorDate.day, timeZone);
    const next = addMonths(groupMonthDate.year, groupMonthDate.month, 1);
    end = zonedDayStart(next.year, next.month, 1, timeZone);
  } else {
    start = zonedDayStart(groupMonthDate.year, groupMonthDate.month, cycle.day, timeZone);
    const next = addMonths(groupMonthDate.year, groupMonthDate.month, 1);
    end = zonedDayStart(next.year, next.month, cycle.day, timeZone);
  }

  const warnings: string[] = [];
  if (legacyWindow !== null && (legacyWindow.start !== start || legacyWindow.end !== end)) {
    warnings.push('LEGACY_WINDOW_DIFFERS');
  }
  if (salaries.some((salary) => salary.dateStart < start)) {
    warnings.push('SALARY_BEFORE_WINDOW');
  }

  return {
    cycleKey:
      cycle.kind === 'natural-month'
        ? `natural-month:${groupMonth}`
        : `start-day-${cycle.day}:${groupMonth}`,
    groupMonth,
    start,
    end,
    timeZone,
    cycle,
    anchorSalaryId: anchor.salaryId,
    groupingRule: 'financial-cycle-frozen-month-v1',
    legacyWindow,
    warnings: normalizeWarnings(warnings),
  };
}

// ---------------------------------------------------------------------------
// 用途映射
// ---------------------------------------------------------------------------

export interface FinancialCategoryRule {
  readonly categoryId: string;
  /** `null` 是显式的“到此停止，不再继承”，不是“未配置”。 */
  readonly purpose: SpendingPurpose | null;
}

export interface FinancialCategoryNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly deleted: boolean;
}

export interface FinancialMappingSnapshot {
  readonly revision: number;
  readonly rules: readonly FinancialCategoryRule[];
  readonly categories: readonly FinancialCategoryNode[];
  readonly topologyToken: string;
  readonly updatedAt: number | null;
}

export interface FinancialPurposeResolutionInput {
  /** 账单级显式覆盖；null 表示没有覆盖。 */
  readonly override: SpendingPurpose | null;
  readonly categoryId: string | null;
  /** null 表示没有所属周期，此时一律 unresolved / mappingRevision 0。 */
  readonly mapping: FinancialMappingSnapshot | null;
}

export interface PurposeResolution {
  readonly purpose: SpendingPurpose | null;
  readonly provenance: 'bill-override' | 'category-rule' | 'ancestor-rule' | 'unresolved';
  readonly ruleCategoryId: string | null;
  readonly mappingRevision: number;
  readonly reason:
    | 'not-mapped'
    | 'explicit-unresolved'
    | 'category-not-in-snapshot'
    | 'invalid-topology'
    | null;
}

function parseSpendingPurpose(value: unknown, field: string): SpendingPurpose {
  if (value === 'essentials' || value === 'joy') return value;
  fail('INVALID_PURPOSE', `${field} must be essentials or joy.`);
}

function parseMappingSnapshot(raw: unknown): FinancialMappingSnapshot {
  const record = requireRecord(raw, 'mapping must be an object.');
  const revision = requireNonNegativeInteger(record['revision'], 'mapping.revision');
  const topologyToken = requireNonEmptyString(record['topologyToken'], 'mapping.topologyToken');
  const updatedAtRaw = record['updatedAt'];
  let updatedAt: number | null;
  if (updatedAtRaw === null) {
    updatedAt = null;
  } else {
    updatedAt = requireNonNegativeInteger(updatedAtRaw, 'mapping.updatedAt');
  }

  const rulesRaw = record['rules'];
  if (!Array.isArray(rulesRaw)) {
    fail('INVALID_MAPPING', 'mapping.rules must be an array.');
  }
  const ruleIds = new Set<string>();
  const rules: FinancialCategoryRule[] = [];
  for (const item of rulesRaw) {
    const rule = requireRecord(item, 'Each mapping rule must contain categoryId and purpose.');
    const categoryId = requireNonEmptyString(rule['categoryId'], 'rule.categoryId');
    if (ruleIds.has(categoryId)) {
      fail('INVALID_MAPPING', 'mapping.rules must not contain duplicate categoryId values.');
    }
    ruleIds.add(categoryId);
    const purposeRaw = rule['purpose'];
    const purpose = purposeRaw === null ? null : parseSpendingPurpose(purposeRaw, 'rule.purpose');
    rules.push({ categoryId, purpose });
  }

  const categoriesRaw = record['categories'];
  if (!Array.isArray(categoriesRaw)) {
    fail('INVALID_MAPPING', 'mapping.categories must be an array.');
  }
  const categoryIds = new Set<string>();
  const categories: FinancialCategoryNode[] = [];
  for (const item of categoriesRaw) {
    const category = requireRecord(item, 'Each mapping category must contain id, parentId and deleted.');
    const id = requireNonEmptyString(category['id'], 'category.id');
    if (categoryIds.has(id)) {
      fail('INVALID_MAPPING', 'mapping.categories must not contain duplicate id values.');
    }
    categoryIds.add(id);
    const parentRaw = category['parentId'];
    const parentId = parentRaw === null ? null : requireNonEmptyString(parentRaw, 'category.parentId');
    if (typeof category['deleted'] !== 'boolean') {
      fail('INVALID_MAPPING', 'category.deleted must be a boolean.');
    }
    categories.push({ id, parentId, deleted: category['deleted'] });
  }

  return { revision, rules, categories, topologyToken, updatedAt };
}

function resolvePurposeWithMapping(
  mapping: FinancialMappingSnapshot | null,
  categoryId: string | null,
  override: SpendingPurpose | null,
): PurposeResolution {
  if (mapping === null) {
    return {
      purpose: null,
      provenance: 'unresolved',
      ruleCategoryId: null,
      mappingRevision: 0,
      reason: 'not-mapped',
    };
  }
  const mappingRevision = mapping.revision;
  if (override !== null) {
    return {
      purpose: override,
      provenance: 'bill-override',
      ruleCategoryId: null,
      mappingRevision,
      reason: null,
    };
  }
  if (categoryId === null) {
    return {
      purpose: null,
      provenance: 'unresolved',
      ruleCategoryId: null,
      mappingRevision,
      reason: 'not-mapped',
    };
  }

  const categories = new Map(mapping.categories.map((category) => [category.id, category]));
  const rules = new Map(mapping.rules.map((rule) => [rule.categoryId, rule]));
  const category = categories.get(categoryId);
  if (category === undefined) {
    return {
      purpose: null,
      provenance: 'unresolved',
      ruleCategoryId: null,
      mappingRevision,
      reason: 'category-not-in-snapshot',
    };
  }

  const direct = rules.get(categoryId);
  if (direct !== undefined) {
    if (direct.purpose === null) {
      return {
        purpose: null,
        provenance: 'unresolved',
        ruleCategoryId: categoryId,
        mappingRevision,
        reason: 'explicit-unresolved',
      };
    }
    return {
      purpose: direct.purpose,
      provenance: 'category-rule',
      ruleCategoryId: categoryId,
      mappingRevision,
      reason: null,
    };
  }

  const visited = new Set<string>([categoryId]);
  let parentId = category.parentId;
  while (parentId !== null) {
    if (visited.has(parentId)) {
      return {
        purpose: null,
        provenance: 'unresolved',
        ruleCategoryId: null,
        mappingRevision,
        reason: 'invalid-topology',
      };
    }
    visited.add(parentId);
    const parent = categories.get(parentId);
    if (parent === undefined) {
      return {
        purpose: null,
        provenance: 'unresolved',
        ruleCategoryId: null,
        mappingRevision,
        reason: 'invalid-topology',
      };
    }
    const inherited = rules.get(parentId);
    if (inherited !== undefined) {
      if (inherited.purpose === null) {
        return {
          purpose: null,
          provenance: 'unresolved',
          ruleCategoryId: parentId,
          mappingRevision,
          reason: 'explicit-unresolved',
        };
      }
      return {
        purpose: inherited.purpose,
        provenance: 'ancestor-rule',
        ruleCategoryId: parentId,
        mappingRevision,
        reason: null,
      };
    }
    parentId = parent.parentId;
  }

  return {
    purpose: null,
    provenance: 'unresolved',
    ruleCategoryId: null,
    mappingRevision,
    reason: 'not-mapped',
  };
}

/**
 * 解析一笔支出的用途：账单覆盖 > 直接分类规则 > 最近的冻结祖先规则 > unresolved。
 *
 * 显式 `purpose: null` 的规则会停止继承（`explicit-unresolved`），不会被更上层规则穿透。
 * `mapping: null` 表示没有所属周期：返回 unresolved / mappingRevision 0。
 */
export function resolveFinancialPurpose(input: FinancialPurposeResolutionInput): PurposeResolution {
  const record = requireRecord(input, 'FinancialPurposeResolutionInput must be an object.');
  const overrideRaw = record['override'];
  const override = overrideRaw === null || overrideRaw === undefined
    ? null
    : parseSpendingPurpose(overrideRaw, 'override');
  const categoryRaw = record['categoryId'];
  const categoryId = categoryRaw === null || categoryRaw === undefined
    ? null
    : requireNonEmptyString(categoryRaw, 'categoryId');
  const mappingRaw = record['mapping'];
  const mapping = mappingRaw === null || mappingRaw === undefined ? null : parseMappingSnapshot(mappingRaw);
  return resolvePurposeWithMapping(mapping, categoryId, override);
}

// ---------------------------------------------------------------------------
// 退款分摊
// ---------------------------------------------------------------------------

export interface FinancialRefundSplit {
  readonly originalTransactionId: string;
  readonly amountCents: number;
}

export interface FinancialRefundOriginalLimit {
  readonly transactionId: string;
  /** 原支出金额减去其他已确认退款分摊后的剩余可退金额（>= 0）。 */
  readonly remainingRefundableCents: number;
  readonly state: 'live' | 'deleted' | 'purged' | 'not-expense';
}

export interface FinancialRefundSplitValidationInput {
  readonly refundAmountCents: number;
  readonly originals: readonly FinancialRefundOriginalLimit[];
  readonly splits: readonly FinancialRefundSplit[];
}

export interface ValidatedFinancialRefundSplits {
  readonly splits: readonly FinancialRefundSplit[];
  readonly totalCents: number;
  readonly unresolvedCents: number;
}

/**
 * 校验一次退款分摊的完整替换输入。
 *
 * 规则与服务端事务内校验一致，但不读取数据库：
 * - 退款金额 > 0；最多 100 条分摊；每条金额 > 0；
 * - 原支出 ID 唯一，且 `originals` 必须与 `splits` 的原始 ID 集合完全一致；
 * - 只允许 live 原支出；每条分摊不超过该原支出的剩余可退金额；
 * - 分摊总和不超过退款金额；空数组表示清空；
 * - 聚合使用 BigInt，溢出整体拒绝，绝不截断。
 */
export function validateFinancialRefundSplits(
  input: FinancialRefundSplitValidationInput,
): ValidatedFinancialRefundSplits {
  const record = requireRecord(input, 'FinancialRefundSplitValidationInput must be an object.');
  const refundAmountCents = requireSafeInteger(record['refundAmountCents'], 'refundAmountCents', 1);

  if (!Array.isArray(record['originals']) || !Array.isArray(record['splits'])) {
    fail('INVALID_REFUND_SPLITS', 'originals and splits must be arrays.');
  }
  if (record['splits'].length > MAX_REFUND_SPLITS) {
    fail('INVALID_REFUND_SPLITS', `A refund may contain at most ${MAX_REFUND_SPLITS} splits.`);
  }
  if (record['originals'].length > MAX_REFUND_SPLITS) {
    fail('INVALID_REFUND_SPLITS', `A refund may reference at most ${MAX_REFUND_SPLITS} originals.`);
  }

  const originals = new Map<string, FinancialRefundOriginalLimit>();
  for (const item of record['originals']) {
    const original = requireRecord(item, 'Each original must contain transactionId, remainingRefundableCents and state.');
    const transactionId = requireNonEmptyString(original['transactionId'], 'original.transactionId');
    if (originals.has(transactionId)) {
      fail('INVALID_REFUND_SPLITS', 'originals must not contain duplicate transactionId values.');
    }
    const remainingRefundableCents = requireSafeInteger(
      original['remainingRefundableCents'],
      'original.remainingRefundableCents',
      0,
    );
    const state = original['state'];
    if (state !== 'live' && state !== 'deleted' && state !== 'purged' && state !== 'not-expense') {
      fail('INVALID_REFUND_SPLITS', 'original.state is not supported.');
    }
    if (state !== 'live') {
      fail('INVALID_REFUND_SPLITS', 'Only live originals can receive refund splits.');
    }
    originals.set(transactionId, { transactionId, remainingRefundableCents, state });
  }

  const splits: FinancialRefundSplit[] = [];
  const splitIds = new Set<string>();
  let total = 0n;
  for (const item of record['splits']) {
    const split = requireRecord(item, 'Each split must contain originalTransactionId and amountCents.');
    const originalTransactionId = requireNonEmptyString(
      split['originalTransactionId'],
      'split.originalTransactionId',
    );
    if (splitIds.has(originalTransactionId)) {
      fail('INVALID_REFUND_SPLITS', 'splits must not contain duplicate originalTransactionId values.');
    }
    splitIds.add(originalTransactionId);
    const amountCents = requireSafeInteger(split['amountCents'], 'split.amountCents', 1);
    const original = originals.get(originalTransactionId);
    if (original === undefined) {
      fail('INVALID_REFUND_SPLITS', 'Every split must reference an original supplied in originals.');
    }
    if (amountCents > original.remainingRefundableCents) {
      fail('INVALID_REFUND_SPLITS', 'A split exceeds its original remaining refundable amount.');
    }
    total += BigInt(amountCents);
    splits.push({ originalTransactionId, amountCents });
  }

  if (splitIds.size !== originals.size) {
    fail('INVALID_REFUND_SPLITS', 'originals must exactly cover the set of split original IDs.');
  }
  if (total > BigInt(refundAmountCents)) {
    fail('INVALID_REFUND_SPLITS', 'The split total must not exceed the refund amount.');
  }

  const totalCents = requireSafeBigInt(total, 'refund split total');
  return {
    splits,
    totalCents,
    unresolvedCents: refundAmountCents - totalCents,
  };
}

// ---------------------------------------------------------------------------
// 共享金额聚合
// ---------------------------------------------------------------------------

/**
 * 用 BigInt 精确求和一组安全整数分，输出前断言仍在安全整数范围。
 *
 * 服务端在聚合 verified/confirmed income、信封参考金额等派生值时必须复用本函数，
 * 不要在各处手写 `reduce`。`allowNegative` 为 false 时拒绝负数输入。
 */
export function sumFinancialExecutionCents(
  values: readonly number[],
  allowNegative = false,
): number {
  if (!Array.isArray(values)) {
    fail('INVALID_MONEY', 'values must be an array of safe integer cents.');
  }
  let total = 0n;
  for (const value of values) {
    const cents = requireSafeInteger(
      value,
      'values',
      allowNegative ? Number.MIN_SAFE_INTEGER : 0,
    );
    total += BigInt(cents);
  }
  return requireSafeBigInt(total, 'cent sum', allowNegative);
}

// ---------------------------------------------------------------------------
// 净执行
// ---------------------------------------------------------------------------

export interface FinancialSpendExecution {
  readonly purpose: SpendingPurpose;
  readonly targetCents: number;
  readonly grossCents: number;
  readonly attributedRefundCents: number;
  readonly netCents: number;
  readonly remainingCents: number;
  readonly overspendCents: number;
  readonly state: 'exact' | 'provisional';
}

export interface FinancialFundingUnavailable {
  readonly purpose: 'growth' | 'reserve';
  readonly targetCents: number;
  readonly state: 'not-connected';
  readonly executedCents: null;
  readonly remainingCents: null;
}

export interface FinancialExecutionUnresolved {
  readonly expenseCount: number;
  readonly grossCents: number;
  readonly attributedRefundCents: number;
  readonly netCents: number;
  readonly linkedRefundCount: number;
  readonly linkedRefundUnresolvedCents: number;
  readonly globalUnassignedRefundCount: number;
  readonly globalUnassignedRefundCents: number;
}

export interface FinancialEnvelopeReference {
  readonly mode: 'legacy-reference';
  readonly contract: 'legacy-gross';
  readonly totalBudgetCents: number;
  readonly mappedBudgetCents: {
    readonly essentials: number;
    readonly joy: number;
    readonly unresolved: number;
  };
  readonly purposeSpendingCeilingCents: number;
  readonly differenceCents: number;
  readonly legacyWindow: { readonly start: number; readonly end: number | null } | null;
  readonly windowMatches: boolean;
  readonly validatedNestedAllocation: false;
}

export interface FinancialExecutionDecisionInput {
  readonly incomeCents: number;
  readonly ratiosBps: FinancialRatiosBps;
  readonly targets: PurposeAmounts;
}

export interface FinancialExecutionExpenseFact {
  readonly transactionId: string;
  readonly amountCents: number;
  readonly date: number;
  readonly categoryId: string | null;
  readonly override: SpendingPurpose | null;
}

export interface FinancialExecutionRefundSplitFact {
  readonly refundTransactionId: string;
  readonly originalTransactionId: string;
  readonly amountCents: number;
}

export interface FinancialExecutionPendingRefundFact {
  readonly refundTransactionId: string;
  readonly amountCents: number;
}

export interface FinancialExecutionEnvelopeInput {
  readonly totalBudgetCents: number;
  readonly mappedBudgetCents: {
    readonly essentials: number;
    readonly joy: number;
    readonly unresolved: number;
  };
  readonly legacyWindow: { readonly start: number; readonly end: number | null } | null;
}

export interface FinancialExecutionInput {
  readonly window: FinancialWindow;
  readonly decision: FinancialExecutionDecisionInput;
  readonly sourceState: 'valid' | 'reconciliation-required' | 'empty';
  readonly mapping: FinancialMappingSnapshot;
  readonly expenses: readonly FinancialExecutionExpenseFact[];
  readonly refundSplits: readonly FinancialExecutionRefundSplitFact[];
  readonly pendingLinkedRefunds?: readonly FinancialExecutionPendingRefundFact[];
  readonly globalUnassignedRefunds?: {
    readonly count: number;
    readonly amountCents: number;
  } | null;
  readonly envelope: FinancialExecutionEnvelopeInput;
  readonly calculatedAt: number;
}

export interface FinancialExecutionComputation {
  readonly contractVersion: typeof FINANCIAL_EXECUTION_CONTRACT_VERSION;
  readonly rules: typeof FINANCIAL_EXECUTION_RULES;
  readonly calculatedAt: number;
  /** 固定顺序：[essentials, joy]。 */
  readonly spending: readonly FinancialSpendExecution[];
  /** 固定顺序：[growth, reserve]，Phase1 永远未接入实际划拨。 */
  readonly funding: readonly FinancialFundingUnavailable[];
  readonly unresolved: FinancialExecutionUnresolved;
  readonly coverage: 'exact' | 'provisional';
  readonly envelopeReference: FinancialEnvelopeReference;
}

function parseExecutionDecision(raw: unknown): FinancialExecutionDecisionInput {
  const record = requireRecord(raw, 'decision must be an object.');
  const incomeCents = requireSafeInteger(record['incomeCents'], 'decision.incomeCents', 0);
  const ratiosBps = validateFinancialRatiosBps(record['ratiosBps']);
  const targets = parsePurposeAmounts(record['targets'], 'decision.targets');
  const expected = allocateFinancialExecutionCents(incomeCents, ratiosBps);
  if (
    targets.growth !== expected.growth ||
    targets.reserve !== expected.reserve ||
    targets.essentials !== expected.essentials ||
    targets.joy !== expected.joy
  ) {
    fail('INVALID_EXECUTION', 'decision.targets do not match the exact allocation of incomeCents.');
  }
  return { incomeCents, ratiosBps, targets };
}

function parseExpenseFacts(raw: unknown): FinancialExecutionExpenseFact[] {
  if (!Array.isArray(raw)) {
    fail('INVALID_EXECUTION', 'expenses must be an array.');
  }
  const seen = new Set<string>();
  const facts: FinancialExecutionExpenseFact[] = [];
  for (const item of raw) {
    const record = requireRecord(item, 'Each expense fact must contain transactionId, amountCents and date.');
    const transactionId = requireNonEmptyString(record['transactionId'], 'expense.transactionId');
    if (seen.has(transactionId)) {
      fail('INVALID_EXECUTION', 'expenses must not contain duplicate transactionId values.');
    }
    seen.add(transactionId);
    const amountCents = requireSafeInteger(record['amountCents'], 'expense.amountCents', 1);
    const date = requireSafeInteger(record['date'], 'expense.date', 0);
    const categoryRaw = record['categoryId'];
    const categoryId = categoryRaw === null || categoryRaw === undefined
      ? null
      : requireNonEmptyString(categoryRaw, 'expense.categoryId');
    const overrideRaw = record['override'];
    const override = overrideRaw === null || overrideRaw === undefined
      ? null
      : parseSpendingPurpose(overrideRaw, 'expense.override');
    facts.push({ transactionId, amountCents, date, categoryId, override });
  }
  return facts;
}

function parseRefundSplitFacts(raw: unknown): FinancialExecutionRefundSplitFact[] {
  if (!Array.isArray(raw)) {
    fail('INVALID_EXECUTION', 'refundSplits must be an array.');
  }
  const seen = new Set<string>();
  const facts: FinancialExecutionRefundSplitFact[] = [];
  for (const item of raw) {
    const record = requireRecord(item, 'Each refund split fact must contain refundTransactionId, originalTransactionId and amountCents.');
    const refundTransactionId = requireNonEmptyString(
      record['refundTransactionId'],
      'refundSplit.refundTransactionId',
    );
    const originalTransactionId = requireNonEmptyString(
      record['originalTransactionId'],
      'refundSplit.originalTransactionId',
    );
    const key = `${refundTransactionId}\u0000${originalTransactionId}`;
    if (seen.has(key)) {
      fail('INVALID_REFUND_SPLITS', 'refundSplits must not contain duplicate refund/original pairs.');
    }
    seen.add(key);
    const amountCents = requireSafeInteger(record['amountCents'], 'refundSplit.amountCents', 1);
    facts.push({ refundTransactionId, originalTransactionId, amountCents });
  }
  return facts;
}

function parsePendingLinkedRefunds(raw: unknown): FinancialExecutionPendingRefundFact[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    fail('INVALID_EXECUTION', 'pendingLinkedRefunds must be an array.');
  }
  const seen = new Set<string>();
  const facts: FinancialExecutionPendingRefundFact[] = [];
  for (const item of raw) {
    const record = requireRecord(item, 'Each pending linked refund must contain refundTransactionId and amountCents.');
    const refundTransactionId = requireNonEmptyString(
      record['refundTransactionId'],
      'pendingLinkedRefund.refundTransactionId',
    );
    if (seen.has(refundTransactionId)) {
      fail('INVALID_REFUND_SPLITS', 'pendingLinkedRefunds must not contain duplicate refundTransactionId values.');
    }
    seen.add(refundTransactionId);
    const amountCents = requireSafeInteger(record['amountCents'], 'pendingLinkedRefund.amountCents', 1);
    facts.push({ refundTransactionId, amountCents });
  }
  return facts;
}

function parseGlobalUnassignedRefunds(
  raw: unknown,
): { readonly count: number; readonly amountCents: number } {
  if (raw === undefined || raw === null) {
    return { count: 0, amountCents: 0 };
  }
  const record = requireRecord(raw, 'globalUnassignedRefunds must contain count and amountCents.');
  const count = requireNonNegativeInteger(record['count'], 'globalUnassignedRefunds.count');
  const amountCents = requireSafeInteger(record['amountCents'], 'globalUnassignedRefunds.amountCents', 0);
  if ((count === 0) !== (amountCents === 0)) {
    fail('INVALID_REFUND_SPLITS', 'globalUnassignedRefunds count and amountCents must both be zero or both be non-zero.');
  }
  return { count, amountCents };
}

function parseEnvelopeInput(raw: unknown): FinancialExecutionEnvelopeInput {
  const record = requireRecord(raw, 'envelope must be an object.');
  const totalBudgetCents = requireSafeInteger(record['totalBudgetCents'], 'envelope.totalBudgetCents', 0);
  const mapped = requireRecord(record['mappedBudgetCents'], 'envelope.mappedBudgetCents must be an object.');
  const mappedBudgetCents = {
    essentials: requireSafeInteger(mapped['essentials'], 'envelope.mappedBudgetCents.essentials', 0),
    joy: requireSafeInteger(mapped['joy'], 'envelope.mappedBudgetCents.joy', 0),
    unresolved: requireSafeInteger(mapped['unresolved'], 'envelope.mappedBudgetCents.unresolved', 0),
  };
  return {
    totalBudgetCents,
    mappedBudgetCents,
    legacyWindow: normalizeLegacyWindow(record['legacyWindow']),
  };
}

/**
 * 计算一个冻结周期的净执行视图（不写库、不读时钟）。
 *
 * 服务端负责提供已经过令牌/CAS 校验的窗口、决策、映射和事实数组；本函数会：
 * - 过滤窗口外支出（`[start, end)`），按冻结映射 + 当前覆盖解析用途；
 * - 对每个原支出校验退款分摊上限，净额 = 毛额 − 已归属退款；
 * - 把无法分类的支出放入独立 unresolved 桶，绝不混入 essentials/joy；
 * - 任何 unresolved/pending/global-unassigned/source-reconciliation 影响都会使
 *   `state`/`coverage` 变为 `provisional`，不会把不完整数据标成 `exact`；
 * - growth/reserve 固定 `not-connected`，不模拟实际划拨。
 */
export function computeFinancialExecution(input: FinancialExecutionInput): FinancialExecutionComputation {
  const record = requireRecord(input, 'FinancialExecutionInput must be an object.');
  const window = parseFinancialWindow(record['window']);
  const decision = parseExecutionDecision(record['decision']);
  const sourceStateRaw = record['sourceState'];
  if (sourceStateRaw !== 'valid' && sourceStateRaw !== 'reconciliation-required' && sourceStateRaw !== 'empty') {
    fail('INVALID_EXECUTION', 'sourceState is not supported.');
  }
  const sourceState = sourceStateRaw;
  const mapping = parseMappingSnapshot(record['mapping']);
  const expenses = parseExpenseFacts(record['expenses']);
  const refundSplits = parseRefundSplitFacts(record['refundSplits']);
  const pendingLinkedRefunds = parsePendingLinkedRefunds(record['pendingLinkedRefunds']);
  const globalUnassignedRefunds = parseGlobalUnassignedRefunds(record['globalUnassignedRefunds']);
  const envelope = parseEnvelopeInput(record['envelope']);
  const calculatedAt = requireNonNegativeInteger(record['calculatedAt'], 'calculatedAt');

  const grossByPurpose: Record<SpendingPurpose, bigint> = { essentials: 0n, joy: 0n };
  const refundByPurpose: Record<SpendingPurpose, bigint> = { essentials: 0n, joy: 0n };
  let unresolvedExpenseCount = 0;
  let unresolvedGross = 0n;
  let unresolvedRefund = 0n;

  const includedExpenses = new Map<
    string,
    { readonly amountCents: number; readonly purpose: SpendingPurpose | null }
  >();
  for (const expense of expenses) {
    if (expense.date < window.start || expense.date >= window.end) continue;
    const resolution = resolvePurposeWithMapping(mapping, expense.categoryId, expense.override);
    includedExpenses.set(expense.transactionId, {
      amountCents: expense.amountCents,
      purpose: resolution.purpose,
    });
    if (resolution.purpose === null) {
      unresolvedExpenseCount += 1;
      unresolvedGross += BigInt(expense.amountCents);
    } else {
      grossByPurpose[resolution.purpose] += BigInt(expense.amountCents);
    }
  }

  const refundedByOriginal = new Map<string, bigint>();
  for (const split of refundSplits) {
    const original = includedExpenses.get(split.originalTransactionId);
    if (original === undefined) {
      fail('INVALID_REFUND_SPLITS', 'Every refund split must reference a live expense inside the window.');
    }
    const alreadyRefunded = refundedByOriginal.get(split.originalTransactionId) ?? 0n;
    const nextRefunded = alreadyRefunded + BigInt(split.amountCents);
    if (nextRefunded > BigInt(original.amountCents)) {
      fail('INVALID_REFUND_SPLITS', 'Refund splits exceed the original expense amount.');
    }
    refundedByOriginal.set(split.originalTransactionId, nextRefunded);
    if (original.purpose === null) {
      unresolvedRefund += BigInt(split.amountCents);
    } else {
      refundByPurpose[original.purpose] += BigInt(split.amountCents);
    }
  }

  let pendingUnresolved = 0n;
  for (const pending of pendingLinkedRefunds) {
    pendingUnresolved += BigInt(pending.amountCents);
  }

  const provisional =
    sourceState !== 'valid' ||
    unresolvedExpenseCount > 0 ||
    pendingLinkedRefunds.length > 0 ||
    globalUnassignedRefunds.count > 0;
  const state: 'exact' | 'provisional' = provisional ? 'provisional' : 'exact';

  const spending: FinancialSpendExecution[] = [];
  for (const purpose of ['essentials', 'joy'] as const) {
    const target = BigInt(decision.targets[purpose]);
    const gross = grossByPurpose[purpose];
    const attributed = refundByPurpose[purpose];
    const net = gross - attributed;
    const remaining = target - net;
    spending.push({
      purpose,
      targetCents: decision.targets[purpose],
      grossCents: requireSafeBigInt(gross, `${purpose} gross spending`),
      attributedRefundCents: requireSafeBigInt(attributed, `${purpose} attributed refunds`),
      netCents: requireSafeBigInt(net, `${purpose} net spending`),
      remainingCents: requireSafeBigInt(remaining, `${purpose} remaining`, true),
      overspendCents: requireSafeBigInt(remaining < 0n ? -remaining : 0n, `${purpose} overspend`),
      state,
    });
  }

  const unresolvedNet = unresolvedGross - unresolvedRefund;
  const unresolved: FinancialExecutionUnresolved = {
    expenseCount: unresolvedExpenseCount,
    grossCents: requireSafeBigInt(unresolvedGross, 'unresolved gross spending'),
    attributedRefundCents: requireSafeBigInt(unresolvedRefund, 'unresolved attributed refunds'),
    netCents: requireSafeBigInt(unresolvedNet, 'unresolved net spending'),
    linkedRefundCount: pendingLinkedRefunds.length,
    linkedRefundUnresolvedCents: requireSafeBigInt(pendingUnresolved, 'linked refund unresolved amount'),
    globalUnassignedRefundCount: globalUnassignedRefunds.count,
    globalUnassignedRefundCents: globalUnassignedRefunds.amountCents,
  };

  const ceiling =
    BigInt(decision.targets.essentials) + BigInt(decision.targets.joy);
  const difference = BigInt(envelope.totalBudgetCents) - ceiling;
  const envelopeReference: FinancialEnvelopeReference = {
    mode: 'legacy-reference',
    contract: 'legacy-gross',
    totalBudgetCents: envelope.totalBudgetCents,
    mappedBudgetCents: envelope.mappedBudgetCents,
    purposeSpendingCeilingCents: requireSafeBigInt(ceiling, 'purpose spending ceiling'),
    differenceCents: requireSafeBigInt(difference, 'envelope difference', true),
    legacyWindow: envelope.legacyWindow,
    windowMatches:
      envelope.legacyWindow !== null &&
      envelope.legacyWindow.start === window.start &&
      envelope.legacyWindow.end === window.end,
    validatedNestedAllocation: false,
  };

  return {
    contractVersion: FINANCIAL_EXECUTION_CONTRACT_VERSION,
    rules: FINANCIAL_EXECUTION_RULES,
    calculatedAt,
    spending,
    funding: [
      {
        purpose: 'growth',
        targetCents: decision.targets.growth,
        state: 'not-connected',
        executedCents: null,
        remainingCents: null,
      },
      {
        purpose: 'reserve',
        targetCents: decision.targets.reserve,
        state: 'not-connected',
        executedCents: null,
        remainingCents: null,
      },
    ],
    unresolved,
    coverage: state,
    envelopeReference,
  };
}
