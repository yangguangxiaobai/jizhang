/**
 * 手动存钱与投资进度（F08/F09）的**纯规则**。
 *
 * ## 边界（与 `account-balance.ts` / `financial-execution.ts` 一致）
 *
 * 这里只有算术与校验：不读时钟、不读数据库、不发网络请求。服务端负责读取
 * SQLite 事实、CAS/operationId 落盘；Android 只渲染服务端返回的数字。
 *
 * ## 三条不能被“顺手统一”的口径
 *
 * 1. **起始值是事实，不是收入**。`openingCents`/`openingAt` 是用户显式确认的
 *    起始余额，旧 `financial.plan.v1` 的 reserve/scenario 不会被自动迁移成本模块
 *    的记录；没有新记录时进度不随月份自动增长。
 * 2. **重放整段历史，不只看合计**。服务端把候选记录按时间排序逐笔重放，
 *    应急余额与投资本金在**任何一步**都不能为负——合计为正但中途取空同样非法。
 * 3. **两种目标不合并**。应急余额与投资本金各自独立，相加不等于“银行核验资产”；
 *    资金在两者之间搬动也不产生任何“新增储蓄”。
 *
 * 金额一律整数分，时间一律 epoch 毫秒。超出安全整数范围直接报错，绝不静默取整。
 */

/** 契约版本；服务端响应带同一版本。 */
export const MANUAL_GOAL_PROGRESS_CONTRACT_VERSION = 1 as const;

/** 两个互不合并的目标。 */
export type ManualGoal = 'reserve' | 'investment';

/** 记录方向：存入/投入（deposit）或取出/取回（withdrawal）。 */
export type ManualGoalEntryKind = 'deposit' | 'withdrawal';

export const MANUAL_GOALS = ['reserve', 'investment'] as const;
export const MANUAL_GOAL_ENTRY_KINDS = ['deposit', 'withdrawal'] as const;

/** 备注上限（字符数）。空备注合法。 */
export const MANUAL_GOAL_NOTE_MAX_LENGTH = 500;

/** `targetMonths` 的合法范围，与财务配置的 1..120 保持一致。 */
export const MIN_TARGET_MONTHS = 1;
export const MAX_TARGET_MONTHS = 120;

/** 纯规则错误码；HTTP 状态由服务端映射（这里不带任何 HTTP 语义）。 */
export type ManualGoalProgressErrorCode =
  | 'INVALID_GOAL'
  | 'INVALID_KIND'
  | 'INVALID_MONEY'
  | 'INVALID_DATE'
  | 'INVALID_NOTE'
  | 'INVALID_RANGE'
  | 'ENTRY_BEFORE_OPENING'
  | 'HISTORY_UNFUNDED';

export class ManualGoalProgressInputError extends Error {
  readonly code: ManualGoalProgressErrorCode;

  constructor(code: ManualGoalProgressErrorCode, message: string) {
    super(message);
    this.name = 'ManualGoalProgressInputError';
    this.code = code;
  }
}

function fail(code: ManualGoalProgressErrorCode, message: string): never {
  throw new ManualGoalProgressInputError(code, message);
}

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

// ---------------------------------------------------------------------------
// 值校验
// ---------------------------------------------------------------------------

export function isManualGoal(value: unknown): value is ManualGoal {
  return value === 'reserve' || value === 'investment';
}

export function isManualGoalEntryKind(value: unknown): value is ManualGoalEntryKind {
  return value === 'deposit' || value === 'withdrawal';
}

export function requireManualGoal(value: unknown, field = 'goal'): ManualGoal {
  if (!isManualGoal(value)) {
    fail('INVALID_GOAL', `${field} must be 'reserve' or 'investment'.`);
  }
  return value;
}

export function requireManualGoalEntryKind(value: unknown, field = 'kind'): ManualGoalEntryKind {
  if (!isManualGoalEntryKind(value)) {
    fail('INVALID_KIND', `${field} must be 'deposit' or 'withdrawal'.`);
  }
  return value;
}

/**
 * 金额校验：必须是安全整数分，且 `>= minimum`。
 *
 * 这是“非分精度被拒绝”的唯一实现点——`100.5`、`"100"`、`NaN`、`Infinity`
 * 全部在入口报错，绝不四舍五入或截断。
 */
