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
  MAX_SEARCH_ROWS,
  MAX_SEARCH_TEXT_BYTES,
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

  it('filters by child tag id, expands parent assignments and active children without duplicate rows', async () => {
    const hierarchy=await app.inject({method:'POST',url:'/api/v1/tags/hierarchy',headers:{...CSRF,...as(cookie)},payload:{name:'catalog-root'}});
    const rootId=hierarchy.json().id as string;
    const child=await app.inject({method:'POST',url:'/api/v1/tags/hierarchy',headers:{...CSRF,...as(cookie)},payload:{name:'catalog-child',parentId:rootId}});
    const childId=child.json().id as string;
    await post(createBody({note:'parent direct',tags:['catalog-root']}));
    await post(createBody({note:'child member',tags:['catalog-child']}));
    await post(createBody({note:'untagged branch',tags:['elsewhere']}));
    expect((await list(`tagId=${childId}`)).total).toBe(1);
    const parentResult=await list(`tagId=${rootId}`);
    expect(parentResult.total).toBe(2);
    expect(parentResult.items.map(x=>x.note).sort()).toEqual(['child member','parent direct']);
  });

  it('rejects tag and tagId together and returns empty results for unknown or deleted IDs', async () => {
    const root=await app.inject({method:'POST',url:'/api/v1/tags/hierarchy',headers:{...CSRF,...as(cookie)},payload:{name:'only-tag'}});
    const id=root.json().id as string;
    const both=await app.inject({method:'GET',url:`/api/v1/transactions?tag=x&tagId=${id}`,headers:as(cookie)});
    expect(both.statusCode).toBe(400);
    expect((await list('tagId=unknown')).total).toBe(0);
    await app.inject({method:'DELETE',url:`/api/v1/tags/hierarchy/${id}`,headers:{...CSRF,...as(cookie)}});
    expect((await list(`tagId=${id}`)).total).toBe(0);
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
// Bill-page account switching: existing API contracts, with real funding accounts
// ---------------------------------------------------------------------------

describe('bill-page account switching', () => {
  const from = Date.UTC(2026, 7, 1);
  const to = Date.UTC(2026, 8, 1);
  const filters = {
    from: String(from),
    to: String(to),
    type: '0',
    categoryId: FOOD,
    tag: '工作',
    q: '午餐',
  };
  let accountA: string;
  let accountB: string;
  let matchingA: TransactionDto[];
  let matchingB: TransactionDto[];
  let expensesA: TransactionDto[];
  let deletedBill: TransactionDto;

  async function list(query: Record<string, string>) {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/transactions?${new URLSearchParams(query)}`,
      headers: as(cookie),
    });
    expect(response.statusCode).toBe(200);
    return response.json<{ items: TransactionDto[]; total: number; limit: number; offset: number }>();
  }

  async function createBill(accountId: string, overrides: Record<string, unknown> = {}) {
    const response = await post(createBody({ accountId, tags: ['工作'], ...overrides }));
    expect(response.statusCode).toBe(201);
    return response.json<TransactionDto>();
  }

  beforeEach(async () => {
    const accountIds: string[] = [];
    for (const name of ['账户 A', '账户 B']) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/accounts',
        headers: { ...CSRF, ...as(cookie) },
        payload: { name, type: 0 },
      });
      expect(response.statusCode).toBe(201);
      accountIds.push(response.json<{ id: string }>().id);
    }
    accountA = accountIds[0]!;
    accountB = accountIds[1]!;
    matchingA = [];
    matchingB = [];
    // Distinct dates make page membership deterministic, without relying on tie order.
    for (const [accountId, count, rows] of [
      [accountA, 51, matchingA],
      [accountB, 2, matchingB],
    ] as const) {
      for (let i = 0; i < count; i++) {
        rows.push(await createBill(accountId, { date: from + i * 60_000 }));
      }
    }
    expensesA = [...matchingA];
    for (const overrides of [
      { categoryId: TRANSPORT },
      { tags: ['家庭'] },
      { note: '晚餐' },
    ]) {
      expensesA.push(await createBill(accountA, overrides));
    }
    await createBill(accountA, { date: from - 1 });
    await createBill(accountA, { date: to });
    await createBill(accountA, { type: 1, categoryId: SALARY });
    deletedBill = await createBill(accountA);
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/transactions/${deletedBill.id}`,
      headers: { ...CSRF, ...as(cookie) },
    });
    expect(deleted.statusCode).toBe(204);
  });

  it('isolates accounts, counts the same combined filters on both pages, and unions all accounts', async () => {
    const first = await list({ ...filters, accountId: accountA, limit: '50', offset: '0' });
    const second = await list({ ...filters, accountId: accountA, limit: '50', offset: '50' });
    expect(first).toMatchObject({ total: 51, limit: 50, offset: 0 });
    expect(second).toMatchObject({ total: 51, limit: 50, offset: 50 });
    expect(first.items).toHaveLength(50);
    expect(second.items).toHaveLength(1);
    expect([...first.items, ...second.items]).toEqual([...matchingA].reverse());

    const switched = await list({ ...filters, accountId: accountB, limit: '50', offset: '0' });
    expect(switched).toMatchObject({ total: 2, offset: 0 });
    expect(switched.items).toEqual([...matchingB].reverse());

    // All accounts means no accountId parameter, not the historical-account flag.
    const all = await list({ ...filters, limit: '100', offset: '0' });
    expect(all.total).toBe(53);
    expect(all.items.map((row) => row.id).sort()).toEqual(
      [...matchingA, ...matchingB].map((row) => row.id).sort(),
    );
  });

  it('keeps the month and type scope when switching accounts independently of category', async () => {
    const monthAndType = { from: String(from), to: String(to), type: '0', limit: '100' };
    const a = await list({ ...monthAndType, accountId: accountA });
    expect(a.total).toBe(54);
    expect(a.items.map((row) => row.id).sort()).toEqual(expensesA.map((row) => row.id).sort());
    const b = await list({ ...monthAndType, accountId: accountB });
    expect(b.total).toBe(2);
    expect(b.items).toEqual([...matchingB].reverse());
  });

  it('loads historical account names without including deleted bills in the selected account', async () => {
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/accounts/${accountA}`,
      headers: { ...CSRF, ...as(cookie) },
    });
    expect(deleted.statusCode).toBe(204);
    for (const includeDeleted of [false, true]) {
      const metadata = await app.inject({
        method: 'GET',
        url: `/api/v1/accounts?includeDeleted=${includeDeleted}`,
        headers: as(cookie),
      });
      expect(metadata.statusCode).toBe(200);
      const items = metadata.json<{ items: { id: string; name: string }[] }>().items;
      expect(items.some((account) => account.id === accountA)).toBe(includeDeleted);
      if (includeDeleted) expect(items).toContainEqual(expect.objectContaining({ id: accountA, name: '账户 A' }));
    }

    const retained = await list({ ...filters, accountId: accountA, limit: '100' });
    expect(retained.total).toBe(51);
    expect(retained.items).toEqual([...matchingA].reverse());
    const other = await list({ ...filters, accountId: accountB });
    expect(other.total).toBe(2);
    expect(other.items).toEqual([...matchingB].reverse());
    const all = await list({ ...filters, limit: '100' });
    expect(all.total).toBe(53);
    expect(all.items.map((row) => row.id).sort()).toEqual(
      [...matchingA, ...matchingB].map((row) => row.id).sort(),
    );

    // This separate transaction flag really does include deleted bills; metadata does not.
    const withDeletedBills = await list({ ...filters, accountId: accountA, includeDeleted: 'true', limit: '100' });
    expect(withDeletedBills.total).toBe(52);
    expect(withDeletedBills.items).toContainEqual(deletedBill);
  });
});

// ---------------------------------------------------------------------------
// AC10 references
// ---------------------------------------------------------------------------

describe('AC10 category and account references', () => {
  it.each([
    { type: 0, categoryId: SALARY },
    { type: 1, categoryId: FOOD },
  ])('rejects creating a transaction with a mismatched category: %j', async ({ type, categoryId }) => {
    const existing = await post(createBody({ note: 'existing' }));
    expect(existing.statusCode).toBe(201);
    const rowsBefore = db.prepare('SELECT * FROM transactions ORDER BY id').all();
    const tagsBefore = db.prepare('SELECT * FROM tags ORDER BY id').all();

    const response = await post(createBody({ type, categoryId, tags: ['must-not-be-created'] }));
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: {
      code: 'VALIDATION', message: 'The selected category does not match the transaction type.',
    } });
    expect(db.prepare('SELECT * FROM transactions ORDER BY id').all()).toEqual(rowsBefore);
    expect(db.prepare('SELECT * FROM tags ORDER BY id').all()).toEqual(tagsBefore);
  });

  it.each([
    { type: 0, categoryId: FOOD, changes: { categoryId: SALARY } },
    { type: 1, categoryId: SALARY, changes: { categoryId: FOOD } },
    { type: 0, categoryId: FOOD, changes: { type: 1 } },
    { type: 1, categoryId: SALARY, changes: { type: 0 } },
  ])('rejects updating a transaction to a mismatched category: %j', async ({ type, categoryId, changes }) => {
    const created = await post(createBody({ type, categoryId, tags: ['kept'] }));
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    const rowsBefore = db.prepare('SELECT * FROM transactions ORDER BY id').all();
    const tagsBefore = db.prepare('SELECT * FROM tags ORDER BY id').all();

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/transactions/${id}`,
      headers: { ...CSRF, ...as(cookie) },
      payload: { ...changes, note: 'must-not-change', tags: ['must-not-be-created'] },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: {
      code: 'VALIDATION', message: 'The selected category does not match the transaction type.',
    } });
    expect(db.prepare('SELECT * FROM transactions ORDER BY id').all()).toEqual(rowsBefore);
    expect(db.prepare('SELECT * FROM tags ORDER BY id').all()).toEqual(tagsBefore);
  });

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

