/**
 * 四用途财务规划:25/15/50/10 增长/储备/必要/享受(纯函数,无 IO)。
 *
 * ## 为什么在 shared
 *
 * 这是**规则**而不是查询,理由与预算引擎、账户余额相同:同一份整数分算术必须
 * 只有一个实现,服务端只负责读行、校验边界和持久化(`spec/backend/index.md`)。
 * 原生客户端渲染结果,不重算。
 *
 * ## 与旧口径的区别(不要"顺手统一")
 *
 * 旧的 `allocateSalaryCents`(seed-data.ts)让**最后一个模块吸收舍入余数**,极小金额
 * 下会产生非正数。这里是**独立的新领域**,必须非负且精确守恒,因此改用
 * **最大余数法**(largest remainder),并保持固定顺序作为并列时的稳定决胜:
 *
 * ```
 * 10000 分(growth25/reserve15/essentials50/joy10)
 *   精确: 2500 / 1500 / 5000 / 1000   → 合计 10000
 * 1 分
 *   向下取整: 0 / 0 / 0 / 0,余数 25/15/50/10,剩 1 分
 *   余数最大的是 essentials(50)→ 1 分给 essentials
 * ```
 *
 * **不要**用这个函数去改旧工资分配行为;那会改变历史快照的语义。
 *
 * ## 本模块的三条硬规则
 *
 * 1. **整数分,BigInt 中间量。** 所有推导值(target、12 个月投影、累计增长)用 BigInt
 *    计算,并在输出前逐个断言仍在 `Number.MAX_SAFE_INTEGER` 内——超界一律拒绝,绝不
 *    静默截断成错的钱。
 * 2. **目标 = 实际必要月支出 × 5**,不是收入的 50% × 5。收入与必要支出是两个独立
 *    输入,后者变则目标独立变化。
 * 3. **12 个月投影只是假想计划。** 储备 = 期初储备 + 每月储备投入 × k;增长字段是
 *    **累计计划投入**,不是资产余额;没有收益、没有利息、没有自动再分配。
 *    达到目标后固定 15% 仍按假想继续,多出来的部分显式标为 surplus。
 */

/** 分析规则的版本号。存储信封与每个分析结果都带上它,便于以后迁移。 */
export const FINANCIAL_PLAN_RULE_VERSION = 1;

/** 储备目标月数:目标 = 实际必要月支出 × 该系数。 */
export const FINANCIAL_PLAN_TARGET_FACTOR = 5;

/** 投影期数:相对投入第 1..12 个月,不绑定开始日期。 */
export const FINANCIAL_PLAN_PROJECTION_MONTHS = 12;

/** 四个用途的固定语义 id,顺序即展示顺序。 */
export type FinancialPurpose = 'growth' | 'reserve' | 'essentials' | 'joy';

/** 一个用途及其固定百分比。首版比例不可配置(PRD R2)。 */
export interface FinancialPlanPurposeSpec {
  readonly purpose: FinancialPurpose;
  /** 收入的百分比,整数。四项之和恰好 100。 */
  readonly percent: number;
}

/**
 * 固定比例与顺序。
 *
 * 顺序是**有语义的**:最大余数法在余数并列时按此顺序让前者先拿分,
 * 因此重排这个数组会改变用户看到的金额(`test/financial-plan.test.ts` 钉死)。
 */
export const FINANCIAL_PLAN_PURPOSES: readonly FinancialPlanPurposeSpec[] = [
  { purpose: 'growth', percent: 25 },
  { purpose: 'reserve', percent: 15 },
  { purpose: 'essentials', percent: 50 },
  { purpose: 'joy', percent: 10 },
];

/** 三个用户输入,全部是整数分。 */
export interface FinancialPlanInputs {
  /** 每月到手收入,必须 > 0。 */
  readonly monthlyIncomeCents: number;
  /** 实际必要月支出,必须 > 0。目标由它推导,而不是由收入推导。 */
  readonly essentialMonthlyCents: number;
  /** 手工确认的现有流动应急储备,必须 >= 0。可以高于目标。 */
  readonly reserveBalanceCents: number;
}

/** 一个用途分到的钱。 */
export interface FinancialPlanAllocation {
  readonly purpose: FinancialPurpose;
  readonly percent: number;
  readonly amountCents: number;
}

/** 一条确定性提示。文案由客户端本地提供,服务端只回稳定 id。 */
export type FinancialPlanWarning =
  | 'ESSENTIALS_OVER_HALF'
  | 'ESSENTIALS_EXCEED_INCOME'
  | 'RESERVE_UNDER_ONE_MONTH'
  | 'RESERVE_TARGET_REACHED'
  | 'RESERVE_CONTRIBUTION_ZERO';

/** 第 `month` 个月的假想储备进度(不是资产余额)。 */
export interface FinancialPlanProjectionMonth {
  /** 1..12,相对投入月,不是日历月。 */
  readonly month: number;
  /** 期初储备 + 每月储备投入 × month。 */
  readonly reserveProjectedCents: number;
  /** **累计计划增长投入**,不是资产余额、不含任何收益。 */
  readonly growthContributionsCents: number;
  /** max(0, target − projected)。 */
  readonly reserveGapCents: number;
  /** max(0, projected − target),达到目标后的假想盈余。 */
  readonly reserveSurplusCents: number;
  readonly targetReached: boolean;
}

