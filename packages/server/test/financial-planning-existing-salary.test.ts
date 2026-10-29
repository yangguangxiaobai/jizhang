/**
 * Phase 1 — using an ALREADY-RECORDED salary to start a four-purpose period.
 *
 * This file is a narrow backend integration regression for the flow the user
 * approved on 2026-10-27: pick an existing salary, preview deterministically,
 * then explicitly confirm. It deliberately does not create a second salary,
 * funding, transfers or any ledger movement.
 *
 * Pinned properties (public HTTP API, real `AuthService`, in-memory migrated DB,
 * fixed clock — no service calls, no ports, no production data):
 *
 * 1. `POST /periods/preview` is a pure read: `total_changes()` and every
 *    money/planning row are unchanged, and balances do not move.
 * 2. `POST /periods/confirm` adds ONLY planning facts (period, revision, source
 *    ownership, replay row). Salary records, allocation snapshots,
 *    transactions, transfers, accounts, settings and the derived balance sheet
 *    stay byte-for-byte identical.
 * 3. Replaying the identical confirm with the same `operationId` returns the
 *    original response and creates no second period/revision/ownership row.
 * 4. A salary actively owned by one period cannot be added to another active
 *    period, and a rejected write does not consume its `operationId`; the
 *    database-level partial unique index is the final backstop.
 * 5. Appending a second salary to a historical period keeps the prior source
 *    active and the old revision readable, while freezing the original
 *    ratios/config revision (the changed current config is not adopted).
 *
 * The arithmetic asserted here is the literal acceptance fixture
 * (100.00 -> 25.00/15.00/50.00/10.00 and 150.00 with the same frozen ratios).
 * Production rules stay in `@jizhang/shared` and are not re-implemented.
 */
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FinancialCycle, SpendingPurpose } from '@jizhang/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { closeDatabase, initializeDatabase, type Db } from '../src/db/index.js';
import { SESSION_COOKIE } from '../src/plugins/auth.js';
import { AuthService } from '../src/services/auth-service.js';
import type {
  FinancialConfig,
  FinancialMeta,
  FinancialPeriod,
  FinancialPeriodProposal,
  FinancialPreview,
  FinancialSalarySource,
} from '../src/services/financial-planning-service.js';
import type { SalaryDetailDto, SalaryDto } from '../src/services/salary-service.js';

const USERNAME = 'quiz';
const PASSWORD = 'correct horse battery staple';
const CSRF = { 'x-requested-with': 'fetch' } as const;

const NOW = Date.UTC(2026, 9, 27, 4, 0, 0); // 2026-10-27 12:00 in Asia/Shanghai
const TIME_ZONE = 'Asia/Shanghai';
const BASE = '/api/v1/financial-planning';
const API = '/api/v1';

const SEP_SALARY_DATE = Date.UTC(2026, 8, 10, 4, 0, 0); // 2026-09-10 12:00 local
const SEP_SECOND_SALARY_DATE = Date.UTC(2026, 8, 20, 4, 0, 0); // 2026-09-20 12:00 local
const SEP_MOVED_SALARY_DATE = Date.UTC(2026, 8, 15, 4, 0, 0); // 2026-09-15 12:00 local
const OCT_SALARY_DATE = Date.UTC(2026, 9, 10, 4, 0, 0); // 2026-10-10 12:00 local

const DEFAULT_RATIOS = { growth: 2500, reserve: 1500, essentials: 5000, joy: 1000 } as const;

/** Money-bearing tables whose rows must never be touched by planning reads/writes. */
const MONEY_TABLES = [
  'salary_records',
  'budget_allocations',
  'transactions',
  'transfers',
  'accounts',
  'settings',
] as const;

/** Planning tables, counted to prove exactly which records a confirm adds. */
const PLANNING_TABLES = [
  'financial_config_revisions',
  'financial_mapping_revisions',
  'financial_periods',
  'financial_period_revisions',
  'financial_period_sources',
  'financial_bill_purpose_events',
  'financial_refund_splits',
  'financial_refund_split_sets',
  'financial_operations',
] as const;

type TableName = (typeof MONEY_TABLES)[number] | (typeof PLANNING_TABLES)[number];

type ConfigResponse = FinancialMeta & {
  config: FinancialConfig;
  mappingRevision: number;
  legacyCycle: FinancialCycle;
};

type MappingResponse = FinancialMeta & {
  mapping: {
    revision: number;
    topologyToken: string;
    rules: readonly { categoryId: string; purpose: SpendingPurpose | null }[];
    categories: readonly { id: string; parentId: string | null; deleted: boolean }[];
    updatedAt: number | null;
  };
};

