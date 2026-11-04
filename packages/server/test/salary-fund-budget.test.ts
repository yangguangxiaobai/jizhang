import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeDatabase, type Db } from '../src/db/index.js';
import { SalaryService } from '../src/services/salary-service.js';
import { AccountBalanceService } from '../src/services/account-balance-service.js';
import { FinancialFundService } from '../src/services/financial-fund-service.js';
import { salarySourceToken } from '../src/services/financial-planning-types.js';
import { runFinancialOperation } from '../src/services/financial-operation-store.js';

const now = Date.UTC(2026, 9, 27);
const accountId = 'builtin-default-account';
const ratios = { growth: 2500, reserve: 1500, essentials: 5000, joy: 1000 };
let db: Db;
let salary: SalaryService;
let funds: FinancialFundService;
const input = () => ({ contractVersion: 1, expectedFundConfigRevision: 0, operationId: randomUUID(), amountCents: 100000, date: now, note: '', accountId });
const count = (table: string) => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
function expectCode(fn: () => unknown, code: string) {
  try { fn(); throw new Error('Expected failure'); } catch (error) { expect(error).toMatchObject({ code }); }
}

beforeEach(() => {
  db = new Database(':memory:');
  initializeDatabase(db, null);
  salary = new SalaryService(db, { now: () => now, actorId: 'actor' });
  funds = new FinancialFundService(db, { now: () => now, serverTimeZone: 'UTC' });
});
afterEach(() => db.close());

