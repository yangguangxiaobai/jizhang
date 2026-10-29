/**
 * Phase 1 财务执行规则的共享规格。
 *
 * 这些用例钉死四类最容易出错的地方：
 * 1. 整数分守恒/最大余数/溢出拒绝；
 * 2. 显式 IANA 时区的有限月窗口（DST、跨月、无 30 天近似）；
 * 3. 用途优先级与退款分摊上限；
 * 4. 毛额、归属退款、净执行与 provisional 覆盖状态。
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_FINANCIAL_RATIOS_BPS,
  FINANCIAL_EXECUTION_CONTRACT_VERSION,
  FINANCIAL_EXECUTION_RULES,
  FinancialExecutionInputError,
  allocateFinancialExecutionCents,
  computeFinancialExecution,
  resolveFinancialCycleWindow,
  resolveFinancialPurpose,
  sumFinancialExecutionCents,
  validateFinancialExecutionConfig,
  validateFinancialRatiosBps,
  validateFinancialRefundSplits,
  type FinancialCategoryNode,
  type FinancialCategoryRule,
  type FinancialEnvelopeReference,
  type FinancialExecutionConfigInput,
  type FinancialMappingSnapshot,
  type FinancialRatiosBps,
  type FinancialRefundOriginalLimit,
  type FinancialRefundSplit,
  type FinancialWindow,
} from '../src/financial-execution.js';

const SHANGHAI = 'Asia/Shanghai';

function localEpoch(iso: string): number {
  return Date.parse(iso);
}

/** 断言调用抛出 shared 的纯错误。 */
function captureError(fn: () => unknown): FinancialExecutionInputError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(FinancialExecutionInputError);
    return error as FinancialExecutionInputError;
  }
  throw new Error('expected FinancialExecutionInputError');
}

function expectOneOf(error: FinancialExecutionInputError, codes: readonly string[]): void {
  expect(codes).toContain(error.code);
}

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

describe('validateFinancialExecutionConfig', () => {
  const valid: FinancialExecutionConfigInput = {
    enabled: true,
    ratiosBps: DEFAULT_FINANCIAL_RATIOS_BPS,
    essentialMonthlyCents: 500_000,
    targetMonths: 5,
    cycle: { kind: 'start-day', day: 25 },
    timeZone: SHANGHAI,
  };

  it('accepts a valid explicit config and ignores extra keys', () => {
    expect(
      validateFinancialExecutionConfig({
        ...valid,
        unexpected: 'ignored',
      }),
    ).toEqual(valid);
  });

  it('accepts a null essential baseline and natural month', () => {
    expect(
      validateFinancialExecutionConfig({
        ...valid,
        essentialMonthlyCents: null,
        cycle: { kind: 'natural-month' },
      }),
    ).toMatchObject({ essentialMonthlyCents: null, cycle: { kind: 'natural-month' } });
  });

  it('rejects ratios that are negative, fractional, missing or do not sum to 10000', () => {
    for (const ratiosBps of [
      { ...DEFAULT_FINANCIAL_RATIOS_BPS, growth: -1 },
      { ...DEFAULT_FINANCIAL_RATIOS_BPS, growth: 1.5 },
      { ...DEFAULT_FINANCIAL_RATIOS_BPS, growth: 2400, joy: 900 },
      { growth: 2500, reserve: 1500, essentials: 5000 },
    ]) {
      expectOneOf(
        captureError(() => validateFinancialExecutionConfig({ ...valid, ratiosBps })),
        ['INVALID_MONEY', 'INVALID_RATIOS'],
      );
    }
  });

  it('rejects target months outside 1..120 and non-integers', () => {
    for (const targetMonths of [0, 121, 1.5, -1]) {
      expectOneOf(
        captureError(() => validateFinancialExecutionConfig({ ...valid, targetMonths })),
        ['INVALID_CONFIG', 'INVALID_MONEY'],
      );
    }
  });

  it('rejects a non-positive baseline and a baseline × months overflow', () => {
    for (const essentialMonthlyCents of [0, -1, 1.5]) {
      expect(
        captureError(() => validateFinancialExecutionConfig({ ...valid, essentialMonthlyCents })).code,
      ).toBe('INVALID_MONEY');
    }
    expect(
      captureError(() =>
        validateFinancialExecutionConfig({
          ...valid,
          essentialMonthlyCents: Math.floor(Number.MAX_SAFE_INTEGER / 5) + 1,
          targetMonths: 5,
        }),
      ).code,
    ).toBe('OVERFLOW');
  });

  it('rejects invalid IANA zones, fixed offsets and invalid cycles', () => {
    for (const timeZone of ['Mars/Olympus', '+08:00', '']) {
      expect(captureError(() => validateFinancialExecutionConfig({ ...valid, timeZone })).code).toBe(
        'INVALID_TIME_ZONE',
      );
    }
    for (const cycle of [
      { kind: 'start-day', day: 0 },
      { kind: 'start-day', day: 29 },
      { kind: 'start-day', day: 1.5 },
      { kind: 'weekly' },
    ]) {
      expectOneOf(
        captureError(() => validateFinancialExecutionConfig({ ...valid, cycle })),
        ['INVALID_CYCLE', 'INVALID_MONEY'],
      );
    }
  });

  it('rejects non-boolean enabled', () => {
    expect(
      captureError(() => validateFinancialExecutionConfig({ ...valid, enabled: 'yes' })).code,
    ).toBe('INVALID_CONFIG');
  });
});

describe('validateFinancialRatiosBps', () => {
  it('normalizes the default ratios', () => {
    expect(validateFinancialRatiosBps(DEFAULT_FINANCIAL_RATIOS_BPS)).toEqual({
      growth: 2500,
      reserve: 1500,
      essentials: 5000,
      joy: 1000,
    });
  });

  it('rejects a sum other than 10000', () => {
    expect(captureError(() => validateFinancialRatiosBps({ ...DEFAULT_FINANCIAL_RATIOS_BPS, joy: 1001 })).code).toBe(
      'INVALID_RATIOS',
    );
  });
});