type SourceListResponse = FinancialMeta & {
  items: FinancialSalarySource[];
  total: number;
  limit: number;
  offset: number;
};

type PreviewResponse = FinancialMeta & { preview: FinancialPreview };

type PeriodResponse = FinancialMeta & {
  period: FinancialPeriod;
  affectedPeriodIds: string[];
};

type PeriodListResponse = FinancialMeta & {
  items: FinancialPeriod[];
  total: number;
  limit: number;
  offset: number;
  currentPeriodId: string | null;
};

type PeriodRevisionsResponse = FinancialMeta & {
  items: FinancialPeriod[];
  total: number;
  limit: number;
  offset: number;
};

type OperationResponse = FinancialMeta & {
  operation: {
    operationId: string;
    method: string;
    resource: string;
    statusCode: number;
    response: unknown;
    committedAt: number;
  };
};

type BalancesResponse = {
  items: unknown[];
  totalBalanceCents: number;
  totalAssetsCents: number;
  totalLiabilitiesCents: number;
};

interface BaseFixture {
  readonly accountId: string;
  readonly essentialsCategoryId: string;
  readonly joyCategoryId: string;
  readonly incomeCategoryId: string;
  readonly configRevision: number;
  readonly mappingRevision: number;
}

let db: Db;
let app: FastifyInstance;
let cookie: string;
let clock = NOW;

function requestId(): string {
  return randomUUID();
}

function authed(): Record<string, string> {
  return { ...CSRF, Cookie: `${SESSION_COOKIE}=${cookie}` };
}

async function call(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
) {
  return app.inject({
    method,
    url,
    headers: authed(),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

async function getJson<T>(url: string): Promise<T> {
  const response = await call('GET', url);
  expect(response.statusCode, `${url}: ${response.body}`).toBe(200);
  return response.json() as T;
}

function errorCode(response: Awaited<ReturnType<typeof call>>): string {
  return (response.json() as { error?: { code?: string } }).error?.code ?? '';
}

function expectError(
  response: Awaited<ReturnType<typeof call>>,
  statusCode: number,
  code: string,
): void {
  expect(response.statusCode, response.body).toBe(statusCode);
  expect(errorCode(response), response.body).toBe(code);
}

function totalChanges(): number {
  const row = db.prepare('SELECT total_changes() AS count').get() as { count: number };
  return row.count;
}

function rows(table: TableName): unknown[] {
  return db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
}

/** Every money-bearing row, so a planning write cannot silently alter one. */
function moneySnapshot(): Record<string, unknown[]> {
  return Object.fromEntries(MONEY_TABLES.map((table) => [table, rows(table)]));
}

function planningCounts(): Record<string, number> {
  return Object.fromEntries(
    PLANNING_TABLES.map((table) => {
      const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
        count: number;
      };
      return [table, row.count];
    }),
  );
}

function countDelta(
  before: Record<string, number>,
  after: Record<string, number>,
  table: string,
): number {
  return (after[table] ?? 0) - (before[table] ?? 0);
}

async function login(): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: CSRF,
    payload: { username: USERNAME, password: PASSWORD },
  });
  const found = (response.cookies as { name: string; value: string }[]).find(
    (entry) => entry.name === SESSION_COOKIE,
  );
  return found?.value as string;
}

async function createAccount(name: string): Promise<string> {
  const response = await call('POST', `${API}/accounts`, { name, type: 0 });
  expect(response.statusCode, response.body).toBe(201);
  return (response.json() as { id: string }).id;
}

async function createCategory(name: string, type: 0 | 1): Promise<string> {
  const response = await call('POST', `${API}/categories`, { name, type });
  expect(response.statusCode, response.body).toBe(201);
  return (response.json() as { id: string }).id;
}

async function getConfig(): Promise<ConfigResponse> {
  return getJson<ConfigResponse>(`${BASE}/config`);
}

async function getMapping(): Promise<MappingResponse> {
  return getJson<MappingResponse>(`${BASE}/category-rules`);
}

