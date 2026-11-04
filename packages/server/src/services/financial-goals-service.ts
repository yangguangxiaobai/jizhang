/**
 * 手动存钱与投资进度服务(C4 / F08+F09)。
 *
 * ## 这个模块只记录“用户确认过的进度”
 *
 * 起始余额与存入/取出记录都是**手动确认的事实**,不是银行余额、不是工资、不是
 * 转账、也不是账本账单。因此这里:
 *
 * - 不读写 `transactions` / `salaries` / `transfers` / `accounts`;
 * - 不把技能消费自动记成投资投入,也不把月计划预留记成已投入;
 * - 应急余额与投资本金**分开**输出,相加不构成“核验资产”。
 *
 * ## 写入协议(与其他财务写操作一致)
 *
 * 每次写入都带 `operationId`(UUID)+ `expectedRevision`(全局目标状态修订号):
 *
 * 1. **先判重放**:同一个 `operationId` + 同一语义请求 → 原样返回上次结果,
 *    不再跑修订/历史校验(否则“上次其实成功了”会变成 409)。
 * 2. **同 key 不同请求 → 409 `FINANCIAL_OPERATION_MISMATCH`**。
 * 3. **失败不消耗 key**:领域写入与重放登记在同一事务里,一起回滚。
 *
 * ## 原子历史校验
 *
 * 新增/编辑/删除/改起始值都会构造**完整的候选历史**(两个目标各自逐笔重放),
 * 任意一步余额为负即整体拒绝:返回 409 `FINANCIAL_GOAL_HISTORY_CONFLICT`,
 * 一行都不写,连重放登记也回滚。
 */
import { randomUUID } from 'node:crypto';
import {
  MANUAL_GOAL_PROGRESS_CONTRACT_VERSION,
  ManualGoalProgressInputError,
  computeReserveProgress,
  manualGoalBalanceAsOf,
  manualGoalPeriodTotals,
  manualGoalTotals,
  requireCents,
  requireEpochMs,
  requireManualGoal,
  requireManualGoalEntryKind,
  requireManualGoalNote,
  replayManualGoalHistory,
  type ManualGoal,
  type ManualGoalEntryFact,
  type ManualGoalHistory,
} from '@jizhang/shared';
import type { Db } from '../db/index.js';
import {
  FinancialInvalidError,
  FinancialNotFoundError,
  FinancialRevisionConflictError,
  FinancialUnavailableError,
  FinancialWindowConflictError,
} from './financial-errors.js';
import { requireFinancialOperationId } from './financial-operation-store.js';
import { FinancialPlanningConfigService } from './financial-planning-config.js';
import { requireObject, requireSafeInteger } from './financial-planning-types.js';
import { MonthlyPlanService } from './monthly-plan-service.js';
import {
  FINANCIAL_GOALS_BASE,
  FINANCIAL_GOALS_DEFAULT_PAGE_SIZE,
  FINANCIAL_GOALS_MAX_PAGE_SIZE,
  getManualGoalOperation,
  insertEntry,
  insertOpening,
  listAllLiveEntryRows,
  listEntryPage,
  listLiveEntryRows,
  readEntryRow,
  readGoalRevision,
  readOpening,
  readOpenings,
  runManualGoalOperation,
  softDeleteEntry,
  updateEntry,
  updateOpening,
  writeGoalRevision,
  type ManualGoalEntryCursor,
  type ManualGoalEntryRow,
  type ManualGoalOperationRecord,
} from './financial-goal-store.js';

/** 手动进度的唯一来源标签。客户端必须原样显示“手动确认”,不能当成银行核验。 */
export const MANUAL_GOAL_SOURCE = 'manual-confirmed' as const;

/**
 * 409 —— 这次改动会让**已有的后续记录**失去资金支持(或早于新的起始日期)。
 *
 * 与 400 的分工:请求本身的值非法(负金额、非整数分、未来日期)→ 400;
 * 值与已有历史冲突 → 409,客户端应提示“这笔改动会破坏已确认记录”。
 */
export class FinancialGoalHistoryConflictError extends Error {
  readonly statusCode = 409;
  readonly code = 'FINANCIAL_GOAL_HISTORY_CONFLICT';
  constructor(message: string) {
    super(message);
    this.name = 'FinancialGoalHistoryConflictError';
  }
}