// ---------------------------------------------------------------------------
// 分配
// ---------------------------------------------------------------------------

describe('allocateFinancialExecutionCents', () => {
  it('splits the acceptance 10000 cents exactly', () => {
    expect(allocateFinancialExecutionCents(10_000, DEFAULT_FINANCIAL_RATIOS_BPS)).toEqual({
      growth: 2500,
      reserve: 1500,
      essentials: 5000,
      joy: 1000,
    });
  });

  it('gives the one leftover cent to essentials for 1 cent', () => {
    expect(allocateFinancialExecutionCents(1, DEFAULT_FINANCIAL_RATIOS_BPS)).toEqual({
      growth: 0,
      reserve: 0,
      essentials: 1,
      joy: 0,
    });
  });

  it('breaks equal remainders by growth/reserve/essentials/joy order', () => {
    const equal: FinancialRatiosBps = { growth: 2500, reserve: 2500, essentials: 2500, joy: 2500 };
    expect(allocateFinancialExecutionCents(2, equal)).toEqual({
      growth: 1,
      reserve: 1,
      essentials: 0,
      joy: 0,
    });
  });

  it('conserves exact income and never returns negative amounts', () => {
    for (const income of [0, 1, 2, 3, 4, 5, 7, 99, 100, 101, 333, 999, 12_345, 987_654, Number.MAX_SAFE_INTEGER]) {
      const amounts = allocateFinancialExecutionCents(income, DEFAULT_FINANCIAL_RATIOS_BPS);
      const total = sumFinancialExecutionCents([
        amounts.growth,
        amounts.reserve,
        amounts.essentials,
        amounts.joy,
      ]);
      expect(total).toBe(income);
      for (const amount of Object.values(amounts)) {
        expect(amount).toBeGreaterThanOrEqual(0);
        expect(Number.isSafeInteger(amount)).toBe(true);
      }
    }
  });

  it('honours a zero ratio', () => {
    expect(
      allocateFinancialExecutionCents(7, { growth: 0, reserve: 10_000, essentials: 0, joy: 0 }),
    ).toEqual({ growth: 0, reserve: 7, essentials: 0, joy: 0 });
  });

  it('rejects negative, fractional, non-finite and unsafe income', () => {
    for (const income of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '100']) {
      expect(captureError(() => allocateFinancialExecutionCents(income as number, DEFAULT_FINANCIAL_RATIOS_BPS)).code).toBe(
        'INVALID_MONEY',
      );
    }
  });

  it('rejects invalid ratios', () => {
    expect(
      captureError(() =>
        allocateFinancialExecutionCents(100, { growth: 2500, reserve: 1500, essentials: 5000, joy: 999 }),
      ).code,
    ).toBe('INVALID_RATIOS');
  });
});

// ---------------------------------------------------------------------------
// 窗口
// ---------------------------------------------------------------------------

function windowInput(
  overrides: Partial<Parameters<typeof resolveFinancialCycleWindow>[0]> = {},
): Parameters<typeof resolveFinancialCycleWindow>[0] {
  return {
    cycle: { kind: 'natural-month' },
    timeZone: SHANGHAI,
    groupMonth: '2026-10',
    salaries: [
      { salaryId: 'later', date: localEpoch('2026-10-25T09:00:00+08:00') },
      { salaryId: 'earlier', date: localEpoch('2026-10-09T09:00:00+08:00') },
    ],
    ...overrides,
  };
}

describe('resolveFinancialCycleWindow — natural month', () => {
  it('starts on the earliest salary local day and ends next month day 1', () => {
    const window = resolveFinancialCycleWindow(windowInput());
    expect(window).toMatchObject({
      cycleKey: 'natural-month:2026-10',
      groupMonth: '2026-10',
      timeZone: SHANGHAI,
      cycle: { kind: 'natural-month' },
      anchorSalaryId: 'earlier',
      groupingRule: 'financial-cycle-frozen-month-v1',
    });
    expect(window.start).toBe(localEpoch('2026-10-09T00:00:00+08:00'));
    expect(window.end).toBe(localEpoch('2026-11-01T00:00:00+08:00'));
    expect(window.warnings).toEqual([]);
  });

  it('uses the local calendar day, not the UTC date', () => {
    // 2026-09-30T16:30Z = 2026-10-01 00:30 Asia/Shanghai.
    const window = resolveFinancialCycleWindow(
      windowInput({
        groupMonth: '2026-10',
        salaries: [{ salaryId: 'late-utc', date: localEpoch('2026-09-30T16:30:00Z') }],
      }),
    );
    expect(window.start).toBe(localEpoch('2026-10-01T00:00:00+08:00'));
    expect(window.end).toBe(localEpoch('2026-11-01T00:00:00+08:00'));
  });

  it('does not extend a skipped month: a February window ends March 1', () => {
    const window = resolveFinancialCycleWindow(
      windowInput({
        groupMonth: '2026-02',
        salaries: [{ salaryId: 'feb', date: localEpoch('2026-02-10T09:00:00+08:00') }],
      }),
    );
    expect(window.start).toBe(localEpoch('2026-02-10T00:00:00+08:00'));
    expect(window.end).toBe(localEpoch('2026-03-01T00:00:00+08:00'));
  });

  it('anchors over all group allocations without a 200-source cap', () => {
    const salaries = Array.from({ length: 250 }, (_, index) => ({
      salaryId: `salary-${String(index).padStart(3, '0')}`,
      date: localEpoch('2026-10-20T09:00:00+08:00'),
    }));
    salaries.push({ salaryId: 'salary-000-earliest', date: localEpoch('2026-10-01T09:00:00+08:00') });
    const window = resolveFinancialCycleWindow(windowInput({ salaries }));
    expect(window.anchorSalaryId).toBe('salary-000-earliest');
    expect(window.start).toBe(localEpoch('2026-10-01T00:00:00+08:00'));
  });

  it('warns when the legacy envelope window differs', () => {
    const start = localEpoch('2026-10-09T00:00:00+08:00');
    const end = localEpoch('2026-11-01T00:00:00+08:00');
    const same = resolveFinancialCycleWindow(
      windowInput({ legacyWindow: { start, end } }),
    );
    expect(same.warnings).toEqual([]);
    const different = resolveFinancialCycleWindow(
      windowInput({ legacyWindow: { start, end: null } }),
    );
    expect(different.warnings).toEqual(['LEGACY_WINDOW_DIFFERS']);
  });
});

