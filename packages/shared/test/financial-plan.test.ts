/**
 * 四用途财务规划的共享算术规格(T14 PRD R2/R3/R4)。
 *
 * 钉死三类容易写错的东西:
 *
 * 1. **精确守恒**:四个用途之和必须等于收入,极小金额(1 分)也不能出现负数;
 * 2. **目标来自实际必要支出**,不是收入的 50%——改必要支出改目标,改收入不改目标;
 * 3. **投影是假想计划**:增长字段是累计投入而非资产余额,达标后仍按固定 15% 继续。
 */
import { describe, expect, it } from 'vitest';

import {
  FINANCIAL_PLAN_PROJECTION_MONTHS,
  FINANCIAL_PLAN_PURPOSES,
  FinancialPlanInputError,
  allocateFinancialPlanCents,
  computeFinancialPlanAnalysis,
  validateFinancialPlanInputs,
  type FinancialPlanWarning,
} from '../src/financial-plan.js';

/** 按用途取金额,避免测试里到处写数组下标。 */
function amountOf(
  analysis: ReturnType<typeof computeFinancialPlanAnalysis>,
  purpose: string,
): number {
  const found = analysis.allocations.find((a) => a.purpose === purpose);
  if (found === undefined) throw new Error(`no allocation for ${purpose}`);
  return found.amountCents;
}

function hasWarning(
  analysis: ReturnType<typeof computeFinancialPlanAnalysis>,
  warning: FinancialPlanWarning,
): boolean {
  return analysis.warnings.includes(warning);
}

// ---------------------------------------------------------------------------
// 分配:守恒、非负、极小金额、并列决胜
// ---------------------------------------------------------------------------

describe('allocateFinancialPlanCents', () => {
  it('splits the acceptance figure exactly', () => {
    // PRD 验收:10000 分 → 2500/1500/5000/1000。
    const allocations = allocateFinancialPlanCents(10000);
    expect(allocations.map((a) => a.purpose)).toEqual([
      'growth',
      'reserve',
      'essentials',
      'joy',
    ]);
    expect(allocations.map((a) => a.amountCents)).toEqual([2500, 1500, 5000, 1000]);
    expect(allocations.map((a) => a.percent)).toEqual([25, 15, 50, 10]);
  });

  it.each([1, 2, 3, 4, 5, 7, 99, 100, 101, 333, 999, 12345, 987654])(
    'conserves income exactly and never goes negative for %i cents',
    (income) => {
      const allocations = allocateFinancialPlanCents(income);
      const total = allocations.reduce((sum, a) => sum + a.amountCents, 0);
      expect(total).toBe(income);
      for (const allocation of allocations) {
        expect(allocation.amountCents).toBeGreaterThanOrEqual(0);
        expect(Number.isSafeInteger(allocation.amountCents)).toBe(true);
      }
    },
  );

  it('gives the single leftover cent to essentials for a 1-cent income', () => {
    // 100 分之 25/15/50/10 全部向下取整为 0,余数 25/15/50/10,最大是 essentials。
    // 这条用例钉死"并列决胜按固定顺序、余数优先",而不是让最后一个模块吸收。
    const allocations = allocateFinancialPlanCents(1);
    expect(allocations.map((a) => a.amountCents)).toEqual([0, 0, 1, 0]);
  });

  it('breaks a remainder tie by the fixed purpose order', () => {
    // 收入 2:每项 base 为 0,余数仍是 25/15/50/10,剩 2 分给 essentials 与 growth(25 并列第二)。
    const allocations = allocateFinancialPlanCents(2);
    const amountOfPurpose = (purpose: string): number =>
      allocations.find((a) => a.purpose === purpose)?.amountCents ?? -1;
    expect(amountOfPurpose('essentials')).toBe(1);
    expect(amountOfPurpose('growth')).toBe(1);
    expect(allocations.reduce((sum, a) => sum + a.amountCents, 0)).toBe(2);
  });

  it('keeps the declared purpose order and percent table stable', () => {
    expect(FINANCIAL_PLAN_PURPOSES.map((p) => p.purpose)).toEqual([
      'growth',
      'reserve',
      'essentials',
      'joy',
    ]);
    const sum = FINANCIAL_PLAN_PURPOSES.reduce((total, p) => total + p.percent, 0);
    expect(sum).toBe(100);
  });

  it('rejects non-positive and non-integer income', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '100']) {
      expect(() => allocateFinancialPlanCents(bad as number)).toThrow(FinancialPlanInputError);
    }
  });
});

