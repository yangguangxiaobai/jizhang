/**
 * 统计窗口（`StatsWindow`）：服务端唯一决定“近30天 / 某个月”到底是哪一段时间。
 *
 * ## 为什么必须由服务端算
 *
 * 旧实现的“近30天”上界用的是**下个月 1 号**（`startOfNextMonth(now)`），于是
 * 2026-10-29 12:00 的“近30天”被算成 `[09-29 12:00, 11-01 00:00)` —— 多算了未来两天，
 * 与“截至当前时刻”的文案不符。客户端各用自己的设备时区/下月初猜测区间时，同一页面的
 * 数字和标签也会互相矛盾。所以区间在这里一次算清，客户端只显示 `label`。
 *
 * ## 两种区间
 *
 * - `month`：显式 IANA 时区中的 `[当月1日00:00, 次月1日00:00)`，不是 30 天近似；
 * - `last30`：`[now − 30×86400000, now)`，即**滚动 720 小时**，不是 30 个本地午夜，
 *   因此夏令时切换不会让区间变成 719/721 小时。上下界都来自**同一个**捕获的 `now`。
 *
 * ## 纯函数边界
 *
 * 本文件不读时钟、不读数据库、不发网络请求：`now` 由调用方传入。所有日历运算都通过
 * `Intl.DateTimeFormat` 使用显式时区，绝不依赖进程本地时区（`financial-execution.ts`
 * 的 `financial-cycle-frozen-month-v1` 采用同一约定）。
 */

/** 统计区间种类。 */
export type StatsWindowKind = 'month' | 'last30';

/**
 * 服务端算出的统计区间。
 *
 * `from`/`to` 是**半开区间** `[from, to)` 的 epoch 毫秒；`label` 必须如实描述该区间
 * （客户端直接显示，不再自己拼“本月/近30天”）。
 */
export interface StatsWindow {
  readonly kind: StatsWindowKind;
  /** 区间下界（含）。 */
  readonly from: number;
  /** 区间上界（不含）。 */
  readonly to: number;
  /** 计算区间所用的显式 IANA 时区；响应中原样回显。 */
  readonly timeZone: string;
  /** 如实描述 `[from, to)` 的展示文案，例如 `2026年10月` / `近30天 09-29 12:00 – 10-29 12:00`。 */
  readonly label: string;
  /** 捕获的 `now`；与 `last30.to` 相同，便于客户端判断数据新鲜度。 */
  readonly calculatedAt: number;
}

/** 纯规则的失败类别；HTTP 状态由服务端映射（`INVALID_*` → 400）。 */
export type StatsWindowErrorCode =
  | 'INVALID_WINDOW_KIND'
  | 'INVALID_MONTH'
  | 'INVALID_TIME_ZONE'
  | 'INVALID_NOW';

/**
 * 统计区间输入不合法。
 *
 * 消息只描述字段与格式，不回显用户数据。服务端把 `INVALID_*` 映射为 400，
 * 不要把它静默降级成“默认本月”——否则界面会用一个编造的区间显示真实金额。
 */
export class StatsWindowInputError extends Error {
  readonly code: StatsWindowErrorCode;

  constructor(code: StatsWindowErrorCode, message: string) {
    super(message);
    this.name = 'StatsWindowInputError';
    this.code = code;
  }
}

/** 滚动 30 天 = 720 小时。刻意用毫秒常量而不是“30 个本地日”。 */
export const LAST_30_DAYS_MS = 30 * 86_400_000;

const HOUR_MS = 3_600_000;
/** ECMAScript Date 可表示的最大毫秒数（TimeClip 边界）。 */
const MAX_DATE_MS = 8_640_000_000_000_000;
/** 支持 2000..9999 的月份键；更早的 IANA 历史时区包含日期线回拨等非单调边界。 */
const MIN_SUPPORTED_YEAR = 2000;
const MAX_SUPPORTED_YEAR = 9999;
const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

