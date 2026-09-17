/**
 * T6 acceptance tests: salary recording, allocation arithmetic, template validation,
 * cycle-start-day settings, and the budget overview endpoint.
 *
 * The allocation rules are the reference implementation's, transcribed and
 * machine-verified in `research/reference-project-rules.md` §10: every module but
 * the last is `round(total × ratio)`, the last absorbs the remainder, and the parts
 * must add up to exactly the salary.
 */
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RATIO_SUM_TOLERANCE, SEED_TEMPLATE } from '@jizhang/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { closeDatabase, initializeDatabase, type Db } from '../src/db/index.js';
import { SESSION_COOKIE } from '../src/plugins/auth.js';
import { AuthService } from '../src/services/auth-service.js';
import {
  CYCLE_START_DAY_KEY,
  MAX_CYCLE_START_DAY,
  MIN_CYCLE_START_DAY,
  SalaryService,
  parseAllocationsJson,
} from '../src/services/salary-service.js';
import {
  TemplateService,
  parseModulesJson,
  validateModules,
} from '../src/services/template-service.js';

const USERNAME = 'quiz';
const PASSWORD = 'correct horse battery staple';
const CSRF = { 'x-requested-with': 'fetch' } as const;

const NOW = Date.UTC(2026, 8, 11, 12, 0, 0);
const AUG = (day: number) => Date.UTC(2026, 7, day);

const FOOD = 'builtin-expense-food';
const TRANSPORT = 'builtin-expense-transport';
const SHOPPING = 'builtin-expense-shopping';
const REFUND = 'builtin-income-refund';
const DEFAULT_TEMPLATE = 'builtin-default-template';
/** Every salary must name the account that received it; these tests use the seeded one. */
const ACCOUNT = 'builtin-default-account';

let db: Db;
let app: FastifyInstance;
let cookie: string;
let salaries: SalaryService;
let templates: TemplateService;
let clock = NOW;

async function login(): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: CSRF,
    payload: { username: USERNAME, password: PASSWORD },
  });
  return (response.cookies as { name: string; value: string }[]).find(
    (c) => c.name === SESSION_COOKIE,
  )?.value as string;
}

function authed() {
  return { ...CSRF, Cookie: `${SESSION_COOKIE}=${cookie}` };
}

async function post(url: string, payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url, headers: authed(), payload });
}

async function get(url: string) {
  return app.inject({ method: 'GET', url, headers: authed() });
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

  salaries = new SalaryService(db, { now: () => clock });
  templates = new TemplateService(db, { now: () => clock });
  cookie = await login();
});

afterEach(async () => {
  await app.close();
  closeDatabase(db);
});

// ---------------------------------------------------------------------------
// Seeded template
// ---------------------------------------------------------------------------

