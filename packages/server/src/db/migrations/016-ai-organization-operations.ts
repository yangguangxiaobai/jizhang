/**
 * Migration 016 — applied AI spending organization operations.
 *
 * Additive only. One row is one apply operation over one completed analysis run,
 * holding the exact before/after states of every affected entity so conditional
 * undo can verify nothing changed underneath before reverting.
 */
export const MIGRATION_016_AI_ORGANIZATION_OPERATIONS = `
CREATE TABLE ai_organization_operations (
  id             TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL REFERENCES ai_analysis_runs(id),
  status         TEXT NOT NULL,
  action_ids_json TEXT NOT NULL,
  fingerprint    TEXT NOT NULL,
  before_json    TEXT NOT NULL,
  after_json     TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX ai_organization_operations_run ON ai_organization_operations(run_id);
`;