describe('daily transaction summaries', () => {
  const from = Date.UTC(2026, 7, 1);
  const to = Date.UTC(2026, 8, 1);

  async function summary(overrides: Record<string, string | undefined> = {}) {
    const query = new URLSearchParams({ from: String(from), to: String(to), timeZone: 'UTC' });
    for (const [key, value] of Object.entries(overrides)) {
      if (value !== undefined) query.set(key, value);
    }
    return app.inject({
      method: 'GET',
      url: `/api/v1/transactions/daily-summary?${query}`,
      headers: as(cookie),
    });
  }

  it('totals more than 500 rows without paging, counts refund income and excludes deleted rows', async () => {
    const insert = db.prepare(`INSERT INTO transactions
      (id, type, amount_cents, category_id, account_id, date, note, tags_json, is_refund, deleted, updated_at)
      VALUES (?, 0, 123, ?, ?, ?, '', '[]', 0, 0, ?)`);
    db.transaction(() => {
      for (let i = 0; i < 503; i++) insert.run(`summary-${i}`, FOOD, ACCOUNT, from, NOW);
    })();
    service.create(createBody({ type: 1, categoryId: REFUND, amountCents: 321, isRefund: true, date: from }));
    service.create(createBody({ type: 1, categoryId: SALARY, amountCents: 111, date: from }));
    const deleted = service.create(createBody({ date: from }));
    service.softDelete(deleted.id);
    db.prepare(`INSERT INTO salary_records (id, amount_cents, date, updated_at)
      VALUES ('summary-salary', 900000, ?, ?)`).run(from, NOW);
    db.prepare(`INSERT INTO transfers (id, from_account_id, to_account_id, amount_cents, date, updated_at)
      VALUES ('summary-transfer', ?, 'other-account', 700000, ?, ?)`).run(ACCOUNT, from, NOW);
    const response = await summary({ limit: '99999', offset: '-1', includeDeleted: 'true' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [
      { day: '2026-08-01', expenseCents: 503 * 123, incomeCents: 321 + 111, count: 505 },
    ] });
    expect((await summary({ type: '1' })).json()).toEqual({ items: [
      { day: '2026-08-01', expenseCents: 0, incomeCents: 432, count: 2 },
    ] });
  });

  it('reuses combined filters and keeps historical-account bills but not boundary/deleted rows', async () => {
    service.create(createBody({ date: from, tags: ['food'], note: 'literal 50%_ lunch' }));
    db.prepare(`INSERT INTO accounts (id, name, type, initial_balance_cents, sort_order, is_builtin, deleted, updated_at)
      VALUES ('summary-other-account', 'Other', 0, 0, 1, 0, 0, ?)`).run(NOW);
    for (const overrides of [
      { accountId: 'summary-other-account' },
      { date: from - 1 }, { date: to }, { type: 1, categoryId: SALARY },
      { categoryId: TRANSPORT }, { tags: ['seafood'] }, { note: 'literal 50xx lunch' },
    ]) service.create(createBody({ date: from, tags: ['food'], note: 'literal 50%_ lunch', ...overrides }));
    db.prepare('UPDATE accounts SET deleted = 1 WHERE id = ?').run(ACCOUNT);
    const filters = { type: '0', accountId: ACCOUNT, categoryId: FOOD, tag: 'food', q: '50%_' };
    const result = await summary(filters);
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ items: [
      { day: '2026-08-01', expenseCents: 1999, incomeCents: 0, count: 1 },
    ] });
    for (const overrides of [{ accountId: 'missing' }, { categoryId: 'missing' }, { tag: 'missing' }, { q: 'missing' }, { tagId: 'missing', tag: '' }]) {
      expect((await summary({ ...filters, ...overrides })).json()).toEqual({ items: [] });
    }
    const tag = db.prepare('SELECT id FROM tags WHERE name = ?').get('food') as { id: string };
    expect((await summary({ ...filters, tag: '', tagId: tag.id })).json()).toEqual(result.json());
  });

  it('groups by client local day across month boundaries and DST, newest day first', async () => {
    for (const date of [
      Date.UTC(2026, 2, 1, 4, 59), Date.UTC(2026, 2, 1, 5),
      Date.UTC(2026, 2, 8, 6, 59), Date.UTC(2026, 2, 8, 7, 1),
    ]) service.create(createBody({ date, amountCents: 100 }));
    const response = await summary({
      from: String(Date.UTC(2026, 2, 1)), to: String(Date.UTC(2026, 3, 1)), timeZone: 'America/New_York',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [
      { day: '2026-03-08', expenseCents: 200, incomeCents: 0, count: 2 },
      { day: '2026-03-01', expenseCents: 100, incomeCents: 0, count: 1 },
      { day: '2026-02-28', expenseCents: 100, incomeCents: 0, count: 1 },
    ] });
    const east = await summary({ from: String(Date.UTC(2026, 2, 1)), to: String(Date.UTC(2026, 3, 1)), timeZone: 'Asia/Shanghai' });
    expect(east.json().items.map((item: { day: string }) => item.day)).toEqual(['2026-03-08', '2026-03-01']);
  });

  it.each([
    { from: '' }, { to: '' }, { from: 'NaN' }, { to: 'Infinity' }, { from: '1.5' },
    { to: String(from) }, { to: String(from - 1) }, { to: String(from + 32 * 86_400_000 + 1) },
    { from: '9007199254740991', to: '9007199254740992' },
    { timeZone: '' }, { timeZone: 'Not/AZone' }, { timeZone: '+08:00' },
    { type: '2' }, { tag: 'food', tagId: 'some-id' },
  ])('rejects malformed summary query %j with the validation envelope', async (query) => {
    const response = await summary(query);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: { code: 'VALIDATION', message: expect.any(String) } });
  });

  it('accepts exactly 32 days, returns no fabricated empty days, and validates direct service calls', async () => {
    expect((await summary({ to: String(from + 32 * 86_400_000) })).json()).toEqual({ items: [] });
    expect(() => service.dailySummary({ from, to })).toThrow(/IANA/);
    expect(() => service.dailySummary({ timeZone: 'UTC' })).toThrow(/32/);
  });

  it('rejects unsafe aggregate cents rather than returning an inexact total', async () => {
    service.create(createBody({ date: from, amountCents: Number.MAX_SAFE_INTEGER }));
    service.create(createBody({ date: from, amountCents: 1 }));
    const response = await summary();
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: { code: 'VALIDATION', message: expect.stringContaining('安全整数') } });
  });

  it('requires a session before summary validation', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/transactions/daily-summary' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: { code: 'UNAUTHORIZED', message: expect.any(String) } });
  });
});

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

