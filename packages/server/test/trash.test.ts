/**
 * T12 acceptance tests: the recycle bin.
 *
 * The two properties worth protecting here are the ones that can destroy real data:
 *
 *   1. **The trash never shows a live bill** (AC10). Because the read path is its own
 *      endpoint rather than a flag on the list, this is structural — but it is asserted
 *      anyway, because "structural" is a claim about today's code.
 *   2. **A hard delete can only ever follow a soft delete** (AC4). A mistyped id or a
 *      desynchronised UI must hit a 409 or a 404, never a silent wipe of a live row.
 *
 * Restoring is asserted to be a true no-op for a live row, not merely "does not throw":
 * the naive implementation re-runs `UPDATE ... SET deleted = 0, updated_at = now`,
 * which is harmless for `deleted` but re-stamps `updated_at` — and `updated_at` is the
 * tie-breaker in the list ordering, so the row would silently jump position.
 *
 * The clock is injected, so "most recently deleted first" is tested deterministically
 * rather than by hoping two writes land in different milliseconds.
 */
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { closeDatabase, initializeDatabase, type Db } from '../src/db/index.js';
import { SESSION_COOKIE } from '../src/plugins/auth.js';
import { AuthService } from '../src/services/auth-service.js';
import {
  ConflictError,
  NotFoundError,
  TransactionService,
} from '../src/services/transaction-service.js';

const USERNAME = 'quiz';
const PASSWORD = 'correct horse battery staple';
const CSRF = { 'x-requested-with': 'fetch' } as const;

const FOOD = 'builtin-expense-food';
const REFUND = 'builtin-income-refund';
const ACCOUNT = 'builtin-default-account';

/** A fixed "now" so date validation and deletion stamps are deterministic. */
const NOW = Date.UTC(2026, 8, 11, 12, 0, 0);

let db: Db;
let app: FastifyInstance;
let cookie: string;
let service: TransactionService;
let clock = NOW;

async function login(): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: CSRF,
    payload: { username: USERNAME, password: PASSWORD },
  });
  const found = (response.cookies as { name: string; value: string }[]).find(
    (c) => c.name === SESSION_COOKIE,
  );
  return found?.value as string;
}

function as(token: string) {
  return { Cookie: `${SESSION_COOKIE}=${token}` };
}

async function createTxn(overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/transactions',
    headers: { ...CSRF, ...as(cookie) },
    payload: {
      type: 0,
      amountCents: 19_99,
      categoryId: FOOD,
      accountId: ACCOUNT,
      date: Date.UTC(2026, 7, 3),
      note: '午餐',
      ...overrides,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().id as string;
}

/** A soft delete with an explicit deletion time, so ordering is not clock-dependent. */
function deleteAt(id: string, at: number): void {
  clock = at;
  service.softDelete(id);
}

const get = (url: string) =>
  app.inject({ method: 'GET', url, headers: as(cookie) });

const trashDelete = (url: string) =>
  app.inject({ method: 'DELETE', url, headers: { ...CSRF, ...as(cookie) } });

const trashPost = (url: string) =>
  app.inject({ method: 'POST', url, headers: { ...CSRF, ...as(cookie) } });

/** Rows physically present, deleted or not — the only way to prove a hard delete. */
function rawCount(): number {
  const row = db.prepare('SELECT COUNT(*) AS c FROM transactions').get() as { c: number };
  return row.c;
}

beforeEach(async () => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeDatabase(db, null);

  clock = NOW;
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    JIZHANG_USERNAME: USERNAME,
    JIZHANG_PASSWORD_HASH: 'unused',
    DATA_DIR: './data',
  });
  const authService = new AuthService(db, {
    sessionTtlDays: config.sessionTtlDays,
    now: () => clock,
  });
  await authService.setPassword(USERNAME, PASSWORD);

  app = buildApp({
    config,
    db,
    authService,
    secureCookies: false,
    now: () => clock,
  });
  await app.ready();

  service = new TransactionService(db, { now: () => clock });
  cookie = await login();
});

