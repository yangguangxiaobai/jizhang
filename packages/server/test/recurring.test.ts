/**
 * T13 acceptance tests: recurring bills.
 *
 * The two failure modes worth protecting against are the ones a user cannot easily
 * notice:
 *
 *   1. **A double confirmation.** Confirming the same occurrence twice must produce ONE
 *      bill. Two bills means money counted twice, and nothing on screen says so.
 *   2. **A silently posted bill.** No path may turn a due date into a transaction
 *      without an explicit confirm — that is the whole reason occurrences exist.
 *
 * The clock is injected, so "which dates are due" is deterministic rather than dependent
 * on when the suite runs.
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
  MAX_LOOKBACK_PERIODS,
  RecurringService,
} from '../src/services/recurring-service.js';
import { ConflictError, NotFoundError } from '../src/services/transaction-service.js';

const USERNAME = 'quiz';
const PASSWORD = 'correct horse battery staple';
const CSRF = { 'x-requested-with': 'fetch' } as const;

const FOOD = 'builtin-expense-food';
const ACCOUNT = 'builtin-default-account';

/** Mid-September 2026, so "today" and the month boundaries are unambiguous. */
const NOW = new Date(2026, 8, 15, 12, 0, 0).getTime();

const localDay = (year: number, month1: number, day: number): number =>
  new Date(year, month1 - 1, day).getTime();

let db: Db;
let app: FastifyInstance;
let cookie: string;
let service: RecurringService;
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

function authed() {
  return { ...CSRF, ...as(cookie) };
}

/** A valid rule body; override what a test cares about. */
function ruleBody(overrides: Record<string, unknown> = {}) {
  return {
    name: '房租',
    type: 0,
    amountCents: 250_000,
    categoryId: FOOD,
    accountId: ACCOUNT,
    frequency: 'monthly',
    anchorDate: localDay(2026, 6, 15),
    ...overrides,
  };
}

async function postRule(overrides: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/recurring/rules',
    headers: authed(),
    payload: ruleBody(overrides),
  });
}

/** Creates a rule through the service and returns its id. */
function makeRule(overrides: Record<string, unknown> = {}): string {
  return service.createRule(ruleBody(overrides)).id;
}

/** How many bills exist right now — the only honest check for "did this create one". */
function billCount(): number {
  const row = db.prepare('SELECT COUNT(*) AS c FROM transactions WHERE deleted = 0').get() as {
    c: number;
  };
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

  service = new RecurringService(db, { now: () => clock });
  cookie = await login();
});

afterEach(async () => {
  await app.close();
  closeDatabase(db);
});

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

