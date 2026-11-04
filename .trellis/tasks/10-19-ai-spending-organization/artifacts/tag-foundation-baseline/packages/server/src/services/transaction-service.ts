/**
 * Transaction service: create / read / update / soft-delete, plus the filtered
 * list query.
 *
 * Contract (T4 PRD):
 *   * money arrives as integer cents and never as a float (AC4);
 *   * tags are normalised through `services/tags.ts` so the de-duplication rule
 *     exists in exactly one place (AC6);
 *   * `isRefund` is a cross-cutting flag on an INCOME row, not an expense — it
 *     marks money that came back in (退款/还款/AA 收款) and links back to the
 *     original expense(s) it offsets; refunds count as income (AC7, revised).
 *     live categories must also match the transaction type; client filters are not trusted.
 *   * deletes are soft: the row stays, `deleted` flips (AC3);
 *   * a keyword search escapes `%` and `_`, so a note containing `%` is matched
 *     literally instead of matching everything (AC9).
 *
 * The net-expense arithmetic itself lives in `@jizhang/shared` — this module must
 * not re-implement it.
 */
import {
  expenseContribution,
  incomeContribution,
  TYPE_EXPENSE,
  TYPE_INCOME,
  type Transaction,
} from '@jizhang/shared';
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/index.js';
import { normaliseTags, parseTagsJson, serialiseTags } from './tags.js';

/** Row shape of the `transactions` table. */
interface TransactionRow {
  readonly id: string;
  readonly type: number;
  readonly amount_cents: number;
  readonly category_id: string;
  readonly account_id: string;
  readonly date: number;
  readonly note: string;
  readonly tags_json: string;
  readonly is_refund: number;
  readonly deleted: number;
  readonly updated_at: number;
}

/** Wire/domain representation. Field names match the API contract (design.md §5). */
/** Reverse-refund summary for an original expense: how much has been refunded. */
export interface RefundSummary {
  /** Sum of all linked refund amounts, in cents. */
  readonly totalRefundCents: number;
  /** Number of linked refund transactions. */
  readonly refundCount: number;
}

/** One linked refund row for an original expense (forward-view detail). */
export interface RefundDetail {
  readonly id: string;
  readonly amountCents: number;
  readonly date: number;
  readonly note: string;
  readonly updatedAt: number;
}

/** Wire/domain representation. Field names match the API contract (design.md §5). */
export interface TransactionDto {
  readonly id: string;
  readonly type: number;
  readonly amountCents: number;
  readonly categoryId: string;
  readonly accountId: string;
  readonly date: number;
  readonly note: string;
  readonly tags: string[];
  readonly isRefund: boolean;
  readonly refundLinkedTxIds?: string[];
  readonly refundSummary?: RefundSummary;
  readonly refundDetails?: RefundDetail[];
  readonly updatedAt: number;
}

function toDto(
  row: TransactionRow,
  refundLinkedTxIds?: string[],
  refundSummary?: RefundSummary,
  refundDetails?: RefundDetail[],
): TransactionDto {
  return {
    id: row.id,
    type: row.type,
    amountCents: row.amount_cents,
    categoryId: row.category_id,
    accountId: row.account_id,
    date: row.date,
    note: row.note,
    tags: parseTagsJson(row.tags_json),
    isRefund: row.is_refund === 1,
    refundLinkedTxIds,
    refundSummary,
    refundDetails,
    updatedAt: row.updated_at,
  };
}

export class ValidationError extends Error {
  readonly statusCode = 400;
  readonly code = 'VALIDATION';
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'NOT_FOUND';
  constructor(message = 'Transaction not found.') {
    super(message);
    this.name = 'NotFoundError';
  }
}

/**
 * The request was well-formed but the resource is not in a state that allows it.
 *
 * Currently raised only by `purge`, which refuses to hard-delete a transaction that is
 * still live. That refusal is the guard rail protecting real data from a mistyped id or
 * a mismatched UI state, so it is a distinct condition from "not found" and must not be
 * flattened into one.
 */