/** 纯函数算出的完整分析。服务端存输入、读时重算,不存这些派生值。 */
export interface FinancialPlanAnalysis {
  readonly ruleVersion: 1;
  /** 固定四条,顺序 growth/reserve/essentials/joy。 */
  readonly allocations: readonly FinancialPlanAllocation[];
  readonly reserveTargetCents: number;
  readonly reserveGapCents: number;
  readonly reserveSurplusCents: number;
  /** 展示用比例,范围 [0,1],按 1e-6 截断后夹紧。 */
  readonly reserveProgress: number;
  /** 已达标为 0;每月储备投入为 0 时为 null(无法估算);否则 ceil(缺口/投入)。 */
  readonly monthsToTarget: number | null;
  readonly targetReached: boolean;
  /** max(0, 必要支出 − 必要用途分到的钱)。 */
  readonly essentialShortfallCents: number;
  /** max(0, 必要支出 − 月收入):计划本身不可负担。 */
  readonly monthlyDeficitCents: number;
  readonly warnings: readonly FinancialPlanWarning[];
  /** 固定 12 条,month 1..12。 */
  readonly projection: readonly FinancialPlanProjectionMonth[];
}

/**
 * 输入不合法或派生金额超出安全整数范围。
 *
 * 这是 **shared 的纯错误**,不带 HTTP 语义:服务端把"用户请求坏"和"库里存的值坏"
 * 分别映射成 400 / 503,而 shared 不需要知道这两者的区别。
 */
export class FinancialPlanInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FinancialPlanInputError';
  }
}

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
/** 展示比例的分母:1e6,即保留 6 位小数。 */
const PROGRESS_SCALE = 1_000_000n;

/** 断言一个派生分值仍在 JSON 安全范围内;超界即拒绝,绝不静默降级。 */
function requireSafeCents(value: bigint, what: string): number {
  if (value > MAX_SAFE_BIGINT || value < -MAX_SAFE_BIGINT) {
    throw new FinancialPlanInputError(
      `The resulting ${what} exceeds the safe integer range and cannot be represented exactly.`,
    );
  }
  return Number(value);
}

function requirePlainObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new FinancialPlanInputError(
      'The financial plan requires an object with monthlyIncomeCents, essentialMonthlyCents and reserveBalanceCents.',
    );
  }
  return raw as Record<string, unknown>;
}

/**
 * 严格读取一个整数分字段。
 *
 * 只接受真正的 `number`:数字字符串、`null`、小数、`NaN`、`Infinity` 全部拒绝。
 * 消息不回显用户输入的值——输入是私有财务信息。
 */
function requireCents(value: unknown, field: string, minimum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new FinancialPlanInputError(
      `${field} must be a safe integer number of cents. Convert yuan with Math.round(value * 100).`,
    );
  }
  if (value < minimum) {
    throw new FinancialPlanInputError(
      minimum > 0 ? `${field} must be greater than zero.` : `${field} must not be negative.`,
    );
  }
  return value;
}

/**
 * 校验并归一化三个输入字段。
 *
 * 多余的键被忽略(客户端可以带自己的 UI 状态),但缺一个必需字段就是错误:
 * 必要支出绝不会静默退化成"收入的 50%"(design.md §Boundary)。
 */
export function validateFinancialPlanInputs(raw: unknown): FinancialPlanInputs {
  const record = requirePlainObject(raw);
  return {
    monthlyIncomeCents: requireCents(record['monthlyIncomeCents'], 'monthlyIncomeCents', 1),
    essentialMonthlyCents: requireCents(record['essentialMonthlyCents'], 'essentialMonthlyCents', 1),
    reserveBalanceCents: requireCents(record['reserveBalanceCents'], 'reserveBalanceCents', 0),
  };
}

/**
 * 按固定 25/15/50/10 把收入分配到四个用途,最大余数法、非负、精确守恒。
 *
 * 并列时按 `FINANCIAL_PLAN_PURPOSES` 的顺序决胜;因为固定比例之和是 100,
 * 余下的分最多 3 个,所以"先到先得"一定能分配完。
 */
export function allocateFinancialPlanCents(
  monthlyIncomeCents: number,
): FinancialPlanAllocation[] {
  const income = BigInt(requireCents(monthlyIncomeCents, 'monthlyIncomeCents', 1));

  const parts = FINANCIAL_PLAN_PURPOSES.map((spec, index) => {
    const exact = income * BigInt(spec.percent);
    return {
      index,
      spec,
      base: exact / 100n,
      remainder: exact % 100n,
    };
  });

  let assigned = 0n;
  for (const part of parts) assigned += part.base;
  let leftover = income - assigned;

  // 固定顺序 = 并列时的决胜顺序;`sort` 在 V8 上稳定,但显式比较 index 更清楚。
  const byRemainder = [...parts].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  );
  const bonus = new Map<number, number>();
  for (const part of byRemainder) {
    if (leftover <= 0n) break;
    bonus.set(part.index, 1);
    leftover -= 1n;
  }

  return parts.map((part) => ({
    purpose: part.spec.purpose,
    percent: part.spec.percent,
    amountCents: Number(part.base + BigInt(bonus.get(part.index) ?? 0)),
  }));
}

