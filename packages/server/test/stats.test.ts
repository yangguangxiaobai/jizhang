/**
 * T8 acceptance tests: category share, monthly trend, and the pool series.
 *
 * The load-bearing assertions are the accounting ones (parent task AC5):
 *   * a refund counts as income and does not reduce gross expense;
 *   * category expense is gross;
 *   * the pool series ends exactly at the engine's current pool.
 *   * monthly income is transactions PLUS recorded salaries, but salary income never
 *     leaks into the expense category share.
 */
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { closeDatabase, initializeDatabase, type Db } from '../src/db/index.js';
import { SESSION_COOKIE } from '../src/plugins/auth.js';
import { AuthService } from '../src/services/auth-service.js';
import { StatsService } from '../src/services/stats-service.js';
import type { ListTransactionsResult } from '../src/services/transaction-service.js';
import { seedHistoricalSalary } from './support/historical-salary-fixture.js';

const USERNAME = 'quiz';
const PASSWORD = 'correct horse battery staple';
const CSRF = { 'x-requested-with': 'fetch' } as const;

/** Mid-September 2026, so "the last 6 months" is April..September deterministically. */
const NOW = Date.UTC(2026, 8, 15, 12, 0, 0);

const FOOD = 'builtin-expense-food';
const TRANSPORT = 'builtin-expense-transport';
const SALARY = 'builtin-income-salary';
const REFUND = 'builtin-income-refund';
const ACCOUNT = 'builtin-default-account';

/** Local-time day inside a month, `offset` months from NOW. */
function dayIn(monthOffset: number, day: number): number {
  const anchor = new Date(NOW);
  return new Date(anchor.getFullYear(), anchor.getMonth() + monthOffset, day).getTime();
}

let db: Db;
let app: FastifyInstance;
let cookie: string;

function authed() {
  return { ...CSRF, Cookie: `${SESSION_COOKIE}=${cookie}` };
}

async function addTransaction(input: Record<string, unknown>): Promise<void> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/transactions',
    headers: authed(),
    payload: { accountId: ACCOUNT, ...input },
  });
  expect(response.statusCode, JSON.stringify(input)).toBe(201);
}

/**
 * Records a salary (the separate `salary_records` table, not a category transaction).
 *
 * Salaries are income in `monthlyTrend` but carry no category, which is why they need
 * their own helper here rather than going through `addTransaction`.
 *
 * The row is inserted directly: fresh module-allocation salary writes are retired, so
 * `POST /api/v1/salaries` would answer 410 for exactly this shape. Statistics about
 * income does not depend on how the salary was created, only that the fact exists —
 * which is also what an upgraded database contains.
 */
async function recordSalary(amountCents: number, date: number): Promise<void> {
  seedHistoricalSalary(db, { amountCents, date, accountId: ACCOUNT });
}

async function get(url: string) {
  const response = await app.inject({ method: 'GET', url, headers: authed() });
  expect(response.statusCode).toBe(200);
  return response.json();
}

beforeEach(async () => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeDatabase(db, null);

  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    JIZHANG_USERNAME: USERNAME,
    JIZHANG_PASSWORD_HASH: 'unused',
    DATA_DIR: './data',
  });
  const authService = new AuthService(db, {
    sessionTtlDays: config.sessionTtlDays,
    now: () => NOW,
  });
  await authService.setPassword(USERNAME, PASSWORD);

  app = buildApp({
    config,
    db,
    authService,
    secureCookies: false,
    now: () => NOW,
  });
  await app.ready();

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: CSRF,
    payload: { username: USERNAME, password: PASSWORD },
  });
  cookie = (login.cookies as { name: string; value: string }[]).find(
    (c) => c.name === SESSION_COOKIE,
  )?.value as string;
});

afterEach(async () => {
  await app.close();
  closeDatabase(db);
});

// ---------------------------------------------------------------------------
// category share
// ---------------------------------------------------------------------------