export class ConflictError extends Error {
  readonly statusCode = 409;
  readonly code = 'CONFLICT';
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

/** Earliest plausible transaction date: 2000-01-01. Guards absurd input. */
const MIN_DATE_MS = Date.UTC(2000, 0, 1);
/** One day of slack past "now" absorbs client clock skew and timezone edges. */
const FUTURE_SLACK_MS = 86_400_000;

export interface CreateTransactionInput {
  readonly type?: unknown;
  readonly amountCents?: unknown;
  readonly categoryId?: unknown;
  readonly accountId?: unknown;
  readonly date?: unknown;
  readonly note?: unknown;
  readonly tags?: unknown;
  readonly isRefund?: unknown;
  readonly refundLinkedTxIds?: unknown;
}

/**
 * A partial update uses the same optional-field shape as create: absent keys are
 * left untouched.
 */
export type UpdateTransactionInput = CreateTransactionInput;

/** A create payload after the same validation used by the ledger writer. */
export interface PreparedTransactionInput {
  readonly type: number;
  readonly amountCents: number;
  readonly categoryId: string;
  readonly accountId: string;
  readonly date: number;
  readonly note: string;
  readonly tags: string[];
  readonly isRefund: boolean;
  readonly refundLinkedTxIds: string[];
}

function requireIntegerCents(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ValidationError(
      `${field} must be an integer number of cents (got ${JSON.stringify(value)}). ` +
        'Convert yuan to cents with Math.round(value * 100) on the client.',
    );
  }
  if (value <= 0) {
    throw new ValidationError(`${field} must be greater than zero.`);
  }
  return value;
}

function requireType(value: unknown): number {
  if (value !== TYPE_EXPENSE && value !== TYPE_INCOME) {
    throw new ValidationError('type must be 0 (expense) or 1 (income).');
  }
  return value;
}

/**
 * Requires a non-empty string. Exported because "a required reference is missing" is the
 * same validation wherever it appears (a bill's category, a salary's account), and a second
 * copy would eventually word the error differently for the same mistake.
 */