function fail(code: StatsWindowErrorCode, message: string): never {
  throw new StatsWindowInputError(code, message);
}

// ---------------------------------------------------------------------------
// 输入校验
// ---------------------------------------------------------------------------

/** 校验统计区间种类（`'month' | 'last30'`）。 */
function requireKind(value: unknown): StatsWindowKind {
  if (value === 'month' || value === 'last30') return value;
  fail('INVALID_WINDOW_KIND', "kind must be 'month' or 'last30'.");
}

/** 校验捕获的时钟：非负安全整数，且在 Date 可表示范围内。 */
function requireInstant(value: unknown, field: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_DATE_MS
  ) {
    fail('INVALID_NOW', `${field} must be a non-negative epoch-millisecond timestamp.`);
  }
  return value;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
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
  formatters.set(timeZone, formatter);
  return formatter;
}

/** 校验显式 IANA 时区；`+08:00` 这类固定偏移不满足“显式 IANA”契约。 */
function requireTimeZone(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail('INVALID_TIME_ZONE', 'timeZone must be a valid explicit IANA time zone.');
  }
  if (value.startsWith('+') || value.startsWith('-')) {
    fail('INVALID_TIME_ZONE', 'timeZone must be a valid explicit IANA time zone.');
  }
  formatterFor(value);
  return value;
}

interface YearMonth {
  readonly year: number;
  readonly month: number;
}

/**
 * 校验 `YYYY-MM` 月份键（2000-01 .. 9999-12）。
 *
 * 与 `financial-execution.ts` 的 `groupMonth` 同一格式，供统计窗口与月度趋势锚点共用，
 * 避免两处各写一份正则后规则漂移。
 */
export function parseStatsMonth(value: unknown): YearMonth {
  if (typeof value !== 'string') {
    fail('INVALID_MONTH', 'month must be formatted as YYYY-MM.');
  }
  const match = MONTH_PATTERN.exec(value);
  if (match === null) {
    fail('INVALID_MONTH', 'month must be formatted as YYYY-MM.');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    year < MIN_SUPPORTED_YEAR ||
    year > MAX_SUPPORTED_YEAR ||
    month < 1 ||
    month > 12
  ) {
    fail('INVALID_MONTH', 'month must be a valid calendar month between 2000-01 and 9999-12.');
  }
  return { year, month };
}

// ---------------------------------------------------------------------------
// 显式时区日历运算
// ---------------------------------------------------------------------------

