/**
 * 独立的四用途财务规划(服务端持久化 + HTTP 错误映射)。
 *
 * ## 边界(spec/backend/financial-plan.md)
 *
 * 这是一个**独立的计划域**,不是工资分配模板、不是支出信封。保存计划不得写入
 * `salary_records` / `budget_allocations` / `transactions` / `transfers` / `categories` /
 * `budget_templates`,也不得写任何别的 `settings` 键。用户填的储备是他们手动确认的
 * 流动应急金,不是账户总额或结转池推断出来的。
 *
 * ## 只存输入
 *
 * `settings` 里只有一条 `financial.plan.v1` 信封:
 * `{version, revision, updatedAt, inputs}`。所有派生值(分配、目标、投影、提示)都由
 * `@jizhang/shared` 在读取时重算——项目铁律是"永不物化派生余额"
 * (`spec/backend/index.md`)。因此不存在"存的分析过期"这类问题。
 *
 * ## 修订号即乐观并发
 *
 * PUT 必须带 `expectedRevision`:0 表示创建,否则只有当它等于当前修订号时才写入。
 * 写入在**一个 SQLite 事务**里完成 read-check-write,所以两个并发 PUT 不会都成功。
 *
 * 重试语义被刻意区分开:
 *
 * - 客户端重发**刚刚那一次**保存(revision = 当前 - 1)且三个输入完全一致 → 返回当前
 *   计划,不新增修订号。这就是"网络超时,我不知道上一次成功没有"的安全重放。
 * - 任何其他不一致 → `409 FINANCIAL_PLAN_CONFLICT`。特别地,**不**接受任意更早的
 *   revision 配同样的输入:那会把"用户改了又改回来"和"客户端拿着旧快照瞎写"混为一谈。
 *
 * ## 坏数据不覆盖
 *
 * 库里存了坏信封(版本不认识、JSON 坏、字段不合法)→ `503 FINANCIAL_PLAN_UNAVAILABLE`,
 * 绝不当作"没有计划"再让保存覆盖掉。用户的历史输入比一次成功的写入重要。
 */
import {
  FinancialPlanInputError,
  computeFinancialPlanAnalysis,
  validateFinancialPlanInputs,
  type FinancialPlanAnalysis,
  type FinancialPlanInputs,
} from '@jizhang/shared';
import type { Db } from '../db/index.js';

/** `settings` 里唯一的键。前缀 `financial.` 与其他域隔离。 */
export const FINANCIAL_PLAN_SETTINGS_KEY = 'financial.plan.v1';

/** 存储信封版本。不认识的版本按损坏处理,不做尽力猜测。 */
export const FINANCIAL_PLAN_STORED_VERSION = 1;

/** 400 —— 输入不合法(非整数分、负数、越界、缺字段)。 */
export class FinancialPlanInvalidError extends Error {
  readonly statusCode = 400;
  readonly code = 'FINANCIAL_PLAN_INVALID';
  constructor(message: string) {
    super(message);
    this.name = 'FinancialPlanInvalidError';
  }
}

/** 409 —— `expectedRevision` 与当前修订号不匹配,且不是可识别的幂等重放。 */
export class FinancialPlanConflictError extends Error {
  readonly statusCode = 409;
  readonly code = 'FINANCIAL_PLAN_CONFLICT';
  constructor(message: string) {
    super(message);
    this.name = 'FinancialPlanConflictError';
  }
}

/**
 * 503 —— 存储的信封无法使用。
 *
 * 消息是固定的,不回显任何存储内容:里面的钱数属于用户隐私,而这条错误只说明
 * "服务端现在答不了",不说明里面是什么。
 */
export class FinancialPlanUnavailableError extends Error {
  readonly statusCode = 503;
  readonly code = 'FINANCIAL_PLAN_UNAVAILABLE';
  constructor() {
    super('The saved financial plan cannot be read on this server right now. Please contact the administrator.');
    this.name = 'FinancialPlanUnavailableError';
  }
}

/** 存储信封:只有输入与版本信息,没有任何派生金额。 */
export interface StoredFinancialPlan {
  readonly version: typeof FINANCIAL_PLAN_STORED_VERSION;
  readonly revision: number;
  readonly updatedAt: number;
  readonly inputs: FinancialPlanInputs;
}

/** GET/PUT 返回的完整计划 = 信封 + 重新算出的分析。 */
export interface SavedFinancialPlan extends StoredFinancialPlan {
  readonly analysis: FinancialPlanAnalysis;
}

export interface FinancialPlanServiceOptions {
  /** 可注入时钟;`updatedAt` 与重放判定都用它,测试因此确定性。 */
  readonly now?: (() => number) | undefined;
}

interface SettingsRow {
  readonly value_json: string;
}

/**
 * 从 `value_json` 解出信封。任何形状问题都返回 `undefined`(调用方转成 503)。
 *
 * 这里刻意**不复用** `validateFinancialPlanInputs` 的宽松语义:存储读取必须比请求
 * 校验更严格——比如 `revision` 必须是正整数,而输入字段不允许有多余的东西。
 */
