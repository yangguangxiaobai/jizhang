/**
 * C2 — 月计划只读汇总(`GET /api/v1/monthly-plan`)回归。
 *
 * 本文件只通过公开 HTTP API 驱动真实的 `AuthService` + `app.inject()`,数据库由
 * 当前迁移集创建。所有金额断言都是验收矩阵 C2-01..C2-07 的字面算术:
 *
 * - 工资 10000 分 → 成长 2500 / 应急 1500 / 必要 5000 / 随心 1000,消费预算 6000;
 * - 必要 3200 + 随心 600 → 各自剩 1800 / 400,合计 2200;
 * - 支出 100 + 已归属退款 30 → 毛额 100 / 退款 30 / 净额 70;
 * - 待核对时不发布精确剩余(`remainingCents === null`);
 * - 自然月没有当月方案 → `no-period`,绝不回退到旧月份;
 * - 读取**不创建周期、不改分配**(C2-09 的"只读"面)。
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
import { allocateSalaryCents } from '@jizhang/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { closeDatabase, initializeDatabase, type Db } from '../src/db/index.js';
import { SESSION_COOKIE } from '../src/plugins/auth.js';
import { AuthService } from '../src/services/auth-service.js';
import { seedHistoricalSalary } from './support/historical-salary-fixture.js';
import type {
  FinancialConfig,
  FinancialMeta,
  FinancialPeriod,
  FinancialPeriodProposal,
  FinancialPreview,
  FinancialRefundReview,
  FinancialSalarySource,
} from '../src/services/financial-planning-service.js';
import type { MonthlyPlanView } from '../src/services/monthly-plan-service.js';
import type { SalaryDetailDto } from '../src/services/salary-service.js';
import type { TransactionDto } from '../src/services/transaction-service.js';

const USERNAME = 'quiz';
const PASSWORD = 'correct horse battery staple';
const CSRF = { 'x-requested-with': 'fetch' } as const;

/** 服务器"现在":2026-10-27 12:00 Asia/Shanghai。 */
const NOW = Date.UTC(2026, 9, 27, 4, 0, 0);
const TIME_ZONE = 'Asia/Shanghai';
const BASE = '/api/v1/financial-planning';
const API = '/api/v1';
const MONTHLY = '/api/v1/monthly-plan';

// Asia/Shanghai 没有夏令时(UTC+8),本地午夜 = 前一天 16:00Z。
const SEP_SALARY_DATE = Date.UTC(2026, 8, 10, 4, 0, 0); // 2026-09-10 12:00 本地
const OCT_SALARY_DATE = Date.UTC(2026, 9, 10, 4, 0, 0); // 2026-10-10 12:00 本地
const OCT_EXPENSE_DATE = Date.UTC(2026, 9, 20, 4, 0, 0); // 2026-10-20 12:00 本地

/** 2026-10-10 00:00 +08。 */
const OCT_WINDOW_START = Date.UTC(2026, 9, 9, 16, 0, 0);
/** 2026-11-01 00:00 +08。 */
const OCT_WINDOW_END = Date.UTC(2026, 9, 31, 16, 0, 0);
/** 2026-09-10 00:00 +08。 */
const SEP_WINDOW_START = Date.UTC(2026, 8, 9, 16, 0, 0);
/** 2026-10-01 00:00 +08。 */
const SEP_WINDOW_END = Date.UTC(2026, 8, 30, 16, 0, 0);
/** 2026-11-10 00:00 +08。 */
const OCT_START_DAY_WINDOW_END = Date.UTC(2026, 10, 9, 16, 0, 0);

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

