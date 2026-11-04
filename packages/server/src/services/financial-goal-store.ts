/**
 * 手动目标进度的**持久化层**(SQLite 行 ↔ 领域事实)。
 *
 * 只做三件事:读/写 `manual_goal_*` 表、把行映射成 shared 纯函数需要的事实视图、
 * 以及把一次写入与它的重放记录放进**同一个**事务。金额算术、历史重放、CAS 判定
 * 全部在 `financial-goals-service.ts` + `@jizhang/shared` 里,这里不重复。
 *
 * ## 重放表为什么独立
 *
 * `financial_operations` 属于财务执行(工资周期/退款/用途);手动进度是另一组事实,
 * 共用一张表会让两个模块的 `operationId` 互相顶掉(同一个 UUID 语义不同 → 409),
 * 也会让"清空财务执行"的操作顺带丢掉存钱记录的重放身份。因此本模块有自己的
 * `manual_goal_operations`,但**指纹算法与判定顺序完全复用**
 * `financial-operation-store` 的导出函数(规范化 + SHA-256),不另写一套。
 *
 * ## 作用域
 *
 * 与财务执行一致:键是 `operationId`,读取/比对都要求 `actorId` 相同;别人的
 * `operationId` 一律当作"不存在"(路由回 404),不泄露它存在过。
 */
import type { ManualGoal } from '@jizhang/shared';
import type { Db } from '../db/index.js';
import {
  FinancialOperationMismatchError,
  FinancialUnavailableError,
} from './financial-errors.js';
import {
  hashFinancialOperation,
} from './financial-operation-store.js';

/** 全部新路由的公共前缀。 */
export const FINANCIAL_GOALS_BASE = '/api/v1/financial-goals';

/** 单页上限(与其它财务集合一致)。 */
export const FINANCIAL_GOALS_MAX_PAGE_SIZE = 100;
export const FINANCIAL_GOALS_DEFAULT_PAGE_SIZE = 50;

