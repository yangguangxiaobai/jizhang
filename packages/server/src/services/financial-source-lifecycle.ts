/**
 * 退款分摊集合的**失效传播**与读取(生命周期安全阀)。
 *
 * ## 为什么不能靠 `refund_links`
 *
 * 旧关系表 `refund_links` 在软删除时被整行删除(`transaction-service.ts`
 * `softDelete`),恢复账单也不会把关系复活。新的财务分摊事实因此独立存
 * (`financial_refund_splits` + `financial_refund_split_sets`),并由本模块负责
 * "原单/退款的事实一变,相关分摊全部失效"以及"读的时候再验一次"。
 *
 * ## 整集失效,不是逐行失效
 *
 * 退款 R 分摊给原单 A(30)和 B(70)。如果只把 A 的那一行标失效,剩下的 70 就
 * 会在"上限校验只针对 A"的语境下被当成仍然有效,于是净执行被少算 30 ——
 * 一个静默少报的错账。契约要求:**任何一个来源事实变化,整集一起失效**,并在
 * `financial_refund_split_sets` 里留一条当时的整集快照,说明为什么失效。
 *
 * ## 关键事实快照(为什么不止是金额)
 *
 * 旧客户端或外部改动可以绕过本模块:把退款从 100 改成 200,上限依然容得下,
 * 但从这一天起"已确认的分摊"就不再描述真实退款了,契约要求它进入复核状态。
 * 因此确认时把 `amountCents`/`type`/`isRefund` 一起快照进分摊行,读取时与活行
 * 比对;**类别/日期/账户**不在这份快照里 —— 它们不改变分摊的金额所有权,
 * 只是让用途/窗口各自重算。
 *
 * ## 不自动复活
 *
 * `restore` / `restoreAll` 把账单放回账本时,**不**恢复分摊:过期的小分值可能
 * 已经超过恢复后的实际金额。用户必须重新走一次显式确认(PUT splits)。
 *
 * ## 硬清除是原子脱钩
 *
 * `purge` / `purgeAll` 之后不能再有任何"可执行的孤儿事实":这里删掉分摊行
 * (而不是留活行指向不存在的账单),同时留一条 `purged` 审计。审计保留不等于
 * 允许它继续参与计算 —— 这正是 `spec/backend/database-guidelines.md` 的软删除
 * 规则的例外情形(状态由审计表承载)。
 *
 * 因此 `purge` **不是**"只处理还活着的集合":软删除先把分摊标成 invalidated,
 * 紧接着的硬清除必须连这些行一起脱钩,否则库里会留下指向不存在账单的失效行。
 *
 * 本模块**不导入** `transaction-service.ts`:那个服务会反过来调用它,导入即成环。
 */
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/index.js';

/** 触发失效的来源事实变化。类别/日期/备注/账户/用途变化**不**在此列。 */
export type FinancialSourceChangeReason =
  | 'amount-change'
  | 'type-change'
  | 'delete'
  | 'restore'
  | 'purge';

/** 一次失效请求:受影响的交易 id(既可能是退款,也可能是原单)。 */
export interface InvalidateFinancialRefundSourcesInput {
  readonly transactionIds: readonly string[];
  readonly reason: FinancialSourceChangeReason;
  /** 触发的操作(如果有),仅用于审计。 */
  readonly operationId?: string | null;
  /** 时钟,由调用方注入以便测试确定性。 */
  readonly now: number;
}

/** 参与分摊有效性的关键事实。类别/日期/账户刻意不在其中。 */
export interface FinancialCriticalFacts {
  readonly amountCents: number;
  readonly type: number;
  readonly isRefund: boolean;
}

/** 读取用的一行分摊事实。 */
export interface FinancialRefundSplitRecord {
  readonly id: string;
  readonly refundTransactionId: string;
  readonly originalTransactionId: string;
  readonly amountCents: number;
  readonly setRevision: number;
  readonly state: 'active' | 'invalidated';
  readonly invalidReason: string | null;
  /** 确认时的原单关键事实;读不懂时为 null(按失效处理)。 */
  readonly originalFacts: FinancialCriticalFacts | null;
  /** 确认时的退款关键事实;读不懂时为 null(按失效处理)。 */
  readonly refundFacts: FinancialCriticalFacts | null;
}

