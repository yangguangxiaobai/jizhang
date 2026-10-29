/**
 * Budget context and projection — single-pass preparation for module views,
 * cycle periods, and carryover pool trends.
 */
import {
  allocationPeriodStart,
  dateOnly,
  inCycle,
  monthKey,
  nextPeriodStart,
} from './date-utils.js';
import {
  expenseContribution,
  makeModuleView,
  topLevelCategoryId,
  TYPE_EXPENSE,
  type BudgetAllocation,
  type CategoryParentMap,
  type CycleConfig,
  type ModuleAllocation,
  type ModuleView,
  type Transaction,
} from './types.js';

export interface PeriodGroup {
  readonly start: number;
  readonly allocations: readonly BudgetAllocation[];
}

export interface PoolTrendPoint {
  readonly periodStart: number;
  readonly poolCents: number;
}

export interface ComputeBudgetProjectionInput {
  readonly allocationsDesc: readonly BudgetAllocation[];
  readonly transactions: readonly Transaction[];
  readonly cycle?: CycleConfig;
  readonly periodStart?: number;
  readonly parentByCategoryId?: CategoryParentMap;
}

export interface BudgetProjection {
  readonly periodsAsc: number[];
  readonly selectedPeriodStart: number | null;
  readonly modules: ModuleView[];
  readonly carryoverPoolCents: number;
  readonly poolTrend: PoolTrendPoint[];
}