describe('category share', () => {
  const window = { from: dayIn(0, 1), to: dayIn(1, 1) };

  it('aggregates net expense per category with ratios', async () => {
    await addTransaction({ type: 0, amountCents: 60_000, categoryId: FOOD, date: dayIn(0, 10) });
    await addTransaction({ type: 0, amountCents: 30_000, categoryId: FOOD, date: dayIn(0, 11) });
    await addTransaction({ type: 0, amountCents: 10_000, categoryId: TRANSPORT, date: dayIn(0, 12) });

    const body = await get(
      `/api/v1/stats/category-share?from=${window.from}&to=${window.to}`,
    );

    expect(body.totalCents).toBe(100_000);
    expect(body.items).toHaveLength(2);

    const food = body.items.find((i: { categoryId: string }) => i.categoryId === FOOD);
    expect(food.amountCents).toBe(90_000);
    expect(food.ratio).toBeCloseTo(0.9, 10);
    expect(food.categoryName).toBe('餐饮');
    expect(typeof food.color).toBe('number');

    // Sorted largest first.
    expect(body.items[0].categoryId).toBe(FOOD);
  });

  it('AC5 a refund counts as income and does not reduce the category spend', async () => {
    await addTransaction({ type: 0, amountCents: 150_000, categoryId: FOOD, date: dayIn(0, 10) });
    await addTransaction({
      type: 1,
      amountCents: 50_000,
      categoryId: REFUND,
      date: dayIn(0, 11),
      isRefund: true,
    });

    const body = await get(
      `/api/v1/stats/category-share?from=${window.from}&to=${window.to}`,
    );
    const food = body.items.find((i: { categoryId: string }) => i.categoryId === FOOD);
    expect(food.amountCents).toBe(150_000);
    expect(body.totalCents).toBe(150_000);
    // The 退款 category is income and never appears in the expense share.
    expect(body.items.find((i: { categoryId: string }) => i.categoryId === REFUND)).toBeUndefined();
  });

  it('AC1 a refund equal to the spending no longer nets the category to zero', async () => {
    await addTransaction({ type: 0, amountCents: 80_000, categoryId: FOOD, date: dayIn(0, 10) });
    await addTransaction({
      type: 1,
      amountCents: 80_000,
      categoryId: REFUND,
      date: dayIn(0, 11),
      isRefund: true,
    });

    const body = await get(
      `/api/v1/stats/category-share?from=${window.from}&to=${window.to}`,
    );
    // Only FOOD is in the expense share; the refund is income.
    expect(body.items).toHaveLength(1);
    expect(body.items[0].amountCents).toBe(80_000);
    expect(body.totalCents).toBe(80_000);
  });

  it('AC2 income rows never appear in the expense share', async () => {
    await addTransaction({ type: 0, amountCents: 10_000, categoryId: FOOD, date: dayIn(0, 10) });
    await addTransaction({ type: 1, amountCents: 900_000, categoryId: SALARY, date: dayIn(0, 5) });

    const body = await get(
      `/api/v1/stats/category-share?from=${window.from}&to=${window.to}`,
    );
    expect(body.items).toHaveLength(1);
    expect(body.items[0].categoryId).toBe(FOOD);
    expect(body.totalCents).toBe(10_000);
  });

  it('AC8 refunds never appear in the expense share, even when they outweigh spending', async () => {
    await addTransaction({ type: 0, amountCents: 10_000, categoryId: FOOD, date: dayIn(0, 10) });
    await addTransaction({
      type: 1,
      amountCents: 30_000,
      categoryId: REFUND,
      date: dayIn(0, 11),
      isRefund: true,
    });

    const body = await get(
      `/api/v1/stats/category-share?from=${window.from}&to=${window.to}`,
    );
    expect(body.items).toHaveLength(1);
    expect(body.items[0].categoryId).toBe(FOOD);
    expect(body.items[0].amountCents).toBe(10_000);
    expect(body.totalCents).toBe(10_000);
  });

  it('labels a soft-deleted category instead of showing a raw id', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/categories',
      headers: authed(),
      payload: { name: '宠物', type: 0 },
    });
    const categoryId = created.json().id as string;
    await addTransaction({ type: 0, amountCents: 5000, categoryId, date: dayIn(0, 10) });

    await app.inject({
      method: 'DELETE',
      url: `/api/v1/categories/${categoryId}`,
      headers: authed(),
    });

    const body = await get(
      `/api/v1/stats/category-share?from=${window.from}&to=${window.to}`,
    );
    expect(body.items[0].categoryName).toBe('宠物');
  });

  it('ignores transactions outside the window and soft-deleted rows', async () => {
    await addTransaction({ type: 0, amountCents: 1000, categoryId: FOOD, date: dayIn(0, 10) });
    await addTransaction({ type: 0, amountCents: 999_999, categoryId: FOOD, date: dayIn(-2, 10) });

    const gone = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      headers: authed(),
      payload: {
        type: 0,
        amountCents: 777_777,
        categoryId: FOOD,
        accountId: ACCOUNT,
        date: dayIn(0, 11),
      },
    });
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/transactions/${gone.json().id as string}`,
      headers: authed(),
    });

    const body = await get(
      `/api/v1/stats/category-share?from=${window.from}&to=${window.to}`,
    );
    expect(body.totalCents).toBe(1000);
  });

  it('returns an empty result when nothing falls in the window', async () => {
    const body = await get(
      `/api/v1/stats/category-share?from=${dayIn(-6, 1)}&to=${dayIn(-5, 1)}`,
    );
    expect(body.items).toEqual([]);
    expect(body.totalCents).toBe(0);
  });

  it('rejects an inverted window', async () => {
    const service = new StatsService(db, { now: () => NOW });
    expect(() => service.categoryShare(dayIn(0, 10), dayIn(0, 1))).toThrow(/earlier/);
  });

  it('defaults to the last 30 days', async () => {
    await addTransaction({ type: 0, amountCents: 4200, categoryId: FOOD, date: dayIn(0, 10) });
    const body = await get('/api/v1/stats/category-share');
    expect(body.totalCents).toBe(4200);
  });
});

// ---------------------------------------------------------------------------
// C3: exact summary/drilldown scope and complete expense count (C3-04)
// ---------------------------------------------------------------------------

describe('category share exact filters and complete expense count', () => {
  const from = dayIn(-1, 1);
  const to = dayIn(0, 1);
  const OTHER_ACCOUNT = 'stats-other-account';
  const CHILD_FOOD = 'stats-child-food';

  async function share(filters: Record<string, string> = {}): Promise<CategoryShareBody> {
    const query = new URLSearchParams({ from: String(from), to: String(to), ...filters });
    return (await get(`/api/v1/stats/category-share?${query}`)) as CategoryShareBody;
  }

  it('matches the complete paginated expense list beyond 500 rows under exact account/category/date filters', async () => {
    db.prepare(`INSERT INTO accounts (id, name, type, updated_at)
      VALUES (?, 'Other stats account', 0, ?)`).run(OTHER_ACCOUNT, NOW);
    db.prepare(`INSERT INTO categories (id, name, type, icon, color, parent_id, updated_at)
      VALUES (?, 'Child food', 0, 'restaurant', 0, ?, ?)`).run(CHILD_FOOD, FOOD, NOW);
    const insert = db.prepare(`INSERT INTO transactions
      (id, type, amount_cents, category_id, account_id, date, is_refund, deleted, updated_at)
      VALUES (?, 0, ?, ?, ?, ?, 0, ?, ?)`);
    db.transaction(() => {
      for (let index = 0; index < 503; index += 1) {
        // Includes `from` itself; every row has a distinct date for deterministic paging.
        insert.run(`stats-matching-${index}`, 123, FOOD, ACCOUNT, from + index, 0, NOW);
      }
      insert.run('stats-last-ms', 77, FOOD, ACCOUNT, to - 1, 0, NOW);
      insert.run('stats-before', 70_000, FOOD, ACCOUNT, from - 1, 0, NOW);
      insert.run('stats-at-to', 80_000, FOOD, ACCOUNT, to, 0, NOW);
      insert.run('stats-deleted', 90_000, FOOD, ACCOUNT, from + 1_000, 1, NOW);
      insert.run('stats-other-account', 10_000, FOOD, OTHER_ACCOUNT, from + 1_001, 0, NOW);
      insert.run('stats-other-category', 20_000, TRANSPORT, ACCOUNT, from + 1_002, 0, NOW);
      insert.run('stats-child-category', 30_000, CHILD_FOOD, ACCOUNT, from + 1_003, 0, NOW);
    })();
    await addTransaction({ type: 1, amountCents: 999, categoryId: REFUND, date: from, isRefund: true });
    await addTransaction({ type: 1, amountCents: 888, categoryId: SALARY, date: from });
    await recordSalary(700_000, from);
    // Historical account/category metadata must not hide live matching bills.
    db.prepare('UPDATE accounts SET deleted = 1 WHERE id = ?').run(ACCOUNT);
    db.prepare('UPDATE categories SET deleted = 1 WHERE id = ?').run(FOOD);

    const filters = { accountId: ACCOUNT, categoryId: FOOD };
    const body = await share(filters);
    // 503 x 123 cents plus the final millisecond's 77 cents = 61,946 cents.
    const expectedExpense = 503 * 123 + 77;
    expect(body).toEqual({
      items: [{ categoryId: FOOD, categoryName: '餐饮', color: expect.any(Number), amountCents: expectedExpense, ratio: 1 }],
      totalCents: expectedExpense,
      expenseCents: expectedExpense,
      expenseCount: 504,
      accountId: ACCOUNT,
      categoryId: FOOD,
      refundIncomeCents: 0,
      from,
      to,
    });

    const query = new URLSearchParams({ from: String(from), to: String(to), type: '0', ...filters, limit: '500' });
    const first = (await get(`/api/v1/transactions?${query}&offset=0`)) as ListTransactionsResult;
    const second = (await get(`/api/v1/transactions?${query}&offset=500`)) as ListTransactionsResult;
    const tail = (await get(`/api/v1/transactions?${query}&offset=504`)) as ListTransactionsResult;
    expect(first).toMatchObject({ total: 504, limit: 500, offset: 0 });
    expect(second).toMatchObject({ total: 504, limit: 500, offset: 500 });
    expect(tail).toMatchObject({ total: 504, items: [] });
    expect(first.items).toHaveLength(500);
    expect(second.items).toHaveLength(4);
    const rows = [...first.items, ...second.items];
    expect(new Set(rows.map((row) => row.id)).size).toBe(body.expenseCount);
    expect(rows.map((row) => row.id)).toContain('stats-matching-0');
    expect(rows.map((row) => row.id)).toContain('stats-last-ms');
    expect(rows.every((row) => row.type === 0 && row.accountId === ACCOUNT && row.categoryId === FOOD && row.date >= from && row.date < to)).toBe(true);
    expect(rows.reduce((sum, row) => sum + row.amountCents, 0)).toBe(body.expenseCents);
    expect(first.total).toBe(body.expenseCount);
    expect(body.expenseCents).toBeGreaterThan(first.items.reduce((sum, row) => sum + row.amountCents, 0));

    expect(await share({ accountId: ACCOUNT })).toMatchObject({
      expenseCount: 506, expenseCents: expectedExpense + 50_000, refundIncomeCents: 999,
    });
    expect(await share({ categoryId: FOOD })).toMatchObject({ expenseCount: 505, expenseCents: expectedExpense + 10_000 });
    expect(await share()).toMatchObject({ expenseCount: 507, expenseCents: expectedExpense + 60_000, refundIncomeCents: 999 });
    // A syntactically valid unmatched ID is an empty exact scope, never an all-row fallback.
    const unmatchedScopes: Record<string, string>[] = [
      { accountId: 'missing-account' }, { categoryId: 'missing-category' },
      { accountId: OTHER_ACCOUNT, categoryId: TRANSPORT }, { categoryId: `${FOOD}%` },
      { accountId: ` ${ACCOUNT}` }, { categoryId: `${FOOD} ` },
    ];
    for (const empty of unmatchedScopes) {
      expect(await share(empty)).toMatchObject({ items: [], expenseCents: 0, expenseCount: 0, refundIncomeCents: 0 });
    }
  });

  it('filters refund income by its own exact account/category/window without reducing gross expense or counting income rows', async () => {
    db.prepare(`INSERT INTO accounts (id, name, type, updated_at)
      VALUES (?, 'Other stats account', 0, ?)`).run(OTHER_ACCOUNT, NOW);
    await addTransaction({ type: 0, amountCents: 10_000, categoryId: FOOD, date: from });
    await addTransaction({ type: 0, amountCents: 20_000, categoryId: FOOD, accountId: OTHER_ACCOUNT, date: from });
    for (const [amountCents, date] of [[1_001, from], [2_002, to - 1], [3_003, from - 1], [4_004, to]] as const) {
      await addTransaction({ type: 1, amountCents, categoryId: REFUND, date, isRefund: true });
    }
    await addTransaction({ type: 1, amountCents: 5_005, categoryId: REFUND, accountId: OTHER_ACCOUNT, date: from, isRefund: true });
    await addTransaction({ type: 1, amountCents: 6_006, categoryId: REFUND, date: from });
    await addTransaction({ type: 1, amountCents: 7_007, categoryId: SALARY, date: from });
    await recordSalary(800_000, from);
    const deleted = await app.inject({
      method: 'POST', url: '/api/v1/transactions', headers: authed(),
      payload: { type: 1, amountCents: 8_008, categoryId: REFUND, accountId: ACCOUNT, date: from, isRefund: true },
    });
    expect(deleted.statusCode).toBe(201);
    const removed = await app.inject({ method: 'DELETE', url: `/api/v1/transactions/${deleted.json<{ id: string }>().id}`, headers: authed() });
    expect(removed.statusCode).toBe(204);

    expect(await share()).toMatchObject({ expenseCents: 30_000, expenseCount: 2, refundIncomeCents: 8_008 });
    expect(await share({ accountId: ACCOUNT })).toMatchObject({ expenseCents: 10_000, expenseCount: 1, refundIncomeCents: 3_003 });
    expect(await share({ accountId: OTHER_ACCOUNT })).toMatchObject({ expenseCents: 20_000, expenseCount: 1, refundIncomeCents: 5_005 });
    expect(await share({ accountId: ACCOUNT, categoryId: FOOD })).toMatchObject({ expenseCents: 10_000, expenseCount: 1, refundIncomeCents: 0 });
    expect(await share({ accountId: ACCOUNT, categoryId: REFUND })).toMatchObject({ items: [], expenseCents: 0, expenseCount: 0, refundIncomeCents: 3_003 });
  });

  it('retains the captured last30 fallback when timestamps or filters are omitted', async () => {
    const expectedFrom = NOW - 30 * 86_400_000;
    await addTransaction({ type: 0, amountCents: 111, categoryId: FOOD, date: expectedFrom });
    await addTransaction({ type: 0, amountCents: 222, categoryId: FOOD, date: NOW - 1 });
    await addTransaction({ type: 0, amountCents: 333, categoryId: FOOD, date: expectedFrom - 1 });
    await addTransaction({ type: 0, amountCents: 444, categoryId: FOOD, date: NOW });
    const expected = { from: expectedFrom, to: NOW, expenseCents: 333, expenseCount: 2 };
    for (const suffix of ['', `?from=${expectedFrom}`, `?to=${NOW}`, `?accountId=${ACCOUNT}&categoryId=${FOOD}`]) {
      expect(await get(`/api/v1/stats/category-share${suffix}`)).toMatchObject(expected);
    }
    // Millisecond zero and safe negative integers are real boundaries, not omitted values.
    expect(await get(`/api/v1/stats/category-share?from=-1&to=${NOW}`)).toMatchObject({ from: -1, to: NOW });
    expect(await get(`/api/v1/stats/category-share?from=0&to=${NOW}`)).toMatchObject({ from: 0, to: NOW });
  });

  it('rejects malformed, fractional, unsafe, duplicate or blank query parameters instead of coercing them', async () => {
    const badQueries = [
      `from=${to}&to=${from}`, `from=${from}&to=${from}`,
      ...['from', 'to'].flatMap((field) => ['', 'NaN', 'Infinity', '-Infinity', '1.5', '9007199254740992', '-9007199254740992', '0x10', '1e3', '%20', `%20${from}%20`].map(
        (value) => `${field}=${value}&${field === 'from' ? 'to' : 'from'}=${field === 'from' ? to : from}`,
      )),
      `from=${from}&from=${from + 1}&to=${to}`,
      `from=${from}&to=${to}&to=${to + 1}`,
      ...['accountId', 'categoryId'].flatMap((field) => ['', '%20', 'a&' + field + '=b'].map(
        (value) => `from=${from}&to=${to}&${field}=${value}`,
      )),
    ];
    for (const query of badQueries) {
      const response = await app.inject({ method: 'GET', url: `/api/v1/stats/category-share?${query}`, headers: authed() });
      expect(response.statusCode, query).toBe(400);
      expect(response.json(), query).toMatchObject({ error: { code: 'VALIDATION', message: expect.any(String) } });
    }
  });

  it('validates safe-integer timestamps and non-empty exact ID strings at the service boundary too', () => {
    const service = new StatsService(db, { now: () => NOW });
    for (const [start, end] of [[NaN, to], [from, Infinity], [from + 0.5, to], [from, Number.MAX_SAFE_INTEGER + 1]]) {
      expect(() => service.categoryShare(start!, end!)).toThrow(/safe integer/);
    }
    for (const query of ['accountId', 'categoryId'] as const) {
      for (const value of ['', ' ', 1, ['a', 'b']]) {
        // Exercise runtime validation, not only TypeScript's trusted-call signature.
        expect(() => service.categoryShare(from, to, { [query]: value } as never)).toThrow(new RegExp(query));
      }
    }
  });
});

// ---------------------------------------------------------------------------
// monthly trend
// ---------------------------------------------------------------------------

describe('monthly trend', () => {
  it('AC4 reports one point per month and zero-fills empty months', async () => {
    // Only the current month and three months ago have activity.
    await addTransaction({ type: 0, amountCents: 30_000, categoryId: FOOD, date: dayIn(0, 10) });
    await addTransaction({ type: 1, amountCents: 500_000, categoryId: SALARY, date: dayIn(0, 5) });
    await addTransaction({ type: 0, amountCents: 12_000, categoryId: FOOD, date: dayIn(-3, 10) });

    const body = await get('/api/v1/stats/monthly-trend?months=6');
    expect(body.items).toHaveLength(6);

    const current = body.items[5];
    expect(current.incomeCents).toBe(500_000);
    expect(current.netExpenseCents).toBe(30_000);

    const threeAgo = body.items[2];
    expect(threeAgo.netExpenseCents).toBe(12_000);
    expect(threeAgo.incomeCents).toBe(0);

    // The empty months are present with zeros, not missing.
    for (const index of [0, 1, 3, 4]) {
      expect(body.items[index].netExpenseCents, `index ${index}`).toBe(0);
      expect(body.items[index].incomeCents, `index ${index}`).toBe(0);
    }

    // Ascending, labelled YYYY-MM.
    expect(body.items[0].month < body.items[5].month).toBe(true);
    expect(current.month).toMatch(/^\d{4}-\d{2}$/);
  });

  it('AC5 refunds raise income and never reduce the month expense', async () => {
    await addTransaction({ type: 0, amountCents: 100_000, categoryId: FOOD, date: dayIn(0, 8) });
    await addTransaction({
      type: 1,
      amountCents: 40_000,
      categoryId: REFUND,
      date: dayIn(0, 9),
      isRefund: true,
    });
    await addTransaction({ type: 1, amountCents: 300_000, categoryId: SALARY, date: dayIn(0, 5) });

    const body = await get('/api/v1/stats/monthly-trend?months=3');
    const current = body.items[body.items.length - 1];
    expect(current.netExpenseCents).toBe(100_000);
    expect(current.incomeCents).toBe(340_000);
  });

  it('defaults to 6 months and accepts 1', async () => {
    expect((await get('/api/v1/stats/monthly-trend')).items).toHaveLength(6);
    expect((await get('/api/v1/stats/monthly-trend?months=1')).items).toHaveLength(1);
  });

  it('clamps an oversized month count instead of building a huge series', async () => {
    expect((await get('/api/v1/stats/monthly-trend?months=999')).items.length).toBe(36);
  });

  it('rejects a non-numeric month count', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/stats/monthly-trend?months=abc',
      headers: authed(),
    });
    expect(response.statusCode).toBe(400);
  });

  it('month boundaries are local, so a transaction on the 1st stays in its month', async () => {
    await addTransaction({ type: 0, amountCents: 7000, categoryId: FOOD, date: dayIn(0, 1) });
    const body = await get('/api/v1/stats/monthly-trend?months=2');
    expect(body.items[1].netExpenseCents).toBe(7000);
    expect(body.items[0].netExpenseCents).toBe(0);
  });

  it('a transaction from an earlier month is NEVER attributed to the current one', async () => {
    // Regression guard: the bucket key comes from the transaction's own date, so a
    // row three months old must land in its own bucket. A bug where the month key was
    // computed from a month OFFSET instead of the timestamp put every expense in the
    // current bucket, and only multi-month data reveals it.
    await addTransaction({ type: 0, amountCents: 12_345, categoryId: FOOD, date: dayIn(-3, 12) });
    await addTransaction({ type: 0, amountCents: 500, categoryId: FOOD, date: dayIn(0, 12) });

    const body = await get('/api/v1/stats/monthly-trend?months=6');
    // 6 points: indices 0..5 = five months ago..now. Three months ago is index 2.
    expect(body.items[2].netExpenseCents).toBe(12_345);
    expect(body.items[5].netExpenseCents).toBe(500);
    // Every other month stays zero.
    for (const index of [0, 1, 3, 4]) {
      expect(body.items[index].netExpenseCents, `index ${index}`).toBe(0);
    }
  });

  it('the current bucket holds only the current month, not the running total', async () => {
    await addTransaction({ type: 0, amountCents: 1000, categoryId: FOOD, date: dayIn(0, 5) });
    await addTransaction({ type: 0, amountCents: 2000, categoryId: FOOD, date: dayIn(-1, 5) });
    await addTransaction({ type: 0, amountCents: 4000, categoryId: FOOD, date: dayIn(-2, 5) });

    const body = await get('/api/v1/stats/monthly-trend?months=3');
    expect(body.items.map((p: { netExpenseCents: number }) => p.netExpenseCents)).toEqual([
      4000, 2000, 1000,
    ]);
  });

  it('counts a recorded salary as income, with no matching transaction', async () => {
    // The gap this closes: a salary lives in `salary_records`, not in `transactions`,
    // so aggregating the ledger alone reported income 0 for a month whose only income
    // was a salary — which is how the home dashboard would have shown "收入 0" right
    // after the user recorded their pay.
    await recordSalary(1_234_500, dayIn(0, 5));

    const body = await get('/api/v1/stats/monthly-trend?months=3');
    expect(body.items[2].incomeCents).toBe(1_234_500);
    // A salary is income, never spending.
    expect(body.items[2].netExpenseCents).toBe(0);
  });

  it('adds salary income on top of income transactions', async () => {
    await addTransaction({ type: 1, amountCents: 300_000, categoryId: SALARY, date: dayIn(0, 3) });
    await recordSalary(1_000_000, dayIn(0, 5));

    const body = await get('/api/v1/stats/monthly-trend?months=2');
    // 300,000 (transaction) + 1,000,000 (salary), summed not replaced.
    expect(body.items[1].incomeCents).toBe(1_300_000);
  });

  it('excludes a soft-deleted salary from income', async () => {
    await recordSalary(500_000, dayIn(0, 5));
    const created = await get('/api/v1/salaries');
    const salaryId = created.items[0].id as string;

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/salaries/${salaryId}`,
      headers: authed(),
    });
    expect(deleted.statusCode).toBe(204);

    const body = await get('/api/v1/stats/monthly-trend?months=2');
    expect(body.items[1].incomeCents).toBe(0);
  });

  it('buckets a salary into its own month, not the current one', async () => {
    // Same multi-month guard as the transaction version above: a salary two months old
    // must not be attributed to the current month.
    await recordSalary(700_000, dayIn(-2, 5));
    await recordSalary(100_000, dayIn(0, 5));

    const body = await get('/api/v1/stats/monthly-trend?months=4');
    // 4 points: indices 0..3 = three months ago..now. Two months ago is index 1.
    expect(body.items[1].incomeCents).toBe(700_000);
    expect(body.items[3].incomeCents).toBe(100_000);
    expect(body.items[0].incomeCents).toBe(0);
    expect(body.items[2].incomeCents).toBe(0);
  });

  it('includes a salary exactly on the window edge and excludes one before it', async () => {
    // The window is `[firstStart, end)`: the earliest month's first instant is inside,
    // the instant before it is outside.
    const firstStart = dayIn(-2, 1);
    const justBefore = firstStart - 1;
    expect(justBefore).toBeLessThan(firstStart);

    await recordSalary(11_000, firstStart);
    await recordSalary(22_000, justBefore);

    const body = await get('/api/v1/stats/monthly-trend?months=3');
    expect(body.items[0].incomeCents).toBe(11_000);
  });

  it('does not fold salary income into the expense category share', async () => {
    // A salary has no category. Giving it one would misreport the composition of
    // spending, so `categoryShare` must stay exactly as it was.
    await addTransaction({ type: 0, amountCents: 40_000, categoryId: FOOD, date: dayIn(0, 10) });
    const before = await get(
      `/api/v1/stats/category-share?from=${dayIn(0, 1)}&to=${dayIn(1, 1)}`,
    );

    await recordSalary(999_999, dayIn(0, 5));

    const after = await get(
      `/api/v1/stats/category-share?from=${dayIn(0, 1)}&to=${dayIn(1, 1)}`,
    );
    expect(after).toEqual(before);
    expect(after.totalCents).toBe(40_000);
    expect(
      after.items.some((i: { categoryId: string }) => i.categoryId === SALARY),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// pool trend: the consistency contract
// ---------------------------------------------------------------------------

describe('pool trend', () => {
  it('is empty before any salary is recorded', async () => {
    const body = await get('/api/v1/stats/pool-trend');
    expect(body.points).toEqual([]);
    expect(body.currentCents).toBe(0);
  });

  it('AC3 the last point equals the current pool the budget page reports', async () => {
    // July cycle: budget 1,000,000, spend 550,000 on food -> leftover 450,000.
    // Both cycles are seeded as historical module snapshots (default template ratio 1
    // to FOOD in this fixture): the pool contract is about the engine, not about how
    // the salary row got there.
    seedHistoricalSalary(db, {
      amountCents: 1_000_000, date: dayIn(-2, 5), accountId: ACCOUNT,
      allocations: [{ categoryId: FOOD, amountCents: 1_000_000 }],
    });

    await addTransaction({ type: 0, amountCents: 550_000, categoryId: FOOD, date: dayIn(-2, 10) });

    // September cycle becomes current, closing July.
    seedHistoricalSalary(db, {
      amountCents: 1_000_000, date: dayIn(0, 5), accountId: ACCOUNT,
      allocations: [{ categoryId: FOOD, amountCents: 1_000_000 }],
    });

    const trend = await get('/api/v1/stats/pool-trend');
    const overview = await get('/api/v1/budget/overview');

    expect(trend.points.length).toBeGreaterThan(0);
    expect(trend.points[trend.points.length - 1].poolCents).toBe(trend.currentCents);
    // This is the contract from the reference project (charts_data_test.dart:416).
    expect(trend.currentCents).toBe(overview.carryoverPoolCents);
  });

  it('an overspent single-module cycle drives the pool negative', async () => {
    // One module holding the whole salary: the snapshot is the historical fact this
    // pool assertion needs (fresh module allocation writes are retired).
    seedHistoricalSalary(db, {
      amountCents: 100_000, date: dayIn(0, 2), accountId: ACCOUNT,
      allocations: [{ categoryId: FOOD, amountCents: 100_000 }],
    });

    await addTransaction({ type: 0, amountCents: 250_000, categoryId: FOOD, date: dayIn(0, 10) });

    const trend = await get('/api/v1/stats/pool-trend');
    const overview = await get('/api/v1/budget/overview');

    // The current cycle is over budget by 150,000 with nothing historical, so the
    // pool is exactly that borrow.
    const food = overview.modules.find(
      (m: { categoryId: string }) => m.categoryId === FOOD,
    );
    expect(food.budgetCents).toBe(100_000);
    expect(food.spentCents).toBe(250_000);
    expect(overview.totalBudgetCents).toBe(100_000);

    expect(overview.carryoverPoolCents).toBe(-150_000);
    expect(trend.currentCents).toBe(-150_000);
    expect(trend.points[trend.points.length - 1].poolCents).toBe(-150_000);
  });

  it('the series is ascending by period start', async () => {
    for (const offset of [-3, -2, -1, 0]) {
      seedHistoricalSalary(db, {
        amountCents: 500_000, date: dayIn(offset, 5), accountId: ACCOUNT,
        allocations: [{ categoryId: FOOD, amountCents: 500_000 }],
      });
    }
    const body = await get('/api/v1/stats/pool-trend');
    for (let i = 1; i < body.points.length; i += 1) {
      expect(body.points[i].periodStart).toBeGreaterThan(body.points[i - 1].periodStart);
    }
  });

  it('honours a configured cycle start day', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/v1/settings',
      headers: authed(),
      payload: { cycleStartDay: 10 },
    });
    const body = await get('/api/v1/stats/pool-trend');
    expect(body.cycle).toEqual({ kind: 'start-day', day: 10 });
  });
});

