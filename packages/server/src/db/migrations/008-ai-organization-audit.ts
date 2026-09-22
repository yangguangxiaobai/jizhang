/** Migration 008 — append-only audit events for AI organization operations. */
export const MIGRATION_008_AI_ORGANIZATION_AUDIT = `
-- One row is one apply/undo event for one organization action. The table is append-only:
-- undo writes a new event instead of rewriting the original audit history.
CREATE TABLE ai_organization_audit (
  id                    TEXT    PRIMARY KEY,
  operation_id          TEXT    NOT NULL,
  event_type            TEXT    NOT NULL CHECK (event_type IN ('apply', 'undo')),
  action_id             TEXT    NOT NULL,
  kind                  TEXT    NOT NULL CHECK (kind IN ('tag-merge', 'category-merge')),
  source_id             TEXT    NOT NULL,
  target_id             TEXT    NOT NULL,
  affected_row_ids_json TEXT    NOT NULL,
  before_json           TEXT    NOT NULL,
  after_json            TEXT    NOT NULL,
  status                TEXT    NOT NULL CHECK (status IN ('applied', 'undone')),
  created_at            INTEGER NOT NULL
);

CREATE INDEX idx_ai_org_audit_operation
  ON ai_organization_audit(operation_id, created_at, id);
`;
