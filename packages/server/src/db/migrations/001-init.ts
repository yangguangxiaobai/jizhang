/**
 * Migration 001 — the initial schema.
 *
 * Kept as a TypeScript string rather than a `.sql` file on purpose: `tsc` does not
 * copy non-TS assets into `dist`, so a `.sql` next to the sources would silently
 * be missing from the built image and migrations would fail only in production.
 * A TS module is emitted by the compiler and cannot drift from the build.
 *
 * See `packages/server/src/db/migrations/README.md` for the rules a new migration
 * must follow.
 */
export const MIGRATION_001_INIT = `
-- Every money column is an INTEGER number of CENTS. Never a float.
-- Every timestamp is an INTEGER of epoch milliseconds.
-- Business rows are SOFT deleted (\`deleted\`); nothing is physically removed.

-- ── single user + sessions (parent task D7: one account, no registration) ──────
CREATE TABLE users (
  id            TEXT    PRIMARY KEY,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- Only the SHA-256 of the session token is stored, so a database leak does not
-- hand over usable sessions (design.md §3).
CREATE TABLE sessions (
  token_hash TEXT    PRIMARY KEY,
  user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user    ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- ── master data ───────────────────────────────────────────────────────────────
-- type: 0 = expense, 1 = income
-- is_builtin marks the seeded rows that must not be deleted.
CREATE TABLE categories (
  id         TEXT    PRIMARY KEY,
  name       TEXT    NOT NULL,
  type       INTEGER NOT NULL,
  icon       TEXT    NOT NULL,
  color      INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  deleted    INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_categories_type ON categories(type, deleted, sort_order);

-- type: 0 cash, 1 debit card, 2 credit card, 3 alipay, 4 wechat, 5 other
CREATE TABLE accounts (
  id                    TEXT    PRIMARY KEY,
  name                  TEXT    NOT NULL,
  type                  INTEGER NOT NULL,
  initial_balance_cents INTEGER NOT NULL DEFAULT 0,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  is_builtin            INTEGER NOT NULL DEFAULT 0,
  deleted               INTEGER NOT NULL DEFAULT 0,
  updated_at            INTEGER NOT NULL
);

-- ── transactions ──────────────────────────────────────────────────────────────
-- is_refund is a CROSS-CUTTING flag, not an income: a refund row keeps type = 0
-- and counts as NEGATIVE expense. Net expense = expense − refund; a refund never
-- counts as income (reference transaction.dart:44-51).
-- tags_json is a JSON array of TAG NAMES. The name IS the identity, so there is
-- no tags table (design.md §3).
CREATE TABLE transactions (
  id           TEXT    PRIMARY KEY,
  type         INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  category_id  TEXT    NOT NULL,
  account_id   TEXT    NOT NULL,
  date         INTEGER NOT NULL,
  note         TEXT    NOT NULL DEFAULT '',
  tags_json    TEXT    NOT NULL DEFAULT '[]',
  is_refund    INTEGER NOT NULL DEFAULT 0,
  deleted      INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL
);

-- The list view orders by date and filters by month range / category / account,
-- so those are the indexes that matter.
CREATE INDEX idx_txn_date     ON transactions(deleted, date DESC);
CREATE INDEX idx_txn_category ON transactions(category_id, deleted, date DESC);
CREATE INDEX idx_txn_account  ON transactions(account_id, deleted, date DESC);
CREATE INDEX idx_txn_type     ON transactions(type, deleted, date DESC);

-- ── envelope budget ───────────────────────────────────────────────────────────
-- Recording a salary is what STARTS a budget cycle (reference app_database.dart:110).
CREATE TABLE salary_records (
  id           TEXT    PRIMARY KEY,
  amount_cents INTEGER NOT NULL,
  date         INTEGER NOT NULL,
  note         TEXT    NOT NULL DEFAULT '',
  deleted      INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX idx_salary_date ON salary_records(deleted, date DESC);

-- One row == one budget cycle; \`id\` IS the cycle id (reference app_database.dart:124).
-- allocations_json is [{"categoryId": "...", "amountCents": N}] — amounts are
-- snapshotted at salary time so later template edits never rewrite history.
CREATE TABLE budget_allocations (
  id               TEXT    PRIMARY KEY,
  salary_record_id TEXT    NOT NULL,
  date             INTEGER NOT NULL,
  allocations_json TEXT    NOT NULL,
  deleted          INTEGER NOT NULL DEFAULT 0,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX idx_budget_date ON budget_allocations(deleted, date DESC);

-- modules_json is [{"categoryId": "...", "ratio": 0.4}] with ratios summing to 1.
CREATE TABLE budget_templates (
  id           TEXT    PRIMARY KEY,
  name         TEXT    NOT NULL,
  is_default   INTEGER NOT NULL DEFAULT 0,
  modules_json TEXT    NOT NULL,
  deleted      INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL
);

-- ── settings ──────────────────────────────────────────────────────────────────
-- Key/value store, e.g. budget.cycle_start_day = {"day": 15}.
CREATE TABLE settings (
  key        TEXT    PRIMARY KEY,
  value_json TEXT    NOT NULL,
  updated_at INTEGER NOT NULL
);
`;
