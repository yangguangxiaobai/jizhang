import {
  DEFAULT_FINANCIAL_RATIOS_BPS,
  FINANCIAL_EXECUTION_CONTRACT_VERSION,
  FINANCIAL_EXECUTION_RULES,
  validateFinancialExecutionConfig,
  validateFinancialRatiosBps,
  type FinancialCategoryNode,
  type FinancialCategoryRule,
  type FinancialCycle,
  type FinancialMappingSnapshot,
  type FinancialRatiosBps,
} from '@jizhang/shared';
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/index.js';
import {
  FinancialInvalidError,
  FinancialRevisionConflictError,
  FinancialUnavailableError,
} from './financial-errors.js';
import {
  runFinancialOperation,
  requireFinancialOperationId,
} from './financial-operation-store.js';
import {
  DEFAULT_TARGET_MONTHS,
  FINANCIAL_LIMITS,
  FINANCIAL_PLANNING_BASE,
  hashJson,
  nextFinancialRevision,
  requireNonEmptyString,
  requireObject,
  requireSafeInteger,
  requireSpendingPurposeOrNull,
  rethrowSharedError,
  type ConfigRow,
  type FinancialConfig,
  type FinancialMeta,
  type FinancialPlanningOptions,
  type MappingRow,
} from './financial-planning-types.js';

export class FinancialPlanningConfigService {
  private readonly db: Db;
  private readonly now: () => number;
  private readonly actorIdOption: string | undefined;
  private readonly zoneOption: string | undefined;

  constructor(db: Db, options: FinancialPlanningOptions = {}) {
    this.db = db;
    this.now = options.now ?? (() => Date.now());
    this.actorIdOption = options.actorId;
    this.zoneOption = options.serverTimeZone;
  }

  meta(): FinancialMeta {
    return {
      contractVersion: FINANCIAL_EXECUTION_CONTRACT_VERSION,
      rules: FINANCIAL_EXECUTION_RULES,
      calculatedAt: this.now(),
    };
  }

  serverTimeZone(): string {
    if (this.zoneOption !== undefined) return this.zoneOption;
    const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === 'string' && zone !== '' ? zone : 'UTC';
  }

  legacyCycle(): FinancialCycle {
    const row = this.db
      .prepare('SELECT value_json FROM settings WHERE key = ?')
      .get('budget.cycle_start_day') as { value_json: string } | undefined;
    if (row === undefined) return { kind: 'natural-month' };
    try {
      const decoded: unknown = JSON.parse(row.value_json);
      if (typeof decoded !== 'object' || decoded === null) return { kind: 'natural-month' };
      const day = (decoded as Record<string, unknown>)['day'];
      if (typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > 28) {
        return { kind: 'natural-month' };
      }
      return { kind: 'start-day', day };
    } catch {
      return { kind: 'natural-month' };
    }
  }

  resolveActorId(): string {
    if (this.actorIdOption !== undefined && this.actorIdOption !== '') return this.actorIdOption;
    const row = this.db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get() as
      | { id: string }
      | undefined;
    if (row === undefined) throw new FinancialInvalidError('No account exists on this server yet.');
    return row.id;
  }

  capabilities(): FinancialMeta & Record<string, unknown> {
    return {
      ...this.meta(),
      phase: 1,
      executionSupported: true,
      salaryIdempotency: true,
      billPurposeOverride: true,
      refundSplits: true,
      fundingExecution: false,
      review: false,
      aiExplanation: false,
      limits: FINANCIAL_LIMITS,
      serverTimeZone: this.serverTimeZone(),
      legacyManualPlan: true,
    };
  }

  virtualConfig(): FinancialConfig {
    return {
      revision: 0,
      enabled: false,
      ratiosBps: DEFAULT_FINANCIAL_RATIOS_BPS,
      essentialMonthlyCents: null,
      targetMonths: DEFAULT_TARGET_MONTHS,
      cycle: this.legacyCycle(),
      timeZone: this.serverTimeZone(),
      updatedAt: null,
    };
  }

