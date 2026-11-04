/**
 * 月计划只读汇总服务(C2 / F03–F05,设计 §3 "Read model and selection")。
 *
 * ## 职责
 *
 * 把**已确认的财务执行事实**折算成一个 `MonthlyPlanView`:冻结区间、确认收入、
 * 四个用途目标、消费预算汇总、分类消费行、待核对原因,以及旧信封参考。
 * 本服务**只读**:不创建周期、不写分配、不改配置、不重算历史修订。
 *
 * ## 复用边界(不要另算一遍)
 *
 * 所有金额都来自 `FinancialPlanningRefundsService.collectExecution(period)`:
 * 它返回 `getExecution` 用的同一份净执行视图 + 完整的执行事实数组。
 * - 绝不从分页接口(`/periods/:id/details`)的响应里拼总数;
 * - 绝不对账本另写"未过滤"的 SQL 聚合;
 * - 分类行按**原支出**的分类/用途归属退款,退款收入自己不是新的消费。
 *
 * ## 选择规则
 *
 * - 无参数:返回**包含服务器当前时刻**的已确认冻结区间;没有就是 `no-period`,
 *   绝不回退到"最新月份"(C2-05)。
 * - `month=YYYY-MM`:该工资分组月下的已确认周期;没有就是 `no-period`,
 *   多于一个候选就是 409 冲突,要求显式 `periodId`。
 * - `periodId`:直接读该周期的当前活跃修订(404 表示不存在)。
 * - `periodId` 与 `month` 互斥,同时给出是 400。
 * - 配置 `enabled=false` 时返回 `state='disabled'`,不发布任何金额。
 *
 * 自定义起始日周期保留存储的边界与时区,`window.label` 按**该周期的时区**渲染,
 * 不套用服务器本地时区,也不做 30 天近似。
 */
import {
  FINANCIAL_EXECUTION_CONTRACT_VERSION,
  FINANCIAL_EXECUTION_RULES,
  computeMonthlyPlanSummary,
  type FinancialEnvelopeReference,
  type MonthlyPlanSummary,
  type SpendingPurpose,
} from '@jizhang/shared';
import type { Db } from '../db/index.js';
import {
  FinancialInvalidError,
  FinancialUnavailableError,
  FinancialWindowConflictError,
} from './financial-errors.js';
import { FinancialPlanningService } from './financial-planning-service.js';
import {
  requireGroupMonth,
  rethrowSharedError,
  type FinancialExecutionFactDto,
  type FinancialMeta,
  type FinancialPlanningOptions,
  type PeriodRow,
} from './financial-planning-types.js';

/** 已确认周期的冻结区间;`to` 是**排他**上界(`[from, to)`)。 */
export interface MonthlyPlanWindow {
  readonly from: number;
  readonly to: number;
  readonly timeZone: string;
  /** 按 `timeZone` 渲染的展示标签,例如 `2026-09-10 ~ 2026-10-01`。 */
  readonly label: string;
}

/** 冻结决策里的四个用途目标金额(整数分)。 */
export interface MonthlyPlanTargetsCents {
  readonly growth: number;
  readonly reserve: number;
  readonly essentials: number;
  readonly joy: number;
}

/** 一个分类(可带用途)的消费行;`purpose='unresolved'` 表示尚未归类。 */
export type MonthlyPlanCategoryPurpose = SpendingPurpose | 'unresolved';

/**
 * 分类消费行。唯一键是 `(categoryId, purpose)`:同一个分类在账单级覆盖下
 * 可能同时出现在必要与随心里,行不会合并成假的一行。
 */
export interface MonthlyPlanCategoryRow {
  readonly categoryId: string | null;
  readonly categoryName: string | null;
  readonly purpose: MonthlyPlanCategoryPurpose;
  /** 该分类(该用途)下的毛支出。 */
  readonly grossCents: number;
  /** 已归属到这些原支出的退款合计。 */
  readonly refundCents: number;
  /** `grossCents − refundCents`,不会是负数。 */
  readonly netCents: number;
}

