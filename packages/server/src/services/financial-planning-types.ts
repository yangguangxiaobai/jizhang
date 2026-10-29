import type {
  FINANCIAL_EXECUTION_RULES,
  FinancialCycle,
  FinancialExecutionComputation,
  FinancialRatiosBps,
  FinancialRefundSplit,
  FinancialWindow,
  PurposeAmounts,
  PurposeResolution,
  SpendingPurpose,
} from '@jizhang/shared';

export type {
  FINANCIAL_EXECUTION_RULES,
  FinancialCycle,
  FinancialExecutionComputation,
  FinancialMappingSnapshot,
  FinancialRatiosBps,
  FinancialRefundSplit,
  FinancialWindow,
  PurposeAmounts,
  PurposeResolution,
  SpendingPurpose,
} from '@jizhang/shared';

/** 资源前缀。所有新路由都在 `/api/v1/financial-planning`。 */
export const FINANCIAL_PLANNING_BASE = '/api/v1/financial-planning';

/** 集合上限(与 contract `limits` 一致)。 */
export const FINANCIAL_LIMITS = {
  pageSize: 100,
  selectedSources: 200,
  refundSplits: 100,
  categoryRules: 2000,
} as const;

export const DEFAULT_PAGE_SIZE = 50;
export const DEFAULT_TARGET_MONTHS = 5;
export const MIN_TARGET_MONTHS = 1;
export const MAX_TARGET_MONTHS = 120;

/** 所有新响应共有的元信息。 */
export interface FinancialMeta {
  readonly contractVersion: 1;
  readonly rules: typeof FINANCIAL_EXECUTION_RULES;
  readonly calculatedAt: number;
}

export interface FinancialConfig {
  readonly revision: number;
  readonly enabled: boolean;
  readonly ratiosBps: FinancialRatiosBps;
  readonly essentialMonthlyCents: number | null;
  readonly targetMonths: number;
  readonly cycle: FinancialCycle;
  readonly timeZone: string;
  readonly updatedAt: number | null;
}

export interface FinancialAllocationDecision {
  readonly incomeCents: number;
  readonly ratiosBps: FinancialRatiosBps;
  readonly targets: PurposeAmounts;
  readonly configRevision: number;
  readonly mappingRevision: number;
  readonly mappingSnapshotId: string | null;
  readonly essentialMonthlyCents: number | null;
  readonly targetMonths: number;
}

export interface FinancialSourceSnapshot {
  readonly salaryId: string;
  readonly amountCents: number;
  readonly date: number;
  readonly accountId: string;
  readonly sourceToken: string;
  readonly confirmedAt: number;
  readonly status: 'valid' | 'changed' | 'deleted' | 'purged' | 'group-changed';
  readonly current: {
    readonly amountCents: number;
    readonly date: number;
    readonly accountId: string;
    readonly sourceToken: string;
  } | null;
}

export interface FinancialSalarySource {
  readonly salaryId: string;
  readonly amountCents: number;
  readonly date: number;
  readonly accountId: string;
  readonly sourceToken: string;
  readonly updatedAt: number;
  readonly includedPeriodId: string | null;
  readonly includedRevision: number | null;
  readonly proposedGroupMonth: string;
  readonly proposedWindow: FinancialWindow | null;
  readonly selectable: boolean;
  readonly reason: string | null;
}

export interface FinancialPeriod {
  readonly id: string;
  readonly revision: number;
  readonly createdAt: number;
  readonly confirmedAt: number;
  readonly window: FinancialWindow;
  readonly decision: FinancialAllocationDecision;
  readonly sources: FinancialSourceSnapshot[];
  readonly sourceState: 'valid' | 'reconciliation-required' | 'empty';
  readonly confirmedIncomeCents: number;
  readonly verifiedIncomeCents: number;
  readonly warnings: string[];
}

/** 退款分摊里的一条原单事实(带此刻的解析与剩余可退)。 */
export interface FinancialRefundOriginal {
  readonly transactionId: string;
  readonly transactionToken: string;
  readonly amountCents: number;
  readonly date: number;
  readonly periodId: string | null;
  readonly resolution: PurposeResolution | null;
  readonly otherConfirmedRefundCents: number;
  readonly remainingRefundableCents: number;
  readonly state: 'live' | 'deleted' | 'purged' | 'not-expense';
}

/** 一次退款的复核视图:已归属、未归属、建议,以及可读的原因。 */
export interface FinancialRefundReview {
  readonly refundTransactionId: string;
  readonly refundToken: string;
  readonly amountCents: number;
  readonly date: number;
  readonly revision: number;
  readonly state: 'unconfirmed' | 'confirmed' | 'review-required' | 'deleted' | 'purged' | 'not-refund';
  readonly splits: FinancialRefundSplit[];
  readonly validAttributedCents: number;
  readonly unresolvedCents: number;
  readonly reasons: string[];
  readonly originals: FinancialRefundOriginal[];
  readonly suggestedSplits: FinancialRefundSplit[] | null;
  readonly legacyOriginalIds: string[];
}

