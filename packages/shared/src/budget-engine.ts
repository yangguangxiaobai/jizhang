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
 * ## 支出口径（毛支出）
 *
 * `spent` 累加的是 `expenseContribution`。退款是收入型账单（`type === 1`），
 * 其支出贡献为 0，不再冲减支出；模块消费保持毛额。
 */

import {
  BudgetContext,
  computeBudgetProjection,
  groupByCycle,
  liveAllocationsDesc,
  type BudgetProjection,
  type ComputeBudgetProjectionInput,
  type PoolTrendPoint,
} from './budget-context.js';
import {
  allocationPeriodStart,
  cycleStartOf,
  dateOnly,
  daysInMonth,
  monthKey,
  nextPeriodStart,
  periodStartOf,
} from './date-utils.js';
import type {
  BudgetAllocation,
  CategoryParentMap,
  CycleConfig,
  ModuleView,
  Transaction,
} from './types.js';

export {
  BudgetContext,
  computeBudgetProjection,
  type BudgetProjection,
  type ComputeBudgetProjectionInput,
  type PoolTrendPoint,
};

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
  const start = allocationPeriodStart(cycle.day, anchor.date);
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
  /**
   * 要报告的周期，用与 `PoolTrendPoint.periodStart` **相同**的标识:分组自身的
   * `group.start`(自然月模式 = 该月**最早的工资日**,不是 1 号;起始日模式 = 配置边界)。
   *
   * 省略 = 最新周期,这是所有既有调用方依赖的行为,**不得改变**。
   * 未知的 start 返回 `[]`;路由层会先校验,所以 `[]` 在这里始终意味着"没有有效分配"。
   */
  readonly periodStart?: number;
  /** Optional child-to-parent projection; omitted preserves flat-category behavior. */
  readonly parentByCategoryId?: CategoryParentMap;
}

/**
 * 计算预算周期的模块视图。
 *
 * 默认报告**最新**周期;传入 `periodStart` 可报告任意一个历史周期,使用完全相同的规则。
 *
 * 空分配 → 返回空数组(参考 `:37`)。
 * 参考 `computeModuleViews`,`:32-91`。
 */
export function computeModuleViews(input: ComputeModuleViewsInput): ModuleView[] {
  const context = new BudgetContext({
    allocationsDesc: input.allocationsDesc,
    transactions: input.transactions,
    cycle: input.cycle,
    parentByCategoryId: input.parentByCategoryId,
  });
  if (input.periodStart === undefined) {
    return context.getModuleViews(0);
  }
  const target = dateOnly(input.periodStart);
  const index = context.groups.findIndex((g) => g.start === target);
  if (index === -1) return [];
  return context.getModuleViews(index);
}

// ---------------------------------------------------------------------------
// listCycleStarts
// ---------------------------------------------------------------------------

/**
 * 所有有效周期的起点,**升序** —— "存在哪些周期"的权威答案。
 *
 * 用于填充周期选择器,以及校验请求的 `periodStart`。
 *
 * 与引擎其余部分共用同一个 `groupByCycle`,因此**不可能**与
 * `computePoolTrend(...).map((p) => p.periodStart)` 不一致(有单测断言这一点)。
 * 这正是它值得存在、而不是让路由自己去推导的原因。
 */
export function listCycleStarts(
  allocationsDesc: readonly BudgetAllocation[],
  cycle: CycleConfig = { kind: 'natural-month' },
): number[] {
  const context = new BudgetContext({
    allocationsDesc,
    transactions: [],
    cycle,
  });
  return [...context.periodsAsc];
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
  /** Optional child-to-parent projection; omitted preserves flat-category behavior. */
  readonly parentByCategoryId?: CategoryParentMap;
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
export function computeCarryoverPool(input: ComputeCarryoverPoolInput): number {
  const context = new BudgetContext({
    allocationsDesc: input.allocationsDesc,
    transactions: input.transactions,
    cycle: input.cycle,
    parentByCategoryId: input.parentByCategoryId,
  });
  return context.getCarryoverPool(input.currentModuleViews);
}

// ---------------------------------------------------------------------------
// 结余池历史序列（供 T8 图表使用）
// ---------------------------------------------------------------------------

/**
 * 结余池随周期演进的序列（按周期起点**升序**）。
 */
export function computePoolTrend(
  input: Omit<ComputeCarryoverPoolInput, 'currentModuleViews'> & {
    readonly currentModuleViews?: readonly ModuleView[];
  },
): PoolTrendPoint[] {
  const context = new BudgetContext({
    allocationsDesc: input.allocationsDesc,
    transactions: input.transactions,
    cycle: input.cycle,
    parentByCategoryId: input.parentByCategoryId,
  });
  return context.getPoolTrend(input.currentModuleViews);
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

export {
  daysInMonth,
  monthKey,
  periodStartOf,
  allocationPeriodStart,
  nextPeriodStart,
  cycleStartOf,
};
