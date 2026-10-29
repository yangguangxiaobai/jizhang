import { describe, expect, it } from 'vitest';
import {
  computeBudgetProjection,
  computeCarryoverPool,
  computeModuleViews,
  computePoolTrend,
  listCycleStarts,
} from '../src/budget-engine.js';
import type { BudgetAllocation, CycleConfig, Transaction } from '../src/types.js';

const at = (month: number, day: number): number => new Date(2026, month - 1, day).getTime();
const salary = (date: number, amountCents: number): BudgetAllocation => ({
  id: `allocation-${date}`,
  salaryRecordId: `salary-${date}`,
  date,
  allocations: [{ categoryId: 'food', amountCents }],
});
const expense = (
  date: number,
  amountCents: number,
  extra: Partial<Transaction> = {},
): Transaction => ({
  id: `transaction-${date}-${amountCents}`,
  type: 0,
  categoryId: 'transport',
  date,
  amountCents,
  ...extra,
});

describe('hierarchical budget modules', () => {
  it('rolls child allocations and spending into the parent pool with child actuals', () => {
    const parentByCategoryId = new Map([
      ['housing', 'life'],
      ['utilities', 'life'],
    ]);
    const views = computeModuleViews({
      parentByCategoryId,
      allocationsDesc: [
        {
          id: 'allocation-life',
          salaryRecordId: 'salary-life',
          date: at(9, 5),
          allocations: [{ categoryId: 'housing', amountCents: 100_000 }],
        },
      ],
      transactions: [
        expense(at(9, 6), 12_000, { categoryId: 'housing' }),
        expense(at(9, 7), 8_000, { categoryId: 'utilities' }),
      ],
    });

    expect(views).toEqual([
      {
        categoryId: 'life',
        budgetCents: 100_000,
        spentCents: 20_000,
        remainingCents: 80_000,
        children: [
          { categoryId: 'housing', spentCents: 12_000 },
          { categoryId: 'utilities', spentCents: 8_000 },
        ],
      },
    ]);
  });
});
describe('every expense remains visible even outside the salary template', () => {
  it('exposes a zero-budget module and borrows its spending from the pool', () => {
    const input = {
      allocationsDesc: [salary(at(9, 5), 1_000_000)],
      transactions: [expense(at(9, 6), 50_000)],
    };
    const views = computeModuleViews(input);
    expect(views).toContainEqual({
      categoryId: 'transport',
      budgetCents: 0,
      spentCents: 50_000,
      remainingCents: -50_000,
    });
    expect(views.reduce((sum, view) => sum + view.spentCents, 0)).toBe(50_000);
    expect(computeCarryoverPool({ ...input, currentModuleViews: views })).toBe(-50_000);
  });

  it('refunds are income: they leave unbudgeted spending gross instead of reducing it', () => {
    const input = {
      allocationsDesc: [salary(at(9, 5), 100_000)],
      transactions: [
        expense(at(9, 6), 50_000),
        expense(at(9, 7), 20_000, { isRefund: true, type: 1 }),
      ],
    };
    const views = computeModuleViews(input);
    expect(views.find((view) => view.categoryId === 'transport')?.spentCents).toBe(50_000);
    expect(computeCarryoverPool({ ...input, currentModuleViews: views })).toBe(-50_000);
  });

  it('editing into a funded category and deleting do not leave a phantom module', () => {
    const allocationsDesc = [salary(at(9, 5), 100_000)];
    const edited = computeModuleViews({
      allocationsDesc,
      transactions: [expense(at(9, 6), 12_345, { categoryId: 'food' })],
    });
    expect(edited).toEqual([
      { categoryId: 'food', budgetCents: 100_000, spentCents: 12_345, remainingCents: 87_655 },
    ]);
    const deleted = computeModuleViews({
      allocationsDesc,
      transactions: [expense(at(9, 6), 12_345, { deleted: true })],
    });
    expect(deleted).toEqual([
      { categoryId: 'food', budgetCents: 100_000, spentCents: 0, remainingCents: 100_000 },
    ]);
  });

  it.each<CycleConfig>([{ kind: 'natural-month' }, { kind: 'start-day', day: 5 }])(
    'history, current modules and pool trend reconcile in %j mode',
    (cycle) => {
      const input = {
        cycle,
        allocationsDesc: [salary(at(9, 5), 200_000), salary(at(8, 5), 100_000)],
        // 退款是收入：不参与模块与池子的支出计算。
        transactions: [
          expense(at(8, 6), 10_000),
          expense(at(8, 7), 2_000, { isRefund: true, type: 1 }),
          expense(at(9, 5), 7_000),
        ],
      };
      const views = computeModuleViews(input);
      const history = computeModuleViews({ ...input, periodStart: at(8, 5) });
      expect(history.find((view) => view.categoryId === 'transport')?.spentCents).toBe(10_000);
      expect(views.find((view) => view.categoryId === 'transport')?.spentCents).toBe(7_000);
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
      transactions: [
        expense(at(9, 6), 5_000, { type: 1 }),
        expense(at(9, 7), 6_000, { deleted: true }),
        expense(at(10, 5), 7_000),
      ],
    });
    expect(views).toEqual([
      { categoryId: 'food', budgetCents: 100_000, spentCents: 0, remainingCents: 100_000 },
    ]);
  });

  it('keeps the no-salary onboarding state distinct from a zero-budget module', () => {
    expect(
      computeModuleViews({ allocationsDesc: [], transactions: [expense(at(9, 6), 50_000)] }),
    ).toEqual([]);
  });
});

