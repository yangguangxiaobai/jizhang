import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = fileURLToPath(new URL('./db-manifest.mjs', import.meta.url));
const require = createRequire(path.join(root, 'packages/server/package.json'));
const Database = require('better-sqlite3');
const run = (file) => spawnSync(process.execPath, [script, file], { cwd: root, encoding: 'utf8' });

test('restore comparison detects changed money/photos without exposing rows', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'jizhang-manifest-'));
  try {
    const source = path.join(directory, 'ledger.db');
    const backup = path.join(directory, 'backup.db');
    const db = new Database(source);
    db.exec(
      'CREATE TABLE ledger (id TEXT PRIMARY KEY, amount_cents INTEGER, secret TEXT, image BLOB)',
    );
    db.prepare('INSERT INTO ledger VALUES (?, ?, ?, ?)').run(
      'example',
      1999,
      'private-fixture-secret',
      Buffer.from([1, 2, 3]),
    );
    db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
    const original = run(source);
    const restored = run(backup);
    assert.equal(original.status, 0, original.stderr);
    assert.equal(restored.status, 0, restored.stderr);
    assert.equal(original.stdout, restored.stdout);
    assert.ok(!original.stdout.includes('private-fixture-secret'));
    assert.equal(JSON.parse(original.stdout).tables.ledger.rows, 1);
    db.prepare('UPDATE ledger SET amount_cents = ?').run(2000);
    const changedMoney = run(source);
    assert.equal(changedMoney.status, 0, changedMoney.stderr);
    assert.notEqual(
      JSON.parse(changedMoney.stdout).tables.ledger.sha256,
      JSON.parse(original.stdout).tables.ledger.sha256,
    );
    db.prepare('UPDATE ledger SET image = ?').run(Buffer.from([1, 2, 4]));
    db.close();
    const changedPhoto = run(source);
    assert.equal(changedPhoto.status, 0, changedPhoto.stderr);
    assert.notEqual(
      JSON.parse(changedPhoto.stdout).tables.ledger.sha256,
      JSON.parse(changedMoney.stdout).tables.ledger.sha256,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('missing backup fails without creating an empty database', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'jizhang-manifest-missing-'));
  try {
    const missing = path.join(directory, 'missing.db');
    assert.notEqual(run(missing).status, 0);
    assert.equal(existsSync(missing), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
