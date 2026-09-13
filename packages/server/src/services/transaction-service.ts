/**
 * Transaction service: create / read / update / soft-delete, plus the filtered
 * list query.
 *
 * Contract (T4 PRD):
 *   * money arrives as integer cents and never as a float (AC4);
 *   * tags are normalised through `services/tags.ts` so the de-duplication rule
 *     exists in exactly one place (AC6);
 *   * `isRefund` is a cross-cutting flag on an EXPENSE row, not an income — it
 *     makes `expenseContribution` negative (AC7);
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
  readonly updatedAt: number;
}

function toDto(row: TransactionRow): TransactionDto {
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
}

/**
 * A partial update uses the same optional-field shape as create: absent keys are
 * left untouched.
 */
export type UpdateTransactionInput = CreateTransactionInput;

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

  /** Rejects a reference to a category that is missing or soft-deleted (AC10). */
  private assertCategoryUsable(categoryId: string): void {
    const row = this.db
      .prepare('SELECT type FROM categories WHERE id = ? AND deleted = 0')
      .get(categoryId) as { type: number } | undefined;
    if (row === undefined) {
      throw new ValidationError(`Unknown or deleted category: ${categoryId}`);
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
   * does, instead of each re-implementing the two lookups and drifting. `type` is
   * accepted for signature symmetry with `create` even though the lookup does not need
   * it yet — a rule and its bills share one category, so mismatched types are caught the
   * moment the occurrence is confirmed.
   */
  assertReferencesUsable(_type: number, categoryId: string, accountId: string): void {
    this.assertCategoryUsable(categoryId);
    this.assertAccountUsable(accountId);
  }

  getById(id: string, includeDeleted = false): TransactionDto | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM transactions WHERE id = ?${includeDeleted ? '' : ' AND deleted = 0'}`,
      )
      .get(id) as TransactionRow | undefined;
    return row === undefined ? undefined : toDto(row);
  }

  /**
   * The raw `deleted` flag, or `undefined` when no such row exists.
   *
   * `undefined` and `0` must stay distinguishable: "no such bill" and "this bill is
   * still live" are different answers, and folding them together is how a typo would
   * silently hard-delete the wrong thing.
   */
  private deletedFlag(id: string): number | undefined {
    const row = this.db
      .prepare('SELECT deleted FROM transactions WHERE id = ?')
      .get(id) as { deleted: number } | undefined;
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

  create(input: CreateTransactionInput, id?: string): TransactionDto {
    const type = requireType(input.type);
    const amountCents = requireIntegerCents(input.amountCents, 'amountCents');
    const categoryId = requireNonEmptyString(input.categoryId, 'categoryId');
    const accountId = requireNonEmptyString(input.accountId, 'accountId');
    const date = requireTimestamp(input.date, 'date', this.now());
    const note = typeof input.note === 'string' ? input.note : '';
    const tags = normaliseTags(Array.isArray(input.tags) ? input.tags : []);

    // A refund only makes sense on an expense: a refund is a negative EXPENSE, and
    // "refund income" is not a concept in this model (T4 PRD R5).
    const isRefund = input.isRefund === true;
    if (isRefund && type !== TYPE_EXPENSE) {
      throw new ValidationError('isRefund can only be set on an expense (type 0).');
    }

    this.assertCategoryUsable(categoryId);
    this.assertAccountUsable(accountId);

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
        type,
        amountCents,
        categoryId,
        accountId,
        date,
        note,
        serialiseTags(tags),
        isRefund ? 1 : 0,
        nowMs,
      );

    return this.getByIdOrThrow(rowId);
  }

  /**
   * Partial update. Only the keys present in `input` are changed.
   *
   * `isRefund` is special-cased: flipping it on an income row is rejected, and
   * clearing it is always allowed.
   */
  update(id: string, input: UpdateTransactionInput): TransactionDto {
    const current = this.getByIdOrThrow(id);

    const nextType =
      input.type === undefined ? current.type : requireType(input.type);
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
      input.date === undefined
        ? current.date
        : requireTimestamp(input.date, 'date', this.now());
    const nextNote = input.note === undefined ? current.note : input.note;
    if (typeof nextNote !== 'string') {
      throw new ValidationError('note must be a string.');
    }
    const nextTags =
      input.tags === undefined
        ? current.tags
        : normaliseTags(Array.isArray(input.tags) ? input.tags : []);
    const nextIsRefund =
      input.isRefund === undefined ? current.isRefund : input.isRefund === true;

    if (nextIsRefund && nextType !== TYPE_EXPENSE) {
      throw new ValidationError('isRefund can only be set on an expense (type 0).');
    }

    if (nextCategory !== current.categoryId) this.assertCategoryUsable(nextCategory);
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

    return this.getByIdOrThrow(id);
  }

  /** Soft delete. The row stays in the table with `deleted = 1` (AC3). */
  softDelete(id: string): void {
    this.getByIdOrThrow(id);
    this.db
      .prepare('UPDATE transactions SET deleted = 1, updated_at = ? WHERE id = ?')
      .run(this.now(), id);
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
   * No cascade is needed: `transactions` has no inbound foreign keys (the schema's only
   * `REFERENCES` is `sessions -> users`), so nothing is left dangling.
   */
  purge(id: string): void {
    const deleted = this.deletedFlag(id);
    if (deleted === undefined) throw new NotFoundError();
    if (deleted === 0) {
      throw new ConflictError(
        'Only bills in the recycle bin can be permanently deleted. Delete it first, then purge it.',
      );
    }

    this.db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
  }

  /** Restores every soft-deleted row. Returns how many came back. */
  restoreAll(): number {
    const run = this.db.transaction(
      (): number =>
        this.db.prepare('UPDATE transactions SET deleted = 0, updated_at = ? WHERE deleted = 1').run(
          this.now(),
        ).changes,
    );
    return run();
  }

  /** Permanently deletes every soft-deleted row. Returns how many are gone. */
  purgeAll(): number {
    const run = this.db.transaction(
      (): number => this.db.prepare('DELETE FROM transactions WHERE deleted = 1').run().changes,
    );
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
    return rows.map(toDto);
  }

  /** Number of rows currently in the trash, for the "will delete N" confirmation. */
  countDeleted(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS c FROM transactions WHERE deleted = 1')
      .get() as { c: number };
    return row.c;
  }

  /**
   * Total net expense across the given rows, in cents (may be negative).
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

  /** Total income across the given rows, in cents (refunds excluded). */
  incomeCents(items: readonly TransactionDto[]): number {
    return items.reduce(
      (sum, item) => sum + incomeContribution(item as unknown as Transaction),
      0,
    );
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
      items: rows.map(toDto),
      total: totalRow.c,
      limit,
      offset,
    };
  }

  /** Distinct tag names with usage counts, most used first (feeds T7). */
  listTags(includeDeleted = false): { name: string; count: number }[] {
    const rows = this.db
      .prepare(
        `SELECT tags_json FROM transactions ${includeDeleted ? '' : 'WHERE deleted = 0'}`,
      )
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
