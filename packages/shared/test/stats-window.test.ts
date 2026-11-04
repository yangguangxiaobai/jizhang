/**
 * `resolveStatsWindow` 的共享规格（C3-03 / C3-06）。
 *
 * 钉死四类最容易出错的地方：
 * 1. “近30天”是**滚动 720 小时**，上界是捕获的 now，不是下个月 1 号；
 * 2. 月份区间用**显式 IANA 时区**的日历边界，跨年、闰年、夏令时都不许近似；
 * 3. 无效的 kind / month / timeZone / now 必须拒绝，不许静默回退；
 * 4. label 如实描述真实区间（客户端直接显示，不再自己拼）。
 */
import { describe, expect, it } from 'vitest';

import {
  LAST_30_DAYS_MS,
  StatsWindowInputError,
  parseStatsMonth,
  resolveStatsWindow,
  type StatsWindow,
  type StatsWindowKind,
} from '../src/stats-window.js';

const SHANGHAI = 'Asia/Shanghai';
const NEW_YORK = 'America/New_York';

/** 断言调用抛出 shared 的纯错误，并返回它。 */
function captureError(fn: () => unknown): StatsWindowInputError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(StatsWindowInputError);
    return error as StatsWindowInputError;
  }
  throw new Error('expected StatsWindowInputError');
}

/** 断言被拒绝，并返回错误码。 */
function errorCode(fn: () => unknown): string {
  return captureError(fn).code;
}

function monthWindow(month: string, timeZone: string, now = Date.parse('2026-10-29T12:00:00+08:00')): StatsWindow {
  return resolveStatsWindow('month', month, now, timeZone);
}

// ---------------------------------------------------------------------------
// 近30天：滚动 720 小时
// ---------------------------------------------------------------------------

describe('resolveStatsWindow last30', () => {
  const now = Date.parse('2026-10-29T12:00:00+08:00');

  it('C3-03 uses the captured now as the exclusive upper bound, not the next month', () => {
    const window = resolveStatsWindow('last30', null, now, SHANGHAI);

    expect(window.kind).toBe('last30');
    expect(window.to).toBe(now);
    expect(window.from).toBe(Date.parse('2026-09-29T12:00:00+08:00'));
    // The regression this guards: the old upper bound was `startOfNextMonth(now)`.
    expect(window.to).not.toBe(Date.parse('2026-11-01T00:00:00+08:00'));
    expect(window.from).not.toBe(Date.parse('2026-10-01T00:00:00+08:00'));
  });

  it('fixed now 2026-10-29T04:00:00Z resolves last30 from 2026-09-29T04:00:00Z lasting 720 hours', () => {
    const fixedNow = Date.parse('2026-10-29T04:00:00Z');
    const window = resolveStatsWindow('last30', null, fixedNow, SHANGHAI);

    expect(window.to).toBe(fixedNow);
    expect(window.from).toBe(Date.parse('2026-09-29T04:00:00Z'));
    expect(window.to - window.from).toBe(720 * 3_600_000);
  });

  it('is exactly 720 hours wide and states that range in the label', () => {
    const window = resolveStatsWindow('last30', null, now, SHANGHAI);

    expect(window.to - window.from).toBe(LAST_30_DAYS_MS);
    expect(LAST_30_DAYS_MS).toBe(30 * 86_400_000);
    expect(window.label).toBe('近30天 09-29 12:00 – 10-29 12:00');
    expect(window.calculatedAt).toBe(now);
    expect(window.timeZone).toBe(SHANGHAI);
  });

  it('stays 720 hours across a daylight-saving change', () => {
    // 2026-03-08 is the US spring-forward; the rolling range crosses it.
    const afterDst = Date.parse('2026-03-10T12:00:00-04:00');
    const window = resolveStatsWindow('last30', null, afterDst, NEW_YORK);

    expect(window.to).toBe(afterDst);
    expect(window.to - window.from).toBe(LAST_30_DAYS_MS);
    // 720 real hours back is 11:00 local (EST), not 12:00: the clock moved forward an
    // hour in between. A "30 local midnights" range would have ended up at 12:00 and
    // silently dropped an hour of real time.
    expect(window.from).toBe(Date.parse('2026-02-08T11:00:00-05:00'));
    expect(window.label).toBe('近30天 02-08 11:00 – 03-10 12:00');
  });

  it('labels a range that crosses a year boundary with full dates', () => {
    const newYearNow = Date.parse('2026-01-10T00:00:00+08:00');
    const window = resolveStatsWindow('last30', null, newYearNow, SHANGHAI);

    expect(window.from).toBe(Date.parse('2025-12-11T00:00:00+08:00'));
    expect(window.label).toBe('近30天 2025-12-11 00:00 – 2026-01-10 00:00');
  });

  it('renders the label in the requested time zone', () => {
    const window = resolveStatsWindow('last30', null, now, 'UTC');
    // 2026-10-29T12:00+08:00 is 2026-10-29T04:00Z.
    expect(window.label).toBe('近30天 09-29 04:00 – 10-29 04:00');
  });

  it('ignores a month that is supplied but still validates it', () => {
    const withoutMonth = resolveStatsWindow('last30', null, now, SHANGHAI);
    expect(resolveStatsWindow('last30', '2026-10', now, SHANGHAI)).toEqual(withoutMonth);
    expect(errorCode(() => resolveStatsWindow('last30', '2026-13', now, SHANGHAI))).toBe(
      'INVALID_MONTH',
    );
  });
});