describe('independent bill search', () => {
  const from = Date.UTC(2026, 7, 1);
  const to = Date.UTC(2026, 8, 1);

  async function get(path: string, params: Record<string, string>) {
    const response = await app.inject({ method: 'GET', url: `${path}?${new URLSearchParams(params)}`, headers: as(cookie) });
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  }

  it('searches real decoded fields, historical names, exact cents and literal special characters', async () => {
    db.prepare('UPDATE categories SET name = ? WHERE id = ?').run('旧分类Cafe', FOOD);
    db.prepare('UPDATE accounts SET name = ? WHERE id = ?').run('旧账户Wallet', ACCOUNT);
    const row = service.create(createBody({ date: from, amountCents: 11250, note: '午餐 50%_\\path', tags: ['标签"quoted\\name'] }));
    service.create(createBody({ date: from, amountCents: 1200, categoryId: TRANSPORT, note: 'other', tags: ['plain'] }));
    db.prepare('UPDATE categories SET deleted = 1 WHERE id = ?').run(FOOD);
    db.prepare('UPDATE accounts SET deleted = 1 WHERE id = ?').run(ACCOUNT);
    for (const term of ['午餐', '分类cafe', '账户wallet', '签"quoted\\', '12.50', '50%_', '\\path']) {
      const result = await get('/api/v1/transactions', { search: term });
      expect(result.searchVersion, term).toBe(1);
      expect(result.items.map((item: TransactionDto) => item.id), term).toContain(row.id);
    }
    for (const term of ['50%X', 'quoted/name', '分类CAFÉ', '112.51']) {
      const result = await get('/api/v1/transactions', { search: term });
      expect(result.total, term).toBe(0);
    }
    expect((await get('/api/v1/transactions', { search: '12' })).total).toBe(2);
    expect((await get('/api/v1/transactions', { q: '分类' })).total).toBe(0);
    expect((await get('/api/v1/transactions', { q: '50%_' })).total).toBe(1);
  });

  it('shares filters across all-history pagination, month summaries and empty results', async () => {
    const earlier = service.create(createBody({ date: from - 86_400_000, amountCents: 1200, note: 'FindMe' }));
    const first = service.create(createBody({ date: from, amountCents: 1200, note: 'FindMe' }));
    const second = service.create(createBody({ date: from + 86_400_000, amountCents: 1250, note: 'findme' }));
    service.create(createBody({ date: from, type: 1, categoryId: SALARY, note: 'FindMe' }));
    const deleted = service.create(createBody({ date: from, note: 'FindMe' }));
    service.softDelete(deleted.id);
    const filter = { search: 'FINDME', type: '0', accountId: ACCOUNT };
    const page1 = await get('/api/v1/transactions', { ...filter, limit: '1', offset: '0' });
    const page2 = await get('/api/v1/transactions', { ...filter, limit: '1', offset: '1' });
    const page3 = await get('/api/v1/transactions', { ...filter, limit: '1', offset: '2' });
    expect([page1.total, page2.total, page3.total]).toEqual([3, 3, 3]);
    expect([page1.items[0].id, page2.items[0].id, page3.items[0].id]).toEqual([second.id, first.id, earlier.id]);
    const scoped = { ...filter, from: String(from), to: String(to) };
    const list = await get('/api/v1/transactions', scoped);
    const summary = await get('/api/v1/transactions/daily-summary', { ...scoped, timeZone: 'UTC' });
    expect(list.total).toBe(2);
    expect(summary).toEqual({ searchVersion: 1, searchRevision: list.searchRevision, items: [
      { day: '2026-08-02', expenseCents: 1250, incomeCents: 0, count: 1 },
      { day: '2026-08-01', expenseCents: 1200, incomeCents: 0, count: 1 },
    ] });
    expect(await get('/api/v1/transactions/daily-summary', { ...scoped, search: 'missing', timeZone: 'UTC' })).toEqual({ items: [], searchVersion: 1, searchRevision: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(await get('/api/v1/transactions', { search: 'missing' })).toMatchObject({ items: [], total: 0, searchVersion: 1 });
    expect(await get('/api/v1/transactions', { search: '  ' })).not.toHaveProperty('searchVersion');
    expect(await get('/api/v1/transactions/daily-summary', { from: String(from), to: String(to), timeZone: 'UTC' })).not.toHaveProperty('searchVersion');
    expect((await get('/api/v1/transactions', { ...filter, accountId: 'missing' })).total).toBe(0);
    expect((await get('/api/v1/transactions', { ...filter, q: 'absent' })).total).toBe(0);
  });

  it('accepts exactly 10000 matches and rejects 10001 before returning any page or summary', async () => {
    const insert = db.prepare(`INSERT INTO transactions
      (id, type, amount_cents, category_id, account_id, date, note, tags_json, is_refund, deleted, updated_at)
      VALUES (?, 0, 1, ?, ?, ?, 'limit-match', '[]', 0, 0, ?)`);
    db.transaction(() => {
      for (let i = 0; i < MAX_SEARCH_ROWS; i++) insert.run(`limit-${i}`, FOOD, ACCOUNT, from, NOW);
    })();
    const params = { search: 'limit-match', from: String(from), to: String(to) };
    const list = await get('/api/v1/transactions', { ...params, limit: '1' });
    const summary = await get('/api/v1/transactions/daily-summary', { ...params, timeZone: 'UTC' });
    expect(list.total).toBe(MAX_SEARCH_ROWS);
    expect(list.items).toHaveLength(1);
    expect(summary.searchRevision).toBe(list.searchRevision);
    expect(summary.items[0]).toMatchObject({ count: MAX_SEARCH_ROWS, expenseCents: MAX_SEARCH_ROWS });
    insert.run('limit-extra', FOOD, ACCOUNT, from, NOW);
    for (const [path, extra] of [
      ['/api/v1/transactions', { limit: '1' }],
      ['/api/v1/transactions/daily-summary', { timeZone: 'UTC' }],
    ] as const) {
      const response = await app.inject({ method: 'GET', url: `${path}?${new URLSearchParams({ ...params, ...extra })}`, headers: as(cookie) });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: { code: 'VALIDATION', message: expect.stringMatching(/缩小.*月份.*账户.*关键词/) } });
    }
    expect((await get('/api/v1/transactions', { limit: '1' })).total).toBe(MAX_SEARCH_ROWS + 1);
  }, 30000);

  it('enforces the exact UTF-8 text budget before snapshot hashing for list and summary', async () => {
    const id = 'text-limit';
    const fixedBytes = Buffer.byteLength(id + FOOD + ACCOUNT + '[]', 'utf8');
    const targetNoteBytes = MAX_SEARCH_TEXT_BYTES - fixedBytes;
    const prefix = 'text-match\u0000';
    const remaining = targetNoteBytes - Buffer.byteLength(prefix, 'utf8');
    const note = prefix + '界'.repeat(Math.floor(remaining / 3)) + 'x'.repeat(remaining % 3);
    db.prepare(`INSERT INTO transactions
      (id, type, amount_cents, category_id, account_id, date, note, tags_json, is_refund, deleted, updated_at)
      VALUES (?, 0, 1, ?, ?, ?, ?, '[]', 0, 0, ?)`).run(id, FOOD, ACCOUNT, from, note, NOW);
    const params = { search: 'text-match', from: String(from), to: String(to) };
    const list = await get('/api/v1/transactions', { ...params, limit: '1', offset: '1' });
    const summary = await get('/api/v1/transactions/daily-summary', { ...params, timeZone: 'UTC' });
    expect(list.total).toBe(1);
    expect(list.items).toEqual([]);
    expect(summary.searchRevision).toBe(list.searchRevision);
    db.prepare('UPDATE transactions SET note = ? WHERE id = ?').run(note + 'x', id);
    for (const [path, extra] of [
      ['/api/v1/transactions', { limit: '1', offset: '1' }],
      ['/api/v1/transactions/daily-summary', { timeZone: 'UTC' }],
    ] as const) {
      const response = await app.inject({ method: 'GET', url: `${path}?${new URLSearchParams({ ...params, ...extra })}`, headers: as(cookie) });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: { code: 'VALIDATION', message: expect.stringMatching(/缩小.*月份.*账户.*关键词/) } });
    }
    expect((await get('/api/v1/transactions', { limit: '1', offset: '1' })).total).toBe(1);
  }, 30000);

  it('detects same-count replacements, edits and refund DTO changes across stable search pages and summaries', async () => {
    service.create(createBody({ date: from, note: 'scope', amountCents: 100 }), 'snapshot-b');
    service.create(createBody({ date: from, note: 'scope', amountCents: 200 }), 'snapshot-a');
    const scope = { search: 'scope', from: String(from), to: String(to) };
    const page1 = await get('/api/v1/transactions', { ...scope, limit: '1', offset: '0' });
    const page2 = await get('/api/v1/transactions', { ...scope, limit: '1', offset: '1' });
    expect(page1.items[0].id).toBe('snapshot-a');
    expect(page2.items[0].id).toBe('snapshot-b');
    expect(page1.searchRevision).toMatch(/^[0-9a-f]{64}$/);
    expect(page2.searchRevision).toBe(page1.searchRevision);
    expect((await get('/api/v1/transactions/daily-summary', { ...scope, timeZone: 'UTC' })).searchRevision).toBe(page1.searchRevision);

    service.softDelete('snapshot-b');
    service.create(createBody({ date: from, note: 'scope', amountCents: 100 }), 'snapshot-c');
    const replaced = await get('/api/v1/transactions', scope);
    expect(replaced.total).toBe(page1.total);
    expect(replaced.searchRevision).not.toBe(page1.searchRevision);
    service.update('snapshot-c', { amountCents: 101 });
    const edited = await get('/api/v1/transactions', scope);
    expect(edited.total).toBe(replaced.total);
    expect(edited.searchRevision).not.toBe(replaced.searchRevision);
    service.create(createBody({ date: from, note: 'refund', type: 1, categoryId: REFUND, isRefund: true, amountCents: 50, refundLinkedTxIds: ['snapshot-c'] }));
    const refunded = await get('/api/v1/transactions', scope);
    expect(refunded.total).toBe(edited.total);
    expect(refunded.searchRevision).not.toBe(edited.searchRevision);
    expect((await get('/api/v1/transactions/daily-summary', { ...scope, timeZone: 'UTC' })).searchRevision).toBe(refunded.searchRevision);
  });

  it('changes the search revision when renamed historical references change the matched set', async () => {
    service.create(createBody({ date: from, note: 'unrelated' }));
    db.prepare('UPDATE accounts SET name = ? WHERE id = ?').run('old-label', ACCOUNT);
    const query = { search: 'label' };
    const before = await get('/api/v1/transactions', query);
    expect(before.total).toBe(1);
    db.prepare('UPDATE accounts SET name = ? WHERE id = ?').run('renamed', ACCOUNT);
    const after = await get('/api/v1/transactions', query);
    expect(after.total).toBe(0);
    expect(after.searchRevision).not.toBe(before.searchRevision);
  });

  it('matches embedded NUL literally in notes, decoded tags and search terms on both endpoints', async () => {
    const note = service.create(createBody({ date: from, note: 'before\u0000NoteTarget' }));
    const tag = service.create(createBody({ date: from, note: 'unrelated', tags: ['before\u0000TagTarget'] }));
    service.create(createBody({ date: from, note: 'beforeMissing' }));
    for (const [term, id] of [
      ['notetarget', note.id], ['before\u0000notetarget', note.id],
      ['tagtarget', tag.id], ['before\u0000tagtarget', tag.id],
    ] as const) {
      const list = await get('/api/v1/transactions', { search: term });
      expect(list.items.map((item: TransactionDto) => item.id), term).toEqual([id]);
      const summary = await get('/api/v1/transactions/daily-summary', {
        search: term, from: String(from), to: String(to), timeZone: 'UTC',
      });
      expect(summary).toEqual({ searchVersion: 1, searchRevision: list.searchRevision, items: [
        { day: '2026-08-01', expenseCents: 1999, incomeCents: 0, count: 1 },
      ] });
    }
    for (const term of ['before\u0000missing', '\u0000absent']) {
      expect((await get('/api/v1/transactions', { search: term })).total).toBe(0);
      expect(await get('/api/v1/transactions/daily-summary', {
        search: term, from: String(from), to: String(to), timeZone: 'UTC',
      })).toEqual({ searchVersion: 1, searchRevision: expect.stringMatching(/^[0-9a-f]{64}$/), items: [] });
    }
    // Legacy q remains the pre-existing note-only LIKE implementation.
    expect((await get('/api/v1/transactions', { q: 'notetarget' })).total).toBe(0);
  });

  it('formats large integer cents exactly and never searches JSON syntax or malformed tags', async () => {
    const amount = service.create(createBody({ amountCents: Number.MAX_SAFE_INTEGER, note: 'max' }));
    const tagged = service.create(createBody({ amountCents: 7, note: 'tagged', tags: ['alpha', 'beta'] }));
    const exact = await get('/api/v1/transactions', { search: '90071992547409.91' });
    expect(exact.items.map((item: TransactionDto) => item.id)).toEqual([amount.id]);
    expect((await get('/api/v1/transactions', { search: '0.07' })).items.map((item: TransactionDto) => item.id)).toEqual([tagged.id]);
    expect((await get('/api/v1/transactions', { search: '","' })).total).toBe(0);
    db.prepare('UPDATE transactions SET tags_json = ? WHERE id = ?').run('{"name":"hidden"}', tagged.id);
    expect((await get('/api/v1/transactions', { search: 'hidden' })).total).toBe(0);
  });

  it('tolerates malformed tag JSON and requires authentication on both endpoints', async () => {
    const row = service.create(createBody({ date: from, note: 'abc' }));
    db.prepare('UPDATE transactions SET tags_json = ? WHERE id = ?').run('not json', row.id);
    expect((await get('/api/v1/transactions', { search: 'abc' })).total).toBe(1);
    expect((await get('/api/v1/transactions', { search: 'not json' })).total).toBe(0);
    for (const url of ['/api/v1/transactions?search=abc', `/api/v1/transactions/daily-summary?search=abc&from=${from}&to=${to}&timeZone=UTC`]) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('UNAUTHORIZED');
    }
  });
});

