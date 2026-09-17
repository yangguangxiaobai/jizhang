/**
 * 领域类型与预算引擎契约。
 *
 * 单位约定（贯穿整个项目，见 design.md §3）：
 * - 所有金额为 **整数分**（`*Cents`），杜绝浮点误差。
 * - 所有时间为 **epoch 毫秒**（`*At` / `date`），与参考项目的 `updatedAt` 一致。
 *
 * 本包必须保持**纯函数、零 IO**：不得 import fs / node: / fetch / 任何 DB 或框架。
 */

// ---------------------------------------------------------------------------
// 周期配置
// ---------------------------------------------------------------------------

/**
 * 预算周期模式。
 * - `natural-month`：一个自然月为一个周期（默认）。
 * - `start-day`：固定起始日（1..28）跨自然月定义周期，如 15 号到次月 14 号。
 *
 * 参考实现用 `cycleStartDay == null` 表示自然月模式
 * （`budget_engine.dart:39`）。
 */
export type CycleConfig =
  | { readonly kind: 'natural-month' }
  | { readonly kind: 'start-day'; readonly day: number };

/** 自然月模式的单例式常量，便于调用点少写对象字面量。 */
export const NATURAL_MONTH: CycleConfig = { kind: 'natural-month' };

/**
 * 配置周期起始日的合法范围。
 *
 * 参考项目 `test/budget_prefs_test.dart:27,30` 专门测了越界值 `0` 与 `29`，
 * 说明合法范围是 1..28（29/30/31 无法在每个自然月都成立，故排除）。
 */
export const MIN_CYCLE_START_DAY = 1;
export const MAX_CYCLE_START_DAY = 28;

// ---------------------------------------------------------------------------
// 领域实体
// ---------------------------------------------------------------------------

/** 账单类型。 */
export const TYPE_EXPENSE = 0;
export const TYPE_INCOME = 1;

/**
 * 账单。
 *
 * 与参考项目 `lib/data/models/transaction.dart` 字段一致。
 */
export interface Transaction {
  readonly id: string;
  /** 0 = 支出，1 = 收入。 */
  readonly type: number;
  /** 金额，单位分。 */
  readonly amountCents: number;
  readonly categoryId: string;
  readonly accountId?: string;
  /** 账单发生日期，epoch 毫秒。 */
  readonly date: number;
  readonly note?: string;
  readonly tags?: readonly string[];
  /**
   * 退款标记（横切属性）。
   *
   * 口径（已修订，参考 `transaction-service.ts`）：退款是收入型账单（type = 1），
   * 靠此标记区分；计入收入，不再冲减支出。`refund_links` 表记录它冲抵的原始支出。
   */
  readonly isRefund?: boolean;
  readonly deleted?: boolean;
  readonly updatedAt?: number;
}

/** 单个模块的预算分配（某分类在某周期的预算金额，单位分）。 */
export interface ModuleAllocation {
  readonly categoryId: string;
  readonly amountCents: number;
}

/**
 * 预算分配（一行 = 一个预算周期）。
 *
 * 参考 `salary_budget.dart:60-123`。`id` 在参考项目里即"预算周期 id"。
 */
export interface BudgetAllocation {
  readonly id: string;
  readonly salaryRecordId: string;
  /** 周期起始（发薪日），epoch 毫秒。 */
  readonly date: number;
  readonly allocations: readonly ModuleAllocation[];
  readonly deleted?: boolean;
  readonly updatedAt?: number;
}

// ---------------------------------------------------------------------------
// 计算结果
// ---------------------------------------------------------------------------

/**
 * 预算模块视图。
 *
 * `remainingCents` 固定为 `budgetCents - spentCents`，**允许为负**（超支）。
 */
export interface ModuleView {
  readonly categoryId: string;
  /** 本周期分配额（分）。 */
  readonly budgetCents: number;
  /** 周期内消费（分），毛口径（退款不再冲减，见下方支出贡献）。 */
  readonly spentCents: number;
  /** 剩余 = 分配 − 消费；可为负。 */
  readonly remainingCents: number;
}

/** 由模块视图派生剩余，保证与参考实现口径一致。 */
export function makeModuleView(
  categoryId: string,
  budgetCents: number,
  spentCents: number,
): ModuleView {
  return {
    categoryId,
    budgetCents,
    spentCents,
    remainingCents: budgetCents - spentCents,
  };
}

/** 已用比例（0~1+）；预算为 0 时：有消费记 1.0，无消费记 0。 */
export function spentRatio(view: ModuleView): number {
  if (view.budgetCents === 0) {
    return view.spentCents > 0 ? 1.0 : 0.0;
  }
  return view.spentCents / view.budgetCents;
}

/** 是否超支。 */
export function isOverBudget(view: ModuleView): boolean {
  return view.spentCents > view.budgetCents;
}

// ---------------------------------------------------------------------------
// 支出 / 收入口径（全项目唯一的聚合口径）
// ---------------------------------------------------------------------------

/**
 * 支出聚合贡献（毛支出口径）。
 *
 * - 支出：`+amountCents`
 * - 收入：`0`（退款是收入型账单，不再冲减支出）
 *
 * 参考 `transaction.dart:44-47`。所有聚合点（预算 / 图表 / 月汇总 / 首页）
 * 必须统一使用本函数，不得各处重复判断。
 */
export function expenseContribution(txn: Transaction): number {
  if (txn.type !== TYPE_EXPENSE) return 0;
  return txn.amountCents;
}

/**
 * 收入聚合贡献。
 *
 * - 收入：`+amountCents`（**含退款**——退款是收入型账单，钱进来就计收入）
 * - 支出：`0`
 *
 * 参考 `transaction.dart:49-51`。
 */
export function incomeContribution(txn: Transaction): number {
  if (txn.type !== TYPE_INCOME) return 0;
  return txn.amountCents;
}
