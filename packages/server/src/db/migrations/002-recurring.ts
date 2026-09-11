/**
 * Migration 002 — recurring bills (T13).
 *
 * Two tables: the rule (a definition) and its occurrences (one generated slot per due
 * date, awaiting the user's decision). Kept as a TypeScript string, not a `.sql` file,
 * for the reason spelled out in `001-init.ts`: `tsc` does not copy non-TS assets into
 * `dist`, so a `.sql` file would be absent from the built image.
 *
 * ## Why occurrences are a table rather than derived on read
 *
 * Two states cannot be represented without storage: "the user ignored this one" and
 * "this one was already turned into a bill". Inferring the latter from the transactions
 * table would misfire whenever the user happened to enter an identical bill by hand.
 *
 * ## Why the uniqueness index is PARTIAL
 *
 * `WHERE deleted = 0` — a soft-deleted occurrence must not keep occupying its
 * `(rule_id, planned_date)` slot, or re-enabling a rule could never regenerate that
 * date. Verified against the bundled SQLite before writing this (3.53.2 supports
 * partial indexes; the duplicate is rejected and the re-insert after a soft delete
 * succeeds).
 */
export const MIGRATION_002_RECURRING = `
-- ── recurring rules: the definition of a repeating bill ───────────────────────
-- next_due_date is the generation cursor: the next due date that has NOT been turned
-- into an occurrence yet. It is advanced only by the generator, and it is always
-- derived from anchor_date rather than from the previous due date — see
-- \`packages/shared/src/recurring.ts\` for why that distinction is load-bearing.
CREATE TABLE recurring_rules (
  id            TEXT    PRIMARY KEY,
  name          TEXT    NOT NULL,
  type          INTEGER NOT NULL,
  amount_cents  INTEGER NOT NULL,
  category_id   TEXT    NOT NULL,
  account_id    TEXT    NOT NULL,
  frequency     TEXT    NOT NULL,
  anchor_date   INTEGER NOT NULL,
  next_due_date INTEGER NOT NULL,
  -- Set when more due dates existed than the per-run cap allowed. The UI must surface
  -- this rather than let the user believe nothing was missed.
  has_older_due INTEGER NOT NULL DEFAULT 0,
  enabled       INTEGER NOT NULL DEFAULT 1,
  deleted       INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX idx_recurring_rules_live
  ON recurring_rules(enabled, next_due_date) WHERE deleted = 0;

-- ── occurrences: one due date of one rule, awaiting a decision ────────────────
-- The money/date/category fields are SNAPSHOTS taken at generation time. Editing the
-- rule afterwards must not silently change a pending item the user has already looked
-- at; the edit applies to future occurrences only.
CREATE TABLE recurring_occurrences (
  id             TEXT    PRIMARY KEY,
  rule_id        TEXT    NOT NULL REFERENCES recurring_rules(id),
  planned_date   INTEGER NOT NULL,
  status         TEXT    NOT NULL,
  -- Set when confirmed: the bill this became. NULL while pending or ignored.
  transaction_id TEXT,
  type           INTEGER NOT NULL,
  amount_cents   INTEGER NOT NULL,
  category_id    TEXT    NOT NULL,
  account_id     TEXT    NOT NULL,
  note           TEXT    NOT NULL DEFAULT '',
  deleted        INTEGER NOT NULL DEFAULT 0,
  updated_at     INTEGER NOT NULL
);

-- The idempotency key for generation: one live occurrence per rule per due date.
-- PARTIAL so a soft-deleted row frees its slot (see the module comment).
CREATE UNIQUE INDEX idx_recurring_occurrence_slot
  ON recurring_occurrences(rule_id, planned_date) WHERE deleted = 0;

-- Serves the "what needs my attention" query, which always filters on status.
CREATE INDEX idx_recurring_occurrence_status
  ON recurring_occurrences(status, planned_date) WHERE deleted = 0;

CREATE INDEX idx_recurring_occurrence_rule
  ON recurring_occurrences(rule_id) WHERE deleted = 0;
`;
