/**
 * T4 acceptance tests: transaction CRUD, validation, filtering, soft delete,
 * tag normalisation, and the net-expense accounting rule.
 *
 * Runs against a real SQLite database (in memory) through `app.inject()`, so the
 * routes, validation, SQL and the shared accounting rule are exercised together.
 */
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expenseContribution, incomeContribution } from '@jizhang/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { closeDatabase, initializeDatabase, type Db } from '../src/db/index.js';
import { SESSION_COOKIE } from '../src/plugins/auth.js';
import { AuthService } from '../src/services/auth-service.js';
import {
  MAX_TAGS,
  MAX_TAG_LENGTH,
  normaliseTags,
  parseTagsJson,
  serialiseTags,
} from '../src/services/tags.js';
import {
  TransactionService,
  escapeLikePattern,
  type TransactionDto,
} from '../src/services/transaction-service.js';

const USERNAME = 'quiz';
const PASSWORD = 'correct horse battery staple';
const CSRF = { 'x-requested-with': 'fetch' } as const;

const FOOD = 'builtin-expense-food';
const TRANSPORT = 'builtin-expense-transport';
const SALARY = 'builtin-income-salary';
const REFUND = 'builtin-income-refund';
const ACCOUNT = 'builtin-default-account';

/** A fixed "now" so date validation is deterministic. */
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

/** Authenticated request helper. */
function as(token: string) {
  return { Cookie: `${SESSION_COOKIE}=${token}` };
}

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    type: 0,
    amountCents: 19_99,
    categoryId: FOOD,
    accountId: ACCOUNT,
    date: Date.UTC(2026, 7, 3),
    note: '午餐',
    ...overrides,
  };
}

async function post(body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/transactions',
    headers: { ...CSRF, ...as(cookie) },
    payload: body,
  });
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
// Tag normalisation (unit)
// ---------------------------------------------------------------------------

describe('tag normalisation', () => {
  it('AC6 trims, drops empties and de-duplicates while preserving order', () => {
    expect(normaliseTags(['a', 'b', 'a', '', '  c  ', 'b'])).toEqual(['a', 'b', 'c']);
  });

  it('ignores non-string entries', () => {
    expect(normaliseTags(['ok', 42, null, undefined, {}, ['nested']])).toEqual(['ok']);
  });

  it('caps the tag length and the tag count', () => {
    const long = 'x'.repeat(MAX_TAG_LENGTH + 20);
    expect(normaliseTags([long])[0]).toHaveLength(MAX_TAG_LENGTH);

    const many = Array.from({ length: MAX_TAGS + 10 }, (_, i) => `t${i}`);
    expect(normaliseTags(many)).toHaveLength(MAX_TAGS);
  });

  it('treats malformed stored JSON as no tags instead of throwing', () => {
    expect(parseTagsJson('not json')).toEqual([]);
    expect(parseTagsJson('{"a":1}')).toEqual([]);
    expect(parseTagsJson(null)).toEqual([]);
    expect(parseTagsJson('')).toEqual([]);
    expect(parseTagsJson('["ok", 5, "ok"]')).toEqual(['ok']);
  });

  it('round-trips through storage', () => {
    const tags = ['出差', '家庭'];
    expect(parseTagsJson(serialiseTags(tags))).toEqual(tags);
  });
});

// ---------------------------------------------------------------------------
// AC1: create
// ---------------------------------------------------------------------------

