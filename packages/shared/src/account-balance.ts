/**
 * Account balances — "how much money is in this account".
 *
 * ## Why this is a shared pure function
 *
 * A balance is money arithmetic, and every money rule in this project lives in
 * `@jizhang/shared` so that two callers cannot drift apart. The web app does **not** call
 * this (it renders whatever the server sends); the reason it lives here rather than in the
 * server is the same one `spec/backend/index.md` gives for the budget engine: the server
 * owns rows, not arithmetic.
 *
 * ## The rule
 *
 * ```
 * balance = initialBalance + income − netExpense + salaries
 * ```
 *
 * The one thing that is easy to get wrong: a **refund** is a negative expense
 * (`types.ts` `expenseContribution`), so `expenseCents` is a NET figure and a refund
 * therefore *raises* the balance — which is right, the money came back — while
 * `incomeCents` stays untouched, so a refund still never counts as income. Both halves come
 * from `expenseContribution` / `incomeContribution` instead of a local `isRefund` test,
 * which is exactly what keeps this file and `StatsService.monthlyTrend` in agreement.
 *
 * ## Two conventions worth stating because they are choices, not consequences
 *
 * 1. **No date filter.** Every live row counts, whatever its date. The transaction list
 *    does not hide a future-dated bill either, so filtering here would make the home total
 *    disagree with what the user can add up on screen. There is also nothing to filter by:
 *    a recurring bill is not money until the user confirms it, and once confirmed it is a
 *    real row with a real date.
 *
 * 2. **Soft-deleted accounts are not passed in.** They are absent from `accounts` and their
 *    rows are skipped (see the `continue` in the loops below). That is the project's own
 *    soft-delete rule — "a soft-deleted row must disappear from derived views too" — so
 *    deleting an account removes it *and its balance* from the balance sheet while leaving
 *    its historical bills in the ledger. The management screen warns how much will leave
 *    the total before the user confirms.
 */

import {
  expenseContribution,
  incomeContribution,
  type Transaction,
} from './types.js';

/** The part of an account a balance needs. */
export interface AccountLike {
  readonly id: string;
  readonly initialBalanceCents: number;
}

/**
 * A transaction that is known to carry an account.
 *
 * Narrower than `Transaction` (whose `accountId` is optional) because the schema stores
 * `account_id NOT NULL` (`001-init.ts:76`) and a balance that silently dropped a row it
 * could not place would under-report someone's money. Making the requirement part of the
 * type means a caller cannot hand this function a stats-shaped row by accident.
 */
export type AccountFlowTransaction = Transaction & { readonly accountId: string };

/** A salary received into an account. */
export interface SalaryReceipt {
  readonly accountId: string;
  readonly amountCents: number;
}

/** One account's balance, with the parts it was built from. */
export interface AccountFlow {
  readonly accountId: string;
  readonly initialBalanceCents: number;
  /** Income transactions into this account. Refunds are excluded (they are not income). */
  readonly incomeCents: number;
  /** NET expense out of this account: refunds are already subtracted, so may be negative. */
  readonly expenseCents: number;
  /** Salaries recorded into this account. */
  readonly salaryCents: number;
  /** The balance itself; may be negative (a credit card, or an overdraft). */
  readonly balanceCents: number;
}

export interface AccountBalanceInput {
  readonly accounts: readonly AccountLike[];
  readonly transactions: readonly AccountFlowTransaction[];
  readonly salaries: readonly SalaryReceipt[];
}

/**
 * Money entering (`+`) or leaving (`−`) one account because of one ledger row.
 *
 * Exported rather than inlined so a caller that needs a single row's effect (and a test
 * that wants to assert it) does not re-derive the net-expense rule.
 */
export function ledgerFlowCents(txn: AccountFlowTransaction): number {
  return incomeContribution(txn) - expenseContribution(txn);
}

/**
 * Computes one `AccountFlow` per entry in `accounts`, in the order given.
 *
 * Rows referencing an account that is not in `accounts` are ignored. That is the
 * soft-deleted-account case described in the module comment; it is not a silent data loss
 * path, because the caller is expected to pass every account it wants represented.
 */
export function computeAccountBalances(input: AccountBalanceInput): AccountFlow[] {
  const buckets = new Map<string, { income: number; expense: number; salary: number }>();
  for (const account of input.accounts) {
    buckets.set(account.id, { income: 0, expense: 0, salary: 0 });
  }

  for (const txn of input.transactions) {
    const bucket = buckets.get(txn.accountId);
    if (bucket === undefined) continue;
    bucket.income += incomeContribution(txn);
    bucket.expense += expenseContribution(txn);
  }

  for (const salary of input.salaries) {
    const bucket = buckets.get(salary.accountId);
    if (bucket === undefined) continue;
    bucket.salary += salary.amountCents;
  }

  return input.accounts.map((account) => {
    const bucket = buckets.get(account.id) ?? { income: 0, expense: 0, salary: 0 };
    return {
      accountId: account.id,
      initialBalanceCents: account.initialBalanceCents,
      incomeCents: bucket.income,
      expenseCents: bucket.expense,
      salaryCents: bucket.salary,
      balanceCents:
        account.initialBalanceCents + bucket.income + bucket.salary - bucket.expense,
    };
  });
}

/**
 * The balance sheet total.
 *
 * Summed from the per-account flows rather than recomputed over the raw rows, so the figure
 * on the home screen can never disagree with the rows printed under it.
 */
export function totalBalanceCents(items: readonly AccountFlow[]): number {
  return items.reduce((sum, item) => sum + item.balanceCents, 0);
}