describe('salary four-purpose funding', () => {
  it('salaryNeedsNoModuleTemplate and lostResponseReplaysOneFundGrant', () => {
    db.prepare('UPDATE budget_templates SET deleted=1').run();
    const request = input();
    const first = salary.create(request);
    expect(first).toMatchObject({ amountCents: 100000, fundGrant: { revision: 1, ratiosBps: ratios, targets: { growth: 25000, reserve: 15000, essentials: 50000, joy: 10000 } } });
    expect(salary.create(request)).toEqual(first);
    expect(() => salary.create({ ...request, expectedFundConfigRevision: 1 })).toThrow();
    expect(() => salary.create(request, { actorId: 'different' })).toThrow();
    expect(count('salary_records')).toBe(1);
    expect(count('financial_fund_grants')).toBe(1);
    expect(count('budget_allocations')).toBe(0);
    expect(count('transactions')).toBe(0);
    expect(funds.getSummary().balances).toEqual({ growth: 25000, reserve: 15000, essentials: 50000, joy: 10000 });
  });
  it('rejects legacy module allocation for fund salaries without writing, while preserving historical reads', () => {
    const created = salary.create(input());
    const before = salary.getByIdOrThrow(created.id);
    const beforeGrant = db.prepare('SELECT * FROM financial_fund_grant_revisions').all();
    const beforeOperations = count('financial_operations');
    const allocation = [{ categoryId: 'builtin-expense-food', amountCents: 100000 }];
    expectCode(() => salary.replaceAllocations(created.id, allocation), 'FINANCIAL_INVALID');
    expect(count('budget_allocations')).toBe(0);
    expect(count('financial_operations')).toBe(beforeOperations);
    expect(db.prepare('SELECT * FROM financial_fund_grant_revisions').all()).toEqual(beforeGrant);
    expect(salary.getByIdOrThrow(created.id)).toEqual(before);

    db.prepare('INSERT INTO salary_records (id,amount_cents,date,note,account_id,deleted,updated_at) VALUES (?, ?, ?, ?, ?, 0, ?)').run('historical', 100000, now, '', accountId, now);
    db.prepare('INSERT INTO budget_allocations (id,salary_record_id,date,allocations_json,deleted,updated_at) VALUES (?,?,?,?,0,?)').run('old-allocation', 'historical', now, JSON.stringify(allocation), now);
    expect(salary.getByIdOrThrow('historical')).toMatchObject({ allocationId: 'old-allocation', allocations: allocation });
  });
  it('newRatiosDoNotRewriteOldGrant and salaryEditUsesFrozenRatios', () => {
    const first = salary.create(input());
    funds.updateConfig({ operationId: randomUUID(), expectedRevision: 0, ratiosBps: { growth: 10000, reserve: 0, essentials: 0, joy: 0 }, timeZone: 'UTC' }, 'actor');
    expect(funds.getSummary().balances.growth).toBe(25000);
    const edit = { contractVersion: 1, expectedGrantRevision: 1, operationId: randomUUID(), amountCents: 200000 };
    const edited = salary.update(first.id, edit);
    expect(salary.update(first.id, edit)).toEqual(edited);
    expect(() => salary.update(first.id, { ...edit, amountCents: 300000 })).toThrow();
    expect(funds.getSummary().balances).toEqual({ growth: 50000, reserve: 30000, essentials: 100000, joy: 20000 });
    expect(count('financial_fund_grant_revisions')).toBe(2);
  });
  it('crossMonthFundingCarriesBalances and credits account only once per salary', () => {
    const previous = { ...input(), date: now - 35 * 86400000 };
    const first = salary.create(previous);
    salary.create(previous);
    salary.create(input());
    expect(funds.getSummary().balances).toEqual({ growth: 50000, reserve: 30000, essentials: 100000, joy: 20000 });
    const balance = new AccountBalanceService(db).balances().items.find((item) => item.accountId === accountId);
    expect(balance?.salaryCents).toBe(200000);
    expect(count('transactions')).toBe(0);
    salary.softDelete(first.id, { contractVersion: 1, expectedGrantRevision: 1, operationId: randomUUID() });
    expect(new AccountBalanceService(db).balances().items.find((item) => item.accountId === accountId)?.salaryCents).toBe(100000);
  });
  it('note-only edits advance CAS and reject stale edits and deletes', () => {
    const first = salary.create(input());
    const edit = { contractVersion: 1, expectedGrantRevision: 1, operationId: randomUUID(), note: 'corrected' };
    expect(salary.update(first.id, edit).fundGrant?.revision).toBe(2);
    expect(salary.update(first.id, edit).fundGrant?.revision).toBe(2);
    expectCode(() => salary.update(first.id, { ...edit, operationId: randomUUID(), note: 'stale' }), 'FINANCIAL_REVISION_CONFLICT');
    expectCode(() => salary.softDelete(first.id, { contractVersion: 1, expectedGrantRevision: 1, operationId: randomUUID() }), 'FINANCIAL_REVISION_CONFLICT');
    expect(salary.getByIdOrThrow(first.id).note).toBe('corrected');
  });
  it('uses the injected timezone for virtual config validation', () => {
    const invalidZone = new SalaryService(db, { now: () => now, actorId: 'actor', serverTimeZone: 'not-a-zone' });
    expectCode(() => invalidZone.create(input()), 'FINANCIAL_UNAVAILABLE');
    expect(count('salary_records')).toBe(0);
  });
  it('rolls back salary, grant and operation when operation persistence fails', () => {
    const request = input();
    db.exec("CREATE TRIGGER reject_salary_op BEFORE INSERT ON financial_operations BEGIN SELECT RAISE(ABORT, 'test'); END");
    expect(() => salary.create(request)).toThrow();
    expect(count('salary_records')).toBe(0);
    expect(count('financial_fund_grants')).toBe(0);
    expect(count('financial_fund_grant_sources')).toBe(0);
    expect(count('financial_operations')).toBe(0);
    db.exec('DROP TRIGGER reject_salary_op');
    salary.create(request);
    expect(count('financial_fund_grants')).toBe(1);
  });
  it('salaryDeleteRemovesFundingOnce', () => {
    const first = salary.create(input());
    const deletion = { contractVersion: 1, expectedGrantRevision: 1, operationId: randomUUID() };
    salary.softDelete(first.id, deletion);
    salary.softDelete(first.id, deletion);
    expect(funds.getSummary().balances).toEqual({ growth: 0, reserve: 0, essentials: 0, joy: 0 });
    expect(count('financial_fund_grants')).toBe(1);
  });
  it('legacy aggregate edit and revert stays review-required', () => {
    db.prepare('INSERT INTO salary_records (id,amount_cents,date,note,account_id,deleted,updated_at) VALUES (?, ?, ?, ?, ?, 0, ?)').run('old', 100000, now, '', accountId, now);
    const token = salarySourceToken({ id: 'old', amount_cents: 100000, date: now, account_id: accountId });
    const snapshots = [{ salaryId: 'old', amountCents: 100000, date: now, accountId, sourceToken: token, confirmedAt: now }];
    db.prepare("INSERT INTO financial_fund_grants VALUES ('legacy-group:p','legacy-group','p',1,'active')").run();
    db.prepare("INSERT INTO financial_fund_grant_revisions VALUES ('legacy-group:p',1,100000,?,?,?,NULL,NULL,?,'legacy-confirmed-group')").run(JSON.stringify(ratios), JSON.stringify({ growth: 25000, reserve: 15000, essentials: 50000, joy: 10000 }), JSON.stringify(snapshots), now);
    db.prepare("INSERT INTO financial_fund_grant_sources VALUES ('old','legacy-group:p',?,100000,?,?,'active')").run(token, now, accountId);
    salary.update('old', { date: now - 86400000 });
    salary.update('old', { date: now });
    expect(db.prepare("SELECT status FROM financial_fund_grants WHERE id='legacy-group:p'").get()).toEqual({ status: 'review-required' });
    expect(salary.getByIdOrThrow('old').fundGrant?.status).toBe('review-required');
    expect(funds.getSummary().coverage.complete).toBe(false);
    expect(funds.getSummary().balances.essentials).toBe(0);
    salary.softDelete('old');
    db.prepare("UPDATE salary_records SET deleted=0 WHERE id='old'").run();
    expect(db.prepare("SELECT status FROM financial_fund_grants WHERE id='legacy-group:p'").get()).toEqual({ status: 'review-required' });
    expect(salary.getByIdOrThrow('old').fundGrant?.status).toBe('review-required');
    expect(funds.getSummary().coverage.complete).toBe(false);
  });
  it('replays a committed legacy response without executing a retired write', () => {
    const operationId = randomUUID();
    const request = { operationId, amountCents: 100000, date: now, note: '', accountId };
    const original = { id: 'historic', amountCents: 100000, date: now, note: '', accountId, updatedAt: now, allocationId: 'old-allocation', allocations: [] };
    runFinancialOperation(db, { operationId, actorId: 'actor', method: 'POST', resource: '/api/v1/salaries', canonicalPayload: { amountCents: request.amountCents, date: request.date, note: request.note, accountId: request.accountId, templateId: undefined, allocations: undefined }, now }, () => ({ statusCode: 201, response: original }));
    expect(salary.create(request)).toEqual(original);
    expect(() => salary.create(request, { actorId: 'other' })).toThrow();
    expect(count('salary_records')).toBe(0);
  });
  it('legacyUnkeyedPendingNeverAutoPosts', () => {
    expect(() => salary.create({ amountCents: 100000, date: now, accountId })).toThrow();
    expect(count('salary_records')).toBe(0);
  });
});