/** 一条可下钻的执行事实。 */
export interface FinancialExecutionFactDto {
  readonly kind: 'expense' | 'refund-split' | 'pending-refund';
  readonly transactionId: string;
  readonly originalTransactionId: string | null;
  readonly amountCents: number;
  readonly date: number;
  readonly categoryId: string | null;
  readonly accountId: string | null;
  readonly purpose: SpendingPurpose | null;
  readonly periodId: string | null;
  readonly resolution: PurposeResolution | null;
  readonly status: 'counted' | 'unresolved' | 'excluded';
  readonly reason: string | null;
  readonly sourceToken: string;
  readonly splitRevision: number | null;
}

/** 一个冻结周期的净执行读模型(`financial-net-v1`)+ 元信息。 */
export interface FinancialExecution extends FinancialMeta {
  readonly period: FinancialPeriod;
  readonly spending: FinancialExecutionComputation['spending'];
  readonly funding: FinancialExecutionComputation['funding'];
  readonly unresolved: FinancialExecutionComputation['unresolved'];
  readonly coverage: FinancialExecutionComputation['coverage'];
  readonly envelopeReference: FinancialExecutionComputation['envelopeReference'];
}

export interface FinancialSourceRef {
  readonly salaryId: string;
  readonly expectedSourceToken: string;
}

export interface FinancialPeriodProposal {
  readonly periodId: string | null;
  readonly expectedRevision: number;
  readonly expectedConfigRevision: number;
  readonly expectedMappingRevision: number;
  readonly selectedSources: FinancialSourceRef[];
  readonly mappingPolicy: 'preserve' | 'current';
  readonly reason: 'salary-confirmation' | 'income-reconciliation' | 'mapping-restatement';
}

export interface FinancialPreview {
  readonly previewToken: string;
  readonly proposal: FinancialPeriodProposal;
  readonly window: FinancialWindow;
  readonly decision: FinancialAllocationDecision;
  readonly sources: FinancialSourceSnapshot[];
  readonly excludedSources: FinancialSalarySource[];
  readonly previousRevision: number;
  readonly warnings: string[];
  readonly impact: {
    readonly addedSalaryIds: string[];
    readonly removedSalaryIds: string[];
    readonly changedSalaryIds: string[];
    readonly mappingChanged: boolean;
    readonly reclassifiedExpenseCount: number;
    readonly reclassifiedGrossCents: number;
  };
}

export interface FinancialPlanningOptions {
  readonly now?: (() => number) | undefined;
  /** 重放作用域的操作者覆盖(测试用);缺省取单用户表里的唯一用户。 */
  readonly actorId?: string | undefined;
  /** 服务器 IANA 时区覆盖;缺省取运行时。 */
  readonly serverTimeZone?: string | undefined;
}

export interface ConfigRow {
  readonly revision: number;
  readonly enabled: number;
  readonly ratios_json: string;
  readonly essential_monthly_cents: number | null;
  readonly target_months: number;
  readonly cycle_json: string;
  readonly time_zone: string;
  readonly created_at: number;
}

export interface MappingRow {
  readonly id: string;
  readonly revision: number;
  readonly rules_json: string;
  readonly topology_json: string;
  readonly topology_token: string;
  readonly created_at: number;
}

export interface PeriodRow {
  readonly id: string;
  readonly group_month: string;
  readonly cycle_key: string;
  readonly active_revision: number;
  readonly created_at: number;
  readonly updated_at: number;
}

export interface PeriodRevisionRow {
  readonly id: string;
  readonly period_id: string;
  readonly revision: number;
  readonly group_month: string;
  readonly cycle_key: string;
  readonly window_json: string;
  readonly decision_json: string;
  readonly sources_json: string;
  readonly warnings_json: string;
  readonly reason: string;
  readonly config_revision: number;
  readonly mapping_revision: number;
  readonly confirmed_income_cents: number;
  readonly created_at: number;
}

export interface SalaryRow {
  readonly id: string;
  readonly amount_cents: number;
  readonly date: number;
  readonly account_id: string;
  readonly deleted: number;
  readonly updated_at: number;
}

export interface TransactionFactRow {
  readonly id: string;
  readonly type: number;
  readonly amount_cents: number;
  readonly category_id: string;
  readonly account_id: string;
  readonly date: number;
  readonly is_refund: number;
  readonly deleted: number;
  readonly financial_purpose: string | null;
}