// ---------------------------------------------------------------------------
// 输入校验
// ---------------------------------------------------------------------------

describe('validateFinancialPlanInputs', () => {
  it('accepts the three required fields and ignores extras', () => {
    expect(
      validateFinancialPlanInputs({
        monthlyIncomeCents: 1,
        essentialMonthlyCents: 1,
        reserveBalanceCents: 0,
        unexpected: 'ignored',
      }),
    ).toEqual({ monthlyIncomeCents: 1, essentialMonthlyCents: 1, reserveBalanceCents: 0 });
  });

  it('rejects a missing, null, array or non-object body', () => {
    for (const bad of [
      null,
      undefined,
      'body',
      42,
      [],
      {},
      { monthlyIncomeCents: 100, essentialMonthlyCents: 50 },
      { monthlyIncomeCents: 100, reserveBalanceCents: 0 },
    ]) {
      expect(() => validateFinancialPlanInputs(bad)).toThrow(FinancialPlanInputError);
    }
  });

  it('rejects unsafe, fractional and wrongly-signed numbers', () => {
    const base = { monthlyIncomeCents: 100, essentialMonthlyCents: 50, reserveBalanceCents: 0 };

    for (const bad of [
      { ...base, monthlyIncomeCents: 0 },
      { ...base, monthlyIncomeCents: -5 },
      { ...base, monthlyIncomeCents: 10.5 },
      { ...base, monthlyIncomeCents: Number.MAX_SAFE_INTEGER + 1 },
      { ...base, monthlyIncomeCents: '100' },
      { ...base, monthlyIncomeCents: null },
      { ...base, essentialMonthlyCents: 0 },
      { ...base, essentialMonthlyCents: -1 },
      { ...base, reserveBalanceCents: -1 },
      { ...base, reserveBalanceCents: 1.5 },
    ]) {
      expect(() => validateFinancialPlanInputs(bad)).toThrow(FinancialPlanInputError);
    }
  });

  it('does not echo the rejected value in the message (private financial data)', () => {
    try {
      validateFinancialPlanInputs({
        monthlyIncomeCents: '987654321',
        essentialMonthlyCents: 1,
        reserveBalanceCents: 0,
      });
      throw new Error('expected a FinancialPlanInputError');
    } catch (error) {
      expect(error).toBeInstanceOf(FinancialPlanInputError);
      expect((error as Error).message).not.toContain('987654321');
    }
  });
});

// ---------------------------------------------------------------------------
// 分析:验收数字、目标口径、缺口/盈余/进度/ETA
// ---------------------------------------------------------------------------