async function createBaseFixture(): Promise<BaseFixture> {
  const accountId = await createAccount('既有工资测试账户');
  const essentialsCategoryId = await createCategory('既有工资必要', 0);
  const joyCategoryId = await createCategory('既有工资享受', 0);
  const incomeCategoryId = await createCategory('既有工资收入', 1);

  const before = await getConfig();
  const configResponse = await call('PUT', `${BASE}/config`, {
    operationId: requestId(),
    expectedRevision: before.config.revision,
    enabled: true,
    ratiosBps: { ...DEFAULT_RATIOS },
    essentialMonthlyCents: 5000,
    targetMonths: 5,
    cycle: { kind: 'natural-month' },
    timeZone: TIME_ZONE,
  });
  expect(configResponse.statusCode, configResponse.body).toBe(200);
  const config = configResponse.json() as ConfigResponse;

  const mappingBefore = await getMapping();
  const mappingResponse = await call('PUT', `${BASE}/category-rules`, {
    operationId: requestId(),
    expectedRevision: mappingBefore.mapping.revision,
    expectedTopologyToken: mappingBefore.mapping.topologyToken,
    rules: [
      { categoryId: essentialsCategoryId, purpose: 'essentials' },
      { categoryId: joyCategoryId, purpose: 'joy' },
    ],
  });
  expect(mappingResponse.statusCode, mappingResponse.body).toBe(200);
  const mapping = mappingResponse.json() as MappingResponse;

  return {
    accountId,
    essentialsCategoryId,
    joyCategoryId,
    incomeCategoryId,
    configRevision: config.config.revision,
    mappingRevision: mapping.mapping.revision,
  };
}