describe('resolveFinancialCycleWindow — start day and DST', () => {
  it('uses the SAME salary calendar month even when payday is before the start day', () => {
    const window = resolveFinancialCycleWindow(
      windowInput({
        cycle: { kind: 'start-day', day: 25 },
        groupMonth: '2026-09',
        salaries: [{ salaryId: 'sep-9', date: localEpoch('2026-09-09T09:00:00+08:00') }],
      }),
    );
    expect(window.cycleKey).toBe('start-day-25:2026-09');
    expect(window.start).toBe(localEpoch('2026-09-25T00:00:00+08:00'));
    expect(window.end).toBe(localEpoch('2026-10-25T00:00:00+08:00'));
    expect(window.warnings).toEqual(['SALARY_BEFORE_WINDOW']);
  });

  it('does not stretch a start-day window across a missing salary month', () => {
    const window = resolveFinancialCycleWindow(
      windowInput({
        cycle: { kind: 'start-day', day: 25 },
        groupMonth: '2026-03',
        salaries: [{ salaryId: 'mar-5', date: localEpoch('2026-03-05T09:00:00+08:00') }],
      }),
    );
    expect(window.start).toBe(localEpoch('2026-03-25T00:00:00+08:00'));
    expect(window.end).toBe(localEpoch('2026-04-25T00:00:00+08:00'));
  });

  it('uses the earliest valid instant when DST skips midnight (America/Santiago)', () => {
    // 2026-09-06 00:00 doesn't exist: clocks jump to 01:00 (-04 → -03).
    const window = resolveFinancialCycleWindow({
      cycle: { kind: 'natural-month' },
      timeZone: 'America/Santiago',
      groupMonth: '2026-09',
      salaries: [{ salaryId: 'scl', date: localEpoch('2026-09-06T16:00:00Z') }],
    });
    expect(window.start).toBe(localEpoch('2026-09-06T04:00:00Z'));
    expect(window.end).toBe(localEpoch('2026-10-01T03:00:00Z'));
  });

  it('uses the first occurrence when DST repeats midnight (America/Havana)', () => {
    // 2026-11-01 00:00 occurs twice; the earliest valid instant is 04:00Z.
    const window = resolveFinancialCycleWindow({
      cycle: { kind: 'natural-month' },
      timeZone: 'America/Havana',
      groupMonth: '2026-11',
      salaries: [{ salaryId: 'hav', date: localEpoch('2026-11-01T16:00:00Z') }],
    });
    expect(window.start).toBe(localEpoch('2026-11-01T04:00:00Z'));
    expect(window.end).toBe(localEpoch('2026-12-01T05:00:00Z'));
  });

  it('handles other modern DST zones where midnight is skipped', () => {
    // Paraguay 2018 and Brazil 2018 both jumped 00:00 → 01:00 at the DST start.
    const asuncion = resolveFinancialCycleWindow({
      cycle: { kind: 'natural-month' },
      timeZone: 'America/Asuncion',
      groupMonth: '2018-10',
      salaries: [{ salaryId: 'asu', date: localEpoch('2018-10-07T15:00:00Z') }],
    });
    expect(asuncion.start).toBe(localEpoch('2018-10-07T04:00:00Z'));

    const saoPaulo = resolveFinancialCycleWindow({
      cycle: { kind: 'natural-month' },
      timeZone: 'America/Sao_Paulo',
      groupMonth: '2018-11',
      salaries: [{ salaryId: 'sao', date: localEpoch('2018-11-04T15:00:00Z') }],
    });
    expect(saoPaulo.start).toBe(localEpoch('2018-11-04T03:00:00Z'));
  });

  it('crosses the Pacific/Apia date-line jump without adding 24-hour days', () => {
    // Samoa skipped 2011-12-30 entirely. The December window still ends at
    // 2012-01-01 00:00 local (+14), not 24 hours after the anchor.
    const window = resolveFinancialCycleWindow({
      cycle: { kind: 'natural-month' },
      timeZone: 'Pacific/Apia',
      groupMonth: '2011-12',
      salaries: [{ salaryId: 'apia', date: localEpoch('2011-12-29T22:00:00Z') }],
    });
    expect(window.start).toBe(localEpoch('2011-12-29T10:00:00Z'));
    expect(window.end).toBe(localEpoch('2011-12-31T10:00:00Z'));
  });

  it('rejects invalid zones, months and salaries outside the group month', () => {
    for (const timeZone of ['Mars/Olympus', '+08:00']) {
      expect(captureError(() => resolveFinancialCycleWindow(windowInput({ timeZone }))).code).toBe(
        'INVALID_TIME_ZONE',
      );
    }
    for (const groupMonth of ['2026-13', '2026-00', '2026-1', 'not-a-month', '1999-12']) {
      expect(captureError(() => resolveFinancialCycleWindow(windowInput({ groupMonth }))).code).toBe(
        'INVALID_GROUP_MONTH',
      );
    }
    expect(
      captureError(() =>
        resolveFinancialCycleWindow(
          windowInput({
            salaries: [{ salaryId: 'aug', date: localEpoch('2026-08-31T09:00:00+08:00') }],
          }),
        ),
      ).code,
    ).toBe('INVALID_WINDOW');
  });

  it('rejects salary timestamps beyond the ECMAScript Date range as domain errors', () => {
    for (const date of [8_640_000_000_000_001, Number.MAX_SAFE_INTEGER]) {
      const error = captureError(() =>
        resolveFinancialCycleWindow(
          windowInput({
            groupMonth: '9999-12',
            salaries: [{ salaryId: 'too-far', date }],
          }),
        ),
      );
      expect(error).toBeInstanceOf(FinancialExecutionInputError);
      expect(error.code).toBe('INVALID_WINDOW');
    }

    // Exactly the Date boundary is a valid Date (year 275760), so this must
    // reach the group-month check as a domain error, not an Intl RangeError.
    const boundary = captureError(() =>
      resolveFinancialCycleWindow(
        windowInput({
          groupMonth: '9999-12',
          salaries: [{ salaryId: 'boundary', date: 8_640_000_000_000_000 }],
        }),
      ),
    );
    expect(boundary).toBeInstanceOf(FinancialExecutionInputError);
    expect(boundary.code).toBe('INVALID_WINDOW');
  });

  it('requires at least one salary for a new window but accepts no salaries for an existing one', () => {
    expect(captureError(() => resolveFinancialCycleWindow(windowInput({ salaries: [] }))).code).toBe(
      'INVALID_WINDOW',
    );

    const existing: FinancialWindow = {
      cycleKey: 'natural-month:2026-10',
      groupMonth: '2026-10',
      start: localEpoch('2026-10-01T00:00:00Z'),
      end: localEpoch('2026-11-01T00:00:00Z'),
      timeZone: 'UTC',
      cycle: { kind: 'natural-month' },
      anchorSalaryId: 'frozen',
      groupingRule: 'financial-cycle-frozen-month-v1',
      legacyWindow: null,
      warnings: [],
    };
    const frozen = resolveFinancialCycleWindow(
      windowInput({
        cycle: { kind: 'start-day', day: 25 },
        timeZone: SHANGHAI,
        salaries: [],
        existingWindow: existing,
      }),
    );
    expect(frozen.start).toBe(existing.start);
    expect(frozen.end).toBe(existing.end);
    expect(frozen.warnings).toEqual(['GROUP_START_FROZEN', 'CYCLE_SETTINGS_DIFFER']);
  });

  it('rejects an existing window from a different group month', () => {
    const existing: FinancialWindow = {
      cycleKey: 'natural-month:2026-09',
      groupMonth: '2026-09',
      start: localEpoch('2026-09-01T00:00:00Z'),
      end: localEpoch('2026-10-01T00:00:00Z'),
      timeZone: 'UTC',
      cycle: { kind: 'natural-month' },
      anchorSalaryId: 'frozen',
      groupingRule: 'financial-cycle-frozen-month-v1',
      legacyWindow: null,
      warnings: [],
    };
    expect(
      captureError(() => resolveFinancialCycleWindow(windowInput({ existingWindow: existing }))).code,
    ).toBe('WINDOW_CONFLICT');
  });

  it('rejects an invalid legacy window and an invalid existing boundary', () => {
    expect(
      captureError(() =>
        resolveFinancialCycleWindow(windowInput({ legacyWindow: { start: 100, end: 100 } })),
      ).code,
    ).toBe('INVALID_WINDOW');
    const existing: FinancialWindow = {
      cycleKey: 'natural-month:2026-10',
      groupMonth: '2026-10',
      start: 100,
      end: 100,
      timeZone: SHANGHAI,
      cycle: { kind: 'natural-month' },
      anchorSalaryId: 'frozen',
      groupingRule: 'financial-cycle-frozen-month-v1',
      legacyWindow: null,
      warnings: [],
    };
    expect(
      captureError(() => resolveFinancialCycleWindow(windowInput({ existingWindow: existing }))).code,
    ).toBe('INVALID_WINDOW');
  });
});

