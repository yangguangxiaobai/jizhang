/**
 * T3 acceptance tests: single account, sessions, password rotation, guard, CSRF.
 *
 * Uses an in-memory database and `app.inject()` so nothing binds a port. Session
 * expiry is driven by an injected clock rather than real sleeps.
 */
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import { closeDatabase, initializeDatabase, type Db } from '../src/db/index.js';
import { SESSION_COOKIE } from '../src/plugins/auth.js';
import { AuthService } from '../src/services/auth-service.js';
import {
  MIN_PASSWORD_LENGTH,
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  isExpired,
  sessionExpiry,
  verifyPassword,
} from '../src/services/password.js';

const USERNAME = 'quiz';
const PASSWORD = 'correct horse battery staple';

/** Every mutating request must carry this; the guard enforces it (T3 PRD R6). */
const CSRF = { 'x-requested-with': 'fetch' } as const;

let db: Db;
let app: FastifyInstance;
let clock: number;
let authService: AuthService;

const baseEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  JIZHANG_USERNAME: USERNAME,
  JIZHANG_PASSWORD_HASH: 'unused-in-tests',
  DATA_DIR: './data',
  SESSION_TTL_DAYS: '30',
};

/** Cookie value from a response, or undefined. */
function cookieFrom(response: { cookies: unknown[] }): string | undefined {
  const found = (response.cookies as { name: string; value: string }[]).find(
    (c) => c.name === SESSION_COOKIE,
  );
  return found?.value;
}

async function buildTestApp(config: AppConfig = loadConfig(baseEnv)): Promise<void> {
  clock = 1_700_000_000_000;
  authService = new AuthService(db, {
    sessionTtlDays: config.sessionTtlDays,
    now: () => clock,
  });
  app = buildApp({ config, db, authService, secureCookies: false });
  await app.ready();
}

beforeEach(async () => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeDatabase(db, null);
  await buildTestApp();
  await authService.setPassword(USERNAME, PASSWORD);
});

afterEach(async () => {
  await app.close();
  closeDatabase(db);
});

describe('password hashing', () => {
  it('stores an argon2id hash, never the plaintext', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain(PASSWORD);
  });

  it('accepts the right password and rejects a wrong one', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(await verifyPassword(hash, PASSWORD)).toBe(true);
    expect(await verifyPassword(hash, 'wrong password here')).toBe(false);
  });

  it('produces a different hash for the same password', async () => {
    expect(await hashPassword(PASSWORD)).not.toBe(await hashPassword(PASSWORD));
  });

  it('rejects a too-short password', async () => {
    await expect(hashPassword('short')).rejects.toThrow(/at least/i);
    expect(MIN_PASSWORD_LENGTH).toBeGreaterThanOrEqual(8);
  });

  it('treats a corrupt stored hash as a wrong password instead of throwing', async () => {
    expect(await verifyPassword('not-a-hash', PASSWORD)).toBe(false);
    expect(await verifyPassword('', PASSWORD)).toBe(false);
  });
});

describe('session tokens', () => {
  it('stores only the SHA-256 of the token', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: CSRF,
      payload: { username: USERNAME, password: PASSWORD },
    });
    const token = cookieFrom(login) as string;
    expect(token).toBeTruthy();

    const rows = db.prepare('SELECT token_hash FROM sessions').all() as {
      token_hash: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token_hash).toBe(hashSessionToken(token));
    // The raw token must not be recoverable from the database.
    expect(rows[0]?.token_hash).not.toBe(token);
  });

  it('generates high-entropy tokens', () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a.token).not.toBe(b.token);
    expect(a.token.length).toBeGreaterThanOrEqual(43);
    expect(a.tokenHash).toHaveLength(64);
  });

  it('expiry arithmetic is driven by the injected clock', () => {
    const expires = sessionExpiry(1000, 30);
    expect(expires).toBe(1000 + 30 * 86_400_000);
    expect(isExpired(expires, expires - 1)).toBe(false);
    expect(isExpired(expires, expires)).toBe(true);
  });
});

describe('AC2/AC3 login', () => {
  it('AC2 accepts the correct password and sets an httpOnly SameSite=Lax cookie', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: CSRF,
      payload: { username: USERNAME, password: PASSWORD },
    });

    expect(response.statusCode).toBe(200);
    const setCookie = response.headers['set-cookie'];
    const raw = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie ?? '');
    expect(raw).toContain('HttpOnly');
    expect(raw).toContain('SameSite=Lax');
    expect(raw).toContain('Path=/');
    expect(cookieFrom(response)).toBeTruthy();
  });

  it('AC3 rejects a wrong password with 401', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: CSRF,
      payload: { username: USERNAME, password: 'definitely wrong' },
    });
    expect(response.statusCode).toBe(401);
    expect(cookieFrom(response)).toBeUndefined();
  });

  it('AC3 a wrong username is indistinguishable from a wrong password', async () => {
    const wrongUser = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: CSRF,
      payload: { username: 'someone-else', password: PASSWORD },
    });
    const wrongPass = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: CSRF,
      payload: { username: USERNAME, password: 'nope nope nope' },
    });

    expect(wrongUser.statusCode).toBe(401);
    expect(wrongPass.statusCode).toBe(401);
    expect(wrongUser.body).toBe(wrongPass.body);
    expect(wrongUser.body).not.toMatch(/unknown|not found|no such/i);
  });

  it('AC3 a malformed body is also just 401', async () => {
    for (const payload of [{}, { username: USERNAME }, { password: PASSWORD }, { username: '', password: '' }]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: CSRF,
        payload,
      });
      expect(response.statusCode, JSON.stringify(payload)).toBe(401);
    }
  });
});

