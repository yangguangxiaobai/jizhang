/** Migration 007 — one-level category hierarchy for pooled budget modules. */
export const MIGRATION_007_CATEGORY_HIERARCHY = `
ALTER TABLE categories ADD COLUMN parent_id TEXT REFERENCES categories(id);
CREATE INDEX idx_categories_parent ON categories(parent_id, deleted, sort_order);
`;
