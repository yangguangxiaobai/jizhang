/**
 * Transfers: moving money between the user's own accounts.
 *
 * A transfer is **neither income nor expense**. It changes two account balances and nothing
 * else — no budget module, no carryover pool, no monthly trend, no category share. That is
 * enforced structurally by this table being invisible to every one of those code paths (see
 * `migration 004` and `account-balance.ts`), not by remembering to filter it out.
 *
 * Validation rules are deliberately the same ones a salary uses, so the two money writers
 * cannot disagree about what "a valid amount" or "a plausible date" means. The account lookup
 * is the shared `assertAccountUsable`, for the same reason.
 */
import type { Db } from '../db/index.js';
import { randomUUID } from 'node:crypto';
import {
  NotFoundError,
  ValidationError,
  assertAccountUsable,
  requireNonEmptyString,
} from './transaction-service.js';
import { requireLedgerDate, requirePositiveSafeIntegerCents } from './ledger-input-validation.js';

export const DEFAULT_TRANSFER_PAGE_SIZE = 50;
export const MAX_TRANSFER_PAGE_SIZE = 500;

interface TransferRow {
  readonly id: string;
  readonly from_account_id: string;
  readonly to_account_id: string;
  readonly amount_cents: number;
  readonly date: number;
  readonly note: string;
  readonly updated_at: number;
}

export interface TransferDto {
  readonly id: string;
  readonly fromAccountId: string;
  readonly toAccountId: string;
  /** Always positive; the direction is the from/to pair. */
  readonly amountCents: number;
  readonly date: number;
  readonly note: string;
  readonly updatedAt: number;
}

export interface ListTransfersQuery {
  readonly accountId?: string | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}