describe('AC1 create', () => {
  it('creates a transaction and reads it back unchanged', async () => {
    const created = await post(createBody({ tags: ['午餐', '工作'] }));
    expect(created.statusCode).toBe(201);

    const body = created.json();
    expect(body).toMatchObject({
      type: 0,
      amountCents: 1999,
      categoryId: FOOD,
      accountId: ACCOUNT,
      note: '午餐',
      tags: ['午餐', '工作'],
      isRefund: false,
    });
    expect(typeof body.id).toBe('string');

    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/transactions/${body.id}`,
      headers: as(cookie),
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual(body);
  });

  it('appears in the list', async () => {
    await post(createBody());
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/transactions',
      headers: as(cookie),
    });
    const body = list.json();
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(1);
  });

  it('accepts an income row', async () => {
    const created = await post(createBody({ type: 1, categoryId: SALARY, amountCents: 500_000 }));
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ type: 1, amountCents: 500_000 });
  });
});

// ---------------------------------------------------------------------------
// AC4: money validation
// ---------------------------------------------------------------------------

describe('AC4 amount validation', () => {
  it('rejects a non-integer number of cents', async () => {
    const response = await post(createBody({ amountCents: 1998.99 }));
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'VALIDATION' } });
  });

  it('rejects a string amount', async () => {
    const response = await post(createBody({ amountCents: '1999' }));
    expect(response.statusCode).toBe(400);
  });

  it('rejects zero and negative amounts', async () => {
    for (const amountCents of [0, -100]) {
      const response = await post(createBody({ amountCents }));
      expect(response.statusCode, String(amountCents)).toBe(400);
    }
  });

  it('AC5 stores 19.99 yuan as exactly 1999 cents', async () => {
    // The float trap this guards against:
    expect(19.99 * 100).not.toBe(1999);
    const created = await post(createBody({ amountCents: Math.round(19.99 * 100) }));
    expect(created.statusCode).toBe(201);
    expect(created.json().amountCents).toBe(1999);
    expect(Number.isInteger(created.json().amountCents)).toBe(true);
  });

  it('rejects an absurd date but allows a future one within a day', async () => {
    const ancient = await post(createBody({ date: Date.UTC(1990, 0, 1) }));
    expect(ancient.statusCode).toBe(400);

    const slightlyFuture = await post(createBody({ date: NOW + 3_600_000 }));
    expect(slightlyFuture.statusCode).toBe(201);

    const farFuture = await post(createBody({ date: NOW + 30 * 86_400_000 }));
    expect(farFuture.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// AC6 tags through the API
// ---------------------------------------------------------------------------

describe('AC6 tags through the API', () => {
  it('normalises tags on write', async () => {
    const created = await post(createBody({ tags: ['a', 'b', 'a', '', '  c  '] }));
    expect(created.json().tags).toEqual(['a', 'b', 'c']);
  });

  it('tolerates a non-array tags field', async () => {
    const created = await post(createBody({ tags: 'not-an-array' }));
    expect(created.statusCode).toBe(201);
    expect(created.json().tags).toEqual([]);
  });

  it('AC6 exposes the tag vocabulary with usage counts', async () => {
    await post(createBody({ tags: ['家', '工作'] }));
    await post(createBody({ tags: ['家'] }));

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tags',
      headers: as(cookie),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([
      { name: '家', count: 2 },
      { name: '工作', count: 1 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// AC7 refund accounting
// ---------------------------------------------------------------------------

describe('AC7 refund counts as income (income-typed)', () => {
  it('creates an income-typed refund that counts as income, not expense', async () => {
    const spend = await post(createBody({ amountCents: 150_000 }));
    const refund = await post(
      createBody({ type: 1, categoryId: REFUND, amountCents: 50_000, isRefund: true }),
    );
    expect(refund.json().isRefund).toBe(true);
    expect(refund.json().type).toBe(1);

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/transactions',
      headers: as(cookie),
    });
    const items = list.json().items as TransactionDto[];

    expect(items).toHaveLength(2);
    // Spend is gross: the refund no longer reduces it.
    expect(service.netExpenseCents(items)).toBe(150_000);
    // A refund IS income now.
    expect(service.incomeCents(items)).toBe(50_000);

    expect(
      expenseContribution({
        id: 'x',
        type: 1,
        amountCents: 50_000,
        categoryId: REFUND,
        date: 0,
        isRefund: true,
      }),
    ).toBe(0);
    expect(
      incomeContribution({
        id: 'x',
        type: 1,
        amountCents: 50_000,
        categoryId: REFUND,
        date: 0,
        isRefund: true,
      }),
    ).toBe(50_000);
    void spend;
  });

  it('refuses to mark an expense row as a refund', async () => {
    const response = await post(createBody({ type: 0, categoryId: FOOD, isRefund: true }));
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/income/i);
  });

  it('refuses to flip an existing expense row to refund via PATCH', async () => {
    const expense = await post(createBody({ type: 0, categoryId: FOOD }));
    const id = expense.json().id as string;

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/transactions/${id}`,
      headers: { ...CSRF, ...as(cookie) },
      payload: { isRefund: true },
    });
    expect(response.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// AC2: update
// ---------------------------------------------------------------------------

describe('AC2 update', () => {
  it('changes only the supplied fields', async () => {
    const created = await post(createBody({ note: 'before', tags: ['a'] }));
    const id = created.json().id as string;

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/transactions/${id}`,
      headers: { ...CSRF, ...as(cookie) },
      payload: { amountCents: 2500, note: 'after' },
    });

    expect(updated.statusCode).toBe(200);
    const body = updated.json();
    expect(body.amountCents).toBe(2500);
    expect(body.note).toBe('after');
    // Untouched fields survive a partial update.
    expect(body.categoryId).toBe(FOOD);
    expect(body.tags).toEqual(['a']);
    expect(body.date).toBe(Date.UTC(2026, 7, 3));
  });

  it('re-reads new values from the database', async () => {
    const created = await post(createBody());
    const id = created.json().id as string;

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/transactions/${id}`,
      headers: { ...CSRF, ...as(cookie) },
      payload: { note: 'persisted' },
    });

    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/transactions/${id}`,
      headers: as(cookie),
    });
    expect(read.json().note).toBe('persisted');
  });

  it('404s for an unknown id', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/transactions/does-not-exist',
      headers: { ...CSRF, ...as(cookie) },
      payload: { note: 'x' },
    });
    expect(response.statusCode).toBe(404);
  });

  it('rejects a bad reference on update', async () => {
    const created = await post(createBody());
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/transactions/${created.json().id as string}`,
      headers: { ...CSRF, ...as(cookie) },
      payload: { categoryId: 'nope' },
    });
    expect(response.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Refund links: a refund can bind to one or more original expenses
// ---------------------------------------------------------------------------

describe('refund links', () => {
  it('stores linked original expense ids on a refund and reads them back', async () => {
    const a = await post(createBody({ amountCents: 100_000 }));
    const b = await post(createBody({ amountCents: 50_000, categoryId: TRANSPORT }));
    const aId = a.json().id as string;
    const bId = b.json().id as string;

    const refund = await post(
      createBody({ type: 1, categoryId: REFUND, amountCents: 30_000, isRefund: true, refundLinkedTxIds: [aId, bId] }),
    );
    expect(refund.statusCode).toBe(201);
    expect(refund.json().refundLinkedTxIds).toEqual([aId, bId]);

    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/transactions/${refund.json().id}`,
      headers: as(cookie),
    });
    expect(read.json().refundLinkedTxIds).toEqual([aId, bId]);
  });

  it('returns per-refund details on the linked original expense', async () => {
    const a = await post(createBody({ amountCents: 60_000, note: '买菜' }));
    const aId = a.json().id as string;

    await post(
      createBody({ type: 1, categoryId: REFUND, amountCents: 30_000, isRefund: true, refundLinkedTxIds: [aId], note: 'AA 还款' }),
    );

    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/transactions/${aId}`,
      headers: as(cookie),
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().refundSummary).toMatchObject({ totalRefundCents: 30_000, refundCount: 1 });
    expect(read.json().refundDetails).toHaveLength(1);
    expect(read.json().refundDetails[0]).toMatchObject({ amountCents: 30_000, note: 'AA 还款' });
  });

  it('de-duplicates linked ids', async () => {
    const a = await post(createBody({ amountCents: 100_000 }));
    const aId = a.json().id as string;

    const refund = await post(
      createBody({ type: 1, categoryId: REFUND, amountCents: 50_000, isRefund: true, refundLinkedTxIds: [aId, aId, aId] }),
    );
    expect(refund.statusCode).toBe(201);
    expect(refund.json().refundLinkedTxIds).toEqual([aId]);
  });

  it('rejects a self-reference', async () => {
    const refund = await post(createBody({ type: 1, categoryId: REFUND, amountCents: 50_000, isRefund: true }));
    const id = refund.json().id as string;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/transactions/${id}`,
      headers: { ...CSRF, ...as(cookie) },
      payload: { refundLinkedTxIds: [id] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/itself/i);
  });

  it('rejects linking to an income', async () => {
    const income = await post(createBody({ type: 1, categoryId: SALARY, amountCents: 500_000 }));
    const incomeId = income.json().id as string;

    const refund = await post(
      createBody({ type: 1, categoryId: REFUND, amountCents: 50_000, isRefund: true, refundLinkedTxIds: [incomeId] }),
    );
    expect(refund.statusCode).toBe(400);
    expect(refund.json().error.message).toMatch(/expense/i);
  });

  it('rejects linking to a non-existent transaction', async () => {
    const refund = await post(
      createBody({ type: 1, categoryId: REFUND, amountCents: 50_000, isRefund: true, refundLinkedTxIds: ['no-such-id'] }),
    );
    expect(refund.statusCode).toBe(400);
    expect(refund.json().error.message).toMatch(/not found/i);
  });

  it('rejects linking to another refund', async () => {
    const first = await post(createBody({ type: 1, categoryId: REFUND, amountCents: 50_000, isRefund: true }));
    const firstId = first.json().id as string;

    const second = await post(
      createBody({ type: 1, categoryId: REFUND, amountCents: 10_000, isRefund: true, refundLinkedTxIds: [firstId] }),
    );
    expect(second.statusCode).toBe(400);
    // A refund is income-typed, so the type check fires first ("must be an expense").
    expect(second.json().error.message).toMatch(/expense/i);
  });

  it('updates linked ids on PATCH', async () => {
    const a = await post(createBody({ amountCents: 100_000 }));
    const b = await post(createBody({ amountCents: 50_000, categoryId: TRANSPORT }));
    const aId = a.json().id as string;
    const bId = b.json().id as string;

    const refund = await post(
      createBody({ type: 1, categoryId: REFUND, amountCents: 30_000, isRefund: true, refundLinkedTxIds: [aId] }),
    );
    const id = refund.json().id as string;
    expect(refund.json().refundLinkedTxIds).toEqual([aId]);

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/transactions/${id}`,
      headers: { ...CSRF, ...as(cookie) },
      payload: { refundLinkedTxIds: [bId] },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().refundLinkedTxIds).toEqual([bId]);
  });

  it('clears links when isRefund is turned off via PATCH', async () => {
    const a = await post(createBody({ amountCents: 100_000 }));
    const aId = a.json().id as string;

    const refund = await post(
      createBody({ type: 1, categoryId: REFUND, amountCents: 50_000, isRefund: true, refundLinkedTxIds: [aId] }),
    );
    const id = refund.json().id as string;
    expect(refund.json().refundLinkedTxIds).toEqual([aId]);

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/transactions/${id}`,
      headers: { ...CSRF, ...as(cookie) },
      payload: { isRefund: false },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().isRefund).toBe(false);
    expect(updated.json().refundLinkedTxIds ?? []).toEqual([]);

    const rows = db.prepare('SELECT * FROM refund_links WHERE refund_tx_id = ?').all(id);
    expect(rows).toHaveLength(0);
  });

  it('soft-deleting the original expense removes its refund links', async () => {
    const original = await post(createBody({ amountCents: 100_000 }));
    const originalId = original.json().id as string;
    const refund = await post(
      createBody({ type: 1, categoryId: REFUND, amountCents: 30_000, isRefund: true, refundLinkedTxIds: [originalId] }),
    );
    const refundId = refund.json().id as string;
    expect(
      db
        .prepare('SELECT 1 AS x FROM refund_links WHERE refund_tx_id = ? OR original_tx_id = ?')
        .get(refundId, originalId),
    ).toBeDefined();

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/transactions/${originalId}`,
      headers: { ...CSRF, ...as(cookie) },
    });
    expect(deleted.statusCode).toBe(204);

    const rows = db
      .prepare('SELECT * FROM refund_links WHERE refund_tx_id = ? OR original_tx_id = ?')
      .all(refundId, originalId);
    expect(rows).toHaveLength(0);
  });

  it('soft-deleting the refund removes its links too', async () => {
    const original = await post(createBody({ amountCents: 100_000 }));
    const originalId = original.json().id as string;
    const refund = await post(
      createBody({ type: 1, categoryId: REFUND, amountCents: 30_000, isRefund: true, refundLinkedTxIds: [originalId] }),
    );
    const refundId = refund.json().id as string;

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/transactions/${refundId}`,
      headers: { ...CSRF, ...as(cookie) },
    });
    expect(deleted.statusCode).toBe(204);

    const rows = db
      .prepare('SELECT * FROM refund_links WHERE refund_tx_id = ? OR original_tx_id = ?')
      .all(refundId, originalId);
    expect(rows).toHaveLength(0);
  });

  it('does not return refundLinkedTxIds on a non-refund expense', async () => {
    const created = await post(createBody({ amountCents: 100_000 }));
    const id = created.json().id as string;

    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/transactions/${id}`,
      headers: as(cookie),
    });
    expect(read.json().isRefund).toBe(false);
    expect(read.json().refundLinkedTxIds).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AC3: soft delete
// ---------------------------------------------------------------------------

describe('AC3 soft delete', () => {
  it('hides the row from the default list but keeps it in the table', async () => {
    const created = await post(createBody());
    const id = created.json().id as string;

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/transactions/${id}`,
      headers: { ...CSRF, ...as(cookie) },
    });
    expect(deleted.statusCode).toBe(204);

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/transactions',
      headers: as(cookie),
    });
    expect(list.json().total).toBe(0);

    // Still physically present with deleted = 1.
    const row = db.prepare('SELECT deleted FROM transactions WHERE id = ?').get(id) as {
      deleted: number;
    };
    expect(row.deleted).toBe(1);
  });

  it('is visible with includeDeleted=true', async () => {
    const created = await post(createBody());
    const id = created.json().id as string;
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/transactions/${id}`,
      headers: { ...CSRF, ...as(cookie) },
    });

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/transactions?includeDeleted=true',
      headers: as(cookie),
    });
    const body = list.json();
    expect(body.total).toBe(1);
    expect(body.items[0].id).toBe(id);
  });

  it('404s when fetching a deleted row without includeDeleted', async () => {
    const created = await post(createBody());
    const id = created.json().id as string;
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/transactions/${id}`,
      headers: { ...CSRF, ...as(cookie) },
    });

    const read = await app.inject({
      method: 'GET',
      url: `/api/v1/transactions/${id}`,
      headers: as(cookie),
    });
    expect(read.statusCode).toBe(404);
  });

  it('restore brings it back', async () => {
    const created = await post(createBody());
    const id = created.json().id as string;
    service.softDelete(id);
    expect(service.list().total).toBe(0);

    service.restore(id);
    expect(service.list().total).toBe(1);
  });

  it('excludes deleted rows from the tag vocabulary', async () => {
    const created = await post(createBody({ tags: ['gone'] }));
    await post(createBody({ tags: ['kept'] }));
    service.softDelete(created.json().id as string);

    expect(service.listTags().map((t) => t.name)).toEqual(['kept']);
  });
});

// ---------------------------------------------------------------------------
// AC8/AC9 filtering
// ---------------------------------------------------------------------------

describe('AC8/AC9 filtering', () => {
  beforeEach(async () => {
    await post(
      createBody({ categoryId: FOOD, amountCents: 1000, date: Date.UTC(2026, 7, 1), note: '早餐' }),
    );
    await post(
      createBody({
        categoryId: FOOD,
        amountCents: 2000,
        date: Date.UTC(2026, 7, 15),
        note: '晚餐',
      }),
    );
    await post(
      createBody({
        categoryId: TRANSPORT,
        amountCents: 3000,
        date: Date.UTC(2026, 8, 1),
        note: '地铁',
      }),
    );
    await post(
      createBody({
        type: 1,
        categoryId: SALARY,
        amountCents: 900_000,
        date: Date.UTC(2026, 8, 5),
        note: '工资',
      }),
    );
  });

  async function list(query: string) {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/transactions?${query}`,
      headers: as(cookie),
    });
    expect(response.statusCode).toBe(200);
    return response.json() as { items: { amountCents: number; note: string }[]; total: number };
  }

  it('filters by type', async () => {
    const expenses = await list('type=0');
    expect(expenses.total).toBe(3);
    const income = await list('type=1');
    expect(income.total).toBe(1);
  });

  it('filters by category', async () => {
    const food = await list(`categoryId=${FOOD}`);
    expect(food.total).toBe(2);
  });

  it('AC8 combines a date range with a category', async () => {
    const from = Date.UTC(2026, 7, 1);
    const to = Date.UTC(2026, 8, 1);
    const august = await list(`from=${from}&to=${to}&categoryId=${FOOD}`);
    expect(august.total).toBe(2);

    const firstHalf = await list(`from=${from}&to=${Date.UTC(2026, 7, 10)}&categoryId=${FOOD}`);
    expect(firstHalf.total).toBe(1);
    expect(firstHalf.items[0]?.note).toBe('早餐');
  });

  it('filters by account', async () => {
    expect((await list(`accountId=${ACCOUNT}`)).total).toBe(4);
    expect((await list('accountId=nope')).total).toBe(0);
  });

  it('filters by tag, matching whole names only', async () => {
    await post(createBody({ note: 'tagged', tags: ['food'] }));
    await post(createBody({ note: 'other', tags: ['seafood'] }));

    const food = await list('tag=food');
    expect(food.total).toBe(1);
    expect(food.items[0]?.note).toBe('tagged');
  });

  it('searches the note', async () => {
    const found = await list(`q=${encodeURIComponent('餐')}`);
    expect(found.total).toBe(2);
  });

  it('AC9 escapes LIKE wildcards so % matches literally', async () => {
    await post(createBody({ note: '折扣 50% off' }));
    const before = await list(`q=${encodeURIComponent('%')}`);
    expect(before.total).toBe(1);
    expect(before.items[0]?.note).toBe('折扣 50% off');

    // Without escaping, '%' would match every row.
    const all = await list('');
    expect(all.total).toBeGreaterThan(1);

    await post(createBody({ note: 'under_score' }));
    const underscore = await list(`q=${encodeURIComponent('_')}`);
    expect(underscore.total).toBe(1);
    expect(underscore.items[0]?.note).toBe('under_score');
  });

  it('escapeLikePattern escapes backslash, percent and underscore', () => {
    expect(escapeLikePattern('a%b_c\\d')).toBe('a\\%b\\_c\\\\d');
  });

  it('orders newest first', async () => {
    const result = await list('');
    const notes = result.items.map((i) => i.note);
    expect(notes[0]).toBe('工资');
  });

  it('paginates with limit and offset and reports the total', async () => {
    const page1 = await list('limit=2');
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(4);

    const page2 = await list('limit=2&offset=2');
    expect(page2.items).toHaveLength(2);
    const all = await list('');
    expect([...page1.items, ...page2.items].map((i) => i.note)).toEqual(
      all.items.map((i) => i.note),
    );
  });

  it('rejects an out-of-range limit and a bad type', async () => {
    const badLimit = await app.inject({
      method: 'GET',
      url: '/api/v1/transactions?limit=5000',
      headers: as(cookie),
    });
    expect(badLimit.statusCode).toBe(400);

    const badType = await app.inject({
      method: 'GET',
      url: '/api/v1/transactions?type=7',
      headers: as(cookie),
    });
    expect(badType.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// AC10 references
// ---------------------------------------------------------------------------

describe('AC10 category and account references', () => {
  it('rejects an unknown category', async () => {
    const response = await post(createBody({ categoryId: 'no-such-category' }));
    expect(response.statusCode).toBe(400);
  });

  it('rejects an unknown account', async () => {
    const response = await post(createBody({ accountId: 'no-such-account' }));
    expect(response.statusCode).toBe(400);
  });

  it('rejects a soft-deleted category', async () => {
    db.prepare('UPDATE categories SET deleted = 1 WHERE id = ?').run(FOOD);
    const response = await post(createBody({ categoryId: FOOD }));
    expect(response.statusCode).toBe(400);
  });

  it('rejects a soft-deleted account', async () => {
    db.prepare('UPDATE accounts SET deleted = 1 WHERE id = ?').run(ACCOUNT);
    const response = await post(createBody());
    expect(response.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Guard: these routes must sit behind authentication
// ---------------------------------------------------------------------------

describe('transaction routes are protected', () => {
  it('rejects every verb without a session', async () => {
    const attempts = [
      { method: 'GET' as const, url: '/api/v1/transactions' },
      { method: 'GET' as const, url: '/api/v1/transactions/x' },
      { method: 'GET' as const, url: '/api/v1/tags' },
      { method: 'POST' as const, url: '/api/v1/transactions', headers: CSRF },
      { method: 'PATCH' as const, url: '/api/v1/transactions/x', headers: CSRF },
      { method: 'DELETE' as const, url: '/api/v1/transactions/x', headers: CSRF },
    ];

    for (const attempt of attempts) {
      const response = await app.inject(attempt);
      expect(response.statusCode, `${attempt.method} ${attempt.url}`).toBe(401);
    }
  });

  it('requires the CSRF header on writes even when signed in', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      headers: as(cookie),
      payload: createBody(),
    });
    expect(response.statusCode).toBe(403);
  });
});