describe('computeFinancialPlanAnalysis — acceptance figure', () => {
  const analysis = computeFinancialPlanAnalysis({
    monthlyIncomeCents: 10000,
    essentialMonthlyCents: 5000,
    reserveBalanceCents: 0,
  });

  it('allocates 2500/1500/5000/1000', () => {
    expect(analysis.allocations.map((a) => a.amountCents)).toEqual([2500, 1500, 5000, 1000]);
    expect(analysis.ruleVersion).toBe(1);
  });

  it('takes the reserve target from essential costs × 5', () => {
    expect(analysis.reserveTargetCents).toBe(25000);
  });

  it('reports the gap, zero surplus and a percentage progress ratio', () => {
    expect(analysis.reserveGapCents).toBe(25000);
    expect(analysis.reserveSurplusCents).toBe(0);
    expect(analysis.reserveProgress).toBe(0);
    expect(analysis.targetReached).toBe(false);
  });

  it('estimates 17 months at 1500/month (ceil 25000/1500)', () => {
    // 16 个月到 24000,还差 1000 → 17。
    expect(analysis.monthsToTarget).toBe(17);
  });

  it('uses month 17 as the baseline the 12-month projection has not yet reached', () => {
    expect(analysis.projection).toHaveLength(12);
    const month12 = analysis.projection[11];
    expect(month12?.month).toBe(12);
    expect(month12?.reserveProjectedCents).toBe(18000);
    expect(month12?.targetReached).toBe(false);
    expect(month12?.reserveGapCents).toBe(7000);
  });

  it('exposes cumulative growth contributions, not an asset balance', () => {
    // 增长每月 2500,12 个月累计 30000 —— 这是"计划投入能力",没有任何收益。
    expect(analysis.projection[11]?.growthContributionsCents).toBe(30000);
    expect(analysis.projection[0]?.growthContributionsCents).toBe(2500);
  });
});

describe('computeFinancialPlanAnalysis — target depends on actual costs, not on income', () => {
  it('moves the target when essential costs change while income is fixed', () => {
    const cheap = computeFinancialPlanAnalysis({
      monthlyIncomeCents: 10000,
      essentialMonthlyCents: 2000,
      reserveBalanceCents: 0,
    });
    const dear = computeFinancialPlanAnalysis({
      monthlyIncomeCents: 10000,
      essentialMonthlyCents: 4000,
      reserveBalanceCents: 0,
    });
    expect(cheap.reserveTargetCents).toBe(10000);
    expect(dear.reserveTargetCents).toBe(20000);
    // 收入没变,分配一模一样。
    expect(cheap.allocations).toEqual(dear.allocations);
  });

  it('keeps the target fixed when income changes while essential costs are fixed', () => {
    const low = computeFinancialPlanAnalysis({
      monthlyIncomeCents: 4000,
      essentialMonthlyCents: 3000,
      reserveBalanceCents: 0,
    });
    const high = computeFinancialPlanAnalysis({
      monthlyIncomeCents: 9000,
      essentialMonthlyCents: 3000,
      reserveBalanceCents: 0,
    });
    expect(low.reserveTargetCents).toBe(15000);
    expect(high.reserveTargetCents).toBe(15000);
  });

  it('does not silently default a missing essentials figure to half the income', () => {
    expect(() =>
      computeFinancialPlanAnalysis({
        monthlyIncomeCents: 10000,
        reserveBalanceCents: 0,
      } as never),
    ).toThrow(FinancialPlanInputError);
  });
});