async function createSalary(
  accountId: string,
  amountCents: number,
  date: number,
  note = '既有工资流水',
): Promise<SalaryDetailDto> {
  const response = await call('POST', `${API}/salaries`, {
    amountCents,
    date,
    accountId,
    note,
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as SalaryDetailDto;
}

async function salarySources(groupMonth: string): Promise<SourceListResponse> {
  return getJson<SourceListResponse>(
    `${BASE}/sources/salaries?groupMonth=${encodeURIComponent(groupMonth)}&timeZone=${encodeURIComponent(TIME_ZONE)}`,
  );
}

async function sourceRef(groupMonth: string, salaryId: string): Promise<{ salaryId: string; expectedSourceToken: string }> {
  const sources = await salarySources(groupMonth);
  const found = sources.items.find((item) => item.salaryId === salaryId);
  if (found === undefined) throw new Error(`salary source not returned: ${salaryId}`);
  return { salaryId: found.salaryId, expectedSourceToken: found.sourceToken };
}

async function newPeriodProposal(
  groupMonth: string,
  salaryIds: readonly string[],
): Promise<FinancialPeriodProposal> {
  const selectedSources = [];
  for (const salaryId of salaryIds) selectedSources.push(await sourceRef(groupMonth, salaryId));
  const config = await getConfig();
  const mapping = await getMapping();
  return {
    periodId: null,
    expectedRevision: 0,
    expectedConfigRevision: config.config.revision,
    expectedMappingRevision: mapping.mapping.revision,
    selectedSources,
    mappingPolicy: 'preserve',
    reason: 'salary-confirmation',
  };
}

async function previewPeriod(
  proposal: FinancialPeriodProposal,
): Promise<{ response: Awaited<ReturnType<typeof call>>; preview: FinancialPreview }> {
  const response = await call('POST', `${BASE}/periods/preview`, { proposal });
  expect(response.statusCode, response.body).toBe(200);
  return { response, preview: (response.json() as PreviewResponse).preview };
}

async function confirmPeriod(
  proposal: FinancialPeriodProposal,
  previewToken: string,
  operationId = requestId(),
): Promise<PeriodResponse> {
  const response = await call('POST', `${BASE}/periods/confirm`, {
    operationId,
    proposal,
    previewToken,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as PeriodResponse;
}

async function previewAndConfirm(
  groupMonth: string,
  salaryIds: readonly string[],
): Promise<PeriodResponse> {
  const proposal = await newPeriodProposal(groupMonth, salaryIds);
  const { preview } = await previewPeriod(proposal);
  return confirmPeriod(proposal, preview.previewToken);
}

async function updateConfig(overrides: {
  ratiosBps: { growth: number; reserve: number; essentials: number; joy: number };
  essentialMonthlyCents: number;
  targetMonths: number;
}): Promise<ConfigResponse> {
  const before = await getConfig();
  const response = await call('PUT', `${BASE}/config`, {
    operationId: requestId(),
    expectedRevision: before.config.revision,
    enabled: true,
    ratiosBps: overrides.ratiosBps,
    essentialMonthlyCents: overrides.essentialMonthlyCents,
    targetMonths: overrides.targetMonths,
    cycle: { kind: 'natural-month' },
    timeZone: TIME_ZONE,
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as ConfigResponse;
}

async function balances(): Promise<BalancesResponse> {
  return getJson<BalancesResponse>(`${API}/accounts/balances`);
}

beforeEach(async () => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeDatabase(db, null);
  clock = NOW;

  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    JIZHANG_USERNAME: USERNAME,
    JIZHANG_PASSWORD_HASH: 'unused',
    DATA_DIR: './data',
  });
  const authService = new AuthService(db, {
    sessionTtlDays: config.sessionTtlDays,
    now: () => clock,
  });
  await authService.setPassword(USERNAME, PASSWORD);
  app = buildApp({ config, db, authService, secureCookies: false, now: () => clock });
  await app.ready();
  cookie = await login();
});

afterEach(async () => {
  await app.close();
  closeDatabase(db);
});

describe('existing salary as the entry to a four-purpose period', () => {
  it('rejects stale configuration and mapping revisions without writing', async () => {
    const base = await createBaseFixture();
    const salary = await createSalary(base.accountId, 10_000, SEP_SALARY_DATE);
    const proposal = await newPeriodProposal('2026-09', [salary.id]);
    const before = totalChanges();
    for (const stale of [
      { ...proposal, expectedConfigRevision: proposal.expectedConfigRevision - 1 },
      { ...proposal, expectedMappingRevision: proposal.expectedMappingRevision - 1 },
    ]) {
      const result = await call('POST', `${BASE}/periods/preview`, { proposal: stale });
      expectError(result, 409, 'FINANCIAL_REVISION_CONFLICT');
    }
    expect(totalChanges()).toBe(before);
  });

  it('rejects malformed frozen allocation ratios rather than returning corrupt history', async () => {
    const base = await createBaseFixture();
    const salary = await createSalary(base.accountId, 10_000, SEP_SALARY_DATE);
    const confirmed = await previewAndConfirm('2026-09', [salary.id]);
    const revision = db.prepare('SELECT id, decision_json FROM financial_period_revisions WHERE period_id = ?')
      .get(confirmed.period.id) as { id: string; decision_json: string };
    const decision = JSON.parse(revision.decision_json) as Record<string, unknown>;
    decision['ratiosBps'] = { growth: 1, reserve: 1, essentials: 1, joy: 1 };
    db.prepare('UPDATE financial_period_revisions SET decision_json = ? WHERE id = ?')
      .run(JSON.stringify(decision), revision.id);
    const result = await call('GET', `${BASE}/periods/${confirmed.period.id}`);
    expectError(result, 503, 'FINANCIAL_UNAVAILABLE');
  });

  it('previews an already-recorded salary without writing a single row', async () => {
    const base = await createBaseFixture();
    const salary = await createSalary(base.accountId, 10_000, SEP_SALARY_DATE);
    const proposal = await newPeriodProposal('2026-09', [salary.id]);

    const beforeChanges = totalChanges();
    const beforeMoney = moneySnapshot();
    const beforeCounts = planningCounts();
    const beforeBalances = await balances();

    const { preview } = await previewPeriod(proposal);

    expect(preview.proposal).toMatchObject({ periodId: null, expectedRevision: 0 });
    expect(preview.sources.map((source) => source.salaryId)).toEqual([salary.id]);
    expect(preview.sources[0]!.amountCents).toBe(10_000);
    expect(preview.excludedSources).toEqual([]);
    expect(preview.decision.incomeCents).toBe(10_000);
    expect(preview.decision.targets).toEqual({
      growth: 2_500,
      reserve: 1_500,
      essentials: 5_000,
      joy: 1_000,
    });

    expect(totalChanges()).toBe(beforeChanges);
    expect(moneySnapshot()).toEqual(beforeMoney);
    expect(planningCounts()).toEqual(beforeCounts);
    expect(await balances()).toEqual(beforeBalances);
  });

  it('confirming an existing salary adds only planning facts, never salary/ledger/account/balance facts', async () => {
    const base = await createBaseFixture();
    const salary = await createSalary(base.accountId, 10_000, SEP_SALARY_DATE);
    const proposal = await newPeriodProposal('2026-09', [salary.id]);
    const { preview } = await previewPeriod(proposal);

    const beforeMoney = moneySnapshot();
    const beforeCounts = planningCounts();
    const beforeBalances = await balances();
    const beforeSalaryDetail = await getJson<SalaryDetailDto>(`${API}/salaries/${salary.id}`);
    const beforeSalaryList = await getJson<{ items: SalaryDto[] }>(`${API}/salaries`);
    const beforeConfig = (await getConfig()).config;
    const beforeMapping = (await getMapping()).mapping;

    const operationId = requestId();
    const confirmed = await confirmPeriod(proposal, preview.previewToken, operationId);

    expect(confirmed.period.sources.map((source) => source.salaryId)).toEqual([salary.id]);
    expect(confirmed.period.sourceState).toBe('valid');
    expect(confirmed.period.confirmedIncomeCents).toBe(10_000);
    expect(confirmed.period.verifiedIncomeCents).toBe(10_000);
    expect(confirmed.affectedPeriodIds).toEqual([confirmed.period.id]);

    // Nothing about the salary, its allocation snapshot, the ledger, the
    // accounts, the legacy cycle settings or the balance sheet may change.
    expect(moneySnapshot()).toEqual(beforeMoney);
    expect(await balances()).toEqual(beforeBalances);
    expect(await getJson<SalaryDetailDto>(`${API}/salaries/${salary.id}`)).toEqual(
      beforeSalaryDetail,
    );
    expect(await getJson<{ items: SalaryDto[] }>(`${API}/salaries`)).toEqual(beforeSalaryList);
    expect((await getConfig()).config).toEqual(beforeConfig);
    expect((await getMapping()).mapping).toEqual(beforeMapping);

    const afterCounts = planningCounts();
    expect(countDelta(beforeCounts, afterCounts, 'financial_periods')).toBe(1);
    expect(countDelta(beforeCounts, afterCounts, 'financial_period_revisions')).toBe(1);
    expect(countDelta(beforeCounts, afterCounts, 'financial_period_sources')).toBe(1);
    expect(countDelta(beforeCounts, afterCounts, 'financial_operations')).toBe(1);
    expect(countDelta(beforeCounts, afterCounts, 'financial_config_revisions')).toBe(0);
    expect(countDelta(beforeCounts, afterCounts, 'financial_mapping_revisions')).toBe(0);
    expect(countDelta(beforeCounts, afterCounts, 'financial_refund_splits')).toBe(0);
    expect(countDelta(beforeCounts, afterCounts, 'financial_refund_split_sets')).toBe(0);
    expect(countDelta(beforeCounts, afterCounts, 'financial_bill_purpose_events')).toBe(0);

    // The only replay row is the confirm itself, and it is recoverable.
    const operation = await getJson<OperationResponse>(`${BASE}/operations/${operationId}`);
    expect(operation.operation).toMatchObject({
      operationId,
      method: 'POST',
      resource: `${BASE}/periods/confirm`,
      statusCode: 200,
      committedAt: NOW,
    });
  });

  it('replays the identical confirm with the same operationId without a duplicate period or ownership row', async () => {
    const base = await createBaseFixture();
    const salary = await createSalary(base.accountId, 10_000, SEP_SALARY_DATE);
    const proposal = await newPeriodProposal('2026-09', [salary.id]);
    const { preview } = await previewPeriod(proposal);
    const operationId = requestId();

    const first = await confirmPeriod(proposal, preview.previewToken, operationId);
    const firstCounts = planningCounts();

    const replayResponse = await call('POST', `${BASE}/periods/confirm`, {
      operationId,
      proposal,
      previewToken: preview.previewToken,
    });
    expect(replayResponse.statusCode, replayResponse.body).toBe(200);
    expect(replayResponse.json()).toEqual(first);

    expect(planningCounts()).toEqual(firstCounts);
    expect(firstCounts['financial_periods']).toBe(1);
    expect(firstCounts['financial_period_revisions']).toBe(1);
    expect(firstCounts['financial_period_sources']).toBe(1);

    const periods = await getJson<PeriodListResponse>(`${BASE}/periods`);
    expect(periods.total).toBe(1);
    expect(periods.items[0]!.id).toBe(first.period.id);
    expect(periods.items[0]!.revision).toBe(1);
    expect(periods.items[0]!.sources.map((source) => source.salaryId)).toEqual([salary.id]);
  });

  it('refuses to include a salary owned by another active period, and does not consume the failed operationId', async () => {
    const base = await createBaseFixture();
    const septemberSalary = await createSalary(base.accountId, 10_000, SEP_SALARY_DATE);
    const octoberSalary = await createSalary(base.accountId, 8_000, OCT_SALARY_DATE);

    const septemberPeriod = await previewAndConfirm('2026-09', [septemberSalary.id]);
    const octoberPeriod = await previewAndConfirm('2026-10', [octoberSalary.id]);

    // Moving the October salary into September leaves it owned by the October
    // period. It now *looks* selectable for the September group in a plain
    // "does the date match" sense — which is exactly the trap this test pins.
    const moved = await call('PATCH', `${API}/salaries/${octoberSalary.id}`, {
      date: SEP_MOVED_SALARY_DATE,
    });
    expect(moved.statusCode, moved.body).toBe(200);

    const septemberSources = await salarySources('2026-09');
    const movedSource = septemberSources.items.find(
      (item) => item.salaryId === octoberSalary.id,
    );
    expect(movedSource).toBeDefined();
    expect(movedSource).toMatchObject({
      includedPeriodId: octoberPeriod.period.id,
      selectable: false,
      reason: 'already-included',
    });
    const septemberSalarySource = septemberSources.items.find(
      (item) => item.salaryId === septemberSalary.id,
    );
    expect(septemberSalarySource).toMatchObject({
      includedPeriodId: septemberPeriod.period.id,
      selectable: false,
      reason: 'already-included',
    });

    const config = await getConfig();
    const mapping = await getMapping();
    const beforeCounts = planningCounts();
    const beforeMoney = moneySnapshot();
    const beforeChanges = totalChanges();
    const failedOperationId = requestId();

    // Only the explicit existing-period path is exercised here. The
    // null-proposal/"collision with an existing cycle" path is a documented
    // defect pinned separately at the bottom of this file.
    const reconcileProposal: FinancialPeriodProposal = {
      periodId: septemberPeriod.period.id,
      expectedRevision: septemberPeriod.period.revision,
      expectedConfigRevision: config.config.revision,
      expectedMappingRevision: mapping.mapping.revision,
      selectedSources: [
        {
          salaryId: septemberSalary.id,
          expectedSourceToken: septemberSalarySource!.sourceToken,
        },
        {
          salaryId: movedSource!.salaryId,
          expectedSourceToken: movedSource!.sourceToken,
        },
      ],
      mappingPolicy: 'preserve',
      reason: 'income-reconciliation',
    };

    // The read-only preview must already refuse the cross-period ownership.
    const previewConflict = await call('POST', `${BASE}/periods/preview`, {
      proposal: reconcileProposal,
    });
    expectError(previewConflict, 409, 'FINANCIAL_SOURCE_ALREADY_INCLUDED');

    // So must the write path, without consuming the operation key.
    const reconcileConflict = await call(
      'POST',
      `${BASE}/periods/${septemberPeriod.period.id}/reconcile`,
      {
        operationId: failedOperationId,
        proposal: reconcileProposal,
        previewToken: 'unused-because-the-proposal-is-rejected',
      },
    );
    expectError(reconcileConflict, 409, 'FINANCIAL_SOURCE_ALREADY_INCLUDED');

    // Failed validation leaves no write and does not consume the operation key.
    expect(totalChanges()).toBe(beforeChanges);
    expect(planningCounts()).toEqual(beforeCounts);
    expect(moneySnapshot()).toEqual(beforeMoney);
    const consumedOperation = await call('GET', `${BASE}/operations/${failedOperationId}`);
    expectError(consumedOperation, 404, 'NOT_FOUND');

    // The database partial unique index is the final backstop even if a future
    // code path forgot the application-level ownership check.
    let uniqueError: unknown;
    try {
      db.prepare(
        `INSERT INTO financial_period_sources
           (period_id, salary_id, revision, active, snapshot_json, created_at, updated_at)
         VALUES (?, ?, ?, 1, '{}', ?, ?)`,
      ).run(
        septemberPeriod.period.id,
        octoberSalary.id,
        septemberPeriod.period.revision,
        NOW,
        NOW,
      );
    } catch (error) {
      uniqueError = error;
    }
    expect(uniqueError).toBeInstanceOf(Error);
    expect((uniqueError as { code?: string }).code).toBe('SQLITE_CONSTRAINT_UNIQUE');
    expect(planningCounts()).toEqual(beforeCounts);

    // Both original periods remain exactly as confirmed.
    const periodList = await getJson<PeriodListResponse>(`${BASE}/periods`);
    expect(periodList.total).toBe(2);
    const reloadedSeptember = await getJson<{ period: FinancialPeriod }>(
      `${BASE}/periods/${septemberPeriod.period.id}`,
    );
    expect(reloadedSeptember.period.revision).toBe(1);
    expect(reloadedSeptember.period.sources.map((source) => source.salaryId)).toEqual([
      septemberSalary.id,
    ]);
    const reloadedOctober = await getJson<{ period: FinancialPeriod }>(
      `${BASE}/periods/${octoberPeriod.period.id}`,
    );
    expect(reloadedOctober.period.revision).toBe(1);
    expect(reloadedOctober.period.sources.map((source) => source.salaryId)).toEqual([
      octoberSalary.id,
    ]);
  });

  it('appends to an existing period while preserving prior sources and the frozen decision rules', async () => {
    const base = await createBaseFixture();
    const firstSalary = await createSalary(base.accountId, 10_000, SEP_SALARY_DATE);
    const secondSalary = await createSalary(
      base.accountId,
      5_000,
      SEP_SECOND_SALARY_DATE,
      '既有工资追加',
    );

    const firstPeriod = await previewAndConfirm('2026-09', [firstSalary.id]);
    expect(firstPeriod.period.revision).toBe(1);
    expect(firstPeriod.period.sources.map((source) => source.salaryId)).toEqual([firstSalary.id]);

    // A later configuration must only affect NEW periods. This existing period
    // keeps its revision-1 ratios, baseline and config revision.
    const changedConfig = await updateConfig({
      ratiosBps: { growth: 4000, reserve: 2000, essentials: 3000, joy: 1000 },
      essentialMonthlyCents: 6000,
      targetMonths: 7,
    });
    expect(changedConfig.config.revision).toBeGreaterThan(firstPeriod.period.decision.configRevision);

    const mapping = await getMapping();
    const secondSource = await sourceRef('2026-09', secondSalary.id);
    const appendProposal: FinancialPeriodProposal = {
      periodId: firstPeriod.period.id,
      expectedRevision: firstPeriod.period.revision,
      expectedConfigRevision: changedConfig.config.revision,
      expectedMappingRevision: mapping.mapping.revision,
      selectedSources: [secondSource],
      mappingPolicy: 'preserve',
      reason: 'salary-confirmation',
    };

    const beforeAppendCounts = planningCounts();
    const beforeAppendMoney = moneySnapshot();
    const beforeAppendBalances = await balances();

    const { preview } = await previewPeriod(appendProposal);
    expect(preview.previousRevision).toBe(1);
    expect(preview.proposal.periodId).toBe(firstPeriod.period.id);
    expect(preview.impact.addedSalaryIds).toEqual([secondSalary.id]);
    expect(preview.sources.map((source) => source.salaryId)).toEqual([
      firstSalary.id,
      secondSalary.id,
    ]);
    // The current config revision is NOT adopted by the existing period.
    expect(preview.decision.ratiosBps).toEqual(DEFAULT_RATIOS);
    expect(preview.decision.configRevision).toBe(firstPeriod.period.decision.configRevision);
    expect(preview.decision.essentialMonthlyCents).toBe(5000);
    expect(preview.decision.targetMonths).toBe(5);

    const appended = await confirmPeriod(appendProposal, preview.previewToken);

    expect(appended.period.id).toBe(firstPeriod.period.id);
    expect(appended.period.revision).toBe(2);
    expect(appended.period.sources.map((source) => source.salaryId)).toEqual([
      firstSalary.id,
      secondSalary.id,
    ]);
    expect(appended.period.sourceState).toBe('valid');
    expect(appended.period.confirmedIncomeCents).toBe(15_000);
    expect(appended.period.decision.ratiosBps).toEqual(DEFAULT_RATIOS);
    expect(appended.period.decision.configRevision).toBe(
      firstPeriod.period.decision.configRevision,
    );
    expect(appended.period.decision.targets).toEqual({
      growth: 3_750,
      reserve: 2_250,
      essentials: 7_500,
      joy: 1_500,
    });
    expect(appended.affectedPeriodIds).toEqual([firstPeriod.period.id]);

    // Only a revision and its ownership row are added; no money fact moves.
    const afterAppendCounts = planningCounts();
    expect(countDelta(beforeAppendCounts, afterAppendCounts, 'financial_periods')).toBe(0);
    expect(countDelta(beforeAppendCounts, afterAppendCounts, 'financial_period_revisions')).toBe(1);
    expect(countDelta(beforeAppendCounts, afterAppendCounts, 'financial_period_sources')).toBe(1);
    expect(countDelta(beforeAppendCounts, afterAppendCounts, 'financial_operations')).toBe(1);
    expect(moneySnapshot()).toEqual(beforeAppendMoney);
    expect(await balances()).toEqual(beforeAppendBalances);

    // The prior source stays active, and revision 1 remains immutable history.
    const revisions = await getJson<PeriodRevisionsResponse>(
      `${BASE}/periods/${firstPeriod.period.id}/revisions?limit=10&offset=0`,
    );
    expect(revisions.total).toBe(2);
    expect(revisions.items.map((item) => item.revision)).toEqual([2, 1]);
    expect(revisions.items[0]!.sources.map((source) => source.salaryId)).toEqual([
      firstSalary.id,
      secondSalary.id,
    ]);
    expect(revisions.items[1]!.sources.map((source) => source.salaryId)).toEqual([
      firstSalary.id,
    ]);
    expect(revisions.items[1]!.confirmedIncomeCents).toBe(10_000);
    expect(revisions.items[1]!.decision.targets).toEqual({
      growth: 2_500,
      reserve: 1_500,
      essentials: 5_000,
      joy: 1_000,
    });

    const historical = await getJson<{ period: FinancialPeriod }>(
      `${BASE}/periods/${firstPeriod.period.id}?revision=1`,
    );
    expect(historical.period).toEqual(revisions.items[1]);
  });
});

/**
 * DOCUMENTED DEFECT — not desired behaviour.
 *
 * `buildPreview` normalizes a `periodId: null` proposal to the existing period
 * when the proposed cycle key already exists, and returns
 * `PERIOD_ALREADY_EXISTS` plus a preview token hashed over the *normalized*
 * proposal and only the newly selected sources. Confirming that normalized
 * proposal rebuilds the preview with the existing period's valid sources
 * retained, so the source set (and therefore the preview token) differs and the
 * user gets `409 FINANCIAL_SOURCE_CHANGED` even though nothing changed.
 *
 * The client-approved path is to look up the existing period and send an
 * explicit `periodId`; that path is covered above. This test pins TODAY'S
 * server behaviour so the defect is visible and cannot be mistaken for a
 * supported flow. When the server starts returning a redeemable append
 * proposal/token (or a distinct error), update this test together with the
 * agreed contract.
 */
describe('documented defect: null-proposal collision with an existing cycle', () => {
  it('returns a normalized append preview whose token cannot be redeemed', async () => {
    const base = await createBaseFixture();
    const firstSalary = await createSalary(base.accountId, 10_000, SEP_SALARY_DATE);
    const extraSalary = await createSalary(
      base.accountId,
      5_000,
      SEP_SECOND_SALARY_DATE,
      '既有工资追加',
    );

    const period = await previewAndConfirm('2026-09', [firstSalary.id]);
    const extraSource = await sourceRef('2026-09', extraSalary.id);
    const config = await getConfig();
    const mapping = await getMapping();

    const previewResponse = await call('POST', `${BASE}/periods/preview`, {
      proposal: {
        periodId: null,
        expectedRevision: 0,
        expectedConfigRevision: config.config.revision,
        expectedMappingRevision: mapping.mapping.revision,
        selectedSources: [extraSource],
        mappingPolicy: 'preserve',
        reason: 'salary-confirmation',
      } satisfies FinancialPeriodProposal,
    });
    expect(previewResponse.statusCode, previewResponse.body).toBe(200);
    const { preview } = previewResponse.json() as PreviewResponse;

    // Current (defective) normalization: the preview claims to target the
    // existing period and warns about it, but its token only covers the extra
    // source, not the existing period's retained sources.
    expect(preview.proposal.periodId).toBe(period.period.id);
    expect(preview.proposal.expectedRevision).toBe(period.period.revision);
    expect(preview.warnings).toContain('PERIOD_ALREADY_EXISTS');
    expect(preview.sources.map((source) => source.salaryId)).toEqual([extraSalary.id]);

    const beforeCounts = planningCounts();
    const beforeMoney = moneySnapshot();
    const failedOperationId = requestId();
    const confirmResponse = await call('POST', `${BASE}/periods/confirm`, {
      operationId: failedOperationId,
      proposal: preview.proposal,
      previewToken: preview.previewToken,
    });

    // Defect: the token cannot be redeemed because the confirm-time source set
    // is `[existing, extra]`, while the preview token was hashed over `[extra]`.
    expectError(confirmResponse, 409, 'FINANCIAL_SOURCE_CHANGED');
    expect(planningCounts()).toEqual(beforeCounts);
    expect(moneySnapshot()).toEqual(beforeMoney);
    expectError(
      await call('GET', `${BASE}/operations/${failedOperationId}`),
      404,
      'NOT_FOUND',
    );
  });
});
