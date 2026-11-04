/**
 * 手动存钱与投资进度（C4 / F08+F09）纯函数测试。
 *
 * 钉住四件容易在后续改动里被“顺手修坏”的事：
 *
 * 1. **余额只由确认记录决定**（C4-01/C4-02）：起始值 + 存入 − 取出，
 *    与账本、工资、转账、账户余额毫无关系；没有新记录时余额不随时间增长。
 * 2. **整段历史必须逐步非负**（C4-04/C4-05）：合计为正不代表中途没取空。
 * 3. **期间净额可以为负，且边界是半开区间**：相邻月份既不重复也不漏月末。
 * 4. **目标/缺口/条件次数在缺基线或缺参考时返回 null**（C4-03），绝不猜。
 *
 * 金额一律直接用**分**。
 */
import { describe, expect, it } from 'vitest';

import {
  compareManualGoalEntries,
  computeReserveProgress,
  manualGoalBalanceAsOf,
  manualGoalEntryFlowCents,
  manualGoalPeriodTotals,
  manualGoalTotals,
  orderManualGoalEntries,
  replayManualGoalHistory,
  requireCents,
  requireEpochMs,
  requireManualGoalNote,
  type ManualGoalEntryFact,
} from '../src/manual-goal-progress.js';

const DAY = 86_400_000;
const OPENING_AT = Date.UTC(2026, 0, 1); // 2026-01-01T00:00:00Z

function entry(
  id: string,
  kind: 'deposit' | 'withdrawal',
  amountCents: number,
  dayOffset: number,
  options: { goal?: 'reserve' | 'investment'; createdAt?: number } = {},
): ManualGoalEntryFact {
  return {
    id,
    goal: options.goal ?? 'reserve',
    kind,
    amountCents,
    date: OPENING_AT + dayOffset * DAY,
    createdAt: options.createdAt ?? OPENING_AT + dayOffset * DAY,
  };
}

