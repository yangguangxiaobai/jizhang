// Read-only backup comparison. Outputs counts/digests, never ledger rows/secrets.
// Run from the repo/image root, where packages/server owns better-sqlite3.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';

if (process.argv.length !== 3) {
  console.error('Usage: node deploy/db-manifest.mjs <database-file>');
  process.exit(1);
}

const require = createRequire(path.resolve('packages/server/package.json'));
const Database = require('better-sqlite3');
const db = new Database(process.argv[2], { readonly: true, fileMustExist: true });
try {
  const integrity = db.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') throw new Error('Database integrity check failed');
  const tables = db
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all();
  const manifest = {};
  for (const { name, sql } of tables) {
    const identifier = '"' + name.replaceAll('"', '""') + '"';
    // All shipped tables have rowid. Refuse unsupported future tables explicitly.
    if (/WITHOUT\s+ROWID/i.test(sql)) throw new Error('Unsupported WITHOUT ROWID table');
    const hash = createHash('sha256');
    let rows = 0;
    for (const row of db.prepare(`SELECT * FROM ${identifier} ORDER BY rowid`).iterate()) {
      hash.update(JSON.stringify(row) + '\n');
      rows += 1;
    }
    manifest[name] = { rows, sha256: hash.digest('hex') };
  }
  console.log(JSON.stringify({ integrity, tables: manifest }, null, 2));
} finally {
  db.close();
}
