/**
 * 信封预算引擎。
 *
 * 逐条复刻参考实现 `lib/data/repository/budget_engine.dart`（332 行）的语义。
 * 行为规格见 `.trellis/tasks/09-11-web-pwa/research/budget-engine-behavior-spec.md`
 * —— 该文档含 21 个带精确期望值的用例，本文件必须让它们全部通过。
 *
 * ## 核心不变量（参考 `:10-21` 类注释）
 *
 * - 全部**实时计算，不物化余额**。本模块是纯函数，不读时钟、不读库。
 * - 默认（`natural-month`）：每个自然月 = 一个预算周期；同月多次记工资
 *   **自动合并为同一周期（模块预算相加）**。
 * - 配置周期起始日（`start-day`）：周期跨自然月定义（如 15 号到次月 14 号）。
 * - 周期内消费从对应模块扣减；模块可用额度 = 分配额 − 已消费；
 *   **超支从累积结余池借用**。
 * - 每个周期结束时各模块剩余累积到"累积结余池"；**池不因周期开启而清零**。
 * - 无现役预算周期时，消费**从结余池扣减**。
 *
 * ## 净支出口径（`transaction.dart:44-51`）
 *
 * `spent` 累加的是 `expenseContribution`，**不是** `amountCents`：
 * 退款行为负贡献，故退款会**减少**模块已用额。
 */

import {
  cycleStartOf,
  dateOnly,
  daysInMonth,
  inCycle,
  monthKey,
  nextPeriodStart,
  periodStartOf,
} from './date-utils.js';
import {
  expenseContribution,
  makeModuleView,
  TYPE_EXPENSE,
  type BudgetAllocation,
  type CycleConfig,
  type ModuleAllocation,
  type ModuleView,
  type Transaction,
} from './types.js';

// ---------------------------------------------------------------------------
// 内部：周期分组
// ---------------------------------------------------------------------------

/** 一个周期分组：周期起点 + 该周期内的所有分配行。 */
interface PeriodGroup {
  /** 周期起点（本地日 00:00 的 epoch 毫秒）。 */
  readonly start: number;
  /** 该周期内的分配行（保持传入顺序）。 */
  readonly allocations: readonly BudgetAllocation[];
}

/** 全部有效分配（过滤软删除），按 `date` 倒序，再按 `updatedAt` 倒序。 */
function liveAllocationsDesc(
  allocationsDesc: readonly BudgetAllocation[],
): BudgetAllocation[] {
  return allocationsDesc
    .filter((a) => a.deleted !== true)
    .slice()
    .sort((a, b) => {
      const byDate = b.date - a.date;
      if (byDate !== 0) return byDate;
      return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    });
}

/** 组内最早日期（周期起点）。参考 `_earliestDate`,`:278-285`。 */
function earliestDate(group: readonly BudgetAllocation[]): number {
  const first = group[0];
  if (first === undefined) return 0;
  let earliest = dateOnly(first.date);
  for (const a of group) {
    const day = dateOnly(a.date);
    if (day < earliest) earliest = day;
  }
  return earliest;
}

/**
 * 自然月模式分组：按 `year*100+month` 整数键分组，最新月在前。
 *
 * ⚠️ 用整数键而非 `'YYYY-MM'` 字符串 —— 见 `monthKey` 的说明。
 * 参考 `_groupByMonth`,`:265-275`。
 */
function groupByMonth(
  allocationsDesc: readonly BudgetAllocation[],
): PeriodGroup[] {
  const groups = new Map<number, BudgetAllocation[]>();
  for (const a of allocationsDesc) {
    const key = monthKey(a.date);
    const bucket = groups.get(key);
    if (bucket) bucket.push(a);
    else groups.set(key, [a]);
  }
  const keys = [...groups.keys()].sort((a, b) => b - a);
  return keys.map((k) => {
    const bucket = groups.get(k) ?? [];
    return { start: earliestDate(bucket), allocations: bucket };
  });
}

/**
 * 配置起始日模式分组：按 `periodStartOf(day, date)` 分组，最新周期在前。
 * 参考 `_groupByPeriod`,`:251-262`。
 */
function groupByPeriod(
  allocationsDesc: readonly BudgetAllocation[],
  startDay: number,
): PeriodGroup[] {
  const groups = new Map<number, BudgetAllocation[]>();
  for (const a of allocationsDesc) {
    const key = periodStartOf(startDay, a.date);
    const bucket = groups.get(key);
    if (bucket) bucket.push(a);
    else groups.set(key, [a]);
  }
  const keys = [...groups.keys()].sort((a, b) => b - a);
  return keys.map((k) => ({ start: k, allocations: groups.get(k) ?? [] }));
}