interface SplitRow {
  readonly id: string;
  readonly refund_tx_id: string;
  readonly original_tx_id: string;
  readonly amount_cents: number;
  readonly set_revision: number;
  readonly state: string;
  readonly invalid_reason: string | null;
  readonly original_facts_json: string;
  readonly refund_facts_json: string;
}

interface SetRevisionRow {
  readonly revision: number | null;
}

/**
 * 每条 SQL 里最多绑定多少个 id。
 *
 * 老版本 SQLite 的变量上限是 999,而这里每条语句要绑两份 id 列表 —— 400 两边
 * 各占 400,离 999 还有余量。**分批是内循环**,不是"超过多少就报错":
 * `purgeAll` / `restoreAll` 处理几千行时不能因为内部实现限制而整体失败。
 */
const ID_CHUNK_SIZE = 400;

function chunkIds(ids: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += ID_CHUNK_SIZE) {
    chunks.push(ids.slice(index, index + ID_CHUNK_SIZE));
  }
  return chunks;
}

/** 从交易行的读取结果里抽出关键事实。 */
export function financialCriticalFacts(source: {
  readonly amountCents: number;
  readonly type: number;
  readonly isRefund: boolean;
}): FinancialCriticalFacts {
  return { amountCents: source.amountCents, type: source.type, isRefund: source.isRefund };
}

/** 两个关键事实是否完全一致。 */
export function financialCriticalFactsEqual(
  left: FinancialCriticalFacts,
  right: FinancialCriticalFacts,
): boolean {
  return (
    left.amountCents === right.amountCents && left.type === right.type && left.isRefund === right.isRefund
  );
}

/** 宽容读取存储的事实快照;读不懂返回 `undefined`(调用方按失效处理)。 */
export function parseFinancialCriticalFacts(raw: string): FinancialCriticalFacts | undefined {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) return undefined;
  const record = decoded as Record<string, unknown>;
  const amountCents = record['amountCents'];
  const type = record['type'];
  const isRefund = record['isRefund'];
  if (typeof amountCents !== 'number' || !Number.isSafeInteger(amountCents)) return undefined;
  if (type !== 0 && type !== 1) return undefined;
  if (typeof isRefund !== 'boolean') return undefined;
  return { amountCents, type, isRefund };
}

/** 整集快照的规范形状:`[{originalTransactionId, amountCents}]`,按原单 id 排序。 */
function snapshotSplits(rows: readonly SplitRow[]): string {
  return JSON.stringify(
    [...rows]
      .sort((a, b) => a.original_tx_id.localeCompare(b.original_tx_id))
      .map((row) => ({ originalTransactionId: row.original_tx_id, amountCents: row.amount_cents })),
  );
}

/** 整集的关键事实快照:退款一份 + 每个原单一份。 */
function snapshotFacts(rows: readonly SplitRow[]): string {
  const sorted = [...rows].sort((a, b) => a.original_tx_id.localeCompare(b.original_tx_id));
  return JSON.stringify({
    refund: parseFinancialCriticalFacts(sorted[0]?.refund_facts_json ?? '') ?? null,
    originals: sorted.map((row) => ({
      transactionId: row.original_tx_id,
      facts: parseFinancialCriticalFacts(row.original_facts_json) ?? null,
    })),
  });
}

/** 当前退款集合的最新修订号(没有历史时按 0 处理)。 */
function latestSetRevision(db: Db, refundTxId: string): number {
  const row = db
    .prepare(
      'SELECT COALESCE(MAX(revision), 0) AS revision FROM financial_refund_split_sets WHERE refund_tx_id = ?',
    )
    .get(refundTxId) as SetRevisionRow | undefined;
  return row?.revision ?? 0;
}

/**
 * 公开的集合修订号读取(PUT splits 的 `expectedRevision` 比较基准)。
 *
 * 0 表示"这次退款从未确认过分摊",是一个合法的期望值。
 */
export function financialRefundSplitRevision(db: Db, refundTxId: string): number {
  return latestSetRevision(db, refundTxId);
}

