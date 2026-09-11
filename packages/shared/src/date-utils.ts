/**
 * 日期工具与预算周期边界计算。
 *
 * 与参考实现 `budget_engine.dart` 的对应关系：
 * - `dateOnly`        ↔ `_dateOnly`        (`:287-288`)
 * - `daysInMonth`     ↔ `daysInMonth`      (`:219`)
 * - `periodStartOf`   ↔ `periodStartOf`    (`:226-240`)
 * - `nextPeriodStart` ↔ `nextPeriodStart`  (`:244-248`)
 * - `monthKey`        ↔ `_groupByMonth` 的整数键 (`:270`)
 *
 * 所有函数均为纯函数，且**只使用本地时间**的 年/月/日 分量 —— 与参考实现
 * 一致（Dart 的 `DateTime(y, m, d)` 也是本地时间）。这样"某天"的判定不受
 * UTC 偏移影响，跨时区不会出现账单归错月份的情况。
 */

import type { CycleConfig } from './types.js';
import { MAX_CYCLE_START_DAY, MIN_CYCLE_START_DAY } from './types.js';

/** 去掉时分秒，返回当天 00:00 的 epoch 毫秒（本地时间）。 */
export function dateOnly(epochMs: number): number {
  const d = new Date(epochMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** 由 年/月(0-based)/日 构造当天 00:00 的 epoch 毫秒。 */
export function dayStart(year: number, monthIndex: number, day: number): number {
  return new Date(year, monthIndex, day).getTime();
}

/** 某年某月的天数。`monthIndex` 为 0-based。 */
export function daysInMonth(year: number, monthIndex: number): number {
  // 下个月第 0 天 = 本月最后一天
  return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * 自然月分组键：`year * 100 + (monthIndex + 1)`。
 *
 * ⚠️ 必须用整数键，**不能**用 `'YYYY-MM'` 字符串排序 ——
 * 参考项目记录过该 bug：字符串字典序下 `'2026-12' < '2026-9'`，
 * 会让 12 月排到 9 月前面（见行为规格用例 X1）。
 */
export function monthKey(epochMs: number): number {
  const d = new Date(epochMs);
  return d.getFullYear() * 100 + (d.getMonth() + 1);
}

/**
 * 校验**用户可配置**的周期起始日是否合法（1..28）。
 *
 * 参考项目 `test/budget_prefs_test.dart:27,30` 专门测了越界值 `0` 与 `29`，
 * 说明设置入口的合法范围是 1..28。注意这**不限制** `periodStartOf` 的入参：
 * 参考实现的引擎测试会直接传 `31`（见下方 `periodStartOf` 说明）。
 */
export function isValidCycleStartDay(day: number): boolean {
  return (
    Number.isInteger(day) &&
    day >= MIN_CYCLE_START_DAY &&
    day <= MAX_CYCLE_START_DAY
  );
}

/**
 * 把配置日夹到某个月的实际天数内。
 *
 * 参考 `budget_engine.dart:228`：`cycleStartDay.clamp(1, daysInMonth(y, m))`。
 * 注意是**按目标月的天数**夹，不是全局夹到 28 —— 例如配置 31：
 * 4 月夹到 30、2 月夹到 28、5 月仍是 31。
 */
function clampToMonth(day: number, year: number, monthIndex: number): number {
  const max = daysInMonth(year, monthIndex);
  return Math.min(Math.max(day, 1), max);
}

/**
 * 配置 `startDay` 下，含 `date` 的周期起点。
 *
 * 规则（参考 `:226-240`）：
 * - 边界 = 每个月的 `startDay` 号，**短月 clamp 到月末**（按该月天数）；
 * - 若 `date` 早于当月的配置日，归属到**上一月**的周期（上一月同样 clamp）。
 *
 * 入参 `startDay` 不强制 ≤ 28：设置接口负责拒绝越界值（`isValidCycleStartDay`），
 * 而引擎本身按参考实现的 clamp 语义工作，以便与用例 C2/C3 一致
 * （`periodStartOf(31, 2026-04-30) === 2026-04-30`、
 * `periodStartOf(31, 2026-04-15) === 2026-03-31`、
 * `nextPeriodStart(31, 2026-04-30) === 2026-05-31`）。
 */
export function periodStartOf(startDay: number, date: number): number {
  const d = new Date(dateOnly(date));
  const year = d.getFullYear();
  const monthIndex = d.getMonth();

  const candidate = dayStart(
    year,
    monthIndex,
    clampToMonth(startDay, year, monthIndex),
  );

  if (d.getTime() < candidate) {
    // 归属上一月的周期（上一月同样按该月天数 clamp）
    const prevYear = monthIndex === 0 ? year - 1 : year;
    const prevMonth = monthIndex === 0 ? 11 : monthIndex - 1;
    return dayStart(
      prevYear,
      prevMonth,
      clampToMonth(startDay, prevYear, prevMonth),
    );
  }

  return candidate;
}

/** 配置 `startDay` 下，周期起点 `start` 的下一周期起点（同样按目标月 clamp）。 */
export function nextPeriodStart(startDay: number, start: number): number {
  const d = new Date(dateOnly(start));
  const year = d.getFullYear();
  const monthIndex = d.getMonth();
  const nextYear = monthIndex === 11 ? year + 1 : year;
  const nextMonth = monthIndex === 11 ? 0 : monthIndex + 1;
  return dayStart(
    nextYear,
    nextMonth,
    clampToMonth(startDay, nextYear, nextMonth),
  );
}

/**
 * 统一入口：按 `cycle` 计算含 `date` 的周期起点。
 *
 * - `natural-month`：返回当月 1 号。注意引擎的自然月模式实际用"组内最早发薪日"
 *   作为周期起点（`_earliestDate`,`:278-285`），本函数只给日历边界。
 * - `start-day`：委托 `periodStartOf`。
 */
export function cycleStartOf(cycle: CycleConfig, date: number): number {
  if (cycle.kind === 'natural-month') {
    const d = new Date(dateOnly(date));
    return dayStart(d.getFullYear(), d.getMonth(), 1);
  }
  return periodStartOf(cycle.day, date);
}

/** 周期起点所属月份的整数键。 */
export function cycleMonthKey(cycle: CycleConfig, date: number): number {
  return cycle.kind === 'natural-month'
    ? monthKey(date)
    : monthKey(cycleStartOf(cycle, date));
}

/** 判断 `date` 是否落在半开区间 `[start, end)`；`end === null` 表示无上界。 */
export function inCycle(
  date: number,
  start: number,
  end: number | null,
): boolean {
  const day = dateOnly(date);
  const afterStart = day >= start;
  const beforeEnd = end === null || day < end;
  return afterStart && beforeEnd;
}
