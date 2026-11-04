import {
  allocationPeriodStart,
  computeFinancialExecution,
  dateOnly,
  dayStart,
  FinancialExecutionInputError,
  nextPeriodStart,
  resolveFinancialPurpose,
  sumFinancialExecutionCents,
  validateFinancialRefundSplits,
  type FinancialExecutionComputation,
  type FundPurpose,
  type FinancialMappingSnapshot,
  type FinancialRefundSplit,
  type FinancialWindow,
  type PurposeResolution,
  type SpendingPurpose,
} from '@jizhang/shared';
import { createHash } from 'node:crypto';
import type { Db } from '../db/index.js';
import {
  FinancialInvalidError,
  FinancialNotFoundError,
  FinancialRefundConflictError,
  FinancialRevisionConflictError,
  FinancialSourceChangedError,
} from './financial-errors.js';
import {
  runFinancialOperation,
  requireFinancialOperationId,
  canonicalFinancialPayload,
} from './financial-operation-store.js';
import {
  financialCriticalFacts,
  financialCriticalFactsEqual,
  financialRefundSplitRevision,
  readFinancialRefundSplits,
  replaceFinancialRefundSplits,
  type FinancialRefundSplitRecord,
} from './financial-source-lifecycle.js';
import {
  financialTransactionToken,
  readBillPurposeFacts,
  writeBillPurposeOverride,
} from './financial-purpose-store.js';
import { assertFundPurposeRevision, readFundPurposeFacts, writeFundPurpose } from './financial-fund-purpose-store.js';
import { parseAllocationsJson } from './salary-service.js';
import {
  FINANCIAL_LIMITS,
  FINANCIAL_PLANNING_BASE,
  parseFinancialPaging,
  requireNonEmptyString,
  requireObject,
  requireSafeInteger,
  requireSpendingPurposeOrNull,
  rethrowSharedError,
  type AssessedRefundSet,
  type AssessedSplitRow,
  type FinancialExecution,
  type FinancialExecutionFactDto,
  type FinancialMeta,
  type FinancialPlanningOptions,
  type FinancialRefundOriginal,
  type FinancialRefundReview,
  type PeriodRow,
  type TransactionFactRow,
} from './financial-planning-types.js';
import { FinancialPlanningConfigService } from './financial-planning-config.js';
import { FinancialPlanningPeriodsService } from './financial-planning-periods.js';

export class FinancialPlanningRefundsService {
  private readonly db: Db;
  private readonly configService: FinancialPlanningConfigService;
  private readonly periodsService: FinancialPlanningPeriodsService;
  private readonly now: () => number;

  constructor(
    db: Db,
    configService: FinancialPlanningConfigService,
    periodsService: FinancialPlanningPeriodsService,
    options: FinancialPlanningOptions = {},
  ) {
    this.db = db;
    this.configService = configService;
    this.periodsService = periodsService;
    this.now = options.now ?? (() => Date.now());
  }

  private meta(): FinancialMeta {
    return this.configService.meta();
  }

  private resolveActorId(): string {
    return this.configService.resolveActorId();
  }

  transactionRowById(id: string): TransactionFactRow | undefined {
    return this.db
      .prepare(
        `SELECT id, type, amount_cents, category_id, account_id, date, is_refund, deleted, financial_purpose
           FROM transactions WHERE id = ?`,
      )
      .get(id) as TransactionFactRow | undefined;
  }

  tokenOf(row: TransactionFactRow): string {
    return financialTransactionToken({
      id: row.id,
      type: row.type,
      amountCents: row.amount_cents,
      categoryId: row.category_id,
      accountId: row.account_id,
      date: row.date,
      isRefund: row.is_refund,
      deleted: row.deleted,
    });
  }

  expenseRowsInWindow(window: FinancialWindow): TransactionFactRow[] {
    return this.db
      .prepare(
        `SELECT id, type, amount_cents, category_id, account_id, date, is_refund, deleted, financial_purpose
           FROM transactions
          WHERE deleted = 0 AND type = 0 AND is_refund = 0 AND date >= ? AND date < ?
          ORDER BY date DESC, id ASC`,
      )
      .all(window.start, window.end) as TransactionFactRow[];
  }

  overrideOf(row: TransactionFactRow): SpendingPurpose | null {
    return row.financial_purpose === 'essentials' || row.financial_purpose === 'joy'
      ? row.financial_purpose
      : null;
  }

  resolveExpensePurpose(
    row: TransactionFactRow,
    mapping: FinancialMappingSnapshot | null,
  ): PurposeResolution {
    try {
      return resolveFinancialPurpose({
        override: this.overrideOf(row),
        categoryId: row.category_id,
        mapping,
      });
    } catch (error) {
      rethrowSharedError(error, true);
    }
  }

  periodIdForDate(date: number): string | null {
    let best: { id: string; start: number } | null = null;
    for (const period of this.periodsService.anyPeriods()) {
      const window = this.periodsService.parsePeriodWindow(
        this.periodsService.activeRevisionRow(period),
      );
      if (date < window.start || date >= window.end) continue;
      if (best === null || window.start > best.start) best = { id: period.id, start: window.start };
    }
    return best?.id ?? null;
  }

  private readSplitsForOriginals(originalIds: readonly string[]): FinancialRefundSplitRecord[] {
    const unique = [...new Set(originalIds)];
    const out: FinancialRefundSplitRecord[] = [];
    for (let index = 0; index < unique.length; index += 400) {
      out.push(
        ...readFinancialRefundSplits(this.db, {
          originalTransactionIds: unique.slice(index, index + 400),
        }),
      );
    }
    return out;
  }

