/**
 * 月计划汇总的共享算术规格(C2 / 验收 C2-01、C2-02、C2-04、C2-06)。
 *
 * 钉死四类容易写错的东西:
 *
 * 1. **消费预算 = 必要 + 随心**,不是总收入;工资 10000 分时预算 6000 分(C2-01)。
 * 2. **已消费 = 确认净额**,超支是负数剩余而不是 0(C2-02 的反面)。
 * 3. **待核对不发布精确剩余**:`isExact=false` → `remainingCents === null`,
 *    但预算与已消费仍是已确认事实,照常返回(C2-06)。
 * 4. **整数分**:小数、负数、非安全整数、溢出全部拒绝,绝不静默取整。
 */
import { describe, expect, it } from 'vitest';

import { FinancialExecutionInputError } from '../src/financial-execution.js';
import {
  computeMonthlyPlanSummary,
  type MonthlyPlanSummaryInput,
} from '../src/monthly-plan.js';

/** 一组合法输入;每个用例只覆盖自己关心的字段。 */
function input(overrides: Partial<MonthlyPlanSummaryInput> = {}): MonthlyPlanSummaryInput {
  return {
    essentialsBudgetCents: 5_000,
    joyBudgetCents: 1_000,
    essentialsNetCents: 0,
    joyNetCents: 0,
    isExact: true,
    ...overrides,
  };
}

function expectCode(fn: () => unknown, code: 'INVALID_MONEY' | 'OVERFLOW'): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(FinancialExecutionInputError);
    expect((error as FinancialExecutionInputError).code).toBe(code);
    return;
  }
  throw new Error('expected computeMonthlyPlanSummary to throw');
}

describe('computeMonthlyPlanSummary', () => {
  it('uses essentials + joy as the consumption budget (salary 10000 -> 2500/1500/5000/1000)', () => {
    // C2-01:工资 10000 分的四用途目标里只有必要 5000 + 随心 1000 进入消费预算。
    const summary = computeMonthlyPlanSummary(input());
    expect(summary).toEqual({
      consumptionBudgetCents: 6_000,
      confirmedNetSpentCents: 0,
      remainingCents: 6_000,
      status: 'exact',
    });
  });

  it('subtracts confirmed net spending from the consumption budget (3200 + 600 -> 2200)', () => {
    // C2-02:必要 3200、随心 600 → 已消费 3800,合计剩余 2200。
    const summary = computeMonthlyPlanSummary(
      input({ essentialsNetCents: 3_200, joyNetCents: 600 }),
    );
    expect(summary).toEqual({
      consumptionBudgetCents: 6_000,
      confirmedNetSpentCents: 3_800,
      remainingCents: 2_200,
      status: 'exact',
    });
  });

  it('keeps net spending after attributed refunds, not gross (expense 100, refund 30 -> net 70)', () => {
    // C2-04:支出 100、归属退款 30 → 已消费 70,剩余 5930。
    const summary = computeMonthlyPlanSummary(input({ essentialsNetCents: 70 }));
    expect(summary.confirmedNetSpentCents).toBe(70);
    expect(summary.remainingCents).toBe(5_930);
  });

  it('allows a negative remaining amount instead of clamping overspending to zero', () => {
    const summary = computeMonthlyPlanSummary(
      input({ essentialsNetCents: 5_600, joyNetCents: 900 }),
    );
    expect(summary.confirmedNetSpentCents).toBe(6_500);
    expect(summary.remainingCents).toBe(-500);
    expect(summary.status).toBe('exact');
  });

  it('withholds an exact remaining amount when the execution is not exact', () => {
    // C2-06:待核对时不发布精确"还能花",但预算与已消费照常可见。
    const summary = computeMonthlyPlanSummary(
      input({ essentialsNetCents: 3_200, joyNetCents: 600, isExact: false }),
    );
    expect(summary).toEqual({
      consumptionBudgetCents: 6_000,
      confirmedNetSpentCents: 3_800,
      remainingCents: null,
      status: 'review-required',
    });
  });

  it('withholds the remaining amount even when it would have been negative', () => {
    const summary = computeMonthlyPlanSummary(
      input({ essentialsNetCents: 7_000, isExact: false }),
    );
    expect(summary.remainingCents).toBeNull();
    expect(summary.status).toBe('review-required');
  });

  it('handles zero budgets and zero spending', () => {
    const summary = computeMonthlyPlanSummary({
      essentialsBudgetCents: 0,
      joyBudgetCents: 0,
      essentialsNetCents: 0,
      joyNetCents: 0,
      isExact: true,
    });
    expect(summary).toEqual({
      consumptionBudgetCents: 0,
      confirmedNetSpentCents: 0,
      remainingCents: 0,
      status: 'exact',
    });
  });

  it('sums exact integer cents without floating point drift', () => {
    const summary = computeMonthlyPlanSummary({
      essentialsBudgetCents: 123_457,
      joyBudgetCents: 76_543,
      essentialsNetCents: 19_999,
      joyNetCents: 80_001,
      isExact: true,
    });
    expect(summary.consumptionBudgetCents).toBe(200_000);
    expect(summary.confirmedNetSpentCents).toBe(100_000);
    expect(summary.remainingCents).toBe(100_000);
  });

  it('ignores unknown extra keys', () => {
    const summary = computeMonthlyPlanSummary({
      ...input(),
      legacyEnvelopeCents: 999_999,
    } as MonthlyPlanSummaryInput);
    expect(summary.consumptionBudgetCents).toBe(6_000);
  });
});