describe('computeFinancialPlanAnalysis — reserve progress', () => {
  it('is already met when the reserve equals the target', () => {
    const analysis = computeFinancialPlanAnalysis({
      monthlyIncomeCents: 10000,
      essentialMonthlyCents: 5000,
      reserveBalanceCents: 25000,
    });
    expect(analysis.targetReached).toBe(true);
    expect(analysis.reserveGapCents).toBe(0);
    expect(analysis.reserveSurplusCents).toBe(0);
    expect(analysis.reserveProgress).toBe(1);
    expect(analysis.monthsToTarget).toBe(0);
    expect(hasWarning(analysis, 'RESERVE_TARGET_REACHED')).toBe(true);
  });

  it('preserves a reserve above the target and clamps progress at 1', () => {
    const analysis = computeFinancialPlanAnalysis({
      monthlyIncomeCents: 10000,
      essentialMonthlyCents: 5000,
      reserveBalanceCents: 40000,
    });
    expect(analysis.targetReached).toBe(true);
    expect(analysis.reserveGapCents).toBe(0);
    expect(analysis.reserveSurplusCents).toBe(15000);
    expect(analysis.reserveProgress).toBe(1);
    expect(analysis.monthsToTarget).toBe(0);
    // 达标后固定 15% 只在假想投影里继续,多出来的部分标为 surplus。
    expect(analysis.projection[0]?.reserveProjectedCents).toBe(41500);
    expect(analysis.projection[0]?.reserveSurplusCents).toBe(16500);
    expect(analysis.projection[0]?.targetReached).toBe(true);
  });

  it('reports a fractional progress ratio without floating-point drift', () => {
    const analysis = computeFinancialPlanAnalysis({
      monthlyIncomeCents: 10000,
      essentialMonthlyCents: 5000,
      reserveBalanceCents: 5000,
    });
    expect(analysis.reserveProgress).toBe(0.2);
    expect(analysis.reserveGapCents).toBe(20000);
  });

  it('returns a null ETA when the monthly reserve contribution rounds to zero', () => {
    // 收入 3 分:essentials 拿 2,reserve 拿 0 → 无法估算月数。
    const analysis = computeFinancialPlanAnalysis({
      monthlyIncomeCents: 3,
      essentialMonthlyCents: 1,
      reserveBalanceCents: 0,
    });
    expect(amountOf(analysis, 'reserve')).toBe(0);
    expect(analysis.monthsToTarget).toBeNull();
    expect(hasWarning(analysis, 'RESERVE_CONTRIBUTION_ZERO')).toBe(true);
    // 投影仍然可用,只是储备一直不动。
    expect(analysis.projection[11]?.reserveProjectedCents).toBe(0);
  });

  it('accepts a valid plan whose ETA exceeds a 32-bit signed integer', () => {
    // 前端 DTO 必须用 Long 而不是 Int 承载 monthsToTarget:一个完全合法的计划可以有
    // 超过 2^31-1 的预估月数。
    //
    // 收入 7 分 → 25/15/50/10 向下取整得 2/1/3/1(余数 75/5/50/70,剩 2 分给 growth 与 joy),
    // 所以每月 reserve 贡献恒为 1 分。目标由实际必要支出决定:5 × 1e9 = 5e9。
    // ETA = ceil(5e9 / 1) = 5e9,远大于 Int 上限,但仍是安全的 JS 整数。
    const huge = computeFinancialPlanAnalysis({
      monthlyIncomeCents: 7,
      essentialMonthlyCents: 1_000_000_000,
      reserveBalanceCents: 0,
    });
    expect(amountOf(huge, 'reserve')).toBe(1);
    expect(huge.reserveTargetCents).toBe(5_000_000_000);
    expect(huge.monthsToTarget).toBe(5_000_000_000);
    expect(huge.monthsToTarget).toBeGreaterThan(2 ** 31 - 1);
    expect(Number.isSafeInteger(huge.monthsToTarget)).toBe(true);
    // 同一份计划里其余字段仍然小而精确。
    expect(huge.projection[11]?.reserveProjectedCents).toBe(12);
    expect(huge.projection[11]?.growthContributionsCents).toBe(24);
  });

  it('handles a 1-cent income without negative amounts', () => {    const analysis = computeFinancialPlanAnalysis({
      monthlyIncomeCents: 1,
      essentialMonthlyCents: 1,
      reserveBalanceCents: 0,
    });
    for (const allocation of analysis.allocations) {
      expect(allocation.amountCents).toBeGreaterThanOrEqual(0);
    }
    expect(analysis.allocations.reduce((sum, a) => sum + a.amountCents, 0)).toBe(1);
    expect(analysis.monthsToTarget).toBeNull();
  });

  it('reaches the target inside the projection when the contribution is large', () => {    const analysis = computeFinancialPlanAnalysis({
      monthlyIncomeCents: 100_000,
      essentialMonthlyCents: 10_000,
      reserveBalanceCents: 0,
    });
    // reserve = 15000/月,target = 50000 → 第 4 个月达标。
    expect(analysis.monthsToTarget).toBe(4);
    expect(analysis.projection[2]?.targetReached).toBe(false);
    expect(analysis.projection[3]?.targetReached).toBe(true);
    expect(analysis.projection[3]?.reserveGapCents).toBe(0);
    expect(analysis.projection[3]?.reserveSurplusCents).toBe(10000);
  });
});