interface ZonedCivil {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/** 用 UTC 分量构造 00:00 的 epoch 毫秒（不受进程本地时区影响）。 */
function civilUtcMs(year: number, month: number, day: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

/** 某个瞬间在显式时区中的本地日历分量。 */
function zonedCivilAt(epochMs: number, timeZone: string): ZonedCivil {
  const date = new Date(epochMs);
  if (Number.isNaN(date.getTime())) {
    fail('INVALID_NOW', 'the requested timestamp is outside the ECMAScript Date range.');
  }
  const values: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(date)) {
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
  const second = values['second'] ?? 0;
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined
  ) {
    fail('INVALID_TIME_ZONE', 'timeZone could not be resolved into calendar parts.');
  }
  return { year, month, day, hour: hour === 24 ? 0 : hour, minute, second };
}

/** 月份序数（`year * 12 + monthIndex`）；整数比较，避免 `'2026-12' < '2026-9'` 的字典序 bug。 */
function monthOrdinal(year: number, month: number): number {
  return year * 12 + (month - 1);
}

function monthOrdinalAt(epochMs: number, timeZone: string): number {
  const parts = zonedCivilAt(epochMs, timeZone);
  return monthOrdinal(parts.year, parts.month);
}

/**
 * 显式时区中某个月 1 日 00:00 的**最早有效瞬间**。
 *
 * ## 历史时区回拨与跳跃处理策略
 *
 * 不能对整个 UTC 月初 ±48h 假设“本地月份单调”进行全局二分：在秋季回拨（如 America/St_Johns
 * 2009-11-01）场景下，本地时钟在 00:01 回拨 60 分钟回到前一日 23:01，导致 00:00:00 在时间轴上
 * 出现两次（02:30Z 与 03:30Z），且中间会出现本地月份从 11 月退回 10 月的非单调波动。全局二分会
 * 错选第二次（03:30Z）。
 *
 * 因此本算法采用有界候选午夜搜索与单调局部区间二分结合：
 * 1. 在 `[utcMidnight - 24h, utcMidnight + 24h]` 有界窗口内按步长采样收集本地时区所有可能的有效偏移量；
 * 2. 对每个可能偏移，反向构造候选午夜 `cand = utcMidnight - offset`，并通过含秒的显式时区 civil parts
 *    进行严格回验（必须精确满足目标年、月、1 日 00:00:00）；
 * 3. 若存在精确午夜（包括回拨产生多个午夜）：按 epoch 升序排序，严格选取最早有效值（如 02:30Z）；
 * 4. 若午夜被跳过（如春季夏令时 America/Asuncion 2017-10 跳过 00:00 直接跳到 01:00）：此时不存在
 *    00:00:00，在已确认单调的跨月局部区间 `[lastBeforeSample, firstAtOrAfterSample]` 内精确二分，
 *    定位偏移转换后的首个有效边界；
 * 5. 保持返回单个半开区间 `[from, to)`，确保相邻两月在分界点严格衔接无缝隙。
 */
function zonedMonthStart(year: number, month: number, timeZone: string): number {
  const target = monthOrdinal(year, month);
  const utcMidnight = civilUtcMs(year, month, 1);

  // 1. 在 UTC 月初 ±24h 范围内以 30 分钟步长采样，收集回拨前后可能存在的所有有效时区偏移量，
  //    并定位跨月前后已确认单调的采样边界。
  const offsets = new Set<number>();
  let lastBeforeSample = utcMidnight - 24 * HOUR_MS;
  let firstAtOrAfterSample = utcMidnight + 24 * HOUR_MS;
  let foundBefore = false;
  let foundAfter = false;

  for (let offsetMinutes = -24 * 60; offsetMinutes <= 24 * 60; offsetMinutes += 30) {
    const t = utcMidnight + offsetMinutes * 60_000;
    const parts = zonedCivilAt(t, timeZone);
    const localUtc =
      civilUtcMs(parts.year, parts.month, parts.day) +
      parts.hour * HOUR_MS +
      parts.minute * 60_000 +
      parts.second * 1000;
    offsets.add(localUtc - t);

    const ord = monthOrdinal(parts.year, parts.month);
    if (ord < target) {
      lastBeforeSample = t;
      foundBefore = true;
    } else if (!foundAfter && ord >= target) {
      firstAtOrAfterSample = t;
      foundAfter = true;
    }
  }

  // 2. 构造候选并用含秒的显式时区 civil parts 回验，精确匹配 1 日 00:00:00
  const exactMidnights: number[] = [];
  for (const offset of offsets) {
    const cand = utcMidnight - offset;
    const parts = zonedCivilAt(cand, timeZone);
    if (
      parts.year === year &&
      parts.month === month &&
      parts.day === 1 &&
      parts.hour === 0 &&
      parts.minute === 0 &&
      parts.second === 0
    ) {
      exactMidnights.push(cand);
    }
  }

  // 若存在精确午夜（正常月份 1 个，重复午夜多个），按 epoch 从小到大选最早有效值
  if (exactMidnights.length > 0) {
    exactMidnights.sort((a, b) => a - b);
    const earliest = exactMidnights[0];
    if (earliest !== undefined) return earliest;
  }

  // 3. 跳过午夜（如 America/Asuncion 2017-10 缺午夜）：使用偏移转换后首个有效边界。
  //    在已确认单调的局部区间 [lastBeforeSample, firstAtOrAfterSample] 内精确二分。
  if (!foundBefore || !foundAfter) {
    fail('INVALID_TIME_ZONE', 'timeZone produced a non-monotonic month boundary.');
  }

  let low = lastBeforeSample;
  let high = firstAtOrAfterSample;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (monthOrdinalAt(mid, timeZone) >= target) {
      high = mid;
    } else {
      low = mid;
    }
  }

