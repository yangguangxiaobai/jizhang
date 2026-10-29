import {
  allocateFinancialExecutionCents,
  FINANCIAL_EXECUTION_RULES,
  resolveFinancialCycleWindow,
  resolveFinancialPurpose,
  sumFinancialExecutionCents,
  validateFinancialRatiosBps,
  type FinancialCycle,
  type FinancialMappingSnapshot,
  type FinancialWindow,
  type PurposeAmounts,
  type PurposeResolution,
  type SpendingPurpose,
} from '@jizhang/shared';
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/index.js';
import {
  FinancialDisabledError,
  FinancialInvalidError,
  FinancialNotFoundError,
  FinancialRevisionConflictError,
  FinancialSourceAlreadyIncludedError,
  FinancialSourceChangedError,
  FinancialUnavailableError,
} from './financial-errors.js';
import {
  runFinancialOperation,
  requireFinancialOperationId,
} from './financial-operation-store.js';
import {
  FINANCIAL_LIMITS,
  FINANCIAL_PLANNING_BASE,
  groupMonthOf,
  hashJson,
  nextFinancialRevision,
  parseFinancialPaging,
  requireGroupMonth,
  requireNonEmptyString,
  requireObject,
  requireSafeInteger,
  requireTimeZone,
  rethrowSharedError,
  salarySourceToken,
  type FinancialAllocationDecision,
  type FinancialConfig,
  type FinancialMeta,
  type FinancialPeriod,
  type FinancialPeriodProposal,
  type FinancialPlanningOptions,
  type FinancialPreview,
  type FinancialSalarySource,
  type FinancialSourceRef,
  type FinancialSourceSnapshot,
  type PeriodRevisionRow,
  type PeriodRow,
  type SalaryRow,
} from './financial-planning-types.js';
import { FinancialPlanningConfigService } from './financial-planning-config.js';
import { allocationPeriodStart, dateOnly, dayStart, nextPeriodStart } from '@jizhang/shared';

export class FinancialPlanningPeriodsService {
  private readonly db: Db;
  private readonly configService: FinancialPlanningConfigService;
  private readonly now: () => number;

  constructor(
    db: Db,
    configService: FinancialPlanningConfigService,
    options: FinancialPlanningOptions = {},
  ) {
    this.db = db;
    this.configService = configService;
    this.now = options.now ?? (() => Date.now());
  }

  private meta(): FinancialMeta {
    return this.configService.meta();
  }

  private resolveActorId(): string {
    return this.configService.resolveActorId();
  }

  liveSalaries(): SalaryRow[] {
    return this.db
      .prepare(
        `SELECT id, amount_cents, date, account_id, deleted, updated_at
           FROM salary_records
          WHERE deleted = 0
          ORDER BY date DESC, id ASC`,
      )
      .all() as SalaryRow[];
  }

  activeOwnership(): Map<string, { periodId: string; revision: number }> {
    const rows = this.db
      .prepare(
        'SELECT salary_id, period_id, revision FROM financial_period_sources WHERE active = 1',
      )
      .all() as { salary_id: string; period_id: string; revision: number }[];
    return new Map(
      rows.map((row) => [row.salary_id, { periodId: row.period_id, revision: row.revision }]),
    );
  }

  readPeriodRow(periodId: string): PeriodRow {
    const row = this.db
      .prepare('SELECT * FROM financial_periods WHERE id = ?')
      .get(periodId) as PeriodRow | undefined;
    if (row === undefined) throw new FinancialNotFoundError('Financial period not found.');
    return row;
  }

  activeRevisionRow(period: PeriodRow): PeriodRevisionRow {
    const row = this.db
      .prepare('SELECT * FROM financial_period_revisions WHERE period_id = ? AND revision = ?')
      .get(period.id, period.active_revision) as PeriodRevisionRow | undefined;
    if (row === undefined) throw new FinancialUnavailableError();
    return row;
  }

  readRevisionRow(periodId: string, revision: number): PeriodRevisionRow {
    const row = this.db
      .prepare('SELECT * FROM financial_period_revisions WHERE period_id = ? AND revision = ?')
      .get(periodId, revision) as PeriodRevisionRow | undefined;
    if (row === undefined) throw new FinancialNotFoundError('Financial period revision not found.');
    return row;
  }