// ---------------------------------------------------------------------------
// 月份：显式时区日历边界
// ---------------------------------------------------------------------------

describe('resolveStatsWindow month', () => {
  it('covers [monthStart, nextMonthStart) in the requested time zone', () => {
    const window = monthWindow('2026-10', SHANGHAI);

    expect(window.kind).toBe('month');
    expect(window.from).toBe(Date.parse('2026-10-01T00:00:00+08:00'));
    expect(window.to).toBe(Date.parse('2026-11-01T00:00:00+08:00'));
    expect(window.label).toBe('2026年10月');
    expect(window.timeZone).toBe(SHANGHAI);
  });

  it('anchors the same month differently per time zone', () => {
    const shanghai = monthWindow('2026-10', SHANGHAI);
    const utc = monthWindow('2026-10', 'UTC');

    expect(utc.from).toBe(Date.parse('2026-10-01T00:00:00Z'));
    expect(shanghai.from).toBe(utc.from - 8 * 3_600_000);
    expect(utc.from).not.toBe(shanghai.from);
  });

  it('uses the real month length (28, 29 in a leap year, 31)', () => {
    const february = monthWindow('2026-02', SHANGHAI);
    expect(february.from).toBe(Date.parse('2026-02-01T00:00:00+08:00'));
    expect(february.to).toBe(Date.parse('2026-03-01T00:00:00+08:00'));
    expect(february.to - february.from).toBe(28 * 86_400_000);

    const leapFebruary = monthWindow('2024-02', SHANGHAI);
    expect(leapFebruary.to - leapFebruary.from).toBe(29 * 86_400_000);

    const december = monthWindow('2026-12', SHANGHAI);
    expect(december.to - december.from).toBe(31 * 86_400_000);
  });

  it('handles a cross-year month on both sides of the boundary', () => {
    const december = monthWindow('2025-12', SHANGHAI);
    expect(december.from).toBe(Date.parse('2025-12-01T00:00:00+08:00'));
    expect(december.to).toBe(Date.parse('2026-01-01T00:00:00+08:00'));
    expect(december.label).toBe('2025年12月');

    const january = monthWindow('2026-01', SHANGHAI);
    expect(january.from).toBe(december.to);
    expect(january.to).toBe(Date.parse('2026-02-01T00:00:00+08:00'));
  });

  it('follows daylight saving instead of a fixed UTC offset', () => {
    // New York: March starts on EST (-05:00) and April starts on EDT (-04:00).
    const march = monthWindow('2026-03', NEW_YORK);
    expect(march.from).toBe(Date.parse('2026-03-01T00:00:00-05:00'));
    expect(march.to).toBe(Date.parse('2026-04-01T00:00:00-04:00'));

    // November starts on EDT and December on EST.
    const november = monthWindow('2026-11', NEW_YORK);
    expect(november.from).toBe(Date.parse('2026-11-01T00:00:00-04:00'));
    expect(november.to).toBe(Date.parse('2026-12-01T00:00:00-05:00'));
  });

  it('repeatedNovemberMidnightUsesFirstInstant chooses the earliest valid instant and aligns adjacent month', () => {
    // 2009-11-01 in America/St_Johns fell back from UTC-02:30 to UTC-03:30 at 00:01 local,
    // producing a second 00:00:00 local at 03:30:00Z. The month start must be the first
    // instant (02:30:00Z).
    const november = monthWindow('2009-11', 'America/St_Johns');
    const firstInstant = Date.parse('2009-11-01T02:30:00Z');
    const secondInstant = Date.parse('2009-11-01T03:30:00Z');

    expect(november.from).toBe(firstInstant);
    expect(november.from).not.toBe(secondInstant);

    // The preceding October window must end at the exact same instant.
    const october = monthWindow('2009-10', 'America/St_Johns');
    expect(october.to).toBe(november.from);

    // A bill at 02:30:30Z falls into November's half-open window [from, to), not October.
    const billTime = Date.parse('2009-11-01T02:30:30Z');
    expect(billTime >= november.from && billTime < november.to).toBe(true);
    expect(billTime >= october.from && billTime < october.to).toBe(false);
  });

  it('skippedMidnightUsesFirstInstantAfterOffsetTransition for spring-forward gap', () => {
    // America/Asuncion 2017-10-01 skipped midnight (00:00:00 jumped directly to 01:00:00).
    // The earliest valid instant of October is 2017-10-01T04:00:00Z (local 01:00:00).
    const october = monthWindow('2017-10', 'America/Asuncion');
    expect(october.from).toBe(Date.parse('2017-10-01T04:00:00Z'));

    const september = monthWindow('2017-09', 'America/Asuncion');
    expect(september.to).toBe(october.from);
  });

  it('does not depend on the captured now', () => {
    const january = Date.parse('2020-01-01T00:00:00Z');
    const december = Date.parse('2031-12-31T23:59:59Z');
    const first = monthWindow('2026-05', SHANGHAI, january);
    const second = monthWindow('2026-05', SHANGHAI, december);

    expect(first.from).toBe(second.from);
    expect(first.to).toBe(second.to);
    expect(first.calculatedAt).toBe(january);
    expect(second.calculatedAt).toBe(december);
  });

  it('always returns a half-open range with from < to', () => {
    for (const month of ['2026-01', '2026-02', '2026-12', '9999-01']) {
      const window = monthWindow(month, SHANGHAI);
      expect(window.from, month).toBeLessThan(window.to);
    }
  });
});