/** Active allocations (soft-deleted excluded), sorted by date DESC, updatedAt DESC. */
export function liveAllocationsDesc(
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

/** Earliest local date in group (cycle start). */
export function earliestDate(group: readonly BudgetAllocation[]): number {
  const first = group[0];
  if (first === undefined) return 0;
  let earliest = dateOnly(first.date);
  for (const a of group) {
    const day = dateOnly(a.date);
    if (day < earliest) earliest = day;
  }
  return earliest;
}

function groupByMonth(allocationsDesc: readonly BudgetAllocation[]): PeriodGroup[] {
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

function groupByPeriod(
  allocationsDesc: readonly BudgetAllocation[],
  startDay: number,
): PeriodGroup[] {
  const groups = new Map<number, BudgetAllocation[]>();
  for (const a of allocationsDesc) {
    const key = allocationPeriodStart(startDay, a.date);
    const bucket = groups.get(key);
    if (bucket) bucket.push(a);
    else groups.set(key, [a]);
  }
  const keys = [...groups.keys()].sort((a, b) => b - a);
  return keys.map((k) => ({ start: k, allocations: groups.get(k) ?? [] }));
}

export function groupByCycle(
  allocationsDesc: readonly BudgetAllocation[],
  cycle: CycleConfig,
): PeriodGroup[] {
  return cycle.kind === 'natural-month'
    ? groupByMonth(allocationsDesc)
    : groupByPeriod(allocationsDesc, cycle.day);
}

export function mergeModules(
  group: readonly BudgetAllocation[],
  parentByCategoryId?: CategoryParentMap,
): ModuleAllocation[] {
  const merged = new Map<string, number>();
  for (const a of group) {
    for (const m of a.allocations) {
      const moduleId = topLevelCategoryId(m.categoryId, parentByCategoryId);
      merged.set(moduleId, (merged.get(moduleId) ?? 0) + m.amountCents);
    }
  }
  return [...merged.entries()].map(([categoryId, amountCents]) => ({
    categoryId,
    amountCents,
  }));
}

export function moduleViewsInWindow(
  allocations: readonly BudgetAllocation[],
  transactions: readonly Transaction[],
  start: number,
  end: number | null,
  parentByCategoryId?: CategoryParentMap,
): ModuleView[] {
  const budgets = new Map(
    mergeModules(allocations, parentByCategoryId).map((m) => [m.categoryId, m.amountCents]),
  );
  const spent = new Map<string, number>();
  const childSpent =
    parentByCategoryId === undefined || parentByCategoryId.size === 0
      ? undefined
      : new Map<string, number>();

  for (const txn of transactions) {
    if (txn.deleted === true || txn.type !== TYPE_EXPENSE || !inCycle(txn.date, start, end)) {
      continue;
    }
    const moduleId = topLevelCategoryId(txn.categoryId, parentByCategoryId);
    if (!budgets.has(moduleId)) budgets.set(moduleId, 0);
    spent.set(moduleId, (spent.get(moduleId) ?? 0) + expenseContribution(txn));
    if (childSpent !== undefined && txn.categoryId !== moduleId) {
      childSpent.set(
        txn.categoryId,
        (childSpent.get(txn.categoryId) ?? 0) + expenseContribution(txn),
      );
    }
  }

  return [...budgets].map(([categoryId, budgetCents]) => {
    const view = makeModuleView(categoryId, budgetCents, spent.get(categoryId) ?? 0);
    if (childSpent === undefined) return view;
    return {
      ...view,
      children: [...childSpent.entries()]
        .filter(([childId]) => topLevelCategoryId(childId, parentByCategoryId) === categoryId)
        .map(([childId, spentCents]) => ({ categoryId: childId, spentCents })),
    };
  });
}

export class BudgetContext {
  readonly cycle: CycleConfig;
  readonly liveAllocations: readonly BudgetAllocation[];
  readonly groups: readonly PeriodGroup[];
  readonly periodsAsc: readonly number[];
  private readonly transactions: readonly Transaction[];
  private readonly parentByCategoryId?: CategoryParentMap;

  private readonly groupViewsCache = new Map<number, ModuleView[]>();
  private trendStartPoints: PoolTrendPoint[] | null = null;
  private unadjustedCurrentPool: number | null = null;

  constructor(input: {
    readonly allocationsDesc: readonly BudgetAllocation[];
    readonly transactions: readonly Transaction[];
    readonly cycle?: CycleConfig;
    readonly parentByCategoryId?: CategoryParentMap;
  }) {
    this.cycle = input.cycle ?? { kind: 'natural-month' };
    this.transactions = input.transactions;
    this.parentByCategoryId = input.parentByCategoryId;
    this.liveAllocations = liveAllocationsDesc(input.allocationsDesc);
    this.groups = groupByCycle(this.liveAllocations, this.cycle);
    this.periodsAsc = this.groups.map((g) => g.start).reverse();
  }

  get hasBudget(): boolean {
    return this.groups.length > 0;
  }

  getModuleViews(groupIndex: number): ModuleView[] {
    const cached = this.groupViewsCache.get(groupIndex);
    if (cached !== undefined) return cached;

    const group = this.groups[groupIndex];
    if (group === undefined) return [];

    const start = group.start;
    const end =
      groupIndex > 0
        ? (this.groups[groupIndex - 1]?.start ?? null)
        : this.cycle.kind === 'natural-month'
          ? null
          : nextPeriodStart(this.cycle.day, start);

    const views = moduleViewsInWindow(
      group.allocations,
      this.transactions,
      start,
      end,
      this.parentByCategoryId,
    );
    this.groupViewsCache.set(groupIndex, views);
    return views;
  }

  private prepareTrendPoints(): {
    readonly points: PoolTrendPoint[];
    readonly unadjustedCurrentPool: number;
  } {
    if (this.trendStartPoints !== null && this.unadjustedCurrentPool !== null) {
      return {
        points: this.trendStartPoints,
        unadjustedCurrentPool: this.unadjustedCurrentPool,
      };
    }

    if (this.groups.length === 0) {
      this.trendStartPoints = [];
      this.unadjustedCurrentPool = 0;
      return { points: [], unadjustedCurrentPool: 0 };
    }

    const oldest = this.liveAllocations[this.liveAllocations.length - 1]!;
    const earliestStart =
      this.cycle.kind === 'natural-month'
        ? dateOnly(oldest.date)
        : allocationPeriodStart(this.cycle.day, oldest.date);

    let pool = 0;
    for (const txn of this.transactions) {
      if (txn.type === TYPE_EXPENSE && txn.deleted !== true && dateOnly(txn.date) < earliestStart) {
        pool -= expenseContribution(txn);
      }
    }

    const oldestFirst = this.groups.slice().reverse();
    const points: PoolTrendPoint[] = [];
    const lastIndex = oldestFirst.length - 1;

    for (let i = 0; i <= lastIndex; i++) {
      const group = oldestFirst[i]!;
      const anchor = group.allocations[0];
      if (anchor === undefined) continue;

      const start =
        this.cycle.kind === 'natural-month'
          ? group.start
          : allocationPeriodStart(this.cycle.day, anchor.date);

      points.push({ periodStart: start, poolCents: pool });

      if (i === lastIndex) continue;

      const groupIndexInGroups = lastIndex - i;
      const views = this.getModuleViews(groupIndexInGroups);
      for (const view of views) {
        pool += view.remainingCents;
      }
    }

    this.trendStartPoints = points;
    this.unadjustedCurrentPool = pool;
    return { points, unadjustedCurrentPool: pool };
  }

  getPoolTrend(currentModuleViewsOverride?: readonly ModuleView[]): PoolTrendPoint[] {
    const { points, unadjustedCurrentPool } = this.prepareTrendPoints();
    if (points.length === 0) return [];

    if (currentModuleViewsOverride === undefined) {
      return points.map((p) => ({ ...p }));
    }

    let current = unadjustedCurrentPool;
    for (const view of currentModuleViewsOverride) {
      if (view.spentCents > view.budgetCents) {
        current -= view.spentCents - view.budgetCents;
      }
    }

    const result = points.map((p) => ({ ...p }));
    const lastIndex = result.length - 1;
    const last = result[lastIndex];
    if (last !== undefined) {
      result[lastIndex] = { periodStart: last.periodStart, poolCents: current };
    }
    return result;
  }

  getCarryoverPool(currentModuleViewsOverride?: readonly ModuleView[]): number {
    if (this.groups.length === 0) return 0;
    const { unadjustedCurrentPool } = this.prepareTrendPoints();
    if (currentModuleViewsOverride === undefined) {
      return unadjustedCurrentPool;
    }
    let pool = unadjustedCurrentPool;
    for (const view of currentModuleViewsOverride) {
      if (view.spentCents > view.budgetCents) {
        pool -= view.spentCents - view.budgetCents;
      }
    }
    return pool;
  }

  getCurrentAvailablePool(): number {
    if (this.groups.length === 0) return 0;
    const { unadjustedCurrentPool } = this.prepareTrendPoints();
    let pool = unadjustedCurrentPool;
    const latestViews = this.getModuleViews(0);
    for (const view of latestViews) {
      if (view.spentCents > view.budgetCents) {
        pool -= view.spentCents - view.budgetCents;
      }
    }
    return pool;
  }

  getPoolAtPeriodStart(periodStart: number): number {
    const { points } = this.prepareTrendPoints();
    return points.find((p) => p.periodStart === periodStart)?.poolCents ?? 0;
  }

  getProjection(requestedPeriodStart?: number): BudgetProjection {
    if (this.groups.length === 0) {
      return {
        periodsAsc: [],
        selectedPeriodStart: null,
        modules: [],
        carryoverPoolCents: 0,
        poolTrend: [],
      };
    }

    const currentStart = this.groups[0]!.start;
    const currentPool = this.getCurrentAvailablePool();
    const poolTrend = this.getPoolTrend(this.getModuleViews(0)); // ending at current available pool
    const periodsAsc = [...this.periodsAsc];

    if (requestedPeriodStart === undefined) {
      return {
        periodsAsc,
        selectedPeriodStart: currentStart,
        modules: this.getModuleViews(0),
        carryoverPoolCents: currentPool,
        poolTrend,
      };
    }

    const target = dateOnly(requestedPeriodStart);
    const index = this.groups.findIndex((g) => g.start === target);
    if (index === -1) {
      return {
        periodsAsc,
        selectedPeriodStart: null,
        modules: [],
        carryoverPoolCents: 0,
        poolTrend,
      };
    }

    if (index === 0) {
      return {
        periodsAsc,
        selectedPeriodStart: currentStart,
        modules: this.getModuleViews(0),
        carryoverPoolCents: currentPool,
        poolTrend,
      };
    }

    const historicalStart = this.groups[index]!.start;
    const historicalPool = this.getPoolAtPeriodStart(historicalStart);

    return {
      periodsAsc,
      selectedPeriodStart: historicalStart,
      modules: this.getModuleViews(index),
      carryoverPoolCents: historicalPool,
      poolTrend,
    };
  }
}

export function computeBudgetProjection(
  input: ComputeBudgetProjectionInput,
): BudgetProjection {
  const context = new BudgetContext({
    allocationsDesc: input.allocationsDesc,
    transactions: input.transactions,
    cycle: input.cycle,
    parentByCategoryId: input.parentByCategoryId,
  });
  return context.getProjection(input.periodStart);
}