interface BaseFixture {
  readonly accountId: string;
  readonly essentialsCategoryId: string;
  readonly joyCategoryId: string;
  readonly unmappedCategoryId: string;
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

async function putConfig(input: {
  enabled: boolean;
  cycle: FinancialCycle;
  ratiosBps?: { growth: number; reserve: number; essentials: number; joy: number };
}): Promise<void> {
  const before = await getConfig();
  const response = await call('PUT', `${BASE}/config`, {
    operationId: requestId(),
    expectedRevision: before.config.revision,
    enabled: input.enabled,
    ratiosBps: input.ratiosBps ?? { growth: 2500, reserve: 1500, essentials: 5000, joy: 1000 },
    essentialMonthlyCents: 5000,
    targetMonths: 5,
    cycle: input.cycle,
    timeZone: TIME_ZONE,
  });
  expect(response.statusCode, response.body).toBe(200);
}

async function createBaseFixture(
  cycle: FinancialCycle = { kind: 'natural-month' },
): Promise<BaseFixture> {
  const accountId = await createAccount('月计划测试账户');
  const essentialsCategoryId = await createCategory('月计划测试必要', 0);
  const joyCategoryId = await createCategory('月计划测试随心', 0);
  const unmappedCategoryId = await createCategory('月计划测试未归类', 0);
  const incomeCategoryId = await createCategory('月计划测试收入', 1);

  await putConfig({ enabled: true, cycle });

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
  const config = await getConfig();

  return {
    accountId,
    essentialsCategoryId,
    joyCategoryId,
    unmappedCategoryId,
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
  // Seeded directly: fresh legacy salary writes are retired, and these cases are about
  // the plan/period read model, which only needs the salary fact to exist.
  //
  // The frozen module snapshot is part of that historical fact (the old create took it
  // from the default template), so it is reproduced here: a plan view that reports the
  // legacy envelope reference must keep seeing a non-empty historical allocation.
  const template = db
    .prepare('SELECT modules_json FROM budget_templates WHERE is_default = 1 AND deleted = 0 LIMIT 1')
    .get() as { modules_json: string } | undefined;
  const modules =
    template === undefined
      ? []
      : (JSON.parse(template.modules_json) as { categoryId: string; ratio: number }[]);
  const allocations = allocateSalaryCents(amountCents, modules);
  const { id } = seedHistoricalSalary(db, {
    amountCents,
    date,
    accountId,
    note: '月计划测试工资',
    allocations,
  });
  const row = db.prepare('SELECT * FROM salary_records WHERE id = ?').get(id) as {
    id: string; amount_cents: number; date: number; note: string; account_id: string; updated_at: number;
  };
  return {
    id: row.id,
    amountCents: row.amount_cents,
    date: row.date,
    note: row.note,
    accountId: row.account_id,
    updatedAt: row.updated_at,
    allocationId: null,
    allocations,
  };
}

async function salarySources(groupMonth: string): Promise<SourceListResponse> {
  return getJson<SourceListResponse>(
    `${BASE}/sources/salaries?groupMonth=${encodeURIComponent(groupMonth)}&timeZone=${encodeURIComponent(TIME_ZONE)}`,
  );
}

async function previewAndConfirm(
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

async function createExpense(input: {
  accountId: string;
  categoryId: string;
  amountCents: number;
  date?: number;
}): Promise<TransactionDto> {
  const response = await call('POST', `${API}/transactions`, {
    type: 0,
    amountCents: input.amountCents,
    categoryId: input.categoryId,
    accountId: input.accountId,
    date: input.date ?? OCT_EXPENSE_DATE,
    note: '月计划测试支出',
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
    date: input.date ?? Date.UTC(2026, 9, 21, 4, 0, 0),
    note: '月计划测试退款',
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

async function attributeRefund(
  refundId: string,
  splits: readonly FinancialRefundSplit[],
): Promise<void> {
  const review = await refundReview(refundId);
  const originals = splits.map((split) => {
    const found = review.originals.find((entry) => entry.transactionId === split.originalTransactionId);
    if (found === undefined) throw new Error(`original not in refund review: ${split.originalTransactionId}`);
    return { transactionId: found.transactionId, expectedTransactionToken: found.transactionToken };
  });
  const response = await call('PUT', `${BASE}/refunds/${refundId}/splits`, {
    operationId: requestId(),
    expectedRevision: review.revision,
    expectedRefundToken: review.refundToken,
    originals,
    splits: [...splits],
  });
  expect(response.statusCode, response.body).toBe(200);
}

/** `GET /api/v1/monthly-plan`,查询串由调用方拼(空串 = 不带参数)。 */
async function monthlyPlan(query = ''): Promise<MonthlyPlanView> {
  return getJson<MonthlyPlanView>(`${MONTHLY}${query}`);
}

/** 只读性检查用的行数快照:覆盖所有会被"顺手创建周期"影响到的表。 */
const COUNTED_TABLES = [
  'financial_periods',
  'financial_period_revisions',
  'financial_period_sources',
  'financial_operations',
  'financial_config_revisions',
  'financial_mapping_revisions',
  'financial_refund_splits',
  'budget_allocations',
  'salary_records',
  'transactions',
] as const;

function rowCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const table of COUNTED_TABLES) {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number };
    counts[table] = row.c;
  }
  return counts;
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

describe('GET /api/v1/monthly-plan', () => {
  it('returns the frozen window containing server now with the 10000-salary targets', async () => {
    const base = await createBaseFixture();
    const salary = await createSalary(base.accountId, 10_000, OCT_SALARY_DATE);
    const confirmed = await previewAndConfirm([salary.id], '2026-10');

    // C2-01:工资 10000 分的四用途目标 + 消费预算 = 必要 5000 + 随心 1000。
    const view = await monthlyPlan();
    expect(view.state).toBe('ready');
    expect(view.periodId).toBe(confirmed.period.id);
    expect(view.revision).toBe(confirmed.period.revision);
    expect(view.window).toEqual({
      from: OCT_WINDOW_START,
      to: OCT_WINDOW_END,
      timeZone: TIME_ZONE,
      label: '2026-10-10 ~ 2026-11-01',
    });
    expect(view.confirmedIncomeCents).toBe(10_000);
    expect(view.targetsCents).toEqual({
      growth: 2_500,
      reserve: 1_500,
      essentials: 5_000,
      joy: 1_000,
    });
    expect(view.summary).toEqual({
      consumptionBudgetCents: 6_000,
      confirmedNetSpentCents: 0,
      remainingCents: 6_000,
      status: 'exact',
    });
    expect(view.purposes).toEqual([
      {
        purpose: 'essentials',
        budgetCents: 5_000,
        grossCents: 0,
        refundCents: 0,
        netCents: 0,
        remainingCents: 5_000,
        overspendCents: 0,
      },
      {
        purpose: 'joy',
        budgetCents: 1_000,
        grossCents: 0,
        refundCents: 0,
        netCents: 0,
        remainingCents: 1_000,
        overspendCents: 0,
      },
    ]);
    expect(view.categories).toEqual([]);
    expect(view.unresolved).toMatchObject({
      reasons: [],
      count: 0,
      expenseCount: 0,
      grossCents: 0,
      netCents: 0,
    });
    // 工资模板生成的旧信封仍显示为毛额参考(10000),但消费预算仍独立为必要+随心(6000)。
    expect(view.legacyEnvelopeReference).toMatchObject({
      mode: 'legacy-reference',
      contract: 'legacy-gross',
      totalBudgetCents: 10_000,
      purposeSpendingCeilingCents: 6_000,
      validatedNestedAllocation: false,
    });
  });

  it('keeps 1800 / 400 remaining per bucket and 2200 in total for 3200 + 600 spending', async () => {
    const base = await createBaseFixture();
    const salary = await createSalary(base.accountId, 10_000, OCT_SALARY_DATE);
    await previewAndConfirm([salary.id], '2026-10');
    await createExpense({
      accountId: base.accountId,
      categoryId: base.essentialsCategoryId,
      amountCents: 3_200,
    });
    await createExpense({
      accountId: base.accountId,
      categoryId: base.joyCategoryId,
      amountCents: 600,
    });

    // C2-02:必要剩 5000−3200=1800、随心剩 1000−600=400,合计 6000−3800=2200。
    const view = await monthlyPlan();
    expect(view.summary).toEqual({
      consumptionBudgetCents: 6_000,
      confirmedNetSpentCents: 3_800,
      remainingCents: 2_200,
      status: 'exact',
    });
    expect(view.purposes.map((row) => [row.purpose, row.netCents, row.remainingCents])).toEqual([
      ['essentials', 3_200, 1_800],
      ['joy', 600, 400],
    ]);
    expect(view.categories).toEqual([
      {
        categoryId: base.essentialsCategoryId,
        categoryName: '月计划测试必要',
        purpose: 'essentials',
        grossCents: 3_200,
        refundCents: 0,
        netCents: 3_200,
      },
      {
        categoryId: base.joyCategoryId,
        categoryName: '月计划测试随心',
        purpose: 'joy',
        grossCents: 600,
        refundCents: 0,
        netCents: 600,
      },
    ]);
  });

  it('attributes a confirmed refund to the original expense: gross 100, refund 30, net 70', async () => {
    const base = await createBaseFixture();
    const salary = await createSalary(base.accountId, 10_000, OCT_SALARY_DATE);
    await previewAndConfirm([salary.id], '2026-10');

    const expense = await createExpense({
      accountId: base.accountId,
      categoryId: base.essentialsCategoryId,
      amountCents: 100,
    });
    const refund = await createRefund({
      accountId: base.accountId,
      categoryId: base.incomeCategoryId,
      amountCents: 30,
      linkedOriginalIds: [expense.id],
    });
    await attributeRefund(refund.id, [{ originalTransactionId: expense.id, amountCents: 30 }]);

    // C2-04:退款归到**原支出**的必要分类,不产生一条新的收入分类消费行。
    const view = await monthlyPlan();
    expect(view.categories).toEqual([
      {
        categoryId: base.essentialsCategoryId,
        categoryName: '月计划测试必要',
        purpose: 'essentials',
        grossCents: 100,
        refundCents: 30,
        netCents: 70,
      },
    ]);
    expect(view.summary).toEqual({
      consumptionBudgetCents: 6_000,
      confirmedNetSpentCents: 70,
      remainingCents: 5_930,
      status: 'exact',
    });
    expect(view.purposes[0]).toMatchObject({
      purpose: 'essentials',
      grossCents: 100,
      refundCents: 30,
      netCents: 70,
      remainingCents: 4_930,
    });
    expect(view.unresolved.reasons).toEqual([]);
  });

  it('marks an unmapped expense as review-required and withholds the exact remaining amount', async () => {
    const base = await createBaseFixture();
    const salary = await createSalary(base.accountId, 10_000, OCT_SALARY_DATE);
    await previewAndConfirm([salary.id], '2026-10');
    await createExpense({
      accountId: base.accountId,
      categoryId: base.unmappedCategoryId,
      amountCents: 500,
    });

    // C2-06:有未归类支出时状态是待核对,"还能花"必须是 null 而不是 6000。
    const view = await monthlyPlan();
    expect(view.state).toBe('ready');
    expect(view.summary).toEqual({
      consumptionBudgetCents: 6_000,
      confirmedNetSpentCents: 0,
      remainingCents: null,
      status: 'review-required',
    });
    expect(view.purposes.map((row) => row.remainingCents)).toEqual([null, null]);
    expect(view.purposes.map((row) => row.overspendCents)).toEqual([null, null]);
    expect(view.categories).toEqual([
      {
        categoryId: base.unmappedCategoryId,
        categoryName: '月计划测试未归类',
        purpose: 'unresolved',
        grossCents: 500,
        refundCents: 0,
        netCents: 500,
      },
    ]);
    expect(view.unresolved).toMatchObject({
      reasons: ['not-mapped'],
      count: 1,
      expenseCount: 1,
      grossCents: 500,
      netCents: 500,
    });
  });

  it('keeps a custom-start window’s stored boundaries and timezone (C2-05)', async () => {
    const base = await createBaseFixture({ kind: 'start-day', day: 10 });
    const salary = await createSalary(base.accountId, 10_000, OCT_SALARY_DATE);
    await previewAndConfirm([salary.id], '2026-10');

    const view = await monthlyPlan();
    expect(view.state).toBe('ready');
    // 10 日起算:[2026-10-10 00:00, 2026-11-10 00:00) Asia/Shanghai,不是 30 天近似。
    expect(view.window).toEqual({
      from: OCT_WINDOW_START,
      to: OCT_START_DAY_WINDOW_END,
      timeZone: TIME_ZONE,
      label: '2026-10-10 ~ 2026-11-10',
    });
    // 服务器 now(10-27)仍在这个自定义区间里。
    expect(view.summary?.consumptionBudgetCents).toBe(6_000);
  });

  it('returns no-period for a month without a confirmed period instead of an older month (C2-05)', async () => {
    const base = await createBaseFixture();
    const salary = await createSalary(base.accountId, 10_000, SEP_SALARY_DATE);
    const confirmed = await previewAndConfirm([salary.id], '2026-09');
    // 已确认窗口是 [2026-09-10, 2026-10-01),不包含服务器 now(2026-10-27)。

    const current = await monthlyPlan();
    expect(current.state).toBe('no-period');
    expect(current.periodId).toBeNull();
    expect(current.window).toBeNull();
    expect(current.summary).toBeNull();
    expect(current.confirmedIncomeCents).toBeNull();
    expect(current.targetsCents).toBeNull();
    expect(current.legacyEnvelopeReference).toBeNull();

    const absentMonth = await monthlyPlan('?month=2026-10');
    expect(absentMonth.state).toBe('no-period');

    // 显式历史月份仍然按真实冻结区间返回,不会被"当前月"覆盖。
    const history = await monthlyPlan('?month=2026-09');
    expect(history.state).toBe('ready');
    expect(history.periodId).toBe(confirmed.period.id);
    expect(history.window).toEqual({
      from: SEP_WINDOW_START,
      to: SEP_WINDOW_END,
      timeZone: TIME_ZONE,
      label: '2026-09-10 ~ 2026-10-01',
    });
    expect(history.summary?.consumptionBudgetCents).toBe(6_000);

    const byId = await monthlyPlan(`?periodId=${confirmed.period.id}`);
    expect(byId.periodId).toBe(confirmed.period.id);
  });

  it('returns no-period on a ledger with no confirmed period and creates nothing', async () => {
    await createBaseFixture();
    const before = rowCounts();
    const view = await monthlyPlan();
    expect(view.state).toBe('no-period');
    expect(view.periodId).toBeNull();
    expect(rowCounts()).toEqual(before);
    expect(before['financial_periods']).toBe(0);
  });

  it('returns disabled when the execution config is turned off', async () => {
    const base = await createBaseFixture();
    const salary = await createSalary(base.accountId, 10_000, OCT_SALARY_DATE);
    const confirmed = await previewAndConfirm([salary.id], '2026-10');
    await putConfig({ enabled: false, cycle: { kind: 'natural-month' } });

    const view = await monthlyPlan(`?periodId=${confirmed.period.id}`);
    expect(view.state).toBe('disabled');
    expect(view.periodId).toBeNull();
    expect(view.summary).toBeNull();
    expect(view.categories).toEqual([]);
    expect(view.unresolved.reasons).toEqual([]);
  });

  it('rejects periodId together with month, unknown periods and malformed months', async () => {
    const base = await createBaseFixture();
    const salary = await createSalary(base.accountId, 10_000, OCT_SALARY_DATE);
    const confirmed = await previewAndConfirm([salary.id], '2026-10');

    const both = await call('GET', `${MONTHLY}?periodId=${confirmed.period.id}&month=2026-10`);
    expectError(both, 400, 'FINANCIAL_INVALID');

    const unknownPeriod = await call('GET', `${MONTHLY}?periodId=${requestId()}`);
    expectError(unknownPeriod, 404, 'NOT_FOUND');

    for (const month of ['2026-13', '2026-1', '202610', '2026-10-01']) {
      const response = await call('GET', `${MONTHLY}?month=${encodeURIComponent(month)}`);
      expectError(response, 400, 'FINANCIAL_INVALID');
    }
  });

  it('requires an explicit periodId when one group month has several confirmed periods', async () => {
    const base = await createBaseFixture();
    const firstSalary = await createSalary(base.accountId, 10_000, SEP_SALARY_DATE);
    await previewAndConfirm([firstSalary.id], '2026-09');

    // 换一种周期规则,再确认同一个月里的第二笔工资 → 同一个 group_month 的第二个周期。
    await putConfig({ enabled: true, cycle: { kind: 'start-day', day: 10 } });
    const secondSalary = await createSalary(base.accountId, 5_000, Date.UTC(2026, 8, 25, 4, 0, 0));
    const second = await previewAndConfirm([secondSalary.id], '2026-09');
    expect(second.period.window.cycleKey).not.toBe('natural-month:2026-09');

    const ambiguous = await call('GET', `${MONTHLY}?month=2026-09`);
    expectError(ambiguous, 409, 'FINANCIAL_WINDOW_CONFLICT');

    const byId = await monthlyPlan(`?periodId=${second.period.id}`);
    expect(byId.state).toBe('ready');
    expect(byId.periodId).toBe(second.period.id);
    expect(byId.confirmedIncomeCents).toBe(5_000);
  });

  it('never creates a period or moves a revision when read', async () => {
    const base = await createBaseFixture();
    const salary = await createSalary(base.accountId, 10_000, OCT_SALARY_DATE);
    const confirmed = await previewAndConfirm([salary.id], '2026-10');
    await createExpense({
      accountId: base.accountId,
      categoryId: base.essentialsCategoryId,
      amountCents: 3_200,
    });

    const before = rowCounts();
    const first = await monthlyPlan();
    await monthlyPlan('?month=2026-10');
    await monthlyPlan(`?periodId=${confirmed.period.id}`);
    await monthlyPlan('?month=2026-01');
    const second = await monthlyPlan();

    expect(rowCounts()).toEqual(before);
    expect(first.revision).toBe(confirmed.period.revision);
    expect(second.revision).toBe(confirmed.period.revision);
    expect(second.summary).toEqual(first.summary);
    // 周期本身也没有新增修订。
    const revisions = db
      .prepare('SELECT COUNT(*) AS c FROM financial_period_revisions WHERE period_id = ?')
      .get(confirmed.period.id) as { c: number };
    expect(revisions.c).toBe(1);
  });

  it('exposes the legacy envelope as a reference only, never added to the consumption budget (C2-07)', async () => {
    const base = await createBaseFixture();
    const salary = await createSalary(base.accountId, 10_000, OCT_SALARY_DATE);
    await previewAndConfirm([salary.id], '2026-10');

    // 旧信封:工资 10000 分按模板拆成必要 6000 + 随心 4000(与执行目标 5000/1000 不同)。
    const allocation = await call('PUT', `${API}/salaries/${salary.id}/allocations`, {
      allocations: [
        { categoryId: base.essentialsCategoryId, amountCents: 6_000 },
        { categoryId: base.joyCategoryId, amountCents: 4_000 },
      ],
    });
    expect(allocation.statusCode, allocation.body).toBe(200);

    const view = await monthlyPlan();
    expect(view.legacyEnvelopeReference).toMatchObject({
      mode: 'legacy-reference',
      contract: 'legacy-gross',
      totalBudgetCents: 10_000,
      mappedBudgetCents: { essentials: 6_000, joy: 4_000, unresolved: 0 },
      purposeSpendingCeilingCents: 6_000,
      differenceCents: 4_000,
      validatedNestedAllocation: false,
    });
    // 关键:旧信封 10000 分没有被加进消费预算,也没有改写冻结目标。
    expect(view.summary?.consumptionBudgetCents).toBe(6_000);
    expect(view.targetsCents).toEqual({
      growth: 2_500,
      reserve: 1_500,
      essentials: 5_000,
      joy: 1_000,
    });
  });
});
