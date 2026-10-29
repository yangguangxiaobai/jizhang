import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { runMigrations, MIGRATIONS } from '../src/db/migrate.js';
import { TagCatalogService } from '../src/services/tag-catalog-service.js';
import { tagNameKey } from '../src/services/tags.js';
import { MasterDataService } from '../src/services/master-data-service.js';
import { ConflictError, ValidationError } from '../src/services/transaction-service.js';

function database() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

describe('tag catalog foundation', () => {
  it('013 creates indexes and backfills names from live and deleted transactions without changing JSON', () => {
    const db = database();
    try {
      for (const migration of MIGRATIONS.filter((m) => m.version < 13)) { db.exec(migration.sql); }
      db.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at INTEGER NOT NULL)');
      for (const migration of MIGRATIONS.filter((m) => m.version < 13)) db.prepare('INSERT INTO schema_migrations VALUES(?,?,?)').run(migration.version,migration.name,1);
      const raw='["food","\ud83d\ude00"]';
      const insert=db.prepare("INSERT INTO transactions(id,type,amount_cents,category_id,account_id,date,note,tags_json,is_refund,deleted,updated_at) VALUES(?,0,1,'c','a',1,'',?,0,?,1)");
      insert.run('live',raw,0); insert.run('old','["food"]',1); insert.run('bad','{oops',0);
      runMigrations(db,null);
      expect((db.prepare('SELECT tags_json FROM transactions WHERE id=?').get('live') as {tags_json:string}).tags_json).toBe(raw);
      expect((db.prepare('SELECT name FROM tags ORDER BY name').all() as {name:string}[]).map(r=>r.name)).toEqual(['food','😀']);
      const indexes=(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='tags'").all() as {name:string}[]).map(r=>r.name);
      expect(indexes).toContain('tags_active_name'); expect(indexes).toContain('tags_parent_id');
      runMigrations(db,null);
      expect(db.prepare('SELECT COUNT(*) AS c FROM tags').get()).toMatchObject({c:2});
    } finally { db.close(); }
  });

  it('ensures existing renamed and soft-deleted names by their actual id', () => {
    const db=database();
    try {
      runMigrations(db,null);
      const catalog=new TagCatalogService(db,()=>200);
      const tag=catalog.create('before');
      catalog.update(tag.id,{name:'after'});
      expect(catalog.ensureTag(db,'after',300)).toBe(tag.id);
      db.prepare('UPDATE tags SET deleted=1 WHERE id=?').run(tag.id);
      expect(catalog.ensureTag(db,'after',400)).toBe(tag.id);
      expect(db.prepare('SELECT deleted,updated_at FROM tags WHERE id=?').get(tag.id)).toMatchObject({deleted:0,updated_at:400});
    } finally { db.close(); }
  });

  it('creates a new identity after soft delete and rejects active duplicates', () => {
    const db=database();
    try {
      runMigrations(db,null);
      const catalog=new TagCatalogService(db,()=>100);
      const first=catalog.create('same');
      expect(()=>catalog.create('same')).toThrow(ConflictError);
      catalog.softDelete(first.id);
      const second=catalog.create('same');
      expect(second.id).not.toBe(first.id);
      expect(second.name).toBe('same');
    } finally { db.close(); }
  });

  it('allows child reparenting but rejects self-parent, moving a populated root, and duplicate names', () => {
    const db=database();
    try {
      runMigrations(db,null);
      const catalog=new TagCatalogService(db,()=>100);
      const rootA=catalog.create('A'), rootB=catalog.create('B'), child=catalog.create('C',rootA.id);
      expect(catalog.update(child.id,{parentId:rootB.id}).parentId).toBe(rootB.id);
      expect(()=>catalog.update(rootA.id,{parentId:rootA.id})).toThrow(ValidationError);
      const populated=catalog.create('D'); catalog.create('E',populated.id);
      expect(()=>catalog.update(populated.id,{parentId:rootB.id})).toThrow(ValidationError);
      expect(()=>catalog.update(child.id,{name:'B'})).toThrow(ConflictError);
    } finally { db.close(); }
  });

  it('keeps tag identity lossless for lone UTF-16 surrogates', () => {
    expect(tagNameKey('x\uD800y')).not.toBe(tagNameKey('x\uD801y'));
    expect(tagNameKey('😀')).toBe('d83dde00');
  });

  it('supports two levels, global uniqueness, parent delete conflict, rename/delete legacy sync', () => {
    const db=database();
    try {
      runMigrations(db,null);
      const catalog=new TagCatalogService(db,()=>100);
      const root=catalog.create('food'); const child=catalog.create('fruit',root.id);
      expect(catalog.getById(child.id)?.depth).toBe(1);
      expect(()=>catalog.create('fruit')).toThrow();
      expect(()=>catalog.create('third',child.id)).toThrow();
      expect(()=>catalog.softDelete(root.id)).toThrow();
      catalog.softDelete(child.id); catalog.softDelete(root.id);
      const master=new MasterDataService(db,{now:()=>100});
      expect(master.listTagHierarchy()).toHaveLength(0);
    } finally { db.close(); }
  });
});
