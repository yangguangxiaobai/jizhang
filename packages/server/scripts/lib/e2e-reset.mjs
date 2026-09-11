/**
 * Shared baseline for the end-to-end suites.
 *
 * ## Why this exists
 *
 * Each suite used to reset only the tables it cared about. Running them in sequence
 * therefore failed: `e2e-master-data` renames the builtin 餐饮 category (that is one
 * of the things it verifies), and the other suites then could not find it by name.
 * The suites must each start from the SAME known state, so the reset lives here and
 * every suite calls it.
 *
 * ## What "known state" means
 *
 * - no transactions, salaries, allocations or settings;
 * - every builtin category restored: undeleted, original name, icon, type, order;
 * - exactly one account: the builtin default, undeleted and marked builtin;
 * - exactly one template: the seeded default, undeleted and marked default.
 *
 * Only builtin rows are restored, so this is safe to call repeatedly.
 */

const PASSWORD = 'probe-password';
const DEFAULT_ACCOUNT = 'builtin-default-account';
const DEFAULT_TEMPLATE = 'builtin-default-template';

/** Transcribed from `packages/shared/src/seed-data.ts`. */
const BUILTIN_CATEGORIES = [
  ['builtin-expense-food', '餐饮', 0, 'food'],
  ['builtin-expense-transport', '交通', 0, 'transport'],
  ['builtin-expense-housing', '住房', 0, 'housing'],
  ['builtin-expense-shopping', '购物', 0, 'shopping'],
  ['builtin-expense-entertainment', '娱乐', 0, 'entertainment'],
  ['builtin-expense-other', '其他', 0, 'other'],
  ['builtin-income-salary', '工资', 1, 'salary'],
  ['builtin-income-other', '其他收入', 1, 'other'],
];

/**
 * Imports a server module whether this suite runs from the repo
 * (`packages/server/scripts/`) or inside the image (`/app/packages/server/`, where
 * scripts are copied so that `./lib/` sits next to `dist/`).
 *
 * Keeping the resolution here means there is one place to get it right, instead of
 * four suites each hard-coding a path and drifting apart.
 */
export async function loadServerModule(name) {
  const candidates = [
    `../dist/${name}.js`, // repo: packages/server/scripts -> packages/server/dist
    `./dist/${name}.js`, // container: /app/packages/server
    `/app/packages/server/dist/${name}.js`,
  ];
  let lastError;
  for (const candidate of candidates) {
    try {
      return await import(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/** Logs in over HTTP and returns the session cookie plus ready-made header sets. */
export async function login(username, password) {
  const BASE = 'http://127.0.0.1:8081/api/v1';
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const cookie = (response.headers.getSetCookie?.() ?? [])
    .find((c) => c.startsWith('jizhang_session='))
    ?.split(';')[0];

  return {
    cookie,
    authHeaders: { Cookie: cookie },
    jsonHeaders: {
      'X-Requested-With': 'fetch',
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    csrfOnlyHeaders: { 'X-Requested-With': 'fetch', Cookie: cookie },
  };
}

/**
 * Wipes user data and restores the seeded rows.
 *
 * Returns the resolved config, an authenticated cookie, ready-made header sets, and
 * an OPEN database handle for assertions that need to look past the HTTP layer
 * (call `db.close()` when done).
 */
export async function resetToKnownState() {
  const { loadConfig } = await loadServerModule('config');
  const { openDatabase, initializeDatabase } = await loadServerModule('db/index');
  const { AuthService } = await loadServerModule('services/auth-service');

  const config = loadConfig();
  const db = openDatabase(config);
  initializeDatabase(db, config.dataDir);

  await new AuthService(db, { sessionTtlDays: config.sessionTtlDays }).setPassword(
    config.username,
    PASSWORD,
  );

  db.transaction(() => {
    db.prepare('DELETE FROM transactions').run();
    db.prepare('DELETE FROM budget_allocations').run();
    db.prepare('DELETE FROM salary_records').run();
    db.prepare('DELETE FROM settings').run();
    // Recurring state must go too. Occurrences reference rules, so they go first.
    // Without this the recurring suite would inherit another suite's rules, and every
    // other suite would inherit its pending occurrences.
    db.prepare('DELETE FROM recurring_occurrences').run();
    db.prepare('DELETE FROM recurring_rules').run();

    // Categories: restore every builtin row, retire anything else.
    db.prepare("UPDATE categories SET deleted = 1 WHERE id NOT LIKE 'builtin-%'").run();
    const restoreCategory = db.prepare(
      `UPDATE categories
          SET deleted = 0, name = ?, type = ?, icon = ?, sort_order = ?, is_builtin = 1
        WHERE id = ?`,
    );
    for (const [index, entry] of BUILTIN_CATEGORIES.entries()) {
      const [id, name, type, icon] = entry;
      restoreCategory.run(name, type, icon, index, id);
    }

    // Accounts: keep only the builtin default.
    db.prepare('DELETE FROM accounts WHERE id <> ?').run(DEFAULT_ACCOUNT);
    db.prepare(
      `UPDATE accounts
          SET deleted = 0, is_builtin = 1, name = ?, type = 0,
              initial_balance_cents = 0, sort_order = 0
        WHERE id = ?`,
    ).run('默认账户', DEFAULT_ACCOUNT);

    // Templates: retire anything custom, restore the seeded default.
    db.prepare('UPDATE budget_templates SET deleted = 1 WHERE id <> ?').run(DEFAULT_TEMPLATE);
    db.prepare(
      'UPDATE budget_templates SET deleted = 0, is_default = 1 WHERE id = ?',
    ).run(DEFAULT_TEMPLATE);
  })();

  const { cookie, authHeaders, jsonHeaders, csrfOnlyHeaders } = await login(
    config.username,
    PASSWORD,
  );
  return { config, cookie, authHeaders, jsonHeaders, csrfOnlyHeaders, db };
}

/** A tiny assertion helper so every suite reports the same way. */
export function makeChecker() {
  let failures = 0;
  const check = (label, ok, detail = '') => {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
    if (!ok) failures += 1;
  };
  return {
    check,
    finish(suiteName) {
      console.log(
        `\n${failures === 0 ? `ALL ${suiteName} CHECKS PASSED` : `${failures} CHECK(S) FAILED`}`,
      );
      if (failures > 0) process.exitCode = 1;
      return failures;
    },
  };
}