  assessRefundSets(scope: {
    readonly refundTransactionIds?: readonly string[] | undefined;
    readonly originalTransactionIds?: readonly string[] | undefined;
  }): {
    sets: Map<string, AssessedRefundSet>;
    rows: AssessedSplitRow[];
    attributedFor: (refundTransactionId: string) => number;
    remainingFor: (originalTransactionId: string, excludeRefundId?: string) => number;
  } {
    // A competing refund may have siblings on other originals. Traverse the
    // connected graph before assessing any set or cap: examining only the row
    // that touches the requested original can make a stale set look valid.
    const all = new Map<string, FinancialRefundSplitRecord>();
    const seenOriginals = new Set<string>();
    const seenRefunds = new Set<string>();
    let originals = [...new Set(scope.originalTransactionIds ?? [])];
    let refunds = [...new Set(scope.refundTransactionIds ?? [])];
    while (originals.length > 0 || refunds.length > 0) {
      const nextOriginals: string[] = [];
      const nextRefunds: string[] = [];
      const found: FinancialRefundSplitRecord[] = [];
      if (originals.length > 0) {
        for (const id of originals) seenOriginals.add(id);
        found.push(...this.readSplitsForOriginals(originals));
      }
      if (refunds.length > 0) {
        for (const id of refunds) seenRefunds.add(id);
        for (let index = 0; index < refunds.length; index += 400) {
          found.push(...readFinancialRefundSplits(this.db, { refundTransactionIds: refunds.slice(index, index + 400) }));
        }
      }
      for (const record of found) {
        all.set(record.id, record);
        if (!seenOriginals.has(record.originalTransactionId)) nextOriginals.push(record.originalTransactionId);
        if (!seenRefunds.has(record.refundTransactionId)) nextRefunds.push(record.refundTransactionId);
      }
      originals = [...new Set(nextOriginals)];
      refunds = [...new Set(nextRefunds)];
    }

    const rows: AssessedSplitRow[] = [...all.values()].map((record) => {
      const refundRow = this.transactionRowById(record.refundTransactionId);
      const originalRow = this.transactionRowById(record.originalTransactionId);
      return {
        record,
        refundRow,
        originalRow,
        reason: this.rowReason(record, refundRow, originalRow),
      };
    });

    const sets = new Map<string, AssessedRefundSet>();
    for (const row of rows) {
      const key = row.record.refundTransactionId;
      const existing = sets.get(key);
      if (existing === undefined) {
        sets.set(key, {
          refundTransactionId: key,
          rows: [row],
          valid: row.reason === null,
          reason: row.reason,
        });
      } else {
        existing.rows.push(row);
        if (row.reason !== null) {
          existing.valid = false;
          existing.reason = existing.reason ?? row.reason;
        }
      }
    }

    // A row-level match is not enough: a partial or tampered set must not
    // contradict its latest confirmation, nor exceed the refund itself.
    for (const set of sets.values()) {
      if (!set.valid) continue;
      const latest = this.db.prepare(`SELECT revision,status,splits_json,facts_json FROM financial_refund_split_sets
        WHERE refund_tx_id=? ORDER BY revision DESC LIMIT 1`).get(set.refundTransactionId) as
        { revision: number; status: string; splits_json: string; facts_json: string } | undefined;
      const sorted = [...set.rows].sort((a, b) => a.record.originalTransactionId.localeCompare(b.record.originalTransactionId));
      const snapshots = sorted.map(({ record }) => ({ originalTransactionId: record.originalTransactionId, amountCents: record.amountCents }));
      const facts = { refund: sorted[0]?.record.refundFacts ?? null, originals: sorted.map(({ record }) => ({ transactionId: record.originalTransactionId, facts: record.originalFacts })) };
      try {
        const refundAmount = sorted[0]?.refundRow?.amount_cents;
        if (latest === undefined || latest.status !== 'confirmed' ||
            sorted.some(({ record }) => record.setRevision !== latest.revision) ||
            canonicalFinancialPayload(JSON.parse(latest.splits_json)) !== canonicalFinancialPayload(snapshots) ||
            canonicalFinancialPayload(JSON.parse(latest.facts_json)) !== canonicalFinancialPayload(facts) ||
            refundAmount === undefined || sorted.reduce((sum, row) => sum + BigInt(row.record.amountCents), 0n) > BigInt(refundAmount)) {
          throw new Error('Inconsistent refund confirmation');
        }
      } catch {
        set.valid = false;
        set.reason = 'split-invalidated';
      }
    }

    const amountOn = (originalId: string, excludeRefundId?: string): number[] =>
      [...sets.values()]
        .filter((set) => set.valid && set.refundTransactionId !== excludeRefundId)
        .flatMap((set) =>
          set.rows
            .filter((row) => row.record.originalTransactionId === originalId)
            .map((row) => row.record.amountCents),
        );

    const originalAmounts = new Map<string, number>();
    for (const row of rows) {
      const amount = row.originalRow?.amount_cents;
      if (amount !== undefined) originalAmounts.set(row.record.originalTransactionId, amount);
    }
    for (const override of [...(scope.originalTransactionIds ?? [])]) {
      if (originalAmounts.has(override)) continue;
      const original = this.transactionRowById(override);
      if (original !== undefined) originalAmounts.set(override, original.amount_cents);
    }
    // Compute every cap against the same initially valid sets. Invalidating as
    // we iterate would make overlapping over-cap originals depend on row order.
    const overCapOriginals = new Set<string>();
    for (const [originalId, amount] of originalAmounts) {
      if (sumFinancialExecutionCents(amountOn(originalId)) > amount) overCapOriginals.add(originalId);
    }
    for (const set of sets.values()) {
      if (!set.valid || !set.rows.some((row) => overCapOriginals.has(row.record.originalTransactionId))) continue;
      set.valid = false;
      set.reason = set.reason ?? 'over-refund';
    }

    return {
      sets,
      rows,
      attributedFor: (refundTransactionId: string): number => {
        const set = sets.get(refundTransactionId);
        if (set === undefined || !set.valid) return 0;
        return sumFinancialExecutionCents(set.rows.map((row) => row.record.amountCents));
      },
      remainingFor: (originalTransactionId: string, excludeRefundId?: string): number => {
        const amount = originalAmounts.get(originalTransactionId) ?? 0;
        const used = sumFinancialExecutionCents(amountOn(originalTransactionId, excludeRefundId));
        return Math.max(0, amount - used);
      },
    };
  }

