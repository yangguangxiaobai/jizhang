/**
 * 周期账单日期推算的行为规格测试(T13 PRD AC8 / AC11)。
 *
 * 最重要的一条是**月末不漂移**:
 *
 * ```
 * 锚定 1/31,monthly:
 *   正确  1/31 -> 2/28 -> 3/31 -> 4/30 -> 5/31
 *   错误  1/31 -> 2/28 -> 3/28 -> 4/28 -> ...   (永久漂到 28 号)
 * ```
 *
 * 这个错误只在月末出现,而且第一次就固定下来、之后再也回不去 —— 单看"下一期是
 * 2/28"是对的,所以必须连着推三期才抓得到。测试因此都推多期,不只看一步。
 */

import { describe, expect, it } from 'vitest';

import {
  dueDatesBetween,
  isRecurringFrequency,
  nextDueAfter,
  occurrenceAt,
  RECURRING_FREQUENCIES,
  type RecurringFrequency,
} from '../src/recurring.js';

/** 本地日 00:00 的 epoch 毫秒 —— 与引擎其余部分的"某一天"口径一致。 */
function day(year: number, month1: number, dayOfMonth: number): number {
  return new Date(year, month1 - 1, dayOfMonth).getTime();
}

const label = (epochMs: number): string => {
  const d = new Date(epochMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** 从锚定日推 `count` 期,返回 `YYYY-MM-DD` 标签序列(不含锚定日本身)。 */
function sequence(
  frequency: RecurringFrequency,
  anchor: number,
  count: number,
): string[] {
  const out: string[] = [];
  let due = anchor;
  for (let i = 0; i < count; i += 1) {
    due = nextDueAfter(frequency, anchor, due);
    out.push(label(due));
  }
  return out;
}

describe('occurrenceAt —— 第 n 期的绝对位置', () => {
  it('第 0 期就是锚定日本身', () => {
    for (const frequency of RECURRING_FREQUENCIES) {
      expect(occurrenceAt(frequency, day(2026, 1, 31), 0), frequency).toBe(
        day(2026, 1, 31),
      );
    }
  });

  it('daily 按天累加', () => {
    expect(label(occurrenceAt('daily', day(2026, 3, 1), 10))).toBe('2026-03-11');
  });

  it('weekly 按 7 天累加,跨月正确', () => {
    expect(label(occurrenceAt('weekly', day(2026, 3, 25), 2))).toBe('2026-04-08');
  });

  it('monthly 跨年归一月', () => {
    expect(label(occurrenceAt('monthly', day(2026, 11, 15), 3))).toBe('2027-02-15');
  });

  it('quarterly 一次跳三个月', () => {
    expect(label(occurrenceAt('quarterly', day(2026, 2, 10), 2))).toBe('2026-08-10');
  });

  it('yearly 保持月日', () => {
    expect(label(occurrenceAt('yearly', day(2024, 2, 29), 1))).toBe('2025-02-28');
  });

  it('拒绝负数或非整数期数', () => {
    expect(() => occurrenceAt('monthly', day(2026, 1, 1), -1)).toThrow();
    expect(() => occurrenceAt('monthly', day(2026, 1, 1), 1.5)).toThrow();
  });
});

describe('AC8 月末夹取 —— 必须回到锚定日,不能永久漂移', () => {
  it('monthly 锚定 1/31:2/28 之后回到 3/31', () => {
    // 这是本文件的核心用例。只推一期的话,"2/28"和错误实现完全一样。
    expect(sequence('monthly', day(2026, 1, 31), 5)).toEqual([
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
    ]);
  });

  it('monthly 锚定 1/31 连推一年,31 号在长月里每次都回来', () => {
    const dates = sequence('monthly', day(2026, 1, 31), 12);
    const days = dates.map((iso) => Number(iso.slice(8, 10)));
    // 被夹取的只有 2/28 与 30 天的月份(4、6、9、11 月),共 5 期;
    // 其余 7 期必须回到 31 号,其中包括第 12 期(2027-01-31)。
    expect(days.filter((d) => d === 31)).toHaveLength(7);

    // 断言整个序列,而不是逐个索引:索引数错过一次,而序列本身就是规格。
    expect(dates).toEqual([
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
      '2026-07-31',
      '2026-08-31',
      '2026-09-30',
      '2026-10-31',
      '2026-11-30',
      '2026-12-31',
      '2027-01-31',
    ]);
  });

  it('monthly 锚定 1/30:2 月夹到 28,3 月回到 30', () => {
    expect(sequence('monthly', day(2026, 1, 30), 4)).toEqual([
      '2026-02-28',
      '2026-03-30',
      '2026-04-30',
      '2026-05-30',
    ]);
  });

  it('monthly 锚定 31 号在闰年 2 月夹到 29', () => {
    expect(label(occurrenceAt('monthly', day(2024, 1, 31), 1))).toBe('2024-02-29');
  });

  it('quarterly 锚定 1/31:4 月夹到 30,7 月回到 31', () => {
    expect(sequence('quarterly', day(2026, 1, 31), 3)).toEqual([
      '2026-04-30',
      '2026-07-31',
      '2026-10-31',
    ]);
  });

  it('yearly 锚定 2/29:平年夹到 28,闰年回到 29', () => {
    expect(sequence('yearly', day(2024, 2, 29), 4)).toEqual([
      '2025-02-28',
      '2026-02-28',
      '2027-02-28',
      '2028-02-29',
    ]);
  });

  it('按天的频率不受月末影响', () => {
    expect(sequence('daily', day(2026, 1, 31), 2)).toEqual(['2026-02-01', '2026-02-02']);
    expect(sequence('weekly', day(2026, 1, 29), 2)).toEqual(['2026-02-05', '2026-02-12']);
  });
});

describe('nextDueAfter —— 严格晚于给定时刻', () => {
  it('返回严格大于 after 的日期', () => {
    for (const frequency of RECURRING_FREQUENCIES) {
      const anchor = day(2026, 3, 15);
      const next = nextDueAfter(frequency, anchor, anchor);
      expect(next, frequency).toBeGreaterThan(anchor);
    }
  });

  it('传入锚定日 -> 第一期', () => {
    expect(label(nextDueAfter('monthly', day(2026, 1, 10), day(2026, 1, 10)))).toBe(
      '2026-02-10',
    );
  });

  it('传入一个到期日 -> 下一期', () => {
    expect(label(nextDueAfter('monthly', day(2026, 1, 10), day(2026, 2, 10)))).toBe(
      '2026-03-10',
    );
  });

  it('传入两期之后的日子 -> 跳过中间那些期', () => {
    // 这一点让"漏了几期"能被一次补齐,而不是一期一期地爬。
    expect(label(nextDueAfter('monthly', day(2026, 1, 10), day(2026, 4, 20)))).toBe(
      '2026-05-10',
    );
  });

  it('同一天但带时分秒时,仍然推进到下一期(不返回当天)', () => {
    const anchor = day(2026, 1, 10);
    // 当日 12:00 —— 严格晚于当天 00:00,所以不能返回当天。
    const sameDayNoon = anchor + 12 * 3_600_000;
    expect(label(nextDueAfter('monthly', anchor, sameDayNoon))).toBe('2026-02-10');
  });

  it('循环一定终止:反复推进总是单调递增', () => {
    let due = day(2026, 1, 31);
    for (let i = 0; i < 40; i += 1) {
      const next = nextDueAfter('monthly', day(2026, 1, 31), due);
      expect(next).toBeGreaterThan(due);
      due = next;
    }
  });
});

describe('dueDatesBetween —— 枚举一段已到期的日期', () => {
  it('包含 from 本身,因为 from 就是一个尚未生成的到期日', () => {
    const dates = dueDatesBetween('monthly', day(2026, 1, 10), day(2026, 1, 10), day(2026, 3, 10));
    expect(dates.map(label)).toEqual(['2026-01-10', '2026-02-10', '2026-03-10']);
  });

  it('到 to 为止,含两端', () => {
    const dates = dueDatesBetween('weekly', day(2026, 1, 1), day(2026, 1, 1), day(2026, 1, 15));
    expect(dates.map(label)).toEqual(['2026-01-01', '2026-01-08', '2026-01-15']);
  });

  it('from 晚于 to 时为空', () => {
    expect(dueDatesBetween('daily', day(2026, 1, 1), day(2026, 2, 1), day(2026, 1, 1))).toEqual(
      [],
    );
  });

  it('跨两个不同周期(防"单周期 fixture 抓不到错误桶键")', () => {
    // 一月与二月各一期,断言各自落在自己的标签上。
    const dates = dueDatesBetween('monthly', day(2026, 1, 5), day(2026, 1, 5), day(2026, 2, 5));
    expect(dates).toHaveLength(2);
    expect(new Date(dates[0] as number).getMonth()).toBe(0);
    expect(new Date(dates[1] as number).getMonth()).toBe(1);
  });
});

describe('isRecurringFrequency', () => {
  it('接受五种已知频率', () => {
    for (const frequency of RECURRING_FREQUENCIES) {
      expect(isRecurringFrequency(frequency), frequency).toBe(true);
    }
  });

  it('拒绝未知值与非字符串', () => {
    for (const value of ['hourly', '', null, undefined, 3, {}, ['monthly']]) {
      expect(isRecurringFrequency(value), String(value)).toBe(false);
    }
  });
});