/** 必要/随心的用途明细。待核对时 `remainingCents` 与 `overspendCents` 为 null。 */
export interface MonthlyPlanPurposeRow {
  readonly purpose: SpendingPurpose;
  readonly budgetCents: number;
  readonly grossCents: number;
  readonly refundCents: number;
  readonly netCents: number;
  readonly remainingCents: number | null;
  readonly overspendCents: number | null;
}

/** 待核对的原因与计数;`reasons` 是稳定 id,文案由客户端提供。 */
export interface MonthlyPlanUnresolved {
  readonly reasons: readonly string[];
  /** 参与待核对的事实总数(支出 + 待归属退款 + 未归属退款)。 */
  readonly count: number;
  readonly expenseCount: number;
  readonly grossCents: number;
  readonly attributedRefundCents: number;
  readonly netCents: number;
  readonly linkedRefundCount: number;
  readonly linkedRefundUnresolvedCents: number;
  readonly globalUnassignedRefundCount: number;
  readonly globalUnassignedRefundCents: number;
}

/** `GET /api/v1/monthly-plan` 的完整响应。 */
export interface MonthlyPlanView extends FinancialMeta {
  readonly state: 'ready' | 'no-period' | 'disabled';
  readonly periodId: string | null;
  /** 该周期当前活跃修订号;`no-period`/`disabled` 为 null。 */
  readonly revision: number | null;
  readonly window: MonthlyPlanWindow | null;
  readonly confirmedIncomeCents: number | null;
  readonly targetsCents: MonthlyPlanTargetsCents | null;
  readonly summary: MonthlyPlanSummary | null;
  /** 固定顺序:[essentials, joy]。 */
  readonly purposes: readonly MonthlyPlanPurposeRow[];
  /** 分类消费行;顺序:用途(必要/随心/待归类)→ 净额降序 → 分类 id。 */
  readonly categories: readonly MonthlyPlanCategoryRow[];
  readonly unresolved: MonthlyPlanUnresolved;
  /** 旧分类信封只作参考:**不**叠加进 `summary.consumptionBudgetCents`(C2-07)。 */
  readonly legacyEnvelopeReference: FinancialEnvelopeReference | null;
}

/**
 * `GET /api/v1/monthly-plan` 的查询参数;两者互斥。
 *
 * 类型是 `unknown` 而不是 `string`:校验(缺失/空串/重复参数)留在服务层,
 * 路由只负责把 `request.query` 原样递进来。
 */
export interface MonthlyPlanQuery {
  readonly periodId?: unknown;
  readonly month?: unknown;
}

const PURPOSE_RANK: Record<MonthlyPlanCategoryPurpose, number> = {
  essentials: 0,
  joy: 1,
  unresolved: 2,
};

function emptyUnresolved(): MonthlyPlanUnresolved {
  return {
    reasons: [],
    count: 0,
    expenseCount: 0,
    grossCents: 0,
    attributedRefundCents: 0,
    netCents: 0,
    linkedRefundCount: 0,
    linkedRefundUnresolvedCents: 0,
    globalUnassignedRefundCount: 0,
    globalUnassignedRefundCents: 0,
  };
}

/** 空串等价于"没给";非字符串(重复查询参数)是 400,绝不忽略。 */
function optionalQueryString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new FinancialInvalidError(`${field} must be a single string query parameter.`);
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** 在显式 IANA 时区里把 epoch ms 渲染成 `YYYY-MM-DD`(不依赖进程本地时区)。 */
function localDateLabel(epochMs: number, timeZone: string): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(epochMs);
  } catch {
    throw new FinancialUnavailableError();
  }
  const valueOf = (type: Intl.DateTimeFormatPartTypes): string => {
    const found = parts.find((part) => part.type === type);
    return found?.value ?? '';
  };
  const year = valueOf('year');
  const month = valueOf('month');
  const day = valueOf('day');
  if (year === '' || month === '' || day === '') throw new FinancialUnavailableError();
  return `${year}-${month}-${day}`;
}

