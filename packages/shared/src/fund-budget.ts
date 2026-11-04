/** Pure continuous four-purpose fund arithmetic; callers supply one consistent fact snapshot. */
import { allocateFinancialExecutionCents, FinancialExecutionInputError } from './financial-execution.js';
import type { FinancialPurpose } from './financial-plan.js';

export type FundPurpose = FinancialPurpose;
export interface FundAmounts { readonly growth: number; readonly reserve: number; readonly essentials: number; readonly joy: number }
export type FundRatiosBps = FundAmounts;

/** A verified grant's already-frozen targets, including legacy aggregate targets. */
export interface FundGrantFact { readonly grantId: string; readonly amounts: FundAmounts }
/** Transactions are source facts, not transfers, goal progress, or salary grants. */
export interface FundTransactionFact {
  readonly transactionId: string;
  readonly type: 'income' | 'expense';
  readonly isRefund: boolean;
  readonly amountCents: number;
  readonly date: number;
  readonly purpose: FundPurpose | null;
  readonly purposeStatus: 'resolved' | 'unresolved';
  readonly status: 'live' | 'deleted';
}
/** Validity is supplied by the owner of confirmation and source revision lifecycle. */
export interface FundRefundSplitFact {
  readonly splitId: string;
  readonly refundTransactionId: string;
  readonly originalTransactionId: string;
  readonly amountCents: number;
  readonly validity: 'valid' | 'invalid';
}
export interface FundUnallocatedSalaryFact { readonly salaryId: string; readonly amountCents: number }
export interface FundProjectionInput {
  readonly grants: readonly FundGrantFact[];
  readonly transactions: readonly FundTransactionFact[];
  readonly refundSplits: readonly FundRefundSplitFact[];
  readonly unallocatedSalaries: readonly FundUnallocatedSalaryFact[];
  /** Stable unresolved issue identities, with no assumed amount or source attribution. */
  readonly issues: readonly string[];
}
export interface FundCoverage {
  readonly complete: boolean;
  readonly unallocatedSalaryCount: number;
  readonly unallocatedSalaryCents: number;
  readonly unassignedTransactionCount: number;
  readonly unassignedTransactionCents: number;
  /** Distinct refund IDs with absent, invalid, partial or unassigned split evidence. */
  readonly invalidRefundCount: number;
  /** Known live refund amount not credited; absent source amounts are never invented. */
  readonly unresolvedRefundCents: number;
  readonly issueCount: number;
}
export interface FundProjection {
  readonly balances: FundAmounts;
  readonly totals: { readonly funded: FundAmounts; readonly income: FundAmounts; readonly grossSpent: FundAmounts; readonly refunded: FundAmounts };
  readonly coverage: FundCoverage;
}

export function allocateFundIncomeCents(incomeCents: number, ratiosBps: FundRatiosBps): FundAmounts {
  return allocateFinancialExecutionCents(incomeCents, ratiosBps);
}

const PURPOSES = ['growth', 'reserve', 'essentials', 'joy'] as const;
const MAX = BigInt(Number.MAX_SAFE_INTEGER);
type BigAmounts = Record<FundPurpose, bigint>;
const empty = (): BigAmounts => ({ growth: 0n, reserve: 0n, essentials: 0n, joy: 0n });

function fail(message: string, code: 'INVALID_EXECUTION' | 'INVALID_MONEY' | 'INVALID_REFUND_SPLITS' | 'OVERFLOW' = 'INVALID_EXECUTION'): never {
  throw new FinancialExecutionInputError(code, message);
}
function id(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(`${field} must be a non-empty string.`);
  return value;
}
function money(value: unknown, field: string, minimum: number): bigint {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) fail(`${field} must be safe integer cents.`, 'INVALID_MONEY');
  return BigInt(value);
}
function safe(value: bigint, field: string): number {
  if (value > MAX || value < -MAX) fail(`${field} exceeds the safe integer range.`, 'OVERFLOW');
  return Number(value);
}
function amounts(values: BigAmounts, field: string): FundAmounts {
  return { growth: safe(values.growth, field), reserve: safe(values.reserve, field), essentials: safe(values.essentials, field), joy: safe(values.joy, field) };
}
function unique(seen: Set<string>, value: string, field: string): void {
  if (seen.has(value)) fail(`${field} must be unique.`);
  seen.add(value);
}