export interface FinancialGoalsOptions {
  readonly now?: (() => number) | undefined;
  /** 重放作用域的操作者覆盖(测试用);缺省取单用户表里的唯一用户。 */
  readonly actorId?: string | undefined;
}

export interface FinancialGoalOpeningView {
  readonly goal: ManualGoal;
  readonly openingCents: number;
  readonly openingAt: number;
  readonly revision: number;
  readonly updatedAt: number;
}

export interface FinancialGoalProgressView {
  readonly source: typeof MANUAL_GOAL_SOURCE;
  readonly openingCents: number;
  readonly openingAt: number;
  readonly depositCents: number;
  readonly withdrawalCents: number;
  readonly balanceCents: number | null;
  readonly targetState: 'ready' | 'no-baseline' | 'not-applicable' | 'not-started';
  readonly targetCents: number | null;
  readonly progressBasisPoints: number | null;
  readonly progressPercent: number | null;
  readonly gapCents: number | null;
  readonly surplusCents: number | null;
  readonly conditionalContributionCount: number | null;
  readonly essentialMonthlyCents: number | null;
  readonly targetMonths: number | null;
  readonly monthlyReferenceCents: number | null;
}

export interface FinancialGoalWindowView {
  readonly from: number;
  readonly to: number;
  readonly entryCount: number;
  readonly reserve: FinancialGoalWindowSlice;
  readonly investment: FinancialGoalWindowSlice;
}

export interface FinancialGoalWindowSlice {
  readonly depositCents: number;
  readonly withdrawalCents: number;
  readonly netAdditionsCents: number;
  readonly entryCount: number;
}

export interface FinancialGoalView {
  readonly contractVersion: 1;
  readonly calculatedAt: number;
  readonly source: typeof MANUAL_GOAL_SOURCE;
  /** 全局目标状态修订号;写操作的 `expectedRevision` 就是它。 */
  readonly revision: number;
  readonly state: 'ready' | 'not-configured';
  readonly opening: {
    readonly reserve: FinancialGoalOpeningView | null;
    readonly investment: FinancialGoalOpeningView | null;
  };
  readonly progress: {
    readonly asOf: number;
    readonly reserve: FinancialGoalProgressView | null;
    readonly investment: FinancialGoalProgressView | null;
  };
  /** 请求带了 `from`/`to` 才有;两个都没带时为 `null`(绝不自己编窗口)。 */
  readonly window: FinancialGoalWindowView | null;
}

export interface FinancialGoalEntryDto {
  readonly id: string;
  readonly goal: ManualGoal;
  readonly kind: 'deposit' | 'withdrawal';
  readonly amountCents: number;
  readonly date: number;
  readonly note: string;
  readonly revision: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly deletedAt: number | null;
}

export interface FinancialGoalEntryPageView {
  readonly contractVersion: 1;
  readonly calculatedAt: number;
  readonly source: typeof MANUAL_GOAL_SOURCE;
  readonly revision: number;
  readonly items: readonly FinancialGoalEntryDto[];
  readonly total: number;
  readonly limit: number;
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
}

/** 写操作的统一响应:完整进度视图 + 受影响的记录(非记录写作为 `null`)。 */
export interface FinancialGoalMutationView extends FinancialGoalView {
  readonly entry: FinancialGoalEntryDto | null;
}

export interface FinancialGoalOperationView {
  readonly contractVersion: 1;
  readonly calculatedAt: number;
  readonly source: typeof MANUAL_GOAL_SOURCE;
  readonly operationId: string;
  readonly method: string;
  readonly resource: string;
  readonly statusCode: number;
  readonly response: unknown;
  readonly committedAt: number;
  readonly operation: ManualGoalOperationRecord;
}

/** 写操作的路由结果:状态码 + 完整进度视图(含受影响的记录)。 */
export interface FinancialGoalWriteResult {
  readonly statusCode: number;
  readonly body: FinancialGoalMutationView;
}

interface OpeningCandidate {
  readonly openingCents: number;
  readonly openingAt: number;
}

interface EntryDraft {
  readonly goal: ManualGoal;
  readonly kind: 'deposit' | 'withdrawal';
  readonly amountCents: number;
  readonly date: number;
  readonly note: string;
}

function entryFactFromRow(row: ManualGoalEntryRow): ManualGoalEntryFact {
  return {
    id: row.id,
    goal: row.goal,
    kind: row.kind,
    amountCents: row.amount_cents,
    date: row.date,
    createdAt: row.created_at,
  };
}

