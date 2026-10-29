/**
 * Statistics service: category share, monthly trend, and the carryover-pool series.
 *
 * ## The one rule that matters
 *
 * Every aggregate goes through the shared `expenseContribution` /
 * `incomeContribution` helpers. A refund is an INCOME-typed row (revised model —
 * it counts as income and no longer reduces expenses), so:
 *
 *   - "spend" figures are gross and never negative;
 *   - income figures include refunds.
 *
 * Re-deriving that here — even "just for the chart" — is exactly how the numbers on
 * the charts page would drift away from the budget page.
 *
 * ## The pool-series contract
 *
 * `poolTrend` must end at the same value `computeCarryoverPool` returns, so it calls
 * the engine rather than re-walking the ledger. The reference project pins this with
 * a test (`charts_data_test.dart:416`); so does `test/stats.test.ts`.
 */
import {
  FALLBACK_CATEGORY_COLOR,
  NATURAL_MONTH,
  computeBudgetProjection,
  expenseContribution,
  incomeContribution,
  type BudgetAllocation,
  type CycleConfig,
  type Transaction,
} from '@jizhang/shared';
import type { Db } from '../db/index.js';
import { mapLedgerTransactionRow, type LedgerTransactionRow } from './ledger-row-mapping.js';
import { parseAllocationsJson, SalaryService } from './salary-service.js';
import { ValidationError } from './transaction-errors.js';

export interface CategoryShareItem {
  readonly categoryId: string;
  readonly categoryName: string;
  readonly color: number;
  /** Gross expense in cents; historical name kept for wire compatibility. */
  readonly amountCents: number;
  /** Share of the expense total, 0..1 (0 when the total is 0). */
  readonly ratio: number;
}

export interface CategoryShareResult {
  readonly items: CategoryShareItem[];
  readonly totalCents: number;
  readonly from: number;
  readonly to: number;
}

export interface MonthlyTrendPoint {
  /** `YYYY-MM` in local time, for the axis label. */
  readonly month: string;
  readonly monthStart: number;
  readonly incomeCents: number;
  /** Gross expense in cents; historical name kept for wire compatibility. */
  readonly netExpenseCents: number;
}

export interface PoolTrendPointDto {
  readonly periodStart: number;
  readonly poolCents: number;
}

export interface StatsServiceOptions {
  readonly now?: () => number;
}

/**
 * Local `YYYY-MM` label for an epoch-ms instant.
 *
 * Note the explicit `(year, monthIndex)` calls below: `new Date(x)` with a SINGLE
 * argument is an epoch, but with TWO arguments it is `(year, monthIndex)`. Passing a
 * single offset to the two-argument form is a real bug that was hit here
 * (`new Date(0)` is 1970 in both readings, but `new Date(0, 0)` means January 1970
 * as well — while `new Date(0, -2)` silently means November of year 0). Keeping two
 * clearly-named helpers prevents that confusion.
 */
