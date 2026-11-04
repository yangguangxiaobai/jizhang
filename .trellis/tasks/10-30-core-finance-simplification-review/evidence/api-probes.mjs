// Run from the repository root: node .trellis/tasks/10-30-core-finance-simplification-review/evidence/api-probes.mjs
// Uses only an in-memory synthetic database and app.inject(); no listener or live ledger.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';

const root = new URL('../../../../', import.meta.url);
const requireServer = createRequire(new URL('packages/server/package.json', root));
const Database = requireServer('better-sqlite3');
const { buildApp } = await import(new URL('packages/server/dist/app.js', root));
const { loadConfig } = await import(new URL('packages/server/dist/config.js', root));
const { initializeDatabase } = await import(new URL('packages/server/dist/db/index.js', root));
const { AuthService } = await import(new URL('packages/server/dist/services/auth-service.js', root));
const { resolveStatsWindow } = await import(new URL('packages/shared/dist/index.js', root));
const now = Date.parse('2026-10-29T04:00:00Z');
const db = new Database(':memory:');
db.pragma('foreign_keys = ON');
initializeDatabase(db, null);
const config = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', JIZHANG_USERNAME: 'review-fixture', JIZHANG_PASSWORD_HASH: 'unused', DATA_DIR: './data' });
const auth = new AuthService(db, { sessionTtlDays: config.sessionTtlDays, now: () => now });
await auth.setPassword('review-fixture', 'isolated-review-fixture');
const app = buildApp({ config, db, authService: auth, secureCookies: false, now: () => now });
await app.ready();
try {
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { 'x-requested-with': 'fetch' }, payload: { username: 'review-fixture', password: 'isolated-review-fixture' } });
  assert.equal(login.statusCode, 200);
  const cookie = login.cookies.map(c => `${c.name}=${c.value}`).join('; ');
  async function call(method, url, payload, expected = 200) {
    const response = await app.inject({ method, url, headers: { 'x-requested-with': 'fetch', cookie }, ...(payload === undefined ? {} : { payload }) });
    assert.equal(response.statusCode, expected, `${method} ${url}: ${response.body}`);
    return response.json();
  }
  const salaryCount = () => db.prepare('SELECT COUNT(*) AS count FROM salary_records').get().count;
  const salaryInput = { amountCents: 1_000_000, date: Date.parse('2026-10-10T04:00:00Z'), accountId: 'builtin-default-account', note: 'Synthetic Android wire payload' };
  const beforeUnkeyed = salaryCount();
  const first = await call('POST', '/api/v1/salaries', salaryInput, 201);
  const second = await call('POST', '/api/v1/salaries', salaryInput, 201);
  const unkeyed = { wireHasOperationId: Object.hasOwn(salaryInput, 'operationId'), rowsAdded: salaryCount() - beforeUnkeyed, differentSalaryIds: first.id !== second.id };
  assert.deepEqual(unkeyed, { wireHasOperationId: false, rowsAdded: 2, differentSalaryIds: true });

  const beforeKeyed = salaryCount();
  const keyedInput = { ...salaryInput, operationId: randomUUID() };
  const keyedFirst = await call('POST', '/api/v1/salaries', keyedInput, 201);
  const keyedSecond = await call('POST', '/api/v1/salaries', keyedInput, 201);
  const keyed = { rowsAdded: salaryCount() - beforeKeyed, sameSalaryId: keyedFirst.id === keyedSecond.id };
  assert.deepEqual(keyed, { rowsAdded: 1, sameSalaryId: true });

  const base = '/api/v1/financial-planning';
  const configBefore = await call('GET', `${base}/config`);
  await call('PUT', `${base}/config`, { operationId: randomUUID(), expectedRevision: configBefore.config.revision, enabled: true, ratiosBps: { growth: 2500, reserve: 1500, essentials: 5000, joy: 1000 }, essentialMonthlyCents: 500_000, targetMonths: 5, cycle: { kind: 'natural-month' }, timeZone: 'Asia/Shanghai' });
  const historicalSalary = await call('POST', '/api/v1/salaries', { ...salaryInput, date: Date.parse('2026-09-10T04:00:00Z'), operationId: randomUUID() }, 201);
  const sources = await call('GET', `${base}/sources/salaries?groupMonth=2026-09&timeZone=Asia%2FShanghai`);
  const selected = sources.items.find(s => s.salaryId === historicalSalary.id);
  assert.ok(selected);
  const currentConfig = await call('GET', `${base}/config`);
  const mapping = await call('GET', `${base}/category-rules`);
  const proposal = { periodId: null, expectedRevision: 0, expectedConfigRevision: currentConfig.config.revision, expectedMappingRevision: mapping.mapping.revision, selectedSources: [{ salaryId: selected.salaryId, expectedSourceToken: selected.sourceToken }], mappingPolicy: 'preserve', reason: 'salary-confirmation' };
  const preview = await call('POST', `${base}/periods/preview`, { proposal });
  await call('POST', `${base}/periods/confirm`, { operationId: randomUUID(), proposal, previewToken: preview.preview.previewToken });
  const currentPlan = await call('GET', '/api/v1/monthly-plan');
  assert.equal(currentPlan.state, 'no-period');

  const ledgerCounts = () => Object.fromEntries(['salary_records', 'transactions', 'transfers'].map(table => [table, db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));
  const ledgerBeforeGoals = ledgerCounts();
  const balancesBeforeGoals = await call('GET', '/api/v1/accounts/balances');
  const openingDate = Date.parse('2026-10-01T00:00:00Z');
  let goals = await call('PUT', '/api/v1/financial-goals/opening', { goal: 'reserve', openingCents: 1_200_000, openingAt: openingDate, expectedRevision: 0, operationId: randomUUID() });
  const historicalReference = { currentMonthlyPlanState: currentPlan.state, referenceCents: goals.progress.reserve.monthlyReferenceCents, conditionalContributionCount: goals.progress.reserve.conditionalContributionCount };
  assert.deepEqual(historicalReference, { currentMonthlyPlanState: 'no-period', referenceCents: 150_000, conditionalContributionCount: 9 });
  async function goalEntry(goal, kind, amountCents, date) {
    const payload = { goal, kind, amountCents, date: Date.parse(date), note: 'Synthetic confirmed progress', expectedRevision: goals.revision, operationId: randomUUID() };
    goals = await call('POST', '/api/v1/financial-goals/entries', payload, 201);
    return payload;
  }
  await goalEntry('reserve', 'deposit', 150_000, '2026-10-10T04:00:00Z');
  await goalEntry('reserve', 'withdrawal', 100_000, '2026-10-20T04:00:00Z');
  goals = await call('PUT', '/api/v1/financial-goals/opening', { goal: 'investment', openingCents: 500_000, openingAt: openingDate, expectedRevision: goals.revision, operationId: randomUUID() });
  await goalEntry('investment', 'deposit', 250_000, '2026-10-10T04:00:00Z');
  const lastEntryPayload = await goalEntry('investment', 'withdrawal', 100_000, '2026-10-20T04:00:00Z');
  const beforeReplay = db.prepare('SELECT COUNT(*) AS count FROM manual_goal_entries').get().count;
  await call('POST', '/api/v1/financial-goals/entries', lastEntryPayload, 201);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM manual_goal_entries').get().count, beforeReplay);
  const periodGoals = await call('GET', `/api/v1/financial-goals?from=${Date.parse('2026-09-30T16:00:00Z')}&to=${Date.parse('2026-10-31T16:00:00Z')}`);
  assert.deepEqual(ledgerCounts(), ledgerBeforeGoals);
  assert.deepEqual(await call('GET', '/api/v1/accounts/balances'), balancesBeforeGoals);
  const manualProgress = { reserveBalanceCents: periodGoals.progress.reserve.balanceCents, reserveNetCents: periodGoals.window.reserve.netAdditionsCents, investmentPrincipalCents: periodGoals.progress.investment.balanceCents, investmentNetCents: periodGoals.window.investment.netAdditionsCents, ledgerCountsUnchanged: true, accountBalancesUnchanged: true };
  assert.deepEqual(manualProgress, { reserveBalanceCents: 1_250_000, reserveNetCents: 50_000, investmentPrincipalCents: 650_000, investmentNetCents: 150_000, ledgerCountsUnchanged: true, accountBalancesUnchanged: true });

  const rolling = resolveStatsWindow('last30', null, now, 'Asia/Shanghai');
  const repeated = resolveStatsWindow('month', '2009-11', now, 'America/St_Johns');
  const monthAt = instant => new Intl.DateTimeFormat('en-US', { timeZone: 'America/St_Johns', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(instant));
  const windows = { shanghaiRollingFrom: new Date(rolling.from).toISOString(), shanghaiRollingTo: new Date(rolling.to).toISOString(), repeatedMonthFrom: new Date(repeated.from).toISOString(), firstMidnightLocal: monthAt('2009-11-01T02:30:00Z'), afterRollbackLocal: monthAt('2009-11-01T02:31:00Z') };
  assert.equal(windows.shanghaiRollingFrom, '2026-09-29T04:00:00.000Z');
  assert.equal(windows.shanghaiRollingTo, '2026-10-29T04:00:00.000Z');
  const result = { date: '2026-10-30', environment: 'in-memory SQLite + app.inject, freshly built current source', salaryWithoutWireKey: unkeyed, salaryWithWireKey: keyed, historicalReserveReference: historicalReference, manualProgress, windows };
  const output = JSON.stringify(result, null, 2);
  console.log(output);
  await writeFile(new URL('api-probes.json', import.meta.url), output + '\n');
} finally {
  await app.close();
  db.close();
}
