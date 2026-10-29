/**
 * Migration 015 — budget template proposal storage on AI analysis runs.
 *
 * Additive only. Template proposals are part of a run's completed snapshot, so
 * they are stored on the run row rather than derived on demand.
 */
export const MIGRATION_015_AI_TEMPLATE_PROPOSALS = `
ALTER TABLE ai_analysis_runs ADD COLUMN template_proposals_json TEXT NOT NULL DEFAULT '[]';
`;