// ---------------------------------------------------------------------------
// 提示:确定性、固定顺序
// ---------------------------------------------------------------------------

describe('computeFinancialPlanAnalysis — warnings', () => {
  it('flags essentials above half of income', () => {
    const analysis = computeFinancialPlanAnalysis({
      monthlyIncomeCents: 10000,
      essentialMonthlyCents: 6000,
      reserveBalanceCents: 0,
    });
    expect(hasWarning(analysis, 'ESSENTIALS_OVER_HALF')).toBe(true);
    // 6000 的 50% 分配是 5000,缺口 1000。
    expect(analysis.essentialShortfallCents).toBe(1000);
    // 收入仍然覆盖必要支出,所以不是"不可负担"。
    expect(hasWarning(analysis, 'ESSENTIALS_EXCEED_INCOME')).toBe(false);
    expect(analysis.monthlyDeficitCents).toBe(0);
  });

  it('flags essentials beyond total income as not affordable, with no negative fields', () => {
    const analysis = computeFinancialPlanAnalysis({
      monthlyIncomeCents: 10000,
      essentialMonthlyCents: 12000,
      reserveBalanceCents: 0,
    });
    expect(hasWarning(analysis, 'ESSENTIALS_EXCEED_INCOME')).toBe(true);
    expect(analysis.monthlyDeficitCents).toBe(2000);
    // 必要支出高于收入一半,因此两条提示同时成立。
    expect(hasWarning(analysis, 'ESSENTIALS_OVER_HALF')).toBe(true);
    // 分配额 5000 < 12000,缺口 7000;不能出现负缺口。
    expect(analysis.essentialShortfallCents).toBe(7000);
    expect(analysis.monthlyDeficitCents).toBeGreaterThan(0);
  });

  it('never emits a negative shortfall or deficit when essentials are cheap', () => {
    const analysis = computeFinancialPlanAnalysis({
      monthlyIncomeCents: 100_000,
      essentialMonthlyCents: 100,
      reserveBalanceCents: 0,
    });
    // 必要分配 50000 远高于 100,差额是"多余",不是负缺口。
    expect(analysis.essentialShortfallCents).toBe(0);
    expect(analysis.monthlyDeficitCents).toBe(0);
    expect(hasWarning(analysis, 'ESSENTIALS_OVER_HALF')).toBe(false);
  });

  it('flags a reserve below one month of essential costs', () => {
    const below = computeFinancialPlanAnalysis({
      monthlyIncomeCents: 10000,
      essentialMonthlyCents: 5000,
      reserveBalanceCents: 4999,
    });
    const at = computeFinancialPlanAnalysis({
      monthlyIncomeCents: 10000,
      essentialMonthlyCents: 5000,
      reserveBalanceCents: 5000,
    });
    expect(hasWarning(below, 'RESERVE_UNDER_ONE_MONTH')).toBe(true);
    expect(hasWarning(at, 'RESERVE_UNDER_ONE_MONTH')).toBe(false);
  });

  it('emits warnings in a fixed, documented order', () => {
    const analysis = computeFinancialPlanAnalysis({
      monthlyIncomeCents: 10000,
      essentialMonthlyCents: 12000,
      reserveBalanceCents: 0,
    });
    expect(analysis.warnings).toEqual([
      'ESSENTIALS_OVER_HALF',
      'ESSENTIALS_EXCEED_INCOME',
      'RESERVE_UNDER_ONE_MONTH',
    ]);
  });

  it('is deterministic across repeated calls', () => {
    const inputs = { monthlyIncomeCents: 12345, essentialMonthlyCents: 6789, reserveBalanceCents: 1000 };
    expect(computeFinancialPlanAnalysis(inputs)).toEqual(computeFinancialPlanAnalysis(inputs));
  });
});

// ---------------------------------------------------------------------------
// 投影结构
// ---------------------------------------------------------------------------