function monthLabel(epochMs: number): string {
  const date = new Date(epochMs);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** First instant of the month containing `epochMs`, local time. */
function startOfMonthOf(epochMs: number): number {
  const date = new Date(epochMs);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

/** First instant of the month `offset` months from `epochMs` (offset may be negative). */
function monthStartOffset(epochMs: number, offset: number): number {
  const date = new Date(epochMs);
  return new Date(date.getFullYear(), date.getMonth() + offset, 1).getTime();
}

export class StatsService {
  private readonly db: Db;
  private readonly now: () => number;

  constructor(db: Db, options: StatsServiceOptions = {}) {
    this.db = db;
    this.now = options.now ?? (() => Date.now());
  }

  /** Live transactions in the shared engine's input shape. */
  private loadTransactions(from?: number, to?: number): Transaction[] {
    const where: string[] = ['deleted = 0'];
    const params: number[] = [];
    if (from !== undefined) {
      where.push('date >= ?');
      params.push(from);
    }
    if (to !== undefined) {
      where.push('date < ?');
      params.push(to);
    }

    const rows = this.db
      .prepare(
        `SELECT id, type, amount_cents, category_id, date, is_refund
           FROM transactions
          WHERE ${where.join(' AND ')}
          ORDER BY date`,
      )
      .all(...params) as LedgerTransactionRow[];

    return rows.map(mapLedgerTransactionRow);
  }

  private categoryParentMap(): Map<string, string> {
    const parents = new Map<string, string>();
    for (const row of this.db
      .prepare('SELECT id, parent_id FROM categories WHERE parent_id IS NOT NULL')
      .all() as { id: string; parent_id: string }[]) {
      parents.set(row.id, row.parent_id);
    }
    return parents;
  }
  private categoryMeta(): Map<string, { name: string; color: number }> {
    const map = new Map<string, { name: string; color: number }>();
    // Include soft-deleted categories: a historical transaction must still be
    // labelled, exactly as the budget page does.
    for (const row of this.db.prepare('SELECT id, name, color FROM categories').all() as {
      id: string;
      name: string;
      color: number;
    }[]) {
      map.set(row.id, { name: row.name, color: row.color });
    }
    return map;
  }

  /**
   * Per-category net expense over `[from, to)`.
   *
   * Sorted by amount descending so the chart legend reads largest-first. Categories
   * with a zero net amount are dropped only when they had no activity at all —
   * a category whose refunds exactly cancelled its spending is still reported, so
   * the chart can show that it netted to zero.
   */
  categoryShare(from: number, to: number): CategoryShareResult {
    if (!(from < to)) {
      throw new ValidationError('from must be earlier than to.');
    }

    const transactions = this.loadTransactions(from, to);
    const totals = new Map<string, number>();
    const touched = new Set<string>();

    for (const txn of transactions) {
      if (txn.type !== 0) continue;
      touched.add(txn.categoryId);
      totals.set(txn.categoryId, (totals.get(txn.categoryId) ?? 0) + expenseContribution(txn));
    }

    const meta = this.categoryMeta();
    const totalCents = [...totals.values()].reduce((sum, value) => sum + value, 0);

    const items: CategoryShareItem[] = [...touched]
      .map((categoryId) => {
        const amountCents = totals.get(categoryId) ?? 0;
        const info = meta.get(categoryId);
        return {
          categoryId,
          categoryName: info?.name ?? categoryId,
          // A hard-deleted category still has transactions; it renders in the "other" slot.
          color: info?.color ?? FALLBACK_CATEGORY_COLOR,
          amountCents,
          ratio: totalCents === 0 ? 0 : amountCents / totalCents,
        };
      })
      // Largest spend first; ties broken by name so the order is stable.
      .sort(
        (a, b) => b.amountCents - a.amountCents || a.categoryName.localeCompare(b.categoryName),
      );

    return { items, totalCents, from, to };
  }

  /**
   * Income and net expense per month for the last `months` months, ending with the
   * current one.
   *
   * Months with no activity are included with zeros — a gap in the axis would make
   * the chart lie about continuity.
   *
   * Income is **transactions plus salary records**. Salaries live in their own table
   * (they carry an allocation snapshot rather than a category), so aggregating the
   * ledger alone reported an income of 0 for a month whose only income was a recorded
   * salary. Every screen that shows "income" must agree, and the home dashboard reads
   * this same method, so the rule lives here rather than being patched per screen.
   *
   * Deliberately NOT folded into `categoryShare`: a salary has no category, and
   * inventing one would misreport the composition of spending. If you are looking at
   * `categoryShare` and wondering why salary income is missing, that is this comment.
   */
  monthlyTrend(months = 6): MonthlyTrendPoint[] {
    const safeMonths = Math.min(Math.max(Math.trunc(months), 1), 36);
    const anchor = this.now();

    const buckets = new Map<number, { income: number; expense: number }>();
    const starts: number[] = [];
    for (let offset = safeMonths - 1; offset >= 0; offset -= 1) {
      const start = monthStartOffset(anchor, -offset);
      starts.push(start);
      buckets.set(start, { income: 0, expense: 0 });
    }

    const firstStart = starts[0] as number;
    const lastStart = starts[starts.length - 1] as number;
    const end = monthStartOffset(lastStart, 1);

    for (const txn of this.loadTransactions(firstStart, end)) {
      const key = startOfMonthOf(txn.date);
      const bucket = buckets.get(key);
      if (bucket === undefined) continue;
      bucket.income += incomeContribution(txn);
      bucket.expense += expenseContribution(txn);
    }

    // Salaries are bucketed by the same `startOfMonthOf` as transactions. Using
    // `monthStartOffset` here would read the salary's date as an OFFSET instead of an
    // instant and scatter every salary — that helper is for computing a window edge,
    // not for assigning one row to its month.
    for (const salary of this.salaries().listInWindow(firstStart, end)) {
      const bucket = buckets.get(startOfMonthOf(salary.date));
      if (bucket === undefined) continue;
      bucket.income += salary.amountCents;
    }

    return starts.map((start) => {
      const bucket = buckets.get(start) ?? { income: 0, expense: 0 };
      return {
        month: monthLabel(start),
        monthStart: start,
        incomeCents: bucket.income,
        netExpenseCents: bucket.expense,
      };
    });
  }

  /** The salary service, sharing this service's injected clock. */
  private salaries(): SalaryService {
    return new SalaryService(this.db, { now: this.now });
  }

  private cycleConfig(): CycleConfig {
    // Reuse the salary service's settings reader so the cycle definition has exactly
    // one implementation.
    const day = this.salaries().getCycleStartDay();
    return day === undefined ? NATURAL_MONTH : { kind: 'start-day', day };
  }

  private loadAllocations(): BudgetAllocation[] {
    const rows = this.db
      .prepare(
        `SELECT id, salary_record_id, date, allocations_json
           FROM budget_allocations
          WHERE deleted = 0
          ORDER BY date DESC, updated_at DESC`,
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

  /**
   * The carryover pool over time, plus the engine's current value.
   *
   * `current` is computed by `computeCarryoverPool` — the same call the budget page
   * makes — and is asserted equal to the last series point in tests. Keeping both in
   * one response makes that contract checkable from the client too.
   */
  poolTrend(): {
    points: PoolTrendPointDto[];
    currentCents: number;
    cycle: CycleConfig;
  } {
    const allocations = this.loadAllocations();
    const transactions = this.loadTransactions();
    const cycle = this.cycleConfig();
    const parentByCategoryId = this.categoryParentMap();

    const projection = computeBudgetProjection({
      allocationsDesc: allocations,
      transactions,
      cycle,
      parentByCategoryId,
    });

    return { points: projection.poolTrend, currentCents: projection.carryoverPoolCents, cycle };
  }

  /** Months available for the range picker: the range that has any activity. */
  availableRange(): { earliest: number | null; latest: number | null } {
    const row = this.db
      .prepare(
        'SELECT MIN(date) AS minDate, MAX(date) AS maxDate FROM transactions WHERE deleted = 0',
      )
      .get() as { minDate: number | null; maxDate: number | null };
    return { earliest: row.minDate, latest: row.maxDate };
  }
}

export { startOfMonthOf, monthLabel, monthStartOffset };