// ---------------------------------------------------------------------------
// 用途解析
// ---------------------------------------------------------------------------

function mappingFixture(
  rules: readonly FinancialCategoryRule[] = [],
  categories: readonly FinancialCategoryNode[] = [],
  revision = 7,
): FinancialMappingSnapshot {
  return {
    revision,
    rules,
    categories,
    topologyToken: `topo-${revision}`,
    updatedAt: 1_700_000_000_000,
  };
}

const CATEGORIES: readonly FinancialCategoryNode[] = [
  { id: 'root', parentId: null, deleted: false },
  { id: 'food', parentId: 'root', deleted: false },
  { id: 'groceries', parentId: 'food', deleted: false },
  { id: 'joy', parentId: 'root', deleted: false },
  { id: 'orphan', parentId: 'missing', deleted: false },
  { id: 'cycle-a', parentId: 'cycle-b', deleted: false },
  { id: 'cycle-b', parentId: 'cycle-a', deleted: false },
];

describe('resolveFinancialPurpose', () => {
  it('prefers an explicit bill override over every rule', () => {
    const resolution = resolveFinancialPurpose({
      override: 'joy',
      categoryId: 'groceries',
      mapping: mappingFixture([{ categoryId: 'groceries', purpose: 'essentials' }], CATEGORIES),
    });
    expect(resolution).toEqual({
      purpose: 'joy',
      provenance: 'bill-override',
      ruleCategoryId: null,
      mappingRevision: 7,
      reason: null,
    });
  });

  it('uses a direct category rule', () => {
    expect(
      resolveFinancialPurpose({
        override: null,
        categoryId: 'groceries',
        mapping: mappingFixture([{ categoryId: 'groceries', purpose: 'joy' }], CATEGORIES),
      }),
    ).toMatchObject({ purpose: 'joy', provenance: 'category-rule', ruleCategoryId: 'groceries' });
  });

  it('inherits the nearest frozen ancestor rule', () => {
    expect(
      resolveFinancialPurpose({
        override: null,
        categoryId: 'groceries',
        mapping: mappingFixture(
          [
            { categoryId: 'root', purpose: 'joy' },
            { categoryId: 'food', purpose: 'essentials' },
          ],
          CATEGORIES,
        ),
      }),
    ).toMatchObject({ purpose: 'essentials', provenance: 'ancestor-rule', ruleCategoryId: 'food' });
  });

  it('walks multiple ancestors', () => {
    expect(
      resolveFinancialPurpose({
        override: null,
        categoryId: 'groceries',
        mapping: mappingFixture([{ categoryId: 'root', purpose: 'joy' }], CATEGORIES),
      }),
    ).toMatchObject({ purpose: 'joy', provenance: 'ancestor-rule', ruleCategoryId: 'root' });
  });

  it('stops inheritance at an explicit null direct rule', () => {
    expect(
      resolveFinancialPurpose({
        override: null,
        categoryId: 'groceries',
        mapping: mappingFixture(
          [
            { categoryId: 'groceries', purpose: null },
            { categoryId: 'root', purpose: 'essentials' },
          ],
          CATEGORIES,
        ),
      }),
    ).toEqual({
      purpose: null,
      provenance: 'unresolved',
      ruleCategoryId: 'groceries',
      mappingRevision: 7,
      reason: 'explicit-unresolved',
    });
  });

  it('stops inheritance at an explicit null ancestor rule', () => {
    expect(
      resolveFinancialPurpose({
        override: null,
        categoryId: 'groceries',
        mapping: mappingFixture(
          [
            { categoryId: 'food', purpose: null },
            { categoryId: 'root', purpose: 'essentials' },
          ],
          CATEGORIES,
        ),
      }),
    ).toMatchObject({
      purpose: null,
      provenance: 'unresolved',
      ruleCategoryId: 'food',
      reason: 'explicit-unresolved',
    });
  });

  it('reports category-not-in-snapshot and not-mapped distinctly', () => {
    expect(
      resolveFinancialPurpose({
        override: null,
        categoryId: 'new-category',
        mapping: mappingFixture([], CATEGORIES),
      }),
    ).toMatchObject({ reason: 'category-not-in-snapshot', mappingRevision: 7 });
    expect(
      resolveFinancialPurpose({
        override: null,
        categoryId: 'groceries',
        mapping: mappingFixture([], CATEGORIES),
      }),
    ).toMatchObject({ purpose: null, reason: 'not-mapped' });
    expect(
      resolveFinancialPurpose({ override: null, categoryId: null, mapping: mappingFixture([], CATEGORIES) }),
    ).toMatchObject({ purpose: null, reason: 'not-mapped' });
  });

  it('returns unresolved/mappingRevision 0 when there is no owning period', () => {
    expect(
      resolveFinancialPurpose({ override: 'joy', categoryId: 'groceries', mapping: null }),
    ).toEqual({
      purpose: null,
      provenance: 'unresolved',
      ruleCategoryId: null,
      mappingRevision: 0,
      reason: 'not-mapped',
    });
  });

  it('detects missing parents and cycles as invalid topology', () => {
    expect(
      resolveFinancialPurpose({
        override: null,
        categoryId: 'orphan',
        mapping: mappingFixture([], CATEGORIES),
      }),
    ).toMatchObject({ reason: 'invalid-topology' });
    expect(
      resolveFinancialPurpose({
        override: null,
        categoryId: 'cycle-a',
        mapping: mappingFixture([], CATEGORIES),
      }),
    ).toMatchObject({ reason: 'invalid-topology' });
  });
});