/**
 * 由三个输入算出一份完整分析。纯函数:没有时钟、没有存储、没有网络。
 *
 * 输入本身会被重新校验,因此直接调用它也无法绕过边界。
 */
export function computeFinancialPlanAnalysis(rawInputs: FinancialPlanInputs): FinancialPlanAnalysis {
  const inputs = validateFinancialPlanInputs(rawInputs);

  const income = BigInt(inputs.monthlyIncomeCents);
  const essentialCosts = BigInt(inputs.essentialMonthlyCents);
  const startingReserve = BigInt(inputs.reserveBalanceCents);

  const allocations = allocateFinancialPlanCents(inputs.monthlyIncomeCents);
  const amounts: Record<FinancialPurpose, number> = {
    growth: 0,
    reserve: 0,
    essentials: 0,
    joy: 0,
  };
  for (const allocation of allocations) amounts[allocation.purpose] = allocation.amountCents;

  const growthCents = BigInt(amounts.growth);
  const reserveCents = BigInt(amounts.reserve);
  const essentialsCents = BigInt(amounts.essentials);

  // 目标来自**实际必要月支出**,与收入、与 50% 分配无关。
  const target = essentialCosts * BigInt(FINANCIAL_PLAN_TARGET_FACTOR);
  // 先断言目标:它参与后面的缺口/展示比例运算,超界必须在这里就拒绝。
  const targetCents = requireSafeCents(target, 'reserve target');

  const targetReached = startingReserve >= target;
  const gap = targetReached ? 0n : target - startingReserve;
  const surplus = targetReached ? startingReserve - target : 0n;
  const gapCents = requireSafeCents(gap, 'reserve gap');
  const surplusCents = requireSafeCents(surplus, 'reserve surplus');

  // 展示比例:先用整数除法截断到 1e-6,再夹紧到 [0,1],避免浮点噪声。
  const scaledProgress =
    startingReserve >= target ? PROGRESS_SCALE : (startingReserve * PROGRESS_SCALE) / target;
  const reserveProgress = Number(scaledProgress) / 1_000_000;

  let monthsToTarget: number | null;
  if (targetReached) {
    monthsToTarget = 0;
  } else if (reserveCents === 0n) {
    // 没有每月投入就没有可估算的时间。回 0 或无穷都不诚实。
    monthsToTarget = null;
  } else {
    monthsToTarget = requireSafeCents((gap + reserveCents - 1n) / reserveCents, 'months to target');
  }

  // 两者都是 max(0, …):必要支出低于其分配额时不是"负缺口",而是有多余;
  // 收入高于必要支出时也不是"负赤字"。
  const essentialShortfall =
    essentialCosts > essentialsCents ? essentialCosts - essentialsCents : 0n;
  const monthlyDeficit = essentialCosts > income ? essentialCosts - income : 0n;

  const warnings: FinancialPlanWarning[] = [];
  // 顺序固定,便于客户端与测试逐项比对。
  if (essentialCosts * 2n > income) warnings.push('ESSENTIALS_OVER_HALF');
  if (essentialCosts > income) warnings.push('ESSENTIALS_EXCEED_INCOME');
  if (startingReserve < essentialCosts) warnings.push('RESERVE_UNDER_ONE_MONTH');
  if (targetReached) warnings.push('RESERVE_TARGET_REACHED');
  if (reserveCents === 0n) warnings.push('RESERVE_CONTRIBUTION_ZERO');

  const projection: FinancialPlanProjectionMonth[] = [];
  for (let month = 1; month <= FINANCIAL_PLAN_PROJECTION_MONTHS; month += 1) {
    const projected = startingReserve + reserveCents * BigInt(month);
    const monthGap = projected >= target ? 0n : target - projected;
    const monthSurplus = projected >= target ? projected - target : 0n;
    projection.push({
      month,
      reserveProjectedCents: requireSafeCents(projected, 'projected reserve balance'),
      growthContributionsCents: requireSafeCents(growthCents * BigInt(month), 'growth contributions'),
      reserveGapCents: requireSafeCents(monthGap, 'reserve gap'),
      reserveSurplusCents: requireSafeCents(monthSurplus, 'reserve surplus'),
      targetReached: projected >= target,
    });
  }

  // 每个月都在循环里单独断言过安全范围,第 12 个月即是最大值,因此这里不再重复校验。

  return {
    ruleVersion: 1,
    allocations,
    reserveTargetCents: targetCents,
    reserveGapCents: gapCents,
    reserveSurplusCents: surplusCents,
    reserveProgress,
    monthsToTarget,
    targetReached,
    essentialShortfallCents: requireSafeCents(essentialShortfall, 'essential shortfall'),
    monthlyDeficitCents: requireSafeCents(monthlyDeficit, 'monthly deficit'),
    warnings,
    projection,
  };
}