afterEach(async () => {
  await app.close();
  closeDatabase(db);
});

// ---------------------------------------------------------------------------
// The read path
// ---------------------------------------------------------------------------

describe('GET /api/v1/trash', () => {
  it('AC10 returns only deleted bills, never a live one', async () => {
    const trashed = await createTxn({ note: '删掉的' });
    await createTxn({ note: '还在的' });
    service.softDelete(trashed);

    const response = await get('/api/v1/trash');

    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: { note: string }[]; total: number };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.note).toBe('删掉的');
    expect(body.total).toBe(1);
    // The live row must not leak in through this path.
    expect(body.items.some((item) => item.note === '还在的')).toBe(false);
  });

  it('AC8 orders by deletion time, most recently deleted first', async () => {
    // Delete order is the reverse of the bill dates, so an implementation that
    // (wrongly) reused `list()`'s `ORDER BY date DESC` would fail this.
    const older = await createTxn({ note: '先删', date: Date.UTC(2026, 7, 20) });
    const newer = await createTxn({ note: '后删', date: Date.UTC(2026, 7, 1) });

    deleteAt(older, NOW);
    deleteAt(newer, NOW + 60_000);

    const body = (await get('/api/v1/trash')).json() as { items: { note: string }[] };

    expect(body.items.map((item) => item.note)).toEqual(['后删', '先删']);
  });

  it('AC9 an empty bin is an empty list, not an error', async () => {
    const response = await get('/api/v1/trash');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [], total: 0 });
  });

  it('carries the fields the view needs to render a row', async () => {
    const id = await createTxn({ note: '带标签', tags: ['午饭'] });
    deleteAt(id, NOW + 5_000);

    const body = (await get('/api/v1/trash')).json() as {
      items: Record<string, unknown>[];
    };

    // The deletion time the UI labels "删除于" is `updatedAt` — see the service docblock.
    expect(body.items[0]).toMatchObject({
      id,
      type: 0,
      amountCents: 19_99,
      categoryId: FOOD,
      note: '带标签',
      tags: ['午饭'],
      isRefund: false,
      updatedAt: NOW + 5_000,
    });
  });
});

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

