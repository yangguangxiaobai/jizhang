/**
 * Migration 014 — AI spending organization analysis runs and note suggestions.
 *
 * Additive only. The run row owns the exact analysed interval, its eligible
 * transaction snapshot (coverage), the normalized suggestions the provider
 * produced, and a deterministic fingerprint of that completed snapshot.
 * Suggested notes live in their own table and are never mixed with the
 * transaction's original note.
 */
export const MIGRATION_014_AI_ANALYSIS_RUNS = `
CREATE TABLE ai_analysis_runs (
  id                TEXT PRIMARY KEY,
  status            TEXT NOT NULL,
  start_date        TEXT NOT NULL,
  end_date          TEXT NOT NULL,
  eligible_count    INTEGER NOT NULL,
  completed_count   INTEGER NOT NULL DEFAULT 0,
  coverage_json     TEXT NOT NULL DEFAULT '[]',
  suggestions_json  TEXT NOT NULL DEFAULT '[]',
  fingerprint       TEXT NOT NULL DEFAULT '',
  error_code        TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX ai_analysis_runs_created ON ai_analysis_runs(created_at DESC);

CREATE TABLE ai_note_suggestions (
  id             TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL REFERENCES ai_analysis_runs(id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL,
  suggested_note TEXT NOT NULL,
  created_at     INTEGER NOT NULL
);
CREATE INDEX ai_note_suggestions_run ON ai_note_suggestions(run_id);
CREATE INDEX ai_note_suggestions_tx ON ai_note_suggestions(transaction_id);
`;