// ---------------------------------------------------------------------------
// 退款分摊
// ---------------------------------------------------------------------------

function refundOriginal(
  transactionId: string,
  remainingRefundableCents: number,
  state: FinancialRefundOriginalLimit['state'] = 'live',
): FinancialRefundOriginalLimit {
  return { transactionId, remainingRefundableCents, state };
}

function refundSplit(originalTransactionId: string, amountCents: number): FinancialRefundSplit {
  return { originalTransactionId, amountCents };
}

describe('validateFinancialRefundSplits', () => {
  it('accepts a partial split and reports the unresolved remainder', () => {
    const validated = validateFinancialRefundSplits({
      refundAmountCents: 100,
      originals: [refundOriginal('expense-1', 100)],
      splits: [refundSplit('expense-1', 30)],
    });
    expect(validated).toEqual({
      splits: [{ originalTransactionId: 'expense-1', amountCents: 30 }],
      totalCents: 30,
      unresolvedCents: 70,
    });
  });

  it('clears with empty arrays and preserves the whole refund as unresolved', () => {
    expect(
      validateFinancialRefundSplits({ refundAmountCents: 100, originals: [], splits: [] }),
    ).toEqual({ splits: [], totalCents: 0, unresolvedCents: 100 });
  });

  it('allows multiple originals with splits that exactly sum the refund', () => {
    const validated = validateFinancialRefundSplits({
      refundAmountCents: 100,
      originals: [refundOriginal('a', 50), refundOriginal('b', 50)],
      splits: [refundSplit('a', 50), refundSplit('b', 50)],
    });
    expect(validated.totalCents).toBe(100);
    expect(validated.unresolvedCents).toBe(0);
  });

  it('rejects duplicate split originals and set mismatches', () => {
    expect(
      captureError(() =>
        validateFinancialRefundSplits({
          refundAmountCents: 100,
          originals: [refundOriginal('a', 100), refundOriginal('b', 100)],
          splits: [refundSplit('a', 10), refundSplit('a', 20)],
        }),
      ).code,
    ).toBe('INVALID_REFUND_SPLITS');
    expect(
      captureError(() =>
        validateFinancialRefundSplits({
          refundAmountCents: 100,
          originals: [refundOriginal('a', 100), refundOriginal('b', 100)],
          splits: [refundSplit('a', 10)],
        }),
      ).code,
    ).toBe('INVALID_REFUND_SPLITS');
    expect(
      captureError(() =>
        validateFinancialRefundSplits({
          refundAmountCents: 100,
          originals: [refundOriginal('a', 100)],
          splits: [refundSplit('b', 10)],
        }),
      ).code,
    ).toBe('INVALID_REFUND_SPLITS');
  });

  it('rejects non-live originals, over-cap splits and totals above the refund', () => {
    for (const state of ['deleted', 'purged', 'not-expense'] as const) {
      expect(
        captureError(() =>
          validateFinancialRefundSplits({
            refundAmountCents: 100,
            originals: [refundOriginal('a', 100, state)],
            splits: [refundSplit('a', 10)],
          }),
        ).code,
      ).toBe('INVALID_REFUND_SPLITS');
    }
    expect(
      captureError(() =>
        validateFinancialRefundSplits({
          refundAmountCents: 100,
          originals: [refundOriginal('a', 20)],
          splits: [refundSplit('a', 21)],
        }),
      ).code,
    ).toBe('INVALID_REFUND_SPLITS');
    expect(
      captureError(() =>
        validateFinancialRefundSplits({
          refundAmountCents: 30,
          originals: [refundOriginal('a', 100), refundOriginal('b', 100)],
          splits: [refundSplit('a', 11), refundSplit('b', 20)],
        }),
      ).code,
    ).toBe('INVALID_REFUND_SPLITS');
  });

  it('rejects non-positive amounts and unsafe values', () => {
    expect(
      captureError(() =>
        validateFinancialRefundSplits({
          refundAmountCents: 0,
          originals: [],
          splits: [],
        }),
      ).code,
    ).toBe('INVALID_MONEY');
    expect(
      captureError(() =>
        validateFinancialRefundSplits({
          refundAmountCents: 100,
          originals: [refundOriginal('a', 100)],
          splits: [refundSplit('a', 0)],
        }),
      ).code,
    ).toBe('INVALID_MONEY');
  });

  it('rejects more than 100 splits', () => {
    const originals = Array.from({ length: 101 }, (_, index) =>
      refundOriginal(`e-${index}`, 1),
    );
    const splits = Array.from({ length: 101 }, (_, index) => refundSplit(`e-${index}`, 1));
    expect(
      captureError(() =>
        validateFinancialRefundSplits({ refundAmountCents: 101, originals, splits }),
      ).code,
    ).toBe('INVALID_REFUND_SPLITS');
  });
});

