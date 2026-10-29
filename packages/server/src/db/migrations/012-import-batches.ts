/**
 * Migration 012 — durable merged import batches (multiple files, one review, one confirm).
 *
 * Four additive tables. Nothing here alters an existing table, so rolling the code back
 * leaves the previous release able to read the same database file. Original bill bytes are
 * never stored: only metadata, parsed facts and review metadata.
 *
 * The batch/rows/categories tables are the review workspace; `assistant_import_batch_operations`
 * is the mutation idempotency record (analyse / remove / replace / cancel), separate from the
 * create idempotency key kept on the batch row.
 */
export const MIGRATION_012_IMPORT_BATCHES = `
CREATE TABLE assistant_import_batches (
  id                   TEXT    PRIMARY KEY,
  conversation_id      TEXT    NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  client_request_id    TEXT    NOT NULL,
  request_hash         TEXT    NOT NULL,
  status               TEXT    NOT NULL
                               CHECK (status IN ('draft', 'prepared', 'reviewed', 'confirmed', 'cancelled', 'expired', 'failed')),
  version              INTEGER NOT NULL DEFAULT 1,
  analysis_revision    INTEGER NOT NULL DEFAULT 0,
  -- sha256 of the canonical live-view projection; recomputed whenever the batch moves.
  view_revision        TEXT    NOT NULL,
  base_fingerprint     TEXT    NOT NULL,
  category_set_hash    TEXT    NOT NULL,
  files_json           TEXT    NOT NULL,
  summary_json         TEXT    NOT NULL,
  suggestions_json     TEXT    NOT NULL,
  review_json          TEXT,
  provenance_json      TEXT    NOT NULL DEFAULT 'null',
  result_json          TEXT,
  analyse_state        TEXT    NOT NULL DEFAULT 'idle'
                               CHECK (analyse_state IN ('idle', 'running', 'complete', 'failed')),
  analyse_owner        TEXT,
  analyse_lease_until  INTEGER,
  analyse_message      TEXT,
  provider_calls       INTEGER NOT NULL DEFAULT 0,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);

-- Create idempotency is per conversation, like every other clientRequestId in the assistant.
CREATE UNIQUE INDEX idx_import_batches_request
  ON assistant_import_batches(conversation_id, client_request_id);

CREATE INDEX idx_import_batches_conversation
  ON assistant_import_batches(conversation_id, created_at DESC, id DESC);

CREATE INDEX idx_import_batches_active
  ON assistant_import_batches(conversation_id, status)
  WHERE status NOT IN ('confirmed', 'cancelled', 'expired', 'failed');

CREATE TABLE assistant_import_batch_rows (
  batch_id      TEXT    NOT NULL REFERENCES assistant_import_batches(id) ON DELETE CASCADE,
  item_id       TEXT    NOT NULL,
  ordinal       INTEGER NOT NULL,
  ledger_id     TEXT    NOT NULL,
  identity_kind TEXT    NOT NULL CHECK (identity_kind IN ('platform_order', 'occurrence')),
  canonical_origin TEXT NOT NULL,
  semantic_key  TEXT    NOT NULL DEFAULT '',
  conflict_group TEXT,
  conflict_kind  TEXT   CHECK (conflict_kind IS NULL OR conflict_kind IN ('fact_conflict', 'ledger_collision', 'weak_collision')),
  type          INTEGER NOT NULL,
  amount_cents  INTEGER NOT NULL,
  source_timestamp TEXT,
  date_label    TEXT    NOT NULL,
  note          TEXT    NOT NULL,
  note_alternatives_json TEXT NOT NULL DEFAULT '[]',
  is_refund     INTEGER NOT NULL DEFAULT 0,
  refund_warning TEXT,
  raw_status    TEXT    NOT NULL DEFAULT '',
  source_category TEXT  NOT NULL DEFAULT '',
  ignored       INTEGER NOT NULL DEFAULT 0,
  ignore_reason TEXT,
  existing      INTEGER NOT NULL DEFAULT 0,
  possible_duplicate INTEGER NOT NULL DEFAULT 0,
  duplicate_of_note TEXT,
  comparison_account_id TEXT,
  sources_json  TEXT    NOT NULL,
  weak_dup_group TEXT,
  legacy_ledger_id TEXT,
  legacy_ledger_match INTEGER NOT NULL DEFAULT 0,
  fallback_effective_existing_id TEXT,
  fallback_category_name TEXT,
  fallback_source TEXT,
  fallback_new_other_suggestion_id TEXT,
  ai_status     TEXT    NOT NULL DEFAULT 'none' CHECK (ai_status IN ('none', 'complete')),
  ai_include    INTEGER,
  ai_reason     TEXT,
  ai_category_id TEXT,
  ai_new_suggestion_id TEXT,
  PRIMARY KEY (batch_id, item_id)
);

CREATE INDEX idx_import_batch_rows_order
  ON assistant_import_batch_rows(batch_id, ordinal);

CREATE TABLE assistant_import_batch_categories (
  batch_id            TEXT    NOT NULL REFERENCES assistant_import_batches(id) ON DELETE CASCADE,
  suggestion_id       TEXT    NOT NULL,
  origin              TEXT    NOT NULL CHECK (origin IN ('ai', 'server-fallback')),
  name                TEXT    NOT NULL,
  type                INTEGER NOT NULL,
  parent_id           TEXT,
  related_item_ids_json TEXT  NOT NULL DEFAULT '[]',
  PRIMARY KEY (batch_id, suggestion_id)
);

-- One row per accepted mutation; replay is decided here before any version check.
CREATE TABLE assistant_import_batch_operations (
  batch_id          TEXT    NOT NULL REFERENCES assistant_import_batches(id) ON DELETE CASCADE,
  operation         TEXT    NOT NULL CHECK (operation IN ('analyse', 'remove', 'replace', 'cancel')),
  client_request_id TEXT    NOT NULL,
  request_hash      TEXT    NOT NULL,
  accepted_version  INTEGER NOT NULL,
  accepted_revision INTEGER NOT NULL,
  result_json       TEXT,
  created_at        INTEGER NOT NULL,
  PRIMARY KEY (batch_id, operation, client_request_id)
);
`;
