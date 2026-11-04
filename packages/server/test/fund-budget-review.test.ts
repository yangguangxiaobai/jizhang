import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
import type { Db } from '../src/db/index.js';
import { salarySourceToken } from '../src/services/financial-planning-types.js';
import { reviewLegacyFundGrant, type LegacyFundGrantReview } from '../src/services/financial-fund-review.js';
import { FinancialFundService } from '../src/services/financial-fund-service.js';

const ratios = { growth: 2500, reserve: 1500, essentials: 5000, joy: 1000 };
const operationId = '00000000-0000-0000-0000-000000000001';
let db: Db;

function source(id: string) {
  const row = db.prepare('SELECT id,amount_cents,date,account_id FROM salary_records WHERE id=?').get(id) as {
    id: string; amount_cents: number; date: number; account_id: string;
  };
  return { salaryId: id, expectedSourceToken: salarySourceToken(row) };
}
function request(): LegacyFundGrantReview {
  return { actorId: 'actor', operationId, expectedRevision: 1, grantId: 'legacy-group:p', ratiosBps: ratios,
    sources: [source('s1'), source('s2')] };
}
function review(input = request()) { return reviewLegacyFundGrant(db, input, 300); }
function count(table: string) { return (db.prepare(`SELECT count(*) n FROM ${table}`).get() as { n: number }).n; }
function code(fn: () => unknown, expected: string) {
  try { fn(); throw new Error('expected failure'); } catch (error) { expect(error).toMatchObject({ code: expected }); }
}

beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db, null);
  const insert = db.prepare(`INSERT INTO salary_records (id,amount_cents,date,note,deleted,updated_at,account_id)
    VALUES (?,1,946684800100,'',0,1,'a')`);
  insert.run('s1'); insert.run('s2');
  const refs = [source('s1'), source('s2')];
  const snapshots = refs.map((ref) => ({ salaryId: ref.salaryId, amountCents: 1, date: 946684800100,
    accountId: 'a', sourceToken: ref.expectedSourceToken, confirmedAt: 200 }));
  db.prepare("INSERT INTO financial_fund_grants VALUES ('legacy-group:p','legacy-group','p',1,'review-required')").run();
  db.prepare("INSERT INTO financial_fund_grant_revisions VALUES ('legacy-group:p',1,2,?,?,?,NULL,NULL,200,'legacy-confirmed-group')")
    .run(JSON.stringify(ratios), JSON.stringify({ growth: 1, reserve: 0, essentials: 1, joy: 0 }), JSON.stringify(snapshots));
  for (const ref of refs) db.prepare("INSERT INTO financial_fund_grant_sources VALUES (?,'legacy-group:p',?,1,946684800100,'a','review-required')").run(ref.salaryId, ref.expectedSourceToken);
});
afterEach(() => db.close());