  readConfig(): FinancialConfig {
    const row = this.db
      .prepare('SELECT * FROM financial_config_revisions ORDER BY revision DESC LIMIT 1')
      .get() as ConfigRow | undefined;
    if (row === undefined) return this.virtualConfig();

    if (!Number.isSafeInteger(row.revision) || row.revision < 1) throw new FinancialUnavailableError();
    if (row.enabled !== 0 && row.enabled !== 1) throw new FinancialUnavailableError();
    if (!Number.isSafeInteger(row.created_at) || row.created_at < 0) {
      throw new FinancialUnavailableError();
    }
    if (row.essential_monthly_cents !== null && !Number.isSafeInteger(row.essential_monthly_cents)) {
      throw new FinancialUnavailableError();
    }

    let ratios: FinancialRatiosBps;
    let cycle: FinancialCycle;
    try {
      ratios = validateFinancialRatiosBps(JSON.parse(row.ratios_json));
      const parsed = validateFinancialExecutionConfig({
        enabled: row.enabled === 1,
        ratiosBps: ratios,
        essentialMonthlyCents: row.essential_monthly_cents,
        targetMonths: row.target_months,
        cycle: JSON.parse(row.cycle_json),
        timeZone: row.time_zone,
      });
      ratios = parsed.ratiosBps;
      cycle = parsed.cycle;
    } catch (error) {
      rethrowSharedError(error, true);
    }

    return {
      revision: row.revision,
      enabled: row.enabled === 1,
      ratiosBps: ratios,
      essentialMonthlyCents: row.essential_monthly_cents,
      targetMonths: row.target_months,
      cycle,
      timeZone: row.time_zone,
      updatedAt: row.created_at,
    };
  }

  getConfig(): FinancialMeta & {
    config: FinancialConfig;
    mappingRevision: number;
    legacyCycle: FinancialCycle;
  } {
    return {
      ...this.meta(),
      config: this.readConfig(),
      mappingRevision: this.readMapping().revision,
      legacyCycle: this.legacyCycle(),
    };
  }

