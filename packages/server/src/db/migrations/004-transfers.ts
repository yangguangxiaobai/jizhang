/**
 * Migration 004 — transfers between the user's own accounts.
 *
 * Kept as a TypeScript string rather than a `.sql` file for the reason spelled out in
 * `001-init.ts`: `tsc` does not copy non-TS assets into `dist`, so a `.sql` file would be
 * absent from the built image and the failure would only appear in production.
 *
 * ## Why a own table instead of two linked bills
 *
 * A transfer is neither income nor expense, so it must not reach `expenseContribution` /
 * `incomeContribution`. Encoding it as a pair of transactions would have put the outflow into
 * the expense rule and the inflow into the income rule, and every aggregate — the budget
 * engine, the carryover pool, the monthly trend, the category share — would then need a
 * `transfer_group_id IS NULL` guard. One missed guard is a silently wrong budget.
 *
 * Giving transfers their own table makes that impossible by construction: nothing that
 * computes money even reads this table except `computeAccountBalances`. That is the same
 * reasoning that put `salary_records` in its own table (`spec/backend/index.md`).
 *
 * No foreign keys, matching the rest of the money tables: a soft-deleted account's historical
 * transfers must stay readable.
 */
export const MIGRATION_004_TRANSFERS = `
-- One row is one movement of money from one of the user's own accounts to another.
-- amount_cents is always POSITIVE; the direction is the from/to pair.
CREATE TABLE transfers (
  id              TEXT    PRIMARY KEY,
  from_account_id TEXT    NOT NULL,
  to_account_id   TEXT    NOT NULL,
  amount_cents    INTEGER NOT NULL,
  date            INTEGER NOT NULL,
  note            TEXT    NOT NULL DEFAULT '',
  deleted         INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL
);

-- The list view orders by date and hides soft-deleted rows.
CREATE INDEX idx_transfer_date ON transfers(deleted, date DESC);

-- "Which transfers touched this account" is asked once per side, so both directions get an
-- index. A single index on (from_account_id) would make the incoming side a table scan.
CREATE INDEX idx_transfer_from ON transfers(from_account_id, deleted, date DESC);
CREATE INDEX idx_transfer_to   ON transfers(to_account_id, deleted, date DESC);
`;