describe('sumFinancialExecutionCents', () => {
  it('sums non-negative and signed cents exactly', () => {
    expect(sumFinancialExecutionCents([1, 2, 3])).toBe(6);
    expect(sumFinancialExecutionCents([-5, 2], true)).toBe(-3);
    expect(sumFinancialExecutionCents([])).toBe(0);
  });

  it('rejects negative values unless explicitly allowed', () => {
    expect(captureError(() => sumFinancialExecutionCents([-1])).code).toBe('INVALID_MONEY');
  });

  it('rejects aggregate overflow and unsafe inputs', () => {
    expect(
      captureError(() => sumFinancialExecutionCents([Number.MAX_SAFE_INTEGER, 1])).code,
    ).toBe('OVERFLOW');
    expect(captureError(() => sumFinancialExecutionCents([1.5])).code).toBe('INVALID_MONEY');
  });
});

// ---------------------------------------------------------------------------
// 净执行
// ---------------------------------------------------------------------------

function executionWindow(overrides: Partial<FinancialWindow> = {}): FinancialWindow {
  return {
    cycleKey: 'natural-month:2026-10',
    groupMonth: '2026-10',
    start: localEpoch('2026-10-01T00:00:00+08:00'),
    end: localEpoch('2026-11-01T00:00:00+08:00'),
    timeZone: SHANGHAI,
    cycle: { kind: 'natural-month' },
    anchorSalaryId: 'salary-1',
    groupingRule: 'financial-cycle-frozen-month-v1',
    legacyWindow: null,
    warnings: [],
    ...overrides,
  };
}

const EXECUTION_MAPPING = mappingFixture(
  [
    { categoryId: 'essentials-cat', purpose: 'essentials' },
    { categoryId: 'joy-cat', purpose: 'joy' },
  ],
  [
    { id: 'root', parentId: null, deleted: false },
    { id: 'essentials-cat', parentId: 'root', deleted: false },
    { id: 'joy-cat', parentId: 'root', deleted: false },
    { id: 'unmapped-cat', parentId: 'root', deleted: false },
  ],
  3,
);