describe('seeded template', () => {
  it('exists, is the default, and its ratios sum to exactly 1', () => {
    const template = templates.getById(DEFAULT_TEMPLATE);
    expect(template).toBeDefined();
    expect(template?.isDefault).toBe(true);

    const sum = template?.modules.reduce((total, m) => total + m.ratio, 0) ?? 0;
    expect(sum).toBe(1);
    expect(template?.modules).toHaveLength(SEED_TEMPLATE.modules.length);
  });

  it('keeps the reference implementation module order (the last absorbs rounding)', () => {
    const template = templates.getById(DEFAULT_TEMPLATE);
    expect(template?.modules.map((m) => m.categoryId)).toEqual(
      SEED_TEMPLATE.modules.map((m) => m.categoryId),
    );
  });

  it('parses a malformed modules_json as an empty list instead of throwing', () => {
    expect(parseModulesJson('not json')).toEqual([]);
    expect(parseModulesJson('{"a":1}')).toEqual([]);
    expect(parseModulesJson(null)).toEqual([]);
    expect(parseModulesJson('[{"categoryId":"x","ratio":0.5},{"ratio":0.5}]')).toEqual([
      { categoryId: 'x', ratio: 0.5 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// AC1/AC3 allocation arithmetic
// ---------------------------------------------------------------------------

describe('AC1/AC3 allocation arithmetic', () => {
  it('AC1 10000 yuan over the 40/10/25/10/5/10 template', () => {
    const created = salaries.create({ accountId: ACCOUNT, amountCents: 1_000_000, date: AUG(5) });
    const byCategory = new Map(
      created.allocations.map((a) => [a.categoryId, a.amountCents]),
    );

    // 40 / 10 / 25 / 10 / 5 / 10 percent of 1,000,000 cents.
    expect(byCategory.get(FOOD)).toBe(400_000);
    expect(byCategory.get(TRANSPORT)).toBe(100_000);
    expect(byCategory.get(SHOPPING)).toBe(100_000);
    expect(created.amountCents).toBe(1_000_000);
  });

  it('AC3 the parts always add up to exactly the salary', () => {
    for (const amountCents of [1_000_000, 100_003, 101, 999_999, 7]) {
      const created = salaries.create({ accountId: ACCOUNT, amountCents, date: AUG(5) });
      const sum = created.allocations.reduce((total, a) => total + a.amountCents, 0);
      expect(sum, `salary ${amountCents}`).toBe(amountCents);
    }
  });

  it('AC3 the LAST module in template order absorbs the rounding remainder', () => {
    // 101 cents over 0.33/0.33/0.34 -> 33 / 33 / 35 (last absorbs +2).
    const template = templates.create(
      'thirds',
      [
        { categoryId: FOOD, ratio: 0.33 },
        { categoryId: TRANSPORT, ratio: 0.33 },
        { categoryId: SHOPPING, ratio: 0.34 },
      ],
      true,
    );

    const created = salaries.create({
      accountId: ACCOUNT,
      amountCents: 101,
      date: AUG(5),
      templateId: template.id,
    });

    expect(created.allocations.map((a) => a.amountCents)).toEqual([33, 33, 35]);
    expect(created.allocations[created.allocations.length - 1]?.categoryId).toBe(SHOPPING);
  });

  it('AC1 10000 yuan over an even 33/33/34 template', () => {
    const template = templates.create(
      'even',
      [
        { categoryId: FOOD, ratio: 0.33 },
        { categoryId: TRANSPORT, ratio: 0.33 },
        { categoryId: SHOPPING, ratio: 0.34 },
      ],
      true,
    );
    const created = salaries.create({
      accountId: ACCOUNT,
      amountCents: 1_000_000,
      date: AUG(5),
      templateId: template.id,
    });
    expect(created.allocations.map((a) => a.amountCents)).toEqual([330_000, 330_000, 340_000]);
  });

  it('AC2 an explicit allocation wins over the template', () => {
    const created = salaries.create({
      accountId: ACCOUNT,
      amountCents: 1_000_000,
      date: AUG(5),
      allocations: [
        { categoryId: FOOD, amountCents: 600_000 },
        { categoryId: TRANSPORT, amountCents: 400_000 },
      ],
    });

    const byCategory = new Map(
      created.allocations.map((a) => [a.categoryId, a.amountCents]),
    );
    expect(byCategory.get(FOOD)).toBe(600_000);
    expect(byCategory.get(TRANSPORT)).toBe(400_000);
    // The template's other modules must NOT have been added on top.
    expect(created.allocations).toHaveLength(2);
  });

  it('rejects an explicit allocation that does not add up', () => {
    expect(() =>
      salaries.create({
        accountId: ACCOUNT,
        amountCents: 1_000_000,
        date: AUG(5),
        allocations: [{ categoryId: FOOD, amountCents: 900_000 }],
      }),
    ).toThrow(/Undistributed 100000 cents/);

    expect(() =>
      salaries.create({
        accountId: ACCOUNT,
        amountCents: 1_000_000,
        date: AUG(5),
        allocations: [{ categoryId: FOOD, amountCents: 1_100_000 }],
      }),
    ).toThrow(/exceeds the salary/);
  });

  it('rejects a non-integer or non-positive salary', () => {
    for (const amountCents of [1000.5, 0, -1000, '1000']) {
      expect(() => salaries.create({ accountId: ACCOUNT, amountCents, date: AUG(5) }), String(amountCents)).toThrow();
    }
  });

  it('rejects an allocation referencing an unknown category', () => {
    expect(() =>
      salaries.create({
        accountId: ACCOUNT,
        amountCents: 100,
        date: AUG(5),
        allocations: [{ categoryId: 'nope', amountCents: 100 }],
      }),
    ).toThrow(/Unknown or deleted category/);
  });

  it('rejects a future salary date', () => {
    expect(() => salaries.create({ accountId: ACCOUNT, amountCents: 100, date: NOW + 30 * 86_400_000 })).toThrow(
      /future/,
    );
  });
});

// ---------------------------------------------------------------------------
// AC4/AC5 template validation
// ---------------------------------------------------------------------------

describe('AC4/AC5 template validation', () => {
  it('AC4 rejects ratios that do not sum to 100%', () => {
    expect(() =>
      templates.create('bad', [
        { categoryId: FOOD, ratio: 0.4 },
        { categoryId: TRANSPORT, ratio: 0.3 },
        { categoryId: SHOPPING, ratio: 0.2 },
      ]),
    ).toThrow(/add up to 100%/);
  });

  it('AC4 accepts a ratio sum inside the 1e-4 tolerance', () => {
    // 0.33333 × 3 = 0.99999, which is within RATIO_SUM_TOLERANCE.
    expect(RATIO_SUM_TOLERANCE).toBe(0.0001);
    const created = templates.create('thirds', [
      { categoryId: FOOD, ratio: 0.33333 },
      { categoryId: TRANSPORT, ratio: 0.33333 },
      { categoryId: SHOPPING, ratio: 0.33333 },
    ]);
    expect(created.modules).toHaveLength(3);
  });

  it('AC5 rejects a repeated category', () => {
    expect(() =>
      templates.create('dup', [
        { categoryId: FOOD, ratio: 0.5 },
        { categoryId: FOOD, ratio: 0.5 },
      ]),
    ).toThrow(/more than once/);
  });

  it('rejects a non-positive or non-finite ratio', () => {
    for (const ratio of [0, -0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        templates.create('bad', [
          { categoryId: FOOD, ratio },
          { categoryId: TRANSPORT, ratio: 1 - ratio },
        ]),
      ).toThrow();
    }
  });

  it('rejects an empty module list and a blank name', () => {
    expect(() => templates.create('empty', [])).toThrow(/at least one module/);
    expect(() =>
      templates.create('  ', [{ categoryId: FOOD, ratio: 1 }]),
    ).toThrow(/needs a name/);
  });

  it('validateModules can check category existence', () => {
    expect(() =>
      validateModules([{ categoryId: 'ghost', ratio: 1 }], {
        assertCategoryUsable: (id) => {
          if (id === 'ghost') throw new Error('unknown');
        },
      }),
    ).toThrow('unknown');
  });

  it('AC9 only one template is the default at a time', () => {
    templates.create(
      'second',
      [
        { categoryId: FOOD, ratio: 0.6 },
        { categoryId: TRANSPORT, ratio: 0.4 },
      ],
      true,
    );

    const defaults = templates.list().filter((t) => t.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.name).toBe('second');
  });

  it('AC9 the seeded default can be restored', () => {
    templates.create(
      'second',
      [
        { categoryId: FOOD, ratio: 0.6 },
        { categoryId: TRANSPORT, ratio: 0.4 },
      ],
      true,
    );
    templates.setDefault(DEFAULT_TEMPLATE);

    expect(templates.getDefault()?.id).toBe(DEFAULT_TEMPLATE);
    expect(templates.list().filter((t) => t.isDefault)).toHaveLength(1);
  });

  it('the default template cannot be deleted', () => {
    expect(() => templates.softDelete(DEFAULT_TEMPLATE)).toThrow(/cannot be deleted/);
  });

  it('a non-default template can be deleted and disappears from the list', () => {
    const created = templates.create('temp', [
      { categoryId: FOOD, ratio: 0.5 },
      { categoryId: TRANSPORT, ratio: 0.5 },
    ]);
    templates.softDelete(created.id);
    expect(templates.list().some((t) => t.id === created.id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC6 salary delete cascades
// ---------------------------------------------------------------------------

describe('AC6 deleting a salary removes its allocation', () => {
  it('soft-deletes both rows', () => {
    const created = salaries.create({ accountId: ACCOUNT, amountCents: 1_000_000, date: AUG(5) });

    salaries.softDelete(created.id);

    const row = db
      .prepare('SELECT deleted FROM salary_records WHERE id = ?')
      .get(created.id) as { deleted: number };
    expect(row.deleted).toBe(1);

    const allocation = db
      .prepare('SELECT deleted FROM budget_allocations WHERE salary_record_id = ?')
      .get(created.id) as { deleted: number };
    expect(allocation.deleted).toBe(1);

    expect(salaries.getById(created.id)).toBeUndefined();
  });

  it('leaves the budget overview empty after the only salary is deleted', async () => {
    const created = salaries.create({ accountId: ACCOUNT, amountCents: 1_000_000, date: AUG(5) });

    const before = await get('/api/v1/budget/overview');
    expect(before.json().hasBudget).toBe(true);

    await app.inject({
      method: 'DELETE',
      url: `/api/v1/salaries/${created.id}`,
      headers: authed(),
    });

    const after = await get('/api/v1/budget/overview');
    expect(after.json().hasBudget).toBe(false);
    expect(after.json().carryoverPoolCents).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// update semantics
// ---------------------------------------------------------------------------

describe('salary update', () => {
  it('rejects an amount change without explicit balanced allocations and preserves manual tuning', () => {
    const created = salaries.create({
      accountId: ACCOUNT,
      amountCents: 1_000_000,
      date: AUG(5),
      allocations: [
        { categoryId: FOOD, amountCents: 700_000 },
        { categoryId: TRANSPORT, amountCents: 300_000 },
      ],
    });
    expect(() => salaries.update(created.id, { amountCents: 2_000_000 })).toThrow(/allocation/i);
    expect(salaries.getByIdOrThrow(created.id)).toEqual(created);
  });

  it('atomically updates salary amount, date and explicit allocations over the API', async () => {
    const created = salaries.create({ accountId: ACCOUNT, amountCents: 1_000_000, date: AUG(5) });
    const date = new Date(2026, 8, 5).getTime();
    const allocations = [{ categoryId: FOOD, amountCents: 1_500_000 }, { categoryId: TRANSPORT, amountCents: 500_000 }];
    const response = await app.inject({ method: 'PATCH', url: `/api/v1/salaries/${created.id}`, headers: authed(), payload: { amountCents: 2_000_000, date, allocations } });
    expect(response.statusCode).toBe(200);
    expect(response.json().allocations).toEqual(allocations);
    expect(salaries.getAllocationRow(created.id)?.date).toBe(date);
    const overview = await get('/api/v1/budget/overview');
    expect(overview.json().totalBudgetCents).toBe(2_000_000);
    expect((await get('/api/v1/budget/periods')).json().periods).toEqual([date]);
  });

  it('rejects an unbalanced update without changing the salary, date, note or snapshot', async () => {
    const created = salaries.create({ accountId: ACCOUNT, amountCents: 1_000_000, date: AUG(5), note: 'original' });
    const before = salaries.getAllocationRow(created.id);
    const response = await app.inject({ method: 'PATCH', url: `/api/v1/salaries/${created.id}`, headers: authed(), payload: { amountCents: 2_000_000, date: AUG(20), note: 'changed', allocations: [{ categoryId: FOOD, amountCents: 1 }] } });
    expect(response.statusCode).toBe(400);
    expect(salaries.getByIdOrThrow(created.id)).toEqual(created);
    expect(salaries.getAllocationRow(created.id)).toEqual(before);
  });

  it('moves the allocation date with the salary without recomputing manual amounts', () => {
    const created = salaries.create({ accountId: ACCOUNT, amountCents: 1_000_000, date: AUG(5) });
    salaries.update(created.id, { date: AUG(20) });
    expect(salaries.getAllocationRow(created.id)?.date).toBe(AUG(20));
    expect(salaries.getByIdOrThrow(created.id).allocations).toEqual(created.allocations);
  });

  it('rolls back the salary when the allocation write fails', () => {
    const created = salaries.create({ accountId: ACCOUNT, amountCents: 1_000_000, date: AUG(5) });
    db.exec("CREATE TRIGGER fail_allocation BEFORE UPDATE ON budget_allocations BEGIN SELECT RAISE(ABORT, 'allocation write failed'); END");
    expect(() => salaries.update(created.id, { date: AUG(20) })).toThrow(/allocation write failed/);
    expect(salaries.getByIdOrThrow(created.id)).toEqual(created);
  });

  it('replaces the allocation on explicit request', () => {
    const created = salaries.create({ accountId: ACCOUNT, amountCents: 1_000_000, date: AUG(5) });

    const replaced = salaries.replaceAllocations(created.id, [
      { categoryId: FOOD, amountCents: 1_000_000 },
    ]);

    expect(replaced.allocations).toEqual([{ categoryId: FOOD, amountCents: 1_000_000 }]);
  });

  it('rejects a replacement that does not add up', () => {
    const created = salaries.create({ accountId: ACCOUNT, amountCents: 1_000_000, date: AUG(5) });
    expect(() =>
      salaries.replaceAllocations(created.id, [{ categoryId: FOOD, amountCents: 1 }]),
    ).toThrow(/Undistributed/);
  });

  it('tolerates a malformed stored allocation', () => {
    expect(parseAllocationsJson('not json')).toEqual([]);
    expect(parseAllocationsJson('[{"categoryId":"x","amountCents":1.5}]')).toEqual([]);
    expect(parseAllocationsJson('[{"categoryId":"x","amountCents":50}]')).toEqual([
      { categoryId: 'x', amountCents: 50 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// AC7 cycle start day
// ---------------------------------------------------------------------------

describe('AC7 cycle start day setting', () => {
  it('defaults to natural-month (no setting)', async () => {
    const response = await get('/api/v1/settings');
    expect(response.json()).toMatchObject({ cycleStartDay: null, key: CYCLE_START_DAY_KEY });
    expect(salaries.getCycleStartDay()).toBeUndefined();
  });

  it('accepts 1 and 28, rejects 0 and 29', async () => {
    for (const day of [MIN_CYCLE_START_DAY, 15, MAX_CYCLE_START_DAY]) {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/settings',
        headers: authed(),
        payload: { cycleStartDay: day },
      });
      expect(response.statusCode, String(day)).toBe(200);
      expect(salaries.getCycleStartDay()).toBe(day);
    }

    for (const day of [0, 29, -1, 100]) {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/v1/settings',
        headers: authed(),
        payload: { cycleStartDay: day },
      });
      expect(response.statusCode, String(day)).toBe(400);
    }
  });

  it('clearing it returns to natural-month mode', async () => {
    salaries.setCycleStartDay(15);
    expect(salaries.getCycleStartDay()).toBe(15);

    salaries.setCycleStartDay(null);
    expect(salaries.getCycleStartDay()).toBeUndefined();

    const response = await get('/api/v1/settings');
    expect(response.json().cycleStartDay).toBeNull();
  });

  it('a stored out-of-range value reads back as unset rather than being trusted', () => {
    db.prepare(
      'INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)',
    ).run(CYCLE_START_DAY_KEY, JSON.stringify({ day: 99 }), NOW);
    expect(salaries.getCycleStartDay()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AC11 budget overview
// ---------------------------------------------------------------------------

describe('AC11 budget overview', () => {
  it('reports no budget before any salary is recorded', async () => {
    const response = await get('/api/v1/budget/overview');
    const body = response.json();
    expect(body.hasBudget).toBe(false);
    expect(body.modules).toEqual([]);
    expect(body.carryoverPoolCents).toBe(0);
  });

  it('returns module views with names, totals and the pool', async () => {
    salaries.create({ accountId: ACCOUNT, amountCents: 1_000_000, date: AUG(5) });

    const response = await get('/api/v1/budget/overview');
    const body = response.json();

    expect(body.hasBudget).toBe(true);
    expect(body.totalBudgetCents).toBe(1_000_000);
    expect(body.modules.length).toBeGreaterThan(0);

    const food = body.modules.find((m: { categoryId: string }) => m.categoryId === FOOD);
    expect(food.categoryName).toBe('餐饮');
    expect(food.budgetCents).toBe(400_000);
    expect(food.spentCents).toBe(0);
    expect(food.remainingCents).toBe(400_000);
  });

  it('subtracts a spent expense from the matching module', async () => {
    salaries.create({ accountId: ACCOUNT, amountCents: 1_000_000, date: AUG(5) });

    await post('/api/v1/transactions', {
      type: 0,
      amountCents: 150_000,
      categoryId: FOOD,
      accountId: 'builtin-default-account',
      date: AUG(10),
    });

    const body = (await get('/api/v1/budget/overview')).json();
    const food = body.modules.find((m: { categoryId: string }) => m.categoryId === FOOD);
    expect(food.spentCents).toBe(150_000);
    expect(food.remainingCents).toBe(250_000);
  });

  it('a refund no longer reduces the module spend (it is income now)', async () => {
    salaries.create({ accountId: ACCOUNT, amountCents: 1_000_000, date: AUG(5) });

    await post('/api/v1/transactions', {
      type: 0,
      amountCents: 150_000,
      categoryId: FOOD,
      accountId: 'builtin-default-account',
      date: AUG(10),
    });
    await post('/api/v1/transactions', {
      type: 1,
      amountCents: 50_000,
      categoryId: REFUND,
      accountId: 'builtin-default-account',
      date: AUG(11),
      isRefund: true,
    });

    const body = (await get('/api/v1/budget/overview')).json();
    // Spend is gross: the refund does not reduce the module spend.
    const food = body.modules.find((m: { categoryId: string }) => m.categoryId === FOOD);
    expect(food.spentCents).toBe(150_000);
  });

  it('an overspend makes the pool negative', async () => {
    salaries.create({ accountId: ACCOUNT, amountCents: 1_000_000, date: AUG(5) });

    await post('/api/v1/transactions', {
      type: 0,
      amountCents: 500_000,
      categoryId: FOOD,
      accountId: 'builtin-default-account',
      date: AUG(10),
    });

    const body = (await get('/api/v1/budget/overview')).json();
    // food budgeted 400,000; spent 500,000 -> 100,000 borrowed from the pool.
    expect(body.carryoverPoolCents).toBe(-100_000);
  });

  it('honours the configured cycle start day', async () => {
    salaries.setCycleStartDay(10);
    salaries.create({ accountId: ACCOUNT, amountCents: 1_000_000, date: AUG(15) });

    // Before the boundary: belongs to the previous cycle, so not counted.
    await post('/api/v1/transactions', {
      type: 0,
      amountCents: 90_000,
      categoryId: FOOD,
      accountId: 'builtin-default-account',
      date: AUG(5),
    });
    // After the boundary: counted.
    await post('/api/v1/transactions', {
      type: 0,
      amountCents: 30_000,
      categoryId: FOOD,
      accountId: 'builtin-default-account',
      date: AUG(12),
    });

    const body = (await get('/api/v1/budget/overview')).json();
    expect(body.cycle).toEqual({ kind: 'start-day', day: 10 });
    const food = body.modules.find((m: { categoryId: string }) => m.categoryId === FOOD);
    expect(food.spentCents).toBe(30_000);
  });

  it('two salaries in the same month merge their module budgets', async () => {
    salaries.create({ accountId: ACCOUNT, amountCents: 1_000_000, date: AUG(5) });
    salaries.create({ accountId: ACCOUNT, amountCents: 500_000, date: AUG(20) });

    const body = (await get('/api/v1/budget/overview')).json();
    const food = body.modules.find((m: { categoryId: string }) => m.categoryId === FOOD);
    // 400,000 + 200,000
    expect(food.budgetCents).toBe(600_000);
    expect(body.totalBudgetCents).toBe(1_500_000);
  });
});

// ---------------------------------------------------------------------------
// Historical cycle review — T14
// ---------------------------------------------------------------------------
//
// Every fixture here spans TWO cycles. A single-cycle fixture cannot catch a wrong
// period key: it would agree with the current-cycle path by construction.
//
// The cycle identifier is the engine's own `group.start` — for `natural-month` that is
// `dateOnly` (LOCAL midnight) of the EARLIEST SALARY DAY in the month, not the 1st. These
// tests never hard-code it: they read it back from `/api/v1/budget/periods`, which is the
// same value the UI would send. Hard-coding an epoch would encode the machine's timezone
// into the expectation and pass or fail depending on where it runs.

/** The cycle starts the server reports, ascending. */
async function listPeriods(): Promise<number[]> {
  return (await get('/api/v1/budget/periods')).json().periods as number[];
}

/**
 * A LOCAL-midnight date in 2026.
 *
 * Salaries and transactions only need a date that lands in the intended cycle, and the
 * localStorage cycle maths is local, so a local anchor keeps the fixture honest wherever
 * the suite runs. (Assertions about the reported `periodStart` still read the value back
 * from the API rather than recomputing it.)
 */
const localDay = (month1: number, day: number) => new Date(2026, month1 - 1, day).getTime();
const JUL = (day: number) => localDay(7, day);

describe('T14 GET /api/v1/budget/periods', () => {
  it('AC5 lists every cycle, ascending, with the current one last', async () => {
    salaries.create({ accountId: ACCOUNT, amountCents: 1_000_000, date: JUL(3) });
    salaries.create({ accountId: ACCOUNT, amountCents: 1_000_000, date: AUG(5) });

    const body = (await get('/api/v1/budget/periods')).json();

    expect(body.periods).toHaveLength(2);
    // Ascending, and the current one is the newest.
    expect(body.periods[0]).toBeLessThan(body.periods[1]);
    expect(body.currentPeriodStart).toBe(body.periods[1]);
    expect(body.cycle).toEqual({ kind: 'natural-month' });

    // The start is the earliest salary day in the month, NOT the first of the month.
    const firstOfJuly = new Date(2026, 6, 1).getTime();
    expect(body.periods[0]).not.toBe(firstOfJuly);
    expect(new Date(body.periods[0] as number).getDate()).toBe(3);
  });

  it('AC5 an empty ledger reports no periods at all', async () => {
    const body = (await get('/api/v1/budget/periods')).json();

    // The view hides or disables the switcher on this, rather than showing an empty one.
    expect(body.periods).toEqual([]);
    expect(body.currentPeriodStart).toBeNull();
  });

  it('AC5 the period list agrees with the pool-trend series', async () => {
    salaries.create({ accountId: ACCOUNT, amountCents: 1_000_000, date: JUL(3) });
    salaries.create({ accountId: ACCOUNT, amountCents: 1_000_000, date: AUG(5) });

    const periods = await listPeriods();
    const trend = (await get('/api/v1/stats/pool-trend')).json().points as {
      periodStart: number;
    }[];

    // The anti-drift assertion: both must come from the same grouping.
    expect(periods).toEqual(trend.map((point) => point.periodStart));
  });

  it('requires a session', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/budget/periods' });

    expect(response.statusCode).toBe(401);
  });
});

describe('T14 budget overview for a historical cycle', () => {
  /** July: 300,000 food / 200,000 transport spending 200,000. August: 400,000 food. */
  async function twoCycles(): Promise<{ july: number; august: number }> {
    const july = await post('/api/v1/salaries', {
      accountId: ACCOUNT,
      amountCents: 500_000,
      date: JUL(3),
      allocations: [
        { categoryId: FOOD, amountCents: 300_000 },
        { categoryId: TRANSPORT, amountCents: 200_000 },
      ],
    });
    expect(july.statusCode, july.body).toBe(201);

    const august = await post('/api/v1/salaries', {
      accountId: ACCOUNT,
      amountCents: 1_000_000,
      date: AUG(5),
      allocations: [
        { categoryId: FOOD, amountCents: 400_000 },
        { categoryId: TRANSPORT, amountCents: 600_000 },
      ],
    });
    expect(august.statusCode, august.body).toBe(201);

    for (const [amountCents, date] of [
      [200_000, new Date(2026, 6, 12).getTime()],
      [120_000, new Date(2026, 7, 10).getTime()],
    ] as const) {
      const created = await post('/api/v1/transactions', {
        type: 0,
        amountCents,
        categoryId: FOOD,
        accountId: 'builtin-default-account',
        date,
      });
      expect(created.statusCode, created.body).toBe(201);
    }

    const periods = await listPeriods();
    expect(periods).toHaveLength(2);
    return { july: periods[0] as number, august: periods[1] as number };
  }

  it('AC1 reviewing July returns July figures, not August renamed', async () => {
    const { july } = await twoCycles();

    const current = (await get('/api/v1/budget/overview')).json();
    const historical = (await get(`/api/v1/budget/overview?periodStart=${july}`)).json();

    expect(historical.totalBudgetCents).toBe(500_000);
    expect(historical.totalSpentCents).toBe(200_000);
    expect(
      historical.modules.find((m: { categoryId: string }) => m.categoryId === FOOD).budgetCents,
    ).toBe(300_000);
    // The proof it is a different cycle rather than a relabelled copy.
    expect(historical.totalBudgetCents).not.toBe(current.totalBudgetCents);
    expect(historical.totalSpentCents).not.toBe(current.totalSpentCents);
  });

  it('AC1 spending from the neighbouring cycle does not leak in', async () => {
    const { july } = await twoCycles();

    const historical = (await get(`/api/v1/budget/overview?periodStart=${july}`)).json();

    // July's food spend is 200,000; August's 120,000 must not be added to it.
    expect(
      historical.modules.find((m: { categoryId: string }) => m.categoryId === FOOD).spentCents,
    ).toBe(200_000);
  });

  it('AC2 an overspent historical module is reported negative, not clamped', async () => {
    salaries.create({ accountId: ACCOUNT, amountCents: 500_000, date: JUL(3) });
    salaries.create({ accountId: ACCOUNT, amountCents: 1_000_000, date: AUG(5) });
    // Spend more than July's food budget.
    await post('/api/v1/transactions', {
      type: 0,
      amountCents: 900_000,
      categoryId: FOOD,
      accountId: 'builtin-default-account',
      date: new Date(2026, 6, 12).getTime(),
    });

    const periods = await listPeriods();
    const historical = (await get(`/api/v1/budget/overview?periodStart=${periods[0]}`)).json();
    const food = historical.modules.find((m: { categoryId: string }) => m.categoryId === FOOD);

    expect(food.remainingCents).toBeLessThan(0);
  });

  it('AC3 an unknown period is rejected, never silently the current cycle', async () => {
    await twoCycles();

    const unknown = await get(
      `/api/v1/budget/overview?periodStart=${new Date(2020, 0, 1).getTime()}`,
    );

    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().error.code).toBe('VALIDATION');
    expect(unknown.json().error.message).toMatch(/unknown budget period/i);
  });

  it('AC3 a non-integer period is rejected', async () => {
    const response = await get('/api/v1/budget/overview?periodStart=abc');

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION');
  });

  it('AC4 an empty periodStart means the current cycle, as if omitted', async () => {
    await twoCycles();

    const omitted = (await get('/api/v1/budget/overview')).json();
    const empty = (await get('/api/v1/budget/overview?periodStart=')).json();

    expect(empty).toEqual(omitted);
  });

  it('AC4 asking explicitly for the newest period equals omitting it', async () => {
    const { august } = await twoCycles();

    const omitted = (await get('/api/v1/budget/overview')).json();
    const explicit = (await get(`/api/v1/budget/overview?periodStart=${august}`)).json();

    // Field-for-field, not just totals: the pool included. This is the invariant that
    // proves the new parameter did not fork the default code path.
    expect(explicit).toEqual(omitted);
  });

  it('a timestamp with a time of day still matches its cycle', async () => {
    const { july } = await twoCycles();

    const withTime = (
      await get(`/api/v1/budget/overview?periodStart=${july + 13 * 3_600_000}`)
    ).json();
    const midnight = (await get(`/api/v1/budget/overview?periodStart=${july}`)).json();

    // `group.start` is date-normalised inside the engine, so the request must be too.
    expect(withTime).toEqual(midnight);
  });

  it('honours a configured cycle start day when reviewing the past', async () => {
    // Cycle starts on the 15th: 7/15–8/14 and 8/15–9/14.
    salaries.setCycleStartDay(15);
    const previous = await post('/api/v1/salaries', {
      accountId: ACCOUNT,
      amountCents: 500_000,
      date: new Date(2026, 6, 20).getTime(),
      allocations: [{ categoryId: FOOD, amountCents: 500_000 }],
    });
    expect(previous.statusCode, previous.body).toBe(201);
    const current = await post('/api/v1/salaries', {
      accountId: ACCOUNT,
      amountCents: 500_000,
      date: new Date(2026, 7, 20).getTime(),
      allocations: [{ categoryId: FOOD, amountCents: 500_000 }],
    });
    expect(current.statusCode, current.body).toBe(201);

    for (const [amountCents, date] of [
      [50_000, new Date(2026, 7, 10).getTime()],
      [70_000, new Date(2026, 7, 16).getTime()],
    ] as const) {
      await post('/api/v1/transactions', {
        type: 0,
        amountCents,
        categoryId: FOOD,
        accountId: 'builtin-default-account',
        date,
      });
    }

    const periods = await listPeriods();
    expect(periods).toHaveLength(2);
    // With start-day mode the period key IS the configured boundary.
    expect(new Date(periods[0] as number).getDate()).toBe(15);

    const historical = (await get(`/api/v1/budget/overview?periodStart=${periods[0]}`)).json();

    // Only the transaction inside [7/15, 8/15) counts; the 8/16 one belongs to the next
    // cycle. This is what proves a historical window is bounded by the next cycle rather
    // than left open-ended.
    expect(
      historical.modules.find((m: { categoryId: string }) => m.categoryId === FOOD).spentCents,
    ).toBe(50_000);
  });
});

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

describe('budget routes are protected', () => {
  it('rejects every endpoint without a session', async () => {
    const attempts = [
      { method: 'GET' as const, url: '/api/v1/budget/overview' },
      { method: 'GET' as const, url: '/api/v1/salaries' },
      { method: 'GET' as const, url: '/api/v1/salaries/x' },
      { method: 'GET' as const, url: '/api/v1/templates' },
      { method: 'GET' as const, url: '/api/v1/settings' },
      { method: 'POST' as const, url: '/api/v1/salaries', headers: CSRF },
      { method: 'POST' as const, url: '/api/v1/templates', headers: CSRF },
      { method: 'PUT' as const, url: '/api/v1/settings', headers: CSRF },
    ];

    for (const attempt of attempts) {
      const response = await app.inject(attempt);
      expect(response.statusCode, `${attempt.method} ${attempt.url}`).toBe(401);
    }
  });

  it('requires the CSRF header on writes when signed in', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/salaries',
      headers: { Cookie: `${SESSION_COOKIE}=${cookie}` },
      payload: { accountId: ACCOUNT, amountCents: 1000, date: AUG(5) },
    });
    expect(response.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

describe('cleanup', () => {
  it('leaves no stray default templates after create-then-delete', () => {
    const created = templates.create('temp', [
      { categoryId: FOOD, ratio: 0.5 },
      { categoryId: TRANSPORT, ratio: 0.5 },
    ]);
    templates.softDelete(created.id);
    expect(templates.list().filter((t) => t.isDefault)).toHaveLength(1);
  });
});