describe('computeFinancialPlanAnalysis — projection shape', () => {
  it('always reports months 1..12 in ascending order', () => {
    const analysis = computeFinancialPlanAnalysis({
      monthlyIncomeCents: 10000,
      essentialMonthlyCents: 5000,
      reserveBalanceCents: 1000,
    });
    expect(FINANCIAL_PLAN_PROJECTION_MONTHS).toBe(12);
    expect(analysis.projection.map((p) => p.month)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });

  it('advances the reserve by exactly the reserved share each month, with no returns', () => {
    const analysis = computeFinancialPlanAnalysis({
      monthlyIncomeCents: 10000,
      essentialMonthlyCents: 5000,
      reserveBalanceCents: 1000,
    });
    analysis.projection.forEach((point) => {
      expect(point.reserveProjectedCents).toBe(1000 + 1500 * point.month);
      expect(point.growthContributionsCents).toBe(2500 * point.month);
      expect(point.reserveGapCents).toBe(Math.max(0, 25000 - point.reserveProjectedCents));
      expect(point.reserveSurplusCents).toBe(Math.max(0, point.reserveProjectedCents - 25000));
    });
  });

  it('gives every projection figure as a safe integer', () => {
    const analysis = computeFinancialPlanAnalysis({
      monthlyIncomeCents: 10000,
      essentialMonthlyCents: 5000,
      reserveBalanceCents: 25000,
    });
    for (const point of analysis.projection) {
      for (const value of [
        point.reserveProjectedCents,
        point.growthContributionsCents,
        point.reserveGapCents,
        point.reserveSurplusCents,
      ]) {
        expect(Number.isSafeInteger(value)).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 溢出:推导值超界必须整体拒绝,绝不静默产生错的钱
// ---------------------------------------------------------------------------

describe('computeFinancialPlanAnalysis — overflow safety', () => {
  it('rejects an essential-costs figure whose ×5 target leaves the safe range', () => {
    const tooBig = Math.floor(Number.MAX_SAFE_INTEGER / 5) + 1;
    expect(() =>
      computeFinancialPlanAnalysis({
        monthlyIncomeCents: 100,
        essentialMonthlyCents: tooBig,
        reserveBalanceCents: 0,
      }),
    ).toThrow(FinancialPlanInputError);
  });

  it('rejects a 12-month projection that would leave the safe range', () => {
    // 增长投入是 25% × 12 = 收入的 3 倍,因此接近 MAX_SAFE 的收入会让第 5 个月越界。
    expect(() =>
      computeFinancialPlanAnalysis({
        monthlyIncomeCents: Number.MAX_SAFE_INTEGER,
        essentialMonthlyCents: 1,
        reserveBalanceCents: 0,
      }),
    ).toThrow(FinancialPlanInputError);
  });

  it('accepts the largest input whose whole 12-month projection stays safe', () => {
    // 最紧的约束是增长累计 3 × 收入;储备累计 1.8 × 收入更松。
    const income = Math.floor((Number.MAX_SAFE_INTEGER - 1) / 3) - 1;
    const analysis = computeFinancialPlanAnalysis({
      monthlyIncomeCents: income,
      essentialMonthlyCents: 1,
      reserveBalanceCents: 0,
    });
    const month12 = analysis.projection[11];
    expect(Number.isSafeInteger(month12?.reserveProjectedCents)).toBe(true);
    expect(Number.isSafeInteger(month12?.growthContributionsCents)).toBe(true);
    expect(month12?.growthContributionsCents).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
  });

  it('rejects rather than truncates when a huge starting reserve overflows the projection', () => {
    // 期初储备本身是安全整数,但加上 12 个月投入后越界 —— 必须整体拒绝。
    expect(() =>
      computeFinancialPlanAnalysis({
        monthlyIncomeCents: 100,
        essentialMonthlyCents: 1,
        reserveBalanceCents: Number.MAX_SAFE_INTEGER,
      }),
    ).toThrow(FinancialPlanInputError);
  });
});