// ---------------------------------------------------------------------------
// auxiliary endpoints
// ---------------------------------------------------------------------------

describe('range and month-window helpers', () => {
  it('reports the activity range, null when there is none', async () => {
    expect(await get('/api/v1/stats/range')).toEqual({ earliest: null, latest: null });

    await addTransaction({ type: 0, amountCents: 100, categoryId: FOOD, date: dayIn(-1, 10) });
    await addTransaction({ type: 0, amountCents: 100, categoryId: FOOD, date: dayIn(0, 10) });

    const range = await get('/api/v1/stats/range');
    expect(range.earliest).toBe(dayIn(-1, 10));
    expect(range.latest).toBe(dayIn(0, 10));
  });

  it('returns the month window for a given instant', async () => {
    const body = await get(`/api/v1/stats/month-window?monthStart=${dayIn(0, 15)}`);
    expect(body.from).toBe(dayIn(0, 1));
    expect(body.to).toBe(dayIn(1, 1));
  });
});

// ---------------------------------------------------------------------------
// C3: the server-owned stats window (F07 / C3-03)
// ---------------------------------------------------------------------------

/** `StatsWindow` as it appears on the wire. */
interface StatsWindowBody {
  kind: 'month' | 'last30';
  from: number;
  to: number;
  timeZone: string;
  label: string;
  calculatedAt: number;
}

