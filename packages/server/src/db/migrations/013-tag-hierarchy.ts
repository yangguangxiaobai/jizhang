import type { Db } from '../index.js';
import { parseTagsJson, tagNameKey } from '../../services/tags.js';

export const MIGRATION_013_TAG_HIERARCHY = `
CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES tags(id) ON DELETE RESTRICT,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX tags_active_name ON tags(name) WHERE deleted = 0;
CREATE INDEX tags_parent_id ON tags(parent_id) WHERE parent_id IS NOT NULL;
`;

export function backfillTagCatalog(db: Db): void {
  const rows = db.prepare('SELECT tags_json FROM transactions').all() as { tags_json: string }[];
  const names = new Set<string>();
  for (const row of rows) for (const name of parseTagsJson(row.tags_json)) names.add(name);
  const insert = db.prepare('INSERT OR IGNORE INTO tags (id,name,parent_id,deleted,created_at,updated_at) VALUES (?,?,NULL,0,?,?)');
  for (const name of names) {
    const id = `tag-${tagNameKey(name)}`;
    insert.run(id, name, 0, 0);
  }
}