  const boundaryParts = zonedCivilAt(high, timeZone);
  if (boundaryParts.year !== year || boundaryParts.month !== month || boundaryParts.day !== 1) {
    fail('INVALID_TIME_ZONE', 'timeZone failed to resolve the earliest instant of the month.');
  }

  return high;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** `MM-DD HH:mm`；跨年时补全年份，保证文案不会把去年写成今年。 */
function formatInstant(parts: ZonedCivil, withYear: boolean): string {
  const date = withYear
    ? `${String(parts.year).padStart(4, '0')}-${pad2(parts.month)}-${pad2(parts.day)}`
    : `${pad2(parts.month)}-${pad2(parts.day)}`;
  return `${date} ${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

/** 滚动区间的文案，例如 `近30天 09-29 12:00 – 10-29 12:00`。 */
function rollingRangeLabel(from: number, to: number, timeZone: string): string {
  const start = zonedCivilAt(from, timeZone);
  const end = zonedCivilAt(to, timeZone);
  const withYear = start.year !== end.year;
  return `近30天 ${formatInstant(start, withYear)} – ${formatInstant(end, withYear)}`;
}

// ---------------------------------------------------------------------------
// 公开入口
// ---------------------------------------------------------------------------

/**
 * 解析统计区间。
 *
 * - `kind = 'month'`：`month` 必须是 `YYYY-MM`，返回该时区的
 *   `[当月1日00:00, 次月1日00:00)`，`label` 为 `2026年10月`；
 * - `kind = 'last30'`：`month` 允许为 `null`（提供时也校验格式，但不参与计算），返回
 *   `[now − 30×86400000, now)`，`label` 如实写出两端时刻。
 *
 * 无效的 kind / month / timeZone / now 一律抛 `StatsWindowInputError`，不静默回退到
 * “默认本月”或“最近 30 天”，避免界面用编造的区间展示真实金额。
 */
export function resolveStatsWindow(
  kind: StatsWindowKind,
  month: string | null,
  now: number,
  timeZone: string,
): StatsWindow {
  const resolvedKind = requireKind(kind);
  const resolvedZone = requireTimeZone(timeZone);
  const capturedNow = requireInstant(now, 'now');
  const parsedMonth = month === null ? null : parseStatsMonth(month);

  if (resolvedKind === 'month') {
    if (parsedMonth === null) {
      fail('INVALID_MONTH', 'month is required when kind is month.');
    }
    const next =
      parsedMonth.month === 12
        ? { year: parsedMonth.year + 1, month: 1 }
        : { year: parsedMonth.year, month: parsedMonth.month + 1 };
    return {
      kind: 'month',
      from: zonedMonthStart(parsedMonth.year, parsedMonth.month, resolvedZone),
      to: zonedMonthStart(next.year, next.month, resolvedZone),
      timeZone: resolvedZone,
      label: `${parsedMonth.year}年${parsedMonth.month}月`,
      calculatedAt: capturedNow,
    };
  }

  // 滚动 720 小时：上下界共用同一个捕获的 now，跨夏令时也不会变成 719/721 小时。
  const from = capturedNow - LAST_30_DAYS_MS;
  return {
    kind: 'last30',
    from,
    to: capturedNow,
    timeZone: resolvedZone,
    label: rollingRangeLabel(from, capturedNow, resolvedZone),
    calculatedAt: capturedNow,
  };
}
