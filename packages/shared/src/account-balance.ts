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

/**
 * A movement of money between two of the user's own accounts.
 *
 * Deliberately not a `Transaction`, and deliberately its own table in the schema. See
 * `transferFlowCents` for why that is the whole point rather than a filing decision.
 */
export interface TransferLike {
  readonly fromAccountId: string;
  readonly toAccountId: string;
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
  /** Transfers received into this account. */
  readonly transferInCents: number;
  /** Transfers sent out of this account. */
  readonly transferOutCents: number;
  /** The balance itself; may be negative (a credit card, or an overdraft). */
  readonly balanceCents: number;
}

export interface AccountBalanceInput {
  readonly accounts: readonly AccountLike[];
  readonly transactions: readonly AccountFlowTransaction[];
  readonly salaries: readonly SalaryReceipt[];
  /** Optional so a caller with no transfer table (or no transfers) needs no special case. */
  readonly transfers?: readonly TransferLike[] | undefined;
}

/**
 * Money entering (`+`) or leaving (`−`) one account because of one transfer.
 *
 * This one function is the entire accounting content of the transfer feature, and the reason
 * transfers are a separate table rather than two linked bills:
 *
 * ```
 * Σ over all accounts of transferFlowCents(t, accountId) === 0
 * ```
 *
 * A transfer moves money; it does not create or destroy it, and it is neither income nor
 * expense. Because nothing in `budget-engine.ts` or `stats-service.ts` reads this table, that
 * property is structural — there is no filter anyone can forget to add. Encoding a transfer as
 * a pair of transactions would instead have put the outflow into `expenseContribution` and the
 * inflow into `incomeContribution`, so every aggregate would have needed a
 * `transfer_group_id IS NULL` guard, and one missed guard is a silently wrong budget.
 *
 * `fromAccountId === toAccountId` is rejected by the service, so the two branches cannot both
 * match and the net-zero property holds without a special case.
 */
export function transferFlowCents(transfer: TransferLike, accountId: string): number {
  if (transfer.fromAccountId === accountId) return -transfer.amountCents;
  if (transfer.toAccountId === accountId) return transfer.amountCents;
  return 0;
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
 *
 * A transfer into or out of such an account still counts on the **live** side. A transfer is
 * one row with two branches, so `<live account> -> <deleted account>` reduces the live
 * account's balance and the total drops by the same amount — which is the same thing that
 * happens when an account with a positive balance is deleted, and is therefore consistent
 * rather than special. The alternative (discarding the whole movement) would make a live
 * account's balance silently ignore money that really left it.
 */
export function computeAccountBalances(input: AccountBalanceInput): AccountFlow[] {
  interface Bucket {
    income: number;
    expense: number;
    salary: number;
    transferIn: number;
    transferOut: number;
  }

  const empty = (): Bucket => ({
    income: 0,
    expense: 0,
    salary: 0,
    transferIn: 0,
    transferOut: 0,
  });

  const buckets = new Map<string, Bucket>();
  for (const account of input.accounts) {
    buckets.set(account.id, empty());
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

  for (const transfer of input.transfers ?? []) {
    // Only the two accounts the transfer names, and the side is decided by the one exported
    // rule rather than by a second `fromAccountId === accountId` test here.
    for (const accountId of [transfer.fromAccountId, transfer.toAccountId]) {
      const bucket = buckets.get(accountId);
      if (bucket === undefined) continue;
      const flow = transferFlowCents(transfer, accountId);
      if (flow > 0) bucket.transferIn += flow;
      else if (flow < 0) bucket.transferOut += -flow;
    }
  }

  return input.accounts.map((account) => {
    // `buckets` was filled from `accounts` in this same call, so the id is always present.
    // The fallback is an all-zero bucket — exactly what an account with no flows holds — so
    // it cannot change an answer the way substituting a different value would.
    const bucket = buckets.get(account.id) ?? empty();
    return {
      accountId: account.id,
      initialBalanceCents: account.initialBalanceCents,
      incomeCents: bucket.income,
      expenseCents: bucket.expense,
      salaryCents: bucket.salary,
      transferInCents: bucket.transferIn,
      transferOutCents: bucket.transferOut,
      balanceCents:
        account.initialBalanceCents +
        bucket.income +
        bucket.salary +
        bucket.transferIn -
        bucket.expense -
        bucket.transferOut,
    };
  });
}

/**
 * The balance sheet, split into what the user *has* and what the user *owes*.
 *
 * A credit card, 抖音月付, 花呗, or an overdrawn current account is modelled the same way as
 * everything else — an account with a **negative** balance — so the split needs no flag on the
 * account and no new user decision. The sign is the whole rule:
 *
 * - a positive balance is money you have (`assetsCents`);
 * - a negative balance is money you owe, reported as a **positive magnitude**
 *   (`liabilitiesCents`) so a screen never has to render "欠款 −¥1,234";
 * - a zero balance is neither.
 *
 * The sign rather than the account's `type` is deliberate: a user who files 抖音月付 under
 * "其他" (a perfectly reasonable thing to do) still gets a correct answer, and a credit card
 * the user has overpaid counts as an asset — which it is, the bank owes them.
 *
 * `netCents` is the same figure `totalBalanceCents` has always returned, so nothing that only
 * wants "the total" has to care about this split.
 */
export interface BalanceSheet {
  /** Money on hand: the sum of the positive account balances. */
  readonly assetsCents: number;
  /** Money owed, as a positive magnitude: the sum of the negative balances, negated. */
  readonly liabilitiesCents: number;
  /** `assets − liabilities`. May be negative when the debts exceed the money. */
  readonly netCents: number;
}

/**
 * Splits a set of account flows into assets, liabilities and the net.
 *
 * Summed from the per-account flows rather than recomputed over the raw rows, so the figures on
 * the home screen can never disagree with the rows printed under them.
 */
export function computeBalanceSheet(items: readonly AccountFlow[]): BalanceSheet {
  let assetsCents = 0;
  let liabilitiesCents = 0;
  for (const item of items) {
    if (item.balanceCents > 0) assetsCents += item.balanceCents;
    else if (item.balanceCents < 0) liabilitiesCents += -item.balanceCents;
  }
  return { assetsCents, liabilitiesCents, netCents: assetsCents - liabilitiesCents };
}

/**
 * The balance-sheet total, i.e. the net (`assets − liabilities`).
 *
 * Kept as its own name because "the total" is what most callers want and what the tests assert;
 * the arithmetic lives in `computeBalanceSheet` so there is exactly one implementation.
 */
export function totalBalanceCents(items: readonly AccountFlow[]): number {
  return computeBalanceSheet(items).netCents;
}
