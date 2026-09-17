/**
 * T8 acceptance tests: category share, monthly trend, and the pool series.
 *
 * The load-bearing assertions are the accounting ones (parent task AC5):
 *   * a refund reduces net expense and NEVER counts as income;
 *   * a category whose refunds cancel its spending nets to zero;
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
 */
async function recordSalary(amountCents: number, date: number): Promise<void> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/salaries',
    headers: authed(),
    payload: { accountId: ACCOUNT, amountCents, date },
  });
  expect(response.statusCode, JSON.stringify({ amountCents, date })).toBe(201);
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
    const julySalary = await app.inject({
      method: 'POST',
      url: '/api/v1/salaries',
      headers: authed(),
      payload: { accountId: ACCOUNT, amountCents: 1_000_000, date: dayIn(-2, 5) },
    });
    expect(julySalary.statusCode).toBe(201);

    await addTransaction({ type: 0, amountCents: 550_000, categoryId: FOOD, date: dayIn(-2, 10) });

    // September cycle becomes current, closing July.
    const septemberSalary = await app.inject({
      method: 'POST',
      url: '/api/v1/salaries',
      headers: authed(),
      payload: { accountId: ACCOUNT, amountCents: 1_000_000, date: dayIn(0, 5) },
    });
    expect(septemberSalary.statusCode).toBe(201);

    const trend = await get('/api/v1/stats/pool-trend');
    const overview = await get('/api/v1/budget/overview');

    expect(trend.points.length).toBeGreaterThan(0);
    expect(trend.points[trend.points.length - 1].poolCents).toBe(trend.currentCents);
    // This is the contract from the reference project (charts_data_test.dart:416).
    expect(trend.currentCents).toBe(overview.carryoverPoolCents);
  });

  it('an overspent single-module cycle drives the pool negative', async () => {
    const template = await app.inject({
      method: 'POST',
      url: '/api/v1/templates',
      headers: authed(),
      payload: { name: '单模块', modules: [{ categoryId: FOOD, ratio: 1 }] },
    });
    expect(template.statusCode).toBe(201);
    const templateId = template.json().id as string;

    const salary = await app.inject({
      method: 'POST',
      url: '/api/v1/salaries',
      headers: authed(),
      payload: { accountId: ACCOUNT, amountCents: 100_000, date: dayIn(0, 2), templateId },
    });
    expect(salary.statusCode).toBe(201);
    expect(salary.json().allocations).toEqual([
      { categoryId: FOOD, amountCents: 100_000 },
    ]);

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
      await app.inject({
        method: 'POST',
        url: '/api/v1/salaries',
        headers: authed(),
        payload: { accountId: ACCOUNT, amountCents: 500_000, date: dayIn(offset, 5) },
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
// guard
// ---------------------------------------------------------------------------

describe('stats routes are protected', () => {
  it('rejects every endpoint without a session', async () => {
    for (const url of [
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