/** One monthly-trend point as it appears on the wire. */
interface TrendPointBody {
  month: string;
  monthStart: number;
  incomeCents: number;
  netExpenseCents: number;
  refundIncomeCents: number;
  salaryIncomeCents: number;
}

interface TrendRangeBody {
  from: number;
  to: number;
  months: number;
  endMonth: string;
  label: string;
}

interface TrendBody {
  items: TrendPointBody[];
  range: TrendRangeBody;
}

interface CategoryShareBody {
  items: { categoryId: string; categoryName: string; color: number; amountCents: number; ratio: number }[];
  totalCents: number;
  expenseCents: number;
  expenseCount: number;
  refundIncomeCents: number;
  from: number;
  to: number;
}

const LAST_30_DAYS_MS = 30 * 86_400_000;

describe('stats window endpoint', () => {
  it('C3-03 last30 ends at the captured now, not at the first instant of next month', async () => {
    const body = (await get('/api/v1/stats/window?kind=last30&timeZone=Asia%2FShanghai')) as StatsWindowBody;

    expect(body.kind).toBe('last30');
    expect(body.timeZone).toBe('Asia/Shanghai');
    expect(body.calculatedAt).toBe(NOW);
    // Half-open [now - 30d, now): a rolling 720 hours, not 30 local midnights.
    expect(body.to).toBe(NOW);
    expect(body.to - body.from).toBe(LAST_30_DAYS_MS);
    expect(body.from).toBe(NOW - LAST_30_DAYS_MS);
    // The old bug: the upper bound was next month's first midnight.
    expect(body.to).not.toBe(Date.parse('2026-10-01T00:00:00+08:00'));
    // NOW is 2026-09-15T12:00Z = 20:00 in Shanghai.
    expect(body.label).toBe('近30天 08-16 20:00 – 09-15 20:00');
  });

  it('month windows are the real calendar month in the requested time zone', async () => {
    const february = (await get(
      '/api/v1/stats/window?kind=month&month=2026-02&timeZone=Asia%2FShanghai',
    )) as StatsWindowBody;
    expect(february.from).toBe(Date.parse('2026-02-01T00:00:00+08:00'));
    expect(february.to).toBe(Date.parse('2026-03-01T00:00:00+08:00'));
    expect(february.label).toBe('2026年2月');

    // Cross-year month: the end is the next year's January, in the same zone.
    const december = (await get(
      '/api/v1/stats/window?kind=month&month=2025-12&timeZone=Asia%2FShanghai',
    )) as StatsWindowBody;
    expect(december.from).toBe(Date.parse('2025-12-01T00:00:00+08:00'));
    expect(december.to).toBe(Date.parse('2026-01-01T00:00:00+08:00'));
    expect(december.label).toBe('2025年12月');
  });

  it('returns earliest valid instant for historical fall-back repeated midnight (America/St_Johns 2009-11)', async () => {
    const body = (await get(
      '/api/v1/stats/window?kind=month&month=2009-11&timeZone=America%2FSt_Johns',
    )) as StatsWindowBody;
    const firstInstant = Date.parse('2009-11-01T02:30:00Z');
    expect(body.from).toBe(firstInstant);
    expect(body.from).not.toBe(Date.parse('2009-11-01T03:30:00Z'));
    expect(body.label).toBe('2009年11月');

    // Querying with this window includes a transaction at 02:30:30Z
    const billTime = Date.parse('2009-11-01T02:30:30Z');
    expect(billTime >= body.from && billTime < body.to).toBe(true);
  });

  it('resolves the default current month from captured server now in its explicit zone', async () => {
    const body = (await get('/api/v1/stats/window?kind=month&timeZone=Asia%2FShanghai')) as StatsWindowBody;
    expect(body.from).toBe(Date.parse('2026-09-01T00:00:00+08:00'));
    expect(body.to).toBe(Date.parse('2026-10-01T00:00:00+08:00'));
    expect(body.label).toBe('2026年9月');
    expect(body.calculatedAt).toBe(NOW);
  });

  it('falls back to the server time zone when the request names none', async () => {
    const body = (await get('/api/v1/stats/window?kind=last30')) as StatsWindowBody;

    expect(typeof body.timeZone).toBe('string');
    expect(body.timeZone.length).toBeGreaterThan(0);
    expect(body.to - body.from).toBe(LAST_30_DAYS_MS);
  });

  it('rejects invalid input with 400 instead of guessing a range', async () => {
    const urls = [
      '/api/v1/stats/window',
      '/api/v1/stats/window?kind=year',
      '/api/v1/stats/window?kind=month&month=2026-13',
      '/api/v1/stats/window?kind=month&month=2026-1',
      '/api/v1/stats/window?kind=month&month=2026-10&timeZone=Mars%2FPhobos',
      '/api/v1/stats/window?kind=month&month=2026-10&timeZone=%2B08%3A00',
      '/api/v1/stats/window?kind=month&month=2026-10&month=2026-11',
    ];
    for (const url of urls) {
      const response = await app.inject({ method: 'GET', url, headers: authed() });
      expect(response.statusCode, url).toBe(400);
    }
  });
});

