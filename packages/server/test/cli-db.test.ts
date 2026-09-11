/**
 * Tests for the backup / verify / restore CLI.
 *
 * The load-bearing case is the WAL one: a snapshot must include data that is still in
 * the `-wal` sidecar. Getting that wrong is silent — the snapshot looks fine and is
 * simply missing the newest rows — and during development it produced an
 * investigation into a bug that did not exist.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackup, restoreBackup, verifyBackup } from '../src/cli-db.js';

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), 'jizhang-cli-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/** A realistic database: WAL mode, one table, the given rows. */
function makeDatabase(file: string, rows: readonly string[]): void {
  const db = new Database(file);
  try {
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, body TEXT)');
    const insert = db.prepare('INSERT INTO notes (body) VALUES (?)');
    for (const row of rows) insert.run(row);
  } finally {
    db.close();
  }
}

function readBodies(file: string): string[] {
  const db = new Database(file, { readonly: true });
  try {
    return (db.prepare('SELECT body FROM notes ORDER BY id').all() as { body: string }[]).map(
      (row) => row.body,
    );
  } finally {
    db.close();
  }
}

function backupPath(name: string): string {
  return path.join(workDir, name);
}

function backupsDir(): string {
  return path.join(workDir, 'backups');
}

describe('createBackup', () => {
  it('produces a verified snapshot and reports its table count', () => {
    const dbFile = backupPath('jizhang.db');
    makeDatabase(dbFile, ['a', 'b']);

    const result = createBackup(dbFile, backupsDir(), 0);

    expect(existsSync(result.file)).toBe(true);
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.tables).toBeGreaterThanOrEqual(1);
    expect(result.file.endsWith('.db')).toBe(true);
  });

  it('captures rows written while WAL mode is active', () => {
    const dbFile = backupPath('jizhang.db');

    // WAL mode, rows committed, then closed. A naive `cp` of just the `.db` file is
    // exactly what this guards against.
    makeDatabase(dbFile, ['first-row']);
    const again = new Database(dbFile);
    again.pragma('journal_mode = WAL');
    again.prepare('INSERT INTO notes (body) VALUES (?)').run('second-row');
    again.close();

    const result = createBackup(dbFile, backupsDir(), 0);

    expect(readBodies(result.file)).toEqual(['first-row', 'second-row']);
  });

  it('names archives in a sortable, filesystem-safe form', () => {
    const dbFile = backupPath('jizhang.db');
    makeDatabase(dbFile, ['x']);

    const { file } = createBackup(dbFile, backupsDir(), 0);

    // ISO-8601 with `:` and `.` replaced by `-`: sorts chronologically as a string and
    // is safe on every filesystem.
    expect(path.basename(file)).toMatch(
      /^jizhang-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}\.db$/,
    );
  });

  it('leaves an existing archive untouched when the name would collide', () => {
    const dbFile = backupPath('jizhang.db');
    makeDatabase(dbFile, ['x']);
    const dir = backupsDir();

    // Freeze the clock so both calls choose the same filename.
    const frozen = new Date('2026-09-11T06:00:00.000Z').getTime();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(frozen);
    try {
      const { file } = createBackup(dbFile, dir, 0);
      const original = readFileSync(file);

      expect(() => createBackup(dbFile, dir, 0)).toThrow(/Refusing to overwrite/);
      // The first archive must be byte-identical afterwards.
      expect(readFileSync(file).equals(original)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('creates the target directory when it is missing', () => {
    const dbFile = backupPath('jizhang.db');
    makeDatabase(dbFile, ['x']);

    const result = createBackup(dbFile, path.join(workDir, 'a', 'b', 'c'), 0);
    expect(existsSync(result.file)).toBe(true);
  });

  it('fails loudly when the source is not a database', () => {
    const dbFile = backupPath('jizhang.db');
    writeFileSync(dbFile, '');

    expect(() => createBackup(dbFile, backupsDir(), 0)).toThrow();
  });

  it('prunes archives older than the retention window and keeps newer ones', () => {
    const dbFile = backupPath('jizhang.db');
    makeDatabase(dbFile, ['x']);

    const dir = backupsDir();
    mkdirSync(dir, { recursive: true });
    const oldFile = path.join(dir, 'jizhang-2020-01-01T00-00-00.db');
    makeDatabase(oldFile, ['old']);
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000);
    utimesSync(oldFile, ninetyDaysAgo, ninetyDaysAgo);

    const result = createBackup(dbFile, dir, 30);

    expect(result.pruned).toBe(1);
    expect(existsSync(oldFile)).toBe(false);
    expect(existsSync(result.file)).toBe(true);
  });

  it('retainDays = 0 disables pruning', () => {
    const dbFile = backupPath('jizhang.db');
    makeDatabase(dbFile, ['x']);

    const dir = backupsDir();
    mkdirSync(dir, { recursive: true });
    const oldFile = path.join(dir, 'jizhang-2020-01-01T00-00-00.db');
    makeDatabase(oldFile, ['old']);
    const longAgo = new Date(Date.now() - 365 * 86_400_000);
    utimesSync(oldFile, longAgo, longAgo);

    const result = createBackup(dbFile, dir, 0);
    expect(result.pruned).toBe(0);
    expect(existsSync(oldFile)).toBe(true);
  });
});

describe('verifyBackup', () => {
  it('accepts a real database', () => {
    const dbFile = backupPath('jizhang.db');
    makeDatabase(dbFile, ['a']);

    const result = verifyBackup(dbFile);
    expect(result.ok).toBe(true);
    expect(result.integrity).toBe('ok');
    expect(result.tables).toBeGreaterThanOrEqual(1);
  });

  it('rejects a missing file', () => {
    const result = verifyBackup(backupPath('nope.db'));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/does not exist/);
  });

  it('rejects an empty file', () => {
    const file = backupPath('empty.db');
    writeFileSync(file, '');
    const result = verifyBackup(file);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/empty/);
  });

  it('rejects a file that is not a database at all', () => {
    const file = backupPath('garbage.db');
    writeFileSync(file, 'this is not a sqlite database, it is a sentence');
    expect(verifyBackup(file).ok).toBe(false);
  });

  it('rejects a database with no application tables', () => {
    const file = backupPath('blank.db');
    // A database with a non-empty file but no tables: creating and then dropping one
    // leaves a real (non-empty) SQLite file. Creating an empty database and closing it
    // produces a ZERO-BYTE file, which would be caught by the "empty" check first and
    // leave this branch untested.
    const db = new Database(file);
    db.exec('CREATE TABLE scratch (id INTEGER)');
    db.exec('DROP TABLE scratch');
    db.close();
    expect(readFileSync(file).length).toBeGreaterThan(0);

    const result = verifyBackup(file);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no application tables/);
  });

  it('does not modify the file it verifies', () => {
    const dbFile = backupPath('jizhang.db');
    makeDatabase(dbFile, ['a']);
    const before = readFileSync(dbFile);

    verifyBackup(dbFile);

    expect(readFileSync(dbFile).equals(before)).toBe(true);
  });
});

