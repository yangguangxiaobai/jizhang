import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { allocateFundIncomeCents } from '@jizhang/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { initializeDatabase, type Db } from '../src/db/index.js';
import { SESSION_COOKIE } from '../src/plugins/auth.js';
import { AuthService } from '../src/services/auth-service.js';
import { FinancialFundService } from '../src/services/financial-fund-service.js';
import { salarySourceToken } from '../src/services/financial-planning-types.js';
import { replaceFinancialRefundSplits } from '../src/services/financial-source-lifecycle.js';

const BASE = '/api/v1/financial-funds/config';
const RATIOS = { growth: 2500, reserve: 1500, essentials: 5000, joy: 1000 };
const CHANGED = { growth: 1000, reserve: 1000, essentials: 7000, joy: 1000 };
const NOW = 1700000000000;
let db: Db;
let app: FastifyInstance;
let headers: Record<string, string>;

beforeEach(async () => {
  db = new Database(':memory:');
  initializeDatabase(db, null);
  const config = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', JIZHANG_USERNAME: 'tester', JIZHANG_PASSWORD_HASH: 'unused', DATA_DIR: './data' });
  const auth = new AuthService(db, { sessionTtlDays: config.sessionTtlDays, now: () => NOW });
  await auth.setPassword('tester', 'correct horse battery staple');
  app = buildApp({ config, db, authService: auth, secureCookies: false, now: () => NOW });
  await app.ready();
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { 'x-requested-with': 'fetch' }, payload: { username: 'tester', password: 'correct horse battery staple' } });
  const cookie = login.cookies.find((item) => item.name === SESSION_COOKIE);
  expect(cookie).toBeDefined();
  headers = { cookie: `${SESSION_COOKIE}=${cookie!.value}`, 'x-requested-with': 'fetch' };
});
afterEach(async () => { await app.close(); db.close(); });

function write(body: Record<string, unknown>) {
  return app.inject({ method: 'PUT', url: BASE, headers, payload: body });
}

