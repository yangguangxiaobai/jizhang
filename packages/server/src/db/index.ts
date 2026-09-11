/**
 * SQLite connection (better-sqlite3).
 *
 * T1 opened the connection and proved the native addon works on every container
 * start (AC7, parent risk R1). T2 adds schema management: `initializeDatabase`
 * runs migrations and seeds, and is what the process entry point should call.
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import type { AppConfig } from '../config.js';
import { runMigrations, type MigrateResult } from './migrate.js';
import { seedDatabase, type SeedResult } from './seed.js';

export type Db = Database.Database;

const PRAGMAS = [
  // WAL: readers never block the writer — required for the .backup workflow (design.md §7.4).
  'journal_mode = WAL',
  'foreign_keys = ON',
  'busy_timeout = 5000',
  'synchronous = NORMAL',
] as const;

/**
 * Opens `<DATA_DIR>/jizhang.db`, creating DATA_DIR when missing.
 * Throws with a readable message instead of a bare errno if the directory
 * cannot be created or the file cannot be opened.
 */
export function openDatabase(config: AppConfig): Db {
  try {
    mkdirSync(config.dataDir, { recursive: true });
  } catch (error) {
    throw new Error(
      `Cannot create DATA_DIR "${config.dataDir}": ${(error as Error).message}. ` +
        'Check the directory permissions of the mounted volume.',
    );
  }

  const db = new Database(config.dbFile);
  for (const pragma of PRAGMAS) {
    db.pragma(pragma);
  }

  // Self-check: proves the compiled addon can actually execute SQL, not just load.
  const probe = db.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
  if (probe?.ok !== 1) {
    db.close();
    throw new Error(`SQLite self-check failed for "${config.dbFile}"`);
  }

  return db;
}

export function closeDatabase(db: Db): void {
  if (db.open) {
    db.close();
  }
}

export interface InitializeResult {
  readonly migrations: MigrateResult;
  readonly seed: SeedResult;
}

/**
 * Brings a database up to date: migrations, then seeding. Idempotent, so calling
 * it on every boot is the intended usage.
 *
 * @param dataDir directory used for the pre-migration backup; pass `null` in
 *   tests that do not want a backup written.
 */
export function initializeDatabase(
  db: Db,
  dataDir: string | null,
): InitializeResult {
  const migrations = runMigrations(db, dataDir);
  const seed = seedDatabase(db);
  return { migrations, seed };
}

export { runMigrations, migrationStatus } from './migrate.js';
export { seedDatabase } from './seed.js';