/** 按 `cycle` 分组。 */
function groupByCycle(
  allocationsDesc: readonly BudgetAllocation[],
  cycle: CycleConfig,
): PeriodGroup[] {
  return cycle.kind === 'natural-month'
    ? groupByMonth(allocationsDesc)
    : groupByPeriod(allocationsDesc, cycle.day);
}

/**
 * 合并组内所有分配的模块金额（同分类**相加**）。
 * 参考 `_mergeModules`,`:291-304`。
 */
function mergeModules(
  group: readonly BudgetAllocation[],
): ModuleAllocation[] {
  const merged = new Map<string, number>();
  for (const a of group) {
    for (const m of a.allocations) {
      merged.set(m.categoryId, (merged.get(m.categoryId) ?? 0) + m.amountCents);
    }
  }
  return [...merged.entries()].map(([categoryId, amountCents]) => ({
    categoryId,
    amountCents,
  }));
}

/**
 * 某分类在 `[start, end)` 内的净消费。
 * `end === null` 表示无上界。参考 `_spentBetween`,`:314-331`。
 *
 * ⚠️ 累加 `expenseContribution`（退款为负），不是 `amountCents`。
 */
function spentBetween(
  transactions: readonly Transaction[],
  categoryId: string,
  start: number,
  end: number | null,
): number {
  let spent = 0;
  for (const txn of transactions) {
    if (
      txn.type === TYPE_EXPENSE &&
      txn.deleted !== true &&
      txn.categoryId === categoryId &&
      inCycle(txn.date, start, end)
    ) {
      spent += expenseContribution(txn);
    }
  }
  return spent;
}

// ---------------------------------------------------------------------------
// 周期区间
// ---------------------------------------------------------------------------

/**
 * 当前周期的区间 `[start, end)`；`end === null` 表示无上界。
 *
 * - 自然月模式：`[组内最早日期, null)`（参考 `:52` 传 `end = null`）。
 * - 起始日模式：`[periodStartOf, nextPeriodStart)`（参考 `:69-70`）。
 */
export function currentCycleRange(
  allocationsDesc: readonly BudgetAllocation[],
  cycle: CycleConfig,
): { start: number; end: number | null } | null {
  const live = liveAllocationsDesc(allocationsDesc);
  if (live.length === 0) return null;

  const groups = groupByCycle(live, cycle);
  const current = groups[0];
  if (current === undefined) return null;

  if (cycle.kind === 'natural-month') {
    return { start: current.start, end: null };
  }
  const anchor = current.allocations[0];
  if (anchor === undefined) return null;
  const start = periodStartOf(cycle.day, anchor.date);
  return { start, end: nextPeriodStart(cycle.day, start) };
}

// ---------------------------------------------------------------------------
// computeModuleViews
// ---------------------------------------------------------------------------

export interface ComputeModuleViewsInput {
  /** 全部分配，期望按 `date` 倒序（本函数内部会再排序）。 */
  readonly allocationsDesc: readonly BudgetAllocation[];
  /** 所有交易（含软删除行，内部过滤）。 */
  readonly transactions: readonly Transaction[];
  /** 周期配置；缺省为自然月模式。 */
  readonly cycle?: CycleConfig;
}

/**
 * 计算**当前**预算周期的模块视图。
 *
 * 空分配 → 返回空数组（参考 `:37`）。
 * 参考 `computeModuleViews`,`:32-91`。
 */
export function computeModuleViews(
  input: ComputeModuleViewsInput,
): ModuleView[] {
  const cycle: CycleConfig = input.cycle ?? { kind: 'natural-month' };

  const live = liveAllocationsDesc(input.allocationsDesc);
  if (live.length === 0) return [];

  const groups = groupByCycle(live, cycle);
  const current = groups[0];
  if (current === undefined) return [];
  const anchor = current.allocations[0];
  if (anchor === undefined) return [];

  const start =
    cycle.kind === 'natural-month'
      ? current.start
      : periodStartOf(cycle.day, anchor.date);
  // 自然月模式无上界（到无穷）；起始日模式为下一周期边界。
  const end =
    cycle.kind === 'natural-month'
      ? null
      : nextPeriodStart(cycle.day, start);

  const views: ModuleView[] = [];
  for (const m of mergeModules(current.allocations)) {
    const spent = spentBetween(
      input.transactions,
      m.categoryId,
      start,
      end,
    );
    views.push(makeModuleView(m.categoryId, m.amountCents, spent));
  }
  return views;
}

// ---------------------------------------------------------------------------
// computeCarryoverPool
// ---------------------------------------------------------------------------

