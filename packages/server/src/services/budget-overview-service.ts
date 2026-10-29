/**
 * Server-owned budget overview projection.
 *
 * The budget route and AI evaluation both need the same envelope-engine result. Keeping
 * the read-only projection here prevents a second caller from re-implementing the
 * cycle, module, or carryover rules in a route or feature service.
 */
import {
  NATURAL_MONTH,
  computeBudgetProjection,
  dateOnly,
  listCycleStarts,
  type BudgetAllocation,
  type CycleConfig,
  type Transaction,
} from '@jizhang/shared';
import type { Db } from '../db/index.js';
import { mapLedgerTransactionRow, type LedgerTransactionRow } from './ledger-row-mapping.js';
import {
  SalaryService,
  parseAllocationsJson,
} from './salary-service.js';
import { ValidationError } from './transaction-errors.js';

export interface BudgetOverviewModuleChild {
  readonly categoryId: string;
  readonly categoryName: string;
  readonly spentCents: number;
}

export interface BudgetOverviewModule {
  readonly categoryId: string;
  readonly categoryName: string;
  readonly budgetCents: number;
  readonly spentCents: number;
  readonly remainingCents: number;
  readonly children?: readonly BudgetOverviewModuleChild[];
}

export interface BudgetOverviewResult {
  readonly cycle: CycleConfig;
  readonly modules: readonly BudgetOverviewModule[];
  readonly carryoverPoolCents: number;
  readonly totalBudgetCents: number;
  readonly totalSpentCents: number;
  readonly hasBudget: boolean;
}

export interface BudgetPeriodsResult {
  readonly periods: readonly number[];
  readonly currentPeriodStart: number | null;
  readonly cycle: CycleConfig;
}

export interface BudgetOverviewServiceOptions {
  readonly now?: () => number;
}

export class BudgetOverviewService {
  private readonly db: Db;
  private readonly salaries: SalaryService;

  constructor(db: Db, options: BudgetOverviewServiceOptions = {}) {
    this.db = db;
    this.salaries = new SalaryService(db, options);
  }

  /** Reads every live allocation, newest first, in the engine's input shape. */
  private loadAllocations(): BudgetAllocation[] {
    const rows = this.db
      .prepare(
        'SELECT id, salary_record_id, date, allocations_json FROM budget_allocations WHERE deleted = 0 ORDER BY date DESC, updated_at DESC',
      )
      .all() as {
      id: string;
      salary_record_id: string;
      date: number;
      allocations_json: string;
    }[];

    return rows.map((row) => ({
      id: row.id,
      salaryRecordId: row.salary_record_id,
      date: row.date,
      allocations: parseAllocationsJson(row.allocations_json),
    }));
  }

  /** Reads every live transaction in the shared engine's input shape. */
  private loadTransactions(): Transaction[] {
    const rows = this.db
      .prepare(
        'SELECT id, type, amount_cents, category_id, date, is_refund FROM transactions WHERE deleted = 0',
      )
      .all() as LedgerTransactionRow[];

    return rows.map(mapLedgerTransactionRow);
  }

  private loadCategoryHierarchy(): {
    readonly parentByCategoryId: Map<string, string>;
    readonly names: Map<string, string>;
    readonly childrenByParent: Map<string, string[]>;
  } {
    const parentByCategoryId = new Map<string, string>();
    const names = new Map<string, string>();
    const childrenByParent = new Map<string, string[]>();
    const rows = this.db.prepare('SELECT id, name, parent_id FROM categories').all() as {
      id: string;
      name: string;
      parent_id: string | null;
    }[];
    for (const row of rows) {
      names.set(row.id, row.name);
      if (row.parent_id === null) continue;
      parentByCategoryId.set(row.id, row.parent_id);
      const children = childrenByParent.get(row.parent_id) ?? [];
      children.push(row.id);
      childrenByParent.set(row.parent_id, children);
    }
    return { parentByCategoryId, names, childrenByParent };
  }

  private cycleConfig(): CycleConfig {
    const day = this.salaries.getCycleStartDay();
    return day === undefined ? NATURAL_MONTH : { kind: 'start-day', day };
  }

  /** Current or explicitly selected budget cycle, using the shared engine only. */
  overview(periodStart?: number): BudgetOverviewResult {
    const allocations = this.loadAllocations();
    const transactions = this.loadTransactions();
    const hierarchy = this.loadCategoryHierarchy();
    const cycle = this.cycleConfig();

    const target = periodStart === undefined ? undefined : dateOnly(periodStart);
    if (target !== undefined && !listCycleStarts(allocations, cycle).includes(target)) {
      throw new ValidationError('Unknown budget period.');
    }

    const projection = computeBudgetProjection({
      allocationsDesc: allocations,
      transactions,
      cycle,
      ...(target === undefined ? {} : { periodStart: target }),
      parentByCategoryId: hierarchy.parentByCategoryId,
    });

    const modules = projection.modules
      .map((view) => {
        const childIds = hierarchy.childrenByParent.get(view.categoryId) ?? [];
        const { children: childViews, ...baseView } = view;
        const spentByChild = new Map(
          (childViews ?? []).map((child) => [child.categoryId, child.spentCents]),
        );
        return {
          ...baseView,
          categoryName: hierarchy.names.get(view.categoryId) ?? view.categoryId,
          ...(childIds.length === 0
            ? {}
            : {
                children: childIds.map((categoryId) => ({
                  categoryId,
                  categoryName: hierarchy.names.get(categoryId) ?? categoryId,
                  spentCents: spentByChild.get(categoryId) ?? 0,
                })),
              }),
        };
      })
      .sort((a, b) => b.budgetCents - a.budgetCents);
    const totalBudget = projection.modules.reduce((sum, view) => sum + view.budgetCents, 0);
    const totalSpent = projection.modules.reduce((sum, view) => sum + view.spentCents, 0);

    return {
      cycle,
      modules,
      carryoverPoolCents: projection.carryoverPoolCents,
      totalBudgetCents: totalBudget,
      totalSpentCents: totalSpent,
      hasBudget: projection.modules.length > 0,
    };
  }

  periods(): BudgetPeriodsResult {
    const cycle = this.cycleConfig();
    const periods = listCycleStarts(this.loadAllocations(), cycle);
    return {
      periods,
      currentPeriodStart: periods[periods.length - 1] ?? null,
      cycle,
    };
  }
}
