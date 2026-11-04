/**
 * Operation recovery must be scoped to the authenticated account, not to "the first
 * row in `users`".
 *
 * `operationId` is a client-generated UUID, not a secret: it lives in the client's
 * pending-replay record and appears in logs. The route used to resolve the actor with
 * `resolveActorId()`, which picks the first `users` row by id. That only looks safe
 * while exactly one user exists — and renaming the account inserts a *new* row rather
 * than deleting the old one, so an upgraded database can hold two. In that state the
 * lookup used the stale row: the signed-in account could not recover its own lost
 * response (404) while the old row's operations stayed readable.
 *
 * These tests pin the boundary from the HTTP surface, because that is where a client
 * actually recovers a lost response. They force the stale row to sort first so the
 * distinction is real rather than incidental.
 */
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { closeDatabase, initializeDatabase, type Db } from '../src/db/index.js';
import { SESSION_COOKIE } from '../src/plugins/auth.js';
import { AuthService } from '../src/services/auth-service.js';
import { FinancialPlanningService } from '../src/services/financial-planning-service.js';
import { runFinancialOperation } from '../src/services/financial-operation-store.js';

const PASSWORD = 'correct horse battery staple';
const CSRF = { 'x-requested-with': 'fetch' } as const;
const OPERATIONS = '/api/v1/financial-planning/operations';
// Sorts before any generated UUID, so "first row by id" is unambiguous.
const STALE_ID = '00000000-0000-4000-8000-000000000000';
const CURRENT_USERNAME = 'current-owner';

let db: Db;
let app: FastifyInstance;

function authed(cookie: string): Record<string, string> {
  return { ...CSRF, Cookie: `${SESSION_COOKIE}=${cookie}` };
}

async function login(): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: CSRF,
    payload: { username: CURRENT_USERNAME, password: PASSWORD },
  });
  expect(response.statusCode, response.body).toBe(200);
  const cookie = (response.cookies as { name: string; value: string }[]).find(
    (entry) => entry.name === SESSION_COOKIE,
  );
  return cookie?.value as string;
}

/** Commits one operation for a specific actor, exactly as that actor's write would. */
function commitOperation(actorId: string, operationId: string): void {
  runFinancialOperation(
    db,
    {
      operationId,
      actorId,
      method: 'POST',
      resource: '/api/v1/financial-funds/config',
      canonicalPayload: { marker: actorId },
      now: 1_000,
    },
    () => ({ statusCode: 200, response: { owner: actorId } }),
  );
}

beforeEach(async () => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeDatabase(db, null);
  // The current account (what the server is configured to accept) is the one created
  // second, so the stale row is the one "first row" lookups would have returned.
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    JIZHANG_USERNAME: CURRENT_USERNAME,
    JIZHANG_PASSWORD_HASH: 'unused',
    DATA_DIR: './data',
  });
  const authService = new AuthService(db, { sessionTtlDays: config.sessionTtlDays, now: () => 5_000 });
  const staleId = await authService.setPassword('stale-owner', PASSWORD);
  const currentId = await authService.setPassword(CURRENT_USERNAME, PASSWORD);
  // Deterministic ordering: the stale row must sort first.
  db.prepare('UPDATE users SET id = ? WHERE id = ?').run(STALE_ID, staleId);
  expect(db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get()).toEqual({ id: STALE_ID });
  expect(db.prepare('SELECT id FROM users ORDER BY id DESC LIMIT 1').get()).toEqual({ id: currentId });
  app = buildApp({ config, db, authService, secureCookies: false, now: () => 5_000 });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  closeDatabase(db);
});

describe('financial operation recovery ownership', () => {
  it('recovers the signed-in account operation even when another row sorts first', async () => {
    const currentId = (
      db.prepare('SELECT id FROM users WHERE username = ?').get(CURRENT_USERNAME) as { id: string }
    ).id;
    const currentOperation = randomUUID();
    const staleOperation = randomUUID();
    commitOperation(currentId, currentOperation);
    commitOperation(STALE_ID, staleOperation);

    const cookie = await login();
    const own = await app.inject({
      method: 'GET',
      url: `${OPERATIONS}/${currentOperation}`,
      headers: authed(cookie),
    });
    // "First row" resolution answered 404 here; the session actor answers 200.
    expect(own.statusCode, own.body).toBe(200);
    expect(own.json().operation.response).toEqual({ owner: currentId });

    // The stale account's key is somebody else's: 404, identical to an unknown key,
    // so its existence cannot be probed.
    const foreign = await app.inject({
      method: 'GET',
      url: `${OPERATIONS}/${staleOperation}`,
      headers: authed(cookie),
    });
    expect(foreign.statusCode, foreign.body).toBe(404);
    expect(foreign.body).not.toContain(STALE_ID);
  });

  it('answers an unknown key exactly like another account key', async () => {
    const cookie = await login();
    const missing = await app.inject({
      method: 'GET',
      url: `${OPERATIONS}/${randomUUID()}`,
      headers: authed(cookie),
    });
    expect(missing.statusCode).toBe(404);
    const anonymous = await app.inject({ method: 'GET', url: `${OPERATIONS}/${randomUUID()}` });
    expect(anonymous.statusCode).toBe(401);
  });

  it('keeps the service default actor for internal callers without an explicit actor', async () => {
    const service = new FinancialPlanningService(db, {});
    const staleOperation = randomUUID();
    commitOperation(STALE_ID, staleOperation);
    // No actor argument: the documented default (database actor) still applies, and it
    // is the stale row here — which is exactly why the HTTP route must pass the session.
    expect(service.operation(staleOperation)?.operation.operationId).toBe(staleOperation);
  });
});
