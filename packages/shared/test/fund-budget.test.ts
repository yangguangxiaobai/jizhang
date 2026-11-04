import { describe, expect, it } from 'vitest';

import {
  allocateFundIncomeCents,
  projectFundBalances,
  type FundProjectionInput,
} from '../src/index.js';

const ratios = { growth: 2500, reserve: 1500, essentials: 5000, joy: 1000 };
const zero = { growth: 0, reserve: 0, essentials: 0, joy: 0 };
const grant = { grantId: 'salary-grant', amounts: { growth: 25000, reserve: 15000, essentials: 50000, joy: 10000 } };
const expense = { transactionId: 'expense', type: 'expense', isRefund: false, amountCents: 12000, date: 1, purpose: 'essentials', purposeStatus: 'resolved', status: 'live' } as const;
const refund = { transactionId: 'refund', type: 'income', isRefund: true, amountCents: 3000, date: 2, purpose: 'joy', purposeStatus: 'resolved', status: 'live' } as const;
const split = { splitId: 'split', refundTransactionId: 'refund', originalTransactionId: 'expense', amountCents: 3000, validity: 'valid' } as const;
const input = (overrides: Partial<FundProjectionInput> = {}): FundProjectionInput => ({
  grants: [], transactions: [], refundSplits: [], unallocatedSalaries: [], issues: [], ...overrides,
});

describe('four-purpose allocation', () => {
  it('salaryAllocationConservesCents', () => {
    expect(allocateFundIncomeCents(100000, ratios)).toEqual(grant.amounts);
    for (const n of [0, 1, 2, 99, Number.MAX_SAFE_INTEGER]) {
      const amounts = allocateFundIncomeCents(n, ratios);
      expect(Object.values(amounts).reduce((a, b) => a + BigInt(b), 0n)).toBe(BigInt(n));
    }
  });
  it('oneCentUsesFixedLargestRemainder', () => {
    expect(allocateFundIncomeCents(1, ratios)).toEqual({ ...zero, essentials: 1 });
    expect(allocateFundIncomeCents(2, { growth: 2500, reserve: 2500, essentials: 2500, joy: 2500 })).toEqual({ growth: 1, reserve: 1, essentials: 0, joy: 0 });
  });
  it('invalidRatioSumRejects', () => {
    for (const r of [{ ...ratios, joy: 999 }, { ...ratios, joy: -1 }, { ...ratios, growth: 2500.5 }, { ...ratios, growth: 10001 }]) {
      expect(() => allocateFundIncomeCents(1, r)).toThrow();
    }
  });
  it('unsafeMoneyRejects', () => {
    for (const n of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => allocateFundIncomeCents(n, ratios)).toThrow();
    }
  });
});