import { createHash } from 'node:crypto';
import { canonicalFinancialPayload } from './financial-operation-store.js';
import type { FinancialRefundSplitRecord } from './financial-source-lifecycle.js';
import {
  FinancialInvalidError,
  FinancialUnavailableError,
  FinancialWindowConflictError,
} from './financial-errors.js';
import { FinancialExecutionInputError } from '@jizhang/shared';

export interface AssessedSplitRow {
  readonly record: FinancialRefundSplitRecord;
  readonly refundRow: TransactionFactRow | undefined;
  readonly originalRow: TransactionFactRow | undefined;
  readonly reason: string | null;
}

export interface AssessedRefundSet {
  readonly refundTransactionId: string;
  readonly rows: AssessedSplitRow[];
  valid: boolean;
  reason: string | null;
}

export function requireObject(raw: unknown, message: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new FinancialInvalidError(message);
  }
  return raw as Record<string, unknown>;
}

export function requireSafeInteger(value: unknown, field: string, minimum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new FinancialInvalidError(`${field} must be a safe integer >= ${minimum}.`);
  }
  return value;
}

export function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new FinancialInvalidError(`${field} is required.`);
  }
  return value.trim();
}

export function requireSpendingPurposeOrNull(value: unknown, field: string): SpendingPurpose | null {
  if (value === null) return null;
  if (value === 'essentials' || value === 'joy') return value;
  throw new FinancialInvalidError(`${field} must be 'essentials', 'joy' or null.`);
}

export function parseFinancialPaging(query: Record<string, unknown>): {
  limit: number;
  offset: number;
} {
  const rawLimit = query['limit'];
  let limit = DEFAULT_PAGE_SIZE;
  if (rawLimit !== undefined && rawLimit !== '') {
    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > FINANCIAL_LIMITS.pageSize) {
      throw new FinancialInvalidError(
        `limit must be an integer between 1 and ${FINANCIAL_LIMITS.pageSize}.`,
      );
    }
    limit = parsed;
  }
  const rawOffset = query['offset'];
  let offset = 0;
  if (rawOffset !== undefined && rawOffset !== '') {
    const parsed = Number(rawOffset);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new FinancialInvalidError('offset must be a non-negative integer.');
    }
    offset = parsed;
  }
  return { limit, offset };
}

export function requireTimeZone(value: unknown, field = 'timeZone'): string {
  const zone = requireNonEmptyString(value, field);
  if (/^[+-]/.test(zone) || zone.includes('/') === false && zone !== 'UTC') {
    if (!/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)+$/.test(zone) && zone !== 'UTC') {
      throw new FinancialInvalidError(`${field} must be an IANA time zone name.`);
    }
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(0);
  } catch {
    throw new FinancialInvalidError(`${field} must be an IANA time zone name.`);
  }
  return zone;
}

export function groupMonthOf(dateMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'iso8601',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(dateMs);
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  return `${year.padStart(4, '0')}-${month}`;
}

export function requireGroupMonth(value: unknown, field = 'groupMonth'): string {
  const raw = requireNonEmptyString(value, field);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) {
    throw new FinancialInvalidError(`${field} must be formatted as YYYY-MM.`);
  }
  return raw;
}

export function hashJson(value: unknown): string {
  return createHash('sha256').update(canonicalFinancialPayload(value), 'utf8').digest('hex');
}

export function salarySourceToken(row: {
  readonly id: string;
  readonly amount_cents: number;
  readonly date: number;
  readonly account_id: string;
}): string {
  return hashJson({
    salaryId: row.id,
    amountCents: row.amount_cents,
    date: row.date,
    accountId: row.account_id,
  });
}

export function transactionSourceToken(row: {
  readonly id: string;
  readonly amount_cents: number;
  readonly type: number;
  readonly category_id: string;
  readonly date: number;
  readonly is_refund: number;
  readonly deleted: number;
}): string {
  return hashJson({
    transactionId: row.id,
    amountCents: row.amount_cents,
    type: row.type,
    categoryId: row.category_id,
    date: row.date,
    isRefund: row.is_refund === 1,
    deleted: row.deleted === 1,
  });
}

export function rethrowSharedError(error: unknown, fromStorage = false): never {
  if (error instanceof FinancialExecutionInputError) {
    if (fromStorage) throw new FinancialUnavailableError();
    if (error.code === 'WINDOW_CONFLICT') {
      throw new FinancialWindowConflictError(error.message);
    }
    throw new FinancialInvalidError(error.message);
  }
  throw error;
}

const MAX_SAFE = Number.MAX_SAFE_INTEGER;

export function nextFinancialRevision(current: number): number {
  if (!Number.isSafeInteger(current) || current < 0) throw new FinancialUnavailableError();
  const next = current + 1;
  if (next >= MAX_SAFE) throw new FinancialUnavailableError();
  return next;
}