describe('fund configuration API', () => {
  it('requires authentication and CSRF', async () => {
    expect((await app.inject({ method: 'GET', url: BASE })).statusCode).toBe(401);
    const anonymousWrite = await app.inject({ method: 'PUT', url: BASE, headers: { 'x-requested-with': 'fetch' }, payload: {} });
    expect(anonymousWrite.statusCode).toBe(401);
    const response = await app.inject({ method: 'PUT', url: BASE, headers: { cookie: headers['cookie']! }, payload: {} });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: 'CSRF_REQUIRED' } });
  });
  it('returns an unsaved virtual default without cycle fields', async () => {
    const response = await app.inject({ method: 'GET', url: BASE, headers });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ contractVersion: 1, config: { revision: 0, ratiosBps: RATIOS, updatedAt: null } });
    expect(response.json().config).not.toHaveProperty('cycle');
    expect(db.prepare('SELECT * FROM financial_fund_config_revisions').all()).toHaveLength(0);
  });
  it('uses the injected timezone for an unsaved virtual config', () => {
    const service = new FinancialFundService(db, { serverTimeZone: 'Asia/Shanghai' });
    expect(service.getConfig().config).toMatchObject({ revision: 0, timeZone: 'Asia/Shanghai', ratiosBps: RATIOS });
  });
  it('does not fabricate a default when either config issue kind is open', async () => {
    for (const kind of ['config', 'fund-config']) {
      db.prepare("INSERT INTO financial_fund_migration_issues VALUES (?, '1', 'invalid-current-config', '{}', 'open')").run(kind);
      const response = await app.inject({ method: 'GET', url: BASE, headers });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ error: { code: 'FINANCIAL_UNAVAILABLE' } });
      db.prepare('DELETE FROM financial_fund_migration_issues WHERE source_kind=?').run(kind);
    }
  });
  it('rejects unreadable latest saved configuration rather than using an older revision', async () => {
    db.prepare("INSERT INTO financial_fund_config_revisions VALUES (1,?,'UTC',NULL,NULL,1)").run(JSON.stringify(RATIOS));
    db.prepare("INSERT INTO financial_fund_config_revisions VALUES (2,'{','UTC',NULL,NULL,2)").run();
    const response = await app.inject({ method: 'GET', url: BASE, headers });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: 'FINANCIAL_UNAVAILABLE' } });
  });
  it('changes ratios prospectively without rewriting grant revisions', async () => {
    db.prepare("INSERT INTO financial_fund_grants VALUES ('g','salary','s',1,'active')").run();
    db.prepare("INSERT INTO financial_fund_grant_revisions VALUES ('g',1,100000,?,?, '[]',NULL,NULL,1,'test')").run(JSON.stringify(RATIOS), JSON.stringify({ growth:25000, reserve:15000, essentials:50000, joy:10000 }));
    const original = db.prepare('SELECT * FROM financial_fund_grant_revisions').all();
    const response = await write({ operationId: randomUUID(), expectedRevision: 0, ratiosBps: CHANGED, timeZone: 'UTC' });
    expect(response.statusCode).toBe(200);
    expect(db.prepare('SELECT * FROM financial_fund_grant_revisions').all()).toEqual(original);
    const owner = db.prepare('SELECT id FROM users WHERE username=?').get('tester');
    expect(db.prepare('SELECT actor_id FROM financial_fund_config_revisions').get()).toEqual({ actor_id: (owner as { id: string }).id });
  });
  it('rejects invalid input without consuming the operation key', async () => {
    const operationId = randomUUID();
    const invalid = await write({ operationId, expectedRevision: 0, ratiosBps: { ...RATIOS, growth: 1 }, timeZone: 'UTC' });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ error: { code: 'FINANCIAL_INVALID' } });
    const corrected = await write({ operationId, expectedRevision: 0, ratiosBps: RATIOS, timeZone: 'UTC' });
    expect(corrected.statusCode).toBe(200);
  });
  it('scopes operation replay to the authenticated actor', () => {
    const service = new FinancialFundService(db, { now: () => NOW, serverTimeZone: 'UTC' });
    const body = { operationId: randomUUID(), expectedRevision: 0, ratiosBps: RATIOS, timeZone: 'UTC' };
    const result = service.updateConfig(body, 'actor-one');
    expect(service.updateConfig(body, 'actor-one')).toEqual(result);
    expect(() => service.updateConfig(body, 'actor-two')).toThrowError(expect.objectContaining({ code: 'FINANCIAL_OPERATION_MISMATCH' }));
  });
  it('config revision conflicts and replay precedes current checks', async () => {
    const operationId = randomUUID();
    const request = { operationId, expectedRevision: 0, ratiosBps: CHANGED, timeZone: 'Asia/Shanghai' };
    const first = await write(request);
    expect(first.statusCode).toBe(200);
    expect(first.json().config).toMatchObject({ revision: 1, ratiosBps: CHANGED, timeZone: 'Asia/Shanghai' });
    const conflict = await write({ ...request, operationId: randomUUID() });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: { code: 'FINANCIAL_REVISION_CONFLICT' } });
    db.prepare("INSERT INTO financial_fund_migration_issues VALUES ('fund-config', '1', 'invalid-current-config', '{}', 'open')").run();
    const replay = await write(request);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    const mismatch = await write({ ...request, ratiosBps: RATIOS });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json()).toMatchObject({ error: { code: 'FINANCIAL_OPERATION_MISMATCH' } });
  });
});

// Activity remains unavailable until complete refund-graph attribution is implemented.

