/**
 * Migration 003 — a salary is received into an account.
 *
 * Kept as a TypeScript string rather than a `.sql` file for the reason spelled out in
 * `001-init.ts`: `tsc` does not copy non-TS assets into `dist`, so a `.sql` file would be
 * absent from the built image and the failure would only appear in production.
 *
 * ## Why only a column
 *
 * `salary_records` was the one money-bearing table with nowhere for the money to land: a
 * salary carried an allocation snapshot but no account, so it could not take part in a
 * balance. Adding the column is the whole schema change for this feature — the balance
 * itself is derived, never stored (`database-guidelines.md`: "No materialised balances,
 * ever").
 *
 * ## Why the DEFAULT is a hard-coded id, and why that is safe here
 *
 * SQLite's `ALTER TABLE ... ADD COLUMN` accepts only a constant default, so the backfill
 * cannot be an expression or a subquery. `'builtin-default-account'` is the right constant:
 * `BUILTIN_DEFAULT_ACCOUNT_ID` is a stable, documented constant that the application
 * refuses to delete (`master-data-service.ts`: "The default account cannot be deleted"),
 * and every seeded or legacy transaction already points at it. Existing salary rows — there
 * are none on the live install, but the migration must be correct regardless — therefore
 * land on the account they were always implicitly associated with, with no `UPDATE` pass
 * and no window in which the column is null.
 *
 * No foreign key, deliberately: the schema's only `REFERENCES` clauses are
 * `sessions -> users` and `recurring_occurrences -> recurring_rules`, and no other
 * money table constrains its `account_id`. Matching that keeps a soft-deleted account's
 * historical rows readable, which is the documented soft-delete behaviour.
 *
 * Ordering note: `initializeDatabase` migrates before it seeds (`db/index.ts`), so on a
 * brand-new install this column exists before the account row does. Without a foreign key
 * that is harmless.
 */
export const MIGRATION_003_SALARY_ACCOUNT = `
-- Which account received the salary. Required for every new row; the default exists only
-- to give pre-existing rows a value in the same statement that adds the column.
ALTER TABLE salary_records
  ADD COLUMN account_id TEXT NOT NULL DEFAULT 'builtin-default-account';

-- Serves the per-account balance aggregation, which groups by account over live rows.
CREATE INDEX idx_salary_account ON salary_records(account_id, deleted, date DESC);
`;
