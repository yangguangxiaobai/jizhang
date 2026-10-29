/** Additive run observability and exact start-request replay; no ledger mutation. */
export const MIGRATION_017_AI_ORGANIZATION_PROGRESS = `
ALTER TABLE ai_analysis_runs ADD COLUMN progress_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE ai_analysis_runs ADD COLUMN client_request_id TEXT;
ALTER TABLE ai_analysis_runs ADD COLUMN request_hash TEXT;
CREATE UNIQUE INDEX ai_analysis_runs_request ON ai_analysis_runs(client_request_id)
  WHERE client_request_id IS NOT NULL;
`;