function toEntryDto(row: ManualGoalEntryRow): FinancialGoalEntryDto {
  return {
    id: row.id,
    goal: row.goal,
    kind: row.kind,
    amountCents: row.amount_cents,
    date: row.date,
    note: row.note,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function encodeCursor(row: ManualGoalEntryRow): string {
  return Buffer.from(`${row.date}:${row.id}`, 'utf8').toString('base64url');
}

function decodeCursor(raw: unknown): ManualGoalEntryCursor | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (typeof raw !== 'string') throw new FinancialInvalidError('cursor must be a string.');
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator <= 0 || separator === decoded.length - 1) {
    throw new FinancialInvalidError('cursor is not a cursor returned by this server.');
  }
  const date = Number(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);
  if (!Number.isSafeInteger(date) || date < 0) {
    throw new FinancialInvalidError('cursor is not a cursor returned by this server.');
  }
  return { date, id };
}

export class FinancialGoalsService {
  private readonly db: Db;
  private readonly now: () => number;
  private readonly actorIdOption: string | undefined;
  private readonly configService: FinancialPlanningConfigService;

  constructor(db: Db, options: FinancialGoalsOptions = {}) {
    this.db = db;
    this.now = options.now ?? (() => Date.now());
    this.actorIdOption = options.actorId;
    this.configService = new FinancialPlanningConfigService(db, {
      now: this.now,
      actorId: options.actorId,
    });
  }

  // ── 读取 ────────────────────────────────────────────────────────────────────

  view(rawQuery: Record<string, unknown> = {}): FinancialGoalView {
    const calculatedAt = this.now();
    return this.assembleView(this.parseWindow(rawQuery), calculatedAt);
  }

  listEntries(rawQuery: Record<string, unknown> = {}): FinancialGoalEntryPageView {
    const goalRaw = rawQuery['goal'];
    const goal =
      goalRaw === undefined || goalRaw === ''
        ? undefined
        : this.sharedInput(() => requireManualGoal(goalRaw, 'goal'));
    const from = this.optionalQueryInteger(rawQuery['from'], 'from');
    const to = this.optionalQueryInteger(rawQuery['to'], 'to');
    if (from !== undefined && to !== undefined && to <= from) {
      throw new FinancialInvalidError('to must be greater than from.');
    }
    const limit = this.parseLimit(rawQuery['limit']);
    const cursor = decodeCursor(rawQuery['cursor']);
    const includeDeleted = this.parseBooleanFlag(rawQuery['includeDeleted']);

    const page = listEntryPage(this.db, { goal, from, to, includeDeleted, cursor, limit });
    const items = page.rows.map(toEntryDto);
    const last = page.rows[page.rows.length - 1];
    return {
      contractVersion: MANUAL_GOAL_PROGRESS_CONTRACT_VERSION,
      calculatedAt: this.now(),
      source: MANUAL_GOAL_SOURCE,
      revision: readGoalRevision(this.db),
      items,
      total: page.total,
      limit,
      hasMore: page.hasMore,
      nextCursor: page.hasMore && last !== undefined ? encodeCursor(last) : null,
    };
  }

  /** 未知结果查询:别人的 key 与不存在的 key 都是 `undefined`(路由统一 404)。 */
  operation(operationId: string): FinancialGoalOperationView | undefined {
    const record = getManualGoalOperation(this.db, operationId, this.actorId());
    if (record === undefined) return undefined;
    return {
      contractVersion: MANUAL_GOAL_PROGRESS_CONTRACT_VERSION,
      calculatedAt: this.now(),
      source: MANUAL_GOAL_SOURCE,
      ...record,
      operation: record,
    };
  }

  // ── 写入 ────────────────────────────────────────────────────────────────────

