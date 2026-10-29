import { checkRetiredWeb } from './lib/retired-web.mjs';
// End-to-end auth flow against the running container. No curl needed: the base
// image has no curl on purpose (the HEALTHCHECK uses the Node 22 fetch global).
//
// Usage: docker compose cp packages/server/scripts/e2e-auth.mjs jizhang:/app/packages/server/
//        docker compose exec -T -w /app/packages/server jizhang node e2e-auth.mjs
//
// Run it from the package directory: bare ESM imports resolve from the script's own
// location, not from the working directory.

import { makeChecker, resetToKnownState } from './lib/e2e-reset.mjs';

const BASE = 'http://127.0.0.1:8081/api/v1';
const PASSWORD = 'probe-password';
/** For requests that carry a JSON body. */
const JSON_CSRF = { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json' };
/**
 * For requests with NO body (logout). Sending `Content-Type: application/json` with
 * an empty body is a client error: Fastify answers FST_ERR_CTP_EMPTY_JSON_BODY (400)
 * before the route ever runs.
 */
const CSRF_ONLY = { 'X-Requested-With': 'fetch' };

const { check, finish } = makeChecker();

function sessionCookieOf(response) {
  return (response.headers.getSetCookie?.() ?? [])
    .find((c) => c.startsWith('jizhang_session='))
    ?.split(';')[0];
}

// ── 1. argon2 native binding in the runtime image ────────────────────────────
const argon2 = await import('@node-rs/argon2');
const probeHash = await argon2.hash('probe');
check('argon2 native binding loads', probeHash.startsWith('$argon2id$'), probeHash.slice(0, 22));

// ── 2. provision the account through the same service the CLI calls ──────────
const { config, db, authHeaders: _unusedAuth } = await resetToKnownState();
{
  const row = db
    .prepare('SELECT password_hash FROM users WHERE username = ?')
    .get(config.username);
  check(
    `account "${config.username}" provisioned with an argon2id hash`,
    row !== undefined && row.password_hash.startsWith('$argon2id$'),
    row === undefined ? 'no row' : row.password_hash.slice(0, 20),
  );
  db.close();
}

// ── 3. health is public ──────────────────────────────────────────────────────
const health = await fetch(`${BASE}/health`);
check('GET /health without a session', health.status === 200, `-> ${health.status}`);

// ── 4. protected route without a session ─────────────────────────────────────
const anon = await fetch(`${BASE}/auth/me`);
const anonBody = await anon.json();
check(
  'GET /auth/me without a session -> 401 UNAUTHORIZED',
  anon.status === 401 && anonBody?.error?.code === 'UNAUTHORIZED',
  `-> ${anon.status} ${JSON.stringify(anonBody)}`,
);

// ── 5. login without the CSRF header ─────────────────────────────────────────
const noCsrf = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: config.username, password: PASSWORD }),
});
check(
  'POST /auth/login without X-Requested-With -> 403',
  noCsrf.status === 403,
  `-> ${noCsrf.status}`,
);

// ── 6. login with the header and the right password ──────────────────────────
const login = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: JSON_CSRF,
  body: JSON.stringify({ username: config.username, password: PASSWORD }),
});
const setCookie = login.headers.getSetCookie?.() ?? [];
const cookieLine = setCookie.find((c) => c.startsWith('jizhang_session=')) ?? '';
const cookieValue = cookieLine.split(';')[0] ?? '';
check('POST /auth/login with correct credentials -> 200', login.status === 200, `-> ${login.status}`);
check('session cookie is HttpOnly', /HttpOnly/i.test(cookieLine));
check('session cookie is SameSite=Lax', /SameSite=Lax/i.test(cookieLine));
check('session cookie carries the token', cookieValue.length > 'jizhang_session='.length);

// ── 7. /auth/me with the cookie ──────────────────────────────────────────────
const me = await fetch(`${BASE}/auth/me`, { headers: { Cookie: cookieValue } });
const meBody = await me.json();
check(
  'GET /auth/me with the session cookie -> 200',
  me.status === 200,
  `-> ${JSON.stringify(meBody)}`,
);
check('reports the configured username', meBody?.username === config.username);

// ── 8. wrong password vs unknown user: identical responses ───────────────────
const badPassword = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: JSON_CSRF,
  body: JSON.stringify({ username: config.username, password: 'definitely-wrong' }),
});
const badPasswordBody = await badPassword.text();
const unknownUser = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: JSON_CSRF,
  body: JSON.stringify({ username: 'nobody-here', password: PASSWORD }),
});
const unknownUserBody = await unknownUser.text();
check('wrong password -> 401', badPassword.status === 401, `-> ${badPassword.status}`);
check('unknown user -> 401', unknownUser.status === 401, `-> ${unknownUser.status}`);
check(
  'responses are byte-identical (no account-existence leak)',
  badPasswordBody === unknownUserBody,
  badPasswordBody,
);

// ── 9. logout kills the cookie ───────────────────────────────────────────────
const logout = await fetch(`${BASE}/auth/logout`, {
  method: 'POST',
  headers: { ...CSRF_ONLY, Cookie: cookieValue },
});
check('POST /auth/logout -> 200', logout.status === 200, `-> ${logout.status}`);
const afterLogout = await fetch(`${BASE}/auth/me`, { headers: { Cookie: cookieValue } });
check('GET /auth/me after logout -> 401', afterLogout.status === 401, `-> ${afterLogout.status}`);

// Former Web routes stay retired.
await checkRetiredWeb(check, ['/', '/transactions/42']);

// ── 11. unknown API route behaviour ──────────────────────────────────────────
// While signed out the guard runs BEFORE routing, so an unknown /api path answers
// 401 rather than 404. Deliberate: a 401/404 difference would let anyone enumerate
// which routes exist on a public hostname.
const unknownAnon = await fetch(`${BASE}/nope`);
check(
  'unknown /api route while signed out -> 401 (no route enumeration)',
  unknownAnon.status === 401,
  `-> ${unknownAnon.status}`,
);

// Signed in, the same path must answer JSON 404 - never the SPA shell.
const relogin = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: JSON_CSRF,
  body: JSON.stringify({ username: config.username, password: PASSWORD }),
});
const unknownAuthed = await fetch(`${BASE}/nope`, {
  headers: { Cookie: sessionCookieOf(relogin) },
});
const unknownAuthedType = unknownAuthed.headers.get('content-type') ?? '';
check(
  'unknown /api route while signed in -> JSON 404',
  unknownAuthed.status === 404 && unknownAuthedType.includes('application/json'),
  `-> ${unknownAuthed.status} ${unknownAuthedType}`,
);

finish('AUTH E2E');