describe('continuous fund projection', () => {
  it('continuousProjectionCreditsRefundOnce', () => {
    const result = projectFundBalances(input({ grants: [grant, { ...grant, grantId: 'second' }], transactions: [expense, refund], refundSplits: [split] }));
    expect(result.balances).toEqual({ growth: 50000, reserve: 30000, essentials: 91000, joy: 20000 });
    expect(result.totals).toEqual({ funded: { growth: 50000, reserve: 30000, essentials: 100000, joy: 20000 }, income: zero, grossSpent: { ...zero, essentials: 12000 }, refunded: { ...zero, essentials: 3000 } });
    expect(result.coverage.complete).toBe(true);
  });
  it('negativePurposeBalanceIsVisible', () => {
    expect(projectFundBalances(input({ transactions: [expense] })).balances.essentials).toBe(-12000);
  });
  it('credits normal income but never a refund as ordinary income', () => {
    const result = projectFundBalances(input({ transactions: [refund, { ...refund, transactionId: 'income', isRefund: false, amountCents: 5000, purpose: 'growth' }] }));
    expect(result.totals.income).toEqual({ ...zero, growth: 5000 });
    expect(result.coverage).toMatchObject({ complete: false, invalidRefundCount: 1, unresolvedRefundCents: 3000 });
  });
  it('does not credit invalid, missing or unresolved original facts', () => {
    const invalid = projectFundBalances(input({ transactions: [expense, refund], refundSplits: [{ ...split, validity: 'invalid' }] }));
    expect(invalid.totals.refunded).toEqual(zero);
    expect(invalid.coverage).toMatchObject({ complete: false, invalidRefundCount: 1, unresolvedRefundCents: 3000 });
    const missing = projectFundBalances(input({ transactions: [refund], refundSplits: [split] }));
    expect(missing.totals.refunded).toEqual(zero);
    expect(missing.coverage).toMatchObject({ complete: false, invalidRefundCount: 1, unresolvedRefundCents: 3000 });
    const unresolved = projectFundBalances(input({ transactions: [{ ...expense, purpose: null, purposeStatus: 'unresolved' }, refund], refundSplits: [split] }));
    expect(unresolved.totals.refunded).toEqual(zero);
    expect(unresolved.coverage).toMatchObject({ complete: false, unassignedTransactionCount: 1, unassignedTransactionCents: 12000, invalidRefundCount: 1, unresolvedRefundCents: 3000 });
  });
  it('invalidates the entire refund set, not merely its bad member', () => {
    const second = { ...expense, transactionId: 'expense2', purpose: 'growth' } as const;
    const result = projectFundBalances(input({ transactions: [expense, second, refund], refundSplits: [{ ...split, amountCents: 1000 }, { ...split, splitId: 's2', originalTransactionId: 'expense2', amountCents: 2000, validity: 'invalid' }] }));
    expect(result.totals.refunded).toEqual(zero);
    expect(result.coverage.unresolvedRefundCents).toBe(3000);
  });
  it('rejects duplicate IDs and refund/original pairs rather than double counting', () => {
    for (const facts of [
      input({ grants: [grant, grant] }),
      input({ transactions: [expense, expense] }),
      input({ transactions: [expense, refund], refundSplits: [split, split] }),
      input({ transactions: [expense, refund], refundSplits: [split, { ...split, splitId: 'other' }] }),
    ]) expect(() => projectFundBalances(facts)).toThrow();
  });
  it('does not credit over-cap refund sets or over-refunded originals', () => {
    const overRefund = projectFundBalances(input({ transactions: [expense, refund], refundSplits: [{ ...split, amountCents: 3001 }] }));
    expect(overRefund.totals.refunded).toEqual(zero);
    expect(overRefund.coverage.complete).toBe(false);
    const smallExpense = { ...expense, amountCents: 2000 };
    const overOriginal = projectFundBalances(input({ transactions: [smallExpense, refund], refundSplits: [split] }));
    expect(overOriginal.totals.refunded).toEqual(zero);
    expect(overOriginal.coverage.complete).toBe(false);
  });
  it('attributes only evidenced split portions and reports the rest', () => {
    const unknown = { ...expense, transactionId: 'unknown', purpose: null, purposeStatus: 'unresolved' } as const;
    const result = projectFundBalances(input({ transactions: [expense, unknown, refund], refundSplits: [{ ...split, amountCents: 1000 }, { ...split, splitId: 's2', originalTransactionId: 'unknown', amountCents: 1000 }] }));
    expect(result.totals.refunded).toEqual({ ...zero, essentials: 1000 });
    expect(result.coverage).toMatchObject({ complete: false, unresolvedRefundCents: 2000, invalidRefundCount: 1 });
  });
  it('invalidates all conflicting refund sets irrespective of ordering', () => {
    const r2 = { ...refund, transactionId: 'refund2' };
    const s2 = { ...split, splitId: 's2', refundTransactionId: 'refund2' };
    for (const splits of [[split, s2], [s2, split]]) {
      const result = projectFundBalances(input({ transactions: [{ ...expense, amountCents: 5000 }, refund, r2], refundSplits: splits }));
      expect(result.totals.refunded).toEqual(zero);
      expect(result.coverage).toMatchObject({ invalidRefundCount: 2, unresolvedRefundCents: 6000 });
    }
  });
  it('never invents a missing refund amount or credits deleted original facts', () => {
    const missing = projectFundBalances(input({ transactions: [expense], refundSplits: [split] }));
    expect(missing.coverage).toMatchObject({ complete: false, invalidRefundCount: 1, unresolvedRefundCents: 0 });
    const deleted = projectFundBalances(input({ transactions: [{ ...expense, status: 'deleted' }, refund], refundSplits: [split] }));
    expect(deleted.totals.refunded).toEqual(zero);
    expect(deleted.coverage.unresolvedRefundCents).toBe(3000);
  });
  it('ignores historical split records when a refund is deleted or becomes ordinary income', () => {
    const deleted = projectFundBalances(input({ transactions: [expense, { ...refund, status: 'deleted' }], refundSplits: [{ ...split, validity: 'invalid' }] }));
    expect(deleted.coverage).toMatchObject({ complete: true, invalidRefundCount: 0, unresolvedRefundCents: 0 });
    expect(deleted.totals.refunded).toEqual(zero);
    const converted = projectFundBalances(input({ transactions: [expense, { ...refund, isRefund: false }], refundSplits: [{ ...split, validity: 'invalid' }] }));
    expect(converted.coverage).toMatchObject({ complete: true, invalidRefundCount: 0, unresolvedRefundCents: 0 });
    expect(converted.totals.income.joy).toBe(3000);
    expect(converted.totals.refunded).toEqual(zero);
  });
  it('reports unallocated salary and issue evidence without fabricating amounts', () => {
    const result = projectFundBalances(input({ unallocatedSalaries: [{ salaryId: 'unknown', amountCents: 500 }], issues: ['stale-source'] }));
    expect(result.balances).toEqual(zero);
    expect(result.coverage).toMatchObject({ complete: false, unallocatedSalaryCount: 1, unallocatedSalaryCents: 500, issueCount: 1 });
  });
  it('rejects invalid fact amounts, contradictory purpose, and overflowed totals', () => {
    for (const amountCents of [-1, 0, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => projectFundBalances(input({ transactions: [{ ...expense, amountCents }] }))).toThrow();
    }
    expect(() => projectFundBalances(input({ transactions: [{ ...expense, purpose: null }] }))).toThrow();
    expect(() => projectFundBalances(input({ grants: [{ grantId: 'a', amounts: { ...zero, growth: Number.MAX_SAFE_INTEGER } }, { grantId: 'b', amounts: { ...zero, growth: 1 } }] }))).toThrow();
    expect(() => projectFundBalances(input({ grants: [{ grantId: 'a', amounts: { ...zero, growth: Number.MAX_SAFE_INTEGER, joy: 1 } }] }))).toThrow();
    expect(() => projectFundBalances(input({ grants: [{ grantId: 'a', amounts: { ...zero, growth: Number.MAX_SAFE_INTEGER } }], transactions: [{ ...refund, isRefund: false, purpose: 'growth', amountCents: 1 }] }))).toThrow();
    expect(() => projectFundBalances(input({ transactions: [{ ...expense, amountCents: Number.MAX_SAFE_INTEGER }, { ...expense, transactionId: 'other', amountCents: 1 }] }))).toThrow();
    expect(projectFundBalances(input({ transactions: [{ ...expense, amountCents: Number.MAX_SAFE_INTEGER }] })).balances.essentials).toBe(-Number.MAX_SAFE_INTEGER);
  });
});