// ---------------------------------------------------------------------------
// 输入校验：一律拒绝，不静默回退
// ---------------------------------------------------------------------------

describe('resolveStatsWindow rejects invalid input', () => {
  const now = Date.parse('2026-10-29T12:00:00+08:00');

  it('rejects an unknown kind', () => {
    expect(errorCode(() => resolveStatsWindow('year' as unknown as StatsWindowKind, null, now, SHANGHAI))).toBe(
      'INVALID_WINDOW_KIND',
    );
    expect(errorCode(() => resolveStatsWindow(undefined as unknown as StatsWindowKind, null, now, SHANGHAI))).toBe(
      'INVALID_WINDOW_KIND',
    );
  });

  it('requires month for kind=month', () => {
    expect(errorCode(() => resolveStatsWindow('month', null, now, SHANGHAI))).toBe('INVALID_MONTH');
  });

  it('rejects malformed or impossible months', () => {
    for (const month of ['2026-1', '2026-13', '2026-00', '26-10', '2026-10-01', '', 'abc', '2026/10']) {
      expect(errorCode(() => resolveStatsWindow('month', month, now, SHANGHAI)), month).toBe(
        'INVALID_MONTH',
      );
    }
    expect(errorCode(() => resolveStatsWindow('month', 202610 as unknown as string, now, SHANGHAI))).toBe(
      'INVALID_MONTH',
    );
  });

  it('rejects an unsupported year range', () => {
    expect(errorCode(() => resolveStatsWindow('month', '1999-12', now, SHANGHAI))).toBe(
      'INVALID_MONTH',
    );
    expect(errorCode(() => resolveStatsWindow('month', '0000-01', now, SHANGHAI))).toBe(
      'INVALID_MONTH',
    );
  });

  it('rejects an invalid or non-IANA time zone', () => {
    for (const zone of ['Mars/Phobos', '', 'Asia/Shangai', '+08:00', '-05:00']) {
      expect(errorCode(() => resolveStatsWindow('month', '2026-10', now, zone)), zone).toBe(
        'INVALID_TIME_ZONE',
      );
    }
    expect(
      errorCode(() => resolveStatsWindow('month', '2026-10', now, undefined as unknown as string)),
    ).toBe('INVALID_TIME_ZONE');
  });

  it('rejects an invalid captured now', () => {
    for (const invalid of [Number.NaN, -1, 1.5, 8_640_000_000_000_001, Infinity]) {
      expect(errorCode(() => resolveStatsWindow('last30', null, invalid, SHANGHAI)), String(invalid)).toBe(
        'INVALID_NOW',
      );
    }
    expect(
      errorCode(() => resolveStatsWindow('last30', null, 'now' as unknown as number, SHANGHAI)),
    ).toBe('INVALID_NOW');
  });
});

// ---------------------------------------------------------------------------
// parseStatsMonth：与月度趋势锚点共用
// ---------------------------------------------------------------------------

describe('parseStatsMonth', () => {
  it('parses a valid month key', () => {
    expect(parseStatsMonth('2026-10')).toEqual({ year: 2026, month: 10 });
    expect(parseStatsMonth('2025-01')).toEqual({ year: 2025, month: 1 });
    expect(parseStatsMonth('9999-12')).toEqual({ year: 9999, month: 12 });
  });

  it('rejects anything that is not YYYY-MM', () => {
    for (const value of ['2026-1', '2026-13', '', 'x', null, undefined, 202610]) {
      expect(errorCode(() => parseStatsMonth(value)), String(value)).toBe('INVALID_MONTH');
    }
  });
});