export interface ManualGoalOpeningRow {
  readonly goal: ManualGoal;
  readonly opening_cents: number;
  readonly opening_at: number;
  readonly revision: number;
  readonly actor_id: string | null;
  readonly operation_id: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface ManualGoalEntryRow {
  readonly id: string;
  readonly goal: ManualGoal;
  readonly kind: 'deposit' | 'withdrawal';
  readonly amount_cents: number;
  readonly date: number;
  readonly note: string;
  readonly revision: number;
  readonly actor_id: string | null;
  readonly operation_id: string | null;
  readonly created_at: number;
  readonly updated_at: number;
  readonly deleted_at: number | null;
}

const ENTRY_COLUMNS =
  'id, goal, kind, amount_cents, date, note, revision, actor_id, operation_id, created_at, updated_at, deleted_at';

// ---------------------------------------------------------------------------
// 修订号
// ---------------------------------------------------------------------------

/** 当前全局目标状态修订号;从未写入过时为 0。 */
export function readGoalRevision(db: Db): number {
  const row = db.prepare('SELECT revision FROM manual_goal_state WHERE id = 1').get() as
    | { revision: number }
    | undefined;
  if (row === undefined) return 0;
  if (!Number.isSafeInteger(row.revision) || row.revision < 0) {
    throw new FinancialUnavailableError();
  }
  return row.revision;
}

/** 落盘新的全局修订号(单行 upsert,首次写入时插入)。 */
export function writeGoalRevision(db: Db, revision: number, now: number): void {
  db.prepare(
    `INSERT INTO manual_goal_state (id, revision, updated_at)
     VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at`,
  ).run(revision, now);
}

// ---------------------------------------------------------------------------
// 起始值
// ---------------------------------------------------------------------------

export function readOpenings(db: Db): Map<ManualGoal, ManualGoalOpeningRow> {
  const rows = db.prepare('SELECT * FROM manual_goal_openings').all() as ManualGoalOpeningRow[];
  const map = new Map<ManualGoal, ManualGoalOpeningRow>();
  for (const row of rows) {
    if (row.goal !== 'reserve' && row.goal !== 'investment') throw new FinancialUnavailableError();
    if (!Number.isSafeInteger(row.opening_cents) || row.opening_cents < 0) {
      throw new FinancialUnavailableError();
    }
    if (!Number.isSafeInteger(row.opening_at) || row.opening_at < 0) {
      throw new FinancialUnavailableError();
    }
    map.set(row.goal, row);
  }
  return map;
}

export function readOpening(db: Db, goal: ManualGoal): ManualGoalOpeningRow | undefined {
  return readOpenings(db).get(goal);
}

export function insertOpening(
  db: Db,
  input: {
    readonly goal: ManualGoal;
    readonly openingCents: number;
    readonly openingAt: number;
    readonly actorId: string;
    readonly operationId: string;
    readonly now: number;
  },
): void {
  db.prepare(
    `INSERT INTO manual_goal_openings
       (goal, opening_cents, opening_at, revision, actor_id, operation_id, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
  ).run(
    input.goal,
    input.openingCents,
    input.openingAt,
    input.actorId,
    input.operationId,
    input.now,
    input.now,
  );
}

export function updateOpening(
  db: Db,
  input: {
    readonly goal: ManualGoal;
    readonly openingCents: number;
    readonly openingAt: number;
    readonly actorId: string;
    readonly operationId: string;
    readonly now: number;
  },
): void {
  db.prepare(
    `UPDATE manual_goal_openings
        SET opening_cents = ?, opening_at = ?, revision = revision + 1,
            actor_id = ?, operation_id = ?, updated_at = ?
      WHERE goal = ?`,
  ).run(
    input.openingCents,
    input.openingAt,
    input.actorId,
    input.operationId,
    input.now,
    input.goal,
  );
}

// ---------------------------------------------------------------------------
// 记录
// ---------------------------------------------------------------------------

export function readEntryRow(db: Db, id: string): ManualGoalEntryRow | undefined {
  return db
    .prepare(`SELECT ${ENTRY_COLUMNS} FROM manual_goal_entries WHERE id = ?`)
    .get(id) as ManualGoalEntryRow | undefined;
}

/** 某个目标的**活跃**记录(全部日期),按时间倒序;历史重放在服务层排序。 */
export function listLiveEntryRows(db: Db, goal: ManualGoal): ManualGoalEntryRow[] {
  return db
    .prepare(
      `SELECT ${ENTRY_COLUMNS} FROM manual_goal_entries
        WHERE goal = ? AND deleted_at IS NULL
        ORDER BY date ASC, created_at ASC, id ASC`,
    )
    .all(goal) as ManualGoalEntryRow[];
}

export function listAllLiveEntryRows(db: Db): ManualGoalEntryRow[] {
  return db
    .prepare(
      `SELECT ${ENTRY_COLUMNS} FROM manual_goal_entries
        WHERE deleted_at IS NULL
        ORDER BY goal ASC, date ASC, created_at ASC, id ASC`,
    )
    .all() as ManualGoalEntryRow[];
}

export interface ManualGoalEntryCursor {
  readonly date: number;
  readonly id: string;
}

export interface ManualGoalEntryPageQuery {
  readonly goal?: ManualGoal | undefined;
  readonly from?: number | undefined;
  readonly to?: number | undefined;
  readonly includeDeleted: boolean;
  readonly cursor?: ManualGoalEntryCursor | undefined;
  readonly limit: number;
}

export interface ManualGoalEntryPage {
  readonly rows: ManualGoalEntryRow[];
  readonly hasMore: boolean;
  readonly total: number;
}

/**
 * 有界游标分页:`date DESC, id DESC`,游标是上一页最后一行的 (date, id)。
 *
 * 计数不带游标(同一筛选条件下的总数),排序键与游标谓词严格一致,
 * 因此翻页不会重排或漏行;`limit` 由服务层限制在 1..100。
 */
export function listEntryPage(db: Db, query: ManualGoalEntryPageQuery): ManualGoalEntryPage {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (!query.includeDeleted) conditions.push('deleted_at IS NULL');
  if (query.goal !== undefined) {
    conditions.push('goal = ?');
    params.push(query.goal);
  }
  if (query.from !== undefined) {
    conditions.push('date >= ?');
    params.push(query.from);
  }
  if (query.to !== undefined) {
    conditions.push('date < ?');
    params.push(query.to);
  }
  const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`;

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c FROM manual_goal_entries ${where}`)
    .get(...params) as { c: number };

  const pageConditions = [...conditions];
  const pageParams = [...params];
  if (query.cursor !== undefined) {
    pageConditions.push('(date < ? OR (date = ? AND id < ?))');
    pageParams.push(query.cursor.date, query.cursor.date, query.cursor.id);
  }
  const pageWhere = pageConditions.length === 0 ? '' : `WHERE ${pageConditions.join(' AND ')}`;

  const rows = db
    .prepare(
      `SELECT ${ENTRY_COLUMNS} FROM manual_goal_entries
        ${pageWhere}
        ORDER BY date DESC, id DESC
        LIMIT ?`,
    )
    .all(...pageParams, query.limit + 1) as ManualGoalEntryRow[];

  const hasMore = rows.length > query.limit;
  return {
    rows: hasMore ? rows.slice(0, query.limit) : rows,
    hasMore,
    total: totalRow.c,
  };
}

export function insertEntry(
  db: Db,
  input: {
    readonly id: string;
    readonly goal: ManualGoal;
    readonly kind: 'deposit' | 'withdrawal';
    readonly amountCents: number;
    readonly date: number;
    readonly note: string;
    readonly actorId: string;
    readonly operationId: string;
    readonly now: number;
  },
): void {
  db.prepare(
    `INSERT INTO manual_goal_entries
       (id, goal, kind, amount_cents, date, note, revision, actor_id, operation_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.goal,
    input.kind,
    input.amountCents,
    input.date,
    input.note,
    input.actorId,
    input.operationId,
    input.now,
    input.now,
  );
}

export function updateEntry(
  db: Db,
  input: {
    readonly id: string;
    readonly goal: ManualGoal;
    readonly kind: 'deposit' | 'withdrawal';
    readonly amountCents: number;
    readonly date: number;
    readonly note: string;
    readonly operationId: string;
    readonly now: number;
  },
): void {
  db.prepare(
    `UPDATE manual_goal_entries
        SET goal = ?, kind = ?, amount_cents = ?, date = ?, note = ?,
            revision = revision + 1, operation_id = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL`,
  ).run(
    input.goal,
    input.kind,
    input.amountCents,
    input.date,
    input.note,
    input.operationId,
    input.now,
    input.id,
  );
}

export function softDeleteEntry(
  db: Db,
  input: {
    readonly id: string;
    readonly operationId: string;
    readonly now: number;
  },
): void {
  db.prepare(
    `UPDATE manual_goal_entries
        SET deleted_at = ?, revision = revision + 1, operation_id = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL`,
  ).run(input.now, input.operationId, input.now, input.id);
}

// ---------------------------------------------------------------------------
// 操作重放
// ---------------------------------------------------------------------------

export interface ManualGoalOperationInput {
  readonly operationId: string;
  readonly actorId: string;
  readonly method: string;
  readonly resource: string;
  readonly canonicalPayload: unknown;
  readonly now: number;
}

export interface ManualGoalOperationResult<T> {
  readonly statusCode: number;
  readonly response: T;
}

export interface ManualGoalOperationRecord {
  readonly operationId: string;
  readonly method: string;
  readonly resource: string;
  readonly statusCode: number;
  readonly response: unknown;
  readonly committedAt: number;
}

interface OperationRow {
  readonly operation_id: string;
  readonly actor_id: string;
  readonly method: string;
  readonly resource: string;
  readonly request_hash: string;
  readonly status_code: number;
  readonly response_json: string;
  readonly committed_at: number;
}

/** 读一条重放记录;别人的 key 与不存在的 key 都返回 `undefined`(路由统一 404)。 */
export function getManualGoalOperation(
  db: Db,
  operationId: string,
  actorId: string,
): ManualGoalOperationRecord | undefined {
  const row = db
    .prepare('SELECT * FROM manual_goal_operations WHERE operation_id = ? AND actor_id = ?')
    .get(operationId, actorId) as OperationRow | undefined;
  if (row === undefined) return undefined;

  let response: unknown;
  try {
    response = JSON.parse(row.response_json);
  } catch {
    throw new FinancialUnavailableError();
  }
  return {
    operationId: row.operation_id,
    method: row.method,
    resource: row.resource,
    statusCode: row.status_code,
    response,
    committedAt: row.committed_at,
  };
}

/**
 * 执行一次手动进度写入并登记可重放结果。
 *
 * 顺序与 `runFinancialOperation` 一致:**先判重放,再做业务校验**;领域写入与登记行
 * 在同一个 IMMEDIATE 事务里,所以失败时不留下"这个 key 已经用过"的痕迹,也不会
 * 出现"记录写了但重放没登记"的半截状态。
 */
export function runManualGoalOperation<T>(
  db: Db,
  input: ManualGoalOperationInput,
  commit: () => ManualGoalOperationResult<T>,
): ManualGoalOperationResult<T> {
  const method = input.method.trim().toUpperCase();
  const resource = input.resource.trim();
  const requestHash = hashFinancialOperation(method, resource, input.canonicalPayload);

  const run = db.transaction((): ManualGoalOperationResult<T> => {
    const existing = db
      .prepare('SELECT * FROM manual_goal_operations WHERE operation_id = ?')
      .get(input.operationId) as OperationRow | undefined;

    if (existing !== undefined) {
      if (
        existing.actor_id !== input.actorId ||
        existing.method !== method ||
        existing.resource !== resource ||
        existing.request_hash !== requestHash
      ) {
        throw new FinancialOperationMismatchError(
          'This operationId was already used for a different request. Generate a new operationId instead of reusing this one.',
        );
      }
      let response: T;
      try {
        response = JSON.parse(existing.response_json) as T;
      } catch {
        throw new FinancialUnavailableError();
      }
      return { statusCode: existing.status_code, response };
    }

    const result = commit();

    db.prepare(
      `INSERT INTO manual_goal_operations
         (operation_id, actor_id, method, resource, request_hash, status_code, response_json, committed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.operationId,
      input.actorId,
      method,
      resource,
      requestHash,
      result.statusCode,
      JSON.stringify(result.response ?? null),
      input.now,
    );

    return result;
  });

  return run.immediate();
}