describe('AC4/AC5/AC6 session lifecycle', () => {
  async function login(): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: CSRF,
      payload: { username: USERNAME, password: PASSWORD },
    });
    return cookieFrom(response) as string;
  }

  it('AC4 rejects a protected route without a cookie', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: expect.any(String) as string },
    });
  });

  it('AC4 rejects a bogus cookie', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: { [SESSION_COOKIE]: 'not-a-real-token' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('AC5 returns the username for a valid cookie', async () => {
    const token = await login();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: { [SESSION_COOKIE]: token },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ username: USERNAME });
  });

  it('AC6 a logged-out cookie stops working', async () => {
    const token = await login();

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      cookies: { [SESSION_COOKIE]: token },
      headers: CSRF,
    });
    expect(logout.statusCode).toBe(200);

    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: { [SESSION_COOKIE]: token },
    });
    expect(after.statusCode).toBe(401);
    expect(authService.countSessions()).toBe(0);
  });

  it('AC8 an expired session is rejected and cleaned up', async () => {
    const token = await login();
    expect(authService.countSessions()).toBe(1);

    // Jump past the 30-day TTL.
    clock += 31 * 86_400_000;

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      cookies: { [SESSION_COOKIE]: token },
    });
    expect(response.statusCode).toBe(401);
    expect(authService.countSessions()).toBe(0);

    const status = db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as {
      c: number;
    };
    expect(status.c).toBe(0);
  });

  it('purgeExpiredSessions removes only expired rows', async () => {
    const keep = await login();
    const drop = await login();
    expect(authService.countSessions()).toBe(2);

    // Expire exactly one session by hand.
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(
      clock - 1,
      hashSessionToken(drop),
    );

    expect(authService.purgeExpiredSessions()).toBe(1);
    expect(authService.countSessions()).toBe(1);
    expect(authService.resolveSession(keep)).toBeDefined();
  });
});

describe('AC7 password change', () => {
  async function login(): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: CSRF,
      payload: { username: USERNAME, password: PASSWORD },
    });
    return cookieFrom(response) as string;
  }

  it('AC7 invalidates every session, including the caller’s', async () => {
    const first = await login();
    const second = await login();
    expect(authService.countSessions()).toBe(2);

    const newPassword = 'a brand new passphrase';
    const change = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      cookies: { [SESSION_COOKIE]: first },
      headers: { ...CSRF },
      payload: { currentPassword: PASSWORD, newPassword },
    });
    expect(change.statusCode).toBe(200);

    expect(authService.countSessions()).toBe(0);

    for (const token of [first, second]) {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        cookies: { [SESSION_COOKIE]: token },
      });
      expect(response.statusCode).toBe(401);
    }

    // The new password works; the old one does not.
    const withNew = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: CSRF,
      payload: { username: USERNAME, password: newPassword },
    });
    expect(withNew.statusCode).toBe(200);

    const withOld = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: CSRF,
      payload: { username: USERNAME, password: PASSWORD },
    });
    expect(withOld.statusCode).toBe(401);
  });

  it('rejects a wrong current password without changing anything', async () => {
    const token = await login();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      cookies: { [SESSION_COOKIE]: token },
      headers: { ...CSRF },
      payload: { currentPassword: 'wrong', newPassword: 'another passphrase' },
    });
    expect(response.statusCode).toBe(401);
    // The caller's session survives a failed change.
    expect(authService.countSessions()).toBe(1);
  });

  it('rejects a too-short new password', async () => {
    const token = await login();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      cookies: { [SESSION_COOKIE]: token },
      headers: { ...CSRF },
      payload: { currentPassword: PASSWORD, newPassword: 'short' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'WEAK_PASSWORD' } });
  });

  it('requires authentication to change the password', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      headers: { ...CSRF },
      payload: { currentPassword: PASSWORD, newPassword: 'another passphrase' },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('AC9 CSRF header on mutating requests', () => {
  it('rejects a mutating request without the header', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'CSRF_REQUIRED' } });
  });

  it('rejects a wrong header value', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { 'x-requested-with': 'XMLHttpRequest' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('does not require the header for safe methods', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    // 401 (unauthenticated), not 403 (CSRF).
    expect(response.statusCode).toBe(401);
  });

  it('does not block login, which cannot carry a session yet', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: CSRF,
      payload: { username: USERNAME, password: PASSWORD },
    });
    expect(response.statusCode).toBe(200);
  });
});

describe('AC10 health stays public', () => {
  it('answers without a cookie and without the CSRF header', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });
});

describe('setPassword (CLI behaviour)', () => {
  it('AC1 creates the account and stores no plaintext', async () => {
    const fresh = new Database(':memory:');
    try {
      initializeDatabase(fresh, null);
      const service = new AuthService(fresh, { sessionTtlDays: 30 });
      expect(service.hasUser()).toBe(false);

      await service.setPassword(USERNAME, PASSWORD);

      expect(service.hasUser()).toBe(true);
      const row = fresh
        .prepare('SELECT username, password_hash FROM users')
        .get() as { username: string; password_hash: string };
      expect(row.username).toBe(USERNAME);
      expect(row.password_hash).not.toContain(PASSWORD);
      expect(row.password_hash.startsWith('$argon2id$')).toBe(true);
    } finally {
      closeDatabase(fresh);
    }
  });

  it('rotating the password kicks out existing sessions', async () => {
    const token = generateSessionToken();
    db.prepare(
      'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, (SELECT id FROM users LIMIT 1), ?, ?)',
    ).run(token.tokenHash, clock, clock + 86_400_000);
    expect(authService.countSessions()).toBe(1);

    await authService.setPassword(USERNAME, 'yet another passphrase');
    expect(authService.countSessions()).toBe(0);
  });
});