function parseStoredEnvelope(raw: string): StoredFinancialPlan | undefined {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) return undefined;

  const record = decoded as Record<string, unknown>;
  const version = record['version'];
  if (version !== FINANCIAL_PLAN_STORED_VERSION) return undefined;

  const revision = record['revision'];
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision <= 0) {
    return undefined;
  }
  // 还必须留出 +1 的空间:一个已经顶到 MAX_SAFE_INTEGER 的修订号无法再推进,
  // 写入它会得到一个不再是安全整数的修订号——那正是"自己造出的损坏信封"。
  if (revision >= Number.MAX_SAFE_INTEGER) return undefined;

  const updatedAt = record['updatedAt'];
  if (typeof updatedAt !== 'number' || !Number.isSafeInteger(updatedAt) || updatedAt < 0) {
    return undefined;
  }

  let inputs: FinancialPlanInputs;
  try {
    inputs = validateFinancialPlanInputs(record['inputs']);
  } catch (error) {
    if (error instanceof FinancialPlanInputError) return undefined;
    throw error;
  }

  return { version: FINANCIAL_PLAN_STORED_VERSION, revision, updatedAt, inputs };
}

export class FinancialPlanService {
  private readonly db: Db;
  private readonly now: () => number;

  constructor(db: Db, options: FinancialPlanServiceOptions = {}) {
    this.db = db;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * 计算一份不落盘的分析(预览)。
   *
   * 不读也不写任何行,所以它天然是只读的:预览永远不能改变已保存的计划。
   */
  preview(rawInputs: unknown): FinancialPlanAnalysis {
    return this.computeAnalysis(this.requireInputs(rawInputs));
  }

  /** 当前计划;没有保存过就是 `null`。存储损坏时抛 503。 */
  get(): SavedFinancialPlan | null {
    const stored = this.readStored();
    if (stored === null) return null;
    // 重算失败(理论上不可达:写入前已校验)同样按 503 处理,绝不返回半个计划。
    return { ...stored, analysis: this.computeAnalysis(stored.inputs) };
  }

  /**
   * 用乐观并发保存计划。
   *
   * `expectedRevision === 0` 创建;否则要求与当前一致。整个 read-check-write 在
   * 一个 IMMEDIATE 事务里,避免两个请求同时通过检查。
   */
  save(rawBody: unknown): SavedFinancialPlan {
    const body = this.requireBody(rawBody);
    const expectedRevision = this.requireExpectedRevision(body['expectedRevision']);
    const inputs = this.requireInputs(body);
    // 先算一遍:输入不可表示(推导值溢出)必须在写之前就 400,而不是写进去之后读不出来。
    const analysis = this.computeAnalysis(inputs);
    const nowMs = this.now();
    // 时间戳同样是信封的一部分:一个非安全整数或负的时间戳会让下一次读取把它判成
    // 损坏,所以宁可在写入前就失败(这是服务器自身的 bug,不是用户的错)。
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
      throw new Error('The injected clock returned an unusable epoch-millisecond timestamp.');
    }

    const run = this.db.transaction((): SavedFinancialPlan => {
      const current = this.readStored();

      // 幂等重放必须在任何分支之前判定,否则"创建请求超时后重发"会被当成
      // "已经有计划了"而回 409 —— 那正是最需要幂等的那条路径。
      //
      // 覆盖两种不确定结果的重放:
      //   * `expectedRevision === 0`(创建)而当前正好是 revision 1 且输入相同:
      //     上一次创建其实成功了,只是响应没回来;
      //   * `expectedRevision === current.revision - 1` 且输入相同:上一次更新成功。
      if (current !== null && this.isIdempotentReplay(current, expectedRevision, inputs)) {
        return { ...current, analysis: this.computeAnalysis(current.inputs) };
      }

      if (expectedRevision === 0) {
        if (current !== null) {
          // 已经有计划了,却声称要创建:客户端的视图是旧的。
          throw new FinancialPlanConflictError(
            'A financial plan already exists. Reload it before saving your changes.',
          );
        }
      } else if (current === null) {
        throw new FinancialPlanConflictError(
          'There is no saved financial plan to update. Reload the page and save again.',
        );
      } else if (current.revision !== expectedRevision) {
        throw new FinancialPlanConflictError(
          'The financial plan was changed by another save. Reload it before saving again.',
        );
      }

      const revision = current === null ? 1 : current.revision + 1;
      // 绝不写出一个自己读不回来的信封。
      //
      // `parseStoredEnvelope`(正确地)拒绝 `revision >= MAX_SAFE_INTEGER`,因为那样的
      // 修订号无法再推进。因此,当当前修订号已经是 `MAX_SAFE-1` 时,`+1` 会得到一个
      // 解析器拒绝的值 —— 写下去就等于把可用状态改成 503 永久损坏。这里在写入**之前**
      // 拒绝:存储保持原样、仍然可读,只是不能再更新。
      //
      // 这在实际使用中不可达(需要 MAX_SAFE 次成功保存),但"我们自己的写路径造出
      // 一个损坏信封"是必须由代码保证不可能的性质,而不是靠概率。
      if (revision >= Number.MAX_SAFE_INTEGER) {
        throw new FinancialPlanUnavailableError();
      }

      const envelope: StoredFinancialPlan = {
        version: FINANCIAL_PLAN_STORED_VERSION,
        revision,
        updatedAt: nowMs,
        inputs,
      };

      this.db
        .prepare(
          `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
        )
        .run(FINANCIAL_PLAN_SETTINGS_KEY, JSON.stringify(envelope), nowMs);

      return { ...envelope, analysis };
    });

    return run.immediate();
  }

  // ── 内部 ───────────────────────────────────────────────────────────────────

  /**
   * 重放判定:只认"紧邻的前一个修订号 + 完全相同的输入"。
   *
   * 为什么不放宽到任意旧 revision:`A` 保存后改成 `B` 再改回 `A`,与"客户端拿着 A 的
   * 旧快照重试"在这里无法区分,而后者会让一个新客户端静默覆盖更新的数据。
   *
   * `expectedRevision === 0` 是特例:它是"创建"的声明,而创建成功只可能来自空状态,
   * 所以只有当前恰好是 revision 1 且输入相同时才算重放。rev 1 的输入与用户最初提交的
   * 完全一致,因此不存在覆盖别人修改的风险。
   */
  private isIdempotentReplay(
    current: StoredFinancialPlan,
    expectedRevision: number,
    inputs: FinancialPlanInputs,
  ): boolean {
    const isPreviousRevision = expectedRevision === current.revision - 1;
    const isCreateRetry = expectedRevision === 0 && current.revision === 1;
    if (!isPreviousRevision && !isCreateRetry) return false;
    return (
      current.inputs.monthlyIncomeCents === inputs.monthlyIncomeCents &&
      current.inputs.essentialMonthlyCents === inputs.essentialMonthlyCents &&
      current.inputs.reserveBalanceCents === inputs.reserveBalanceCents
    );
  }

  private readStored(): StoredFinancialPlan | null {
    const row = this.db
      .prepare('SELECT value_json FROM settings WHERE key = ?')
      .get(FINANCIAL_PLAN_SETTINGS_KEY) as SettingsRow | undefined;
    if (row === undefined) return null;

    const stored = parseStoredEnvelope(row.value_json);
    // 有一行但读不懂 = 损坏。绝不返回 null(那会让下一次保存覆盖它)。
    if (stored === undefined) throw new FinancialPlanUnavailableError();

    // 信封形状合法还不够:派生值也必须可表示。一个"输入都在安全范围、但 target 或
    // 12 个月投影越界"的信封同样是坏数据——写入时代码不会产生它,所以出现即视为被
    // 外部改动或旧版本遗留。此时回 400 会误导用户以为请求有问题,必须回 503,
    // 且**不能**让随后的保存把它覆盖掉。
    try {
      computeFinancialPlanAnalysis(stored.inputs);
    } catch (error) {
      if (error instanceof FinancialPlanInputError) throw new FinancialPlanUnavailableError();
      throw error;
    }

    return stored;
  }

  private requireBody(raw: unknown): Record<string, unknown> {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new FinancialPlanInvalidError(
        'The request body must be an object with expectedRevision and the three plan amounts.',
      );
    }
    return raw as Record<string, unknown>;
  }

  /**
   * `expectedRevision` 必须是 >= 0 的安全整数。
   *
   * 缺失也走这里:没有修订号就无法安全覆盖,静默当成 0 会把"更新"变成"创建"。
   */
  private requireExpectedRevision(value: unknown): number {
    if (value === undefined) {
      throw new FinancialPlanInvalidError(
        'expectedRevision is required. Send 0 to create the first plan, or the revision you loaded.',
      );
    }
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      throw new FinancialPlanInvalidError('expectedRevision must be a non-negative integer.');
    }
    return value;
  }

  /** 把 shared 的纯校验错误翻译成 400,由路由返回统一错误体。 */
  private requireInputs(raw: unknown): FinancialPlanInputs {
    try {
      return validateFinancialPlanInputs(raw);
    } catch (error) {
      if (error instanceof FinancialPlanInputError) {
        throw new FinancialPlanInvalidError(error.message);
      }
      throw error;
    }
  }

  private computeAnalysis(inputs: FinancialPlanInputs): FinancialPlanAnalysis {
    try {
      return computeFinancialPlanAnalysis(inputs);
    } catch (error) {
      if (error instanceof FinancialPlanInputError) {
        throw new FinancialPlanInvalidError(error.message);
      }
      throw error;
    }
  }
}
