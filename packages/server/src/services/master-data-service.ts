/**
 * Master-data service: categories, accounts, and the derived tag vocabulary.
 *
 * Contract (T7 PRD):
 *   * seeded rows carry `is_builtin = 1` and **cannot be deleted** — they can be
 *     renamed and recoloured, because the preset name is a suggestion, not a
 *     constraint;
 *   * deleting a category or account is a SOFT delete. Existing transactions keep
 *     referencing it and must still render a name, so nothing cascades onto
 *     historical rows;
 *   * a soft-deleted category stops being selectable, which is enforced by the
 *     transaction service's reference check rather than here;
 *   * tags have no table — the NAME is the identity (design.md §3) — so renaming or
 *     deleting one means rewriting `tags_json` on every referencing transaction, in
 *     one transaction, reusing the shared tag parser so the de-duplication rule
 *     cannot drift.
 */
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/index.js';
import { normaliseTags, parseTagsJson, serialiseTags } from './tags.js';
import { NotFoundError, ValidationError } from './transaction-service.js';

// ── categories ──────────────────────────────────────────────────────────────

/** Category/account kinds, mirroring the reference model. */
export const CATEGORY_TYPE_EXPENSE = 0;
export const CATEGORY_TYPE_INCOME = 1;

const ACCOUNT_TYPES = [0, 1, 2, 3, 4, 5] as const;

interface CategoryRow {
  readonly id: string;
  readonly name: string;
  readonly type: number;
  readonly icon: string;
  readonly color: number;
  readonly sort_order: number;
  readonly is_builtin: number;
  readonly deleted: number;
  readonly updated_at: number;
}

interface AccountRow {
  readonly id: string;
  readonly name: string;
  readonly type: number;
  readonly initial_balance_cents: number;
  readonly sort_order: number;
  readonly is_builtin: number;
  readonly deleted: number;
  readonly updated_at: number;
}

export interface CategoryDto {
  readonly id: string;
  readonly name: string;
  readonly type: number;
  readonly icon: string;
  readonly color: number;
  readonly sortOrder: number;
  readonly isBuiltin: boolean;
  readonly updatedAt: number;
}

export interface AccountDto {
  readonly id: string;
  readonly name: string;
  readonly type: number;
  readonly initialBalanceCents: number;
  readonly sortOrder: number;
  readonly isBuiltin: boolean;
  readonly updatedAt: number;
}

function toCategoryDto(row: CategoryRow): CategoryDto {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    icon: row.icon,
    color: row.color,
    sortOrder: row.sort_order,
    isBuiltin: row.is_builtin === 1,
    updatedAt: row.updated_at,
  };
}

function toAccountDto(row: AccountRow): AccountDto {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    initialBalanceCents: row.initial_balance_cents,
    sortOrder: row.sort_order,
    isBuiltin: row.is_builtin === 1,
    updatedAt: row.updated_at,
  };
}

export interface MasterDataServiceOptions {
  readonly now?: () => number;
}

export class MasterDataService {
  private readonly db: Db;
  private readonly now: () => number;

  constructor(db: Db, options: MasterDataServiceOptions = {}) {
    this.db = db;
    this.now = options.now ?? (() => Date.now());
  }

  // ── categories ────────────────────────────────────────────────────────────

  listCategories(type?: number, includeDeleted = false): CategoryDto[] {
    const allRows =
      type === undefined
        ? (this.db.prepare('SELECT * FROM categories ORDER BY type, sort_order, name').all() as CategoryRow[])
        : (this.db
            .prepare('SELECT * FROM categories WHERE type = ? ORDER BY sort_order, name')
            .all(type) as CategoryRow[]);
    const rows = includeDeleted
      ? allRows
      : allRows.filter((row) => row.deleted === 0);
    return rows.map(toCategoryDto);
  }