  putOpening(rawBody: unknown): FinancialGoalWriteResult {
    const { body, operationId, expectedRevision } = this.parseWriteBody(rawBody);
    const goal = this.sharedInput(() => requireManualGoal(body['goal']));
    const openingCents = this.sharedInput(() => requireCents(body['openingCents'], 'openingCents'));
    const openingAt = this.sharedInput(() => requireEpochMs(body['openingAt'], 'openingAt', 1));
    const now = this.now();
    if (openingAt > now) {
      throw new FinancialInvalidError('openingAt cannot be in the future.');
    }
    const actorId = this.actorId();
    const candidate: OpeningCandidate = { openingCents, openingAt };

    return this.runWrite(
      {
        operationId,
        actorId,
        method: 'PUT',
        resource: `${FINANCIAL_GOALS_BASE}/opening`,
        canonicalPayload: { goal, openingCents, openingAt, expectedRevision },
        now,
      },
      () => {
        this.assertRevision(expectedRevision);
        const existing = readOpening(this.db, goal);
        const facts = listLiveEntryRows(this.db, goal).map(entryFactFromRow);
        this.replay(candidate, facts);
        if (existing === undefined) {
          insertOpening(this.db, { goal, openingCents, openingAt, actorId, operationId, now });
        } else {
          updateOpening(this.db, { goal, openingCents, openingAt, actorId, operationId, now });
        }
        writeGoalRevision(this.db, expectedRevision + 1, now);
        return { statusCode: 200, response: { ...this.assembleView(null, now), entry: null } };
      },
    );
  }

  createEntry(rawBody: unknown): FinancialGoalWriteResult {
    const { body, operationId, expectedRevision } = this.parseWriteBody(rawBody);
    const draft: EntryDraft = {
      goal: this.sharedInput(() => requireManualGoal(body['goal'])),
      kind: this.sharedInput(() => requireManualGoalEntryKind(body['kind'])),
      amountCents: this.sharedInput(() => requireCents(body['amountCents'], 'amountCents', 1)),
      date: this.sharedInput(() => requireEpochMs(body['date'], 'date', 1)),
      note: this.sharedInput(() => requireManualGoalNote(body['note'])),
    };
    const now = this.now();
    if (draft.date > now) {
      throw new FinancialInvalidError('date cannot be in the future.');
    }
    const actorId = this.actorId();
    const entryId = randomUUID();

    return this.runWrite(
      {
        operationId,
        actorId,
        method: 'POST',
        resource: `${FINANCIAL_GOALS_BASE}/entries`,
        canonicalPayload: { ...draft, expectedRevision },
        now,
      },
      () => {
        this.assertRevision(expectedRevision);
        const opening = readOpening(this.db, draft.goal);
        if (opening === undefined) {
          throw new FinancialInvalidError(
            `Confirm the ${draft.goal} opening balance before recording progress entries.`,
          );
        }
        if (draft.date < opening.opening_at) {
          throw new FinancialInvalidError('date cannot be earlier than the confirmed opening date.');
        }
        const facts = [
          ...listLiveEntryRows(this.db, draft.goal).map(entryFactFromRow),
          {
            id: entryId,
            goal: draft.goal,
            kind: draft.kind,
            amountCents: draft.amountCents,
            date: draft.date,
            createdAt: now,
          } satisfies ManualGoalEntryFact,
        ];
        this.replay(
          { openingCents: opening.opening_cents, openingAt: opening.opening_at },
          facts,
        );
        insertEntry(this.db, {
          id: entryId,
          goal: draft.goal,
          kind: draft.kind,
          amountCents: draft.amountCents,
          date: draft.date,
          note: draft.note,
          actorId,
          operationId,
          now,
        });
        writeGoalRevision(this.db, expectedRevision + 1, now);
        const row = readEntryRow(this.db, entryId);
        if (row === undefined) throw new FinancialUnavailableError();
        return {
          statusCode: 201,
          response: { ...this.assembleView(null, now), entry: toEntryDto(row) },
        };
      },
    );
  }

