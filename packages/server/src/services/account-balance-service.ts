/**
 * Account balances — the read side of "how much money do I have".
 *
 * The arithmetic lives in `@jizhang/shared` (`account-balance.ts`); this service only reads
 * rows and renames them to camelCase. That split is the project's standing rule: the server
 * owns rows, `shared` owns money (`spec/backend/index.md`: "The accounting rules live in
 * `@jizhang/shared`, not here. The server reads rows and hands them to pure functions").
 *
 * Three reads, one pass, no date filter — see the module comment on
 * `computeAccountBalances` for why the whole ledger counts rather than a window.
 *
 * Soft-deleted accounts are excluded from the query entirely, so their balance leaves the
 * balance sheet while their historical bills stay in the ledger. That is the documented
 * soft-delete behaviour in `database-guidelines.md` ("a soft-deleted row must disappear from
 * derived views too"); the management screen warns how much will leave the total before the
 * user confirms a delete.
 */
import {
  computeAccountBalances,
  totalBalanceCents,
  type AccountFlow,
  type AccountFlowTransaction,
  type SalaryReceipt,
  type TransferLike,
} from '@jizhang/shared';
import type { Db } from '../db/index.js';

export interface AccountBalanceDto {
  readonly accountId: string;
  /** Sent along so a caller can render a row before master data has loaded. */
  readonly name: string;
  readonly type: number;
  readonly initialBalanceCents: number;
  readonly incomeCents: number;
  readonly expenseCents: number;
  readonly salaryCents: number;
  /** Transfers received into this account. */
  readonly transferInCents: number;
  /** Transfers sent out of this account. */
  readonly transferOutCents: number;
  readonly balanceCents: number;
}

export interface AccountBalancesResult {
  readonly items: AccountBalanceDto[];
  readonly totalBalanceCents: number;
}

interface AccountRow {
  readonly id: string;
  readonly name: string;
  readonly type: number;
  readonly initial_balance_cents: number;
}

interface TransactionRow {
  readonly id: string;
  readonly type: number;
  readonly amount_cents: number;
  readonly category_id: string;
  readonly account_id: string;
  readonly date: number;
  readonly is_refund: number;
}

interface SalaryRow {
  readonly account_id: string;
  readonly amount_cents: number;
}

interface TransferRow {
  readonly from_account_id: string;
  readonly to_account_id: string;
  readonly amount_cents: number;
}

export class AccountBalanceService {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  /**
   * Every live account's balance, in the management screen's own order
   * (`sort_order, name`), plus the balance-sheet total.
   *
   * The total is summed from the per-account flows rather than re-aggregated over the raw
   * rows, so the number on the home screen can never disagree with the rows printed under
   * it.
   */
  balances(): AccountBalancesResult {
    const accounts = this.db
      .prepare(
        'SELECT id, name, type, initial_balance_cents FROM accounts WHERE deleted = 0 ORDER BY sort_order, name',
      )
      .all() as AccountRow[];

    const transactionRows = this.db
      .prepare(
        `SELECT id, type, amount_cents, category_id, account_id, date, is_refund
           FROM transactions
          WHERE deleted = 0`,
      )
      .all() as TransactionRow[];

    const salaryRows = this.db
      .prepare(
        'SELECT account_id, amount_cents FROM salary_records WHERE deleted = 0',
      )
      .all() as SalaryRow[];

    const transferRows = this.db
      .prepare(
        'SELECT from_account_id, to_account_id, amount_cents FROM transfers WHERE deleted = 0',
      )
      .all() as TransferRow[];

    const transactions: AccountFlowTransaction[] = transactionRows.map((row) => ({
      id: row.id,
      type: row.type,
      amountCents: row.amount_cents,
      categoryId: row.category_id,
      accountId: row.account_id,
      date: row.date,
      isRefund: row.is_refund === 1,
    }));

    const salaries: SalaryReceipt[] = salaryRows.map((row) => ({
      accountId: row.account_id,
      amountCents: row.amount_cents,
    }));

    // No `date` reaches the shared function for a transfer, and that is not an omission: a
    // balance is a point-in-time stock, and neither bills nor salaries are filtered by date
    // either (see `computeAccountBalances`). Adding a window here would make the home total
    // disagree with the rows listed under it.
    const transfers: TransferLike[] = transferRows.map((row) => ({
      fromAccountId: row.from_account_id,
      toAccountId: row.to_account_id,
      amountCents: row.amount_cents,
    }));

    const flows = computeAccountBalances({
      accounts: accounts.map((row) => ({
        id: row.id,
        initialBalanceCents: row.initial_balance_cents,
      })),
      transactions,
      salaries,
      transfers,
    });

    const byId = new Map<string, AccountFlow>();
    for (const flow of flows) byId.set(flow.accountId, flow);

    const items: AccountBalanceDto[] = accounts.map((row) => {
      const flow = byId.get(row.id);
      // `computeAccountBalances` returns one flow per entry in `accounts`, in that order, so
      // this cannot be missing. Assert rather than substitute a default: an id where a name
      // belongs, or a type-5 account that is really a card, would be a silent lie on screen.
      if (flow === undefined) {
        throw new Error(`No balance was computed for account ${row.id}.`);
      }
      return { ...flow, name: row.name, type: row.type };
    });

    return { items, totalBalanceCents: totalBalanceCents(flows) };
  }
}
