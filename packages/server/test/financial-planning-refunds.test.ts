/**
 * Phase 1 — financial execution refunds / execution integration regression.
 *
 * Ownership: this file is independent from `financial-planning.test.ts` (backend
 * core contract tests). It only drives the public HTTP API with a real
 * `AuthService` + `app.inject()` and a database created by the current migration
 * set (019 included). No service calls, no real port, no AI, no production data.
 *
 * The arithmetic asserted below is the literal acceptance-fixture arithmetic
 * (100.00 salary -> 25.00/15.00/50.00/10.00, three-digit cent amounts); the
 * production rules stay in `@jizhang/shared` and are not re-implemented here.
 */
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  FinancialCycle,
  FinancialRefundSplit,
  SpendingPurpose,
} from '@jizhang/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { closeDatabase, initializeDatabase, type Db } from '../src/db/index.js';
import { SESSION_COOKIE } from '../src/plugins/auth.js';
import { AuthService } from '../src/services/auth-service.js';
import type {
  FinancialConfig,
  FinancialExecution,
  FinancialMeta,
  FinancialPeriod,
  FinancialPeriodProposal,
  FinancialPreview,
  FinancialRefundReview,
  FinancialSalarySource,
} from '../src/services/financial-planning-service.js';
import type { SalaryDetailDto } from '../src/services/salary-service.js';
import type { TransactionDto } from '../src/services/transaction-service.js';

const USERNAME = 'quiz';
const PASSWORD = 'correct horse battery staple';
const CSRF = { 'x-requested-with': 'fetch' } as const;

const NOW = Date.UTC(2026, 9, 27, 4, 0, 0); // 2026-10-27 12:00 in Asia/Shanghai
const TIME_ZONE = 'Asia/Shanghai';
const BASE = '/api/v1/financial-planning';
const API = '/api/v1';

const SEP_SALARY_DATE = Date.UTC(2026, 8, 10, 4, 0, 0); // 2026-09-10 12:00 local
const OCT_SALARY_DATE = Date.UTC(2026, 9, 10, 4, 0, 0); // 2026-10-10 12:00 local
const SEP_EXPENSE_DATE = Date.UTC(2026, 8, 20, 4, 0, 0); // 2026-09-20 12:00 local
const OCT_EXPENSE_DATE = Date.UTC(2026, 9, 20, 4, 0, 0); // 2026-10-20 12:00 local

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

type PeriodResponse = FinancialMeta & {
  period: FinancialPeriod;
  affectedPeriodIds: string[];
};

type PreviewResponse = FinancialMeta & { preview: FinancialPreview };

type RefundResponse = FinancialMeta & { refund: FinancialRefundReview };

type RefundListResponse = FinancialMeta & {
  items: FinancialRefundReview[];
  total: number;
  limit: number;
  offset: number;
};

type SplitResponse = FinancialMeta & {
  refund: FinancialRefundReview;
  affectedPeriodIds: string[];
};

type ExecutionResponse = FinancialMeta & {
  state: 'ready' | 'no-period';
  execution: FinancialExecution | null;
};