  patchEntry(entryId: string, rawBody: unknown): FinancialGoalWriteResult {
    const { body, operationId, expectedRevision } = this.parseWriteBody(rawBody);
    const now = this.now();
    const actorId = this.actorId();

    const goal =
      body['goal'] === undefined
        ? undefined
        : this.sharedInput(() => requireManualGoal(body['goal']));
    const kind =
      body['kind'] === undefined
        ? undefined
        : this.sharedInput(() => requireManualGoalEntryKind(body['kind']));
    const amountCents =
      body['amountCents'] === undefined
        ? undefined
        : this.sharedInput(() => requireCents(body['amountCents'], 'amountCents', 1));
    const date =
      body['date'] === undefined
        ? undefined
        : this.sharedInput(() => requireEpochMs(body['date'], 'date', 1));
    const note =
      body['note'] === undefined
        ? undefined
        : this.sharedInput(() => requireManualGoalNote(body['note']));

    if (date !== undefined && date > now) {
      throw new FinancialInvalidError('date cannot be in the future.');
    }

    const canonicalPayload: Record<string, unknown> = { expectedRevision };
    if (goal !== undefined) canonicalPayload['goal'] = goal;
    if (kind !== undefined) canonicalPayload['kind'] = kind;
    if (amountCents !== undefined) canonicalPayload['amountCents'] = amountCents;
    if (date !== undefined) canonicalPayload['date'] = date;
    if (note !== undefined) canonicalPayload['note'] = note;

    return this.runWrite(
      {
        operationId,
        actorId,
        method: 'PATCH',
        resource: `${FINANCIAL_GOALS_BASE}/entries/${entryId}`,
        canonicalPayload,
        now,
      },
      () => {
        this.assertRevision(expectedRevision);
        const existing = readEntryRow(this.db, entryId);
        if (existing === undefined || existing.deleted_at !== null) {
          throw new FinancialNotFoundError('This progress entry does not exist.');
        }
        const effectiveGoal = goal ?? existing.goal;
        const effectiveKind = kind ?? existing.kind;
        const effectiveAmount = amountCents ?? existing.amount_cents;
        const effectiveDate = date ?? existing.date;
        const effectiveNote = note ?? existing.note;

        const targetOpening = readOpening(this.db, effectiveGoal);
        if (targetOpening !== undefined && effectiveDate < targetOpening.opening_at) {
          throw new FinancialInvalidError('date cannot be earlier than the confirmed opening date.');
        }
        const candidates = listAllLiveEntryRows(this.db).map((row) =>
          row.id === entryId
            ? {
                id: row.id,
                goal: effectiveGoal,
                kind: effectiveKind,
                amountCents: effectiveAmount,
                date: effectiveDate,
                createdAt: row.created_at,
              }
            : entryFactFromRow(row),
        );
        this.replayAll(candidates);
        updateEntry(this.db, {
          id: entryId,
          goal: effectiveGoal,
          kind: effectiveKind,
          amountCents: effectiveAmount,
          date: effectiveDate,
          note: effectiveNote,
          operationId,
          now,
        });
        writeGoalRevision(this.db, expectedRevision + 1, now);
        const row = readEntryRow(this.db, entryId);
        if (row === undefined) throw new FinancialUnavailableError();
        return {
          statusCode: 200,
          response: { ...this.assembleView(null, now), entry: toEntryDto(row) },
        };
      },
    );
  }

  deleteEntry(entryId: string, rawBody: unknown): FinancialGoalWriteResult {
    const { operationId, expectedRevision } = this.parseWriteBody(rawBody);
    const now = this.now();
    const actorId = this.actorId();

    return this.runWrite(
      {
        operationId,
        actorId,
        method: 'DELETE',
        resource: `${FINANCIAL_GOALS_BASE}/entries/${entryId}`,
        canonicalPayload: { expectedRevision },
        now,
      },
      () => {
        this.assertRevision(expectedRevision);
        const existing = readEntryRow(this.db, entryId);
        if (existing === undefined || existing.deleted_at !== null) {
          throw new FinancialNotFoundError('This progress entry does not exist.');
        }
        const candidates = listAllLiveEntryRows(this.db)
          .filter((row) => row.id !== entryId)
          .map(entryFactFromRow);
        this.replayAll(candidates);
        softDeleteEntry(this.db, { id: entryId, operationId, now });
        writeGoalRevision(this.db, expectedRevision + 1, now);
        const row = readEntryRow(this.db, entryId);
        if (row === undefined) throw new FinancialUnavailableError();
        return {
          statusCode: 200,
          response: { ...this.assembleView(null, now), entry: toEntryDto(row) },
        };
      },
    );
  }

  // ── 视图组装 ────────────────────────────────────────────────────────────────