describe('unclaimed single salary review', () => {
  function setup() {
    db.prepare("INSERT INTO salary_records (id,amount_cents,date,note,deleted,updated_at,account_id) VALUES ('single',100000,1,'',0,1,'a')").run();
    db.prepare("INSERT INTO financial_fund_migration_issues VALUES ('salary','single','unallocated','{}','open')").run();
    const body = { operationId, expectedRevision: 0, ratiosBps: ratios, sources: [source('single')] };
    const service = new FinancialFundService(db, { now: () => 300, serverTimeZone: 'UTC' });
    return { body, service };
  }
  it('claims once, preserves source and returns current issue token', () => {
    const { body, service } = setup();
    expect(service.listIssues(50, 0).items).toContainEqual(expect.objectContaining({ sourceId: 'single', source: {
      salaryId: 'single', amountCents: 100000, date: 1, accountId: 'a', sourceToken: body.sources[0]!.expectedSourceToken,
    } }));
    const salaryBefore = db.prepare("SELECT * FROM salary_records WHERE id='single'").get();
    const result = service.reviewGrant(body, 'actor');
    expect(result.grant).toMatchObject({ grantId: 'salary:single', revision: 1, sourceAmountCents: 100000,
      targets: { growth: 25000, reserve: 15000, essentials: 50000, joy: 10000 } });
    expect(db.prepare("SELECT * FROM salary_records WHERE id='single'").get()).toEqual(salaryBefore);
    expect(db.prepare("SELECT status FROM financial_fund_migration_issues WHERE source_id='single'").get()).toEqual({status:'resolved'});
    expect(service.getSummary().balances).toEqual({ growth: 25000, reserve: 15000, essentials: 50000, joy: 10000 });
    db.prepare("UPDATE salary_records SET amount_cents=5 WHERE id='single'").run();
    expect(service.reviewGrant(body, 'actor')).toEqual(result);
    code(() => service.reviewGrant(body, 'another'), 'FINANCIAL_OPERATION_MISMATCH');
    code(() => service.reviewGrant({ ...body, sources: [{ ...body.sources[0], extra: 1 }] }, 'actor'), 'FINANCIAL_OPERATION_MISMATCH');
    expect(count('financial_fund_grants')).toBe(2);
  });
  it('requires current config revision but freezes explicitly selected ratios', () => {
    const { body, service } = setup();
    service.updateConfig({ operationId: '00000000-0000-0000-0000-000000000002', expectedRevision: 0,
      ratiosBps: { growth: 10000, reserve: 0, essentials: 0, joy: 0 }, timeZone: 'UTC' }, 'actor');
    code(() => service.reviewGrant(body, 'actor'), 'FINANCIAL_REVISION_CONFLICT');
    const result = service.reviewGrant({ ...body, expectedRevision: 1 }, 'actor');
    expect(result.grant.ratiosBps).toEqual(ratios);
    expect(result.grant.targets).toEqual({ growth: 25000, reserve: 15000, essentials: 50000, joy: 10000 });
  });
  it('does not present stale, deleted or claimed issues as reviewable', () => {
    const { body, service } = setup();
    db.prepare("UPDATE salary_records SET deleted=1 WHERE id='single'").run();
    expect(service.listIssues(50, 0).items[0]).not.toHaveProperty('source');
    db.prepare("UPDATE salary_records SET deleted=0,date=2 WHERE id='single'").run();
    expect(service.listIssues(50, 0).items[0]?.source?.sourceToken).not.toBe(body.sources[0]!.expectedSourceToken);
    db.prepare("UPDATE salary_records SET date=1 WHERE id='single'").run();
    service.reviewGrant(body, 'actor');
    expect(service.listIssues(50, 0).items[0]).not.toHaveProperty('source');
  });
  it('checks config revision, source token, liveness, ownership and rolls back failures', () => {
    const { body, service } = setup();
    const run = (input: unknown) => service.reviewGrant(input, 'actor');
    code(() => run({ ...body, expectedRevision: 1 }), 'FINANCIAL_REVISION_CONFLICT');
    code(() => run({ ...body, sources: [...body.sources, ...body.sources] }), 'FINANCIAL_INVALID');
    db.prepare("UPDATE salary_records SET amount_cents=3 WHERE id='single'").run();
    code(() => run(body), 'FINANCIAL_SOURCE_CHANGED');
    db.prepare("UPDATE salary_records SET amount_cents=100000,deleted=1 WHERE id='single'").run();
    code(() => run(body), 'FINANCIAL_SOURCE_CHANGED');
    expect(count('financial_operations')).toBe(0);
    db.prepare("UPDATE salary_records SET deleted=0 WHERE id='single'").run();
    db.exec("CREATE TRIGGER reject_operation BEFORE INSERT ON financial_operations BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    expect(() => run(body)).toThrow();
    expect(count('financial_fund_grants')).toBe(1);
    expect(count('financial_fund_grant_sources')).toBe(2);
    expect(db.prepare("SELECT status FROM financial_fund_migration_issues WHERE source_id='single'").get()).toEqual({status:'open'});
    db.exec('DROP TRIGGER reject_operation');
    run(body);
    code(() => run({ ...body, operationId: '00000000-0000-0000-0000-000000000002' }), 'FINANCIAL_SOURCE_CHANGED');
    expect(count('financial_fund_grant_sources')).toBe(3);
  });
});

describe('explicit legacy aggregate review', () => {
  it('allocates the two-cent aggregate once, preserving old evidence and ledger facts', () => {
    const before = db.prepare('SELECT * FROM salary_records ORDER BY id').all();
    const old = db.prepare('SELECT * FROM financial_fund_grant_revisions WHERE revision=1').get();
    const result = review();
    expect(result.response).toMatchObject({ grantId: 'legacy-group:p', revision: 2, sourceAmountCents: 2,
      targets: { growth: 1, reserve: 0, essentials: 1, joy: 0 } });
    expect(db.prepare('SELECT * FROM salary_records ORDER BY id').all()).toEqual(before);
    expect(db.prepare('SELECT * FROM financial_fund_grant_revisions WHERE revision=1').get()).toEqual(old);
    expect(count('financial_fund_grant_revisions')).toBe(2);
    expect(db.prepare("SELECT status FROM financial_fund_grants WHERE id='legacy-group:p'").get()).toEqual({status:'active'});
  });
  it('replays exact response before source validation; changed payload and actor cannot replay', () => {
    const input = request(); const first = review(input);
    db.prepare("UPDATE salary_records SET amount_cents=3 WHERE id='s1'").run();
    expect(review(input)).toEqual(first);
    code(() => review({ ...input, expectedRevision: 2 }), 'FINANCIAL_OPERATION_MISMATCH');
    code(() => review({ ...input, actorId: 'another' }), 'FINANCIAL_OPERATION_MISMATCH');
    expect(count('financial_fund_grant_revisions')).toBe(2);
  });
  it('rejects stale grant revision without consuming the key', () => {
    const input = request();
    code(() => review({ ...input, expectedRevision: 2 }), 'FINANCIAL_REVISION_CONFLICT');
    expect(count('financial_operations')).toBe(0);
    expect(review(input).response.revision).toBe(2);
  });
  it('rejects changed, deleted or missing sources and competing membership', () => {
    const input = request();
    db.prepare("UPDATE salary_records SET amount_cents=2 WHERE id='s1'").run();
    code(() => review(input), 'FINANCIAL_SOURCE_CHANGED');
    db.prepare("UPDATE salary_records SET amount_cents=1,deleted=1 WHERE id='s1'").run();
    code(() => review(input), 'FINANCIAL_SOURCE_CHANGED');
    db.prepare("DELETE FROM salary_records WHERE id='s1'").run();
    code(() => review(input), 'FINANCIAL_SOURCE_CHANGED');
    expect(count('financial_operations')).toBe(0);
  });
  it('refuses missing, duplicate, competing members and ratio substitution', () => {
    const input = request();
    code(() => review({ ...input, sources: [input.sources[0]!] }), 'FINANCIAL_SOURCE_CHANGED');
    code(() => review({ ...input, sources: [input.sources[0]!, input.sources[0]!] }), 'FINANCIAL_INVALID');
    code(() => review({ ...input, ratiosBps: { growth: 10000, reserve: 0, essentials: 0, joy: 0 } }), 'FINANCIAL_SOURCE_CHANGED');
    db.prepare("UPDATE financial_fund_grant_sources SET grant_id='competing' WHERE salary_id='s2'").run();
    code(() => review(input), 'FINANCIAL_SOURCE_CHANGED');
    expect(count('financial_operations')).toBe(0);
  });
  it('rolls back partial changes and leaves the key reusable when operation persistence fails', () => {
    const input = request();
    db.exec("CREATE TRIGGER reject_operation BEFORE INSERT ON financial_operations BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    expect(() => review(input)).toThrow();
    expect(count('financial_fund_grant_revisions')).toBe(1);
    expect(db.prepare("SELECT active_revision,status FROM financial_fund_grants WHERE id='legacy-group:p'").get()).toEqual({active_revision:1,status:'review-required'});
    expect(count('financial_operations')).toBe(0);
    db.exec('DROP TRIGGER reject_operation');
    expect(review(input).response.revision).toBe(2);
  });
});