describe('computeBudgetProjection 统一投影与上下文准备', () => {
  it('空分配时返回空周期列表与零值', () => {
    const projection = computeBudgetProjection({
      allocationsDesc: [],
      transactions: [expense(at(9, 6), 50_000)],
    });
    expect(projection).toEqual({
      periodsAsc: [],
      selectedPeriodStart: null,
      modules: [],
      carryoverPoolCents: 0,
      poolTrend: [],
    });
  });

  it('同月两份工资合并、以最早工资日为起点、无新工资时最新周期无上界', () => {
    const allocations = [
      salary(at(9, 20), 200_000),
      salary(at(9, 5), 100_000),
    ];
    const transactions = [
      expense(at(9, 6), 50_000, { categoryId: 'food' }),
      // 3个月后无新工资，依然落在最新自然月周期内
      expense(at(12, 10), 30_000, { categoryId: 'food' }),
    ];
    const projection = computeBudgetProjection({
      allocationsDesc: allocations,
      transactions,
    });

    expect(projection.periodsAsc).toEqual([at(9, 5)]);
    expect(projection.selectedPeriodStart).toBe(at(9, 5));
    expect(projection.modules).toEqual([
      { categoryId: 'food', budgetCents: 300_000, spentCents: 80_000, remainingCents: 220_000 },
    ]);
    expect(projection.carryoverPoolCents).toBe(0);
    expect(projection.poolTrend).toEqual([
      { periodStart: at(9, 5), poolCents: 0 },
    ]);
  });

  it('起始日 15 号跨月窗口与边界处理', () => {
    const cycle = { kind: 'start-day' as const, day: 15 };
    const allocations = [
      salary(at(9, 10), 200_000), // 9/10 发薪，周期为 9/15 - 10/14
      salary(at(8, 10), 100_000), // 8/10 发薪，周期为 8/15 - 9/14
    ];
    const transactions = [
      expense(at(8, 16), 20_000, { categoryId: 'food' }), // 8/15 周期内
      expense(at(9, 14), 10_000, { categoryId: 'food' }), // 8/15 周期内
      expense(at(9, 15), 30_000, { categoryId: 'food' }), // 9/15 周期内
      expense(at(10, 15), 99_000, { categoryId: 'food' }), // 10/15 超出 9/15 周期的 nextPeriodStart 边界
    ];

    const currentProj = computeBudgetProjection({
      allocationsDesc: allocations,
      transactions,
      cycle,
    });
    expect(currentProj.periodsAsc).toEqual([at(8, 15), at(9, 15)]);
    expect(currentProj.selectedPeriodStart).toBe(at(9, 15));
    expect(currentProj.modules).toEqual([
      { categoryId: 'food', budgetCents: 200_000, spentCents: 30_000, remainingCents: 170_000 },
    ]);
    // 8 月剩余 100000 - 30000 = 70000 进池
    expect(currentProj.carryoverPoolCents).toBe(70_000);

    const historyProj = computeBudgetProjection({
      allocationsDesc: allocations,
      transactions,
      cycle,
      periodStart: at(8, 15),
    });
    expect(historyProj.selectedPeriodStart).toBe(at(8, 15));
    expect(historyProj.modules).toEqual([
      { categoryId: 'food', budgetCents: 100_000, spentCents: 30_000, remainingCents: 70_000 },
    ]);
    expect(historyProj.carryoverPoolCents).toBe(0);
    // 趋势末点仍等于当前周期的可用池 70000
    expect(historyProj.poolTrend).toEqual([
      { periodStart: at(8, 15), poolCents: 0 },
      { periodStart: at(9, 15), poolCents: 70_000 },
    ]);
  });

  it('未预算分类、历史池累积与当前负池借用全面覆盖', () => {
    const allocations = [
      salary(at(8, 1), 100_000), // 当前周期
      salary(at(7, 1), 100_000), // 历史周期
    ];
    const transactions = [
      // 预算前消费（6 月）
      expense(at(6, 15), 10_000),
      // 7 月消费：food 40000 -> 剩余 60000
      { ...expense(at(7, 5), 40_000), categoryId: 'food' },
      // 8 月当前周期消费：food 120000（超支 20000）+ transport 50000（未配置分类超支 50000）
      { ...expense(at(8, 2), 120_000), categoryId: 'food' },
      expense(at(8, 3), 50_000),
    ];

    // 池计算推导：
    // 初始前消费：-10000
    // 7/1 开始时池：-10000
    // 7 月结束产生结余：100000 - 40000 = +60000
    // 8/1 开始时池：-10000 + 60000 = +50000
    // 8 月当前超支：food 20000 + transport 50000 = 70000 借用
    // 8 月当前可用池：50000 - 70000 = -20000（负池）
    const currentProj = computeBudgetProjection({
      allocationsDesc: allocations,
      transactions,
    });

    expect(currentProj.carryoverPoolCents).toBe(-20_000);
    expect(currentProj.poolTrend).toEqual([
      { periodStart: at(7, 1), poolCents: -10_000 },
      { periodStart: at(8, 1), poolCents: -20_000 },
    ]);
    const transportMod = currentProj.modules.find((m) => m.categoryId === 'transport');
    expect(transportMod).toEqual({
      categoryId: 'transport',
      budgetCents: 0,
      spentCents: 50_000,
      remainingCents: -50_000,
    });

    // 查看历史 7 月周期
    const histProj = computeBudgetProjection({
      allocationsDesc: allocations,
      transactions,
      periodStart: at(7, 1),
    });
    expect(histProj.selectedPeriodStart).toBe(at(7, 1));
    expect(histProj.carryoverPoolCents).toBe(-10_000); // 7 月开始时的池
    // 趋势末点仍使用当前 8 月超支得出的可用池 -20000，不可被 7 月覆盖！
    expect(histProj.poolTrend).toEqual([
      { periodStart: at(7, 1), poolCents: -10_000 },
      { periodStart: at(8, 1), poolCents: -20_000 },
    ]);
  });

  it('未知 periodStart 返回空模块与零历史池，保留完整周期与趋势', () => {
    const allocations = [salary(at(9, 5), 100_000)];
    const transactions = [expense(at(9, 6), 10_000, { categoryId: 'food' })];
    const projection = computeBudgetProjection({
      allocationsDesc: allocations,
      transactions,
      periodStart: at(2020, 1, 1),
    });

    expect(projection.periodsAsc).toEqual([at(9, 5)]);
    expect(projection.selectedPeriodStart).toBeNull();
    expect(projection.modules).toEqual([]);
    expect(projection.carryoverPoolCents).toBe(0);
    expect(projection.poolTrend).toEqual([
      { periodStart: at(9, 5), poolCents: 0 },
    ]);
  });

  it('与旧四个独立函数在当前与历史模式下结果完全一致', () => {
    const allocations = [
      salary(at(9, 1), 200_000),
      salary(at(8, 1), 100_000),
    ];
    const transactions = [
      expense(at(7, 15), 5_000),
      { ...expense(at(8, 10), 30_000), categoryId: 'food' },
      { ...expense(at(9, 5), 250_000), categoryId: 'food' },
      expense(at(9, 6), 20_000),
    ];
    const input = {
      allocationsDesc: allocations,
      transactions,
    };

    const proj = computeBudgetProjection(input);

    const legacyStarts = listCycleStarts(allocations);
    expect(proj.periodsAsc).toEqual(legacyStarts);

    const legacyCurrentViews = computeModuleViews(input);
    expect(proj.modules).toEqual(legacyCurrentViews);

    const legacyCurrentPool = computeCarryoverPool({
      ...input,
      currentModuleViews: legacyCurrentViews,
    });
    expect(proj.carryoverPoolCents).toBe(legacyCurrentPool);

    const legacyTrend = computePoolTrend({
      ...input,
      currentModuleViews: legacyCurrentViews,
    });
    expect(proj.poolTrend).toEqual(legacyTrend);

    // 历史周期核对
    const histProj = computeBudgetProjection({ ...input, periodStart: at(8, 1) });
    const legacyHistViews = computeModuleViews({ ...input, periodStart: at(8, 1) });
    expect(histProj.modules).toEqual(legacyHistViews);
    const expectedHistPool = legacyTrend.find((p) => p.periodStart === at(8, 1))!.poolCents;
    expect(histProj.carryoverPoolCents).toBe(expectedHistPool);
    expect(histProj.poolTrend).toEqual(legacyTrend);
  });
});
