/**
 * 月计划只读汇总(C2 / F03–F05):把已确认执行事实折算成"消费预算 / 已消费 / 还能花"。
 *
 * ## 为什么在 shared
 *
 * 这是**规则**,不是查询:同一份整数分算术必须只有一个实现,服务端只负责挑选冻结周期、
 * 读取事实并原样返回(`spec/backend/financial-execution.md`)。原生客户端只渲染结果,
 * 不重算金额。
 *
 * ## 三条硬规则(不要"顺手统一")
 *
 * 1. **消费预算 = 必要 + 随心两个用途的目标之和**,不是总收入、不是收入百分比。
 *    增长/储备是资金划拨参考,不进消费预算,也不与旧信封叠加(C2-07)。
 * 2. **已消费 = 确认净额**(毛支出 − 已归属退款),与 `computeFinancialExecution`
 *    的 `spending[].netCents` 完全一致。未归类支出不进这个数,它让状态变成待核对。
 * 3. **待核对时不发布精确"还能花"**:`isExact=false` 时 `remainingCents` 必须是
 *    `null`,而不是 0、也不是"用不完整数据算出来的差额"(C2-06)。预算与已消费本身
 *    仍是已确认事实,照常返回。
 *
 * 超支(净消费 > 预算)是合法状态,`remainingCents` 为负数,不做 `Math.max(0, …)`
 * 截断——截断会把超支藏起来。
 *
 * 金额一律是整数分:非安全整数、负数、小数全部拒绝,绝不静默取整。
 */
import { FinancialExecutionInputError, sumFinancialExecutionCents } from './financial-execution.js';

/**
 * 计算月度汇总所需的四个已确认金额 + 数据完整性标记。
 *
 * 两个预算来自冻结决策的 `targets.essentials/joy`;两个净额来自
 * `computeFinancialExecution` 的 `spending[].netCents`;`isExact` 来自执行覆盖度
 * (`coverage === 'exact'`),即"没有未归类支出、没有未归属退款、工资来源未变更"。
 */
export interface MonthlyPlanSummaryInput {
  readonly essentialsBudgetCents: number;
  readonly joyBudgetCents: number;
  readonly essentialsNetCents: number;
  readonly joyNetCents: number;
  readonly isExact: boolean;
}

/** 客户端可以直接显示的月度汇总。`remainingCents === null` 表示"不发布精确剩余"。 */
export interface MonthlyPlanSummary {
  /** 必要 + 随心的预算合计。 */
  readonly consumptionBudgetCents: number;
  /** 必要 + 随心的确认净消费合计。 */
  readonly confirmedNetSpentCents: number;
  /** 预算 − 已消费;超支时为负。`isExact === false` 时必须是 null。 */
  readonly remainingCents: number | null;
  readonly status: 'exact' | 'review-required';
}

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_BIGINT = -MAX_SAFE_BIGINT;

function fail(code: 'INVALID_MONEY' | 'OVERFLOW', message: string): never {
  throw new FinancialExecutionInputError(code, message);
}

function requireCents(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    fail('INVALID_MONEY', `${field} must be a non-negative safe integer number of cents.`);
  }
  return value;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    fail('INVALID_MONEY', `${field} must be a boolean.`);
  }
  return value;
}

/**
 * 计算月度消费汇总(纯函数:不读时钟、不读数据库、不发网络请求)。
 *
 * - 四个金额必须是**非负安全整数分**;求和用 BigInt,溢出整体拒绝;
 * - `isExact === true` 时返回精确 `remainingCents`(允许负数表示超支);
 * - `isExact === false` 时 `remainingCents` 为 `null`、`status` 为 `review-required`,
 *   但预算与已消费照常返回——它们是已确认事实,只是"还能花"不再可信。
 */
export function computeMonthlyPlanSummary(input: MonthlyPlanSummaryInput): MonthlyPlanSummary {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    fail('INVALID_MONEY', 'MonthlyPlanSummaryInput must be an object.');
  }
  const record = input as unknown as Record<string, unknown>;
  const essentialsBudgetCents = requireCents(record['essentialsBudgetCents'], 'essentialsBudgetCents');
  const joyBudgetCents = requireCents(record['joyBudgetCents'], 'joyBudgetCents');
  const essentialsNetCents = requireCents(record['essentialsNetCents'], 'essentialsNetCents');
  const joyNetCents = requireCents(record['joyNetCents'], 'joyNetCents');
  const isExact = requireBoolean(record['isExact'], 'isExact');

  const consumptionBudgetCents = sumFinancialExecutionCents([essentialsBudgetCents, joyBudgetCents]);
  const confirmedNetSpentCents = sumFinancialExecutionCents([essentialsNetCents, joyNetCents]);

  // 两个已校验的安全整数相减,差值必然仍在安全整数范围内;显式断言只是为了让
  // "输出前逐个检查"这条规则在代码里可见。
  const remaining = BigInt(consumptionBudgetCents) - BigInt(confirmedNetSpentCents);
  if (remaining > MAX_SAFE_BIGINT || remaining < MIN_SAFE_BIGINT) {
    fail('OVERFLOW', 'The resulting monthly remaining amount exceeds the safe integer range.');
  }

  return {
    consumptionBudgetCents,
    confirmedNetSpentCents,
    remainingCents: isExact ? Number(remaining) : null,
    status: isExact ? 'exact' : 'review-required',
  };
}