  private assembleView(
    window: { readonly from: number; readonly to: number } | null,
    calculatedAt: number = this.now(),
  ): FinancialGoalView {
    const openings = readOpenings(this.db);
    const factsByGoal: Record<ManualGoal, ManualGoalEntryFact[]> = {
      reserve: [],
      investment: [],
    };
    for (const row of listAllLiveEntryRows(this.db)) {
      factsByGoal[row.goal].push(entryFactFromRow(row));
    }

    const asOf = window !== null ? Math.min(calculatedAt, window.to - 1) : calculatedAt;

    const reserveOpening = openings.get('reserve');
    const investmentOpening = openings.get('investment');
    const progress = {
      asOf,
      reserve:
        reserveOpening === undefined
          ? null
          : this.reserveProgressView(reserveOpening, factsByGoal.reserve, asOf, calculatedAt, window !== null),
      investment:
        investmentOpening === undefined
          ? null
          : this.investmentProgressView(investmentOpening, factsByGoal.investment, asOf),
    };

    let windowView: FinancialGoalWindowView | null = null;
    if (window !== null) {
      const reserve = this.mapFacts(() =>
        manualGoalPeriodTotals({
          entries: factsByGoal.reserve,
          from: window.from,
          to: window.to,
        }),
      );
      const investment = this.mapFacts(() =>
        manualGoalPeriodTotals({
          entries: factsByGoal.investment,
          from: window.from,
          to: window.to,
        }),
      );
      windowView = {
        from: window.from,
        to: window.to,
        entryCount: reserve.entryCount + investment.entryCount,
        reserve: {
          depositCents: reserve.depositCents,
          withdrawalCents: reserve.withdrawalCents,
          netAdditionsCents: reserve.netCents,
          entryCount: reserve.entryCount,
        },
        investment: {
          depositCents: investment.depositCents,
          withdrawalCents: investment.withdrawalCents,
          netAdditionsCents: investment.netCents,
          entryCount: investment.entryCount,
        },
      };
    }

    return {
      contractVersion: MANUAL_GOAL_PROGRESS_CONTRACT_VERSION,
      calculatedAt,
      source: MANUAL_GOAL_SOURCE,
      revision: readGoalRevision(this.db),
      state: openings.size > 0 ? 'ready' : 'not-configured',
      opening: {
        reserve: reserveOpening === undefined ? null : this.openingView(reserveOpening),
        investment:
          investmentOpening === undefined ? null : this.openingView(investmentOpening),
      },
      progress,
      window: windowView,
    };
  }

  private openingView(row: {
    readonly goal: ManualGoal;
    readonly opening_cents: number;
    readonly opening_at: number;
    readonly revision: number;
    readonly updated_at: number;
  }): FinancialGoalOpeningView {
    return {
      goal: row.goal,
      openingCents: row.opening_cents,
      openingAt: row.opening_at,
      revision: row.revision,
      updatedAt: row.updated_at,
    };
  }

  private reserveProgressView(
    opening: { readonly opening_cents: number; readonly opening_at: number },
    facts: readonly ManualGoalEntryFact[],
    asOf: number,
    calculatedAt: number,
    isWindow: boolean,
  ): FinancialGoalProgressView {
    if (asOf < opening.opening_at) {
      return {
        source: MANUAL_GOAL_SOURCE,
        openingCents: opening.opening_cents,
        openingAt: opening.opening_at,
        depositCents: 0,
        withdrawalCents: 0,
        balanceCents: null,
        targetState: 'not-started',
        targetCents: null,
        progressBasisPoints: null,
        progressPercent: null,
        gapCents: null,
        surplusCents: null,
        conditionalContributionCount: null,
        essentialMonthlyCents: null,
        targetMonths: null,
        monthlyReferenceCents: null,
      };
    }
    const factsUpToAsOf = facts.filter((f) => f.date <= asOf);
    const totals = this.mapFacts(() => manualGoalTotals(factsUpToAsOf));
    const balanceCents = this.mapFacts(() =>
      manualGoalBalanceAsOf({
        openingCents: opening.opening_cents,
        entries: factsUpToAsOf,
        asOf,
      }),
    );
    const config = this.configService.readConfig();
    const monthlyReferenceCents = isWindow ? null : this.monthlyReserveReferenceCents(calculatedAt);
    const progress = this.mapFacts(() =>
      computeReserveProgress({
        balanceCents,
        essentialMonthlyCents: config.essentialMonthlyCents,
        targetMonths: config.targetMonths,
        monthlyReferenceCents,
      }),
    );
    return {
      source: MANUAL_GOAL_SOURCE,
      openingCents: opening.opening_cents,
      openingAt: opening.opening_at,
      depositCents: totals.depositCents,
      withdrawalCents: totals.withdrawalCents,
      balanceCents,
      targetState: progress.targetState,
      targetCents: progress.targetCents,
      progressBasisPoints: progress.progressBasisPoints,
      progressPercent: progress.progressPercent,
      gapCents: progress.gapCents,
      surplusCents: progress.surplusCents,
      conditionalContributionCount: progress.conditionalContributionCount,
      essentialMonthlyCents: config.essentialMonthlyCents,
      targetMonths: config.targetMonths,
      monthlyReferenceCents,
    };
  }