export class MonthlyPlanService {
  private readonly db: Db;
  private readonly planning: FinancialPlanningService;
  private readonly now: () => number;

  constructor(db: Db, options: FinancialPlanningOptions = {}) {
    this.db = db;
    this.planning = new FinancialPlanningService(db, options);
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * 读取月计划。**只读**:整个调用路径上没有 INSERT/UPDATE/DELETE。
   *
   * 抛出:`FinancialInvalidError`(400,参数互斥/月份格式)、
   * `FinancialWindowConflictError`(409,同一分组月有多个候选)、
   * `FinancialNotFoundError`(404,显式 periodId 不存在)、
   * `FinancialUnavailableError`(503,库里的执行事实无法解释)。
   */
  getMonthlyPlan(query: MonthlyPlanQuery = {}): MonthlyPlanView {
    const periodId = optionalQueryString(query.periodId, 'periodId');
    const month = optionalQueryString(query.month, 'month');
    if (periodId !== null && month !== null) {
      throw new FinancialInvalidError(
        'periodId and month are mutually exclusive; send at most one of them.',
      );
    }
    const groupMonth = month === null ? null : requireGroupMonth(month, 'month');

    const config = this.planning.readConfig();
    if (!config.enabled) return this.emptyView('disabled');

    if (periodId !== null) {
      return this.readyView(this.planning.periodsService.readPeriodRow(periodId));
    }

    if (groupMonth !== null) {
      const candidates = this.periodsOfGroupMonth(groupMonth);
      if (candidates.length === 0) return this.emptyView('no-period');
      if (candidates.length > 1) {
        throw new FinancialWindowConflictError(
          `More than one confirmed financial period exists for ${groupMonth}. Pass periodId to choose one.`,
        );
      }
      return this.readyView(candidates[0]!);
    }

    const current = this.periodContainingNow();
    if (current === null) return this.emptyView('no-period');
    return this.readyView(current);
  }

  /** 该分组月下的全部已确认周期(不排序:数量决定是 ready 还是 409)。 */
  private periodsOfGroupMonth(groupMonth: string): PeriodRow[] {
    return this.planning.periodsService.anyPeriods().filter((row) => row.group_month === groupMonth);
  }

  /**
   * 包含服务器当前时刻的冻结窗口。**不是**"最新周期":自然月没有当月方案时
   * 必须返回 no-period,不能拿上个月的余额顶上(C2-05)。
   */
  private periodContainingNow(): PeriodRow | null {
    const now = this.now();
    const matches = this.planning.periodsService.anyPeriods().filter((period) => {
      const window = this.planning.periodsService.parsePeriodWindow(
        this.planning.periodsService.activeRevisionRow(period),
      );
      return window.start <= now && now < window.end;
    });
    if (matches.length > 1) {
      throw new FinancialWindowConflictError(
        'More than one confirmed financial window contains the current time. Pass periodId to choose one.',
      );
    }
    return matches[0] ?? null;
  }

  private emptyView(state: 'no-period' | 'disabled'): MonthlyPlanView {
    return {
      contractVersion: FINANCIAL_EXECUTION_CONTRACT_VERSION,
      rules: FINANCIAL_EXECUTION_RULES,
      calculatedAt: this.now(),
      state,
      periodId: null,
      revision: null,
      window: null,
      confirmedIncomeCents: null,
      targetsCents: null,
      summary: null,
      purposes: [],
      categories: [],
      unresolved: emptyUnresolved(),
      legacyEnvelopeReference: null,
    };
  }

  private readyView(period: PeriodRow): MonthlyPlanView {
    // 与 GET /financial-planning/periods/:id/execution 完全同一份准备事实:
    // 不重算窗口、不重解析映射、不重新读账本聚合。
    const { execution, facts } = this.planning.refundsService.collectExecution(period);
    const frozen = execution.period;
    const targets = frozen.decision.targets;

    const purposeEntry = (purpose: SpendingPurpose) => {
      const found = execution.spending.find((entry) => entry.purpose === purpose);
      if (found === undefined) throw new FinancialUnavailableError();
      return found;
    };
    const essentials = purposeEntry('essentials');
    const joy = purposeEntry('joy');

    let summary: MonthlyPlanSummary;
    try {
      summary = computeMonthlyPlanSummary({
        essentialsBudgetCents: targets.essentials,
        joyBudgetCents: targets.joy,
        essentialsNetCents: essentials.netCents,
        joyNetCents: joy.netCents,
        isExact: execution.coverage === 'exact',
      });
    } catch (error) {
      // 这些数字来自已持久化的事实,解释不了就是 503,而不是 400。
      rethrowSharedError(error, true);
    }

    const exact = summary.status === 'exact';
    const purposes: MonthlyPlanPurposeRow[] = [essentials, joy].map((entry) => ({
      purpose: entry.purpose,
      budgetCents: entry.targetCents,
      grossCents: entry.grossCents,
      refundCents: entry.attributedRefundCents,
      netCents: entry.netCents,
      remainingCents: exact ? entry.remainingCents : null,
      overspendCents: exact ? entry.overspendCents : null,
    }));

    return {
      contractVersion: FINANCIAL_EXECUTION_CONTRACT_VERSION,
      rules: FINANCIAL_EXECUTION_RULES,
      calculatedAt: execution.calculatedAt,
      state: 'ready',
      periodId: period.id,
      revision: frozen.revision,
      window: {
        from: frozen.window.start,
        to: frozen.window.end,
        timeZone: frozen.window.timeZone,
        label: `${localDateLabel(frozen.window.start, frozen.window.timeZone)} ~ ${localDateLabel(
          frozen.window.end,
          frozen.window.timeZone,
        )}`,
      },
      confirmedIncomeCents: frozen.confirmedIncomeCents,
      targetsCents: {
        growth: targets.growth,
        reserve: targets.reserve,
        essentials: targets.essentials,
        joy: targets.joy,
      },
      summary,
      purposes,
      categories: this.categoryRows(facts),
      unresolved: this.unresolvedView(facts, execution.unresolved, frozen.sourceState),
      legacyEnvelopeReference: execution.envelopeReference,
    };
  }

  /**
   * 按 `(分类, 用途)` 聚合执行事实。
   *
   * 退款行**不**使用退款交易自己的分类/用途:它归到被退款的原支出上,所以
   * "支出 100 + 归属退款 30" 得到 gross 100 / refund 30 / net 70(C2-04)。
   */
  private categoryRows(facts: readonly FinancialExecutionFactDto[]): MonthlyPlanCategoryRow[] {
    interface Bucket {
      categoryId: string | null;
      purpose: MonthlyPlanCategoryPurpose;
      grossCents: number;
      refundCents: number;
    }
    const buckets = new Map<string, Bucket>();
    const expenseById = new Map<string, FinancialExecutionFactDto>();

    const bucketFor = (fact: FinancialExecutionFactDto): Bucket => {
      const purpose: MonthlyPlanCategoryPurpose = fact.purpose ?? 'unresolved';
      const key = `${fact.categoryId ?? ''}\u0000${purpose}`;
      const existing = buckets.get(key);
      if (existing !== undefined) return existing;
      const created: Bucket = {
        categoryId: fact.categoryId,
        purpose,
        grossCents: 0,
        refundCents: 0,
      };
      buckets.set(key, created);
      return created;
    };

    for (const fact of facts) {
      if (fact.kind !== 'expense') continue;
      expenseById.set(fact.transactionId, fact);
      const bucket = bucketFor(fact);
      bucket.grossCents = this.addCents(bucket.grossCents, fact.amountCents);
    }

    for (const fact of facts) {
      if (fact.kind !== 'refund-split' || fact.status !== 'counted') continue;
      const original =
        fact.originalTransactionId === null
          ? undefined
          : expenseById.get(fact.originalTransactionId);
      // 已确认分摊必须指向窗口内的活支出;找不到说明库里的执行事实无法解释。
      if (original === undefined) throw new FinancialUnavailableError();
      const bucket = bucketFor(original);
      bucket.refundCents = this.addCents(bucket.refundCents, fact.amountCents);
    }

    const names = this.categoryNames();
    return [...buckets.values()]
      .map((bucket) => ({
        categoryId: bucket.categoryId,
        categoryName: bucket.categoryId === null ? null : (names.get(bucket.categoryId) ?? null),
        purpose: bucket.purpose,
        grossCents: bucket.grossCents,
        refundCents: bucket.refundCents,
        netCents: bucket.grossCents - bucket.refundCents,
      }))
      .sort(
        (left, right) =>
          PURPOSE_RANK[left.purpose] - PURPOSE_RANK[right.purpose] ||
          right.netCents - left.netCents ||
          (left.categoryId ?? '').localeCompare(right.categoryId ?? ''),
      );
  }

  /** 分类名只是展示用主数据;账本金额仍然只来自执行事实。 */
  private categoryNames(): Map<string, string> {
    const rows = this.db.prepare('SELECT id, name FROM categories').all() as {
      id: string;
      name: string;
    }[];
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  private addCents(left: number, right: number): number {
    const total = left + right;
    if (!Number.isSafeInteger(total)) throw new FinancialUnavailableError();
    return total;
  }

  /**
   * 待核对原因与计数。
   *
   * `reasons` 是**稳定 id**(文案由客户端提供),并且与 `summary.status` 保持一致:
   * 只要执行覆盖度是 provisional,就至少有一个原因;`status==='exact'` 时为空。
   */
  private unresolvedView(
    facts: readonly FinancialExecutionFactDto[],
    unresolved: {
      readonly expenseCount: number;
      readonly grossCents: number;
      readonly attributedRefundCents: number;
      readonly netCents: number;
      readonly linkedRefundCount: number;
      readonly linkedRefundUnresolvedCents: number;
      readonly globalUnassignedRefundCount: number;
      readonly globalUnassignedRefundCents: number;
    },
    sourceState: 'valid' | 'reconciliation-required' | 'empty',
  ): MonthlyPlanUnresolved {
    const reasons = new Set<string>();
    for (const fact of facts) {
      if (fact.status === 'unresolved' && fact.reason !== null) reasons.add(fact.reason);
    }
    if (sourceState === 'reconciliation-required') reasons.add('salary-source-changed');
    if (sourceState === 'empty') reasons.add('no-confirmed-salary-source');
    if (unresolved.globalUnassignedRefundCount > 0) reasons.add('global-unassigned-refund');
    const hasPendingRefundFact = facts.some((fact) => fact.kind === 'pending-refund');
    if (unresolved.linkedRefundUnresolvedCents > 0 && !hasPendingRefundFact) {
      // 退款金额大于已确认分摊:分摊本身有效,但仍有未归属部分。
      reasons.add('refund-unallocated');
    }

    return {
      reasons: [...reasons].sort(),
      count:
        unresolved.expenseCount +
        unresolved.linkedRefundCount +
        unresolved.globalUnassignedRefundCount,
      expenseCount: unresolved.expenseCount,
      grossCents: unresolved.grossCents,
      attributedRefundCents: unresolved.attributedRefundCents,
      netCents: unresolved.netCents,
      linkedRefundCount: unresolved.linkedRefundCount,
      linkedRefundUnresolvedCents: unresolved.linkedRefundUnresolvedCents,
      globalUnassignedRefundCount: unresolved.globalUnassignedRefundCount,
      globalUnassignedRefundCents: unresolved.globalUnassignedRefundCents,
    };
  }
}