  parsePeriodWindow(revision: PeriodRevisionRow): FinancialWindow {
    let decoded: unknown;
    try {
      decoded = JSON.parse(revision.window_json);
    } catch {
      throw new FinancialUnavailableError();
    }
    if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
      throw new FinancialUnavailableError();
    }
    const record = decoded as Record<string, unknown>;
    const start = record['start'];
    const end = record['end'];
    if (typeof start !== 'number' || !Number.isSafeInteger(start) || start < 0) {
      throw new FinancialUnavailableError();
    }
    if (typeof end !== 'number' || !Number.isSafeInteger(end) || end <= start) {
      throw new FinancialUnavailableError();
    }
    const cycleKey = record['cycleKey'];
    const groupMonth = record['groupMonth'];
    const anchor = record['anchorSalaryId'];
    if (typeof cycleKey !== 'string' || cycleKey === '') throw new FinancialUnavailableError();
    if (typeof groupMonth !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(groupMonth)) {
      throw new FinancialUnavailableError();
    }
    if (typeof anchor !== 'string' || anchor === '') throw new FinancialUnavailableError();
    if (record['groupingRule'] !== 'financial-cycle-frozen-month-v1') {
      throw new FinancialUnavailableError();
    }
    if (typeof record['timeZone'] !== 'string' || record['timeZone'] === '') {
      throw new FinancialUnavailableError();
    }
    if (!Array.isArray(record['warnings'])) throw new FinancialUnavailableError();
    return decoded as FinancialWindow;
  }

  parseDecision(revision: PeriodRevisionRow): FinancialAllocationDecision {
    let decoded: unknown;
    try {
      decoded = JSON.parse(revision.decision_json);
    } catch {
      throw new FinancialUnavailableError();
    }
    if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
      throw new FinancialUnavailableError();
    }
    const record = decoded as Record<string, unknown>;
    if (typeof record['incomeCents'] !== 'number' || !Number.isSafeInteger(record['incomeCents'])) {
      throw new FinancialUnavailableError();
    }
    try {
      validateFinancialRatiosBps(record['ratiosBps']);
    } catch {
      throw new FinancialUnavailableError();
    }
    return decoded as FinancialAllocationDecision;
  }

  periodByCycleKey(cycleKey: string): PeriodRow | undefined {
    return this.db
      .prepare('SELECT * FROM financial_periods WHERE cycle_key = ?')
      .get(cycleKey) as PeriodRow | undefined;
  }

  anyPeriods(): PeriodRow[] {
    return this.db.prepare('SELECT * FROM financial_periods').all() as PeriodRow[];
  }

  salaryRowById(salaryId: string): SalaryRow | undefined {
    return this.db
      .prepare(
        'SELECT id, amount_cents, date, account_id, deleted, updated_at FROM salary_records WHERE id = ?',
      )
      .get(salaryId) as SalaryRow | undefined;
  }

  private legacyWindowFor(dateMs: number): { start: number; end: number | null } {
    const cycle = this.configService.legacyCycle();
    if (cycle.kind === 'start-day') {
      const start = allocationPeriodStart(cycle.day, dateMs);
      return { start, end: nextPeriodStart(cycle.day, start) };
    }
    const local = new Date(dateOnly(dateMs));
    return {
      start: dayStart(local.getFullYear(), local.getMonth(), 1),
      end: dayStart(local.getFullYear(), local.getMonth() + 1, 1),
    };
  }

  windowForGroup(
    groupMonth: string,
    zone: string,
    cycle: FinancialCycle,
    groupSalaries: readonly SalaryRow[],
  ): FinancialWindow | null {
    if (groupSalaries.length === 0) return null;

    let existingWindow: FinancialWindow | null = null;
    const candidates = this.db
      .prepare('SELECT * FROM financial_periods WHERE group_month = ?')
      .all(groupMonth) as PeriodRow[];
    for (const candidate of candidates) {
      const window = this.parsePeriodWindow(this.activeRevisionRow(candidate));
      if (window.timeZone === zone && JSON.stringify(window.cycle) === JSON.stringify(cycle)) {
        existingWindow = window;
        break;
      }
    }

    try {
      return resolveFinancialCycleWindow({
        cycle,
        timeZone: zone,
        groupMonth,
        salaries: groupSalaries.map((row) => ({ salaryId: row.id, date: row.date })),
        existingWindow,
        legacyWindow: this.legacyWindowFor(groupSalaries[0]!.date),
      });
    } catch (error) {
      rethrowSharedError(error, true);
    }
  }

  overrideOf(row: { readonly financial_purpose: string | null }): SpendingPurpose | null {
    return row.financial_purpose === 'essentials' || row.financial_purpose === 'joy'
      ? row.financial_purpose
      : null;
  }

  resolveExpensePurpose(
    row: { readonly financial_purpose: string | null; readonly category_id: string },
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

  expenseRowsInWindow(window: FinancialWindow): {
    id: string;
    type: number;
    amount_cents: number;
    category_id: string;
    financial_purpose: string | null;
  }[] {
    return this.db
      .prepare(
        `SELECT id, type, amount_cents, category_id, account_id, date, is_refund, deleted, financial_purpose
           FROM transactions
          WHERE deleted = 0 AND type = 0 AND is_refund = 0 AND date >= ? AND date < ?
          ORDER BY date DESC, id ASC`,
      )
      .all(window.start, window.end) as {
        id: string;
        type: number;
        amount_cents: number;
        category_id: string;
        financial_purpose: string | null;
      }[];
  }

  listSalarySources(
    query: Record<string, unknown>,
  ): FinancialMeta & {
    items: FinancialSalarySource[];
    total: number;
    limit: number;
    offset: number;
  } {
    const { limit, offset } = parseFinancialPaging(query);
    const config = this.configService.readConfig();
    const zone =
      query['timeZone'] === undefined || query['timeZone'] === ''
        ? config.timeZone
        : requireTimeZone(query['timeZone']);
    const groupFilter =
      query['groupMonth'] === undefined || query['groupMonth'] === ''
        ? null
        : requireGroupMonth(query['groupMonth']);

    const ownership = this.activeOwnership();
    const all = this.liveSalaries();
    const byGroup = new Map<string, SalaryRow[]>();
    for (const row of all) {
      const group = groupMonthOf(row.date, zone);
      const bucket = byGroup.get(group);
      if (bucket === undefined) byGroup.set(group, [row]);
      else bucket.push(row);
    }

    const windows = new Map<string, FinancialWindow | null>();
    const items: FinancialSalarySource[] = [];
    for (const row of all) {
      const group = groupMonthOf(row.date, zone);
      if (groupFilter !== null && group !== groupFilter) continue;
      if (!windows.has(group)) {
        windows.set(
          group,
          this.windowForGroup(group, zone, config.cycle, byGroup.get(group) ?? []),
        );
      }
      const owned = ownership.get(row.id);
      items.push({
        salaryId: row.id,
        amountCents: row.amount_cents,
        date: row.date,
        accountId: row.account_id,
        sourceToken: salarySourceToken(row),
        updatedAt: row.updated_at,
        includedPeriodId: owned?.periodId ?? null,
        includedRevision: owned?.revision ?? null,
        proposedGroupMonth: group,
        proposedWindow: windows.get(group) ?? null,
        selectable: owned === undefined,
        reason: owned === undefined ? null : 'already-included',
      });
    }

    return {
      ...this.meta(),
      items: items.slice(offset, offset + limit),
      total: items.length,
      limit,
      offset,
    };
  }

  getSalarySource(salaryId: string): FinancialMeta & { source: FinancialSalarySource } {
    const row = this.salaryRowById(salaryId);
    if (row === undefined || row.deleted === 1) {
      throw new FinancialNotFoundError('Salary source not found.');
    }

    const config = this.configService.readConfig();
    const group = groupMonthOf(row.date, config.timeZone);
    const groupSalaries = this.liveSalaries().filter(
      (candidate) => groupMonthOf(candidate.date, config.timeZone) === group,
    );
    const owned = this.activeOwnership().get(row.id);
    return {
      ...this.meta(),
      source: {
        salaryId: row.id,
        amountCents: row.amount_cents,
        date: row.date,
        accountId: row.account_id,
        sourceToken: salarySourceToken(row),
        updatedAt: row.updated_at,
        includedPeriodId: owned?.periodId ?? null,
        includedRevision: owned?.revision ?? null,
        proposedGroupMonth: group,
        proposedWindow: this.windowForGroup(group, config.timeZone, config.cycle, groupSalaries),
        selectable: owned === undefined,
        reason: owned === undefined ? null : 'already-included',
      },
    };
  }

  private snapshotSources(
    salaries: readonly SalaryRow[],
    confirmedAt: number,
  ): {
    salaryId: string;
    amountCents: number;
    date: number;
    accountId: string;
    sourceToken: string;
    confirmedAt: number;
  }[] {
    return salaries
      .map((row) => ({
        salaryId: row.id,
        amountCents: row.amount_cents,
        date: row.date,
        accountId: row.account_id,
        sourceToken: salarySourceToken(row),
        confirmedAt,
      }))
      .sort((a, b) => a.date - b.date || a.salaryId.localeCompare(b.salaryId));
  }

  sourceStatusOf(
    snapshot: { salaryId: string; date: number; sourceToken: string },
    window: FinancialWindow,
    ownership: Map<string, { periodId: string; revision: number }>,
    periodId: string,
  ): FinancialSourceSnapshot['status'] {
    const live = this.salaryRowById(snapshot.salaryId);
    if (live === undefined) return 'purged';
    if (live.deleted === 1) return 'deleted';
    const owner = ownership.get(snapshot.salaryId);
    if (owner !== undefined && owner.periodId !== periodId) return 'group-changed';
    if (groupMonthOf(live.date, window.timeZone) !== window.groupMonth) return 'group-changed';
    return salarySourceToken(live) === snapshot.sourceToken ? 'valid' : 'changed';
  }

  periodView(period: PeriodRow, revision?: number): FinancialPeriod {
    const row =
      revision === undefined
        ? this.activeRevisionRow(period)
        : this.readRevisionRow(period.id, revision);
    const window = this.parsePeriodWindow(row);
    const decision = this.parseDecision(row);
    let stored: {
      salaryId: string;
      amountCents: number;
      date: number;
      accountId: string;
      sourceToken: string;
      confirmedAt: number;
    }[];
    let warnings: string[];
    try {
      const decodedSources: unknown = JSON.parse(row.sources_json);
      const decodedWarnings: unknown = JSON.parse(row.warnings_json);
      if (!Array.isArray(decodedSources) || !Array.isArray(decodedWarnings)) {
        throw new FinancialUnavailableError();
      }
      stored = decodedSources as typeof stored;
      warnings = decodedWarnings.filter((entry): entry is string => typeof entry === 'string');
    } catch (error) {
      if (error instanceof FinancialUnavailableError) throw error;
      throw new FinancialUnavailableError();
    }
    const ownership = this.activeOwnership();

    const sources: FinancialSourceSnapshot[] = stored.map((snapshot) => {
      const status = this.sourceStatusOf(snapshot, window, ownership, period.id);
      const live = this.salaryRowById(snapshot.salaryId);
      return {
        ...snapshot,
        status,
        current:
          live === undefined || live.deleted === 1
            ? null
            : {
                amountCents: live.amount_cents,
                date: live.date,
                accountId: live.account_id,
                sourceToken: salarySourceToken(live),
              },
      };
    });

    const verified = sources.filter((source) => source.status === 'valid');
    const sourceState: FinancialPeriod['sourceState'] =
      sources.length === 0
        ? 'empty'
        : verified.length === sources.length
          ? 'valid'
          : 'reconciliation-required';

    return {
      id: period.id,
      revision: row.revision,
      createdAt: period.created_at,
      confirmedAt: row.created_at,
      window,
      decision,
      sources,
      sourceState,
      confirmedIncomeCents: decision.incomeCents,
      verifiedIncomeCents: sumFinancialExecutionCents(
        verified.map((source) => source.amountCents),
      ),
      warnings,
    };
  }

  listPeriods(
    query: Record<string, unknown>,
  ): FinancialMeta & {
    items: FinancialPeriod[];
    total: number;
    limit: number;
    offset: number;
    currentPeriodId: string | null;
  } {
    const { limit, offset } = parseFinancialPaging(query);
    const rows = this.db
      .prepare(
        `SELECT p.* FROM financial_periods p
           JOIN financial_period_revisions r
             ON r.period_id = p.id AND r.revision = p.active_revision`,
      )
      .all() as PeriodRow[];
    const all = rows
      .map((row) => this.periodView(row))
      .sort((a, b) => b.window.start - a.window.start || a.id.localeCompare(b.id));
    const current = this.currentPeriod();
    return {
      ...this.meta(),
      items: all.slice(offset, offset + limit),
      total: all.length,
      limit,
      offset,
      currentPeriodId: current?.id ?? null,
    };
  }

  currentPeriod(): PeriodRow | null {
    const rows = this.db
      .prepare(
        `SELECT p.* FROM financial_periods p
           JOIN financial_period_revisions r
             ON r.period_id = p.id AND r.revision = p.active_revision`,
      )
      .all() as PeriodRow[];
    let best: { row: PeriodRow; start: number } | null = null;
    for (const row of rows) {
      const window = this.parsePeriodWindow(this.activeRevisionRow(row));
      if (best === null || window.start > best.start) best = { row, start: window.start };
    }
    return best?.row ?? null;
  }

  getPeriod(
    periodId: string,
    revision?: number | undefined,
  ): FinancialMeta & { period: FinancialPeriod } {
    const row = this.readPeriodRow(periodId);
    return { ...this.meta(), period: this.periodView(row, revision) };
  }

  listPeriodRevisions(
    periodId: string,
    query: Record<string, unknown>,
  ): FinancialMeta & { items: FinancialPeriod[]; total: number; limit: number; offset: number } {
    const { limit, offset } = parseFinancialPaging(query);
    const row = this.readPeriodRow(periodId);
    const revisions = this.db
      .prepare(
        'SELECT revision FROM financial_period_revisions WHERE period_id = ? ORDER BY revision DESC',
      )
      .all(periodId) as { revision: number }[];
    const items = revisions
      .slice(offset, offset + limit)
      .map((entry) => this.periodView(row, entry.revision));
    return { ...this.meta(), items, total: revisions.length, limit, offset };
  }

  private parseProposal(raw: unknown): FinancialPeriodProposal {
    const record = requireObject(raw, 'proposal must be an object.');
    const periodIdRaw = record['periodId'];
    const periodId =
      periodIdRaw === null || periodIdRaw === undefined
        ? null
        : requireNonEmptyString(periodIdRaw, 'proposal.periodId');
    const expectedRevision = requireSafeInteger(
      record['expectedRevision'],
      'proposal.expectedRevision',
      0,
    );
    const expectedConfigRevision = requireSafeInteger(
      record['expectedConfigRevision'],
      'proposal.expectedConfigRevision',
      0,
    );
    const expectedMappingRevision = requireSafeInteger(
      record['expectedMappingRevision'],
      'proposal.expectedMappingRevision',
      0,
    );

    const selectedRaw = record['selectedSources'];
    if (!Array.isArray(selectedRaw)) {
      throw new FinancialInvalidError('proposal.selectedSources must be an array.');
    }
    if (selectedRaw.length > FINANCIAL_LIMITS.selectedSources) {
      throw new FinancialInvalidError(
        `proposal.selectedSources may contain at most ${FINANCIAL_LIMITS.selectedSources} entries.`,
      );
    }
    const seen = new Set<string>();
    const selectedSources: FinancialSourceRef[] = [];
    for (const entry of selectedRaw) {
      const item = requireObject(
        entry,
        'Each selected source must be {salaryId, expectedSourceToken}.',
      );
      const salaryId = requireNonEmptyString(item['salaryId'], 'selectedSources[].salaryId');
      if (seen.has(salaryId)) {
        throw new FinancialInvalidError(`Duplicate selected source: ${salaryId}`);
      }
      seen.add(salaryId);
      selectedSources.push({
        salaryId,
        expectedSourceToken: requireNonEmptyString(
          item['expectedSourceToken'],
          'selectedSources[].expectedSourceToken',
        ),
      });
    }

    const mappingPolicyRaw = record['mappingPolicy'];
    if (mappingPolicyRaw !== 'preserve' && mappingPolicyRaw !== 'current') {
      throw new FinancialInvalidError("proposal.mappingPolicy must be 'preserve' or 'current'.");
    }
    const reasonRaw = record['reason'];
    if (
      reasonRaw !== 'salary-confirmation' &&
      reasonRaw !== 'income-reconciliation' &&
      reasonRaw !== 'mapping-restatement'
    ) {
      throw new FinancialInvalidError('proposal.reason is not supported.');
    }

    return {
      periodId,
      expectedRevision,
      expectedConfigRevision,
      expectedMappingRevision,
      selectedSources,
      mappingPolicy: mappingPolicyRaw,
      reason: reasonRaw,
    };
  }

  private liveSalaryOrThrow(salaryId: string): SalaryRow {
    const row = this.salaryRowById(salaryId);
    if (row === undefined || row.deleted === 1) {
      throw new FinancialSourceChangedError(`Salary source is no longer available: ${salaryId}`);
    }
    return row;
  }

  buildPreview(proposal: FinancialPeriodProposal): {
    readonly preview: FinancialPreview;
    readonly existing: PeriodRow | null;
    readonly effectiveSalaries: SalaryRow[];
    readonly config: FinancialConfig;
    readonly mapping: FinancialMappingSnapshot;
  } {
    const config = this.configService.readConfig();
    const currentMapping = this.configService.readMapping();

    if (proposal.expectedConfigRevision !== config.revision) {
      throw new FinancialRevisionConflictError(
        'The financial configuration was changed elsewhere. Reload it before saving again.',
      );
    }
    if (proposal.expectedMappingRevision !== currentMapping.revision) {
      throw new FinancialRevisionConflictError(
        'The category mapping was changed elsewhere. Reload it before saving again.',
      );
    }

    let existing: PeriodRow | null = null;
    if (proposal.periodId !== null) {
      existing = this.readPeriodRow(proposal.periodId);
      if (proposal.expectedRevision !== existing.active_revision) {
        throw new FinancialRevisionConflictError(
          'This financial period was changed elsewhere. Reload it before saving again.',
        );
      }
    } else if (proposal.expectedRevision !== 0) {
      throw new FinancialRevisionConflictError(
        'A new financial period must be proposed with expectedRevision 0.',
      );
    }

    if (
      existing !== null &&
      proposal.mappingPolicy === 'current' &&
      proposal.reason !== 'mapping-restatement'
    ) {
      throw new FinancialInvalidError(
        "Applying the current mapping to an existing period requires reason 'mapping-restatement'.",
      );
    }

    const existingRevision = existing === null ? null : this.activeRevisionRow(existing);
    const frozenMapping =
      existingRevision === null
        ? null
        : this.configService.readMappingByRevision(existingRevision.mapping_revision);

    const selected: SalaryRow[] = [];
    for (const ref of proposal.selectedSources) {
      const row = this.liveSalaryOrThrow(ref.salaryId);
      if (salarySourceToken(row) !== ref.expectedSourceToken) {
        throw new FinancialSourceChangedError(
          `Salary source changed since it was loaded: ${ref.salaryId}`,
        );
      }
      selected.push(row);
    }

    const effective = new Map<string, SalaryRow>();
    if (existing !== null && proposal.reason === 'salary-confirmation') {
      for (const source of this.periodView(existing).sources) {
        if (source.status !== 'valid' && source.status !== 'changed') continue;
        const live = this.salaryRowById(source.salaryId);
        if (live !== undefined && live.deleted === 0) effective.set(live.id, live);
      }
    }
    for (const row of selected) effective.set(row.id, row);
    const effectiveSalaries = [...effective.values()].sort(
      (a, b) => a.date - b.date || a.id.localeCompare(b.id),
    );

    const existingWindow =
      existingRevision === null ? null : this.parsePeriodWindow(existingRevision);
    const zone = existingWindow?.timeZone ?? config.timeZone;
    const cycle = existingWindow?.cycle ?? config.cycle;

    let groupMonth: string;
    if (existing !== null) {
      groupMonth = existing.group_month;
    } else if (effectiveSalaries.length > 0) {
      groupMonth = groupMonthOf(effectiveSalaries[0]!.date, zone);
    } else {
      throw new FinancialInvalidError('Cannot create a financial period with no salary sources.');
    }

    for (const row of effectiveSalaries) {
      if (groupMonthOf(row.date, zone) !== groupMonth) {
        throw new FinancialInvalidError(
          `All salary sources in a proposal must belong to group month ${groupMonth}.`,
        );
      }
    }

    const window = this.windowForGroup(groupMonth, zone, cycle, effectiveSalaries);
    if (window === null) {
      throw new FinancialInvalidError('Cannot resolve a cycle window with no salary sources.');
    }

    const cycleCollision = this.periodByCycleKey(window.cycleKey);
    let normalizedPeriodId = proposal.periodId;
    let normalizedRevision = proposal.expectedRevision;
    if (existing === null && cycleCollision !== undefined) {
      normalizedPeriodId = cycleCollision.id;
      normalizedRevision = cycleCollision.active_revision;
    }

    const ownership = this.activeOwnership();
    for (const row of effectiveSalaries) {
      const owner = ownership.get(row.id);
      if (owner !== undefined && owner.periodId !== normalizedPeriodId) {
        throw new FinancialSourceAlreadyIncludedError(
          `This salary is already included in another financial period: ${row.id}`,
        );
      }
    }

    const allGroupSalaries = this.liveSalaries().filter(
      (row) => groupMonthOf(row.date, zone) === groupMonth,
    );
    const selectedIds = new Set(effectiveSalaries.map((row) => row.id));
    const excludedSources: FinancialSalarySource[] = allGroupSalaries
      .filter((row) => !selectedIds.has(row.id))
      .map((row) => ({
        salaryId: row.id,
        amountCents: row.amount_cents,
        date: row.date,
        accountId: row.account_id,
        sourceToken: salarySourceToken(row),
        updatedAt: row.updated_at,
        includedPeriodId: ownership.get(row.id)?.periodId ?? null,
        includedRevision: ownership.get(row.id)?.revision ?? null,
        proposedGroupMonth: groupMonth,
        proposedWindow: window,
        selectable: true,
        reason: 'not-selected',
      }));

    const mapping =
      proposal.mappingPolicy === 'preserve' && frozenMapping !== null
        ? frozenMapping
        : currentMapping;

    const incomeCents = sumFinancialExecutionCents(
      effectiveSalaries.map((row) => row.amount_cents),
    );
    const frozenDecision =
      existingRevision === null
        ? null
        : this.parseDecision(existingRevision);
    const ratiosBps = frozenDecision?.ratiosBps ?? config.ratiosBps;
    let targets: PurposeAmounts;
    try {
      targets = allocateFinancialExecutionCents(incomeCents, ratiosBps);
    } catch (error) {
      rethrowSharedError(error);
    }
    const decision: FinancialAllocationDecision = {
      incomeCents,
      ratiosBps,
      targets,
      configRevision: frozenDecision?.configRevision ?? config.revision,
      mappingRevision: mapping.revision,
      mappingSnapshotId:
        existingRevision !== null && proposal.mappingPolicy === 'preserve'
          ? existingRevision.id
          : null,
      essentialMonthlyCents:
        frozenDecision?.essentialMonthlyCents ?? config.essentialMonthlyCents,
      targetMonths: frozenDecision?.targetMonths ?? config.targetMonths,
    };
    const sources = this.snapshotSources(effectiveSalaries, this.now());

    let reclassifiedExpenseCount = 0;
    let reclassifiedGrossCents = 0;
    if (existingRevision !== null && proposal.mappingPolicy === 'current') {
      const changed = this.expenseRowsInWindow(window).filter(
        (row) =>
          this.resolveExpensePurpose(row, frozenMapping!).purpose !==
          this.resolveExpensePurpose(row, mapping).purpose,
      );
      reclassifiedExpenseCount = changed.length;
      reclassifiedGrossCents = sumFinancialExecutionCents(
        changed.map((row) => row.amount_cents),
      );
    }

    const previousView = existing === null ? null : this.periodView(existing);
    const previousIds = new Set(previousView?.sources.map((source) => source.salaryId) ?? []);
    const nextIds = new Set(effectiveSalaries.map((row) => row.id));
    const impact = {
      addedSalaryIds: [...nextIds].filter((id) => !previousIds.has(id)).sort(),
      removedSalaryIds: [...previousIds].filter((id) => !nextIds.has(id)).sort(),
      changedSalaryIds: effectiveSalaries
        .filter((row) => {
          const previous = previousView?.sources.find((source) => source.salaryId === row.id);
          return previous !== undefined && previous.sourceToken !== salarySourceToken(row);
        })
        .map((row) => row.id)
        .sort(),
      mappingChanged:
        existingRevision !== null &&
        proposal.mappingPolicy === 'current' &&
        mapping.revision !== frozenMapping!.revision,
      reclassifiedExpenseCount,
      reclassifiedGrossCents,
    };

    const normalizedProposal: FinancialPeriodProposal = {
      ...proposal,
      periodId: normalizedPeriodId,
      expectedRevision: normalizedRevision,
    };

    const warnings = [...window.warnings];
    if (normalizedPeriodId !== null && proposal.periodId === null) {
      warnings.push('PERIOD_ALREADY_EXISTS');
    }
    if (proposal.mappingPolicy === 'current' && existingRevision !== null) {
      warnings.push('MAPPING_RESTATEMENT');
    }
    if (previousView !== null && previousView.sourceState !== 'valid') {
      warnings.push('SOURCE_RECONCILIATION_REQUIRED');
    }

    const previewToken = hashJson({
      proposal: normalizedProposal,
      sources: sources.map((source) => ({
        salaryId: source.salaryId,
        sourceToken: source.sourceToken,
      })),
      config: { enabled: config.enabled, revision: config.revision },
      mapping: { revision: mapping.revision, topologyToken: mapping.topologyToken },
      periodRevision: normalizedRevision,
      window,
      rules: FINANCIAL_EXECUTION_RULES,
    });

    const preview: FinancialPreview = {
      previewToken,
      proposal: normalizedProposal,
      window,
      decision,
      sources: sources.map((source) => ({
        ...source,
        status: 'valid' as const,
        current: {
          amountCents: source.amountCents,
          date: source.date,
          accountId: source.accountId,
          sourceToken: source.sourceToken,
        },
      })),
      excludedSources,
      previousRevision: previousView?.revision ?? 0,
      warnings,
      impact,
    };

    return { preview, existing, effectiveSalaries, config, mapping };
  }

  previewPeriod(rawBody: unknown): FinancialMeta & { preview: FinancialPreview } {
    const body = requireObject(rawBody, 'The request body must contain a proposal.');
    const proposal = this.parseProposal(body['proposal'] ?? body);
    const { preview } = this.buildPreview(proposal);
    return { ...this.meta(), preview };
  }

  confirmPeriod(
    rawBody: unknown,
  ): FinancialMeta & { period: FinancialPeriod; affectedPeriodIds: string[] } {
    return this.commitPeriod(rawBody, 'confirm');
  }

  reconcilePeriod(
    periodId: string,
    rawBody: unknown,
  ): FinancialMeta & { period: FinancialPeriod; affectedPeriodIds: string[] } {
    return this.commitPeriod(rawBody, 'reconcile', periodId);
  }

  private commitPeriod(
    rawBody: unknown,
    mode: 'confirm' | 'reconcile',
    pathPeriodId?: string,
  ): FinancialMeta & { period: FinancialPeriod; affectedPeriodIds: string[] } {
    const body = requireObject(
      rawBody,
      'The request body must contain operationId, proposal and previewToken.',
    );
    const operationId = requireFinancialOperationId(body['operationId']);
    const previewToken = requireNonEmptyString(body['previewToken'], 'previewToken');
    const proposal = this.parseProposal(body['proposal'] ?? body);

    if (mode === 'confirm' && proposal.reason !== 'salary-confirmation') {
      throw new FinancialInvalidError(
        "POST /periods/confirm only accepts reason 'salary-confirmation'. Use /periods/:id/reconcile.",
      );
    }
    if (mode === 'reconcile' && proposal.reason === 'salary-confirmation') {
      throw new FinancialInvalidError(
        "POST /periods/:id/reconcile does not accept reason 'salary-confirmation'.",
      );
    }
    if (
      pathPeriodId !== undefined &&
      proposal.periodId !== null &&
      proposal.periodId !== pathPeriodId
    ) {
      throw new FinancialInvalidError('proposal.periodId must match the period in the URL.');
    }
    const targetPeriodId = pathPeriodId ?? proposal.periodId;
    if (mode === 'reconcile' && targetPeriodId === null) {
      throw new FinancialInvalidError('A reconcile operation must name the period it reconciles.');
    }

    const resource =
      mode === 'confirm'
        ? `${FINANCIAL_PLANNING_BASE}/periods/confirm`
        : `${FINANCIAL_PLANNING_BASE}/periods/${targetPeriodId}/reconcile`;

    const result = runFinancialOperation<
      FinancialMeta & { period: FinancialPeriod; affectedPeriodIds: string[] }
    >(
      this.db,
      {
        operationId,
        actorId: this.resolveActorId(),
        method: 'POST',
        resource,
        canonicalPayload: { proposal, previewToken },
        now: this.now(),
      },
      () => {
        const rebuilt = this.buildPreview({ ...proposal, periodId: targetPeriodId });
        if (rebuilt.preview.previewToken !== previewToken) {
          throw new FinancialSourceChangedError(
            'The facts behind this preview changed. Reload the preview and confirm again.',
          );
        }
        if (!rebuilt.config.enabled) throw new FinancialDisabledError();

        const existing = rebuilt.existing;
        if (existing === null) {
          if (proposal.expectedRevision !== 0) {
            throw new FinancialRevisionConflictError('No financial period exists to revise.');
          }
        } else if (existing.active_revision !== proposal.expectedRevision) {
          throw new FinancialRevisionConflictError(
            'This financial period was changed elsewhere. Reload it before saving again.',
          );
        }

        const now = this.now();
        const written = this.writePeriodRevision({
          existing,
          preview: rebuilt.preview,
          actorId: this.resolveActorId(),
          operationId,
          now,
        });
        return {
          statusCode: 200,
          response: {
            ...this.meta(),
            period: this.periodView(written.period),
            affectedPeriodIds: written.affectedPeriodIds,
          },
        };
      },
    );

    return result.response;
  }

  private writePeriodRevision(input: {
    readonly existing: PeriodRow | null;
    readonly preview: FinancialPreview;
    readonly actorId: string;
    readonly operationId: string;
    readonly now: number;
  }): { period: PeriodRow; affectedPeriodIds: string[] } {
    const { existing, preview, now } = input;
    const window = preview.window;
    const affected = new Set<string>();

    const periodId = existing?.id ?? randomUUID();
    const revision = existing === null ? 1 : nextFinancialRevision(existing.active_revision);

    if (existing === null) {
      this.db
        .prepare(
          `INSERT INTO financial_periods (id, group_month, cycle_key, active_revision, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(periodId, window.groupMonth, window.cycleKey, revision, now, now);
    } else {
      this.db
        .prepare('UPDATE financial_periods SET active_revision = ?, updated_at = ? WHERE id = ?')
        .run(revision, now, periodId);
    }

    this.db
      .prepare(
        `INSERT INTO financial_period_revisions
           (id, period_id, revision, group_month, cycle_key, window_json, decision_json, sources_json,
            warnings_json, reason, config_revision, mapping_revision, confirmed_income_cents,
            actor_id, operation_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        periodId,
        revision,
        window.groupMonth,
        window.cycleKey,
        JSON.stringify(window),
        JSON.stringify(preview.decision),
        JSON.stringify(
          preview.sources.map((source) => ({
            salaryId: source.salaryId,
            amountCents: source.amountCents,
            date: source.date,
            accountId: source.accountId,
            sourceToken: source.sourceToken,
            confirmedAt: source.confirmedAt,
          })),
        ),
        JSON.stringify(preview.warnings),
        preview.proposal.reason,
        preview.decision.configRevision,
        preview.decision.mappingRevision,
        preview.decision.incomeCents,
        input.actorId,
        input.operationId,
        now,
      );

    const desired = new Map(preview.sources.map((source) => [source.salaryId, source]));
    const currentOwned = this.db
      .prepare('SELECT salary_id, period_id FROM financial_period_sources WHERE active = 1')
      .all() as { salary_id: string; period_id: string }[];

    for (const row of currentOwned) {
      if (row.period_id === periodId && !desired.has(row.salary_id)) {
        this.db
          .prepare(
            'UPDATE financial_period_sources SET active = 0, updated_at = ? WHERE period_id = ? AND salary_id = ?',
          )
          .run(now, periodId, row.salary_id);
        affected.add(row.period_id);
        continue;
      }
      if (row.period_id !== periodId && desired.has(row.salary_id)) {
        throw new FinancialSourceAlreadyIncludedError(
          `This salary is already included in another financial period: ${row.salary_id}`,
        );
      }
    }

    const upsert = this.db.prepare(
      `INSERT INTO financial_period_sources
         (period_id, salary_id, revision, active, snapshot_json, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?, ?)
       ON CONFLICT(period_id, salary_id)
       DO UPDATE SET revision = excluded.revision, active = 1,
                     snapshot_json = excluded.snapshot_json, updated_at = excluded.updated_at`,
    );
    for (const source of desired.values()) {
      upsert.run(
        periodId,
        source.salaryId,
        revision,
        JSON.stringify({
          salaryId: source.salaryId,
          amountCents: source.amountCents,
          date: source.date,
          accountId: source.accountId,
          sourceToken: source.sourceToken,
          confirmedAt: source.confirmedAt,
        }),
        now,
        now,
      );
    }

    affected.add(periodId);
    return { period: this.readPeriodRow(periodId), affectedPeriodIds: [...affected].sort() };
  }
}