export interface ComputeCarryoverPoolInput {
  readonly allocationsDesc: readonly BudgetAllocation[];
  readonly transactions: readonly Transaction[];
  /** 若有，则扣除当前周期的超支借用（通常传 `computeModuleViews` 的结果）。 */
  readonly currentModuleViews?: readonly ModuleView[];
  readonly cycle?: CycleConfig;
}

/**
 * 累积结余池总额（可借用池，单位分，**可以为负** —— 表示净借用）。
 *
 * ```
 * 池 = Σ(历史周期各模块剩余)
 *    − Σ(无现役周期期间的消费)
 *    − Σ(当前周期内超支借用量)
 * ```
 *
 * 空分配 → `0`（参考 `:109`）。
 * 参考 `computeCarryoverPool`,`:103-204`。
 *
 * 三步顺序与符号都不能错，详见文件顶部的口径说明与行为规格 P1-P4 / R3 / C7-C8。
 */
export function computeCarryoverPool(
  input: ComputeCarryoverPoolInput,
): number {
  const cycle: CycleConfig = input.cycle ?? { kind: 'natural-month' };

  const live = liveAllocationsDesc(input.allocationsDesc);
  if (live.length === 0) return 0;

  const groups = groupByCycle(live, cycle);
  const current = groups[0];
  if (current === undefined) return 0;
  const anchor = current.allocations[0];
  if (anchor === undefined) return 0;
  const historical = groups.slice(1);

  const currentStart =
    cycle.kind === 'natural-month'
      ? current.start
      : periodStartOf(cycle.day, anchor.date);

  let pool = 0;

  // ---- ① 历史周期各模块剩余累积 ----
  // 窗口连续平铺：最旧的周期窗口到下一周期边界，依此类推至当前周期边界。
  // 参考 `:116-135`（自然月） / `:164-182`（起始日）。
  let nextStart = currentStart;
  for (const group of historical) {
    const groupAnchor = group.allocations[0];
    if (groupAnchor === undefined) continue;
    const start =
      cycle.kind === 'natural-month'
        ? group.start
        : periodStartOf(cycle.day, groupAnchor.date);
    for (const module of mergeModules(group.allocations)) {
      const spentInPeriod = spentBetween(
        input.transactions,
        module.categoryId,
        start,
        nextStart,
      );
      pool += module.amountCents - spentInPeriod;
    }
    nextStart = start;
  }

  // ---- ② 无现役周期期间的消费（发生在最早周期起点之前）----
  // 参考 `:137-144`（自然月） / `:184-191`（起始日）。
  // 注意符号：`pool -= expenseContribution`，退款贡献为负 → 等于把退款**加回**池。
  // 参考实现只在 `txn.isExpense` 时执行，故此处用 `type === TYPE_EXPENSE` 同构。
  const oldest = live[live.length - 1];
  if (oldest === undefined) return pool;
  const earliestStart =
    cycle.kind === 'natural-month'
      ? dateOnly(oldest.date)
      : periodStartOf(cycle.day, oldest.date);

  for (const txn of input.transactions) {
    if (
      txn.type === TYPE_EXPENSE &&
      txn.deleted !== true &&
      dateOnly(txn.date) < earliestStart
    ) {
      pool -= expenseContribution(txn);
    }
  }

  // ---- ③ 当前周期内各模块超支借用 ----
  // 参考 `:146-154` / `:193-201`。池可变为负数。
  if (input.currentModuleViews) {
    for (const view of input.currentModuleViews) {
      if (view.spentCents > view.budgetCents) {
        pool -= view.spentCents - view.budgetCents;
      }
    }
  }

  return pool;
}

// ---------------------------------------------------------------------------
// 结余池历史序列（供 T8 图表使用）
// ---------------------------------------------------------------------------

export interface PoolTrendPoint {
  /** 周期起点，epoch 毫秒。 */
  readonly periodStart: number;
  /** 该点的池余额（分）。见下方 `computePoolTrend` 的语义说明。 */
  readonly poolCents: number;
}

/**
 * 结余池随周期演进的序列（按周期起点**升序**）。
 *
 * ## 语义
 *
 * 参考实现的池**只累积已关闭的历史周期**：`computeCarryoverPool` 的 ① 步只遍历
 * `historicalGroups`（`:114` / `:162`），当前周期未花完的额度要等它关闭才进池。
 *
 * 因此序列里：
 * - `points[i]` = **第 i 个周期开始时**的池余额（历史周期贡献已计入）；
 * - 最后一点默认只到"当前周期开始"为止，**不含当前周期的超支借用** ——
 *   因为借用要等 `currentModuleViews` 才能算。
 *
 * ## 为什么要传 `currentModuleViews`
 *
 * 不传时，最后一点与 `computeCarryoverPool`（含当前超支）**可能不一致**：
 * 单周期超支的场景下，序列末点是 `0`（周期刚开始时池为空）而当前可用池是
 * `-150000`。图表据此画线、页面却显示 `-150000`，视觉上自相矛盾。
 *
 * 传入 `currentModuleViews` 后，末点会被替换为**截至此刻的可用池**（含当前周期
 * 各模块的超支借用），从而与 `computeCarryoverPool({… currentModuleViews})`
 * 严格相等。图表与预算页因此不会各说各话。
 *
 * 单周期且不传 `currentModuleViews` 时，序列就是 `[{periodStart, poolCents: 0}]`
 * ——这是"周期刚开始"的真实状态，不是 bug。
 */
