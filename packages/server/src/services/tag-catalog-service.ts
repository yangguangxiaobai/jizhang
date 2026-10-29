import { randomUUID } from 'node:crypto';
import type { Db } from '../db/index.js';
import { parseTagsJson, normaliseTags, tagNameKey } from './tags.js';
import { ValidationError, ConflictError, NotFoundError } from './transaction-service.js';

export function canonicalName(name: unknown): string {
  if (typeof name !== 'string') throw new ValidationError('A tag name is required.');
  const normalized = normaliseTags([name])[0];
  if (!normalized) throw new ValidationError('A tag name is required.');
  return normalized;
}

export function tagIdForName(name: string): string {
  return `tag-${tagNameKey(name)}`;
}

export interface TagDto { id: string; name: string; parentId: string | null; depth: number; count: number }

export class TagCatalogService {
  constructor(private readonly db: Db, private readonly now: () => number = Date.now) {}

  /** Resolve or create active metadata for a normalized legacy name, preserving an
   *  existing entity's id. A renamed tag keeps its original id, so the id is not
   *  always derivable from the current name; the name lookup must come first. */
  ensureTag(db: Db, raw: string, now = this.now()): string {
    const name = canonicalName(raw);
    const existing = db.prepare('SELECT id FROM tags WHERE name = ?').get(name) as { id: string } | undefined;
    if (existing !== undefined) {
      db.prepare('UPDATE tags SET deleted = 0, updated_at = ? WHERE id = ?').run(now, existing.id);
      return existing.id;
    }
    const id = tagIdForName(name);
    db.prepare('INSERT OR IGNORE INTO tags (id, name, parent_id, deleted, created_at, updated_at) VALUES (?, ?, NULL, 0, ?, ?)')
      .run(id, name, now, now);
    const after = db.prepare('SELECT id FROM tags WHERE name = ?').get(name) as { id: string } | undefined;
    return after?.id ?? id;
  }

  list(): TagDto[] {
    const counts = new Map<string, number>();
    const rows = this.db.prepare('SELECT tags_json FROM transactions WHERE deleted=0').all() as {tags_json:string}[];
    for (const row of rows) for (const name of parseTagsJson(row.tags_json)) counts.set(name,(counts.get(name)??0)+1);
    return (this.db.prepare('SELECT id,name,parent_id FROM tags WHERE deleted=0 ORDER BY name').all() as {id:string;name:string;parent_id:string|null}[])
      .map(r=>({id:r.id,name:r.name,parentId:r.parent_id,depth:r.parent_id===null?0:1,count:counts.get(r.name)??0}));
  }

  getById(id: string): TagDto | undefined { return this.list().find(t=>t.id===id); }
  childrenOf(id: string): TagDto[] { return this.list().filter(t=>t.parentId===id); }

  create(rawName: unknown, parentId?: unknown): TagDto {
    const name=canonicalName(rawName), parent=parentId === undefined ? null : this.requireRoot(parentId);
    this.assertUnique(name);
    const now=this.now(), id=randomUUID();
    try { this.db.prepare('INSERT INTO tags(id,name,parent_id,deleted,created_at,updated_at) VALUES(?,?,?,0,?,?)').run(id,name,parent,now,now); }
    catch { throw new ConflictError('An active tag with this name already exists.'); }
    return this.getById(id)!;
  }

  update(id:string, input:{name?:unknown;parentId?:unknown}):TagDto {
    const old=this.getById(id); if(!old) throw new NotFoundError('Tag not found.');
    const name=input.name===undefined?old.name:canonicalName(input.name);
    const parentId=input.parentId===undefined?old.parentId:(input.parentId===null?null:this.requireRoot(input.parentId));
    if(parentId===id) throw new ValidationError('A tag cannot be its own parent.');
    this.assertUnique(name,id);
    if (old.depth === 0 && parentId !== null && this.childrenOf(id).length > 0) {
      throw new ValidationError('Reassign or delete child tags before moving this root.');
    }
    this.db.prepare('UPDATE tags SET name=?,parent_id=?,updated_at=? WHERE id=?').run(name,parentId,this.now(),id);
    return this.getById(id)!;
  }

  softDelete(id:string):void {
    if(!this.getById(id)) throw new NotFoundError('Tag not found.');
    if(this.childrenOf(id).length) throw new ConflictError('Delete or reassign active child tags first.');
    this.db.prepare('UPDATE tags SET deleted=1,updated_at=? WHERE id=?').run(this.now(),id);
  }

  private requireRoot(value:unknown):string {
    if(typeof value!=='string') throw new ValidationError('parentId must identify an active root tag.');
    const parent=this.getById(value); if(!parent || parent.depth!==0) throw new ValidationError('parentId must identify an active root tag.');
    return value;
  }
  private assertUnique(name:string, except?:string):void {
    const row=this.db.prepare('SELECT id FROM tags WHERE name=? AND deleted=0').get(name) as {id:string}|undefined;
    if(row && row.id!==except) throw new ConflictError('An active tag with this name already exists.');
  }
}
