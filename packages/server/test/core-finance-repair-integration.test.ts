/**
 * T14 全链路验收：固定合成账本跨域集成用例。
 *
 * 覆盖工资 → 确认月计划 → 消费 → 退款 → 统计 → 手动存投 → 平台导入的完整链路，
 * 断言各金额视图互不冒充：工资事实只 1 笔、消费预算独立于旧模板毛额、手动存投取自
 * 完整窗口数据、导入确认的去重分类计数不改变财务金额。
 */
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { closeDatabase, initializeDatabase, type Db } from '../src/db/index.js';
import { SESSION_COOKIE } from '../src/plugins/auth.js';
import { AuthService } from '../src/services/auth-service.js';
import { seedHistoricalSalary } from './support/historical-salary-fixture.js';
import { allocateSalaryCents } from '@jizhang/shared';

const USERNAME = 'repair-lead';
const PASSWORD = 'password-for-integration-repair';
const CSRF = { 'x-requested-with': 'fetch' };
const KEY = 'cc'.repeat(32);
/** 固定时钟：2026-10-29 12:00 Asia/Shanghai。 */
const NOW = Date.UTC(2026, 9, 29, 4, 0, 0);
const TIME_ZONE = 'Asia/Shanghai';
const API = '/api/v1';
const PLAN = `${API}/financial-planning`;
const OCT_SALARY_DATE = Date.UTC(2026, 9, 10, 4, 0, 0);
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const wechatCsv = readFileSync(join(FIXTURES, 'wechat-bill-sample.csv'));