  private investmentProgressView(
    opening: { readonly opening_cents: number; readonly opening_at: number },
    facts: readonly ManualGoalEntryFact[],
    asOf: number,
  ): FinancialGoalProgressView {
    if (asOf < opening.opening_at) {
      return {
        source: MANUAL_GOAL_SOURCE,
        openingCents: opening.opening_cents,
        openingAt: opening.opening_at,
        depositCents: 0,
        withdrawalCents: 0,
        balanceCents: null,
        targetState: 'not-started',
        targetCents: null,
        progressBasisPoints: null,
        progressPercent: null,
        gapCents: null,
        surplusCents: null,
        conditionalContributionCount: null,
        essentialMonthlyCents: null,
        targetMonths: null,
        monthlyReferenceCents: null,
      };
    }
    const factsUpToAsOf = facts.filter((f) => f.date <= asOf);
    const totals = this.mapFacts(() => manualGoalTotals(factsUpToAsOf));
    const balanceCents = this.mapFacts(() =>
      manualGoalBalanceAsOf({
        openingCents: opening.opening_cents,
        entries: factsUpToAsOf,
        asOf,
      }),
    );
    return {
      source: MANUAL_GOAL_SOURCE,
      openingCents: opening.opening_cents,
      openingAt: opening.opening_at,
      depositCents: totals.depositCents,
      withdrawalCents: totals.withdrawalCents,
      balanceCents,
      targetState: 'not-applicable',
      targetCents: null,
      progressBasisPoints: null,
      progressPercent: null,
      gapCents: null,
      surplusCents: null,
      conditionalContributionCount: null,
      essentialMonthlyCents: null,
      targetMonths: null,
      monthlyReferenceCents: null,
    };
  }

  /**
   * 未来每月的应急参考额 = 当前包含 calculatedAt 的已冻结周期的 targetsCents.reserve。
   *
   * 仅在当前月计划为 `ready` 状态且未决原因不包含 `salary-source-changed` 或
   * `no-confirmed-salary-source` 时可用；无方案、未配置、冲突或参考不可用时返回 `null`。
   */
  private monthlyReserveReferenceCents(calculatedAt: number): number | null {
    try {
      const monthlyPlanService = new MonthlyPlanService(this.db, {
        now: () => calculatedAt,
        actorId: this.actorIdOption,
      });
      const plan = monthlyPlanService.getMonthlyPlan();
      if (plan.state !== 'ready' || plan.targetsCents === null) return null;
      if (
        plan.unresolved.reasons.includes('salary-source-changed') ||
        plan.unresolved.reasons.includes('no-confirmed-salary-source')
      ) {
        return null;
      }
      const reserve = plan.targetsCents.reserve;
      if (!Number.isSafeInteger(reserve) || reserve < 0) return null;
      return reserve;
    } catch (e) {
      if (e instanceof FinancialWindowConflictError || e instanceof FinancialUnavailableError) {
        return null;
      }
      throw e;
    }
  }

  // ── 校验 ────────────────────────────────────────────────────────────────────

  private parseWriteBody(rawBody: unknown): {
    body: Record<string, unknown>;
    operationId: string;
    expectedRevision: number;
  } {
    const body = requireObject(rawBody, 'The request body must be an object.');
    const operationId = requireFinancialOperationId(body['operationId']);
    const expectedRevision = requireSafeInteger(body['expectedRevision'], 'expectedRevision', 0);
    return { body, operationId, expectedRevision };
  }

  private parseWindow(
    query: Record<string, unknown>,
  ): { from: number; to: number } | null {
    const from = this.optionalQueryInteger(query['from'], 'from');
    const to = this.optionalQueryInteger(query['to'], 'to');
    if (from === undefined && to === undefined) return null;
    if (from === undefined || to === undefined) {
      throw new FinancialInvalidError('from and to must be provided together.');
    }
    if (to <= from) {
      throw new FinancialInvalidError('to must be greater than from.');
    }
    return { from, to };
  }