  putConfig(rawBody: unknown): FinancialMeta & { config: FinancialConfig } {
    const body = requireObject(rawBody, 'The request body must be an object.');
    const operationId = requireFinancialOperationId(body['operationId']);
    const expectedRevision = requireSafeInteger(body['expectedRevision'], 'expectedRevision', 0);
    const input = this.parseConfigInput(body);
    const now = this.now();
    const actorId = this.resolveActorId();

    const result = runFinancialOperation<FinancialMeta & { config: FinancialConfig }>(
      this.db,
      {
        operationId,
        actorId,
        method: 'PUT',
        resource: `${FINANCIAL_PLANNING_BASE}/config`,
        canonicalPayload: { expectedRevision, ...input },
        now,
      },
      () => {
        const current = this.readConfig();
        if (current.revision !== expectedRevision) {
          throw new FinancialRevisionConflictError(
            'The financial configuration was changed elsewhere. Reload it before saving again.',
          );
        }
        const revision = nextFinancialRevision(current.revision);
        this.db
          .prepare(
            `INSERT INTO financial_config_revisions
               (id, revision, enabled, ratios_json, essential_monthly_cents, target_months,
                cycle_json, time_zone, actor_id, operation_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            randomUUID(),
            revision,
            input.enabled ? 1 : 0,
            JSON.stringify(input.ratiosBps),
            input.essentialMonthlyCents,
            input.targetMonths,
            JSON.stringify(input.cycle),
            input.timeZone,
            actorId,
            operationId,
            now,
          );
        const config = this.readConfig();
        return { statusCode: 200, response: { ...this.meta(), config } };
      },
    );
    return result.response;
  }

  private parseConfigInput(body: Record<string, unknown>): {
    enabled: boolean;
    ratiosBps: FinancialRatiosBps;
    essentialMonthlyCents: number | null;
    targetMonths: number;
    cycle: FinancialCycle;
    timeZone: string;
  } {
    if (typeof body['enabled'] !== 'boolean') {
      throw new FinancialInvalidError('enabled must be a boolean.');
    }
    try {
      const parsed = validateFinancialExecutionConfig({
        enabled: body['enabled'],
        ratiosBps: body['ratiosBps'],
        essentialMonthlyCents: body['essentialMonthlyCents'],
        targetMonths: body['targetMonths'],
        cycle: body['cycle'],
        timeZone: body['timeZone'],
      });
      return parsed;
    } catch (error) {
      rethrowSharedError(error);
    }
  }

  liveTopology(): FinancialCategoryNode[] {
    const rows = this.db
      .prepare('SELECT id, parent_id, deleted FROM categories WHERE type = 0 ORDER BY id')
      .all() as { id: string; parent_id: string | null; deleted: number }[];
    return rows.map((row) => ({
      id: row.id,
      parentId: row.parent_id,
      deleted: row.deleted === 1,
    }));
  }

  topologyTokenOf(categories: readonly FinancialCategoryNode[]): string {
    return hashJson([...categories].sort((a, b) => a.id.localeCompare(b.id)));
  }

  readMapping(): FinancialMappingSnapshot {
    const row = this.db
      .prepare('SELECT * FROM financial_mapping_revisions ORDER BY revision DESC LIMIT 1')
      .get() as MappingRow | undefined;
    if (row === undefined) {
      const categories = this.liveTopology();
      return {
        revision: 0,
        rules: [],
        categories,
        topologyToken: this.topologyTokenOf(categories),
        updatedAt: null,
      };
    }
    try {
      const rules = JSON.parse(row.rules_json) as FinancialCategoryRule[];
      const categories = JSON.parse(row.topology_json) as FinancialCategoryNode[];
      if (!Array.isArray(rules) || !Array.isArray(categories)) throw new FinancialUnavailableError();
      return {
        revision: row.revision,
        rules,
        categories,
        topologyToken: row.topology_token,
        updatedAt: row.created_at,
      };
    } catch (error) {
      if (error instanceof FinancialUnavailableError) throw error;
      throw new FinancialUnavailableError();
    }
  }

  readMappingByRevision(revision: number): FinancialMappingSnapshot {
    if (revision === 0) {
      const categories = this.liveTopology();
      return {
        revision: 0,
        rules: [],
        categories,
        topologyToken: this.topologyTokenOf(categories),
        updatedAt: null,
      };
    }
    const row = this.db
      .prepare('SELECT * FROM financial_mapping_revisions WHERE revision = ?')
      .get(revision) as MappingRow | undefined;
    if (row === undefined) throw new FinancialUnavailableError();
    try {
      return {
        revision: row.revision,
        rules: JSON.parse(row.rules_json) as FinancialCategoryRule[],
        categories: JSON.parse(row.topology_json) as FinancialCategoryNode[],
        topologyToken: row.topology_token,
        updatedAt: row.created_at,
      };
    } catch {
      throw new FinancialUnavailableError();
    }
  }

  getMapping(): FinancialMeta & { mapping: FinancialMappingSnapshot } {
    const current = this.readMapping();
    const live = this.liveTopology();
    return {
      ...this.meta(),
      mapping: {
        revision: current.revision,
        rules: current.rules,
        categories: live,
        topologyToken: this.topologyTokenOf(live),
        updatedAt: current.updatedAt,
      },
    };
  }

  putMapping(rawBody: unknown): FinancialMeta & { mapping: FinancialMappingSnapshot } {
    const body = requireObject(rawBody, 'The request body must be an object.');
    const operationId = requireFinancialOperationId(body['operationId']);
    const expectedRevision = requireSafeInteger(body['expectedRevision'], 'expectedRevision', 0);
    const expectedTopologyToken = requireNonEmptyString(
      body['expectedTopologyToken'],
      'expectedTopologyToken',
    );
    const rules = this.parseCategoryRules(body['rules']);
    const now = this.now();
    const actorId = this.resolveActorId();
    const topology = this.liveTopology();
    const token = this.topologyTokenOf(topology);

    const result = runFinancialOperation<FinancialMeta & { mapping: FinancialMappingSnapshot }>(
      this.db,
      {
        operationId,
        actorId,
        method: 'PUT',
        resource: `${FINANCIAL_PLANNING_BASE}/category-rules`,
        canonicalPayload: { expectedRevision, expectedTopologyToken, rules },
        now,
      },
      () => {
        const current = this.readMapping();
        if (current.revision !== expectedRevision) {
          throw new FinancialRevisionConflictError(
            'The category mapping was changed elsewhere. Reload it before saving again.',
          );
        }
        if (token !== expectedTopologyToken) {
          throw new FinancialRevisionConflictError(
            'The category tree changed since it was loaded. Reload the mapping before saving again.',
          );
        }
        const revision = nextFinancialRevision(current.revision);
        this.db
          .prepare(
            `INSERT INTO financial_mapping_revisions
               (id, revision, rules_json, topology_json, topology_token, actor_id, operation_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            randomUUID(),
            revision,
            JSON.stringify(rules),
            JSON.stringify(topology),
            token,
            actorId,
            operationId,
            now,
          );
        return { statusCode: 200, response: { ...this.meta(), mapping: this.readMapping() } };
      },
    );
    return result.response;
  }

  private parseCategoryRules(raw: unknown): FinancialCategoryRule[] {
    if (!Array.isArray(raw)) {
      throw new FinancialInvalidError('rules must be an array of {categoryId, purpose}.');
    }
    if (raw.length > FINANCIAL_LIMITS.categoryRules) {
      throw new FinancialInvalidError(
        `rules may contain at most ${FINANCIAL_LIMITS.categoryRules} entries.`,
      );
    }
    const seen = new Set<string>();
    const rules: FinancialCategoryRule[] = [];
    for (const entry of raw) {
      const record = requireObject(entry, 'Each rule must be {categoryId, purpose}.');
      const categoryId = requireNonEmptyString(record['categoryId'], 'rules[].categoryId');
      if (seen.has(categoryId)) {
        throw new FinancialInvalidError(`Duplicate rule for category ${categoryId}.`);
      }
      seen.add(categoryId);
      const purpose = requireSpendingPurposeOrNull(record['purpose'], 'rules[].purpose');
      const row = this.db.prepare('SELECT type FROM categories WHERE id = ?').get(categoryId) as
        | { type: number }
        | undefined;
      if (row === undefined) {
        throw new FinancialInvalidError(`Unknown category: ${categoryId}`);
      }
      if (row.type !== 0) {
        throw new FinancialInvalidError(
          `Only expense categories can be mapped to a spending purpose: ${categoryId}`,
        );
      }
      rules.push({ categoryId, purpose });
    }
    this.assertTopologyAcyclic();
    return rules;
  }

  private assertTopologyAcyclic(): void {
    const rows = this.db
      .prepare('SELECT id, parent_id FROM categories WHERE type = 0')
      .all() as { id: string; parent_id: string | null }[];
    const parents = new Map(rows.map((row) => [row.id, row.parent_id]));
    for (const row of rows) {
      const visited = new Set<string>([row.id]);
      let cursor = row.parent_id;
      while (cursor !== null && cursor !== undefined) {
        if (visited.has(cursor)) {
          throw new FinancialInvalidError('The category tree contains a cycle.');
        }
        visited.add(cursor);
        cursor = parents.get(cursor) ?? null;
      }
    }
  }
}