export function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${field} is required.`);
  }
  return value.trim();
}

function requireTimestamp(value: unknown, field: string, nowMs: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError(`${field} must be an epoch-millisecond timestamp.`);
  }
  if (value < MIN_DATE_MS) {
    throw new ValidationError(`${field} is before the year 2000.`);
  }
  if (value > nowMs + FUTURE_SLACK_MS) {
    throw new ValidationError(`${field} is in the future.`);
  }
  return value;
}

/** `%` and `_` are LIKE wildcards; a literal search must escape them. */
export function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export interface ListTransactionsQuery {
  readonly from?: number | undefined;
  readonly to?: number | undefined;
  readonly type?: number | undefined;
  readonly categoryId?: string | undefined;
  readonly accountId?: string | undefined;
  readonly tag?: string | undefined;
  readonly q?: string | undefined;
  readonly includeDeleted?: boolean | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}

export interface ListTransactionsResult {
  readonly items: TransactionDto[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 500;

export interface TransactionServiceOptions {
  /** Injectable clock, so date validation is deterministic in tests. */
  readonly now?: () => number;
}

/**
 * Rejects a reference to an account that is missing or soft-deleted.
 *
 * Module-level and exported rather than a private method because three writers now need
 * exactly this rule: a bill, a salary and a recurring rule. The project's convention is one
 * implementation per rule (`spec/backend/quality-guidelines.md`: "One aggregation rule, one
 * implementation"), and a second copy of this lookup is how a stale client would end up able
 * to file money against an account the user has deleted.
 */
export function assertAccountUsable(db: Db, accountId: string): void {
  const row = db
    .prepare('SELECT 1 AS x FROM accounts WHERE id = ? AND deleted = 0')
    .get(accountId) as { x: number } | undefined;
  if (row === undefined) {
    throw new ValidationError(`Unknown or deleted account: ${accountId}`);
  }
}

export class TransactionService {
  private readonly db: Db;
  private readonly now: () => number;

  constructor(db: Db, options: TransactionServiceOptions = {}) {
    this.db = db;
    this.now = options.now ?? (() => Date.now());
  }

  /** Returns the ids of refunds linked TO this original expense (reverse lookup). */
  getRefundsForExpense(originalTxId: string): string[] {
    const rows = this.db
      .prepare('SELECT refund_tx_id FROM refund_links WHERE original_tx_id = ? ORDER BY created_at')
      .all(originalTxId) as { refund_tx_id: string }[];
    return rows.map((row) => row.refund_tx_id);
  }

  /** Sum of refund amounts linked to an original expense, plus how many there are. */
  getRefundSummary(originalTxId: string): RefundSummary {
    const rows = this.db
      .prepare(
        `SELECT t.amount_cents AS amount
           FROM refund_links rl
           JOIN transactions t ON t.id = rl.refund_tx_id
          WHERE rl.original_tx_id = ? AND t.deleted = 0`,
      )
      .all(originalTxId) as { amount: number }[];
    const totalRefundCents = rows.reduce((sum, row) => sum + row.amount, 0);
    return { totalRefundCents, refundCount: rows.length };
  }

  /** Forward-view rows for the refunds linked to an original expense. */
  getRefundDetails(originalTxId: string): RefundDetail[] {
    const rows = this.db
      .prepare(
        `SELECT t.id, t.amount_cents, t.date, t.note, t.updated_at
           FROM refund_links rl
           JOIN transactions t ON t.id = rl.refund_tx_id
          WHERE rl.original_tx_id = ? AND t.deleted = 0
          ORDER BY rl.created_at`,
      )
      .all(originalTxId) as {
      id: string;
      amount_cents: number;
      date: number;
      note: string;
      updated_at: number;
    }[];
    return rows.map((row) => ({
      id: row.id,
      amountCents: row.amount_cents,
      date: row.date,
      note: row.note,
      updatedAt: row.updated_at,
    }));
  }

  /** Rejects a reference to a category that is missing or soft-deleted (AC10). */
  private assertCategoryUsable(categoryId: string, expectedType?: number): void {
    const row = this.db
      .prepare('SELECT type FROM categories WHERE id = ? AND deleted = 0')
      .get(categoryId) as { type: number } | undefined;
    if (row === undefined) {
      throw new ValidationError(`Unknown or deleted category: ${categoryId}`);
    }
    if (expectedType !== undefined && row.type !== expectedType) {
      throw new ValidationError('The selected category does not match the transaction type.');
    }
    const child = this.db
      .prepare('SELECT 1 AS x FROM categories WHERE parent_id = ? AND deleted = 0 LIMIT 1')
      .get(categoryId) as { x: number } | undefined;
    if (child !== undefined) {
      throw new ValidationError(
        'A parent category cannot be selected for a bill. Choose a child category.',
      );
    }
  }

  /** Delegates to the module-level rule so there is exactly one implementation. */
  private assertAccountUsable(accountId: string): void {
    assertAccountUsable(this.db, accountId);
  }

  /**
   * Checks that a category and an account may be referenced, without writing anything.
   *
   * Exposed so other writers (recurring rules) enforce exactly the same rule as a bill
   * does, instead of each re-implementing the two lookups and drifting. The transaction
   * type is included so category-type mismatches are rejected before either writer commits.
   */
  assertReferencesUsable(type: number, categoryId: string, accountId: string): void {
    this.assertCategoryUsable(categoryId, requireType(type));
    this.assertAccountUsable(accountId);
  }

  /** Returns the ids of original expenses linked to a refund transaction. */
  private getRefundLinks(refundTxId: string): string[] {
    const rows = this.db
      .prepare('SELECT original_tx_id FROM refund_links WHERE refund_tx_id = ? ORDER BY rowid')
      .all(refundTxId) as { original_tx_id: string }[];
    return rows.map((row) => row.original_tx_id);
  }

  /** Removes existing links for a refund and inserts the validated set. */
  private replaceRefundLinks(
    refundTxId: string,
    originalTxIds: readonly string[],
    nowMs: number,
  ): void {
    this.db.prepare('DELETE FROM refund_links WHERE refund_tx_id = ?').run(refundTxId);
    if (originalTxIds.length === 0) return;
    const insert = this.db.prepare(
      'INSERT INTO refund_links (id, refund_tx_id, original_tx_id, created_at) VALUES (?, ?, ?, ?)',
    );
    for (const originalTxId of originalTxIds) {
      insert.run(randomUUID(), refundTxId, originalTxId, nowMs);
    }
  }

  /**
   * Validates that each linked id is a live, non-refund expense.
   * Returns the de-duplicated id list so the caller stores a clean set.
   */
  private validateRefundLinks(originalTxIds: readonly string[], selfId?: string): string[] {
    if (originalTxIds.length === 0) return [];
    const unique = [...new Set(originalTxIds)];
    if (selfId !== undefined && unique.includes(selfId)) {
      throw new ValidationError('A refund cannot link to itself.');
    }
    const placeholders = unique.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT id, type, is_refund, deleted FROM transactions WHERE id IN (${placeholders})`,
      )
      .all(...unique) as {
      id: string;
      type: number;
      is_refund: number;
      deleted: number;
    }[];
    const found = new Map(rows.map((row) => [row.id, row]));
    for (const id of unique) {
      const row = found.get(id);
      if (row === undefined) throw new ValidationError(`Linked transaction not found: ${id}`);
      if (row.deleted === 1) throw new ValidationError(`Linked transaction is deleted: ${id}`);
      if (row.type !== TYPE_EXPENSE)
        throw new ValidationError(`Linked transaction must be an expense: ${id}`);
      if (row.is_refund === 1)
        throw new ValidationError(`Linked transaction must not be a refund: ${id}`);
    }
    return unique;
  }

  getById(id: string, includeDeleted = false): TransactionDto | undefined {
    const row = this.db
      .prepare(`SELECT * FROM transactions WHERE id = ?${includeDeleted ? '' : ' AND deleted = 0'}`)
      .get(id) as TransactionRow | undefined;
    if (row === undefined) return undefined;
    if (row.is_refund === 1) {
      return toDto(row, this.getRefundLinks(id));
    }
    // For a non-refund expense, attach the reverse-view: how much has been
    // refunded against it. Only expense originals carry this summary — refunds
    // (income-typed) show their linked originals instead, and plain income
    // has nothing to offset.
    if (row.type === TYPE_EXPENSE) {
      const summary = this.getRefundSummary(id);
      if (summary.refundCount > 0) {
        return toDto(row, undefined, summary, this.getRefundDetails(id));
      }
    }
    return toDto(row);
  }

  /**
   * The raw `deleted` flag, or `undefined` when no such row exists.
   *
   * `undefined` and `0` must stay distinguishable: "no such bill" and "this bill is
   * still live" are different answers, and folding them together is how a typo would
   * silently hard-delete the wrong thing.
   */
  private deletedFlag(id: string): number | undefined {
    const row = this.db.prepare('SELECT deleted FROM transactions WHERE id = ?').get(id) as
      { deleted: number } | undefined;
    return row?.deleted;
  }

  /**
   * Requires the row to exist and be live; throws `NotFoundError` otherwise, so
   * routes can let the error handler render a 404.
   */
  getByIdOrThrow(id: string): TransactionDto {
    const found = this.getById(id);
    if (found === undefined) throw new NotFoundError();
    return found;
  }

  /**
   * Validates a prospective bill without inserting it. Assistant confirmation cards use this
   * method so preparing a write cannot accidentally create a ledger row.
   */
  prepareCreate(input: CreateTransactionInput): PreparedTransactionInput {
    const type = requireType(input.type);
    const amountCents = requireIntegerCents(input.amountCents, 'amountCents');
    const categoryId = requireNonEmptyString(input.categoryId, 'categoryId');
    const accountId = requireNonEmptyString(input.accountId, 'accountId');
    const date = requireTimestamp(input.date, 'date', this.now());
    const note = typeof input.note === 'string' ? input.note : '';
    const tags = normaliseTags(Array.isArray(input.tags) ? input.tags : []);

    // A refund only makes sense on an income: money that came back in is recorded
    // in the income tab and counts as +income (AC7, revised — supersedes the old
    // "refund is a negative expense" rule from T4 PRD R5).
    const isRefund = input.isRefund === true;
    if (isRefund && type !== TYPE_INCOME) {
      throw new ValidationError('isRefund can only be set on an income (type 1).');
    }

    this.assertCategoryUsable(categoryId, type);
    this.assertAccountUsable(accountId);

    const linkedIds = Array.isArray(input.refundLinkedTxIds)
      ? input.refundLinkedTxIds.filter(
          (v): v is string => typeof v === 'string',
        )
      : [];
    const refundLinkedTxIds = isRefund ? this.validateRefundLinks(linkedIds) : [];
    return {
      type,
      amountCents,
      categoryId,
      accountId,
      date,
      note,
      tags,
      isRefund,
      refundLinkedTxIds,
    };
  }

  create(input: CreateTransactionInput, id?: string): TransactionDto {
    const prepared = this.prepareCreate(input);

    const rowId = id ?? randomUUID();
    const nowMs = this.now();

    this.db
      .prepare(
        `INSERT INTO transactions
           (id, type, amount_cents, category_id, account_id, date, note, tags_json, is_refund, deleted, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      )
      .run(
        rowId,
        prepared.type,
        prepared.amountCents,
        prepared.categoryId,
        prepared.accountId,
        prepared.date,
        prepared.note,
        serialiseTags(prepared.tags),
        prepared.isRefund ? 1 : 0,
        nowMs,
      );

    if (prepared.isRefund) {
      const validated = this.validateRefundLinks(prepared.refundLinkedTxIds, rowId);
      if (validated.length > 0) {
        this.replaceRefundLinks(rowId, validated, nowMs);
      }
    }

    return this.getByIdOrThrow(rowId);
  }

  /**
   * Partial update. Only the keys present in `input` are changed.
   *
   * `isRefund` is special-cased: flipping it on an expense row is rejected, and
   * clearing it is always allowed.
   */
  update(id: string, input: UpdateTransactionInput): TransactionDto {
    const current = this.getByIdOrThrow(id);

    const nextType = input.type === undefined ? current.type : requireType(input.type);
    const nextAmount =
      input.amountCents === undefined
        ? current.amountCents
        : requireIntegerCents(input.amountCents, 'amountCents');
    const nextCategory =
      input.categoryId === undefined
        ? current.categoryId
        : requireNonEmptyString(input.categoryId, 'categoryId');
    const nextAccount =
      input.accountId === undefined
        ? current.accountId
        : requireNonEmptyString(input.accountId, 'accountId');
    const nextDate =
      input.date === undefined ? current.date : requireTimestamp(input.date, 'date', this.now());
    const nextNote = input.note === undefined ? current.note : input.note;
    if (typeof nextNote !== 'string') {
      throw new ValidationError('note must be a string.');
    }
    const nextTags =
      input.tags === undefined
        ? current.tags
        : normaliseTags(Array.isArray(input.tags) ? input.tags : []);
    const nextIsRefund = input.isRefund === undefined ? current.isRefund : input.isRefund === true;

    if (nextIsRefund && nextType !== TYPE_INCOME) {
      throw new ValidationError('isRefund can only be set on an income (type 1).');
    }

    if (nextCategory !== current.categoryId || nextType !== current.type) {
      this.assertCategoryUsable(nextCategory, nextType);
    }
    if (nextAccount !== current.accountId) this.assertAccountUsable(nextAccount);

    this.db
      .prepare(
        `UPDATE transactions
            SET type = ?, amount_cents = ?, category_id = ?, account_id = ?,
                date = ?, note = ?, tags_json = ?, is_refund = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(
        nextType,
        nextAmount,
        nextCategory,
        nextAccount,
        nextDate,
        nextNote,
        serialiseTags(nextTags),
        nextIsRefund ? 1 : 0,
        this.now(),
        id,
      );

    // Refund links: cleared when not a refund; replaced when the caller
    // provides them; left untouched when the caller omits them on a row
    // that is already a refund.
    if (!nextIsRefund) {
      this.replaceRefundLinks(id, [], this.now());
    } else if (Array.isArray(input.refundLinkedTxIds)) {
      const linkedIds = (input.refundLinkedTxIds as readonly unknown[]).filter(
        (v): v is string => typeof v === 'string',
      );
      const validated = this.validateRefundLinks(linkedIds, id);
      this.replaceRefundLinks(id, validated, this.now());
    }

    return this.getByIdOrThrow(id);
  }

  /**
   * Soft delete. The row stays in the table with `deleted = 1` (AC3).
   *
   * Refund links are removed as part of the same transaction. A link to an expense that
   * is no longer live cannot be meaningfully traced in the live UI, and a link from a
   * refund that is in the trash should not still point at a live expense.
   */
  softDelete(id: string): void {
    this.getByIdOrThrow(id);
    const run = this.db.transaction((): void => {
      this.db
        .prepare('UPDATE transactions SET deleted = 1, updated_at = ? WHERE id = ?')
        .run(this.now(), id);
      this.db
        .prepare('DELETE FROM refund_links WHERE refund_tx_id = ? OR original_tx_id = ?')
        .run(id, id);
    });
    run();
  }

  /**
   * Restores a soft-deleted row. Used by the trash view and by tests.
   *
   * Idempotent by design: asking to restore a row that is already live returns it
   * unchanged. It must return EARLY rather than re-running the UPDATE, because the
   * UPDATE also bumps `updated_at`, and `updated_at` is the tie-breaker in the list
   * ordering (`ORDER BY date DESC, updated_at DESC`). Re-stamping a live row would make
   * it silently jump position in the list, which is a state change the caller never
   * asked for.
   */
  restore(id: string): TransactionDto {
    const deleted = this.deletedFlag(id);
    if (deleted === undefined) throw new NotFoundError();
    if (deleted === 0) return this.getByIdOrThrow(id);

    this.db
      .prepare('UPDATE transactions SET deleted = 0, updated_at = ? WHERE id = ?')
      .run(this.now(), id);
    return this.getByIdOrThrow(id);
  }

  /**
   * Hard delete — the one sanctioned exception to "business rows are only soft-deleted"
   * (see `database-guidelines.md`).
   *
   * Only ever acts on a row that is ALREADY soft-deleted, so a hard delete can only ever
   * follow a deliberate trip through the trash. A live row is a conflict, not a
   * not-found: the two mean different things to the caller and must not be collapsed.
   *
   * Refund links are removed first: this row may be the refund or the original, and
   * leaving the link would let a hard-deleted id linger in `refund_links`.
   */
  purge(id: string): void {
    const deleted = this.deletedFlag(id);
    if (deleted === undefined) throw new NotFoundError();
    if (deleted === 0) {
      throw new ConflictError(
        'Only bills in the recycle bin can be permanently deleted. Delete it first, then purge it.',
      );
    }

    const run = this.db.transaction((): void => {
      this.db
        .prepare('DELETE FROM refund_links WHERE refund_tx_id = ? OR original_tx_id = ?')
        .run(id, id);
      this.db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
    });
    run();
  }

  /** Restores every soft-deleted row. Returns how many came back. */
  restoreAll(): number {
    const run = this.db.transaction(
      (): number =>
        this.db
          .prepare('UPDATE transactions SET deleted = 0, updated_at = ? WHERE deleted = 1')
          .run(this.now()).changes,
    );
    return run();
  }

  /** Permanently deletes every soft-deleted row. Returns how many are gone. */
  purgeAll(): number {
    const run = this.db.transaction((): number => {
      const ids = (
        this.db.prepare('SELECT id FROM transactions WHERE deleted = 1').all() as {
          id: string;
        }[]
      ).map((row) => row.id);
      if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        this.db
          .prepare(
            `DELETE FROM refund_links
                WHERE refund_tx_id IN (${placeholders}) OR original_tx_id IN (${placeholders})`,
          )
          .run(...ids, ...ids);
      }
      return this.db.prepare('DELETE FROM transactions WHERE deleted = 1').run().changes;
    });
    return run();
  }

  /**
   * Deleted rows only, most recently deleted first.
   *
   * The ordering key is `updated_at`, used as a proxy for the deletion time: a row in
   * the trash is not editable, and `softDelete` stamps `updated_at` when it flips the
   * flag. That is why this deliberately does NOT reuse `list()`'s
   * `ORDER BY date DESC, updated_at DESC` — in the trash you want the thing you just
   * deleted at the top, not the bill with the newest transaction date.
   */
  listDeleted(limit = MAX_PAGE_SIZE): TransactionDto[] {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), MAX_PAGE_SIZE);
    const rows = this.db
      .prepare(
        `SELECT * FROM transactions
          WHERE deleted = 1
          ORDER BY updated_at DESC, id
         LIMIT ?`,
      )
      .all(safeLimit) as TransactionRow[];
    return rows.map((row) => toDto(row));
  }

  /** Number of rows currently in the trash, for the "will delete N" confirmation. */
  countDeleted(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS c FROM transactions WHERE deleted = 1')
      .get() as { c: number };
    return row.c;
  }

  /**
   * Total gross expense across the given rows, in cents.
   *
   * Delegates to the shared rule rather than re-deriving it: `TransactionDto` is
   * structurally compatible with the shared `Transaction` shape for the fields the
   * rule reads.
   */
  netExpenseCents(items: readonly TransactionDto[]): number {
    return items.reduce(
      (sum, item) => sum + expenseContribution(item as unknown as Transaction),
      0,
    );
  }

  /** Total income across the given rows (refunds included — they are income). */
  incomeCents(items: readonly TransactionDto[]): number {
    return items.reduce((sum, item) => sum + incomeContribution(item as unknown as Transaction), 0);
  }

  /** Filtered, paginated list. Newest first; newest-edited first within a day. */
  list(query: ListTransactionsQuery = {}): ListTransactionsResult {
    const where: string[] = [];
    const params: (string | number)[] = [];

    if (query.includeDeleted !== true) {
      where.push('deleted = 0');
    }
    if (query.from !== undefined) {
      where.push('date >= ?');
      params.push(query.from);
    }
    if (query.to !== undefined) {
      where.push('date < ?');
      params.push(query.to);
    }
    if (query.type !== undefined) {
      where.push('type = ?');
      params.push(query.type);
    }
    if (query.categoryId !== undefined) {
      where.push('category_id = ?');
      params.push(query.categoryId);
    }
    if (query.accountId !== undefined) {
      where.push('account_id = ?');
      params.push(query.accountId);
    }
    if (query.tag !== undefined && query.tag.trim() !== '') {
      // Tags are a JSON array of names. Matching the quoted name keeps "food" from
      // matching a tag named "seafood".
      where.push("tags_json LIKE ? ESCAPE '\\'");
      params.push(`%"${escapeLikePattern(query.tag.trim())}"%`);
    }
    if (query.q !== undefined && query.q.trim() !== '') {
      where.push("note LIKE ? ESCAPE '\\'");
      params.push(`%${escapeLikePattern(query.q.trim())}%`);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const limit = Math.min(
      Math.max(Math.trunc(query.limit ?? DEFAULT_PAGE_SIZE), 1),
      MAX_PAGE_SIZE,
    );
    const offset = Math.max(Math.trunc(query.offset ?? 0), 0);

    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS c FROM transactions ${whereSql}`)
      .get(...params) as { c: number };

    const rows = this.db
      .prepare(
        `SELECT * FROM transactions ${whereSql}
          ORDER BY date DESC, updated_at DESC
          LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as TransactionRow[];

    return {
      items: this.withRefundSummaries(rows),
      total: totalRow.c,
      limit,
      offset,
    };
  }

  /**
   * Batch-attaches refund summaries to non-refund expense rows in a list result.
   *
   * A single GROUP BY query covers all expenses in the page, so the list endpoint
   * stays at two queries total regardless of how many rows have refunds.
   */
  private withRefundSummaries(rows: TransactionRow[]): TransactionDto[] {
    const expenseIds = rows
      .filter((row) => row.type === TYPE_EXPENSE && row.is_refund !== 1)
      .map((row) => row.id);

    if (expenseIds.length === 0) {
      return rows.map((row) => toDto(row));
    }

    const placeholders = expenseIds.map(() => '?').join(',');
    const summaryRows = this.db
      .prepare(
        `SELECT rl.original_tx_id AS id,
                COUNT(*)          AS refund_count,
                SUM(t.amount_cents) AS total_refund
           FROM refund_links rl
           JOIN transactions t ON t.id = rl.refund_tx_id AND t.deleted = 0
          WHERE rl.original_tx_id IN (${placeholders})
          GROUP BY rl.original_tx_id`,
      )
      .all(...expenseIds) as { id: string; refund_count: number; total_refund: number }[];

    const summaryMap = new Map<string, RefundSummary>();
    for (const row of summaryRows) {
      summaryMap.set(row.id, {
        totalRefundCents: row.total_refund,
        refundCount: row.refund_count,
      });
    }

    return rows.map((row) => {
      const summary = summaryMap.get(row.id);
      if (summary !== undefined) {
        return toDto(row, undefined, summary);
      }
      return toDto(row);
    });
  }

  /** Distinct tag names with usage counts, most used first (feeds T7). */
  listTags(includeDeleted = false): { name: string; count: number }[] {
    const rows = this.db
      .prepare(`SELECT tags_json FROM transactions ${includeDeleted ? '' : 'WHERE deleted = 0'}`)
      .all() as { tags_json: string }[];

    const counts = new Map<string, number>();
    for (const row of rows) {
      for (const tag of parseTagsJson(row.tags_json)) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }

    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }
}