// ---------------------------------------------------------------------------
// C3: refund income subtotal and the gross-expense name (F06 / C3-01)
// ---------------------------------------------------------------------------

describe('refund income subtotal', () => {
  it('C3-01 reports refund income separately while expense stays gross', async () => {
    await addTransaction({ type: 0, amountCents: 100_000, categoryId: FOOD, date: dayIn(0, 10) });
    await addTransaction({
      type: 1,
      amountCents: 30_000,
      categoryId: REFUND,
      date: dayIn(0, 11),
      isRefund: true,
    });
    await addTransaction({ type: 1, amountCents: 500_000, categoryId: SALARY, date: dayIn(0, 5) });

    const body = (await get(
      `/api/v1/stats/category-share?from=${dayIn(0, 1)}&to=${dayIn(1, 1)}`,
    )) as CategoryShareBody;

    // 支出 is the gross ledger expense: the refund never reduces it.
    expect(body.totalCents).toBe(100_000);
    expect(body.expenseCents).toBe(100_000);
    // Only refund rows are refund income; a wage-category income row is not.
    expect(body.refundIncomeCents).toBe(30_000);
    expect(body.items.map((item) => item.categoryId)).toEqual([FOOD]);
  });

  it('counts only refunds inside the requested window', async () => {
    await addTransaction({ type: 0, amountCents: 10_000, categoryId: FOOD, date: dayIn(0, 10) });
    await addTransaction({
      type: 1,
      amountCents: 5_000,
      categoryId: REFUND,
      date: dayIn(0, 12),
      isRefund: true,
    });
    await addTransaction({
      type: 1,
      amountCents: 7_000,
      categoryId: REFUND,
      date: dayIn(-2, 12),
      isRefund: true,
    });

    const current = (await get(
      `/api/v1/stats/category-share?from=${dayIn(0, 1)}&to=${dayIn(1, 1)}`,
    )) as CategoryShareBody;
    expect(current.refundIncomeCents).toBe(5_000);

    const previous = (await get(
      `/api/v1/stats/category-share?from=${dayIn(-2, 1)}&to=${dayIn(-1, 1)}`,
    )) as CategoryShareBody;
    expect(previous.refundIncomeCents).toBe(7_000);
  });

  it('reports 0 when the window has no refunds', async () => {
    await addTransaction({ type: 0, amountCents: 4_200, categoryId: FOOD, date: dayIn(0, 10) });
    const body = (await get(
      `/api/v1/stats/category-share?from=${dayIn(0, 1)}&to=${dayIn(1, 1)}`,
    )) as CategoryShareBody;
    expect(body.refundIncomeCents).toBe(0);
    expect(body.expenseCents).toBe(body.totalCents);
  });
});

