// End-to-end backup / verify / restore drill against the running container (T10 R5).
//
// The point of this suite: "a backup file was produced" is NOT verification. This
// writes data, snapshots it, diverges the live database, restores the snapshot under
// the real deployment procedure (server stopped), restarts, and asserts the data came
// back. That last part is the only evidence that matters.
//
// The restart is driven from outside this process (see the run command in the T10
// notes), because a process cannot stop the container it is running in and then keep
// asserting. This script therefore has two phases, selected by argv[2]:
//
//   node e2e-backup.mjs arrange   # seed data + take a backup (server up)
//   node e2e-backup.mjs assert    # verify the restore brought the data back (server up)
//
// The orchestrating shell does:  arrange -> stop -> restore -> start -> assert

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { makeChecker, resetToKnownState } from './lib/e2e-reset.mjs';

const phase = process.argv[2] ?? 'arrange';
/**
 * Inside the mounted volume, NOT /tmp.
 *
 * /tmp is not on the volume, so a backup written there does not survive the container
 * being recreated — which is precisely when a backup matters. Keeping the drill in
 * `/data` also exercises the real path an operator would use.
 */
const BACKUP_DIR = '/data/backup-drill';
const ARCHIVE_MARKER = `${BACKUP_DIR}/chosen-archive.txt`;
const CLI = '/app/packages/server/dist/cli.js';

const { check, finish } = makeChecker();

function cli(args) {
  return execFileSync('node', [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'development' },
  });
}

function cliFails(args) {
  try {
    execFileSync('node', [CLI, ...args], { encoding: 'utf8', stdio: 'pipe' });
    return { failed: false, output: '' };
  } catch (error) {
    return {
      failed: true,
      output: `${String(error.stdout ?? '')}${String(error.stderr ?? '')}`,
    };
  }
}

const FOOD = 'builtin-expense-food';
const ACCOUNT = 'builtin-default-account';
const now = new Date();
const dayIn = (monthOffset, day) =>
  new Date(now.getFullYear(), now.getMonth() + monthOffset, day).getTime();

/** Sentinel notes so the assertion is about identity, not just a row count. */
const BEFORE_NOTES = ['恢复前-甲', '恢复前-乙'];
const AFTER_NOTE = '恢复后应消失';

async function addTxn(auth, note, amountCents, day) {
  const response = await fetch('http://127.0.0.1:8081/api/v1/transactions', {
    method: 'POST',
    headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({
      accountId: ACCOUNT,
      type: 0,
      amountCents,
      categoryId: FOOD,
      date: dayIn(0, day),
      note,
    }),
  });
  if (response.status !== 201) {
    throw new Error(`create "${note}" failed: ${response.status} ${await response.text()}`);
  }
}

function notesInDatabase() {
  // Read through a separate read-only handle so the assertion does not depend on the
  // API's own (possibly cached) behaviour.
  const output = execFileSync(
    'node',
    [
      '-e',
      `
      const D = require('better-sqlite3');
      const db = new D('/data/jizhang.db', { readonly: true });
      const rows = db.prepare('SELECT note FROM transactions WHERE deleted = 0 ORDER BY note').all();
      process.stdout.write(JSON.stringify(rows.map((r) => r.note)));
      db.close();
      `,
    ],
    { cwd: '/app/packages/server', encoding: 'utf8' },
  );
  return JSON.parse(output);
}

/** Order-independent comparison: SQLite sorts Chinese by code point, not meaning. */
function sameSet(actual, expected) {
  return (
    actual.length === expected.length &&
    [...actual].sort().join('\u0000') === [...expected].sort().join('\u0000')
  );
}