describe('transactions list expected expense guards (C3 drilldown)', () => {
  const from = Date.UTC(2026, 8, 1);
  const to = Date.UTC(2026, 8, 30);

  it('accepts exact matching totals and rejects changed count or amount', async () => {
    service.create(createBody({ date: from, amountCents: 5000, categoryId: FOOD, accountId: ACCOUNT }));
    service.create(createBody({ date: from + 1000, amountCents: 3000, categoryId: FOOD, accountId: ACCOUNT }));

    const validUrl = `/api/v1/transactions?from=${from}&to=${to}&type=0&categoryId=${FOOD}&accountId=${ACCOUNT}&expectedExpenseCents=8000&expectedExpenseCount=2`;
    const okRes = await app.inject({ method: 'GET', url: validUrl, headers: as(cookie) });
    expect(okRes.statusCode).toBe(200);
    const body = okRes.json();
    expect(body.total).toBe(2);
    expect(body.items).toHaveLength(2);

    // Mismatched count
    const badCountUrl = `/api/v1/transactions?from=${from}&to=${to}&type=0&categoryId=${FOOD}&accountId=${ACCOUNT}&expectedExpenseCents=8000&expectedExpenseCount=3`;
    const badCountRes = await app.inject({ method: 'GET', url: badCountUrl, headers: as(cookie) });
    expect(badCountRes.statusCode).toBe(409);

    // Mismatched amount
    const badAmountUrl = `/api/v1/transactions?from=${from}&to=${to}&type=0&categoryId=${FOOD}&accountId=${ACCOUNT}&expectedExpenseCents=9000&expectedExpenseCount=2`;
    const badAmountRes = await app.inject({ method: 'GET', url: badAmountUrl, headers: as(cookie) });
    expect(badAmountRes.statusCode).toBe(409);
  });

  it('rejects incomplete query scope when expected guards are passed', async () => {
    // Missing categoryId or type=0 or from/to
    const urls = [
      `/api/v1/transactions?from=${from}&to=${to}&expectedExpenseCents=8000&expectedExpenseCount=2`,
      `/api/v1/transactions?from=${from}&to=${to}&type=1&categoryId=${FOOD}&expectedExpenseCents=8000&expectedExpenseCount=2`,
      `/api/v1/transactions?from=${from}&to=${to}&type=0&categoryId=${FOOD}&expectedExpenseCents=8000`, // only one
    ];
    for (const url of urls) {
      const res = await app.inject({ method: 'GET', url, headers: as(cookie) });
      expect(res.statusCode, url).toBe(400);
    }
  });
});