// ---------------------------------------------------------------------------
// C3: trend range and endMonth anchoring (F06 / C3-02, C3-06)
// ---------------------------------------------------------------------------

describe('monthly trend range and endMonth anchoring', () => {
  it('exposes the range the series actually covers', async () => {
    const body = (await get('/api/v1/stats/monthly-trend')) as TrendBody;

    expect(body.items).toHaveLength(6);
    expect(body.range).toEqual({
      from: dayIn(-5, 1),
      to: dayIn(1, 1),
      months: 6,
      endMonth: '2026-09',
      label: '2026-04 – 2026-09',
    });
    // The caption's bounds are the series' own bounds, not a separate guess.
    expect(body.items[0]?.monthStart).toBe(body.range.from);
    expect(body.items[5]?.month).toBe('2026-09');
  });

  it('C3-06 anchors a historical trend with endMonth', async () => {
    await addTransaction({ type: 0, amountCents: 12_000, categoryId: FOOD, date: dayIn(-6, 10) });
    await addTransaction({ type: 0, amountCents: 500, categoryId: FOOD, date: dayIn(0, 10) });

    const body = (await get('/api/v1/stats/monthly-trend?months=3&endMonth=2026-03')) as TrendBody;

    expect(body.items.map((point) => point.month)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(body.range.endMonth).toBe('2026-03');
    expect(body.range.from).toBe(dayIn(-8, 1));
    expect(body.range.to).toBe(dayIn(-5, 1));
    expect(body.range.label).toBe('2026-01 – 2026-03');
    expect(body.items[2]?.netExpenseCents).toBe(12_000);
    // The current month is outside the anchored range and must not leak in.
    expect(body.items.every((point) => point.netExpenseCents !== 500)).toBe(true);
  });

  it('keeps the current-month behaviour when endMonth is omitted', async () => {
    await addTransaction({ type: 0, amountCents: 777, categoryId: FOOD, date: dayIn(0, 10) });

    const body = (await get('/api/v1/stats/monthly-trend?months=2')) as TrendBody;
    expect(body.items).toHaveLength(2);
    expect(body.range.endMonth).toBe('2026-09');
    expect(body.items[1]?.netExpenseCents).toBe(777);
  });

  it('clamps months around an anchored endMonth', async () => {
    const body = (await get('/api/v1/stats/monthly-trend?months=999&endMonth=2026-03')) as TrendBody;
    expect(body.items).toHaveLength(36);
    expect(body.range.endMonth).toBe('2026-03');
    expect(body.items[35]?.month).toBe('2026-03');
  });

  it('rejects an invalid endMonth', async () => {
    for (const endMonth of ['2026-13', 'abc', '2026-1', '2026-10-01']) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/stats/monthly-trend?endMonth=${endMonth}`,
        headers: authed(),
      });
      expect(response.statusCode, endMonth).toBe(400);
    }
  });

  it('states that income includes wages and refunds, without double counting', async () => {
    await addTransaction({ type: 0, amountCents: 100_000, categoryId: FOOD, date: dayIn(0, 8) });
    await addTransaction({
      type: 1,
      amountCents: 40_000,
      categoryId: REFUND,
      date: dayIn(0, 9),
      isRefund: true,
    });
    await addTransaction({ type: 1, amountCents: 300_000, categoryId: SALARY, date: dayIn(0, 5) });
    await recordSalary(1_000_000, dayIn(0, 6));

    const body = (await get('/api/v1/stats/monthly-trend?months=2')) as TrendBody;
    const current = body.items[1] as TrendPointBody;

    // 40,000 refund + 300,000 income transaction + 1,000,000 recorded salary.
    expect(current.incomeCents).toBe(1_340_000);
    expect(current.refundIncomeCents).toBe(40_000);
    expect(current.salaryIncomeCents).toBe(1_000_000);
    // The parts are already inside the total, not extra income.
    expect(current.refundIncomeCents + current.salaryIncomeCents).toBeLessThanOrEqual(
      current.incomeCents,
    );
    // 支出 stays gross: the refund is income, never a deduction.
    expect(current.netExpenseCents).toBe(100_000);
  });
});

// ---------------------------------------------------------------------------
// guard
// ---------------------------------------------------------------------------

describe('stats routes are protected', () => {
  it('rejects every endpoint without a session', async () => {
    for (const url of [
      '/api/v1/stats/window',
      '/api/v1/stats/category-share',
      '/api/v1/stats/monthly-trend',
      '/api/v1/stats/pool-trend',
      '/api/v1/stats/range',
      '/api/v1/stats/month-window',
    ]) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(401);
    }
  });
});