describe('Core finance repair integration verification (T14 / R01-R20)', () => {
  let db: Db;
  let app: FastifyInstance;
  let cookie: string;
  let dataDir: string;

  function authHeaders() {
    return { ...CSRF, Cookie: `${SESSION_COOKIE}=${cookie}` };
  }

  async function call(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    payload?: Record<string, unknown>,
  ) {
    return app.inject({
      method,
      url,
      headers: authHeaders(),
      ...(payload === undefined ? {} : { payload }),
    });
  }

  async function getJson<T>(url: string): Promise<T> {
    const response = await call('GET', url);
    expect(response.statusCode, `${url}: ${response.body}`).toBe(200);
    return response.json() as T;
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

  async function putPlanConfig(): Promise<void> {
    const before = await getJson<{ config: { revision: number } }>(`${PLAN}/config`);
    const response = await call('PUT', `${PLAN}/config`, {
      operationId: randomUUID(),
      expectedRevision: before.config.revision,
      enabled: true,
      ratiosBps: { growth: 2500, reserve: 1500, essentials: 5000, joy: 1000 },
      essentialMonthlyCents: 5000,
      targetMonths: 5,
      cycle: { kind: 'natural-month' },
      timeZone: TIME_ZONE,
    });
    expect(response.statusCode, response.body).toBe(200);
  }

  async function putCategoryRules(essentialsId: string, joyId: string): Promise<void> {
    const before = await getJson<{ mapping: { revision: number; topologyToken: string } }>(
      `${PLAN}/category-rules`,
    );
    const response = await call('PUT', `${PLAN}/category-rules`, {
      operationId: randomUUID(),
      expectedRevision: before.mapping.revision,
      expectedTopologyToken: before.mapping.topologyToken,
      rules: [
        { categoryId: essentialsId, purpose: 'essentials' },
        { categoryId: joyId, purpose: 'joy' },
      ],
    });
    expect(response.statusCode, response.body).toBe(200);
  }

  async function createSalary(accountId: string, amountCents: number, date: number): Promise<{ id: string }> {
    // Seeded directly: fresh legacy salary writes are retired. The historical module
    // snapshot is part of the same fact and keeps the "won't be added to the fund view"
    // assertions meaningful.
    const template = db
      .prepare('SELECT modules_json FROM budget_templates WHERE is_default = 1 AND deleted = 0 LIMIT 1')
      .get() as { modules_json: string } | undefined;
    const modules =
      template === undefined
        ? []
        : (JSON.parse(template.modules_json) as { categoryId: string; ratio: number }[]);
    const { id } = seedHistoricalSalary(db, {
      amountCents,
      date,
      accountId,
      note: '集成测试工资',
      allocations: allocateSalaryCents(amountCents, modules),
    });
    return { id };
  }

  async function previewAndConfirm(salaryId: string, groupMonth: string): Promise<void> {
    const sources = await getJson<{ items: { salaryId: string; sourceToken: string }[] }>(
      `${PLAN}/sources/salaries?groupMonth=${encodeURIComponent(groupMonth)}&timeZone=${encodeURIComponent(TIME_ZONE)}`,
    );
    const found = sources.items.find((item) => item.salaryId === salaryId);
    expect(found, `salary source not found: ${salaryId}`).toBeDefined();
    const config = await getJson<{ config: { revision: number } }>(`${PLAN}/config`);
    const mapping = await getJson<{ mapping: { revision: number } }>(`${PLAN}/category-rules`);
    const proposal = {
      periodId: null,
      expectedRevision: 0,
      expectedConfigRevision: config.config.revision,
      expectedMappingRevision: mapping.mapping.revision,
      selectedSources: [{ salaryId: found!.salaryId, expectedSourceToken: found!.sourceToken }],
      mappingPolicy: 'preserve' as const,
      reason: 'salary-confirmation' as const,
    };
    const preview = await call('POST', `${PLAN}/periods/preview`, { proposal });
    expect(preview.statusCode, preview.body).toBe(200);
    const { preview: previewBody } = preview.json() as { preview: { previewToken: string } };
    const confirm = await call('POST', `${PLAN}/periods/confirm`, {
      operationId: randomUUID(),
      proposal,
      previewToken: previewBody.previewToken,
    });
    expect(confirm.statusCode, confirm.body).toBe(200);
  }

  async function createExpense(accountId: string, categoryId: string, amountCents: number): Promise<void> {
    const response = await call('POST', `${API}/transactions`, {
      type: 0,
      amountCents,
      categoryId,
      accountId,
      date: Date.UTC(2026, 9, 20, 4, 0, 0),
      note: '集成测试消费',
    });
    expect(response.statusCode, response.body).toBe(201);
  }

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'core-finance-repair-int-'));
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    initializeDatabase(db, null);
    const config = loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      JIZHANG_USERNAME: USERNAME,
      JIZHANG_PASSWORD_HASH: 'unused',
      JIZHANG_AI_ENCRYPTION_KEY: KEY,
      DATA_DIR: dataDir,
    });
    const auth = new AuthService(db, { sessionTtlDays: config.sessionTtlDays, now: () => NOW });
    await auth.setPassword(USERNAME, PASSWORD);
    app = buildApp({
      config,
      db,
      authService: auth,
      secureCookies: false,
      now: () => NOW,
      // 本用例路径不允许任何模型调用：一旦触发即失败。
      fetchImpl: (async () => {
        throw new Error('No AI provider call allowed in deterministic integration test');
      }) as unknown as typeof fetch,
    });
    await app.ready();
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: CSRF,
      payload: { username: USERNAME, password: PASSWORD },
    });
    cookie = login.cookies.find((entry) => entry.name === SESSION_COOKIE)?.value ?? '';
  });

  afterEach(async () => {
    await app.close();
    closeDatabase(db);
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('coreFinanceRepairKeepsOneSalaryAndDistinctMoneyViews', async () => {
    // ── 1. 准备账户/分类/计划配置与分类规则 ──────────────────────────────────
    const accountId = await createAccount('集成测试账户A');
    const essentialsId = await createCategory('集成测试必要', 0);
    const joyId = await createCategory('集成测试随心', 0);
    await putPlanConfig();
    await putCategoryRules(essentialsId, joyId);

    // ── 2. 工资 10000 元并明确纳入月计划 ────────────────────────────────────
    const salary = await createSalary(accountId, 10_000, OCT_SALARY_DATE);
    await previewAndConfirm(salary.id, '2026-10');

    // 工资事实只 1 笔（不生成第二笔普通收入）
    const salaries = await getJson<{ items: { id: string }[] }>(`${API}/salaries`);
    const salaryHits = salaries.items.filter((item) => item.id === salary.id);
    expect(salaryHits).toHaveLength(1);

    // ── 3. 消费 3200(必要) + 600(随心) ──────────────────────────────────────
    await createExpense(accountId, essentialsId, 3_200);
    await createExpense(accountId, joyId, 600);

    // ── 4. 读月计划：消费预算 6000 独立于旧模板毛额 10000 ───────────────────
    const plan = await getJson<{
      confirmedIncomeCents: number;
      targetsCents: { growth: number; reserve: number; essentials: number; joy: number };
      summary: { consumptionBudgetCents: number; confirmedNetSpentCents: number; remainingCents: number };
      purposes: { purpose: string; remainingCents: number }[];
    }>(`${API}/monthly-plan?groupMonth=2026-10&timeZone=${encodeURIComponent(TIME_ZONE)}`);

    expect(plan.confirmedIncomeCents).toBe(10_000);
    expect(plan.targetsCents).toEqual({ growth: 2_500, reserve: 1_500, essentials: 5_000, joy: 1_000 });
    expect(plan.summary).toMatchObject({
      consumptionBudgetCents: 6_000,
      confirmedNetSpentCents: 3_800,
      remainingCents: 2_200,
    });
    expect(plan.purposes.map((row) => [row.purpose, row.remainingCents])).toEqual([
      ['essentials', 1_800],
      ['joy', 400],
    ]);

    // ── 5. 手动存投：应急起始 12000，本期存 1500 / 取 1000 ──────────────────
    const opening = await call('PUT', `${API}/financial-goals/opening`, {
      operationId: randomUUID(),
      expectedRevision: 0,
      goal: 'reserve',
      openingCents: 12_000,
      // 窗口起点之前，保证起始值不落在本期窗口内
      openingAt: Date.UTC(2026, 8, 1, 0, 0, 0),
    });
    expect(opening.statusCode, opening.body).toBe(200);
    let revision = (opening.json() as { revision: number }).revision;

    const deposit = await call('POST', `${API}/financial-goals/entries`, {
      operationId: randomUUID(),
      expectedRevision: revision,
      goal: 'reserve',
      kind: 'deposit',
      amountCents: 1_500,
      date: Date.UTC(2026, 9, 15, 4, 0, 0),
      note: '本期存入',
    });
    expect(deposit.statusCode, deposit.body).toBe(201);
    revision = (deposit.json() as { revision: number }).revision;

    const withdrawal = await call('POST', `${API}/financial-goals/entries`, {
      operationId: randomUUID(),
      expectedRevision: revision,
      goal: 'reserve',
      kind: 'withdrawal',
      amountCents: 1_000,
      date: Date.UTC(2026, 9, 18, 4, 0, 0),
      note: '本期取出',
    });
    expect(withdrawal.statusCode, withdrawal.body).toBe(201);
    revision = (withdrawal.json() as { revision: number }).revision;

    // ── 6. 目标视图：asOf 余额 12500，本期净存入 500（来自完整窗口数据）─────
    const goals = await getJson<{
      revision: number;
      progress: { reserve: { balanceCents: number } };
    }>(`${API}/financial-goals`);
    expect(goals.revision).toBe(revision);
    expect(goals.progress.reserve.balanceCents).toBe(12_500);

    const window = await getJson<{
      window: { from: number; to: number; reserve: { netAdditionsCents: number } };
    }>(`${API}/financial-goals?from=${Date.UTC(2026, 9, 1, 0, 0, 0)}&to=${Date.UTC(2026, 10, 1, 0, 0, 0)}`);
    expect(window.window.reserve.netAdditionsCents).toBe(500);

    // ── 7. 纯人工平台导入（analyse=false，0 次模型调用）──────────────────────
    const conversation = await call('POST', `${API}/assistant/conversations`, { title: '集成测试导入' });
    const conversationId = (conversation.json() as { id: string }).id;
    const batchResponse = await call(
      'POST',
      `${API}/assistant/conversations/${conversationId}/import-batches`,
      {
        files: [{ fileName: 'wechat.csv', source: 'auto', fileBase64: wechatCsv.toString('base64') }],
        clientRequestId: randomUUID(),
        analyse: false,
      },
    );
    expect(batchResponse.statusCode, batchResponse.body).toBe(201);
    const batchId = (batchResponse.json() as { batch: { batchId: string } }).batch.batchId;
    const batch = (await getJson<{
      batch: { version: number; analysis: { analysisRevision: number }; viewRevision: string };
    }>(`${API}/assistant/conversations/${conversationId}/import-batches/${batchId}`)).batch;

    const rows = (await getJson<{
      items: { itemId: string; type: number; amountCents: number; existing: boolean; ignored: boolean; conflictKind: string | null }[];
    }>(`${API}/assistant/conversations/${conversationId}/import-batches/${batchId}/rows?limit=50`)).items;
    const selectedRows = rows
      .filter((row) => !row.existing && !row.ignored && row.amountCents > 0 && row.conflictKind === null && row.type === 0)
      .slice(0, 3);
    expect(selectedRows).toHaveLength(3);

    const assignments: Record<string, unknown> = {};
    for (const row of selectedRows) {
      assignments[row.itemId] = { kind: 'existing', categoryId: essentialsId };
    }
    const review = await call(
      'POST',
      `${API}/assistant/conversations/${conversationId}/import-batches/${batchId}/review`,
      {
        version: batch.version,
        analysisRevision: batch.analysis.analysisRevision,
        viewRevision: batch.viewRevision,
        selectedItemIds: selectedRows.map((row) => row.itemId),
        categoryAssignments: assignments,
        noteOverrides: {},
        approvedCategories: [],
        conflictDecisions: [],
      },
    );
    expect(review.statusCode, review.body).toBe(200);
    const reviewBody = review.json() as {
      reviewToken: string;
      summary: { categoriesToCreate: unknown[]; categoriesToReuse: unknown[] };
    };
    // 3 行共用 1 个既有分类：去重分类实体按 1 计，财务行仍按 3 计。
    expect(reviewBody.summary.categoriesToCreate).toHaveLength(0);
    expect(reviewBody.summary.categoriesToReuse).toHaveLength(1);

    const confirm = await call(
      'POST',
      `${API}/assistant/conversations/${conversationId}/import-batches/${batchId}/confirm`,
      {
        reviewToken: reviewBody.reviewToken,
        expectedVersion: batch.version,
        files: [{ fileIndex: 0, fileBase64: wechatCsv.toString('base64') }],
      },
    );
    expect(confirm.statusCode, confirm.body).toBe(200);
    const confirmed = (confirm.json() as {
      result: { inserted: number; categoriesCreated: number; categoriesReused: number };
    }).result;
    expect(confirmed.inserted).toBe(3);
    expect(confirmed.categoriesCreated).toBe(0);
    expect(confirmed.categoriesReused).toBe(1);

    // ── 8. 导入不改变工资与手动存投事实（金额视图互不冒充）──────────────────
    const salariesAfter = await getJson<{ items: { id: string }[] }>(`${API}/salaries`);
    expect(salariesAfter.items.filter((item) => item.id === salary.id)).toHaveLength(1);
    const goalsAfter = await getJson<{
      progress: { reserve: { balanceCents: number } };
    }>(`${API}/financial-goals`);
    expect(goalsAfter.progress.reserve.balanceCents).toBe(12_500);
  });
});