describe('balance as of a moment', () => {
  it('adds deposits and subtracts withdrawals on top of the opening (C4-01)', () => {
    const entries = [entry('d1', 'deposit', 1500, 10), entry('w1', 'withdrawal', 1000, 20)];
    expect(
      manualGoalBalanceAsOf({
        openingCents: 12000,
        entries,
        asOf: OPENING_AT + 30 * DAY,
      }),
    ).toBe(12500);
  });

  it('tracks investment principal without inventing a return (C4-02)', () => {
    const entries = [
      entry('i1', 'deposit', 2500, 5, { goal: 'investment' }),
      entry('i2', 'withdrawal', 1000, 15, { goal: 'investment' }),
    ];
    expect(
      manualGoalBalanceAsOf({
        openingCents: 5000,
        entries,
        asOf: OPENING_AT + 40 * DAY,
      }),
    ).toBe(6500);
  });

  it('ignores entries after asOf, so progress does not grow without a new record', () => {
    const entries = [entry('d1', 'deposit', 1500, 10), entry('future', 'deposit', 9999, 90)];
    const asOf = OPENING_AT + 30 * DAY;
    expect(manualGoalBalanceAsOf({ openingCents: 12000, entries, asOf })).toBe(13500);
    expect(
      manualGoalBalanceAsOf({ openingCents: 12000, entries, asOf: OPENING_AT + 120 * DAY }),
    ).toBe(23499);
  });

  it('leaves the opening alone when there are no entries', () => {
    expect(manualGoalBalanceAsOf({ openingCents: 0, entries: [], asOf: OPENING_AT })).toBe(0);
    expect(manualGoalBalanceAsOf({ openingCents: 700, entries: [], asOf: OPENING_AT })).toBe(700);
  });

  it('rejects non-integer cents instead of rounding', () => {
    expect(() =>
      manualGoalBalanceAsOf({ openingCents: 12.5, entries: [], asOf: OPENING_AT }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_MONEY' }));
    expect(() =>
      manualGoalBalanceAsOf({
        openingCents: 0,
        entries: [{ ...entry('d', 'deposit', 100, 1), amountCents: 100.5 }],
        asOf: OPENING_AT + 5 * DAY,
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_MONEY' }));
  });
});

describe('period net additions', () => {
  it('sums by [from, to) and can be negative', () => {
    const entries = [
      entry('before', 'deposit', 700, -1), // 2025-12-31 — outside
      entry('d1', 'deposit', 1500, 0), // exactly from — inside
      entry('w1', 'withdrawal', 2000, 15),
      entry('d2', 'deposit', 300, 31), // exactly to — outside
    ];
    const totals = manualGoalPeriodTotals({
      entries,
      from: OPENING_AT,
      to: OPENING_AT + 31 * DAY,
    });
    expect(totals).toEqual({
      from: OPENING_AT,
      to: OPENING_AT + 31 * DAY,
      depositCents: 1500,
      withdrawalCents: 2000,
      netCents: -500,
      entryCount: 2,
    });
  });

  it('keeps adjacent months from double counting a month-end record', () => {
    const entries = [entry('w', 'withdrawal', 1000, 30)]; // the last instant of "month" 1
    const january = manualGoalPeriodTotals({
      entries,
      from: OPENING_AT,
      to: OPENING_AT + 31 * DAY,
    });
    const february = manualGoalPeriodTotals({
      entries,
      from: OPENING_AT + 31 * DAY,
      to: OPENING_AT + 59 * DAY,
    });
    expect(january.netCents).toBe(-1000);
    expect(february.netCents).toBe(0);
  });

  it('rejects an empty or inverted range', () => {
    expect(() => manualGoalPeriodTotals({ entries: [], from: 10, to: 10 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_RANGE' }),
    );
    expect(() => manualGoalPeriodTotals({ entries: [], from: 20, to: 10 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_RANGE' }),
    );
  });

  it('reports lifetime totals with a signed net', () => {
    const entries = [
      entry('d1', 'deposit', 1500, 1),
      entry('w1', 'withdrawal', 500, 2),
      entry('w2', 'withdrawal', 200, 3),
    ];
    expect(manualGoalTotals(entries)).toEqual({
      depositCents: 1500,
      withdrawalCents: 700,
      netCents: 800,
      entryCount: 3,
    });
    expect(manualGoalEntryFlowCents(entries[0]!)).toBe(1500);
    expect(manualGoalEntryFlowCents(entries[1]!)).toBe(-500);
  });
});

describe('full-history replay', () => {
  it('accepts a funded history and reports every step', () => {
    const history = replayManualGoalHistory({
      openingCents: 12000,
      openingAt: OPENING_AT,
      entries: [entry('d1', 'deposit', 1500, 10), entry('w1', 'withdrawal', 1000, 20)],
    });
    expect(history.balanceCents).toBe(12500);
    expect(history.minimumBalanceCents).toBe(12000);
    expect(history.steps.map((step) => step.balanceCents)).toEqual([13500, 12500]);
  });

  it('rejects a withdrawal that is unfunded at its own step even when the total is positive', () => {
    // 12000 opening, but the withdrawal comes before the only deposit.
    const entries = [entry('w1', 'withdrawal', 13000, 5), entry('d1', 'deposit', 5000, 10)];
    expect(() =>
      replayManualGoalHistory({ openingCents: 12000, openingAt: OPENING_AT, entries }),
    ).toThrowError(expect.objectContaining({ code: 'HISTORY_UNFUNDED' }));
  });

  it('rejects an entry dated before the confirmed opening', () => {
    expect(() =>
      replayManualGoalHistory({
        openingCents: 100,
        openingAt: OPENING_AT,
        entries: [{ ...entry('early', 'deposit', 100, -1), date: OPENING_AT - 1 }],
      }),
    ).toThrowError(expect.objectContaining({ code: 'ENTRY_BEFORE_OPENING' }));
  });

  it('orders same-day deposits before withdrawals', () => {
    const sameDayDeposit = entry('d-same', 'deposit', 1000, 3, { createdAt: OPENING_AT + 3 * DAY + 5000 });
    const sameDayWithdrawal = entry('w-same', 'withdrawal', 1000, 3, {
      createdAt: OPENING_AT + 3 * DAY + 1000,
    });
    expect(compareManualGoalEntries(sameDayWithdrawal, sameDayDeposit)).toBeGreaterThan(0);
    const history = replayManualGoalHistory({
      openingCents: 0,
      openingAt: OPENING_AT,
      entries: [sameDayWithdrawal, sameDayDeposit],
    });
    expect(history.balanceCents).toBe(0);
    expect(orderManualGoalEntries([sameDayWithdrawal, sameDayDeposit])[0]?.id).toBe('d-same');
  });

  it('rejects mixed goals instead of silently adding them together', () => {
    expect(() =>
      replayManualGoalHistory({
        openingCents: 1000,
        openingAt: OPENING_AT,
        entries: [
          entry('r', 'deposit', 100, 1),
          entry('i', 'deposit', 100, 2, { goal: 'investment' }),
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_GOAL' }));
  });

  it('rejects non-positive amounts and non-integer dates', () => {
    expect(() =>
      replayManualGoalHistory({
        openingCents: 1000,
        openingAt: OPENING_AT,
        entries: [entry('zero', 'deposit', 0, 1)],
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_MONEY' }));
    expect(() =>
      replayManualGoalHistory({
        openingCents: 1000,
        openingAt: OPENING_AT,
        entries: [{ ...entry('float', 'deposit', 10, 1), date: OPENING_AT + 0.5 }],
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_DATE' }));
  });
});

describe('reserve target and progress', () => {
  it('computes target 25000, 48%, gap 13000 and 9 conditional contributions (C4-03)', () => {
    const progress = computeReserveProgress({
      balanceCents: 12000,
      essentialMonthlyCents: 5000,
      targetMonths: 5,
      monthlyReferenceCents: 1500,
    });
    expect(progress).toEqual({
      targetState: 'ready',
      targetCents: 25000,
      progressBasisPoints: 4800,
      progressPercent: 48,
      gapCents: 13000,
      surplusCents: 0,
      conditionalContributionCount: 9,
    });
  });

  it('returns null target/gap/ETA when the necessary baseline is missing', () => {
    expect(
      computeReserveProgress({
        balanceCents: 12000,
        essentialMonthlyCents: null,
        targetMonths: 5,
        monthlyReferenceCents: 1500,
      }),
    ).toEqual({
      targetState: 'no-baseline',
      targetCents: null,
      progressBasisPoints: null,
      progressPercent: null,
      gapCents: null,
      surplusCents: null,
      conditionalContributionCount: null,
    });
  });

  it('keeps the target but refuses to guess a count when the monthly reference is zero', () => {
    const progress = computeReserveProgress({
      balanceCents: 12000,
      essentialMonthlyCents: 5000,
      targetMonths: 5,
      monthlyReferenceCents: 0,
    });
    expect(progress.targetCents).toBe(25000);
    expect(progress.gapCents).toBe(13000);
    expect(progress.conditionalContributionCount).toBeNull();
  });

  it('caps progress at 100% and reports the surplus when the target is reached', () => {
    const progress = computeReserveProgress({
      balanceCents: 30000,
      essentialMonthlyCents: 5000,
      targetMonths: 5,
      monthlyReferenceCents: 1500,
    });
    expect(progress.progressBasisPoints).toBe(10000);
    expect(progress.progressPercent).toBe(100);
    expect(progress.gapCents).toBe(0);
    expect(progress.surplusCents).toBe(5000);
    expect(progress.conditionalContributionCount).toBe(0);
  });

  it('floors the percentage instead of rounding up', () => {
    const progress = computeReserveProgress({
      balanceCents: 1,
      essentialMonthlyCents: 3,
      targetMonths: 1,
      monthlyReferenceCents: null,
    });
    expect(progress.progressBasisPoints).toBe(3333);
    expect(progress.progressPercent).toBe(33);
    expect(progress.conditionalContributionCount).toBeNull();
  });

  it('rejects a negative balance, an out-of-range target and a non-integer reference', () => {
    expect(() =>
      computeReserveProgress({
        balanceCents: -1,
        essentialMonthlyCents: 5000,
        targetMonths: 5,
        monthlyReferenceCents: 1500,
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_MONEY' }));
    expect(() =>
      computeReserveProgress({
        balanceCents: 0,
        essentialMonthlyCents: 5000,
        targetMonths: 121,
        monthlyReferenceCents: 1500,
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_RANGE' }));
    expect(() =>
      computeReserveProgress({
        balanceCents: 0,
        essentialMonthlyCents: 5000,
        targetMonths: 5,
        monthlyReferenceCents: 15.5,
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_MONEY' }));
  });
});

describe('value guards', () => {
  it('accepts integer cents at the boundary and rejects floats/strings/negatives', () => {
    expect(requireCents(0, 'amountCents')).toBe(0);
    expect(requireCents(Number.MAX_SAFE_INTEGER, 'amountCents')).toBe(Number.MAX_SAFE_INTEGER);
    for (const bad of [-1, 1.5, '10', Number.NaN, Number.POSITIVE_INFINITY, null]) {
      expect(() => requireCents(bad, 'amountCents')).toThrowError(
        expect.objectContaining({ code: 'INVALID_MONEY' }),
      );
    }
  });

  it('accepts epoch milliseconds and rejects fractional or negative values', () => {
    expect(requireEpochMs(0, 'date')).toBe(0);
    expect(() => requireEpochMs(1.5, 'date')).toThrowError(
      expect.objectContaining({ code: 'INVALID_DATE' }),
    );
    expect(() => requireEpochMs(-1, 'date')).toThrowError(
      expect.objectContaining({ code: 'INVALID_DATE' }),
    );
  });

  it('trims notes, defaults them to empty and enforces the length limit', () => {
    expect(requireManualGoalNote(undefined)).toBe('');
    expect(requireManualGoalNote('  工资后存入  ')).toBe('工资后存入');
    expect(() => requireManualGoalNote('x'.repeat(501))).toThrowError(
      expect.objectContaining({ code: 'INVALID_NOTE' }),
    );
  });
});