function appendSetRevision(
  db: Db,
  input: {
    readonly refundTxId: string;
    readonly status: 'invalidated' | 'purged';
    readonly reason: FinancialSourceChangeReason;
    readonly splitsJson: string;
    readonly factsJson: string;
    readonly operationId: string | null;
    readonly now: number;
  },
): void {
  const currentRev = latestSetRevision(db, input.refundTxId);
  if (currentRev > 0) {
    db.prepare(
      `UPDATE financial_refund_split_sets
          SET status = ?, reason = ?
        WHERE refund_tx_id = ? AND revision = ?`,
    ).run(input.status, input.reason, input.refundTxId, currentRev);
    return;
  }
  db.prepare(
    `INSERT INTO financial_refund_split_sets
       (id, refund_tx_id, revision, status, reason, splits_json, facts_json, operation_id, created_at)
     VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    input.refundTxId,
    input.status,
    input.reason,
    input.splitsJson,
    input.factsJson,
    input.operationId,
    input.now,
  );
}

/**
 * 把涉及给定交易的所有退款分摊**整集**失效(或按 `purge` 脱钩删除)。
 *
 * 传入的 id 同时按"退款方"和"原单方"匹配:改动原单金额与改动退款金额对净执行
 * 的后果是同一种 —— 已确认的分摊不能再被当成精确值。
 *
 * 幂等:`delete` 之后再 `purge` 一次不会重复插审计行(没有可处理行时直接返回);
 * `restore` 对已失效集合不产生任何行(恢复不重激活)。
 */
export function invalidateFinancialRefundSources(
  db: Db,
  input: InvalidateFinancialRefundSourcesInput,
): void {
  const uniqueIds = [
    ...new Set(input.transactionIds.filter((id) => typeof id === 'string' && id !== '')),
  ];
  if (uniqueIds.length === 0) return;

  const operationId = input.operationId ?? null;
  // 收集与变异都在同一个 IMMEDIATE 事务里:先查后改之间若有别的连接写入,
  // 会让"整集"这个前提失效(TOCTOU)。
  const run = db.transaction((): void => {
    const touchedRefundIds = new Set<string>();

    for (const chunk of chunkIds(uniqueIds)) {
      const placeholders = chunk.map(() => '?').join(',');
      // 失效传播只关心还活着的集合(已失效的不用再记一遍);
      // 硬清除则必须连已失效行一起脱钩,否则会留下指向已清除账单的孤儿行。
      const sql =
        input.reason === 'purge'
          ? `SELECT DISTINCT refund_tx_id AS id
               FROM financial_refund_splits
              WHERE refund_tx_id IN (${placeholders}) OR original_tx_id IN (${placeholders})`
          : `SELECT DISTINCT refund_tx_id AS id
               FROM financial_refund_splits
              WHERE state = 'active'
                AND (refund_tx_id IN (${placeholders}) OR original_tx_id IN (${placeholders}))`;
      const rows = db.prepare(sql).all(...chunk, ...chunk) as { id: string }[];
      for (const row of rows) touchedRefundIds.add(row.id);
    }

    if (touchedRefundIds.size === 0) return;

    const selectSplits = db.prepare(
      'SELECT * FROM financial_refund_splits WHERE refund_tx_id = ? ORDER BY original_tx_id',
    );
    const invalidate = db.prepare(
      `UPDATE financial_refund_splits
          SET state = 'invalidated', invalid_reason = ?, updated_at = ?
        WHERE refund_tx_id = ? AND state = 'active'`,
    );
    const detach = db.prepare('DELETE FROM financial_refund_splits WHERE refund_tx_id = ?');

    for (const refundTxId of touchedRefundIds) {
      const splits = selectSplits.all(refundTxId) as SplitRow[];
      if (splits.length === 0) continue;

      appendSetRevision(db, {
        refundTxId,
        status: input.reason === 'purge' ? 'purged' : 'invalidated',
        reason: input.reason,
        splitsJson: snapshotSplits(splits),
        factsJson: snapshotFacts(splits),
        operationId,
        now: input.now,
      });

      if (input.reason === 'purge') {
        detach.run(refundTxId);
      } else {
        invalidate.run(input.reason, input.now, refundTxId);
      }
    }
  });

  run.immediate();
}

/**
 * 读取分摊事实(可按退款方/原单方筛选)。
 *
 * 只做存储读取与形状解析,不做业务判断:哪些能计入净执行由服务层用活行事实
 * 逐条校验(见 `financial-planning-service.ts` 的退款复核)。
 */export function readFinancialRefundSplits(
  db: Db,
  filter: {
    readonly refundTransactionIds?: readonly string[] | undefined;
    readonly originalTransactionIds?: readonly string[] | undefined;
  } = {},
): FinancialRefundSplitRecord[] {
  const where: string[] = [];
  const params: string[] = [];

  const refundIds = [...new Set(filter.refundTransactionIds ?? [])];
  const originalIds = [...new Set(filter.originalTransactionIds ?? [])];
  if (refundIds.length === 0 && originalIds.length === 0) return [];

  const clauses: string[] = [];
  if (refundIds.length > 0) {
    clauses.push(`refund_tx_id IN (${refundIds.map(() => '?').join(',')})`);
    params.push(...refundIds);
  }
  if (originalIds.length > 0) {
    clauses.push(`original_tx_id IN (${originalIds.map(() => '?').join(',')})`);
    params.push(...originalIds);
  }
  where.push(`(${clauses.join(' OR ')})`);

  const rows = db
    .prepare(
      `SELECT * FROM financial_refund_splits WHERE ${where.join(' AND ')}
        ORDER BY refund_tx_id, original_tx_id`,
    )
    .all(...params) as SplitRow[];

  return rows.map((row) => ({
    id: row.id,
    refundTransactionId: row.refund_tx_id,
    originalTransactionId: row.original_tx_id,
    amountCents: row.amount_cents,
    setRevision: row.set_revision,
    state: row.state === 'active' ? 'active' : 'invalidated',
    invalidReason: row.invalid_reason,
    originalFacts: parseFinancialCriticalFacts(row.original_facts_json) ?? null,
    refundFacts: parseFinancialCriticalFacts(row.refund_facts_json) ?? null,
  }));
}

/** 一次显式确认分摊的输入。调用方已完成全部业务校验(上限、token、引用)。 */
export interface ReplaceFinancialRefundSplitsInput {
  readonly refundTxId: string;
  readonly splits: readonly { readonly originalTransactionId: string; readonly amountCents: number }[];
  /** 确认时退款的活事实快照。 */
  readonly refundFacts: FinancialCriticalFacts;
  /** 确认时每个原单的活事实快照(必须覆盖 `splits` 里的全部原单)。 */
  readonly originalFacts: readonly {
    readonly transactionId: string;
    readonly facts: FinancialCriticalFacts;
  }[];
  readonly operationId: string | null;
  readonly now: number;
}

/**
 * 全量替换一次退款的分摊集合(空数组 = 清除)。
 *
 * **必须在调用方的事务里执行**(与重放登记、领域校验同事务):这里刻意不再开
 * 事务,否则"确认了一半"的状态可能被别的连接读到。
 */
export function replaceFinancialRefundSplits(
  db: Db,
  input: ReplaceFinancialRefundSplitsInput,
): { readonly revision: number } {
  const revision = latestSetRevision(db, input.refundTxId) + 1;

  const factsByOriginal = new Map(input.originalFacts.map((item) => [item.transactionId, item.facts]));
  const splitsJson = JSON.stringify(
    [...input.splits]
      .sort((a, b) => a.originalTransactionId.localeCompare(b.originalTransactionId))
      .map((split) => ({
        originalTransactionId: split.originalTransactionId,
        amountCents: split.amountCents,
      })),
  );
  const factsJson = JSON.stringify({
    refund: input.refundFacts,
    originals: [...input.originalFacts]
      .sort((a, b) => a.transactionId.localeCompare(b.transactionId))
      .map((item) => ({ transactionId: item.transactionId, facts: item.facts })),
  });

  db.prepare(
    `INSERT INTO financial_refund_split_sets
       (id, refund_tx_id, revision, status, reason, splits_json, facts_json, operation_id, created_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    input.refundTxId,
    revision,
    input.splits.length === 0 ? 'cleared' : 'confirmed',
    splitsJson,
    factsJson,
    input.operationId,
    input.now,
  );

  db.prepare('DELETE FROM financial_refund_splits WHERE refund_tx_id = ?').run(input.refundTxId);

  const insert = db.prepare(
    `INSERT INTO financial_refund_splits
       (id, refund_tx_id, original_tx_id, amount_cents, set_revision, state, invalid_reason,
        original_facts_json, refund_facts_json, operation_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', NULL, ?, ?, ?, ?, ?)`,
  );
  for (const split of input.splits) {
    const originalFacts = factsByOriginal.get(split.originalTransactionId);
    if (originalFacts === undefined) {
      throw new Error('replaceFinancialRefundSplits requires facts for every original in splits.');
    }
    insert.run(
      randomUUID(),
      input.refundTxId,
      split.originalTransactionId,
      split.amountCents,
      revision,
      JSON.stringify(originalFacts),
      JSON.stringify(input.refundFacts),
      input.operationId,
      input.now,
      input.now,
    );
  }

  return { revision };
}