export function computePoolTrend(
  input: Omit<ComputeCarryoverPoolInput, 'currentModuleViews'> & {
    readonly currentModuleViews?: readonly ModuleView[];
  },
): PoolTrendPoint[] {
  const cycle: CycleConfig = input.cycle ?? { kind: 'natural-month' };

  const live = liveAllocationsDesc(input.allocationsDesc);
  if (live.length === 0) return [];

  const groups = groupByCycle(live, cycle); // 最新在前

  // ② 无现役周期期间的消费（发生在最早周期起点之前）——一次性计入起点。
  const oldest = live[live.length - 1];
  if (oldest === undefined) return [];
  const earliestStart =
    cycle.kind === 'natural-month'
      ? dateOnly(oldest.date)
      : periodStartOf(cycle.day, oldest.date);

  let pool = 0;
  for (const txn of input.transactions) {
    if (
      txn.type === TYPE_EXPENSE &&
      txn.deleted !== true &&
      dateOnly(txn.date) < earliestStart
    ) {
      pool -= expenseContribution(txn);
    }
  }

  // 反转为"最旧 → 最新"，便于按时间顺序累加。
  const oldestFirst = groups.slice().reverse();
  const points: PoolTrendPoint[] = [];
  const lastIndex = oldestFirst.length - 1;

  for (let i = 0; i <= lastIndex; i += 1) {
    const group = oldestFirst[i];
    if (group === undefined) continue;
    const anchor = group.allocations[0];
    if (anchor === undefined) continue;

    const start =
      cycle.kind === 'natural-month'
        ? group.start
        : periodStartOf(cycle.day, anchor.date);

    // 先记录"本周期开始时"的池余额。
    points.push({ periodStart: start, poolCents: pool });

    // 当前（最新）周期的分配不进池 —— 它尚未关闭。
    if (i === lastIndex) continue;

    // ① 历史周期贡献：窗口 = [本周期起点, 下一周期起点)。
    const next = oldestFirst[i + 1];
    let end: number | null = null;
    if (next !== undefined) {
      const nextAnchor = next.allocations[0];
      end =
        cycle.kind === 'natural-month'
          ? next.start
          : nextAnchor === undefined
            ? null
            : periodStartOf(cycle.day, nextAnchor.date);
    }

    for (const module of mergeModules(group.allocations)) {
      const spentInPeriod = spentBetween(
        input.transactions,
        module.categoryId,
        start,
        end,
      );
      pool += module.amountCents - spentInPeriod;
    }
  }

  // Replace the last point with the pool as it stands NOW (including the current
  // cycle's borrowing), so the series ends where `computeCarryoverPool` says it does.
  // Without this, a single overspent cycle would plot a flat 0 while the headline
  // showed a negative pool.
  if (input.currentModuleViews !== undefined && points.length > 0) {
    let current = pool;
    for (const view of input.currentModuleViews) {
      if (view.spentCents > view.budgetCents) {
        current -= view.spentCents - view.budgetCents;
      }
    }
    const lastIndexInPoints = points.length - 1;
    const last = points[lastIndexInPoints];
    if (last !== undefined) {
      points[lastIndexInPoints] = { periodStart: last.periodStart, poolCents: current };
    }
  }

  return points;
}

// ---------------------------------------------------------------------------
// 便捷导出
// ---------------------------------------------------------------------------

/** 工具：把分转换为元的显示字符串（保留两位小数，无浮点残留）。 */
export function formatCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const yuan = Math.floor(abs / 100);
  const fraction = (abs % 100).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${yuan}.${fraction}`;
}

/** 工具：元字符串转分（必须 `Math.round`，见父任务 AC6）。 */
export function parseYuanToCents(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return null;
  // 关键：浮点乘法后必须取整。`19.99 * 100 === 1998.9999999999998`
  const cents = Math.round(value * 100);
  return cents > 0 ? cents : null;
}

export { daysInMonth, monthKey, periodStartOf, nextPeriodStart, cycleStartOf };
