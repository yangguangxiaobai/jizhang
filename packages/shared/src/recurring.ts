/**
 * 周期账单的日期推算(纯函数,无 IO)。
 *
 * 放在 `shared` 而不是服务端,理由与预算引擎相同:这是**规则**而非查询,参考实现
 * 的语义(`recurring_transaction_repository.dart` 的 `next` / `_monthly` / `_yearly`)
 * 必须能被独立测试,不能藏在 SQL 或路由里。
 *
 * ## 唯一真正容易写错的地方
 *
 * `monthly` / `quarterly` / `yearly` 的推算**必须始终以锚定日 `anchorDate` 的
 * 年月日为基准**做 n 期偏移,而**不是**在上一个到期日上加一个周期。
 *
 * 两者的区别在月末会暴露,而且是永久性的:
 *
 * ```
 * 锚定 1/31,monthly:
 *   正确: 1/31 -> 2/28 -> 3/31 -> 4/30 -> 5/31   (每次都从 1/31 算第 n 期)
 *   错误: 1/31 -> 2/28 -> 3/28 -> 4/28 -> ...    (在 2/28 上加一个月,永久漂到 28)
 * ```
 *
 * 参考实现 `_monthly(year, month, day)`(`:401-406`)正是"先算目标年月,再把日
 * `clamp` 到当月最后一天",本函数照此实现。这条语义由 `test/recurring.test.ts`
 * 的 `1/31 -> 2/28 -> 3/31` 用例钉死。
 */

/** 周期账单的重复频率。与参考实现 `RecurringFrequency` 一一对应。 */
export type RecurringFrequency =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'quarterly'
  | 'yearly';

export const RECURRING_FREQUENCIES: readonly RecurringFrequency[] = [
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
];

/** 运行期校验用:一个值是否是已知频率。 */
export function isRecurringFrequency(value: unknown): value is RecurringFrequency {
  return (
    typeof value === 'string' &&
    (RECURRING_FREQUENCIES as readonly string[]).includes(value)
  );
}

/** 一个月为单位的频率,其期数偏移按"月"计算。 */
const MONTHS_PER_PERIOD: Partial<Record<RecurringFrequency, number>> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

/** 按天为单位的频率,其期数偏移按"天"计算。 */
const DAYS_PER_PERIOD: Partial<Record<RecurringFrequency, number>> = {
  daily: 1,
  weekly: 7,
};

/**
 * 锚定日之后的第 `periods` 期(1-based:`periods = 1` 即第一期)。
 *
 * 这是 `nextDueAfter` 的底层原语,单独导出以便测试"第 n 期"的绝对位置。
 */
export function occurrenceAt(
  frequency: RecurringFrequency,
  anchorDate: number,
  periods: number,
): number {
  if (!Number.isInteger(periods) || periods < 0) {
    throw new Error(`occurrenceAt: periods must be a non-negative integer (got ${periods})`);
  }

  const days = DAYS_PER_PERIOD[frequency];
  if (days !== undefined) {
    const base = new Date(anchorDate);
    return new Date(
      base.getFullYear(),
      base.getMonth(),
      base.getDate() + days * periods,
    ).getTime();
  }

  const months = MONTHS_PER_PERIOD[frequency];
  if (months === undefined) {
    throw new Error(`occurrenceAt: unknown frequency ${String(frequency)}`);
  }

  const anchor = new Date(anchorDate);
  const totalMonths = anchor.getMonth() + months * periods;
  // `new Date(y, m, d)` 会自动把 m 归一到跨年,负月份也正确。
  const targetYear = anchor.getFullYear() + Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  // 关键的一步:日取锚定日的日,再夹到目标月的最后一天。
  const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
  const day = Math.min(anchor.getDate(), lastDay);
  return new Date(targetYear, targetMonth, day).getTime();
}

/**
 * `anchorDate` 之后**严格晚于** `after` 的第一个到期日。
 *
 * 生成游标推进用它;规则创建时用 `anchorDate` 本身作为首个到期日。
 *
 * 返回值严格大于 `after`,因此 `while (due <= today) due = nextDueAfter(...)`
 * 这类循环一定会终止。
 */
export function nextDueAfter(
  frequency: RecurringFrequency,
  anchorDate: number,
  after: number,
): number {
  const days = DAYS_PER_PERIOD[frequency];
  const months = MONTHS_PER_PERIOD[frequency];
  if (days === undefined && months === undefined) {
    throw new Error(`nextDueAfter: unknown frequency ${String(frequency)}`);
  }

  // 朴素的"从第 1 期起往前找"写法。故意不预先估算期数:估算要处理夏令时与
  // 月份长度两种边界,而每次调用最多几步 —— `after` 总是紧邻的游标,不是几十年后。
  // 正确性比这点微优化重要。
  let periods = 1;
  let candidate = occurrenceAt(frequency, anchorDate, periods);
  while (candidate <= after) {
    periods += 1;
    candidate = occurrenceAt(frequency, anchorDate, periods);
  }
  return candidate;
}

/**
 * 一条规则在 `[from, to]`(含两端)之间的全部到期日,升序。
 *
 * 生成器用它枚举"已到期但尚未生成"的日期。返回值**包含 `from` 本身**,
 * 因为调用方传进来的 `from` 就是规则当前的 `nextDueDate`(一个尚未生成的到期日)。
 */
export function dueDatesBetween(
  frequency: RecurringFrequency,
  anchorDate: number,
  from: number,
  to: number,
): number[] {
  const out: number[] = [];
  if (from > to) return out;

  // 从 `from` 这一期开始,而不是重新从锚定日推算:调用方已经保证 `from`
  // 本身就是一个合法的到期日。
  let due = from;
  // 上限是防御性的:正常输入下循环远早于此结束。
  const guard = 10_000;
  while (due <= to && out.length < guard) {
    out.push(due);
    due = nextDueAfter(frequency, anchorDate, due);
  }
  return out;
}
