import { describe, expect, it } from 'vitest';
import {
  computeCarryoverPool,
  computeModuleViews,
  computePoolTrend,
} from '../src/budget-engine.js';
import type { BudgetAllocation, CycleConfig, Transaction } from '../src/types.js';

const at = (month: number, day: number): number => new Date(2026, month - 1, day).getTime();
const salary = (date: number, amountCents: number): BudgetAllocation => ({
  id: `allocation-${date}`,
  salaryRecordId: `salary-${date}`,
  date,
  allocations: [{ categoryId: 'food', amountCents }],
});
const expense = (date: number, amountCents: number, extra: Partial<Transaction> = {}): Transaction => ({
  id: `transaction-${date}-${amountCents}`,
  type: 0,
  categoryId: 'transport',
  date,
  amountCents,
  ...extra,
});

describe('every expense remains visible even outside the salary template', () => {
  it('exposes a zero-budget module and borrows its spending from the pool', () => {
    const input = { allocationsDesc: [salary(at(9, 5), 1_000_000)], transactions: [expense(at(9, 6), 50_000)] };
    const views = computeModuleViews(input);
    expect(views).toContainEqual({ categoryId: 'transport', budgetCents: 0, spentCents: 50_000, remainingCents: -50_000 });
    expect(views.reduce((sum, view) => sum + view.spentCents, 0)).toBe(50_000);
    expect(computeCarryoverPool({ ...input, currentModuleViews: views })).toBe(-50_000);
  });

  it('refunds are income: they leave unbudgeted spending gross instead of reducing it', () => {
    const input = {
      allocationsDesc: [salary(at(9, 5), 100_000)],
      transactions: [expense(at(9, 6), 50_000), expense(at(9, 7), 20_000, { isRefund: true, type: 1 })],
    };
    const views = computeModuleViews(input);
    expect(views.find(view => view.categoryId === 'transport')?.spentCents).toBe(50_000);
    expect(computeCarryoverPool({ ...input, currentModuleViews: views })).toBe(-50_000);
  });

  it('editing into a funded category and deleting do not leave a phantom module', () => {
    const allocationsDesc = [salary(at(9, 5), 100_000)];
    const edited = computeModuleViews({ allocationsDesc, transactions: [expense(at(9, 6), 12_345, { categoryId: 'food' })] });
    expect(edited).toEqual([{ categoryId: 'food', budgetCents: 100_000, spentCents: 12_345, remainingCents: 87_655 }]);
    const deleted = computeModuleViews({ allocationsDesc, transactions: [expense(at(9, 6), 12_345, { deleted: true })] });
    expect(deleted).toEqual([{ categoryId: 'food', budgetCents: 100_000, spentCents: 0, remainingCents: 100_000 }]);
  });

  it.each<CycleConfig>([{ kind: 'natural-month' }, { kind: 'start-day', day: 5 }])(
    'history, current modules and pool trend reconcile in %j mode',
    cycle => {
      const input = {
        cycle,
        allocationsDesc: [salary(at(9, 5), 200_000), salary(at(8, 5), 100_000)],
        // 退款是收入：不参与模块与池子的支出计算。
        transactions: [expense(at(8, 6), 10_000), expense(at(8, 7), 2_000, { isRefund: true, type: 1 }), expense(at(9, 5), 7_000)],
      };
      const views = computeModuleViews(input);
      const history = computeModuleViews({ ...input, periodStart: at(8, 5) });
      expect(history.find(view => view.categoryId === 'transport')?.spentCents).toBe(10_000);
      expect(views.find(view => view.categoryId === 'transport')?.spentCents).toBe(7_000);
      const pool = computeCarryoverPool({ ...input, currentModuleViews: views });
      expect(pool).toBe(83_000);
      expect(computePoolTrend({ ...input, currentModuleViews: views })).toEqual([
        { periodStart: at(8, 5), poolCents: 0 },
        { periodStart: at(9, 5), poolCents: 83_000 },
      ]);
    },
  );

  it('does not include income, deleted rows or future fixed-cycle spending', () => {
    const views = computeModuleViews({
      cycle: { kind: 'start-day', day: 5 },
      allocationsDesc: [salary(at(9, 5), 100_000)],
      transactions: [expense(at(9, 6), 5_000, { type: 1 }), expense(at(9, 7), 6_000, { deleted: true }), expense(at(10, 5), 7_000)],
    });
    expect(views).toEqual([{ categoryId: 'food', budgetCents: 100_000, spentCents: 0, remainingCents: 100_000 }]);
  });

  it('keeps the no-salary onboarding state distinct from a zero-budget module', () => {
    expect(computeModuleViews({ allocationsDesc: [], transactions: [expense(at(9, 6), 50_000)] })).toEqual([]);
  });
});
