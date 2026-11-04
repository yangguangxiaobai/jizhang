import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db/migrate.js';
import type { Db } from '../src/db/index.js';
import { salarySourceToken } from '../src/services/financial-planning-types.js';
import { replaceFinancialRefundSplits } from '../src/services/financial-source-lifecycle.js';
import { readFundSummary } from '../src/services/financial-fund-summary.js';

let db: Db;
const ratios = { growth: 2500, reserve: 1500, essentials: 5000, joy: 1000 };
const targets = { growth: 25000, reserve: 15000, essentials: 50000, joy: 10000 };
beforeEach(() => { db = new Database(':memory:'); runMigrations(db, null); });
afterEach(() => db.close());
function grant(id: string, date: number) {
  const salary = { id, amount_cents: 100000, date, account_id: 'a' };
  db.prepare("INSERT INTO salary_records (id,amount_cents,date,note,deleted,updated_at,account_id) VALUES (?,100000,?,'',0,1,'a')").run(id, date);
  const source = { salaryId: id, amountCents: 100000, date, accountId: 'a', sourceToken: salarySourceToken(salary), confirmedAt: 1 };
  db.prepare("INSERT INTO financial_fund_grants VALUES (?, 'salary', ?, 1, 'active')").run(id, id);
  db.prepare("INSERT INTO financial_fund_grant_revisions VALUES (?,1,100000,?,?,?,NULL,NULL,1,'salary')").run(id, JSON.stringify(ratios), JSON.stringify(targets), JSON.stringify([source]));
  db.prepare("INSERT INTO financial_fund_grant_sources VALUES (?,?,?,?,?,?,'active')").run(id, id, source.sourceToken, 100000, date, 'a');
}
function tx(id: string, type: number, amount: number, refund = 0, purpose: string | null = 'essentials', date = 1) {
  db.prepare("INSERT INTO transactions (id,type,amount_cents,category_id,account_id,date,note,tags_json,is_refund,deleted,updated_at) VALUES (?,?,?,'c','a',?,'','[]',?,0,1)").run(id, type, amount, date, refund);
  db.prepare("INSERT INTO financial_fund_purposes VALUES (?,?,1,'explicit','{}')").run(id, purpose);
}
function refund(id = 'r', original = 'e', amount = 3000, originalAmount = 12000) {
  replaceFinancialRefundSplits(db, { refundTxId: id, splits: [{ originalTransactionId: original, amountCents: amount }],
    refundFacts: { amountCents: amount, type: 1, isRefund: true }, originalFacts: [{ transactionId: original, facts: { amountCents: originalAmount, type: 0, isRefund: false } }], operationId: null, now: 1 });
}
describe('lifetime fund summary', () => {
  it('carries all months and credits a confirmed refund only once', () => {
    grant('jan', 1); grant('feb', 3000000000); tx('e', 0, 12000); tx('r', 1, 3000, 1, null); refund();
    const result = readFundSummary(db, 2);
    expect(result.balances).toEqual({ growth: 50000, reserve: 30000, essentials: 91000, joy: 20000 });
    expect(result.totals.refunded.essentials).toBe(3000); expect(result.coverage.complete).toBe(true);
    expect(readFundSummary(db, 4000000000).snapshotToken).toBe(result.snapshotToken);
    expect(readFundSummary(db, 4000000000).balances).toEqual(result.balances);
  });
  it('keeps unclaimed history incomplete and ignores resolved or deleted transaction issues', () => {
    db.prepare("INSERT INTO salary_records (id,amount_cents,date,note,deleted,updated_at,account_id) VALUES ('s',42,1,'',0,1,'a')").run();
    tx('e', 0, 10); tx('gone', 0, 5, 0, null); db.exec("UPDATE transactions SET deleted=1 WHERE id='gone'");
    db.exec("INSERT INTO financial_fund_migration_issues VALUES ('salary','s','unallocated','{}','open'),('transaction','e','unassigned','{}','open'),('transaction','gone','unassigned','{}','open')");
    const coverage = readFundSummary(db, 1).coverage;
    expect(coverage.complete).toBe(false); expect(coverage.unallocatedSalaryCount).toBe(1); expect(coverage.unallocatedSalaryCents).toBe(42); expect(coverage.issueCount).toBe(0);
  });
  it('rejects a stale grant without double counting its salary', () => {
    grant('s', 1); db.exec("UPDATE salary_records SET amount_cents=90000 WHERE id='s'");
    const x = readFundSummary(db, 1); expect(x.balances.essentials).toBe(0); expect(x.coverage.unallocatedSalaryCount).toBe(1); expect(x.coverage.unallocatedSalaryCents).toBe(90000);
  });
  it('invalidates the whole split set when any sibling snapshot is stale and allows reconfirmation', () => {
    tx('a', 0, 5000); tx('b', 0, 5000); tx('r', 1, 5000, 1, null);
    replaceFinancialRefundSplits(db, { refundTxId:'r', splits:[{originalTransactionId:'a',amountCents:2000},{originalTransactionId:'b',amountCents:3000}], refundFacts:{amountCents:5000,type:1,isRefund:true}, originalFacts:[{transactionId:'a',facts:{amountCents:5000,type:0,isRefund:false}},{transactionId:'b',facts:{amountCents:5000,type:0,isRefund:false}}],operationId:null,now:1 });
    db.exec("UPDATE transactions SET amount_cents=6000 WHERE id='b'");
    expect(readFundSummary(db, 1).totals.refunded.essentials).toBe(0);
    replaceFinancialRefundSplits(db, { refundTxId:'r', splits:[{originalTransactionId:'a',amountCents:2000},{originalTransactionId:'b',amountCents:3000}], refundFacts:{amountCents:5000,type:1,isRefund:true}, originalFacts:[{transactionId:'a',facts:{amountCents:5000,type:0,isRefund:false}},{transactionId:'b',facts:{amountCents:6000,type:0,isRefund:false}}],operationId:null,now:2 });
    expect(readFundSummary(db, 1).totals.refunded.essentials).toBe(5000);
  });
  it('fails closed on corrupt target JSON and protects negative balances', () => {
    tx('e', 0, 12000); expect(readFundSummary(db, 1).balances.essentials).toBe(-12000);
    grant('s', 1); db.exec("UPDATE financial_fund_grant_revisions SET targets_json='{' ");
    const x = readFundSummary(db, 1); expect(x.balances.essentials).toBe(-12000); expect(x.coverage.complete).toBe(false);
  });
  it('never credits competing refunds that together exceed the original', () => {
    tx('e', 0, 5000);
    tx('r1', 1, 4000, 1, null); tx('r2', 1, 4000, 1, null);
    const facts = (amount: number) => ({ amountCents: amount, type: 1, isRefund: true });
    replaceFinancialRefundSplits(db, { refundTxId: 'r1', splits: [{ originalTransactionId: 'e', amountCents: 4000 }],
      refundFacts: facts(4000), originalFacts: [{ transactionId: 'e', facts: { amountCents: 5000, type: 0, isRefund: false } }], operationId: null, now: 1 });
    replaceFinancialRefundSplits(db, { refundTxId: 'r2', splits: [{ originalTransactionId: 'e', amountCents: 4000 }],
      refundFacts: facts(4000), originalFacts: [{ transactionId: 'e', facts: { amountCents: 5000, type: 0, isRefund: false } }], operationId: null, now: 2 });
    const result = readFundSummary(db, 3);
    // 4000 + 4000 > 5000: the shared cap rule suppresses every implicated set rather than
    // picking a winner, so nothing is credited and coverage must say so.
    expect(result.totals.refunded.essentials).toBe(0);
    expect(result.coverage.complete).toBe(false);
    expect(result.coverage.invalidRefundCount).toBe(2);
    expect(result.coverage.unresolvedRefundCents).toBe(8000);
  });
  it('ignores stale split rows once the confirmed set was replaced or cleared', () => {
    tx('e', 0, 5000); tx('r', 1, 2000, 1, null);
    replaceFinancialRefundSplits(db, { refundTxId: 'r', splits: [{ originalTransactionId: 'e', amountCents: 2000 }],
      refundFacts: { amountCents: 2000, type: 1, isRefund: true }, originalFacts: [{ transactionId: 'e', facts: { amountCents: 5000, type: 0, isRefund: false } }], operationId: null, now: 1 });
    expect(readFundSummary(db, 1).totals.refunded.essentials).toBe(2000);
    // Clearing writes a 'cleared' set revision; the retained split row must stop counting.
    replaceFinancialRefundSplits(db, { refundTxId: 'r', splits: [], refundFacts: { amountCents: 2000, type: 1, isRefund: true }, originalFacts: [], operationId: null, now: 2 });
    const cleared = readFundSummary(db, 3);
    expect(cleared.totals.refunded.essentials).toBe(0);
    expect(cleared.coverage.complete).toBe(false);
  });
});