function executionInput(
  overrides: Partial<Parameters<typeof computeFinancialExecution>[0]> = {},
): Parameters<typeof computeFinancialExecution>[0] {
  return {
    window: executionWindow(),
    decision: {
      incomeCents: 10_000,
      ratiosBps: DEFAULT_FINANCIAL_RATIOS_BPS,
      targets: { growth: 2500, reserve: 1500, essentials: 5000, joy: 1000 },
    },
    sourceState: 'valid',
    mapping: EXECUTION_MAPPING,
    expenses: [],
    refundSplits: [],
    envelope: {
      totalBudgetCents: 0,
      mappedBudgetCents: { essentials: 0, joy: 0, unresolved: 0 },
      legacyWindow: null,
    },
    calculatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function spendingOf(
  computation: ReturnType<typeof computeFinancialExecution>,
  purpose: 'essentials' | 'joy',
): ReturnType<typeof computeFinancialExecution>['spending'][number] {
  const found = computation.spending.find((item) => item.purpose === purpose);
  if (found === undefined) throw new Error(`no spending for ${purpose}`);
  return found;
}

describe('computeFinancialExecution — acceptance figures', () => {
  it('returns essentials/joy remaining 1800/400 for 3200/600 spending', () => {
    const computation = computeFinancialExecution(
      executionInput({
        expenses: [
          {
            transactionId: 'e1',
            amountCents: 3200,
            date: localEpoch('2026-10-10T12:00:00+08:00'),
            categoryId: 'essentials-cat',
            override: null,
          },
          {
            transactionId: 'e2',
            amountCents: 600,
            date: localEpoch('2026-10-11T12:00:00+08:00'),
            categoryId: 'joy-cat',
            override: null,
          },
        ],
      }),
    );

    expect(spendingOf(computation, 'essentials')).toMatchObject({
      targetCents: 5000,
      grossCents: 3200,
      attributedRefundCents: 0,
      netCents: 3200,
      remainingCents: 1800,
      overspendCents: 0,
      state: 'exact',
    });
    expect(spendingOf(computation, 'joy')).toMatchObject({
      targetCents: 1000,
      grossCents: 600,
      netCents: 600,
      remainingCents: 400,
    });
    expect(computation.funding).toEqual([
      { purpose: 'growth', targetCents: 2500, state: 'not-connected', executedCents: null, remainingCents: null },
      { purpose: 'reserve', targetCents: 1500, state: 'not-connected', executedCents: null, remainingCents: null },
    ]);
    expect(computation.coverage).toBe('exact');
    expect(computation.contractVersion).toBe(FINANCIAL_EXECUTION_CONTRACT_VERSION);
    expect(computation.rules).toBe(FINANCIAL_EXECUTION_RULES);
  });

  it('reduces gross by an attributed original-cycle refund', () => {
    const computation = computeFinancialExecution(
      executionInput({
        expenses: [
          {
            transactionId: 'expense-100',
            amountCents: 100,
            date: localEpoch('2026-10-10T12:00:00+08:00'),
            categoryId: 'essentials-cat',
            override: null,
          },
        ],
        refundSplits: [
          {
            refundTransactionId: 'refund-30',
            originalTransactionId: 'expense-100',
            amountCents: 30,
          },
        ],
      }),
    );
    expect(spendingOf(computation, 'essentials')).toMatchObject({
      grossCents: 100,
      attributedRefundCents: 30,
      netCents: 70,
      remainingCents: 4930,
    });
  });

  it('reports overspend without going below a zero overspend', () => {
    const computation = computeFinancialExecution(
      executionInput({
        expenses: [
          {
            transactionId: 'e-joy',
            amountCents: 1200,
            date: localEpoch('2026-10-10T12:00:00+08:00'),
            categoryId: 'joy-cat',
            override: null,
          },
        ],
      }),
    );
    expect(spendingOf(computation, 'joy')).toMatchObject({
      netCents: 1200,
      remainingCents: -200,
      overspendCents: 200,
    });
  });
});

describe('computeFinancialExecution — unresolved and provisional coverage', () => {
  it('keeps unmapped expenses in a separate bucket and marks coverage provisional', () => {
    const computation = computeFinancialExecution(
      executionInput({
        expenses: [
          {
            transactionId: 'unknown',
            amountCents: 50,
            date: localEpoch('2026-10-10T12:00:00+08:00'),
            categoryId: 'unmapped-cat',
            override: null,
          },
        ],
      }),
    );
    expect(computation.unresolved).toMatchObject({
      expenseCount: 1,
      grossCents: 50,
      attributedRefundCents: 0,
      netCents: 50,
    });
    expect(computation.spending.every((item) => item.grossCents === 0)).toBe(true);
    expect(computation.spending.every((item) => item.state === 'provisional')).toBe(true);
    expect(computation.coverage).toBe('provisional');
  });

  it('attributes refunds to unresolved expenses without crediting a purpose', () => {
    const computation = computeFinancialExecution(
      executionInput({
        expenses: [
          {
            transactionId: 'unknown',
            amountCents: 100,
            date: localEpoch('2026-10-10T12:00:00+08:00'),
            categoryId: 'unmapped-cat',
            override: null,
          },
        ],
        refundSplits: [
          {
            refundTransactionId: 'refund',
            originalTransactionId: 'unknown',
            amountCents: 30,
          },
        ],
      }),
    );
    expect(computation.unresolved).toMatchObject({
      grossCents: 100,
      attributedRefundCents: 30,
      netCents: 70,
    });
    expect(computation.spending.every((item) => item.attributedRefundCents === 0)).toBe(true);
  });

  it('exposes pending linked and global unassigned refunds without adding them to net', () => {
    const computation = computeFinancialExecution(
      executionInput({
        pendingLinkedRefunds: [{ refundTransactionId: 'pending', amountCents: 20 }],
        globalUnassignedRefunds: { count: 2, amountCents: 80 },
      }),
    );
    expect(computation.unresolved).toMatchObject({
      linkedRefundCount: 1,
      linkedRefundUnresolvedCents: 20,
      globalUnassignedRefundCount: 2,
      globalUnassignedRefundCents: 80,
    });
    expect(computation.coverage).toBe('provisional');
    expect(spendingOf(computation, 'essentials').netCents).toBe(0);
  });

  it('marks source reconciliation provisional', () => {
    const computation = computeFinancialExecution(
      executionInput({ sourceState: 'reconciliation-required' }),
    );
    expect(computation.coverage).toBe('provisional');
    expect(computation.spending.every((item) => item.state === 'provisional')).toBe(true);
  });

  it('ignores expenses outside the frozen [start, end) window', () => {
    const computation = computeFinancialExecution(
      executionInput({
        expenses: [
          {
            transactionId: 'before',
            amountCents: 1000,
            date: localEpoch('2026-09-30T23:59:59+08:00'),
            categoryId: 'essentials-cat',
            override: null,
          },
          {
            transactionId: 'at-end',
            amountCents: 1000,
            date: localEpoch('2026-11-01T00:00:00+08:00'),
            categoryId: 'essentials-cat',
            override: null,
          },
          {
            transactionId: 'inside',
            amountCents: 10,
            date: localEpoch('2026-11-01T00:00:00+08:00') - 1,
            categoryId: 'essentials-cat',
            override: null,
          },
        ],
      }),
    );
    expect(spendingOf(computation, 'essentials').grossCents).toBe(10);
  });
});

describe('computeFinancialExecution — envelope reference and validation', () => {
  it('compares the legacy gross window and budget without claiming a nested allocation', () => {
    const window = executionWindow();
    const computation = computeFinancialExecution(
      executionInput({
        window,
        envelope: {
          totalBudgetCents: 6000,
          mappedBudgetCents: { essentials: 4000, joy: 1000, unresolved: 1000 },
          legacyWindow: { start: window.start, end: window.end },
        },
      }),
    );
    const reference: FinancialEnvelopeReference = computation.envelopeReference;
    expect(reference).toEqual({
      mode: 'legacy-reference',
      contract: 'legacy-gross',
      totalBudgetCents: 6000,
      mappedBudgetCents: { essentials: 4000, joy: 1000, unresolved: 1000 },
      purposeSpendingCeilingCents: 6000,
      differenceCents: 0,
      legacyWindow: { start: window.start, end: window.end },
      windowMatches: true,
      validatedNestedAllocation: false,
    });
  });

  it('labels a legacy natural-month window as not matching a finite financial window', () => {
    const computation = computeFinancialExecution(
      executionInput({
        envelope: {
          totalBudgetCents: 6000,
          mappedBudgetCents: { essentials: 4000, joy: 1000, unresolved: 1000 },
          legacyWindow: { start: executionWindow().start, end: null },
        },
      }),
    );
    expect(computation.envelopeReference.windowMatches).toBe(false);
  });

  it('rejects targets that do not match the exact allocation', () => {
    expect(
      captureError(() =>
        computeFinancialExecution(
          executionInput({
            decision: {
              incomeCents: 10_000,
              ratiosBps: DEFAULT_FINANCIAL_RATIOS_BPS,
              targets: { growth: 2500, reserve: 1500, essentials: 5001, joy: 999 },
            },
          }),
        ),
      ).code,
    ).toBe('INVALID_EXECUTION');
  });

  it('rejects duplicate expense IDs and refunds whose original is outside the window', () => {
    const duplicateExpense = {
      transactionId: 'same',
      amountCents: 10,
      date: localEpoch('2026-10-10T12:00:00+08:00'),
      categoryId: 'essentials-cat',
      override: null,
    };
    expect(
      captureError(() => computeFinancialExecution(executionInput({ expenses: [duplicateExpense, duplicateExpense] }))).code,
    ).toBe('INVALID_EXECUTION');

    expect(
      captureError(() =>
        computeFinancialExecution(
          executionInput({
            refundSplits: [
              { refundTransactionId: 'r', originalTransactionId: 'missing', amountCents: 10 },
            ],
          }),
        ),
      ).code,
    ).toBe('INVALID_REFUND_SPLITS');
  });

  it('rejects refund splits that exceed the original expense', () => {
    expect(
      captureError(() =>
        computeFinancialExecution(
          executionInput({
            expenses: [
              {
                transactionId: 'e',
                amountCents: 100,
                date: localEpoch('2026-10-10T12:00:00+08:00'),
                categoryId: 'essentials-cat',
                override: null,
              },
            ],
            refundSplits: [
              { refundTransactionId: 'r1', originalTransactionId: 'e', amountCents: 60 },
              { refundTransactionId: 'r2', originalTransactionId: 'e', amountCents: 50 },
            ],
          }),
        ),
      ).code,
    ).toBe('INVALID_REFUND_SPLITS');
  });

  it('rejects duplicate refund/original split pairs', () => {
    expect(
      captureError(() =>
        computeFinancialExecution(
          executionInput({
            expenses: [
              {
                transactionId: 'e',
                amountCents: 100,
                date: localEpoch('2026-10-10T12:00:00+08:00'),
                categoryId: 'essentials-cat',
                override: null,
              },
            ],
            refundSplits: [
              { refundTransactionId: 'r', originalTransactionId: 'e', amountCents: 10 },
              { refundTransactionId: 'r', originalTransactionId: 'e', amountCents: 5 },
            ],
          }),
        ),
      ).code,
    ).toBe('INVALID_REFUND_SPLITS');
  });

  it('rejects aggregate overflow instead of truncating money', () => {
    const hugeExpense = {
      transactionId: 'huge-1',
      amountCents: Number.MAX_SAFE_INTEGER,
      date: localEpoch('2026-10-10T12:00:00+08:00'),
      categoryId: 'essentials-cat',
      override: null,
    };
    expect(
      captureError(() =>
        computeFinancialExecution(
          executionInput({
            expenses: [hugeExpense, { ...hugeExpense, transactionId: 'huge-2' }],
          }),
        ),
      ).code,
    ).toBe('OVERFLOW');
  });

  it('is deterministic for identical input', () => {
    const input = executionInput();
    expect(computeFinancialExecution(input)).toEqual(computeFinancialExecution(input));
  });
});