  private optionalQueryInteger(value: unknown, field: string): number | undefined {
    if (value === undefined || value === '') return undefined;
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new FinancialInvalidError(`${field} must be an integer >= 0.`);
    }
    return parsed;
  }

  private parseLimit(value: unknown): number {
    if (value === undefined || value === '') return FINANCIAL_GOALS_DEFAULT_PAGE_SIZE;
    const parsed = typeof value === 'number' ? value : Number(value);
    if (
      !Number.isSafeInteger(parsed) ||
      parsed < 1 ||
      parsed > FINANCIAL_GOALS_MAX_PAGE_SIZE
    ) {
      throw new FinancialInvalidError(
        `limit must be an integer between 1 and ${FINANCIAL_GOALS_MAX_PAGE_SIZE}.`,
      );
    }
    return parsed;
  }

  private parseBooleanFlag(value: unknown): boolean {
    return value === true || value === '1' || value === 'true';
  }

  private assertRevision(expectedRevision: number): void {
    const current = readGoalRevision(this.db);
    if (current !== expectedRevision) {
      throw new FinancialRevisionConflictError(
        'The manual goal state changed elsewhere. Reload it before saving again.',
      );
    }
  }

  /** 参数校验阶段:shared 纯错误 → 400 FINANCIAL_INVALID。 */
  private sharedInput<T>(run: () => T): T {
    try {
      return run();
    } catch (error) {
      if (error instanceof ManualGoalProgressInputError) {
        throw new FinancialInvalidError(error.message);
      }
      throw error;
    }
  }

  /** 读取已存事实:shared 纯错误说明库里的事实无法解释 → 503。 */
  private mapFacts<T>(run: () => T): T {
    try {
      return run();
    } catch (error) {
      if (error instanceof ManualGoalProgressInputError) {
        throw new FinancialUnavailableError();
      }
      throw error;
    }
  }

  /** 单个目标的历史重放:金额/日期不自洽 → 400,与既有历史冲突 → 409。 */
  private replay(
    opening: OpeningCandidate,
    entries: readonly ManualGoalEntryFact[],
  ): ManualGoalHistory {
    try {
      return replayManualGoalHistory({
        openingCents: opening.openingCents,
        openingAt: opening.openingAt,
        entries,
      });
    } catch (error) {
      throw this.mapHistoryError(error);
    }
  }

  /** 两个目标都重放(编辑可能把记录从一个目标移到另一个目标)。 */
  private replayAll(candidates: readonly ManualGoalEntryFact[]): void {
    const openings = readOpenings(this.db);
    for (const goal of ['reserve', 'investment'] as const) {
      const facts = candidates.filter((fact) => fact.goal === goal);
      if (facts.length === 0) continue;
      const opening = openings.get(goal);
      if (opening === undefined) {
        // 有记录却没有起始值 = 存储被外部改坏,不是客户端能修的状态。
        throw new FinancialUnavailableError();
      }
      this.replay(
        { openingCents: opening.opening_cents, openingAt: opening.opening_at },
        facts,
      );
    }
  }

  private mapHistoryError(error: unknown): Error {
    if (error instanceof ManualGoalProgressInputError) {
      if (error.code === 'ENTRY_BEFORE_OPENING' || error.code === 'HISTORY_UNFUNDED') {
        return new FinancialGoalHistoryConflictError(error.message);
      }
      return new FinancialInvalidError(error.message);
    }
    return error instanceof Error ? error : new Error('Unknown manual goal failure.');
  }

  private runWrite(
    input: {
      readonly operationId: string;
      readonly actorId: string;
      readonly method: string;
      readonly resource: string;
      readonly canonicalPayload: unknown;
      readonly now: number;
    },
    commit: () => { statusCode: number; response: FinancialGoalMutationView },
  ): FinancialGoalWriteResult {
    const result = runManualGoalOperation(this.db, input, commit);
    return { statusCode: result.statusCode, body: result.response };
  }

  /** 重放作用域的操作者:显式覆盖优先,否则取单用户表里的唯一用户。 */
  private actorId(): string {
    if (this.actorIdOption !== undefined && this.actorIdOption !== '') {
      return this.actorIdOption;
    }
    const row = this.db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get() as
      | { id: string }
      | undefined;
    if (row === undefined) throw new FinancialInvalidError('No account exists on this server yet.');
    return row.id;
  }
}
