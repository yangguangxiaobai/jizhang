/** Non-actionable normalized checkpoints for explicit, bounded timeout recovery. */
export const MIGRATION_018_AI_ORGANIZATION_CHECKPOINTS = `
ALTER TABLE ai_analysis_runs ADD COLUMN checkpoint_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE ai_analysis_runs ADD COLUMN source_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_analysis_runs ADD COLUMN batch_size INTEGER NOT NULL DEFAULT 25;
ALTER TABLE ai_analysis_runs ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1;
CREATE TABLE ai_organization_resume_requests (
  client_request_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES ai_analysis_runs(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
`;