describe('fund capabilities, summary and review endpoints', () => {
  const FUND = '/api/v1/financial-funds';

  function salary(id: string, cents: number, date: number) {
    db.prepare("INSERT INTO salary_records (id,amount_cents,date,note,deleted,updated_at,account_id) VALUES (?,?,?,'',0,1,'a')").run(id, cents, date);
    const row = { id, amount_cents: cents, date, account_id: 'a' };
    return { salaryId: id, amountCents: cents, date, accountId: 'a', sourceToken: salarySourceToken(row), confirmedAt: 1 };
  }
  function salaryGrant(id: string, cents: number, date: number) {
    const source = salary(id, cents, date);
    db.prepare("INSERT INTO financial_fund_grants VALUES (?, 'salary', ?, 1, 'active')").run(id, id);
    db.prepare("INSERT INTO financial_fund_grant_revisions VALUES (?,1,?,?,?,?,NULL,NULL,1,'salary')")
      .run(id, cents, JSON.stringify(RATIOS), JSON.stringify(allocateFundIncomeCents(cents, RATIOS)), JSON.stringify([source]));
    db.prepare("INSERT INTO financial_fund_grant_sources VALUES (?,?,?,?,?,?,'active')").run(id, id, source.sourceToken, cents, date, 'a');
  }
  function ledger(id: string, type: number, cents: number, refund: number, purpose: string | null, date = 1) {
    db.prepare("INSERT INTO transactions (id,type,amount_cents,category_id,account_id,date,note,tags_json,is_refund,deleted,updated_at) VALUES (?,?,?,'c','a',?,'','[]',?,0,1)").run(id, type, cents, date, refund);
    db.prepare("INSERT INTO financial_fund_purposes VALUES (?,?,1,'explicit','{}')").run(id, purpose);
  }

  it('requires authentication for reads and advertises only implemented features', async () => {
    for (const path of ['/capabilities', '/summary', '/migration-issues']) {
      expect((await app.inject({ method: 'GET', url: `${FUND}${path}` })).statusCode).toBe(401);
    }
    const capabilities = await app.inject({ method: 'GET', url: `${FUND}/capabilities`, headers });
    expect(capabilities.statusCode).toBe(200);
    const body = capabilities.json();
    expect(body).toMatchObject({
      contractVersion: 1,
      purposes: ['growth', 'reserve', 'essentials', 'joy'],
      amountUnit: 'integer-cents',
      accountingPeriods: false,
      moduleBudgets: false,
      legacyBudgetsReadOnly: false,
    });
    expect(body).not.toHaveProperty('cycle');
    // Refund-complete activity remains unavailable until P06.
    expect(body.features).toMatchObject({ activity: false, unclaimedSalaryReview: true, legacyGrantReview: true });
  });

  it('returns continuous balances independent of any activity month', async () => {
    salaryGrant('jan', 100000, Date.UTC(2026, 0, 10));
    salaryGrant('oct', 100000, Date.UTC(2026, 9, 10));
    ledger('expense', 0, 12000, 0, 'essentials', Date.UTC(2026, 9, 12));
    ledger('refund', 1, 3000, 1, null, Date.UTC(2026, 9, 20));
    replaceFinancialRefundSplits(db, {
      refundTxId: 'refund',
      splits: [{ originalTransactionId: 'expense', amountCents: 3000 }],
      refundFacts: { amountCents: 3000, type: 1, isRefund: true },
      originalFacts: [{ transactionId: 'expense', facts: { amountCents: 12000, type: 0, isRefund: false } }],
      operationId: null,
      now: 1,
    });
    const summary = await app.inject({ method: 'GET', url: `${FUND}/summary`, headers });
    expect(summary.statusCode).toBe(200);
    const body = summary.json();
    expect(body.balances).toEqual({ growth: 50000, reserve: 30000, essentials: 91000, joy: 20000 });
    expect(body.coverage.complete).toBe(true);
    // A November-only window would show no rows, but continuous balances must not reset.
    const november = await app.inject({ method: 'GET', url: `${FUND}/summary?from=${Date.UTC(2026, 10, 1)}&to=${Date.UTC(2026, 11, 1)}`, headers });
    expect(november.statusCode).toBe(200);
    expect(november.json().balances).toEqual(body.balances);
    expect(november.json().snapshotToken).toBe(body.snapshotToken);
  });

  it('reports empty supported history as a complete zero and unresolved history as incomplete', async () => {
    const empty = (await app.inject({ method: 'GET', url: `${FUND}/summary`, headers })).json();
    expect(empty.balances).toEqual({ growth: 0, reserve: 0, essentials: 0, joy: 0 });
    expect(empty.coverage.complete).toBe(true);
    salary('unclaimed', 100000, 1);
    const incomplete = (await app.inject({ method: 'GET', url: `${FUND}/summary`, headers })).json();
    expect(incomplete.coverage).toMatchObject({ complete: false, unallocatedSalaryCount: 1 });
  });

  it('bounds the migration issue queue and rejects unsafe paging', async () => {
    for (let index = 0; index < 120; index += 1) {
      db.prepare("INSERT INTO financial_fund_migration_issues VALUES ('salary',?,'unallocated','{}','open')").run(String(index).padStart(3, '0'));
    }
    const page = await app.inject({ method: 'GET', url: `${FUND}/migration-issues`, headers });
    expect(page.statusCode).toBe(200);
    expect(page.json()).toMatchObject({ contractVersion: 1, total: 120, limit: 50, offset: 0 });
    expect(page.json().items).toHaveLength(50);
    const second = await app.inject({ method: 'GET', url: `${FUND}/migration-issues?limit=100&offset=100`, headers });
    expect(second.json().items).toHaveLength(20);
    for (const query of ['limit=101', 'limit=0', 'limit=abc', 'limit=1.5', 'offset=-1', 'limit=1&limit=2']) {
      const rejected = await app.inject({ method: 'GET', url: `${FUND}/migration-issues?${query}`, headers });
      expect(rejected.statusCode).toBe(400);
      expect(rejected.json()).toMatchObject({ error: { code: 'FINANCIAL_INVALID' } });
    }
  });

  it('discovers and explicitly claims one historic salary with exact replay', async () => {
    const source = salary('unclaimed', 100000, 946684800100);
    db.prepare("INSERT INTO financial_fund_migration_issues VALUES ('salary','unclaimed','unallocated','{}','open')").run();
    const issuePage = await app.inject({ method: 'GET', url: `${FUND}/migration-issues`, headers });
    expect(issuePage.json().items[0]).toMatchObject({ sourceKind: 'salary', sourceId: 'unclaimed', source: {
      salaryId: 'unclaimed', amountCents: 100000, date: source.date, accountId: 'a', sourceToken: source.sourceToken,
    } });
    const body = { operationId: randomUUID(), expectedRevision: 0, ratiosBps: RATIOS,
      sources: [{ salaryId: 'unclaimed', expectedSourceToken: source.sourceToken }] };
    const before = db.prepare("SELECT * FROM salary_records WHERE id='unclaimed'").get();
    const first = await app.inject({ method: 'POST', url: `${FUND}/grants/review`, headers, payload: body });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ contractVersion: 1, grant: { grantId: 'salary:unclaimed', revision: 1,
      sourceAmountCents: 100000, targets: { growth: 25000, reserve: 15000, essentials: 50000, joy: 10000 } } });
    const lookup = await app.inject({ method: 'GET', url: `/api/v1/financial-planning/operations/${body.operationId}`, headers });
    expect(lookup.statusCode).toBe(200);
    expect(lookup.json().operation.response).toEqual(first.json());
    // Simulate a pre-fix committed operation: the old database stored only the grant.
    const historicalJson = JSON.stringify(first.json().grant);
    db.prepare('UPDATE financial_operations SET response_json=? WHERE operation_id=?').run(historicalJson, body.operationId);
    const legacyReplay = await app.inject({ method: 'POST', url: `${FUND}/grants/review`, headers, payload: body });
    expect(legacyReplay.statusCode).toBe(200);
    expect(legacyReplay.json()).toEqual(first.json());
    expect(db.prepare('SELECT response_json FROM financial_operations WHERE operation_id=?').get(body.operationId)).toEqual({ response_json: historicalJson });
    const oldLookup = await app.inject({ method: 'GET', url: `/api/v1/financial-planning/operations/${body.operationId}`, headers });
    expect(oldLookup.json().operation.response).toEqual(first.json().grant);
    expect(db.prepare("SELECT * FROM salary_records WHERE id='unclaimed'").get()).toEqual(before);
    expect(db.prepare("SELECT status FROM financial_fund_migration_issues WHERE source_id='unclaimed'").get()).toEqual({ status: 'resolved' });
    expect((await app.inject({ method: 'GET', url: `${FUND}/summary`, headers })).json().coverage.complete).toBe(true);
    db.prepare("UPDATE salary_records SET amount_cents=100001 WHERE id='unclaimed'").run();
    const replay = await app.inject({ method: 'POST', url: `${FUND}/grants/review`, headers, payload: body });
    expect(replay.json()).toEqual(first.json());
    const mismatch = await app.inject({ method: 'POST', url: `${FUND}/grants/review`, headers, payload: { ...body, sources: [{ ...body.sources[0], extra: true }] } });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json()).toMatchObject({ error: { code: 'FINANCIAL_OPERATION_MISMATCH' } });
    const service = new FinancialFundService(db, { now: () => NOW });
    expect(() => service.reviewGrant(body, 'another-user')).toThrowError(expect.objectContaining({ code: 'FINANCIAL_OPERATION_MISMATCH' }));
    expect(db.prepare('SELECT count(*) AS n FROM financial_fund_grant_sources').get()).toEqual({ n: 1 });
  });

  it('rejects stale config, changed or deleted source, duplicates and competing claim atomically', async () => {
    const source = salary('single', 1, 946684800100);
    const body = { operationId: randomUUID(), expectedRevision: 0, ratiosBps: RATIOS,
      sources: [{ salaryId: 'single', expectedSourceToken: source.sourceToken }] };
    const review = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: `${FUND}/grants/review`, headers, payload });
    const conflict = await review({ ...body, expectedRevision: 1 });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: { code: 'FINANCIAL_REVISION_CONFLICT' } });
    const multiple = await review({ ...body, sources: [body.sources[0], body.sources[0]] });
    expect(multiple.statusCode).toBe(400);
    db.prepare("UPDATE salary_records SET amount_cents=2 WHERE id='single'").run();
    const stale = await review(body);
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: { code: 'FINANCIAL_SOURCE_CHANGED' } });
    db.prepare("UPDATE salary_records SET amount_cents=1,deleted=1 WHERE id='single'").run();
    expect((await review(body)).statusCode).toBe(409);
    expect(db.prepare('SELECT count(*) AS n FROM financial_operations').get()).toEqual({ n: 0 });
    db.prepare("UPDATE salary_records SET deleted=0 WHERE id='single'").run();
    expect((await review(body)).statusCode).toBe(200);
    const competing = await review({ ...body, operationId: randomUUID() });
    expect(competing.statusCode).toBe(409);
    expect(db.prepare('SELECT count(*) AS n FROM financial_fund_grants').get()).toEqual({ n: 1 });
  });

  it('rolls back a single claim if keyed operation persistence fails', async () => {
    const source = salary('single', 1, 1);
    const body = { operationId: randomUUID(), expectedRevision: 0, ratiosBps: RATIOS,
      sources: [{ salaryId: 'single', expectedSourceToken: source.sourceToken }] };
    const service = new FinancialFundService(db, { now: () => NOW });
    db.exec("CREATE TRIGGER reject_fund_operation BEFORE INSERT ON financial_operations BEGIN SELECT RAISE(ABORT, 'test'); END");
    expect(() => service.reviewGrant(body, 'actor')).toThrow();
    expect(db.prepare('SELECT count(*) AS n FROM financial_fund_grants').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT count(*) AS n FROM financial_fund_grant_sources').get()).toEqual({ n: 0 });
    db.exec('DROP TRIGGER reject_fund_operation');
    expect(service.reviewGrant(body, 'actor').grant.revision).toBe(1);
  });

  it('reviews a legacy aggregate grant once with authenticated ownership', async () => {
    const source = salary('s1', 1, 946684800100);
    db.prepare("INSERT INTO financial_fund_grants VALUES ('legacy-group:p','legacy-group','p',1,'review-required')").run();
    db.prepare("INSERT INTO financial_fund_grant_revisions VALUES ('legacy-group:p',1,1,?,?,?,NULL,NULL,200,'legacy-confirmed-group')")
      .run(JSON.stringify(RATIOS), JSON.stringify({ growth: 0, reserve: 0, essentials: 1, joy: 0 }), JSON.stringify([source]));
    db.prepare("INSERT INTO financial_fund_grant_sources VALUES ('s1','legacy-group:p',?,1,946684800100,'a','review-required')").run(source.sourceToken);

    const operationId = randomUUID();
    const body = { operationId, grantId: 'legacy-group:p', expectedRevision: 1, ratiosBps: RATIOS, sources: [{ salaryId: 's1', expectedSourceToken: source.sourceToken }] };
    const first = await app.inject({ method: 'POST', url: `${FUND}/grants/review`, headers, payload: body });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ contractVersion: 1, grant: { grantId: 'legacy-group:p', revision: 2, sourceAmountCents: 1 } });
    const lookup = await app.inject({ method: 'GET', url: `/api/v1/financial-planning/operations/${operationId}`, headers });
    expect(lookup.statusCode).toBe(200);
    expect(lookup.json().operation.response).toEqual(first.json());
    const historicalJson = JSON.stringify(first.json().grant);
    db.prepare('UPDATE financial_operations SET response_json=? WHERE operation_id=?').run(historicalJson, operationId);
    const legacyReplay = await app.inject({ method: 'POST', url: `${FUND}/grants/review`, headers, payload: body });
    expect(legacyReplay.statusCode).toBe(200);
    expect(legacyReplay.json()).toEqual(first.json());
    expect(db.prepare('SELECT response_json FROM financial_operations WHERE operation_id=?').get(operationId)).toEqual({ response_json: historicalJson });
    const oldLookup = await app.inject({ method: 'GET', url: `/api/v1/financial-planning/operations/${operationId}`, headers });
    expect(oldLookup.json().operation.response).toEqual(first.json().grant);
    expect(() => new FinancialFundService(db, { now: () => NOW }).reviewGrant(body, 'another-user'))
      .toThrowError(expect.objectContaining({ code: 'FINANCIAL_OPERATION_MISMATCH' }));

    // Exact replay still returns the original answer even though the grant moved on.
    const replay = await app.inject({ method: 'POST', url: `${FUND}/grants/review`, headers, payload: body });
    expect(replay.json()).toEqual(first.json());
    // Same key with a different payload is a conflict, not a second write.
    const mismatch = await app.inject({ method: 'POST', url: `${FUND}/grants/review`, headers, payload: { ...body, ratiosBps: CHANGED } });
    expect(mismatch.statusCode).toBe(409);
    // Unknown grant is 404 and anonymous callers are rejected before any write.
    const missing = await app.inject({ method: 'POST', url: `${FUND}/grants/review`, headers, payload: { ...body, operationId: randomUUID(), grantId: 'nope' } });
    expect(missing.statusCode).toBe(404);
    // Mutating requests without the CSRF header are rejected by the guard before the session
    // check (documented in plugins/auth.ts), so an anonymous write is 403, not 401.
    const anonymous = await app.inject({ method: 'POST', url: `${FUND}/grants/review`, payload: body });
    expect(anonymous.statusCode).toBe(403);
    const anonymousNoCsrf = await app.inject({ method: 'POST', url: `${FUND}/grants/review`, headers: { 'x-requested-with': 'fetch' }, payload: body });
    expect(anonymousNoCsrf.statusCode).toBe(401);
    expect(db.prepare('SELECT COUNT(*) AS c FROM financial_fund_grant_revisions').get()).toEqual({ c: 2 });
  });
});