  private rowReason(
    record: FinancialRefundSplitRecord,
    refundRow: TransactionFactRow | undefined,
    originalRow: TransactionFactRow | undefined,
  ): string | null {
    if (refundRow === undefined) return 'refund-purged';
    if (refundRow.deleted === 1) return 'refund-deleted';
    if (refundRow.type !== 1 || refundRow.is_refund !== 1) return 'refund-not-refund';
    if (
      record.refundFacts === null ||
      !financialCriticalFactsEqual(
        record.refundFacts,
        financialCriticalFacts({
          amountCents: refundRow.amount_cents,
          type: refundRow.type,
          isRefund: refundRow.is_refund === 1,
        }),
      )
    ) {
      return 'refund-changed';
    }
    if (originalRow === undefined) return 'original-purged';
    if (originalRow.deleted === 1) return 'original-deleted';
    if (originalRow.type !== 0 || originalRow.is_refund === 1) return 'original-not-expense';
    if (
      record.originalFacts === null ||
      !financialCriticalFactsEqual(
        record.originalFacts,
        financialCriticalFacts({
          amountCents: originalRow.amount_cents,
          type: originalRow.type,
          isRefund: originalRow.is_refund === 1,
        }),
      )
    ) {
      return 'original-changed';
    }
    if (record.state !== 'active') return record.invalidReason ?? 'split-invalidated';
    return null;
  }

  private auditedRefundAmount(refundId: string): number | null {
    const row = this.db
      .prepare(
        `SELECT facts_json FROM financial_refund_split_sets
          WHERE refund_tx_id = ? ORDER BY revision DESC LIMIT 1`,
      )
      .get(refundId) as { facts_json: string } | undefined;
    if (row === undefined) return null;
    try {
      const decoded: unknown = JSON.parse(row.facts_json);
      if (typeof decoded !== 'object' || decoded === null) return null;
      const refund = (decoded as Record<string, unknown>)['refund'];
      if (typeof refund !== 'object' || refund === null) return null;
      const amount = (refund as Record<string, unknown>)['amountCents'];
      return typeof amount === 'number' && Number.isSafeInteger(amount) ? amount : null;
    } catch {
      return null;
    }
  }

  private tombstoneToken(transactionId: string): string {
    return createHash('sha256')
      .update(`financial-transaction-tombstone-v1|${transactionId}`, 'utf8')
      .digest('hex');
  }

  refundReview(refundId: string): FinancialRefundReview {
    return this.db.transaction(() => this.refundReviewInSnapshot(refundId))();
  }