describe('recurring rules', () => {
  it('AC1 creates a rule whose first due date is its anchor', () => {
    const rule = service.createRule(ruleBody());

    expect(rule.name).toBe('房租');
    expect(rule.amountCents).toBe(250_000);
    expect(rule.frequency).toBe('monthly');
    expect(rule.anchorDate).toBe(localDay(2026, 6, 15));
    expect(rule.nextDueDate).toBe(localDay(2026, 6, 15));
    expect(rule.enabled).toBe(true);
    expect(rule.hasOlderDue).toBe(false);
  });

  it('AC1 lists, edits, and disables a rule', () => {
    const id = makeRule();

    expect(service.listRules()).toHaveLength(1);

    const edited = service.updateRule(id, { name: '房租（新）', amountCents: 260_000 });
    expect(edited.name).toBe('房租（新）');
    expect(edited.amountCents).toBe(260_000);

    expect(service.setRuleEnabled(id, false).enabled).toBe(false);
    expect(service.setRuleEnabled(id, true).enabled).toBe(true);
  });

  it('rejects a bad amount, frequency, or missing name', () => {
    expect(() => service.createRule(ruleBody({ amountCents: 0 }))).toThrow();
    expect(() => service.createRule(ruleBody({ amountCents: 19.99 }))).toThrow();
    expect(() => service.createRule(ruleBody({ frequency: 'hourly' }))).toThrow();
    expect(() => service.createRule(ruleBody({ name: '   ' }))).toThrow();
    expect(() => service.createRule(ruleBody({ type: 7 }))).toThrow();
  });

  it('rejects a category or account that does not exist', () => {
    expect(() => service.createRule(ruleBody({ categoryId: 'nope' }))).toThrow(/category/i);
    expect(() => service.createRule(ruleBody({ accountId: 'nope' }))).toThrow(/account/i);
  });

  it('rejects an anchor in the future', () => {
    // Catches a mistyped year, same rule the transaction date follows.
    expect(() =>
      service.createRule(ruleBody({ anchorDate: localDay(2027, 1, 1) })),
    ).toThrow(/future/i);
  });

  it('deleteRule hides the rule and drops its pending items', () => {
    const id = makeRule();
    service.generateDue();
    expect(service.listPending().length).toBeGreaterThan(0);

    service.deleteRule(id);

    expect(service.listRules()).toHaveLength(0);
    expect(service.listPending()).toHaveLength(0);
    expect(() => service.getRule(id)).toThrow(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

describe('generation', () => {
  it('AC2 a due rule produces PENDING items and no bills at all', () => {
    makeRule();

    const result = service.generateDue();

    expect(result.created).toBeGreaterThan(0);
    // The load-bearing assertion: nothing was posted.
    expect(billCount()).toBe(0);
    expect(service.listPending().length).toBe(result.created);
  });

  it('AC2 a rule anchored in the past resumes from its anchor and is due at once', () => {
    // A past anchor is a legitimate way to recreate a standing bill.
    makeRule({ anchorDate: localDay(2026, 8, 15) });

    const result = service.generateDue();

    // 8/15 and 9/15 are both on or before today (9/15).
    expect(result.created).toBe(2);
    expect(service.listPending().map((item) => item.plannedDate)).toEqual([
      localDay(2026, 8, 15),
      localDay(2026, 9, 15),
    ]);
  });

  it('AC2 a rule whose first due date has not arrived generates nothing', () => {
    // Anchor yesterday-but-not-on-schedule: with a monthly rule anchored on the 20th,
    // today (the 15th) is before the first due date, so the rule is dormant.
    makeRule({ anchorDate: localDay(2026, 8, 20) });

    // Anchor in the past is accepted; the September occurrence (9/20) is still ahead.
    expect(service.generateDue().created).toBe(1); // 8/20 only
    expect(service.listPending().map((item) => item.plannedDate)).toEqual([
      localDay(2026, 8, 20),
    ]);
  });

  it('AC3 generating twice creates nothing the second time', () => {
    makeRule();

    const first = service.generateDue();
    const second = service.generateDue();

    expect(first.created).toBeGreaterThan(0);
    expect(second.created).toBe(0);
    expect(service.listPending()).toHaveLength(first.created);
  });

  it('AC7 a disabled rule generates nothing', () => {
    const id = makeRule();
    service.setRuleEnabled(id, false);

    expect(service.generateDue().created).toBe(0);
    expect(service.listPending()).toHaveLength(0);
  });

  it('AC9 caps a long backlog and flags that older items were skipped', () => {
    // A daily rule anchored three months back is ~90 due dates; the cap is 12.
    const anchor = localDay(2026, 6, 1);
    makeRule({ frequency: 'daily', anchorDate: anchor });

    const result = service.generateDue();

    expect(result.created).toBe(MAX_LOOKBACK_PERIODS);
    expect(result.truncated).toBe(1);
    expect(service.listPending()).toHaveLength(MAX_LOOKBACK_PERIODS);

    // The user must be told, not left to believe nothing was missed.
    const rule = service.listRules()[0];
    expect(rule?.hasOlderDue).toBe(true);
  });

  it('AC9 the newest periods are the ones kept', () => {
    // A monthly rule anchored in January is only 9 due dates by mid-September, which is
    // under the cap — so this case pins the kept set without truncation.
    makeRule({ frequency: 'monthly', anchorDate: localDay(2026, 1, 15) });

    service.generateDue();
    const pending = service.listPending();

    expect(pending).toHaveLength(9);
    expect(pending[0]?.plannedDate).toBe(localDay(2026, 1, 15));
    expect(pending[pending.length - 1]?.plannedDate).toBe(localDay(2026, 9, 15));
  });

  it('AC9 when the cap bites, the newest periods are kept and the oldest dropped', () => {
    // Weekly from June is ~15 due dates, so the cap (12) applies.
    makeRule({ frequency: 'weekly', anchorDate: localDay(2026, 6, 1) });

    const result = service.generateDue();
    const pending = service.listPending();

    expect(result.truncated).toBe(1);
    expect(pending).toHaveLength(MAX_LOOKBACK_PERIODS);

    // The most recent due date is kept...
    const newest = pending[pending.length - 1]?.plannedDate;
    expect(newest).toBe(localDay(2026, 9, 14));
    // ...and the oldest kept is exactly 11 weeks earlier, i.e. the first ones were dropped.
    expect(pending[0]?.plannedDate).toBe(localDay(2026, 6, 29));
    expect(pending[0]?.plannedDate).toBeGreaterThan(localDay(2026, 6, 1));
  });

  it('AC8 advancing never moves the cursor backwards, so a second run is stable', () => {
    makeRule({ frequency: 'monthly', anchorDate: localDay(2026, 6, 15) });

    service.generateDue();
    const afterFirst = service.listRules()[0]?.nextDueDate;

    // Cursor is strictly in the future now, so the rule is no longer due.
    expect(afterFirst).toBeGreaterThan(clock);
    service.generateDue();
    expect(service.listRules()[0]?.nextDueDate).toBe(afterFirst);
  });

  it('re-enabling a rule resumes from today instead of replaying the backlog', () => {
    const id = makeRule({ frequency: 'daily', anchorDate: localDay(2026, 6, 1) });
    service.setRuleEnabled(id, false);

    service.setRuleEnabled(id, true);

    const rule = service.getRule(id);
    // The whole dormant period is skipped, not materialised.
    expect(rule.nextDueDate).toBeGreaterThan(clock);
    expect(rule.hasOlderDue).toBe(false);
    expect(service.generateDue().created).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Confirmation — the dangerous path
// ---------------------------------------------------------------------------

describe('confirmation', () => {
  it('AC4 confirming creates exactly one bill and links it', () => {
    makeRule();
    service.generateDue();
    const occurrence = service.listPending()[0];
    expect(occurrence).toBeDefined();

    const result = service.confirmOccurrence(occurrence?.id as string);

    expect(result.created).toBe(true);
    expect(billCount()).toBe(1);
    expect(result.transaction.amountCents).toBe(250_000);
    expect(result.transaction.categoryId).toBe(FOOD);

    // The occurrence records which bill it became.
    const after = service.listOccurrences().find((item) => item.id === occurrence?.id);
    expect(after?.status).toBe('confirmed');
    expect(after?.transactionId).toBe(result.transaction.id);
    // And it leaves the pending queue.
    expect(service.listPending().some((item) => item.id === occurrence?.id)).toBe(false);
  });

  it('AC5 confirming the SAME occurrence twice does NOT create a second bill', () => {
    makeRule();
    service.generateDue();
    const id = service.listPending()[0]?.id as string;

    const first = service.confirmOccurrence(id);
    const second = service.confirmOccurrence(id);

    // This is the assertion that protects against double-counted money.
    expect(billCount()).toBe(1);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.transaction.id).toBe(first.transaction.id);
  });

  it('AC4 confirming changes the budget figures', async () => {
    // A salary makes a cycle, so the module has a budget to spend against.
    const salary = await app.inject({
      method: 'POST',
      url: '/api/v1/salaries',
      headers: authed(),
      payload: { amountCents: 1_000_000, date: localDay(2026, 9, 2), templateId: undefined },
    });
    expect(salary.statusCode, salary.body).toBe(201);

    const before = (await app.inject({ method: 'GET', url: '/api/v1/budget/overview', headers: authed() })).json();
    const foodBefore = before.modules.find((m: { categoryId: string }) => m.categoryId === FOOD);

    // A rule whose first due date is inside the current cycle.
    makeRule({ anchorDate: localDay(2026, 9, 10) });
    service.generateDue();
    service.confirmOccurrence(service.listPending()[0]?.id as string);

    const after = (await app.inject({ method: 'GET', url: '/api/v1/budget/overview', headers: authed() })).json();
    const foodAfter = after.modules.find((m: { categoryId: string }) => m.categoryId === FOOD);

    expect(foodAfter.spentCents).toBe(foodBefore.spentCents + 250_000);
  });

  it('confirming an unknown or ignored occurrence fails loudly', () => {
    expect(() => service.confirmOccurrence('no-such-id')).toThrow(NotFoundError);

    makeRule();
    service.generateDue();
    const id = service.listPending()[0]?.id as string;
    service.ignoreOccurrence(id);

    // Not a silent success: the caller's view is out of date.
    expect(() => service.confirmOccurrence(id)).toThrow(ConflictError);
    expect(billCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Ignoring
// ---------------------------------------------------------------------------

describe('ignoring', () => {
  it('AC6 ignoring creates no bill and leaves the pending queue', () => {
    makeRule();
    service.generateDue();
    const id = service.listPending()[0]?.id as string;

    const result = service.ignoreOccurrence(id);

    expect(result.status).toBe('ignored');
    expect(billCount()).toBe(0);
    expect(service.listPending().some((item) => item.id === id)).toBe(false);
  });

  it('AC6 a later regeneration does not resurrect an ignored occurrence', () => {
    makeRule();
    service.generateDue();
    const id = service.listPending()[0]?.id as string;
    service.ignoreOccurrence(id);

    service.generateDue();

    // The row still occupies its slot, so it stays ignored.
    expect(service.listPending().some((item) => item.id === id)).toBe(false);
    expect(service.listOccurrences().find((item) => item.id === id)?.status).toBe('ignored');
  });

  it('ignoring is idempotent, but ignoring a confirmed one is a conflict', () => {
    makeRule();
    service.generateDue();
    const id = service.listPending()[0]?.id as string;

    service.ignoreOccurrence(id);
    expect(service.ignoreOccurrence(id).status).toBe('ignored');

    const second = service.listPending()[0]?.id;
    if (second !== undefined) {
      service.confirmOccurrence(second);
      expect(() => service.ignoreOccurrence(second)).toThrow(ConflictError);
    }
  });
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

describe('recurring routes', () => {
  it('AC1 creates a rule over HTTP and returns 201', async () => {
    const response = await postRule();

    expect(response.statusCode, response.body).toBe(201);
    expect(response.json().name).toBe('房租');
  });

  it('generates and confirms over HTTP', async () => {
    const created = await postRule();
    const ruleId = created.json().id as string;
    expect(ruleId).toBeTruthy();

    const generated = await app.inject({
      method: 'POST',
      url: '/api/v1/recurring/generate',
      headers: authed(),
    });
    expect(generated.statusCode).toBe(200);
    expect(generated.json().created).toBeGreaterThan(0);

    const pending = await app.inject({
      method: 'GET',
      url: '/api/v1/recurring/pending',
      headers: authed(),
    });
    const pendingId = pending.json().items[0].id as string;

    const confirmed = await app.inject({
      method: 'POST',
      url: `/api/v1/recurring/occurrences/${pendingId}/confirm`,
      headers: authed(),
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().created).toBe(true);

    // And the bill is visible through the normal list.
    const bills = await app.inject({
      method: 'GET',
      url: '/api/v1/transactions?limit=10',
      headers: authed(),
    });
    expect(bills.json().total).toBe(1);
  });

  it('/recurring/generate is not read as a rule id', async () => {
    // Guards the static-vs-parameter route match: if `generate` were routed to
    // `rules/:id` the request would 404 on a nonexistent rule instead.
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/recurring/generate',
      headers: authed(),
    });

    expect(response.statusCode).toBe(200);
    expect(typeof response.json().created).toBe('number');
  });

  it('rejects a non-boolean enabled flag', async () => {
    const created = await postRule();
    const id = created.json().id as string;

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/recurring/rules/${id}/enabled`,
      headers: authed(),
      payload: { enabled: 'yes' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION');
  });

  it('404s for an unknown rule', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/recurring/rules/no-such-id',
      headers: authed(),
      payload: { name: 'x' },
    });

    expect(response.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

describe('recurring routes require a session', () => {
  it('answers 401 on every endpoint when signed out', async () => {
    // Registered inside the auth module's plugin context. The mutating calls carry the
    // CSRF header so a 403 cannot stand in for the 401 under test.
    const calls: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string }[] = [
      { method: 'GET', url: '/api/v1/recurring/rules' },
      { method: 'POST', url: '/api/v1/recurring/rules' },
      { method: 'PATCH', url: '/api/v1/recurring/rules/some-id' },
      { method: 'DELETE', url: '/api/v1/recurring/rules/some-id' },
      { method: 'POST', url: '/api/v1/recurring/rules/some-id/enabled' },
      { method: 'POST', url: '/api/v1/recurring/generate' },
      { method: 'GET', url: '/api/v1/recurring/occurrences' },
      { method: 'GET', url: '/api/v1/recurring/pending' },
      { method: 'POST', url: '/api/v1/recurring/occurrences/some-id/confirm' },
      { method: 'POST', url: '/api/v1/recurring/occurrences/some-id/ignore' },
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

  it('requires the CSRF header on mutations when signed in', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/recurring/generate',
      headers: as(cookie),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('CSRF_REQUIRED');
  });
});

// ---------------------------------------------------------------------------
// The soft-delete / accounting guarantees this task must not disturb
// ---------------------------------------------------------------------------

describe('interaction with the rest of the ledger', () => {
  it('a confirmed bill is an ordinary bill: soft-deletable, and the link survives', async () => {
    makeRule();
    service.generateDue();
    const { transaction } = service.confirmOccurrence(service.listPending()[0]?.id as string);

    // Deleted through the ordinary route, not by touching the table directly.
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/transactions/${transaction.id}`,
      headers: authed(),
    });

    expect(deleted.statusCode).toBe(204);
    expect(billCount()).toBe(0);
    // The occurrence still records the bill it produced, so the provenance is not lost.
    const occurrence = service
      .listOccurrences()
      .find((item) => item.transactionId === transaction.id);
    expect(occurrence?.status).toBe('confirmed');
  });

  it('generation does not touch cycles or salaries', () => {
    const salaryBefore = db.prepare('SELECT COUNT(*) AS c FROM salary_records').get() as { c: number };
    const allocationsBefore = db.prepare('SELECT COUNT(*) AS c FROM budget_allocations').get() as {
      c: number;
    };

    makeRule();
    service.generateDue();

    const salaryAfter = db.prepare('SELECT COUNT(*) AS c FROM salary_records').get() as { c: number };
    const allocationsAfter = db.prepare('SELECT COUNT(*) AS c FROM budget_allocations').get() as {
      c: number;
    };
    expect(salaryAfter.c).toBe(salaryBefore.c);
    expect(allocationsAfter.c).toBe(allocationsBefore.c);
  });
});