// ── phase 1: seed, back up, diverge ──────────────────────────────────────────
if (phase === 'arrange') {
  const { authHeaders: auth } = await resetToKnownState();
  rmSync(BACKUP_DIR, { recursive: true, force: true });

  console.log('\n[arrange] seed two identifiable rows');
  await addTxn(auth, BEFORE_NOTES[0], 11_111, 3);
  await addTxn(auth, BEFORE_NOTES[1], 22_222, 4);
  check('both rows are present', sameSet(notesInDatabase(), BEFORE_NOTES), JSON.stringify(notesInDatabase()));

  console.log('\n[backup]');
  const output = cli(['backup', BACKUP_DIR, '30']);
  check('backup reports success', /Backup ok/.test(output), output.trim().split('\n')[0]);
  check('backup reports a table count', /\d+ tables/.test(output), output.trim().split('\n').pop());

  const files = readdirSync(BACKUP_DIR).filter((name) => name.endsWith('.db'));
  check('exactly one archive', files.length === 1, files.join(', '));
  const archive = `${BACKUP_DIR}/${files[0]}`;
  check('archive name is sortable and filesystem-safe', /jizhang-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}\.db$/.test(files[0]), files[0]);
  check('archive is non-empty', statSync(archive).size > 0, `${statSync(archive).size}B`);

  // Record which archive to restore, for the assert phase.
  execFileSync('sh', ['-c', `printf '%s' '${archive}' > ${ARCHIVE_MARKER}`]);

  console.log('\n[verify]');
  check('verify accepts the archive', /is a valid database/.test(cli(['verify', archive])));

  const garbage = `${BACKUP_DIR}/garbage.db`;
  execFileSync('sh', ['-c', `printf 'not a database' > ${garbage}`]);
  const garbageResult = cliFails(['verify', garbage]);
  check(
    'verify rejects a non-database file',
    garbageResult.failed && /NOT a usable database/.test(garbageResult.output),
    garbageResult.output.trim().split('\n')[0],
  );
  check('verify rejects a missing file', cliFails(['verify', `${BACKUP_DIR}/nope.db`]).failed);

  console.log('\n[restore precondition: server is up]');
  const blocked = cliFails(['restore', archive]);
  check(
    'restore REFUSES while the server is running',
    blocked.failed && /still answering/.test(blocked.output),
    blocked.output.trim().split('\n')[0],
  );
  check('and the refusal does not touch the database', sameSet(notesInDatabase(), BEFORE_NOTES), JSON.stringify(notesInDatabase()));

  console.log('\n[diverge] add a row that the restore must remove');
  await addTxn(auth, AFTER_NOTE, 33_333, 5);
  const diverged = notesInDatabase();
  check('the new row is present', diverged.includes(AFTER_NOTE), JSON.stringify(diverged));
  check('so there are now three rows', diverged.length === 3, `-> ${diverged.length}`);
}

// ── phase 2: assert the restore worked ───────────────────────────────────────
if (phase === 'assert') {
  console.log('\n[after restore]');
  const notes = notesInDatabase();
  check(
    'the pre-backup rows are back',
    BEFORE_NOTES.every((note) => notes.includes(note)),
    JSON.stringify(notes),
  );
  check(
    'the post-backup row is gone',
    !notes.includes(AFTER_NOTE),
    JSON.stringify(notes),
  );
  check('exactly the two original rows remain', notes.length === 2, `-> ${notes.length}`);

  const safety = readdirSync('/data').filter((name) => name.includes('before-restore'));
  check(
    'the replaced database was set aside',
    safety.length >= 1,
    safety.join(', ') || '(none)',
  );

  console.log('\n[app works after the restore]');
  const health = await fetch('http://127.0.0.1:8081/api/v1/health');
  check('health endpoint responds', health.status === 200, `-> ${health.status}`);

  const login = await fetch('http://127.0.0.1:8081/api/v1/auth/login', {
    method: 'POST',
    headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'probe-password' }),
  });
  check(
    'the restored database still has the account (login works)',
    login.status === 200,
    `-> ${login.status}`,
  );

  const cookie = (login.headers.getSetCookie?.() ?? [])
    .find((c) => c.startsWith('jizhang_session='))
    ?.split(';')[0];
  const list = await fetch('http://127.0.0.1:8081/api/v1/transactions', {
    headers: { Cookie: cookie },
  });
  const body = await list.json();
  check(
    'the API reports the restored rows',
    body.total === 2 && body.items.every((t) => BEFORE_NOTES.includes(t.note)),
    `total=${body.total} notes=${JSON.stringify(body.items.map((t) => t.note))}`,
  );
}

rmSync(`${BACKUP_DIR}/garbage.db`, { force: true });
finish(`BACKUP E2E (${phase})`);