describe('restoreBackup', () => {
  it('replaces the live database with the snapshot contents', () => {
    const source = backupPath('source.db');
    makeDatabase(source, ['snapshot-row']);

    const live = backupPath('live.db');
    makeDatabase(live, ['live-row-1', 'live-row-2']);

    restoreBackup(source, live);

    expect(readBodies(live)).toEqual(['snapshot-row']);
  });

  it('sets the current database aside before overwriting it', () => {
    const source = backupPath('source.db');
    makeDatabase(source, ['snapshot-row']);
    const live = backupPath('live.db');
    makeDatabase(live, ['important-live-row']);

    restoreBackup(source, live);

    const aside = readdirSync(workDir).filter((name) =>
      name.startsWith('live.db.before-restore-'),
    );
    expect(aside).toHaveLength(1);
    // The pre-restore copy must still hold the data that was just replaced.
    expect(readBodies(path.join(workDir, aside[0] as string))).toEqual(['important-live-row']);
  });

  it('removes stale WAL sidecars, which would otherwise mix two databases', () => {
    const source = backupPath('source.db');
    makeDatabase(source, ['snapshot-row']);

    const live = backupPath('live.db');
    makeDatabase(live, ['live-row']);
    // Leave sidecars behind, as an unclean shutdown would.
    writeFileSync(`${live}-wal`, 'stale wal contents');
    writeFileSync(`${live}-shm`, 'stale shm contents');

    restoreBackup(source, live);

    expect(existsSync(`${live}-wal`)).toBe(false);
    expect(existsSync(`${live}-shm`)).toBe(false);
    expect(readBodies(live)).toEqual(['snapshot-row']);
  });

  it('refuses to restore from a file that is not a usable database', () => {
    const garbage = backupPath('garbage.db');
    writeFileSync(garbage, 'not a database');
    const live = backupPath('live.db');
    makeDatabase(live, ['keep-me']);

    expect(() => restoreBackup(garbage, live)).toThrow(/Refusing to restore/);
    // A refused restore must leave the live database untouched.
    expect(readBodies(live)).toEqual(['keep-me']);
  });

  it('works when there is no existing live database', () => {
    const source = backupPath('source.db');
    makeDatabase(source, ['fresh']);

    const live = backupPath('brand-new.db');
    restoreBackup(source, live);

    expect(readBodies(live)).toEqual(['fresh']);
  });

  it('round-trips a full backup and restore cycle', () => {
    const dbFile = backupPath('jizhang.db');
    makeDatabase(dbFile, ['original-1', 'original-2']);

    const backup = createBackup(dbFile, backupsDir(), 0);

    // Diverge the live database, then restore.
    const live = new Database(dbFile);
    live.prepare('INSERT INTO notes (body) VALUES (?)').run('added-after-backup');
    live.close();
    expect(readBodies(dbFile)).toHaveLength(3);

    restoreBackup(backup.file, dbFile);

    expect(readBodies(dbFile)).toEqual(['original-1', 'original-2']);
    expect(verifyBackup(dbFile).ok).toBe(true);
  });
});