  private refundReviewInSnapshot(refundId: string): FinancialRefundReview {
    const row = this.transactionRowById(refundId);
    const revision = financialRefundSplitRevision(this.db, refundId);
    const legacyOriginalIds = (
      this.db
        .prepare('SELECT original_tx_id FROM refund_links WHERE refund_tx_id = ? ORDER BY rowid')
        .all(refundId) as { original_tx_id: string }[]
    ).map((link) => link.original_tx_id);

    const auditSets = this.db
      .prepare(
        'SELECT splits_json, status, reason FROM financial_refund_split_sets WHERE refund_tx_id = ? ORDER BY revision DESC',
      )
      .all(refundId) as { splits_json: string; status: string; reason: string | null }[];

    const auditedOriginalIds: string[] = [];
    for (const auditSet of auditSets) {
      try {
        const parsed = JSON.parse(auditSet.splits_json);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (
              typeof item === 'object' &&
              item !== null &&
              typeof (item as Record<string, unknown>).originalTransactionId === 'string'
            ) {
              auditedOriginalIds.push(
                (item as Record<string, unknown>).originalTransactionId as string,
              );
            }
          }
        }
      } catch {
        // ignore malformed audit JSON
      }
    }

    const auditedAmount = row === undefined ? this.auditedRefundAmount(refundId) : null;
    const existingSplits = readFinancialRefundSplits(this.db, { refundTransactionIds: [refundId] });
    if (
      row === undefined &&
      auditedAmount === null &&
      existingSplits.length === 0 &&
      legacyOriginalIds.length === 0 &&
      auditedOriginalIds.length === 0
    ) {
      throw new FinancialNotFoundError('Refund not found.');
    }

    const allOriginalIds = [
      ...existingSplits.map((s) => s.originalTransactionId),
      ...legacyOriginalIds,
      ...auditedOriginalIds,
    ];
    const assessment = this.assessRefundSets({
      refundTransactionIds: [refundId],
      originalTransactionIds: allOriginalIds,
    });
    const set = assessment.sets.get(refundId);
    const records = set?.rows.map((entry) => entry.record) ?? [];

    const amountCents = row?.amount_cents ?? auditedAmount ?? 0;

    const setValid = set !== undefined && set.valid && records.length > 0;
    const splits: FinancialRefundSplit[] = setValid
      ? records.map((record) => ({
          originalTransactionId: record.originalTransactionId,
          amountCents: record.amountCents,
        }))
      : [];
    const validAttributedCents = setValid
      ? sumFinancialExecutionCents(splits.map((split) => split.amountCents))
      : 0;
    const unresolvedCents = Math.max(0, amountCents - validAttributedCents);

    const reasons = new Set<string>();
    if (set?.reason !== null && set?.reason !== undefined) reasons.add(set.reason);
    for (const entry of set?.rows ?? []) {
      if (entry.reason !== null) reasons.add(entry.reason);
    }
    if (row === undefined) reasons.add('refund-purged');
    if (records.length === 0 && legacyOriginalIds.length > 0) {
      reasons.add('legacy-links-require-confirmation');
    }
    if (records.length === 0 && legacyOriginalIds.length === 0 && auditedOriginalIds.length === 0) {
      reasons.add('no-splits');
    }
    if (records.length === 0 && auditedOriginalIds.length > 0) {
      reasons.add(auditSets[0]?.reason ?? 'original-purged');
    }
    if (records.length > 0 && !setValid) reasons.add('split-invalidated');
    if (unresolvedCents > 0 && records.length > 0) reasons.add('excess-unattributed');

    const isRefund = row !== undefined && row.type === 1 && row.is_refund === 1;
    let state: FinancialRefundReview['state'];
    if (row === undefined) state = 'purged';
    else if (!isRefund) state = 'not-refund';
    else if (row.deleted === 1) state = 'deleted';
    else if (setValid && reasons.size === 0) state = 'confirmed';
    else if (records.length === 0 && legacyOriginalIds.length === 0 && auditedOriginalIds.length === 0) {
      state = 'unconfirmed';
    } else state = 'review-required';

    const originalIds = new Set<string>([
      ...records.map((record) => record.originalTransactionId),
      ...legacyOriginalIds,
      ...auditedOriginalIds,
    ]);
    const originals: FinancialRefundOriginal[] = [...originalIds].map((originalId) => {
      const originalRow = this.transactionRowById(originalId);
      const window = originalRow === undefined ? null : this.periodIdForDate(originalRow.date);
      const mapping = window === null ? null : this.mappingOfPeriod(window);
      return {
        transactionId: originalId,
        transactionToken:
          originalRow === undefined ? this.tombstoneToken(originalId) : this.tokenOf(originalRow),
        amountCents: originalRow?.amount_cents ?? 0,
        date: originalRow?.date ?? 0,
        periodId: window,
        resolution:
          originalRow === undefined
            ? {
                purpose: null,
                provenance: 'unresolved',
                ruleCategoryId: null,
                mappingRevision: 0,
                reason: 'not-mapped',
              }
            : this.resolveExpensePurpose(originalRow, mapping),
        otherConfirmedRefundCents: Math.max(
          0,
          (originalRow?.amount_cents ?? 0) - assessment.remainingFor(originalId, refundId),
        ),
        remainingRefundableCents: assessment.remainingFor(originalId, refundId),
        state:
          originalRow === undefined
            ? 'purged'
            : originalRow.deleted === 1
              ? 'deleted'
              : originalRow.type !== 0 || originalRow.is_refund === 1
                ? 'not-expense'
                : 'live',
      };
    });

    let suggestedSplits: FinancialRefundSplit[] | null = null;
    if (
      records.length === 0 &&
      legacyOriginalIds.length === 1 &&
      isRefund &&
      row !== undefined &&
      row.deleted === 0
    ) {
      const only = originals[0];
      if (
        only !== undefined &&
        only.state === 'live' &&
        row.amount_cents <= only.remainingRefundableCents
      ) {
        suggestedSplits = [
          { originalTransactionId: only.transactionId, amountCents: row.amount_cents },
        ];
      }
    }

    return {
      refundTransactionId: refundId,
      refundToken: row === undefined ? this.tombstoneToken(refundId) : this.tokenOf(row),
      amountCents,
      date: row?.date ?? 0,
      revision,
      state,
      splits,
      validAttributedCents,
      unresolvedCents,
      reasons: [...reasons].sort(),
      originals,
      suggestedSplits,
      legacyOriginalIds,
    };
  }

  private mappingOfPeriod(periodId: string | null): FinancialMappingSnapshot | null {
    if (periodId === null) return null;
    const period = this.periodsService.readPeriodRow(periodId);
    return this.configService.readMappingByRevision(
      this.periodsService.activeRevisionRow(period).mapping_revision,
    );
  }

  listRefunds(
    query: Record<string, unknown>,
  ): FinancialMeta & { items: FinancialRefundReview[]; total: number; limit: number; offset: number } {
    return this.db.transaction(() => this.listRefundsInSnapshot(query))();
  }

  private listRefundsInSnapshot(
    query: Record<string, unknown>,
  ): FinancialMeta & { items: FinancialRefundReview[]; total: number; limit: number; offset: number } {
    const { limit, offset } = parseFinancialPaging(query);
    const stateFilterRaw = query['state'];
    const stateFilter =
      stateFilterRaw === undefined || stateFilterRaw === ''
        ? null
        : requireNonEmptyString(stateFilterRaw, 'state');
    if (
      stateFilter !== null &&
      ![
        'unconfirmed',
        'confirmed',
        'review-required',
        'deleted',
        'not-refund',
      ].includes(stateFilter)
    ) {
      throw new FinancialInvalidError('state filter is not supported.');
    }

    const rows = this.db
      .prepare(
        `SELECT id FROM transactions
          WHERE type = 1 AND is_refund = 1 AND deleted = 0
          ORDER BY date DESC, id ASC`,
      )
      .all() as { id: string }[];

    const items = rows.map((row) => this.refundReview(row.id)).filter((review) => {
      if (stateFilter === null) return true;
      if (stateFilter === 'review-required') {
        return review.state === 'review-required' || review.state === 'unconfirmed';
      }
      return review.state === stateFilter;
    });

    return {
      ...this.meta(),
      items: items.slice(offset, offset + limit),
      total: items.length,
      limit,
      offset,
    };
  }

  getRefund(refundId: string): FinancialMeta & { refund: FinancialRefundReview } {
    return { ...this.meta(), refund: this.refundReview(refundId) };
  }

  putRefundSplits(
    refundId: string,
    rawBody: unknown,
  ): FinancialMeta & { refund: FinancialRefundReview; affectedPeriodIds: string[] } {
    const body = requireObject(rawBody, 'The request body must contain the split replacement.');
    const operationId = requireFinancialOperationId(body['operationId']);
    const expectedRevision = requireSafeInteger(body['expectedRevision'], 'expectedRevision', 0);
    const expectedRefundToken = requireNonEmptyString(
      body['expectedRefundToken'],
      'expectedRefundToken',
    );
    const originalsRaw = body['originals'];
    if (!Array.isArray(originalsRaw)) {
      throw new FinancialInvalidError(
        'originals must be an array of {transactionId, expectedTransactionToken}.',
      );
    }
    if (originalsRaw.length > FINANCIAL_LIMITS.refundSplits) {
      throw new FinancialInvalidError(
        `originals may contain at most ${FINANCIAL_LIMITS.refundSplits} entries.`,
      );
    }
    const originals: { transactionId: string; expectedTransactionToken: string }[] =
      originalsRaw.map((entry) => {
        const record = requireObject(
          entry,
          'Each original must be {transactionId, expectedTransactionToken}.',
        );
        return {
          transactionId: requireNonEmptyString(
            record['transactionId'],
            'originals[].transactionId',
          ),
          expectedTransactionToken: requireNonEmptyString(
            record['expectedTransactionToken'],
            'originals[].expectedTransactionToken',
          ),
        };
      });
    const splitsRaw = body['splits'];
    if (!Array.isArray(splitsRaw)) {
      throw new FinancialInvalidError(
        'splits must be an array of {originalTransactionId, amountCents}.',
      );
    }
    if (splitsRaw.length > FINANCIAL_LIMITS.refundSplits) {
      throw new FinancialInvalidError(
        `splits may contain at most ${FINANCIAL_LIMITS.refundSplits} entries.`,
      );
    }
    const splits: FinancialRefundSplit[] = splitsRaw.map((entry) => {
      const record = requireObject(
        entry,
        'Each split must be {originalTransactionId, amountCents}.',
      );
      return {
        originalTransactionId: requireNonEmptyString(
          record['originalTransactionId'],
          'splits[].originalTransactionId',
        ),
        amountCents: requireSafeInteger(record['amountCents'], 'splits[].amountCents', 1),
      };
    });

    return runFinancialOperation<
      FinancialMeta & { refund: FinancialRefundReview; affectedPeriodIds: string[] }
    >(
      this.db,
      {
        operationId,
        actorId: this.resolveActorId(),
        method: 'PUT',
        resource: `${FINANCIAL_PLANNING_BASE}/refunds/${refundId}/splits`,
        canonicalPayload: { expectedRevision, expectedRefundToken, originals, splits },
        now: this.now(),
      },
      () => {
        const refundRow = this.transactionRowById(refundId);
        if (refundRow === undefined) throw new FinancialNotFoundError('Refund not found.');
        if (refundRow.deleted === 1) {
          throw new FinancialRefundConflictError('This refund is deleted.');
        }
        if (refundRow.type !== 1 || refundRow.is_refund !== 1) {
          throw new FinancialRefundConflictError('Only a live refund income row can be split.');
        }
        if (this.tokenOf(refundRow) !== expectedRefundToken) {
          throw new FinancialSourceChangedError('The refund changed since it was loaded.');
        }
        if (financialRefundSplitRevision(this.db, refundId) !== expectedRevision) {
          throw new FinancialRevisionConflictError(
            'The refund splits were changed elsewhere. Reload the refund before saving again.',
          );
        }

        const limits: {
          transactionId: string;
          remainingRefundableCents: number;
          state: 'live' | 'deleted' | 'purged' | 'not-expense';
        }[] = [];
        const assessment = this.assessRefundSets({
          originalTransactionIds: originals.map((o) => o.transactionId),
        });
        for (const original of originals) {
          const row = this.transactionRowById(original.transactionId);
          if (row === undefined || row.deleted === 1) {
            throw new FinancialSourceChangedError(
              `Original expense is no longer available: ${original.transactionId}`,
            );
          }
          if (this.tokenOf(row) !== original.expectedTransactionToken) {
            throw new FinancialSourceChangedError(
              `Original expense changed since it was loaded: ${original.transactionId}`,
            );
          }
          limits.push({
            transactionId: row.id,
            remainingRefundableCents: assessment.remainingFor(row.id, refundId),
            state: row.type !== 0 || row.is_refund === 1 ? 'not-expense' : 'live',
          });
        }

        let validated: { splits: readonly FinancialRefundSplit[] };
        try {
          validated = validateFinancialRefundSplits({
            refundAmountCents: refundRow.amount_cents,
            originals: limits,
            splits,
          });
        } catch (error) {
          if (error instanceof FinancialExecutionInputError) {
            throw new FinancialRefundConflictError(error.message);
          }
          throw error;
        }

        const affected = new Set<string>();
        for (const split of validated.splits) {
          const original = this.transactionRowById(split.originalTransactionId);
          if (original === undefined) continue;
          const periodId = this.periodIdForDate(original.date);
          if (periodId !== null) affected.add(periodId);
        }

        const now = this.now();
        replaceFinancialRefundSplits(this.db, {
          refundTxId: refundId,
          splits: validated.splits,
          refundFacts: financialCriticalFacts({
            amountCents: refundRow.amount_cents,
            type: refundRow.type,
            isRefund: refundRow.is_refund === 1,
          }),
          originalFacts: validated.splits.map((split) => {
            const original = this.transactionRowById(split.originalTransactionId);
            if (original === undefined) {
              throw new FinancialSourceChangedError(
                'An original expense disappeared while saving.',
              );
            }
            return {
              transactionId: original.id,
              facts: financialCriticalFacts({
                amountCents: original.amount_cents,
                type: original.type,
                isRefund: original.is_refund === 1,
              }),
            };
          }),
          operationId,
          now,
        });

        // A pre-existing over-cap set is not counted by remainingFor. Reassess
        // the complete graph after replacement so a 200 cannot commit a newly
        // confirmed set that is already invalid. Throwing rolls back the write.
        if (validated.splits.length > 0 && !this.assessRefundSets({ refundTransactionIds: [refundId] }).sets.get(refundId)?.valid) {
          throw new FinancialRefundConflictError('The refund conflicts with other confirmed splits. Review them before saving.');
        }

        return {
          statusCode: 200,
          response: {
            ...this.meta(),
            refund: this.refundReview(refundId),
            affectedPeriodIds: [...affected].sort(),
          },
        };
      },
    ).response;
  }

  collectExecution(period: PeriodRow): {
    execution: FinancialExecution;
    facts: FinancialExecutionFactDto[];
  } {
    return this.db.transaction(() => this.collectExecutionInSnapshot(this.periodsService.readPeriodRow(period.id)))();
  }

  private collectExecutionInSnapshot(period: PeriodRow): {
    execution: FinancialExecution;
    facts: FinancialExecutionFactDto[];
  } {
    const revision = this.periodsService.activeRevisionRow(period);
    const window = this.periodsService.parsePeriodWindow(revision);
    const decision = this.periodsService.parseDecision(revision);
    const mapping = this.configService.readMappingByRevision(revision.mapping_revision);
    const view = this.periodsService.periodView(period);

    const expenses = this.expenseRowsInWindow(window);
    const expenseById = new Map(expenses.map((row) => [row.id, row]));
    const resolutions = new Map<string, PurposeResolution>();
    for (const row of expenses) resolutions.set(row.id, this.resolveExpensePurpose(row, mapping));

    const assessment = this.assessRefundSets({
      originalTransactionIds: expenses.map((row) => row.id),
    });
    // The graph is assessed globally, but this period's facts must only contain
    // splits whose original expense belongs to this period.
    const assessed = assessment.rows.filter((row) => expenseById.has(row.record.originalTransactionId)).map((row) => {
      const set = assessment.sets.get(row.record.refundTransactionId);
      return {
        ...row,
        valid: set?.valid ?? false,
        reason: set?.reason ?? row.reason,
      };
    });

    const validSplits = assessed.filter((entry) => entry.valid);
    const refundTransactionIds = new Set(
      validSplits.map((entry) => entry.record.refundTransactionId),
    );

    const legacyLinks =
      expenses.length === 0
        ? []
        : (this.db
            .prepare(
              `SELECT rl.original_tx_id AS original_id, t.id AS refund_id, t.amount_cents AS amount
                 FROM refund_links rl
                 JOIN transactions t ON t.id = rl.refund_tx_id
                WHERE rl.original_tx_id IN (${expenses.map(() => '?').join(',')})
                  AND t.deleted = 0 AND t.type = 1 AND t.is_refund = 1`,
            )
            .all(...expenses.map((row) => row.id)) as {
            original_id: string;
            refund_id: string;
            amount: number;
          }[]);

    const pendingLinked = new Map<string, number>();
    for (const link of legacyLinks) {
      if (refundTransactionIds.has(link.refund_id)) continue;
      pendingLinked.set(link.refund_id, link.amount);
    }
    for (const entry of assessed) {
      if (entry.valid) continue;
      const refund = entry.record;
      pendingLinked.set(
        refund.refundTransactionId,
        entry.refundRow?.amount_cents ?? refund.amountCents,
      );
    }
    for (const entry of validSplits) {
      const refundRow = entry.refundRow;
      if (refundRow !== undefined && refundRow.deleted === 0) {
        const attributed = assessment.attributedFor(entry.record.refundTransactionId);
        const unallocated = refundRow.amount_cents - attributed;
        if (unallocated > 0) {
          pendingLinked.set(entry.record.refundTransactionId, unallocated);
        }
      }
    }

    const globalUnassigned = this.db
      .prepare(
        `SELECT COUNT(*) AS c, COALESCE(SUM(t.amount_cents), 0) AS total
           FROM transactions t
          WHERE t.deleted = 0 AND t.type = 1 AND t.is_refund = 1
            AND NOT EXISTS (SELECT 1 FROM refund_links rl WHERE rl.refund_tx_id = t.id)
            AND NOT EXISTS (SELECT 1 FROM financial_refund_splits s WHERE s.refund_tx_id = t.id)`,
      )
      .get() as { c: number; total: number };

    const envelope = this.envelopeReference(period, mapping, window);

    let computation: FinancialExecutionComputation;
    try {
      computation = computeFinancialExecution({
        window,
        decision: {
          incomeCents: decision.incomeCents,
          ratiosBps: decision.ratiosBps,
          targets: decision.targets,
        },
        sourceState: view.sourceState,
        mapping,
        expenses: expenses.map((row) => ({
          transactionId: row.id,
          amountCents: row.amount_cents,
          date: row.date,
          categoryId: row.category_id,
          override: this.overrideOf(row),
        })),
        refundSplits: validSplits.map((entry) => ({
          refundTransactionId: entry.record.refundTransactionId,
          originalTransactionId: entry.record.originalTransactionId,
          amountCents: entry.record.amountCents,
        })),
        pendingLinkedRefunds: [...pendingLinked].map(([refundTransactionId, amountCents]) => ({
          refundTransactionId,
          amountCents,
        })),
        globalUnassignedRefunds: {
          count: globalUnassigned.c,
          amountCents: globalUnassigned.total,
        },
        envelope,
        calculatedAt: this.now(),
      });
    } catch (error) {
      rethrowSharedError(error, true);
    }

    const execution: FinancialExecution = {
      contractVersion: computation.contractVersion,
      rules: computation.rules,
      calculatedAt: computation.calculatedAt,
      period: view,
      spending: computation.spending,
      funding: computation.funding,
      unresolved: computation.unresolved,
      coverage: computation.coverage,
      envelopeReference: computation.envelopeReference,
    };

    const facts: FinancialExecutionFactDto[] = [];
    for (const row of expenses) {
      const resolution = resolutions.get(row.id)!;
      facts.push({
        kind: 'expense',
        transactionId: row.id,
        originalTransactionId: null,
        amountCents: row.amount_cents,
        date: row.date,
        categoryId: row.category_id,
        accountId: row.account_id,
        purpose: resolution.purpose,
        periodId: period.id,
        resolution,
        status: resolution.purpose === null ? 'unresolved' : 'counted',
        reason: resolution.purpose === null ? (resolution.reason ?? 'not-mapped') : null,
        sourceToken: financialTransactionToken({
          id: row.id,
          type: row.type,
          amountCents: row.amount_cents,
          categoryId: row.category_id,
          accountId: row.account_id,
          date: row.date,
          isRefund: row.is_refund,
          deleted: row.deleted,
        }),
        splitRevision: null,
      });
    }
    for (const entry of assessed) {
      const original = expenseById.get(entry.record.originalTransactionId);
      const resolution =
        original === undefined ? null : (resolutions.get(original.id) ?? null);
      const refundRow = entry.refundRow;
      facts.push({
        kind: entry.valid ? 'refund-split' : 'pending-refund',
        transactionId: entry.record.refundTransactionId,
        originalTransactionId: entry.record.originalTransactionId,
        amountCents: entry.valid
          ? entry.record.amountCents
          : (refundRow?.amount_cents ?? entry.record.amountCents),
        date: refundRow?.date ?? 0,
        categoryId: refundRow?.category_id ?? null,
        accountId: refundRow?.account_id ?? null,
        purpose: resolution?.purpose ?? null,
        periodId: period.id,
        resolution,
        status: entry.valid ? 'counted' : 'unresolved',
        reason: entry.valid ? null : (entry.reason ?? 'split-invalidated'),
        sourceToken:
          refundRow === undefined
            ? ''
            : financialTransactionToken({
                id: refundRow.id,
                type: refundRow.type,
                amountCents: refundRow.amount_cents,
                categoryId: refundRow.category_id,
                accountId: refundRow.account_id,
                date: refundRow.date,
                isRefund: refundRow.is_refund,
                deleted: refundRow.deleted,
              }),
        splitRevision: entry.record.setRevision,
      });
    }
    for (const [refundTransactionId, amountCents] of pendingLinked) {
      if (facts.some((fact) => fact.transactionId === refundTransactionId)) continue;
      const refundRow = this.transactionRowById(refundTransactionId);
      facts.push({
        kind: 'pending-refund',
        transactionId: refundTransactionId,
        originalTransactionId: null,
        amountCents,
        date: refundRow?.date ?? 0,
        categoryId: refundRow?.category_id ?? null,
        accountId: refundRow?.account_id ?? null,
        purpose: null,
        periodId: period.id,
        resolution: null,
        status: 'unresolved',
        reason: 'legacy-link-unconfirmed',
        sourceToken:
          refundRow === undefined
            ? ''
            : financialTransactionToken({
                id: refundRow.id,
                type: refundRow.type,
                amountCents: refundRow.amount_cents,
                categoryId: refundRow.category_id,
                accountId: refundRow.account_id,
                date: refundRow.date,
                isRefund: refundRow.is_refund,
                deleted: refundRow.deleted,
              }),
        splitRevision: null,
      });
    }

    return { execution, facts };
  }

  private envelopeReference(
    period: PeriodRow,
    mapping: FinancialMappingSnapshot,
    window: FinancialWindow,
  ): {
    totalBudgetCents: number;
    mappedBudgetCents: { essentials: number; joy: number; unresolved: number };
    legacyWindow: { start: number; end: number | null } | null;
  } {
    const owned = this.db
      .prepare(
        'SELECT salary_id FROM financial_period_sources WHERE period_id = ? AND active = 1',
      )
      .all(period.id) as { salary_id: string }[];

    let totalBudgetCents = 0;
    const essentials: number[] = [];
    const joy: number[] = [];
    const unresolved: number[] = [];
    for (const row of owned) {
      const allocation = this.db
        .prepare(
          'SELECT allocations_json FROM budget_allocations WHERE salary_record_id = ? AND deleted = 0',
        )
        .get(row.salary_id) as { allocations_json: string } | undefined;
      if (allocation === undefined) continue;
      for (const item of parseAllocationsJson(allocation.allocations_json)) {
        const amount = item.amountCents;
        if (!Number.isSafeInteger(amount) || amount < 0) continue;
        totalBudgetCents = sumFinancialExecutionCents([totalBudgetCents, amount]);
        let purpose: SpendingPurpose | null = null;
        try {
          purpose = resolveFinancialPurpose({
            override: null,
            categoryId: item.categoryId,
            mapping,
          }).purpose;
        } catch (error) {
          rethrowSharedError(error, true);
        }
        if (purpose === 'essentials') essentials.push(amount);
        else if (purpose === 'joy') joy.push(amount);
        else unresolved.push(amount);
      }
    }

    const legacyCycle = this.configService.legacyCycle();
    let legacyWindow: { start: number; end: number | null } | null = null;
    if (legacyCycle.kind === 'start-day') {
      const start = allocationPeriodStart(legacyCycle.day, window.start);
      legacyWindow = { start, end: nextPeriodStart(legacyCycle.day, start) };
    } else {
      const local = new Date(dateOnly(window.start));
      legacyWindow = {
        start: dayStart(local.getFullYear(), local.getMonth(), 1),
        end: dayStart(local.getFullYear(), local.getMonth() + 1, 1),
      };
    }

    return {
      totalBudgetCents,
      mappedBudgetCents: {
        essentials: sumFinancialExecutionCents(essentials),
        joy: sumFinancialExecutionCents(joy),
        unresolved: sumFinancialExecutionCents(unresolved),
      },
      legacyWindow,
    };
  }

  getExecution(
    periodId?: string | undefined,
  ): FinancialMeta & { state: 'ready' | 'no-period'; execution: FinancialExecution | null } {
    if (periodId !== undefined && periodId !== '') {
      const period = this.periodsService.readPeriodRow(periodId);
      return {
        ...this.meta(),
        state: 'ready',
        execution: this.collectExecution(period).execution,
      };
    }
    const current = this.periodsService.currentPeriod();
    if (current === null) return { ...this.meta(), state: 'no-period', execution: null };
    return {
      ...this.meta(),
      state: 'ready',
      execution: this.collectExecution(current).execution,
    };
  }

  listExecutionFacts(
    periodId: string,
    query: Record<string, unknown>,
  ): FinancialMeta & {
    periodId: string;
    revision: number;
    items: FinancialExecutionFactDto[];
    total: number;
    limit: number;
    offset: number;
  } {
    const { limit, offset } = parseFinancialPaging(query);
    const period = this.periodsService.readPeriodRow(periodId);

    const purposeRaw = query['purpose'];
    if (
      purposeRaw !== undefined &&
      purposeRaw !== '' &&
      purposeRaw !== 'essentials' &&
      purposeRaw !== 'joy' &&
      purposeRaw !== 'unresolved'
    ) {
      throw new FinancialInvalidError("purpose must be 'essentials', 'joy' or 'unresolved'.");
    }
    const kindRaw = query['kind'];
    if (
      kindRaw !== undefined &&
      kindRaw !== '' &&
      kindRaw !== 'all' &&
      kindRaw !== 'expense' &&
      kindRaw !== 'refund'
    ) {
      throw new FinancialInvalidError("kind must be 'all', 'expense' or 'refund'.");
    }

    const { facts } = this.collectExecution(period);
    const filtered = facts
      .filter((fact) => {
        if (purposeRaw === 'unresolved') {
          if (fact.purpose !== null) return false;
        } else if (purposeRaw === 'essentials' || purposeRaw === 'joy') {
          if (fact.purpose !== purposeRaw) return false;
        }
        if (kindRaw === 'expense' && fact.kind !== 'expense') return false;
        if (kindRaw === 'refund' && fact.kind === 'expense') return false;
        return true;
      })
      .sort(
        (a, b) =>
          b.date - a.date ||
          a.kind.localeCompare(b.kind) ||
          a.transactionId.localeCompare(b.transactionId),
      );

    return {
      ...this.meta(),
      periodId: period.id,
      revision: period.active_revision,
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
      limit,
      offset,
    };
  }

  billPurposeView(transactionId: string): {
    transactionId: string;
    transactionToken: string;
    revision: number;
    financialPurpose: SpendingPurpose | null;
    fundPurpose: FundPurpose | null;
    fundPurposeRevision: number;
    fundPurposeStatus: 'resolved' | 'unresolved';
    fundPurposeSource: string;
    resolution: PurposeResolution;
    periodId: string | null;
  } {
    const facts = readBillPurposeFacts(this.db, transactionId);
    if (facts === undefined) throw new FinancialNotFoundError('Transaction not found.');
    const row = this.transactionRowById(transactionId)!;
    const fundFacts = readFundPurposeFacts(this.db, transactionId);
    const periodId = this.periodIdForDate(row.date);
    const mapping = this.mappingOfPeriod(periodId) ?? this.configService.readMapping();
    return {
      transactionId,
      transactionToken: financialTransactionToken({
        id: row.id,
        type: row.type,
        amountCents: row.amount_cents,
        categoryId: row.category_id,
        accountId: row.account_id,
        date: row.date,
        isRefund: row.is_refund,
        deleted: row.deleted,
      }),
      revision: facts.revision,
      financialPurpose: facts.financialPurpose,
      fundPurpose: fundFacts.purpose,
      fundPurposeRevision: fundFacts.revision,
      fundPurposeStatus: fundFacts.status,
      fundPurposeSource: fundFacts.source,
      resolution: this.resolveExpensePurpose(row, mapping),
      periodId,
    };
  }

  getBillPurpose(
    transactionId: string,
  ): FinancialMeta & { billPurpose: ReturnType<FinancialPlanningRefundsService['billPurposeView']> } {
    return this.db.transaction(() => ({ ...this.meta(), billPurpose: this.billPurposeView(transactionId) }))();
  }

  putBillPurpose(
    transactionId: string,
    rawBody: unknown,
  ): FinancialMeta & {
    billPurpose: ReturnType<FinancialPlanningRefundsService['billPurposeView']>;
    affectedPeriodIds: string[];
  } {
    const body = requireObject(rawBody, 'The request body must contain the purpose change.');
    const operationId = requireFinancialOperationId(body['operationId']);
    const expectedRevision = requireSafeInteger(body['expectedRevision'], 'expectedRevision', 0);
    const expectedTransactionToken = requireNonEmptyString(
      body['expectedTransactionToken'],
      'expectedTransactionToken',
    );
    const purpose = requireSpendingPurposeOrNull(body['financialPurpose'], 'financialPurpose');

    const expectedFundPurposeRevision = body['expectedFundPurposeRevision'];
    const actorId = this.resolveActorId();
    const now = this.now();

    const result = runFinancialOperation<
      FinancialMeta & {
        billPurpose: ReturnType<FinancialPlanningRefundsService['billPurposeView']>;
        affectedPeriodIds: string[];
      }
    >(
      this.db,
      {
        operationId,
        actorId,
        method: 'PUT',
        resource: `${FINANCIAL_PLANNING_BASE}/bill-purposes/${transactionId}`,
        canonicalPayload: { expectedRevision, expectedTransactionToken, financialPurpose: purpose, expectedFundPurposeRevision },
        now,
      },
      () => {
        const row = this.transactionRowById(transactionId);
        if (row === undefined) throw new FinancialNotFoundError('Transaction not found.');
        if (this.tokenOf(row) !== expectedTransactionToken) {
          throw new FinancialSourceChangedError('The bill changed since it was loaded.');
        }
        assertFundPurposeRevision(readFundPurposeFacts(this.db, transactionId), expectedFundPurposeRevision, 'legacy');
        writeBillPurposeOverride(this.db, {
          transactionId,
          purpose,
          expectedRevision,
          reason: purpose === null ? 'cleared' : 'explicit-override',
          operationId,
          actorId,
          now,
        });
        writeFundPurpose(this.db, transactionId, purpose, actorId, operationId, now, false);
        const periodId = this.periodIdForDate(row.date);
        return {
          statusCode: 200,
          response: {
            ...this.meta(),
            billPurpose: this.billPurposeView(transactionId),
            affectedPeriodIds: periodId === null ? [] : [periodId],
          },
        };
      },
    );
    return result.response;
  }
}