type ExecutionFactsResponse = FinancialMeta & {
  periodId: string;
  revision: number;
  items: {
    kind: 'expense' | 'refund-split' | 'pending-refund';
    transactionId: string;
    originalTransactionId: string | null;
    amountCents: number;
    purpose: SpendingPurpose | null;
    status: 'counted' | 'unresolved' | 'excluded';
    splitRevision: number | null;
  }[];
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

interface BaseFixture {
  readonly accountId: string;
  readonly essentialsCategoryId: string;
  readonly joyCategoryId: string;
  readonly incomeCategoryId: string;
  readonly configRevision: number;
  readonly mappingRevision: number;
}

interface PlanFixture {
  readonly base: BaseFixture;
  readonly salary: SalaryDetailDto;
  readonly period: FinancialPeriod;
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

async function createCategory(
  name: string,
  type: 0 | 1,
  parentId?: string,
): Promise<string> {
  const response = await call('POST', `${API}/categories`, {
    name,
    type,
    ...(parentId === undefined ? {} : { parentId }),
  });
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
  const accountId = await createAccount('退款测试账户');
  const essentialsCategoryId = await createCategory('退款测试必要', 0);
  const joyCategoryId = await createCategory('退款测试享受', 0);
  const incomeCategoryId = await createCategory('退款测试收入', 1);

  const before = await getConfig();
  const configResponse = await call('PUT', `${BASE}/config`, {
    operationId: requestId(),
    expectedRevision: before.config.revision,
    enabled: true,
    ratiosBps: { growth: 2500, reserve: 1500, essentials: 5000, joy: 1000 },
    essentialMonthlyCents: 5000,
    targetMonths: 5,
    cycle: { kind: 'natural-month' },
    timeZone: TIME_ZONE,
  });
  expect(configResponse.statusCode, configResponse.body).toBe(200);
  const config = configResponse.json() as FinancialMeta & { config: FinancialConfig };

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
): Promise<SalaryDetailDto> {
  const { config } = await getJson<{ config: { revision: number } }>('/api/v1/financial-funds/config');
  const response = await call('POST', `${API}/salaries`, {
    contractVersion: 1,
    expectedFundConfigRevision: config.revision,
    operationId: requestId(),
    amountCents,
    date,
    accountId,
    note: '退款测试工资',
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as SalaryDetailDto;
}

async function salarySources(groupMonth: string): Promise<SourceListResponse> {
  return getJson<SourceListResponse>(
    `${BASE}/sources/salaries?groupMonth=${encodeURIComponent(groupMonth)}&timeZone=${encodeURIComponent(TIME_ZONE)}`,
  );
}

async function previewAndConfirm(
  _base: BaseFixture,
  salaryIds: readonly string[],
  groupMonth: string,
): Promise<PeriodResponse> {
  const sources = await salarySources(groupMonth);
  const selected = salaryIds.map((salaryId) => {
    const found = sources.items.find((item) => item.salaryId === salaryId);
    if (found === undefined) throw new Error(`salary source not returned: ${salaryId}`);
    return { salaryId: found.salaryId, expectedSourceToken: found.sourceToken };
  });
  const config = await getConfig();
  const mapping = await getMapping();
  const proposal: FinancialPeriodProposal = {
    periodId: null,
    expectedRevision: 0,
    expectedConfigRevision: config.config.revision,
    expectedMappingRevision: mapping.mapping.revision,
    selectedSources: selected,
    mappingPolicy: 'preserve',
    reason: 'salary-confirmation',
  };

  const previewResponse = await call('POST', `${BASE}/periods/preview`, { proposal });
  expect(previewResponse.statusCode, previewResponse.body).toBe(200);
  const { preview } = previewResponse.json() as PreviewResponse;

  const confirmResponse = await call('POST', `${BASE}/periods/confirm`, {
    operationId: requestId(),
    proposal,
    previewToken: preview.previewToken,
  });
  expect(confirmResponse.statusCode, confirmResponse.body).toBe(200);
  return confirmResponse.json() as PeriodResponse;
}

async function setupPlan(
  salaryCents = 10_000,
  salaryDate = SEP_SALARY_DATE,
  groupMonth = '2026-09',
): Promise<PlanFixture> {
  const base = await createBaseFixture();
  const salary = await createSalary(base.accountId, salaryCents, salaryDate);
  const periodResponse = await previewAndConfirm(base, [salary.id], groupMonth);
  return { base, salary, period: periodResponse.period };
}

async function createExpense(input: {
  accountId: string;
  categoryId: string;
  amountCents: number;
  date?: number;
  financialPurpose?: SpendingPurpose;
}): Promise<TransactionDto> {
  const response = await call('POST', `${API}/transactions`, {
    type: 0,
    amountCents: input.amountCents,
    categoryId: input.categoryId,
    accountId: input.accountId,
    date: input.date ?? SEP_EXPENSE_DATE,
    note: '退款测试支出',
    ...(input.financialPurpose === undefined
      ? {}
      : { financialPurpose: input.financialPurpose }),
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as TransactionDto;
}

async function createRefund(input: {
  accountId: string;
  categoryId: string;
  amountCents: number;
  date?: number;
  linkedOriginalIds?: readonly string[];
}): Promise<TransactionDto> {
  const response = await call('POST', `${API}/transactions`, {
    type: 1,
    amountCents: input.amountCents,
    categoryId: input.categoryId,
    accountId: input.accountId,
    date: input.date ?? Date.UTC(2026, 8, 21, 4, 0, 0),
    note: '退款测试退款',
    isRefund: true,
    ...(input.linkedOriginalIds === undefined || input.linkedOriginalIds.length === 0
      ? {}
      : { refundLinkedTxIds: [...input.linkedOriginalIds] }),
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as TransactionDto;
}

async function refundReview(refundId: string): Promise<FinancialRefundReview> {
  const body = await getJson<RefundResponse>(`${BASE}/refunds/${refundId}`);
  return body.refund;
}

async function putSplits(
  refundId: string,
  splits: readonly FinancialRefundSplit[],
  options: {
    review?: FinancialRefundReview;
    operationId?: string;
    expectedRevision?: number;
    expectedRefundToken?: string;
    originals?: readonly { transactionId: string; expectedTransactionToken: string }[];
  } = {},
) {
  const review = options.review ?? (await refundReview(refundId));
  const originalIds = [...new Set(splits.map((split) => split.originalTransactionId))];
  const originals =
    options.originals ??
    originalIds.map((transactionId) => {
      const original = review.originals.find((entry) => entry.transactionId === transactionId);
      if (original === undefined) throw new Error(`original not in refund review: ${transactionId}`);
      return {
        transactionId,
        expectedTransactionToken: original.transactionToken,
      };
    });
  return call('PUT', `${BASE}/refunds/${refundId}/splits`, {
    operationId: options.operationId ?? requestId(),
    expectedRevision: options.expectedRevision ?? review.revision,
    expectedRefundToken: options.expectedRefundToken ?? review.refundToken,
    originals,
    splits,
  });
}

async function executionFor(periodId: string): Promise<FinancialExecution> {
  const body = await getJson<ExecutionResponse>(`${BASE}/periods/${periodId}/execution`);
  expect(body.state).toBe('ready');
  if (body.execution === null) throw new Error('execution is null');
  return body.execution;
}

async function homeExecution(): Promise<ExecutionResponse> {
  return getJson<ExecutionResponse>(`${BASE}/execution`);
}

function spending(execution: FinancialExecution, purpose: SpendingPurpose) {
  const found = execution.spending.find((entry) => entry.purpose === purpose);
  if (found === undefined) throw new Error(`missing spending entry: ${purpose}`);
  return found;
}

// Build a consistent legacy/corrupt fixture where the confirmed audit agrees with
// the edited rows, so cross-refund caps are tested separately from audit mismatch.
function alignConfirmedSplitSnapshot(refundId: string): void {
  const rows = db.prepare('SELECT original_tx_id, amount_cents FROM financial_refund_splits WHERE refund_tx_id = ?').all(refundId) as { original_tx_id: string; amount_cents: number }[];
  const snapshots = rows.sort((a, b) => a.original_tx_id.localeCompare(b.original_tx_id))
    .map((row) => ({ originalTransactionId: row.original_tx_id, amountCents: row.amount_cents }));
  db.prepare('UPDATE financial_refund_split_sets SET splits_json = ? WHERE refund_tx_id = ? AND revision = (SELECT MAX(revision) FROM financial_refund_split_sets WHERE refund_tx_id = ?)')
    .run(JSON.stringify(snapshots), refundId, refundId);
}

async function ledgerSnapshot(ids: readonly string[]): Promise<unknown[]> {
  const body = await getJson<{ items: TransactionDto[] }>(
    `${API}/transactions?limit=500`,
  );
  return body.items
    .filter((item) => ids.includes(item.id))
    .map((item) => ({
      id: item.id,
      type: item.type,
      amountCents: item.amountCents,
      categoryId: item.categoryId,
      accountId: item.accountId,
      date: item.date,
      isRefund: item.isRefund,
      financialPurpose: item.financialPurpose,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
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

describe('financial planning refund queue and review', () => {
  it('queues an unlinked live refund as unconfirmed and never credits it to the period', async () => {
    const plan = await setupPlan();
    const expense = await createExpense({
      accountId: plan.base.accountId,
      categoryId: plan.base.essentialsCategoryId,
      amountCents: 10_000,
    });
    const refund = await createRefund({
      accountId: plan.base.accountId,
      categoryId: plan.base.incomeCategoryId,
      amountCents: 3_000,
    });

    const queue = await getJson<RefundListResponse>(`${BASE}/refunds`);
    expect(queue.total).toBe(1);
    const review = queue.items[0]!;
    expect(review).toMatchObject({
      refundTransactionId: refund.id,
      amountCents: 3_000,
      state: 'unconfirmed',
      splits: [],
      validAttributedCents: 0,
      unresolvedCents: 3_000,
      originals: [],
      suggestedSplits: null,
      legacyOriginalIds: [],
    });
    expect(review.reasons).toContain('no-splits');

    const filtered = await getJson<RefundListResponse>(
      `${BASE}/refunds?state=review-required`,
    );
    expect(filtered.items.map((item) => item.refundTransactionId)).toEqual([refund.id]);

    const execution = await executionFor(plan.period.id);
    expect(spending(execution, 'essentials')).toMatchObject({
      targetCents: 5_000,
      grossCents: 10_000,
      attributedRefundCents: 0,
      netCents: 10_000,
      remainingCents: -5_000,
      overspendCents: 5_000,
      state: 'provisional',
    });
    expect(execution.coverage).toBe('provisional');
    expect(execution.unresolved).toMatchObject({
      globalUnassignedRefundCount: 1,
      globalUnassignedRefundCents: 3_000,
      linkedRefundCount: 0,
      linkedRefundUnresolvedCents: 0,
    });
    // The expense itself is still classified and counted; the unlinked refund is
    // only visible in the global queue.
    expect(expense.id).toBeTruthy();
  });

  it('offers a legacy single-original suggestion but does not auto-credit it', async () => {
    const plan = await setupPlan();
    const expense = await createExpense({
      accountId: plan.base.accountId,
      categoryId: plan.base.essentialsCategoryId,
      amountCents: 10_000,
    });
    const refund = await createRefund({
      accountId: plan.base.accountId,
      categoryId: plan.base.incomeCategoryId,
      amountCents: 3_000,
      linkedOriginalIds: [expense.id],
    });

    const review = await refundReview(refund.id);
    expect(review).toMatchObject({
      state: 'review-required',
      validAttributedCents: 0,
      unresolvedCents: 3_000,
      legacyOriginalIds: [expense.id],
      suggestedSplits: [{ originalTransactionId: expense.id, amountCents: 3_000 }],
    });
    expect(review.originals).toHaveLength(1);
    expect(review.originals[0]).toMatchObject({
      transactionId: expense.id,
      amountCents: 10_000,
      otherConfirmedRefundCents: 0,
      remainingRefundableCents: 10_000,
      state: 'live',
    });

    const execution = await executionFor(plan.period.id);
    expect(spending(execution, 'essentials')).toMatchObject({
      grossCents: 10_000,
      attributedRefundCents: 0,
      netCents: 10_000,
      state: 'provisional',
    });
    expect(execution.unresolved).toMatchObject({
      linkedRefundCount: 1,
      linkedRefundUnresolvedCents: 3_000,
    });
  });

  it('paginates the queue date DESC and id ASC', async () => {
    await setupPlan();
    const base = await createBaseFixture();
    const refunds = [];
    for (const date of [
      Date.UTC(2026, 8, 21, 4),
      Date.UTC(2026, 8, 22, 4),
      Date.UTC(2026, 8, 23, 4),
    ]) {
      refunds.push(
        await createRefund({
          accountId: base.accountId,
          categoryId: base.incomeCategoryId,
          amountCents: 1_000,
          date,
        }),
      );
    }

    const first = await getJson<RefundListResponse>(`${BASE}/refunds?limit=2`);
    expect(first.total).toBe(3);
    expect(first.limit).toBe(2);
    expect(first.offset).toBe(0);
    expect(first.items.map((item) => item.refundTransactionId)).toEqual([
      refunds[2]!.id,
      refunds[1]!.id,
    ]);

    const second = await getJson<RefundListResponse>(`${BASE}/refunds?limit=2&offset=2`);
    expect(second.items.map((item) => item.refundTransactionId)).toEqual([refunds[0]!.id]);
  });
});

describe('financial planning refund splits', () => {
  it('keeps cash flow, gross envelope spending and confirmed net execution distinct', async () => {
    const plan = await setupPlan(100_000);
    // Historical envelope evidence is seeded explicitly: fresh salary writes no
    // longer create module allocations, but this regression still tests old reads.
    const historicalCategory = db.prepare('SELECT id FROM categories WHERE type = 0 AND deleted = 0 AND id <> ? LIMIT 1')
      .get(plan.base.essentialsCategoryId) as { id: string };
    db.prepare('INSERT INTO budget_allocations (id,salary_record_id,date,allocations_json,deleted,updated_at) VALUES (?,?,?,?,0,?)')
      .run(requestId(), plan.salary.id, plan.salary.date, JSON.stringify([{ categoryId: historicalCategory.id, amountCents: 100_000 }]), NOW);
    const expense = await createExpense({
      accountId: plan.base.accountId,
      categoryId: plan.base.essentialsCategoryId,
      amountCents: 10_000,
      date: SEP_EXPENSE_DATE,
    });
    const refund = await createRefund({
      accountId: plan.base.accountId,
      categoryId: plan.base.incomeCategoryId,
      amountCents: 3_000,
      date: SEP_EXPENSE_DATE,
      linkedOriginalIds: [expense.id],
    });
    const beforeSplit = await ledgerSnapshot([expense.id, refund.id]);
    const confirmed = await putSplits(refund.id, [
      { originalTransactionId: expense.id, amountCents: 3_000 },
    ]);
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect((confirmed.json() as SplitResponse).refund.state).toBe('confirmed');
    expect(await ledgerSnapshot([expense.id, refund.id])).toEqual(beforeSplit);

    const balances = await getJson<{ items: Array<{
      accountId: string; initialBalanceCents: number; incomeCents: number;
      expenseCents: number; salaryCents: number; balanceCents: number;
    }> }>(`${API}/accounts/balances`);
    expect(balances.items.find((item) => item.accountId === plan.base.accountId)).toMatchObject({
      initialBalanceCents: 0,
      incomeCents: 3_000,
      expenseCents: 10_000,
      salaryCents: 100_000,
      balanceCents: 93_000,
    });

    const query = new URLSearchParams({
      from: String(SEP_EXPENSE_DATE - 60_000),
      to: String(SEP_EXPENSE_DATE + 60_000),
      timeZone: TIME_ZONE,
      accountId: plan.base.accountId,
    });
    const daily = await getJson<{ items: Array<{
      day: string; incomeCents: number; expenseCents: number; count: number;
    }> }>(`${API}/transactions/daily-summary?${query}`);
    expect(daily.items).toEqual([
      { day: '2026-09-20', incomeCents: 3_000, expenseCents: 10_000, count: 2 },
    ]);

    const trend = await getJson<{ items: Array<{
      month: string; incomeCents: number; netExpenseCents: number;
    }> }>(`${API}/stats/monthly-trend?months=2`);
    expect(trend.items.find((item) => item.month === '2026-09')).toMatchObject({
      incomeCents: 103_000,
      netExpenseCents: 10_000,
    });
    const overview = await getJson<{ modules: Array<{
      categoryId: string; budgetCents: number; spentCents: number;
    }> }>(`${API}/budget/overview`);
    expect(overview.modules.find((item) => item.categoryId === plan.base.essentialsCategoryId))
      .toMatchObject({ budgetCents: 0, spentCents: 10_000 });

    const execution = await executionFor(plan.period.id);
    expect(spending(execution, 'essentials')).toMatchObject({
      grossCents: 10_000,
      attributedRefundCents: 3_000,
      netCents: 7_000,
      state: 'exact',
    });
  });

  it('confirms multi-purpose splits and keeps the legacy gross ledger unchanged', async () => {
    const plan = await setupPlan();
    const essentialsExpense = await createExpense({
      accountId: plan.base.accountId,
      categoryId: plan.base.essentialsCategoryId,
      amountCents: 4_000,
      date: SEP_EXPENSE_DATE,
    });
    const joyExpense = await createExpense({
      accountId: plan.base.accountId,
      categoryId: plan.base.joyCategoryId,
      amountCents: 1_000,
      date: SEP_EXPENSE_DATE,
    });
    const refund = await createRefund({
      accountId: plan.base.accountId,
      categoryId: plan.base.incomeCategoryId,
      amountCents: 2_000,
      linkedOriginalIds: [essentialsExpense.id, joyExpense.id],
    });
    const ledgerBefore = await ledgerSnapshot([
      essentialsExpense.id,
      joyExpense.id,
      refund.id,
    ]);

    const response = await putSplits(refund.id, [
      { originalTransactionId: essentialsExpense.id, amountCents: 1_500 },
      { originalTransactionId: joyExpense.id, amountCents: 500 },
    ]);
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json() as SplitResponse;
    expect(body.affectedPeriodIds).toEqual([plan.period.id]);
    expect(body.refund).toMatchObject({
      state: 'confirmed',
      revision: 1,
      validAttributedCents: 2_000,
      unresolvedCents: 0,
      splits: expect.arrayContaining([
        { originalTransactionId: essentialsExpense.id, amountCents: 1_500 },
        { originalTransactionId: joyExpense.id, amountCents: 500 },
      ]),
    });

    // Legacy gross expense/income and the old financialPurpose field are not
    // rewritten by the new net-execution domain.
    expect(await ledgerSnapshot([essentialsExpense.id, joyExpense.id, refund.id])).toEqual(
      ledgerBefore,
    );

    const execution = await executionFor(plan.period.id);
    expect(spending(execution, 'essentials')).toMatchObject({
      targetCents: 5_000,
      grossCents: 4_000,
      attributedRefundCents: 1_500,
      netCents: 2_500,
      remainingCents: 2_500,
      overspendCents: 0,
      state: 'exact',
    });
    expect(spending(execution, 'joy')).toMatchObject({
      targetCents: 1_000,
      grossCents: 1_000,
      attributedRefundCents: 500,
      netCents: 500,
      remainingCents: 500,
      overspendCents: 0,
      state: 'exact',
    });
    expect(execution.coverage).toBe('exact');

    const details = await getJson<ExecutionFactsResponse>(
      `${BASE}/periods/${plan.period.id}/details?purpose=essentials&kind=all&limit=100`,
    );
    expect(details.total).toBe(2);
    const expenseFact = details.items.find((item) => item.transactionId === essentialsExpense.id);
    expect(expenseFact).toMatchObject({
      kind: 'expense',
      amountCents: 4_000,
      purpose: 'essentials',
      status: 'counted',
      splitRevision: null,
    });
    const refundFact = details.items.find((item) => item.transactionId === refund.id);
    expect(refundFact).toMatchObject({
      kind: 'refund-split',
      originalTransactionId: essentialsExpense.id,
      amountCents: 1_500,
      purpose: 'essentials',
      status: 'counted',
      splitRevision: 1,
    });
  });

  it('enforces refund/original caps and exact original coverage without partial writes', async () => {
    const plan = await setupPlan();
    const expenseA = await createExpense({
      accountId: plan.base.accountId,
      categoryId: plan.base.essentialsCategoryId,
      amountCents: 10_000,
    });
    const expenseB = await createExpense({
      accountId: plan.base.accountId,
      categoryId: plan.base.joyCategoryId,
      amountCents: 6_000,
    });
    const refund = await createRefund({
      accountId: plan.base.accountId,
      categoryId: plan.base.incomeCategoryId,
      amountCents: 3_000,
      linkedOriginalIds: [expenseA.id, expenseB.id],
    });

    // A token captured before an amount edit must be rejected as SOURCE_CHANGED.
    const staleReview = await refundReview(refund.id);
    const staleB = staleReview.originals.find((entry) => entry.transactionId === expenseB.id)!;
    const edit = await call('PATCH', `${API}/transactions/${expenseB.id}`, {
      amountCents: 5_500,
    });
    expect(edit.statusCode, edit.body).toBe(200);
    const stale = await putSplits(
      refund.id,
      [
        { originalTransactionId: expenseA.id, amountCents: 1_000 },
        { originalTransactionId: expenseB.id, amountCents: 500 },
      ],
      {
        originals: [
          {
            transactionId: expenseA.id,
            expectedTransactionToken: staleReview.originals.find(
              (entry) => entry.transactionId === expenseA.id,
            )!.transactionToken,
          },
          { transactionId: expenseB.id, expectedTransactionToken: staleB.transactionToken },
        ],
      },
    );
    expectError(stale, 409, 'FINANCIAL_SOURCE_CHANGED');

    const confirmed = await putSplits(refund.id, [
      { originalTransactionId: expenseA.id, amountCents: 1_000 },
      { originalTransactionId: expenseB.id, amountCents: 500 },
    ]);
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect((confirmed.json() as SplitResponse).refund.revision).toBe(1);

    // Split total exceeds the refund itself.
    const overRefund = await putSplits(refund.id, [
      { originalTransactionId: expenseA.id, amountCents: 2_000 },
      { originalTransactionId: expenseB.id, amountCents: 1_500 },
    ]);
    expectError(overRefund, 409, 'FINANCIAL_REFUND_CONFLICT');

    // `originals` must exactly cover the split set, not a superset.
    const incomplete = await putSplits(refund.id, [
      { originalTransactionId: expenseA.id, amountCents: 500 },
    ], {
      originals: (await refundReview(refund.id)).originals.map((entry) => ({
        transactionId: entry.transactionId,
        expectedTransactionToken: entry.transactionToken,
      })),
    });
    expectError(incomplete, 409, 'FINANCIAL_REFUND_CONFLICT');

    // One original's remaining refundable amount is already consumed by another
    // confirmed refund; a split cannot exceed that residual.
    const secondRefund = await createRefund({
      accountId: plan.base.accountId,
      categoryId: plan.base.incomeCategoryId,
      amountCents: 9_500,
      linkedOriginalIds: [expenseA.id],
    });
    const secondReview = await refundReview(secondRefund.id);
    expect(secondReview.originals[0]).toMatchObject({
      transactionId: expenseA.id,
      otherConfirmedRefundCents: 1_000,
      remainingRefundableCents: 9_000,
    });
    const overOriginal = await putSplits(secondRefund.id, [
      { originalTransactionId: expenseA.id, amountCents: 9_500 },
    ]);
    expectError(overOriginal, 409, 'FINANCIAL_REFUND_CONFLICT');

    // A failed validation must not consume the operation id: correcting the same
    // request under the same key is allowed.
    const retryId = requestId();
    const failed = await putSplits(
      refund.id,
      [
        { originalTransactionId: expenseA.id, amountCents: 2_000 },
        { originalTransactionId: expenseB.id, amountCents: 1_500 },
      ],
      { operationId: retryId },
    );
    expectError(failed, 409, 'FINANCIAL_REFUND_CONFLICT');
    const retried = await putSplits(
      refund.id,
      [
        { originalTransactionId: expenseA.id, amountCents: 1_000 },
        { originalTransactionId: expenseB.id, amountCents: 500 },
      ],
      { operationId: retryId },
    );
    expect(retried.statusCode, retried.body).toBe(200);
    expect((retried.json() as SplitResponse).refund.revision).toBe(2);

    const finalReview = await refundReview(refund.id);
    expect(finalReview).toMatchObject({
      state: 'review-required',
      revision: 2,
      validAttributedCents: 1_500,
      unresolvedCents: 1_500,
    });
  });

  it('replays an identical split write, rejects key reuse with a changed payload, and exposes the operation', async () => {
    const plan = await setupPlan();
    const expense = await createExpense({
      accountId: plan.base.accountId,
      categoryId: plan.base.essentialsCategoryId,
      amountCents: 10_000,
    });
    const refund = await createRefund({
      accountId: plan.base.accountId,
      categoryId: plan.base.incomeCategoryId,
      amountCents: 3_000,
      linkedOriginalIds: [expense.id],
    });
    const review = await refundReview(refund.id);
    const operationId = requestId();
    const body = {
      operationId,
      expectedRevision: review.revision,
      expectedRefundToken: review.refundToken,
      originals: [
        { transactionId: expense.id, expectedTransactionToken: review.originals[0]!.transactionToken },
      ],
      splits: [{ originalTransactionId: expense.id, amountCents: 3_000 }],
    };

    const first = await call('PUT', `${BASE}/refunds/${refund.id}/splits`, body);
    expect(first.statusCode, first.body).toBe(200);
    const firstBody = first.json() as SplitResponse;

    const replay = await call('PUT', `${BASE}/refunds/${refund.id}/splits`, body);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()).toEqual(firstBody);
    expect((await refundReview(refund.id)).revision).toBe(1);

    const changed = await call('PUT', `${BASE}/refunds/${refund.id}/splits`, {
      ...body,
      splits: [{ originalTransactionId: expense.id, amountCents: 2_000 }],
    });
    expectError(changed, 409, 'FINANCIAL_OPERATION_MISMATCH');

    const operation = await getJson<OperationResponse>(`${BASE}/operations/${operationId}`);
    expect(operation.operation).toMatchObject({
      operationId,
      method: 'PUT',
      resource: `${BASE}/refunds/${refund.id}/splits`,
      statusCode: 200,
    });
    expect(
      (operation.operation.response as SplitResponse).refund.splits,
    ).toEqual([{ originalTransactionId: expense.id, amountCents: 3_000 }]);

    const staleRevision = await call('PUT', `${BASE}/refunds/${refund.id}/splits`, {
      ...body,
      operationId: requestId(),
      expectedRevision: 0,
    });
    expectError(staleRevision, 409, 'FINANCIAL_REVISION_CONFLICT');

    const unknown = await call('GET', `${BASE}/operations/${requestId()}`);
    expectError(unknown, 404, 'NOT_FOUND');
  });

  it('replays the original 200 response after the original/refund are deleted without appending a revision', async () => {
    const plan = await setupPlan();
    const expense = await createExpense({
      accountId: plan.base.accountId,
      categoryId: plan.base.essentialsCategoryId,
      amountCents: 10_000,
    });
    const refund = await createRefund({
      accountId: plan.base.accountId,
      categoryId: plan.base.incomeCategoryId,
      amountCents: 3_000,
      linkedOriginalIds: [expense.id],
    });
    const review = await refundReview(refund.id);
    const operationId = requestId();
    const body = {
      operationId,
      expectedRevision: 0,
      expectedRefundToken: review.refundToken,
      originals: [
        { transactionId: expense.id, expectedTransactionToken: review.originals[0]!.transactionToken },
      ],
      splits: [{ originalTransactionId: expense.id, amountCents: 3_000 }],
    };
    const first = await call('PUT', `${BASE}/refunds/${refund.id}/splits`, body);
    expect(first.statusCode, first.body).toBe(200);
    const firstBody = first.json() as SplitResponse;

    expect((await call('DELETE', `${API}/transactions/${expense.id}`)).statusCode).toBe(204);
    expect((await call('DELETE', `${API}/transactions/${refund.id}`)).statusCode).toBe(204);

    // Replay must be checked before mutable source validation: the stored answer
    // is still the authoritative 200 result of this operation id.
    const replay = await call('PUT', `${BASE}/refunds/${refund.id}/splits`, body);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()).toEqual(firstBody);

    const current = await refundReview(refund.id);
    expect(current.state).toBe('deleted');
    expect(current.revision).toBe(1); // no extra revision from the replay
  });

  it('keeps a partial split unresolved and clears it without reviving stale attribution', async () => {
    const plan = await setupPlan();
    const expense = await createExpense({
      accountId: plan.base.accountId,
      categoryId: plan.base.essentialsCategoryId,
      amountCents: 10_000,
    });
    const refund = await createRefund({
      accountId: plan.base.accountId,
      categoryId: plan.base.incomeCategoryId,
      amountCents: 3_000,
      linkedOriginalIds: [expense.id],
    });

    const partial = await putSplits(refund.id, [
      { originalTransactionId: expense.id, amountCents: 1_000 },
    ]);
    expect(partial.statusCode, partial.body).toBe(200);
    const partialBody = partial.json() as SplitResponse;
    expect(partialBody.refund).toMatchObject({
      revision: 1,
      state: 'review-required',
      validAttributedCents: 1_000,
      unresolvedCents: 2_000,
      splits: [{ originalTransactionId: expense.id, amountCents: 1_000 }],
    });
    expect(partialBody.refund.reasons).toContain('excess-unattributed');

    const partialExecution = await executionFor(plan.period.id);
    expect(spending(partialExecution, 'essentials')).toMatchObject({
      grossCents: 10_000,
      attributedRefundCents: 1_000,
      netCents: 9_000,
      remainingCents: -4_000,
      overspendCents: 4_000,
      state: 'provisional',
    });

    const cleared = await putSplits(refund.id, [], { expectedRevision: 1 });
    expect(cleared.statusCode, cleared.body).toBe(200);
    const clearedBody = cleared.json() as SplitResponse;
    expect(clearedBody.refund).toMatchObject({
      revision: 2,
      state: 'review-required',
      splits: [],
      validAttributedCents: 0,
      unresolvedCents: 3_000,
    });
    expect(clearedBody.refund.suggestedSplits).toEqual([
      { originalTransactionId: expense.id, amountCents: 3_000 },
    ]);

    const clearedExecution = await executionFor(plan.period.id);
    expect(spending(clearedExecution, 'essentials')).toMatchObject({
      grossCents: 10_000,
      attributedRefundCents: 0,
      netCents: 10_000,
      state: 'provisional',
    });
  });

  it('rejects malformed split request DTOs with the frozen error vocabulary', async () => {
    const base = await createBaseFixture();
    const refund = await createRefund({
      accountId: base.accountId,
      categoryId: base.incomeCategoryId,
      amountCents: 1_000,
    });

    const missingOperation = await call('PUT', `${BASE}/refunds/${refund.id}/splits`, {
      expectedRevision: 0,
      expectedRefundToken: 'x',
      originals: [],
      splits: [],
    });
    expectError(missingOperation, 400, 'FINANCIAL_INVALID');

    const badOperation = await call('PUT', `${BASE}/refunds/${refund.id}/splits`, {
      operationId: 'not-a-uuid',
      expectedRevision: 0,
      expectedRefundToken: 'x',
      originals: [],
      splits: [],
    });
    expectError(badOperation, 400, 'FINANCIAL_INVALID');

    const badRevision = await call('PUT', `${BASE}/refunds/${refund.id}/splits`, {
      operationId: requestId(),
      expectedRevision: -1,
      expectedRefundToken: 'x',
      originals: [],
      splits: [],
    });
    expectError(badRevision, 400, 'FINANCIAL_INVALID');

    const unknownRefund = await call('GET', `${BASE}/refunds/${requestId()}`);
    expectError(unknownRefund, 404, 'NOT_FOUND');
  });
});

describe('financial planning refund lifecycle', () => {
  it('invalidates the whole set when one original amount or type changes', async () => {
    const plan = await setupPlan();
    const expenseA = await createExpense({
      accountId: plan.base.accountId,
      categoryId: plan.base.essentialsCategoryId,
      amountCents: 4_000,
    });
    const expenseB = await createExpense({
      accountId: plan.base.accountId,
      categoryId: plan.base.joyCategoryId,
      amountCents: 1_000,
    });
    const refund = await createRefund({
      accountId: plan.base.accountId,
      categoryId: plan.base.incomeCategoryId,
      amountCents: 2_000,
      linkedOriginalIds: [expenseA.id, expenseB.id],
    });
    const confirmed = await putSplits(refund.id, [
      { originalTransactionId: expenseA.id, amountCents: 1_500 },
      { originalTransactionId: expenseB.id, amountCents: 500 },
    ]);
    expect(confirmed.statusCode, confirmed.body).toBe(200);

    // A is still large enough for its own 15.00 split, but its amount changed:
    // the whole set (including B's untouched row) must stop counting.
    const amountEdit = await call('PATCH', `${API}/transactions/${expenseA.id}`, {
      amountCents: 3_500,
    });
    expect(amountEdit.statusCode, amountEdit.body).toBe(200);
    const afterAmount = await refundReview(refund.id);
    expect(afterAmount).toMatchObject({
      state: 'review-required',
      revision: 1,
      splits: [],
      validAttributedCents: 0,
      unresolvedCents: 2_000,
    });
    expect(afterAmount.reasons).toContain('original-changed');

    const afterAmountExecution = await executionFor(plan.period.id);
    expect(spending(afterAmountExecution, 'essentials')).toMatchObject({
      grossCents: 3_500,
      attributedRefundCents: 0,
      netCents: 3_500,
      state: 'provisional',
    });
    expect(spending(afterAmountExecution, 'joy')).toMatchObject({
      grossCents: 1_000,
      attributedRefundCents: 0,
      netCents: 1_000,
    });

    // Fresh confirmation after the amount change, then a type change on A.
    const reconfirm = await putSplits(refund.id, [
      { originalTransactionId: expenseA.id, amountCents: 1_500 },
      { originalTransactionId: expenseB.id, amountCents: 500 },
    ]);
    expect(reconfirm.statusCode, reconfirm.body).toBe(200);
    expect((reconfirm.json() as SplitResponse).refund.revision).toBe(2);

    const typeEdit = await call('PATCH', `${API}/transactions/${expenseA.id}`, {
      type: 1,
      categoryId: plan.base.incomeCategoryId,
    });
    expect(typeEdit.statusCode, typeEdit.body).toBe(200);
    const afterType = await refundReview(refund.id);
    expect(afterType).toMatchObject({
      state: 'review-required',
      revision: 2,
      splits: [],
      validAttributedCents: 0,
      unresolvedCents: 2_000,
    });
    expect(afterType.originals.find((entry) => entry.transactionId === expenseA.id)?.state).toBe(
      'not-expense',
    );
    expect(afterType.reasons).toContain('original-not-expense');

    const afterTypeExecution = await executionFor(plan.period.id);
    expect(spending(afterTypeExecution, 'essentials').grossCents).toBe(0);
    expect(spending(afterTypeExecution, 'joy')).toMatchObject({
      grossCents: 1_000,
      attributedRefundCents: 0,
      netCents: 1_000,
    });
  });

  it('invalidates the whole set when the refund amount or refund flag changes', async () => {
    const plan = await setupPlan();
    const expense = await createExpense({
      accountId: plan.base.accountId,
      categoryId: plan.base.essentialsCategoryId,
      amountCents: 10_000,
    });
    const refund = await createRefund({
      accountId: plan.base.accountId,
      categoryId: plan.base.incomeCategoryId,
      amountCents: 3_000,
      linkedOriginalIds: [expense.id],
    });
    const confirmed = await putSplits(refund.id, [
      { originalTransactionId: expense.id, amountCents: 3_000 },
    ]);
    expect(confirmed.statusCode, confirmed.body).toBe(200);

    const amountEdit = await call('PATCH', `${API}/transactions/${refund.id}`, {
      amountCents: 4_000,
    });
    expect(amountEdit.statusCode, amountEdit.body).toBe(200);
    const afterAmount = await refundReview(refund.id);
    expect(afterAmount).toMatchObject({
      state: 'review-required',
      amountCents: 4_000,
      validAttributedCents: 0,
      unresolvedCents: 4_000,
      splits: [],
    });
    expect(afterAmount.reasons).toContain('refund-changed');

    // Reconfirm on the new refund amount, then flip isRefund: the whole set must
    // become non-refund and stop reducing the period.
    const reconfirm = await putSplits(refund.id, [
      { originalTransactionId: expense.id, amountCents: 3_000 },
    ]);
    expect(reconfirm.statusCode, reconfirm.body).toBe(200);
    expect((reconfirm.json() as SplitResponse).refund).toMatchObject({
      state: 'review-required',
      revision: 2,
      validAttributedCents: 3_000,
      unresolvedCents: 1_000,
    });

    const flagEdit = await call('PATCH', `${API}/transactions/${refund.id}`, {
      isRefund: false,
    });
    expect(flagEdit.statusCode, flagEdit.body).toBe(200);
    const afterFlag = await refundReview(refund.id);
    expect(afterFlag).toMatchObject({
      state: 'not-refund',
      validAttributedCents: 0,
      splits: [],
    });
    expect(afterFlag.originals[0]).toMatchObject({
      transactionId: expense.id,
      state: 'live',
    });
    const execution = await executionFor(plan.period.id);
    expect(spending(execution, 'essentials')).toMatchObject({
      grossCents: 10_000,
      attributedRefundCents: 0,
      netCents: 10_000,
      state: 'provisional',
    });
  });

  it('re-resolves category, date and bill-purpose override without double counting gross or refund', async () => {
    const plan = await setupPlan();
    const expense = await createExpense({
      accountId: plan.base.accountId,
      categoryId: plan.base.essentialsCategoryId,
      amountCents: 4_000,
    });
    const refund = await createRefund({
      accountId: plan.base.accountId,
      categoryId: plan.base.incomeCategoryId,
      amountCents: 1_000,
      linkedOriginalIds: [expense.id],
    });
    const confirmed = await putSplits(refund.id, [
      { originalTransactionId: expense.id, amountCents: 1_000 },
    ]);
    expect(confirmed.statusCode, confirmed.body).toBe(200);

    const moveCategory = await call('PATCH', `${API}/transactions/${expense.id}`, {
      categoryId: plan.base.joyCategoryId,
    });
    expect(moveCategory.statusCode, moveCategory.body).toBe(200);
    expect((await refundReview(refund.id)).state).toBe('confirmed');

    let execution = await executionFor(plan.period.id);
    expect(spending(execution, 'essentials')).toMatchObject({
      grossCents: 0,
      attributedRefundCents: 0,
      netCents: 0,
    });
    expect(spending(execution, 'joy')).toMatchObject({
      grossCents: 4_000,
      attributedRefundCents: 1_000,
      netCents: 3_000,
    });
    const totalGross =
      spending(execution, 'essentials').grossCents + spending(execution, 'joy').grossCents;
    const totalRefund =
      spending(execution, 'essentials').attributedRefundCents +
      spending(execution, 'joy').attributedRefundCents;
    expect([totalGross, totalRefund]).toEqual([4_000, 1_000]);

    // A date edit inside the frozen window keeps the split confirmed and does not
    // duplicate the expense.
    const moveDate = await call('PATCH', `${API}/transactions/${expense.id}`, {
      date: Date.UTC(2026, 8, 22, 4, 0, 0),
    });
    expect(moveDate.statusCode, moveDate.body).toBe(200);
    expect((await refundReview(refund.id)).state).toBe('confirmed');
    execution = await executionFor(plan.period.id);
    expect(spending(execution, 'joy').grossCents).toBe(4_000);
    expect(spending(execution, 'joy').attributedRefundCents).toBe(1_000);

    // Explicit purpose override wins over the current category and moves gross
    // and refund together, not twice.
    const purposeBefore = await getJson<{
      billPurpose: {
        transactionId: string;
        transactionToken: string;
        revision: number;
        financialPurpose: SpendingPurpose | null;
        periodId: string | null;
      };
    }>(`${BASE}/bill-purposes/${expense.id}`);
    expect(purposeBefore.billPurpose).toMatchObject({
      transactionId: expense.id,
      revision: 0,
      financialPurpose: null,
      periodId: plan.period.id,
    });
    const purposeEdit = await call('PUT', `${BASE}/bill-purposes/${expense.id}`, {
      operationId: requestId(),
      expectedRevision: purposeBefore.billPurpose.revision,
      expectedTransactionToken: purposeBefore.billPurpose.transactionToken,
      financialPurpose: 'essentials',
    });
    expect(purposeEdit.statusCode, purposeEdit.body).toBe(200);
    expect((await refundReview(refund.id)).state).toBe('confirmed');

    execution = await executionFor(plan.period.id);
    expect(spending(execution, 'essentials')).toMatchObject({
      grossCents: 4_000,
      attributedRefundCents: 1_000,
      netCents: 3_000,
    });
    expect(spending(execution, 'joy')).toMatchObject({
      grossCents: 0,
      attributedRefundCents: 0,
      netCents: 0,
    });
    expect(
      spending(execution, 'essentials').grossCents + spending(execution, 'joy').grossCents,
    ).toBe(4_000);
  });

  it('single soft delete -> restore does not reactivate -> purge leaves a readable tombstone', async () => {
    const plan = await setupPlan();
    const expense = await createExpense({
      accountId: plan.base.accountId,
      categoryId: plan.base.essentialsCategoryId,
      amountCents: 10_000,
    });
    const refund = await createRefund({
      accountId: plan.base.accountId,
      categoryId: plan.base.incomeCategoryId,
      amountCents: 3_000,
      linkedOriginalIds: [expense.id],
    });
    const confirmed = await putSplits(refund.id, [
      { originalTransactionId: expense.id, amountCents: 3_000 },
    ]);
    expect(confirmed.statusCode, confirmed.body).toBe(200);

    expect((await call('DELETE', `${API}/transactions/${expense.id}`)).statusCode).toBe(204);
    const afterDelete = await refundReview(refund.id);
    expect(afterDelete).toMatchObject({
      state: 'review-required',
      splits: [],
      validAttributedCents: 0,
      unresolvedCents: 3_000,
    });
    expect(afterDelete.reasons).toContain('original-deleted');
    expect(afterDelete.originals[0]).toMatchObject({
      transactionId: expense.id,
      state: 'deleted',
    });

    const restore = await call('POST', `${API}/trash/${expense.id}/restore`);
    expect(restore.statusCode, restore.body).toBe(200);
    const afterRestore = await refundReview(refund.id);
    expect(afterRestore).toMatchObject({
      state: 'review-required',
      splits: [],
      validAttributedCents: 0,
      unresolvedCents: 3_000,
    });
    const restoredExecution = await executionFor(plan.period.id);
    expect(spending(restoredExecution, 'essentials')).toMatchObject({
      grossCents: 10_000,
      attributedRefundCents: 0,
      netCents: 10_000,
    });

    expect((await call('DELETE', `${API}/transactions/${expense.id}`)).statusCode).toBe(204);
    const purge = await call('DELETE', `${API}/trash/${expense.id}`);
    expect(purge.statusCode, purge.body).toBe(204);
    const afterPurge = await refundReview(refund.id);
    expect(afterPurge).toMatchObject({
      state: 'review-required',
      splits: [],
      validAttributedCents: 0,
      unresolvedCents: 3_000,
    });
    expect(afterPurge.originals[0]).toMatchObject({
      transactionId: expense.id,
      state: 'purged',
      amountCents: 0,
      remainingRefundableCents: 0,
    });
  });

  it('bulk restore-all and purgeAll keep the audit readable without executable orphans', async () => {
    const plan = await setupPlan();
    const expense = await createExpense({
      accountId: plan.base.accountId,
      categoryId: plan.base.essentialsCategoryId,
      amountCents: 10_000,
    });
    const refund = await createRefund({
      accountId: plan.base.accountId,
      categoryId: plan.base.incomeCategoryId,
      amountCents: 3_000,
      linkedOriginalIds: [expense.id],
    });
    const confirmed = await putSplits(refund.id, [
      { originalTransactionId: expense.id, amountCents: 3_000 },
    ]);
    expect(confirmed.statusCode, confirmed.body).toBe(200);

    expect((await call('DELETE', `${API}/transactions/${expense.id}`)).statusCode).toBe(204);
    expect((await call('DELETE', `${API}/transactions/${refund.id}`)).statusCode).toBe(204);
    const deletedReview = await refundReview(refund.id);
    expect(deletedReview).toMatchObject({
      state: 'deleted',
      validAttributedCents: 0,
      splits: [],
    });

    const restoreAll = await call('POST', `${API}/trash/restore-all`);
    expect(restoreAll.statusCode, restoreAll.body).toBe(200);
    expect((restoreAll.json() as { restored: number }).restored).toBe(2);
    const restoredReview = await refundReview(refund.id);
    expect(restoredReview.state).toBe('review-required');
    expect(restoredReview.splits).toEqual([]);
    expect(restoredReview.validAttributedCents).toBe(0);

    expect((await call('DELETE', `${API}/transactions/${expense.id}`)).statusCode).toBe(204);
    expect((await call('DELETE', `${API}/transactions/${refund.id}`)).statusCode).toBe(204);
    const purgeAll = await call('DELETE', `${API}/trash`);
    expect(purgeAll.statusCode, purgeAll.body).toBe(200);
    expect((purgeAll.json() as { purged: number }).purged).toBe(2);

    // The refund row is gone, but its split-set audit must still answer by id.
    // Snapshot amount/date presentation is deliberately not asserted here: the
    // frozen contract allows amount 0 for purged tombstones and the audit policy
    // is owned by the backend.
    const purgedReview = await refundReview(refund.id);
    expect(purgedReview).toMatchObject({
      refundTransactionId: refund.id,
      state: 'purged',
      splits: [],
      validAttributedCents: 0,
    });
  });

  it('invalidates every set touching a globally over-refunded original, including their other originals, without GET writes', async () => {
    const plan = await setupPlan();
    const globalOriginal = await createExpense({
      accountId: plan.base.accountId,
      categoryId: plan.base.essentialsCategoryId,
      amountCents: 10_000,
    });
    const otherOriginalOne = await createExpense({
      accountId: plan.base.accountId,
      categoryId: plan.base.essentialsCategoryId,
      amountCents: 10_000,
    });
    await createExpense({
      accountId: plan.base.accountId,
      categoryId: plan.base.joyCategoryId,
      amountCents: 10_000,
    });

    const refundOne = await createRefund({
      accountId: plan.base.accountId,
      categoryId: plan.base.incomeCategoryId,
      amountCents: 10_000,
      date: Date.UTC(2026, 8, 21, 4),
      linkedOriginalIds: [globalOriginal.id, otherOriginalOne.id],
    });
    const first = await putSplits(refundOne.id, [
      { originalTransactionId: globalOriginal.id, amountCents: 3_000 },
      { originalTransactionId: otherOriginalOne.id, amountCents: 1_000 },
    ]);
    expect(first.statusCode, first.body).toBe(200);

    const refundTwo = await createRefund({
      accountId: plan.base.accountId,
      categoryId: plan.base.incomeCategoryId,
      amountCents: 2_000,
      date: Date.UTC(2026, 8, 22, 4),
      linkedOriginalIds: [globalOriginal.id],
    });
    const second = await putSplits(refundTwo.id, [
      { originalTransactionId: globalOriginal.id, amountCents: 2_000 },
    ]);
    expect(second.statusCode, second.body).toBe(200);

    // Simulate an old writer that changed only a split amount (the durable
    // critical facts stay unchanged), making the *global* attribution to one
    // original 9,000 + 2,000 > 10,000. Per-refund validation would accept each
    // set; only a central, all-sets assessment can catch this.
    db.prepare(
      'UPDATE financial_refund_splits SET amount_cents = 9000 WHERE refund_tx_id = ? AND original_tx_id = ?',
    ).run(refundOne.id, globalOriginal.id);
    alignConfirmedSplitSnapshot(refundOne.id);

    const execution = await executionFor(plan.period.id);
    expect(spending(execution, 'essentials')).toMatchObject({
      grossCents: 20_000,
      attributedRefundCents: 0,
      netCents: 20_000,
      state: 'provisional',
    });
    expect(spending(execution, 'joy')).toMatchObject({
      grossCents: 10_000,
      attributedRefundCents: 0,
      netCents: 10_000,
      state: 'provisional',
    });
    expect(execution.coverage).toBe('provisional');

    const queue = await getJson<RefundListResponse>(
      `${BASE}/refunds?state=review-required`,
    );
    expect(queue.items.map((item) => item.refundTransactionId).sort()).toEqual(
      [refundOne.id, refundTwo.id].sort(),
    );
    for (const item of queue.items) {
      // The whole set is excluded, not only the over-refunded original's row.
      expect(item.validAttributedCents).toBe(0);
      expect(item.splits).toEqual([]);
      expect(item.unresolvedCents).toBe(item.amountCents);
      expect(item.reasons).toContain('over-refund');
    }

    // GET is strictly read-only: the external over-cap problem stays visible but
    // is not "repaired" by persisting invalid rows behind the user's back.
    const states = db
      .prepare('SELECT state FROM financial_refund_splits ORDER BY refund_tx_id, original_tx_id')
      .all() as { state: string }[];
    expect(states.map((row) => row.state)).toEqual(['active', 'active', 'active']);
  });

  it('loads every sibling of a competing refund before calculating remaining capacity', async () => {
    const base = await createBaseFixture();
    const a = await createExpense({ accountId: base.accountId, categoryId: base.essentialsCategoryId, amountCents: 10_000 });
    const b = await createExpense({ accountId: base.accountId, categoryId: base.essentialsCategoryId, amountCents: 10_000 });
    const first = await createRefund({ accountId: base.accountId, categoryId: base.incomeCategoryId, amountCents: 6_000, linkedOriginalIds: [a.id] });
    expect((await putSplits(first.id, [{ originalTransactionId: a.id, amountCents: 6_000 }])).statusCode).toBe(200);
    const competitor = await createRefund({ accountId: base.accountId, categoryId: base.incomeCategoryId, amountCents: 5_000, linkedOriginalIds: [a.id, b.id] });
    expect((await putSplits(competitor.id, [{ originalTransactionId: a.id, amountCents: 4_000 }, { originalTransactionId: b.id, amountCents: 1_000 }])).statusCode).toBe(200);

    // Simulate an old writer bypassing lifecycle invalidation on B. The competing
    // refund's complete set is invalid, so its A split cannot consume capacity.
    db.prepare('UPDATE transactions SET amount_cents = 11000 WHERE id = ?').run(b.id);
    const review = await refundReview(first.id);
    expect(review.state).toBe('confirmed');
    expect(review.originals.find((original) => original.transactionId === a.id)).toMatchObject({
      otherConfirmedRefundCents: 0,
      remainingRefundableCents: 10_000,
    });
    expect((await refundReview(competitor.id)).state).toBe('review-required');
  });

  it('evaluates overlapping over-cap originals against the same set snapshot', async () => {
    const base = await createBaseFixture();
    const a = await createExpense({ accountId: base.accountId, categoryId: base.essentialsCategoryId, amountCents: 10_000 });
    const b = await createExpense({ accountId: base.accountId, categoryId: base.essentialsCategoryId, amountCents: 10_000 });
    const first = await createRefund({ accountId: base.accountId, categoryId: base.incomeCategoryId, amountCents: 7_000, linkedOriginalIds: [a.id] });
    const middle = await createRefund({ accountId: base.accountId, categoryId: base.incomeCategoryId, amountCents: 10_000, linkedOriginalIds: [a.id, b.id] });
    const last = await createRefund({ accountId: base.accountId, categoryId: base.incomeCategoryId, amountCents: 7_000, linkedOriginalIds: [b.id] });
    expect((await putSplits(first.id, [{ originalTransactionId: a.id, amountCents: 7_000 }])).statusCode).toBe(200);
    expect((await putSplits(middle.id, [{ originalTransactionId: a.id, amountCents: 3_000 }, { originalTransactionId: b.id, amountCents: 3_000 }])).statusCode).toBe(200);
    expect((await putSplits(last.id, [{ originalTransactionId: b.id, amountCents: 7_000 }])).statusCode).toBe(200);
    db.prepare('UPDATE financial_refund_splits SET amount_cents = 5000 WHERE refund_tx_id = ?').run(middle.id);
    alignConfirmedSplitSnapshot(middle.id);
    for (const refund of [first, middle, last]) {
      const review = await refundReview(refund.id);
      expect(review.state).toBe('review-required');
      expect(review.validAttributedCents).toBe(0);
      expect(review.reasons).toContain('over-refund');
    }
    const before = db.prepare('SELECT id, amount_cents FROM financial_refund_splits WHERE refund_tx_id = ?').all(first.id);
    const retry = await putSplits(first.id, [{ originalTransactionId: a.id, amountCents: 7_000 }]);
    expect(retry.statusCode, retry.body).toBe(409);
    expect(db.prepare('SELECT id, amount_cents FROM financial_refund_splits WHERE refund_tx_id = ?').all(first.id)).toEqual(before);
  });

  it('rejects tampered confirmed splits that exceed the refund even below original caps', async () => {
    const base = await createBaseFixture();
    const a = await createExpense({ accountId: base.accountId, categoryId: base.essentialsCategoryId, amountCents: 10_000 });
    const b = await createExpense({ accountId: base.accountId, categoryId: base.essentialsCategoryId, amountCents: 10_000 });
    const refund = await createRefund({ accountId: base.accountId, categoryId: base.incomeCategoryId, amountCents: 5_000, linkedOriginalIds: [a.id, b.id] });
    expect((await putSplits(refund.id, [{ originalTransactionId: a.id, amountCents: 3_000 }, { originalTransactionId: b.id, amountCents: 2_000 }])).statusCode).toBe(200);
    db.prepare('UPDATE financial_refund_splits SET amount_cents = 6000 WHERE refund_tx_id = ? AND original_tx_id = ?').run(refund.id, a.id);
    const review = await refundReview(refund.id);
    expect(review.state).toBe('review-required');
    expect(review.validAttributedCents).toBe(0);
    expect(review.unresolvedCents).toBe(5_000);
    const summary = await getJson<{ totals: { refunded: { essentials: number; joy: number; growth: number; reserve: number } }; coverage: { invalidRefundCount: number } }>('/api/v1/financial-funds/summary');
    expect(summary.totals.refunded).toEqual({ growth: 0, reserve: 0, essentials: 0, joy: 0 });
    expect(summary.coverage.invalidRefundCount).toBe(1);
    // Even if a corrupt external writer also rewrites the audit snapshot, the
    // resulting 8,000 cents cannot be credited to a 5,000-cent refund.
    alignConfirmedSplitSnapshot(refund.id);
    const overRefund = await refundReview(refund.id);
    expect(overRefund.state).toBe('review-required');
    expect(overRefund.validAttributedCents).toBe(0);
  });

  it('does not remove consumption when only the account is soft deleted', async () => {
    const base = await createBaseFixture();
    const expenseAccount = await createAccount('退款测试专用账户');
    const salary = await createSalary(base.accountId, 10_000, SEP_SALARY_DATE);
    const period = (await previewAndConfirm(base, [salary.id], '2026-09')).period;
    const expense = await createExpense({
      accountId: expenseAccount,
      categoryId: base.essentialsCategoryId,
      amountCents: 4_000,
    });
    const refund = await createRefund({
      accountId: base.accountId,
      categoryId: base.incomeCategoryId,
      amountCents: 1_000,
      linkedOriginalIds: [expense.id],
    });
    const confirmed = await putSplits(refund.id, [
      { originalTransactionId: expense.id, amountCents: 1_000 },
    ]);
    expect(confirmed.statusCode, confirmed.body).toBe(200);

    const deleteAccount = await call('DELETE', `${API}/accounts/${expenseAccount}`);
    expect(deleteAccount.statusCode, deleteAccount.body).toBe(204);

    const execution = await executionFor(period.id);
    expect(spending(execution, 'essentials')).toMatchObject({
      grossCents: 4_000,
      attributedRefundCents: 1_000,
      netCents: 3_000,
      state: 'exact',
    });
    expect((await refundReview(refund.id)).state).toBe('confirmed');
  });

  it('attributes a cross-cycle refund to the original cycle and leaves the receipt cycle untouched', async () => {
    const base = await createBaseFixture();
    const septemberSalary = await createSalary(base.accountId, 10_000, SEP_SALARY_DATE);
    const octoberSalary = await createSalary(base.accountId, 10_000, OCT_SALARY_DATE);
    const september = (await previewAndConfirm(base, [septemberSalary.id], '2026-09')).period;
    const october = (await previewAndConfirm(base, [octoberSalary.id], '2026-10')).period;

    const septemberExpense = await createExpense({
      accountId: base.accountId,
      categoryId: base.essentialsCategoryId,
      amountCents: 10_000,
      date: SEP_EXPENSE_DATE,
    });
    const octoberExpense = await createExpense({
      accountId: base.accountId,
      categoryId: base.essentialsCategoryId,
      amountCents: 5_000,
      date: OCT_EXPENSE_DATE,
    });
    const refund = await createRefund({
      accountId: base.accountId,
      categoryId: base.incomeCategoryId,
      amountCents: 3_000,
      date: Date.UTC(2026, 9, 15, 4, 0, 0), // receipt in October
      linkedOriginalIds: [septemberExpense.id],
    });

    const review = await refundReview(refund.id);
    expect(review.date).toBe(Date.UTC(2026, 9, 15, 4, 0, 0));
    expect(review.originals[0]).toMatchObject({
      transactionId: septemberExpense.id,
      periodId: september.id,
      state: 'live',
    });
    const confirmed = await putSplits(refund.id, [
      { originalTransactionId: septemberExpense.id, amountCents: 3_000 },
    ]);
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect((confirmed.json() as SplitResponse).affectedPeriodIds).toEqual([september.id]);

    const septemberExecution = await executionFor(september.id);
    expect(spending(septemberExecution, 'essentials')).toMatchObject({
      grossCents: 10_000,
      attributedRefundCents: 3_000,
      netCents: 7_000,
      state: 'exact',
    });

    const octoberExecution = await executionFor(october.id);
    expect(spending(octoberExecution, 'essentials')).toMatchObject({
      grossCents: 5_000,
      attributedRefundCents: 0,
      netCents: 5_000,
      state: 'exact',
    });

    const home = await homeExecution();
    expect(home.state).toBe('ready');
    expect(home.execution?.period.id).toBe(october.id);
    expect(home.execution?.funding).toEqual([
      {
        purpose: 'growth',
        targetCents: 2_500,
        state: 'not-connected',
        executedCents: null,
        remainingCents: null,
      },
      {
        purpose: 'reserve',
        targetCents: 1_500,
        state: 'not-connected',
        executedCents: null,
        remainingCents: null,
      },
    ]);
    expect(octoberExpense.id).toBeTruthy();
  });
});