  /** Includes soft-deleted rows; used to resolve a historical transaction's name. */
  getCategory(id: string, includeDeleted = false): CategoryDto | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM categories WHERE id = ?${includeDeleted ? '' : ' AND deleted = 0'}`,
      )
      .get(id) as CategoryRow | undefined;
    return row === undefined ? undefined : toCategoryDto(row);
  }

  getCategoryOrThrow(id: string): CategoryDto {
    const found = this.getCategory(id);
    if (found === undefined) throw new NotFoundError('Category not found.');
    return found;
  }

  private nextSortOrder(table: 'categories' | 'accounts', type?: number): number {
    const row = (
      type === undefined
        ? this.db.prepare(`SELECT MAX(sort_order) AS m FROM ${table}`).get()
        : this.db
            .prepare(`SELECT MAX(sort_order) AS m FROM ${table} WHERE type = ?`)
            .get(type)
    ) as { m: number | null };
    return (row.m ?? -1) + 1;
  }

  createCategory(input: {
    readonly name?: unknown;
    readonly type?: unknown;
    readonly icon?: unknown;
    readonly color?: unknown;
    readonly sortOrder?: unknown;
  }): CategoryDto {
    const name = this.requireName(input.name);
    const type = this.requireCategoryType(input.type);
    const icon = this.requireIcon(input.icon);
    const color = this.requireColor(input.color);
    const sortOrder =
      typeof input.sortOrder === 'number' && Number.isInteger(input.sortOrder)
        ? input.sortOrder
        : this.nextSortOrder('categories', type);

    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO categories (id, name, type, icon, color, sort_order, is_builtin, deleted, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)`,
      )
      .run(id, name, type, icon, color, sortOrder, this.now());

    return this.getCategoryOrThrow(id);
  }

  updateCategory(
    id: string,
    input: {
      readonly name?: unknown;
      readonly icon?: unknown;
      readonly color?: unknown;
      readonly sortOrder?: unknown;
    },
  ): CategoryDto {
    // Builtin rows are editable: the preset name is a default, not a lock.
    this.getCategoryOrThrow(id);

    const updates: string[] = [];
    const params: (string | number)[] = [];

    if (input.name !== undefined) {
      updates.push('name = ?');
      params.push(this.requireName(input.name));
    }
    if (input.icon !== undefined) {
      updates.push('icon = ?');
      params.push(this.requireIcon(input.icon));
    }
    if (input.color !== undefined) {
      updates.push('color = ?');
      params.push(this.requireColor(input.color));
    }
    if (input.sortOrder !== undefined) {
      if (typeof input.sortOrder !== 'number' || !Number.isInteger(input.sortOrder)) {
        throw new ValidationError('sortOrder must be an integer.');
      }
      updates.push('sort_order = ?');
      params.push(input.sortOrder);
    }

    if (updates.length === 0) return this.getCategoryOrThrow(id);

    updates.push('updated_at = ?');
    params.push(this.now());
    params.push(id);
    this.db.prepare(`UPDATE categories SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    return this.getCategoryOrThrow(id);
  }

  /**
   * Soft-deletes a category. Builtin categories refuse (PRD R3).
   *
   * Historical transactions are deliberately left alone: rewriting them would
   * falsify the ledger. Their category name still resolves via
   * `getCategory(id, true)`, and recurring rules that could never confirm against a
   * deleted category are retired in the same transaction so the pending queue cannot
   * dead-end.
   */
  deleteCategory(id: string): void {
    const category = this.getCategoryOrThrow(id);
    if (category.isBuiltin) {
      throw new ValidationError('A builtin category cannot be deleted.');
    }
    const at = this.now();
    this.db.transaction(() => {
      this.db
        .prepare('UPDATE categories SET deleted = 1, updated_at = ? WHERE id = ?')
        .run(at, id);
      // A rule is a definition of future bills, so deleting the category should stop it
      // too; already-confirmed and ignored occurrences are history and stay visible.
      this.db
        .prepare(
          'UPDATE recurring_rules SET deleted = 1, updated_at = ? WHERE deleted = 0 AND category_id = ?',
        )
        .run(at, id);
      this.db
        .prepare(
          "UPDATE recurring_occurrences SET deleted = 1, updated_at = ? WHERE deleted = 0 AND status = 'pending' AND category_id = ?",
        )
        .run(at, id);
    })();
  }

  /** How many live transactions reference a category. */
  countTransactionsForCategory(id: string): number {
    const row = this.db
      .prepare(
        'SELECT COUNT(*) AS c FROM transactions WHERE category_id = ? AND deleted = 0',
      )
      .get(id) as { c: number };
    return row.c;
  }

  // ── accounts ──────────────────────────────────────────────────────────────

  listAccounts(includeDeleted = false): AccountDto[] {
    const rows = this.db
      .prepare('SELECT * FROM accounts ORDER BY sort_order, name')
      .all() as AccountRow[];
    return rows
      .filter((row) => includeDeleted || row.deleted === 0)
      .map(toAccountDto);
  }

  getAccount(id: string, includeDeleted = false): AccountDto | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM accounts WHERE id = ?${includeDeleted ? '' : ' AND deleted = 0'}`,
      )
      .get(id) as AccountRow | undefined;
    return row === undefined ? undefined : toAccountDto(row);
  }

  getAccountOrThrow(id: string): AccountDto {
    const found = this.getAccount(id);
    if (found === undefined) throw new NotFoundError('Account not found.');
    return found;
  }

  createAccount(input: {
    readonly name?: unknown;
    readonly type?: unknown;
    readonly initialBalanceCents?: unknown;
    readonly sortOrder?: unknown;
  }): AccountDto {
    const name = this.requireName(input.name);
    const type = this.requireAccountType(input.type);
    const balance = this.requireBalance(input.initialBalanceCents);
    const sortOrder =
      typeof input.sortOrder === 'number' && Number.isInteger(input.sortOrder)
        ? input.sortOrder
        : this.nextSortOrder('accounts');

    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO accounts (id, name, type, initial_balance_cents, sort_order, is_builtin, deleted, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, 0, ?)`,
      )
      .run(id, name, type, balance, sortOrder, this.now());

    return this.getAccountOrThrow(id);
  }

  updateAccount(
    id: string,
    input: {
      readonly name?: unknown;
      readonly type?: unknown;
      readonly initialBalanceCents?: unknown;
      readonly sortOrder?: unknown;
    },
  ): AccountDto {
    const current = this.getAccountOrThrow(id);

    const updates: string[] = [];
    const params: (string | number)[] = [];

    if (input.name !== undefined) {
      updates.push('name = ?');
      params.push(this.requireName(input.name));
    }
    if (input.type !== undefined) {
      updates.push('type = ?');
      params.push(this.requireAccountType(input.type));
    }
    if (input.initialBalanceCents !== undefined) {
      updates.push('initial_balance_cents = ?');
      params.push(this.requireBalance(input.initialBalanceCents));
    }
    if (input.sortOrder !== undefined) {
      if (typeof input.sortOrder !== 'number' || !Number.isInteger(input.sortOrder)) {
        throw new ValidationError('sortOrder must be an integer.');
      }
      updates.push('sort_order = ?');
      params.push(input.sortOrder);
    }

    if (updates.length === 0) return current;

    updates.push('updated_at = ?');
    params.push(this.now());
    params.push(id);
    this.db.prepare(`UPDATE accounts SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    return this.getAccountOrThrow(id);
  }

  deleteAccount(id: string): void {
    const account = this.getAccountOrThrow(id);
    if (account.isBuiltin) {
      throw new ValidationError('The default account cannot be deleted.');
    }
    // The last remaining account must survive, or a new transaction has nothing to
    // be filed under.
    if (this.listAccounts().length <= 1) {
      throw new ValidationError('At least one account must remain.');
    }
    const at = this.now();
    this.db.transaction(() => {
      this.db
        .prepare('UPDATE accounts SET deleted = 1, updated_at = ? WHERE id = ?')
        .run(at, id);
      this.db
        .prepare(
          'UPDATE recurring_rules SET deleted = 1, updated_at = ? WHERE deleted = 0 AND account_id = ?',
        )
        .run(at, id);
      this.db
        .prepare(
          "UPDATE recurring_occurrences SET deleted = 1, updated_at = ? WHERE deleted = 0 AND status = 'pending' AND account_id = ?",
        )
        .run(at, id);
    })();
  }

  countTransactionsForAccount(id: string): number {
    const row = this.db
      .prepare(
        'SELECT COUNT(*) AS c FROM transactions WHERE account_id = ? AND deleted = 0',
      )
      .get(id) as { c: number };
    return row.c;
  }

  /** Moves a category one slot up or down within its list. */
  moveCategory(id: string, direction: -1 | 1): CategoryDto[] {
    this.getCategoryOrThrow(id);
    this.moveWithin('categories', id, direction);
    return this.listCategories();
  }

  moveAccount(id: string, direction: -1 | 1): AccountDto[] {
    this.getAccountOrThrow(id);
    this.moveWithin('accounts', id, direction);
    return this.listAccounts();
  }

  /**
   * Swaps `sort_order` with the neighbour in the given direction.
   *
   * Re-numbering the whole list on every move would be simpler but rewrites every
   * row's `updated_at`; swapping two neighbours keeps the change minimal, which
   * matters if a sync layer ever lands on top of this.
   */
  private moveWithin(
    table: 'categories' | 'accounts',
    id: string,
    direction: -1 | 1,
  ): void {
    const current = this.db
      .prepare(`SELECT id, sort_order FROM ${table} WHERE id = ?`)
      .get(id) as { id: string; sort_order: number };

    const neighbour = (
      direction === -1
        ? this.db
            .prepare(
              `SELECT id, sort_order FROM ${table} WHERE deleted = 0 AND sort_order < ? ORDER BY sort_order DESC LIMIT 1`,
            )
            .get(current.sort_order)
        : this.db
            .prepare(
              `SELECT id, sort_order FROM ${table} WHERE deleted = 0 AND sort_order > ? ORDER BY sort_order ASC LIMIT 1`,
            )
            .get(current.sort_order)
    ) as { id: string; sort_order: number } | undefined;

    if (neighbour === undefined) return;

    const nowMs = this.now();
    const run = this.db.transaction((): void => {
      this.db
        .prepare(`UPDATE ${table} SET sort_order = ?, updated_at = ? WHERE id = ?`)
        .run(neighbour.sort_order, nowMs, current.id);
      this.db
        .prepare(`UPDATE ${table} SET sort_order = ?, updated_at = ? WHERE id = ?`)
        .run(current.sort_order, nowMs, neighbour.id);
    });
    run();
  }

  // ── tags (derived: the name is the identity) ──────────────────────────────

  /** Distinct tag names with live usage counts, most used first. */
  listTags(): { name: string; count: number }[] {
    const rows = this.db
      .prepare("SELECT tags_json FROM transactions WHERE deleted = 0 AND tags_json <> '[]'")
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

  /**
   * Renames a tag everywhere it appears.
   *
   * Every referencing row is rewritten in ONE transaction: a partial rewrite would
   * leave the ledger with two spellings of the same tag and the counts would lie.
   */
  renameTag(from: string, to: string): { updated: number } {
    const source = from.trim();
    const target = to.trim();
    if (source === '') throw new ValidationError('The current tag name is required.');
    if (target === '') throw new ValidationError('The new tag name is required.');
    if (source === target) return { updated: 0 };

    return this.rewriteTags((tags) => {
      const renamed = tags.map((tag) => (tag === source ? target : tag));
      // Renaming onto an existing tag merges them; `normaliseTags` de-duplicates.
      return renamed;
    });
  }

  /** Removes a tag from every transaction that carries it. */
  deleteTag(name: string): { updated: number } {
    const target = name.trim();
    if (target === '') throw new ValidationError('A tag name is required.');
    return this.rewriteTags((tags) => tags.filter((tag) => tag !== target));
  }

  /**
   * Applies `transform` to the tag list of every live transaction, writing back only
   * the rows whose tags actually changed.
   */
  private rewriteTags(transform: (tags: string[]) => string[]): { updated: number } {
    const rows = this.db
      .prepare('SELECT id, tags_json FROM transactions WHERE deleted = 0')
      .all() as { id: string; tags_json: string }[];

    const updates: { id: string; json: string }[] = [];
    for (const row of rows) {
      const current = parseTagsJson(row.tags_json);
      if (current.length === 0) continue;
      const next = normaliseTags(transform(current));
      const nextJson = serialiseTags(next);
      if (nextJson !== serialiseTags(current)) {
        updates.push({ id: row.id, json: nextJson });
      }
    }

    if (updates.length === 0) return { updated: 0 };

    const nowMs = this.now();
    const statement = this.db.prepare(
      'UPDATE transactions SET tags_json = ?, updated_at = ? WHERE id = ?',
    );
    const run = this.db.transaction((): void => {
      for (const update of updates) {
        statement.run(update.json, nowMs, update.id);
      }
    });
    run();

    return { updated: updates.length };
  }

  // ── validation helpers ────────────────────────────────────────────────────

  private requireName(value: unknown): string {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new ValidationError('A name is required.');
    }
    const name = value.trim();
    if (name.length > 40) throw new ValidationError('The name is too long (max 40).');
    return name;
  }

  private requireCategoryType(value: unknown): number {
    if (value !== CATEGORY_TYPE_EXPENSE && value !== CATEGORY_TYPE_INCOME) {
      throw new ValidationError('type must be 0 (expense) or 1 (income).');
    }
    return value;
  }

  private requireAccountType(value: unknown): number {
    if (typeof value !== 'number' || !(ACCOUNT_TYPES as readonly number[]).includes(value)) {
      throw new ValidationError(
        `Account type must be one of ${ACCOUNT_TYPES.join(', ')}.`,
      );
    }
    return value;
  }

  private requireIcon(value: unknown): string {
    if (value === undefined || value === null || value === '') return 'other';
    if (typeof value !== 'string') throw new ValidationError('icon must be a string.');
    const icon = value.trim();
    if (icon.length > 32) throw new ValidationError('icon is too long (max 32).');
    return icon === '' ? 'other' : icon;
  }

  private requireColor(value: unknown): number {
    if (value === undefined || value === null || value === '') return 0xff847d74;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      throw new ValidationError('color must be an ARGB integer.');
    }
    return value;
  }

  private requireBalance(value: unknown): number {
    if (value === undefined || value === null || value === '') return 0;
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new ValidationError('initialBalanceCents must be an integer number of cents.');
    }
    return value;
  }
}
