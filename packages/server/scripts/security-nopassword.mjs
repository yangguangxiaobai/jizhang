// Security check: a deployment that has never run `set-password` must NOT be loginable.
//
// `.env.example` ships JIZHANG_PASSWORD_HASH=dev-placeholder-replace-with-argon2id-hash
// so the server can boot before the operator sets a real password. If that placeholder
// were accepted as a valid credential — or if some fallback made any password work —
// the app would be open to anyone who found the hostname.
//
// Run against a freshly initialised container, before `set-password`:
//   docker compose cp packages/server/scripts/security-nopassword.mjs jizhang:/app/packages/server/scripts/
//   docker compose exec -T -w /app/packages/server/scripts jizhang node security-nopassword.mjs

const BASE = 'http://127.0.0.1:8081/api/v1';
const JSON_CSRF = { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json' };

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) failures += 1;
};

// ── the account must not exist yet ───────────────────────────────────────────
const { openDatabase } = await import('/app/packages/server/dist/db/index.js');
const { loadConfig } = await import('/app/packages/server/dist/config.js');

const config = loadConfig();
const db = openDatabase(config);
const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
const user = db.prepare('SELECT username, password_hash FROM users LIMIT 1').get();
db.close();

console.log('\n[state]');
console.log(`  users in database: ${userCount}`);
console.log(`  configured username: ${config.username}`);
console.log(`  placeholder hash in env: ${config.passwordHash.slice(0, 24)}...`);

// ── nothing must be loginable ────────────────────────────────────────────────
console.log('\n[a login must not succeed]');

async function tryLogin(username, password) {
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: JSON_CSRF,
    body: JSON.stringify({ username, password }),
  });
  const cookies = response.headers.getSetCookie?.() ?? [];
  return { status: response.status, gotSession: cookies.some((c) => c.startsWith('jizhang_session=')) };
}

const attempts = [
  ['configured username + placeholder value', config.username, 'dev-placeholder-replace-with-argon2id-hash'],
  ['configured username + empty password', config.username, ''],
  ['configured username + common password', config.username, 'admin'],
  ['configured username + same as username', config.username, config.username],
  ['empty username + placeholder value', '', 'dev-placeholder-replace-with-argon2id-hash'],
  ['admin + admin', 'admin', 'admin'],
];

for (const [label, username, password] of attempts) {
  const result = await tryLogin(username, password);
  check(
    `rejected: ${label}`,
    result.status === 401 && !result.gotSession,
    `-> ${result.status}${result.gotSession ? ' WITH SESSION COOKIE' : ''}`,
  );
}

// ── protected routes must stay closed ────────────────────────────────────────
console.log('\n[protected routes]');
for (const path of ['/transactions', '/budget/overview', '/salaries', '/categories', '/stats/pool-trend']) {
  const response = await fetch(`${BASE}${path}`);
  check(`GET ${path} without a session -> 401`, response.status === 401, `-> ${response.status}`);
}

// ── health stays public, and leaks nothing sensitive ─────────────────────────
console.log('\n[health]');
const health = await fetch(`${BASE}/health`);
const body = await health.json();
check('health is reachable', health.status === 200, `-> ${health.status}`);
check(
  'health exposes only status/version/uptime',
  JSON.stringify(Object.keys(body).sort()) === JSON.stringify(['status', 'uptime', 'version']),
  JSON.stringify(body),
);

console.log(`\n${failures === 0 ? 'ALL NO-PASSWORD SECURITY CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
if (failures > 0) process.exitCode = 1;