describe('restore', () => {
  it('AC2 brings the bill back into the live list', async () => {
    const id = await createTxn();
    service.softDelete(id);
    expect(service.list().total).toBe(0);

    const response = await trashPost(`/api/v1/trash/${id}/restore`);

    expect(response.statusCode).toBe(200);
    expect(service.list().total).toBe(1);
    expect((await get('/api/v1/trash')).json().total).toBe(0);
  });

  it('AC5 is a true no-op for a live bill, not just "does not throw"', async () => {
    const id = await createTxn();

    // Give the row a distinctive updatedAt, then move the clock on. If the idempotent
    // path re-ran the UPDATE, updatedAt would become LATER.
    clock = NOW + 1_000;
    const before = service.getByIdOrThrow(id).updatedAt;

    clock = NOW + 9_999;
    const response = await trashPost(`/api/v1/trash/${id}/restore`);

    expect(response.statusCode).toBe(200);
    expect(service.getByIdOrThrow(id).updatedAt).toBe(before);
    expect(service.list().total).toBe(1);
  });

  it('404s for an id that never existed', async () => {
    const response = await trashPost('/api/v1/trash/no-such-id/restore');

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// Purge — the destructive half
// ---------------------------------------------------------------------------

describe('purge', () => {
  it('AC3 removes the row physically', async () => {
    const id = await createTxn();
    service.softDelete(id);
    expect(rawCount()).toBe(1);

    const response = await trashDelete(`/api/v1/trash/${id}`);

    expect(response.statusCode).toBe(204);
    // Gone from the table, not merely flagged: the count is the only honest proof.
    expect(rawCount()).toBe(0);
    expect((await get('/api/v1/trash')).json().total).toBe(0);
    expect(service.list().total).toBe(0);
    expect(service.list({ includeDeleted: true }).total).toBe(0);
  });

  it('AC4 REFUSES to hard-delete a live bill, and leaves it untouched', async () => {
    const id = await createTxn({ note: '活着的' });

    const response = await trashDelete(`/api/v1/trash/${id}`);

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('CONFLICT');
    // The refusal must be a no-op, which is the whole point of the guard.
    expect(rawCount()).toBe(1);
    expect(service.list().total).toBe(1);
  });

  it('404s for an unknown id, so "missing" is not reported as "conflict"', async () => {
    const response = await trashDelete('/api/v1/trash/no-such-id');

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND');
  });

  it('the service refuses directly too, not only through the route', async () => {
    const id = await createTxn();

    expect(() => service.purge(id)).toThrow(ConflictError);
    expect(() => service.purge('no-such-id')).toThrow(NotFoundError);
  });

  it('purge removes refund links when the trash rows were flagged directly', async () => {
    const originalId = await createTxn({ note: '原单', amountCents: 100_00 });
    const refundId = await createTxn({
      note: '退款',
      type: 1,
      categoryId: REFUND,
      amountCents: 30_00,
      isRefund: true,
      refundLinkedTxIds: [originalId],
    });
    db.prepare('UPDATE transactions SET deleted = 1 WHERE id IN (?, ?)').run(
      originalId,
      refundId,
    );
    expect(
      db
        .prepare('SELECT 1 AS x FROM refund_links WHERE refund_tx_id = ? OR original_tx_id = ?')
        .get(refundId, originalId),
    ).toBeDefined();

    const response = await trashDelete(`/api/v1/trash/${refundId}`);

    expect(response.statusCode).toBe(204);
    const rows = db
      .prepare('SELECT * FROM refund_links WHERE refund_tx_id = ? OR original_tx_id = ?')
      .all(refundId, originalId);
    expect(rows).toHaveLength(0);
    // Only the purged refund is gone; the still-deleted original remains in the table.
    expect(rawCount()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Bulk operations
// ---------------------------------------------------------------------------

describe('bulk operations', () => {
  it('AC6 restore-all empties the bin and returns every bill to the list', async () => {
    deleteAt(await createTxn({ note: 'a' }), NOW);
    deleteAt(await createTxn({ note: 'b' }), NOW + 1_000);
    deleteAt(await createTxn({ note: 'c' }), NOW + 2_000);
    expect(service.list().total).toBe(0);

    const response = await trashPost('/api/v1/trash/restore-all');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ restored: 3, remaining: 0 });
    expect(service.list().total).toBe(3);
  });

  it('AC7 purge-all empties the bin and the rows are gone for good', async () => {
    deleteAt(await createTxn(), NOW);
    deleteAt(await createTxn(), NOW + 1_000);
    expect(rawCount()).toBe(2);

    const response = await trashDelete('/api/v1/trash');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ purged: 2, remaining: 0 });
    expect(rawCount()).toBe(0);
    expect(service.list({ includeDeleted: true }).total).toBe(0);
  });

  it('purge-all leaves live bills alone', async () => {
    const keep = await createTxn({ note: '保留' });
    deleteAt(await createTxn({ note: '清掉' }), NOW + 1_000);

    const response = await trashDelete('/api/v1/trash');

    expect(response.json().purged).toBe(1);
    expect(service.getByIdOrThrow(keep).note).toBe('保留');
    expect(rawCount()).toBe(1);
  });

  it('purge-all also clears refund links between trash rows', async () => {
    const originalId = await createTxn({ amountCents: 100_00 });
    const refundId = await createTxn({
      type: 1,
      categoryId: REFUND,
      amountCents: 30_00,
      isRefund: true,
      refundLinkedTxIds: [originalId],
    });
    db.prepare('UPDATE transactions SET deleted = 1 WHERE id IN (?, ?)').run(
      originalId,
      refundId,
    );

    const response = await trashDelete('/api/v1/trash');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ purged: 2, remaining: 0 });
    const rows = db
      .prepare('SELECT * FROM refund_links WHERE refund_tx_id = ? OR original_tx_id = ?')
      .all(refundId, originalId);
    expect(rows).toHaveLength(0);
    expect(rawCount()).toBe(0);
  });

  it('both are safe on an empty bin', async () => {
    expect((await trashPost('/api/v1/trash/restore-all')).json()).toEqual({
      restored: 0,
      remaining: 0,
    });
    expect((await trashDelete('/api/v1/trash')).json()).toEqual({
      purged: 0,
      remaining: 0,
    });
  });

  it('/trash/restore-all is not read as an id', async () => {
    // Guards the static-vs-parameter route match. If Fastify routed this to
    // `DELETE /trash/:id` or `POST /trash/:id/restore`, the id "restore-all" would
    // surface as a 404 for a nonexistent bill instead of a bulk result.
    deleteAt(await createTxn(), NOW);

    const response = await trashPost('/api/v1/trash/restore-all');

    expect(response.statusCode).toBe(200);
    expect(response.json().restored).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

describe('trash routes require a session', () => {
  it('answers 401 on every trash endpoint when signed out', async () => {
    // Registered inside the auth module's plugin context. Registering them as a
    // sibling of the guard once left protected routes entirely open while the unit
    // tests still passed, so each one is asserted individually.
    //
    // The mutating calls carry the CSRF header even though they are unauthenticated:
    // the CSRF check runs BEFORE the guard, so a bare POST correctly answers 403
    // (`error-handling.md`). Sending the header is what isolates "no session" from
    // "no CSRF token" and makes 401 the right expectation here.
    const calls: { method: 'GET' | 'POST' | 'DELETE'; url: string }[] = [
      { method: 'GET', url: '/api/v1/trash' },
      { method: 'POST', url: '/api/v1/trash/restore-all' },
      { method: 'POST', url: '/api/v1/trash/some-id/restore' },
      { method: 'DELETE', url: '/api/v1/trash/some-id' },
      { method: 'DELETE', url: '/api/v1/trash' },
    ];

    for (const attempt of calls) {
      const response = await app.inject({
        method: attempt.method,
        url: attempt.url,
        headers: attempt.method === 'GET' ? {} : CSRF,
      });
      expect(response.statusCode, `${attempt.method} ${attempt.url}`).toBe(401);
    }
  });

  it('a mutating call without the CSRF header is refused with 403', async () => {
    // The other half of the same rule, asserted so neither guard can be removed
    // while the suite stays green.
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/trash/restore-all',
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('CSRF_REQUIRED');
  });

  it('still requires the CSRF header on the mutating endpoints when signed in', async () => {
    const id = await createTxn();
    service.softDelete(id);

    const withoutHeader = await app.inject({
      method: 'POST',
      url: `/api/v1/trash/${id}/restore`,
      headers: as(cookie),
    });

    expect(withoutHeader.statusCode).toBe(403);
    expect(service.list().total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The soft-delete guarantee this task must not have broken
// ---------------------------------------------------------------------------

describe('soft delete remains the default', () => {
  it('deleting through the normal route still only flags the row', async () => {
    const id = await createTxn();

    const response = await trashDelete(`/api/v1/transactions/${id}`);

    expect(response.statusCode).toBe(204);
    // Still physically present — the ordinary delete is not a purge.
    expect(rawCount()).toBe(1);
    expect((await get('/api/v1/trash')).json().total).toBe(1);
  });

  it('includeDeleted still returns live and deleted rows together', async () => {
    const trashed = await createTxn({ note: '删掉的' });
    await createTxn({ note: '还在的' });
    service.softDelete(trashed);

    const body = (await get('/api/v1/transactions?includeDeleted=true')).json() as {
      total: number;
    };

    expect(body.total).toBe(2);
  });
});