export interface ListTransfersResult {
  readonly items: TransferDto[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface TransferServiceOptions {
  /** Injectable clock, so date validation is deterministic in tests. */
  readonly now?: () => number;
}

function toDto(row: TransferRow): TransferDto {
  return {
    id: row.id,
    fromAccountId: row.from_account_id,
    toAccountId: row.to_account_id,
    amountCents: row.amount_cents,
    date: row.date,
    note: row.note,
    updatedAt: row.updated_at,
  };
}

export class TransferService {
  private readonly db: Db;
  private readonly now: () => number;

  constructor(db: Db, options: TransferServiceOptions = {}) {
    this.db = db;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * The pair of accounts, validated.
   *
   * `from === to` is rejected rather than tolerated: it would be a no-op row, and it would make
   * `transferFlowCents` ambiguous — that function relies on the two branches being mutually
   * exclusive to guarantee a transfer cannot change the balance-sheet total.
   */
  private requireAccountPair(
    from: unknown,
    to: unknown,
  ): { fromAccountId: string; toAccountId: string } {
    const fromAccountId = requireNonEmptyString(from, 'fromAccountId');
    const toAccountId = requireNonEmptyString(to, 'toAccountId');
    if (fromAccountId === toAccountId) {
      throw new ValidationError('A transfer needs two different accounts.');
    }
    assertAccountUsable(this.db, fromAccountId);
    assertAccountUsable(this.db, toAccountId);
    return { fromAccountId, toAccountId };
  }

  list(query: ListTransfersQuery = {}): ListTransfersResult {
    const limit = Math.min(
      Math.max(Math.trunc(query.limit ?? DEFAULT_TRANSFER_PAGE_SIZE), 1),
      MAX_TRANSFER_PAGE_SIZE,
    );
    const offset = Math.max(Math.trunc(query.offset ?? 0), 0);

    const where: string[] = ['deleted = 0'];
    const params: (string | number)[] = [];
    if (query.accountId !== undefined && query.accountId !== '') {
      // Either side counts as "touching" this account, so the OR is the query the account
      // drill-down wants rather than two calls.
      where.push('(from_account_id = ? OR to_account_id = ?)');
      params.push(query.accountId, query.accountId);
    }

    const clause = where.join(' AND ');
    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS c FROM transfers WHERE ${clause}`)
      .get(...params) as { c: number };

    const rows = this.db
      .prepare(
        `SELECT * FROM transfers
          WHERE ${clause}
          ORDER BY date DESC, updated_at DESC
          LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as TransferRow[];

    return { items: rows.map(toDto), total: totalRow.c, limit, offset };
  }

  getById(id: string): TransferDto | undefined {
    const row = this.db
      .prepare('SELECT * FROM transfers WHERE id = ? AND deleted = 0')
      .get(id) as TransferRow | undefined;
    return row === undefined ? undefined : toDto(row);
  }

  getByIdOrThrow(id: string): TransferDto {
    const found = this.getById(id);
    if (found === undefined) throw new NotFoundError('Transfer not found.');
    return found;
  }

  create(input: {
    readonly fromAccountId?: unknown;
    readonly toAccountId?: unknown;
    readonly amountCents?: unknown;
    readonly date?: unknown;
    readonly note?: unknown;
  }): TransferDto {
    const { fromAccountId, toAccountId } = this.requireAccountPair(
      input.fromAccountId,
      input.toAccountId,
    );
    const amountCents = requirePositiveSafeIntegerCents(input.amountCents);
    const date = requireLedgerDate(input.date, () => this.now());
    const note = typeof input.note === 'string' ? input.note : '';

    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO transfers
           (id, from_account_id, to_account_id, amount_cents, date, note, deleted, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
      )
      .run(id, fromAccountId, toAccountId, amountCents, date, note, this.now());

    return this.getByIdOrThrow(id);
  }

  /**
   * Edits a transfer in place.
   *
   * No allocation-style trap here: a transfer has no snapshot derived from its amount, so the
   * amount may change on its own. Both balances are recomputed from the row, so there is
   * nothing to keep in sync.
   */
  update(
    id: string,
    changes: {
      readonly fromAccountId?: unknown;
      readonly toAccountId?: unknown;
      readonly amountCents?: unknown;
      readonly date?: unknown;
      readonly note?: unknown;
    },
  ): TransferDto {
    const current = this.getByIdOrThrow(id);
    if (
      changes.fromAccountId === undefined &&
      changes.toAccountId === undefined &&
      changes.amountCents === undefined &&
      changes.date === undefined &&
      changes.note === undefined
    ) {
      return current;
    }

    const { fromAccountId, toAccountId } = this.requireAccountPair(
      changes.fromAccountId ?? current.fromAccountId,
      changes.toAccountId ?? current.toAccountId,
    );
    const amountCents =
      changes.amountCents === undefined
        ? current.amountCents
        : requirePositiveSafeIntegerCents(changes.amountCents);
    const date = changes.date === undefined ? current.date : requireLedgerDate(changes.date, () => this.now());
    if (changes.note !== undefined && typeof changes.note !== 'string') {
      throw new ValidationError('note must be a string.');
    }
    const note = changes.note === undefined ? current.note : changes.note;

    this.db
      .prepare(
        `UPDATE transfers
            SET from_account_id = ?, to_account_id = ?, amount_cents = ?, date = ?, note = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(fromAccountId, toAccountId, amountCents, date, note, this.now(), id);

    return this.getByIdOrThrow(id);
  }

  /**
   * Soft-deletes a transfer, which restores both balances exactly.
   *
   * No recycle bin, matching the existing scope decision that the bin covers transactions only.
   * The balance is derived from live rows, so undeleting would be enough on its own — there is
   * deliberately no restore endpoint until someone decides what the bin means for money rows
   * that are not bills.
   */
  softDelete(id: string): void {
    this.getByIdOrThrow(id);
    this.db
      .prepare('UPDATE transfers SET deleted = 1, updated_at = ? WHERE id = ?')
      .run(this.now(), id);
  }
}