/**
 * Derive lifetime balances from live ledger facts and verified grants. Split sets are
 * credited only if confirmed valid and consistent with both live source records and
 * the aggregate refund/original caps. Missing or unresolved evidence is coverage,
 * never a guessed purpose. Input must contain the full snapshot, not a date window.
 * The caller must assess the complete refund set and its source revisions against a
 * consistent source snapshot before setting validity; an activity-filtered or partial
 * graph cannot establish whole-set validity. Grant ownership is likewise caller-owned.
 */
export function projectFundBalances(input: FundProjectionInput): FundProjection {
  if (typeof input !== 'object' || input === null || ![input.grants, input.transactions, input.refundSplits, input.unallocatedSalaries, input.issues].every(Array.isArray)) fail('Projection facts must be arrays.');
  const funded = empty(); const income = empty(); const grossSpent = empty(); const refunded = empty();
  const grantIds = new Set<string>();
  for (const grant of input.grants) {
    if (typeof grant !== 'object' || grant === null || typeof grant.amounts !== 'object' || grant.amounts === null) fail('Invalid grant.');
    unique(grantIds, id(grant.grantId, 'grantId'), 'grantId');
    let grantTotal = 0n;
    for (const purpose of PURPOSES) {
      const value = money(grant.amounts[purpose], `grant.${purpose}`, 0);
      grantTotal += value;
      funded[purpose] += value;
    }
    safe(grantTotal, 'grant total');
  }
  const salaryIds = new Set<string>(); let unallocatedSalary = 0n;
  for (const salary of input.unallocatedSalaries) {
    if (typeof salary !== 'object' || salary === null) fail('Invalid salary.');
    unique(salaryIds, id(salary.salaryId, 'salaryId'), 'salaryId');
    unallocatedSalary += money(salary.amountCents, 'salary.amountCents', 1);
  }
  const issueIds = new Set<string>();
  for (const issue of input.issues) unique(issueIds, id(issue, 'issue'), 'issue');
  const transactions = new Map<string, FundTransactionFact>();
  let unassignedCount = 0; let unassignedCents = 0n;
  for (const fact of input.transactions) {
    if (typeof fact !== 'object' || fact === null) fail('Invalid transaction.');
    const transactionId = id(fact.transactionId, 'transactionId');
    if (transactions.has(transactionId)) fail('transactionId must be unique.');
    const value = money(fact.amountCents, 'transaction.amountCents', 1);
    money(fact.date, 'transaction.date', 0);
    if ((fact.type !== 'income' && fact.type !== 'expense') || typeof fact.isRefund !== 'boolean' || (fact.isRefund && fact.type !== 'income') || (fact.status !== 'live' && fact.status !== 'deleted')) fail('Invalid transaction type or status.');
    if (fact.purposeStatus !== 'resolved' && fact.purposeStatus !== 'unresolved') fail('Invalid purpose status.');
    if (fact.purposeStatus === 'resolved' ? !PURPOSES.includes(fact.purpose as FundPurpose) : fact.purpose !== null) fail('Purpose and purpose status disagree.');
    transactions.set(transactionId, fact);
    if (fact.status !== 'live' || fact.isRefund) continue;
    if (fact.purpose === null) { unassignedCount++; unassignedCents += value; continue; }
    if (fact.type === 'income') income[fact.purpose] += value;
    else grossSpent[fact.purpose] += value;
  }

  const splitIds = new Set<string>(); const pairs = new Map<string, Set<string>>();
  const sets = new Map<string, FundRefundSplitFact[]>();
  for (const split of input.refundSplits) {
    if (typeof split !== 'object' || split === null) fail('Invalid split.', 'INVALID_REFUND_SPLITS');
    unique(splitIds, id(split.splitId, 'splitId'), 'splitId');
    const refundId = id(split.refundTransactionId, 'refundTransactionId');
    const originalId = id(split.originalTransactionId, 'originalTransactionId');
    const seen = pairs.get(refundId) ?? new Set<string>();
    unique(seen, originalId, 'refund/original pair'); pairs.set(refundId, seen);
    money(split.amountCents, 'split.amountCents', 1);
    if (split.validity !== 'valid' && split.validity !== 'invalid') fail('Invalid split validity.', 'INVALID_REFUND_SPLITS');
    const entries = sets.get(refundId) ?? []; entries.push(split); sets.set(refundId, entries);
  }
  // Invalidity of one member invalidates its entire refund set. Over-cap originals
  // invalidate all implicated sets, avoiding order-dependent credit allocation.
  const invalid = new Set<string>();
  const originalTotals = new Map<string, bigint>();
  const originalRefunds = new Map<string, Set<string>>();
  for (const [refundId, splits] of sets) {
    const source = transactions.get(refundId);
    if (source === undefined || source.status !== 'live' || source.type !== 'income' || !source.isRefund || splits.some((s) => s.validity !== 'valid')) { invalid.add(refundId); continue; }
    let sum = 0n;
    for (const split of splits) {
      sum += BigInt(split.amountCents);
      const original = transactions.get(split.originalTransactionId);
      if (original === undefined || original.status !== 'live' || original.type !== 'expense' || original.isRefund) invalid.add(refundId);
    }
    if (sum > BigInt(source.amountCents)) invalid.add(refundId);
  }
  for (const [refundId, splits] of sets) {
    if (invalid.has(refundId)) continue;
    for (const split of splits) {
      originalTotals.set(split.originalTransactionId, (originalTotals.get(split.originalTransactionId) ?? 0n) + BigInt(split.amountCents));
      const refs = originalRefunds.get(split.originalTransactionId) ?? new Set<string>(); refs.add(refundId); originalRefunds.set(split.originalTransactionId, refs);
    }
  }
  for (const [originalId, total] of originalTotals) {
    const original = transactions.get(originalId);
    if (original !== undefined && total > BigInt(original.amountCents)) {
      for (const refundId of originalRefunds.get(originalId) ?? []) invalid.add(refundId);
    }
  }
  let invalidRefundCount = 0; let unresolvedRefund = 0n;
  const refundIds = new Set(sets.keys());
  for (const fact of transactions.values()) if (fact.status === 'live' && fact.type === 'income' && fact.isRefund) refundIds.add(fact.transactionId);
  for (const refundId of refundIds) {
    const source = transactions.get(refundId);
    if (source === undefined) { invalidRefundCount++; continue; }
    // Retained split audit rows for deleted or reclassified refunds are not live
    // unresolved refunds. A later restore still requires explicit reconfirmation.
    if (source.status !== 'live' || source.type !== 'income' || !source.isRefund) continue;
    let credited = 0n;
    if (!invalid.has(refundId)) {
      for (const split of sets.get(refundId) ?? []) {
        const original = transactions.get(split.originalTransactionId);
        if (original?.purpose !== null && original?.purpose !== undefined) {
          const value = BigInt(split.amountCents); refunded[original.purpose] += value; credited += value;
        }
      }
    }
    const unresolved = BigInt(source.amountCents) - credited;
    if (unresolved > 0n || invalid.has(refundId)) { invalidRefundCount++; unresolvedRefund += unresolved; }
  }
  const balances = empty();
  for (const purpose of PURPOSES) balances[purpose] = funded[purpose] + income[purpose] - grossSpent[purpose] + refunded[purpose];
  return {
    balances: amounts(balances, 'balance'),
    totals: { funded: amounts(funded, 'funded'), income: amounts(income, 'income'), grossSpent: amounts(grossSpent, 'grossSpent'), refunded: amounts(refunded, 'refunded') },
    coverage: {
      complete: salaryIds.size === 0 && unassignedCount === 0 && invalidRefundCount === 0 && issueIds.size === 0,
      unallocatedSalaryCount: salaryIds.size, unallocatedSalaryCents: safe(unallocatedSalary, 'unallocated salary'),
      unassignedTransactionCount: unassignedCount, unassignedTransactionCents: safe(unassignedCents, 'unassigned transaction'),
      invalidRefundCount, unresolvedRefundCents: safe(unresolvedRefund, 'unresolved refund'), issueCount: issueIds.size,
    },
  };
}