describe('computeMonthlyPlanSummary validation', () => {
  const moneyFields = [
    'essentialsBudgetCents',
    'joyBudgetCents',
    'essentialsNetCents',
    'joyNetCents',
  ] as const;

  it.each(moneyFields)('rejects a negative %s', (field) => {
    expectCode(
      () => computeMonthlyPlanSummary(input({ [field]: -1 } as Partial<MonthlyPlanSummaryInput>)),
      'INVALID_MONEY',
    );
  });

  it.each(moneyFields)('rejects a fractional %s', (field) => {
    expectCode(
      () => computeMonthlyPlanSummary(input({ [field]: 1.5 } as Partial<MonthlyPlanSummaryInput>)),
      'INVALID_MONEY',
    );
  });

  it.each(moneyFields)('rejects a non-numeric %s', (field) => {
    expectCode(
      () =>
        computeMonthlyPlanSummary(
          input({ [field]: '100' as unknown as number } as Partial<MonthlyPlanSummaryInput>),
        ),
      'INVALID_MONEY',
    );
  });

  it.each(moneyFields)('rejects NaN / Infinity / unsafe %s', (field) => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 2]) {
      expectCode(
        () =>
          computeMonthlyPlanSummary(
            input({ [field]: value } as Partial<MonthlyPlanSummaryInput>),
          ),
        'INVALID_MONEY',
      );
    }
  });

  it('rejects a non-boolean isExact', () => {
    expectCode(
      () => computeMonthlyPlanSummary(input({ isExact: 'yes' as unknown as boolean })),
      'INVALID_MONEY',
    );
  });

  it('rejects a null / array / primitive input', () => {
    for (const value of [null, [], 42, 'summary'] as unknown[]) {
      expectCode(
        () => computeMonthlyPlanSummary(value as unknown as MonthlyPlanSummaryInput),
        'INVALID_MONEY',
      );
    }
  });

  it('refuses to overflow the safe integer range when summing budgets', () => {
    expectCode(
      () =>
        computeMonthlyPlanSummary(
          input({
            essentialsBudgetCents: Number.MAX_SAFE_INTEGER,
            joyBudgetCents: 1,
          }),
        ),
      'OVERFLOW',
    );
  });

  it('does not echo private amounts in the error message', () => {
    try {
      computeMonthlyPlanSummary(input({ essentialsNetCents: -987_654 }));
      throw new Error('expected a throw');
    } catch (error) {
      expect(error).toBeInstanceOf(FinancialExecutionInputError);
      expect((error as Error).message).not.toContain('987654');
    }
  });
});