export function requireCents(value: unknown, field: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    fail('INVALID_MONEY', `${field} must be an integer number of cents >= ${minimum}.`);
  }
  return value;
}

/** 时间校验：必须是安全整数毫秒，且 `>= minimum`。 */
export function requireEpochMs(value: unknown, field: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    fail('INVALID_DATE', `${field} must be an integer epoch-millisecond timestamp >= ${minimum}.`);
  }
  return value;
}

/** 备注校验：可选，去首尾空白后不超过上限；缺省/空白 = 空串。 */
export function requireManualGoalNote(value: unknown, field = 'note'): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    fail('INVALID_NOTE', `${field} must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > MANUAL_GOAL_NOTE_MAX_LENGTH) {
    fail('INVALID_NOTE', `${field} must be at most ${MANUAL_GOAL_NOTE_MAX_LENGTH} characters.`);
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// 记录事实
// ---------------------------------------------------------------------------

/** 一笔已确认的手动进度记录（服务端行 → 纯函数的事实视图）。 */
export interface ManualGoalEntryFact {
  readonly id: string;
  readonly goal: ManualGoal;
  readonly kind: ManualGoalEntryKind;
  readonly amountCents: number;
  readonly date: number;
  /** 记录首次落盘的时间，仅用于同一天的稳定排序。 */
  readonly createdAt: number;
}

/** 一笔记录的现金流：存入为正、取出为负。 */
export function manualGoalEntryFlowCents(entry: {
  readonly kind: ManualGoalEntryKind;
  readonly amountCents: number;
}): number {
  return entry.kind === 'deposit' ? entry.amountCents : -entry.amountCents;
}

/**
 * 候选历史的时间顺序。
 *
 * 先按 `date` 升序；**同一天内先存入、后取出**（当天的钱先到再花，避免“先确认
 * 取出、后确认同一天存入”被误判为取空）；再按 `createdAt`、最后按 `id` 决胜，
 * 因此同一组记录在任何进程里都得到同一个顺序。
 */
export function compareManualGoalEntries(
  left: ManualGoalEntryFact,
  right: ManualGoalEntryFact,
): number {
  if (left.date !== right.date) return left.date - right.date;
  if (left.kind !== right.kind) return left.kind === 'deposit' ? -1 : 1;
  if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

export function orderManualGoalEntries<T extends ManualGoalEntryFact>(
  entries: readonly T[],
): T[] {
  return [...entries].sort(compareManualGoalEntries);
}

function assertAllForOneGoal(entries: readonly ManualGoalEntryFact[]): void {
  for (const entry of entries) {
    requireManualGoal(entry.goal, 'entries[].goal');
    requireManualGoalEntryKind(entry.kind, 'entries[].kind');
    requireCents(entry.amountCents, 'entries[].amountCents', 1);
    requireEpochMs(entry.date, 'entries[].date');
  }
  const [first, ...rest] = entries;
  if (first === undefined) return;
  for (const entry of rest) {
    if (entry.goal !== first.goal) {
      fail('INVALID_GOAL', 'History replay requires entries of a single goal; mixed goals are not comparable.');
    }
  }
}

// ---------------------------------------------------------------------------
// 余额与期间合计
// ---------------------------------------------------------------------------

export interface ManualGoalBalanceInput {
  readonly openingCents: number;
  readonly entries: readonly ManualGoalEntryFact[];
  readonly asOf: number;
}

/**
 * 截至 `asOf` 的记录余额（含当日）：`opening + Σ(存入) − Σ(取出)`。
 *
 * 只取 `date <= asOf` 的记录，所以“没有新记录时进度不随时间增长”是结构性的，
 * 而不是某个调用方记得过滤。起始值恒计入（服务端保证 `openingAt <= asOf`）。
 */
export function manualGoalBalanceAsOf(input: ManualGoalBalanceInput): number {
  const opening = requireCents(input.openingCents, 'openingCents');
  const asOf = requireEpochMs(input.asOf, 'asOf');
  assertAllForOneGoal(input.entries);

  let balance = BigInt(opening);
  for (const entry of input.entries) {
    if (entry.date > asOf) continue;
    balance += BigInt(manualGoalEntryFlowCents(entry));
  }
  if (balance > MAX_SAFE_BIGINT || -balance > MAX_SAFE_BIGINT) {
    fail('INVALID_MONEY', 'The goal balance exceeds the safe integer range.');
  }
  return Number(balance);
}

export interface ManualGoalTotals {
  readonly depositCents: number;
  readonly withdrawalCents: number;
  readonly netCents: number;
  readonly entryCount: number;
}

/** 一组记录的存入/取出合计；`netCents` 是有符号的净额。 */
export function manualGoalTotals(entries: readonly ManualGoalEntryFact[]): ManualGoalTotals {
  assertAllForOneGoal(entries);
  let deposit = 0n;
  let withdrawal = 0n;
  for (const entry of entries) {
    const amount = BigInt(requireCents(entry.amountCents, 'entries[].amountCents', 1));
    if (entry.kind === 'deposit') deposit += amount;
    else withdrawal += amount;
  }
  const net = deposit - withdrawal;
  if (
    deposit > MAX_SAFE_BIGINT ||
    withdrawal > MAX_SAFE_BIGINT ||
    net > MAX_SAFE_BIGINT ||
    -net > MAX_SAFE_BIGINT
  ) {
    fail('INVALID_MONEY', 'The goal totals exceed the safe integer range.');
  }
  return {
    depositCents: Number(deposit),
    withdrawalCents: Number(withdrawal),
    netCents: Number(net),
    entryCount: entries.length,
  };
}

export interface ManualGoalPeriodTotalsInput {
  readonly entries: readonly ManualGoalEntryFact[];
  /** 区间起点（含）。 */
  readonly from: number;
  /** 区间终点（不含），必须大于 `from`。 */
  readonly to: number;
}

export interface ManualGoalPeriodTotals extends ManualGoalTotals {
  readonly from: number;
  readonly to: number;
}

/**
 * 指定期间的净存入/净投入：按 `from <= date < to` 精确选择，**可以为负**。
 *
 * 半开区间与统计窗口 `[monthStart, nextMonthStart)` 一致：相邻两个月不会把同
 * 一笔记录算两次，也不会漏掉月末当天。
 */
export function manualGoalPeriodTotals(
  input: ManualGoalPeriodTotalsInput,
): ManualGoalPeriodTotals {
  const from = requireEpochMs(input.from, 'from');
  const to = requireEpochMs(input.to, 'to');
  if (to <= from) {
    fail('INVALID_RANGE', 'to must be greater than from.');
  }
  const selected = input.entries.filter((entry) => entry.date >= from && entry.date < to);
  return { from, to, ...manualGoalTotals(selected) };
}

// ---------------------------------------------------------------------------
// 整段历史重放
// ---------------------------------------------------------------------------

export interface ManualGoalHistoryInput {
  readonly openingCents: number;
  readonly openingAt: number;
  readonly entries: readonly ManualGoalEntryFact[];
}

export interface ManualGoalHistoryStep {
  readonly entryId: string;
  readonly date: number;
  readonly flowCents: number;
  readonly balanceCents: number;
}

export interface ManualGoalHistory {
  readonly balanceCents: number;
  readonly minimumBalanceCents: number;
  readonly steps: readonly ManualGoalHistoryStep[];
}

/**
 * 按时间顺序重放**整段**候选历史，任何一步为负即整体拒绝。
 *
 * 这是 C4-04/C4-05 的唯一判定点：新增、编辑、删除、改起始值都先构造完整候选
 * 历史再重放；失败时调用方不得写入任何一行（错误消息里不含金额）。
 */
export function replayManualGoalHistory(input: ManualGoalHistoryInput): ManualGoalHistory {
  const openingCents = requireCents(input.openingCents, 'openingCents');
  const openingAt = requireEpochMs(input.openingAt, 'openingAt');
  assertAllForOneGoal(input.entries);

  let balance = BigInt(openingCents);
  let minimum = balance;
  const steps: ManualGoalHistoryStep[] = [];

  for (const entry of orderManualGoalEntries(input.entries)) {
    if (entry.date < openingAt) {
      fail(
        'ENTRY_BEFORE_OPENING',
        `Entry ${entry.id} is dated before the confirmed opening date.`,
      );
    }
    const flow = manualGoalEntryFlowCents(entry);
    balance += BigInt(flow);
    if (balance < 0n) {
      fail(
        'HISTORY_UNFUNDED',
        `The goal balance would go negative at entry ${entry.id}; the change was rejected.`,
      );
    }
    if (balance < minimum) minimum = balance;
    steps.push({
      entryId: entry.id,
      date: entry.date,
      flowCents: flow,
      balanceCents: Number(balance),
    });
  }

  if (balance > MAX_SAFE_BIGINT) {
    fail('INVALID_MONEY', 'The goal balance exceeds the safe integer range.');
  }
  return {
    balanceCents: Number(balance),
    minimumBalanceCents: Number(minimum),
    steps,
  };
}

// ---------------------------------------------------------------------------
// 应急目标与缺口
// ---------------------------------------------------------------------------

export type ReserveTargetState = 'ready' | 'no-baseline';

export interface ReserveProgressInput {
  /** 应急记录余额（必须 >= 0；负余额是非法历史，不是显示问题）。 */
  readonly balanceCents: number;
  /** 显式确认的必要月度开支基线；`null` = 尚未确认，目标不可计算。 */
  readonly essentialMonthlyCents: number | null | undefined;
  /** 目标月数，1..120。 */
  readonly targetMonths: number | null | undefined;
  /** 未来每月的应急参考额（来自已确认月计划）；`null`/0 = 没有可用于估算的参考。 */
  readonly monthlyReferenceCents: number | null | undefined;
}

export interface ReserveProgress {
  readonly targetState: ReserveTargetState;
  /** 目标 = 必要月度基线 × 目标月数；缺基线时为 `null`。 */
  readonly targetCents: number | null;
  /** 进度基点（10000 = 100%），向下取整且不超过 10000。 */
  readonly progressBasisPoints: number | null;
  /** 进度整数百分比（向下取整），48 表示 48%。 */
  readonly progressPercent: number | null;
  /** 缺口 = max(0, 目标 − 余额)。 */
  readonly gapCents: number | null;
  /** 超额 = max(0, 余额 − 目标)。 */
  readonly surplusCents: number | null;
  /**
   * 按当前月度参考“不变投入、无收益”的假设还需要几次投入（等价于月数）。
   * 缺口为 0 时为 0；没有参考（`null`/0）且仍有缺口时为 `null`——绝不猜。
   */
  readonly conditionalContributionCount: number | null;
}

export function computeReserveProgress(input: ReserveProgressInput): ReserveProgress {
  const balance = requireCents(input.balanceCents, 'balanceCents');
  const baseline = input.essentialMonthlyCents;
  const targetMonths = input.targetMonths;

  if (baseline === null || baseline === undefined || targetMonths === null || targetMonths === undefined) {
    return {
      targetState: 'no-baseline',
      targetCents: null,
      progressBasisPoints: null,
      progressPercent: null,
      gapCents: null,
      surplusCents: null,
      conditionalContributionCount: null,
    };
  }

  const monthly = requireCents(baseline, 'essentialMonthlyCents', 1);
  if (
    typeof targetMonths !== 'number' ||
    !Number.isSafeInteger(targetMonths) ||
    targetMonths < MIN_TARGET_MONTHS ||
    targetMonths > MAX_TARGET_MONTHS
  ) {
    fail(
      'INVALID_RANGE',
      `targetMonths must be an integer between ${MIN_TARGET_MONTHS} and ${MAX_TARGET_MONTHS}.`,
    );
  }

  const target = BigInt(monthly) * BigInt(targetMonths);
  if (target > MAX_SAFE_BIGINT) {
    fail('INVALID_MONEY', 'The reserve target exceeds the safe integer range.');
  }
  const targetCents = Number(target);

  const balanceBig = BigInt(balance);
  const gap = targetCents > balance ? target - balanceBig : 0n;
  const surplus = balance > targetCents ? balanceBig - target : 0n;

  const rawProgress = (balanceBig * 10_000n) / target;
  const progressBasisPoints = Number(rawProgress > 10_000n ? 10_000n : rawProgress);

  const reference = input.monthlyReferenceCents;
  const referenceCents =
    reference === null || reference === undefined ? null : requireCents(reference, 'monthlyReferenceCents');
  const conditionalContributionCount =
    gap === 0n
      ? 0
      : referenceCents === null || referenceCents === 0
        ? null
        : Math.ceil(Number(gap) / referenceCents);

  return {
    targetState: 'ready',
    targetCents,
    progressBasisPoints,
    progressPercent: Math.floor(progressBasisPoints / 100),
    gapCents: Number(gap),
    surplusCents: Number(surplus),
    conditionalContributionCount,
  };
}
