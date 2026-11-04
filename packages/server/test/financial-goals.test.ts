/**
 * C4 手动存钱与投资进度 — 路由级行为测试(F08/F09, C4-01..C4-08)。
 *
 * 这些断言直接跑真实的 Fastify 实例 + 内存 SQLite(含 migration 020),钉住:
 *
 * 1. **记录余额只由确认记录决定**(C4-01/C4-02),账本/工资/转账/账户行完全不变;
 * 2. **整段历史逐步非负**(C4-04/C4-05):新增/编辑/删除失败时一行都不落,
 *    连重放登记也一起回滚;
 * 3. **重放语义**(C4-08):同 key 同请求返回原结果,同 key 不同请求 409;
 * 4. **起始值更正会重放历史**(改小或改晚都可能被拒),期间合计按 [from,to) 取。
 *
 * 固定时钟:`NOW` 之后的所有日期都是过去;未来日期必须被拒绝。
 */
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createBackup, restoreBackup, verifyBackup } from '../src/cli-db.js';
import { loadConfig } from '../src/config.js';
import { closeDatabase, initializeDatabase, type Db } from '../src/db/index.js';
import { SESSION_COOKIE } from '../src/plugins/auth.js';
import { AuthService } from '../src/services/auth-service.js';
import { salarySourceToken } from '../src/services/financial-planning-types.js';

const USERNAME = 'quiz';
const PASSWORD = 'correct horse battery staple';
const CSRF = { 'x-requested-with': 'fetch' } as const;
const BASE = '/api/v1/financial-goals';

/** 固定时钟:2026-10-29 10:00 UTC。 */
const NOW = Date.UTC(2026, 9, 29, 10, 0, 0);
const OPENING_AT = Date.UTC(2026, 0, 1); // 2026-01-01
const FEB_1 = Date.UTC(2026, 1, 1);
const MAR_1 = Date.UTC(2026, 2, 1);
const AUG_10 = Date.UTC(2026, 7, 10);
const AUG_20 = Date.UTC(2026, 7, 20);

interface GoalProgressView {
  readonly source: string;
  readonly openingCents: number;
  readonly openingAt: number;
  readonly depositCents: number;
  readonly withdrawalCents: number;
  readonly balanceCents: number;
  readonly targetState: string;
  readonly targetCents: number | null;
  readonly progressPercent: number | null;
  readonly gapCents: number | null;
  readonly surplusCents: number | null;
  readonly conditionalContributionCount: number | null;
  readonly essentialMonthlyCents: number | null;
  readonly targetMonths: number | null;
  readonly monthlyReferenceCents: number | null;
}

interface GoalEntryView {
  readonly id: string;
  readonly goal: string;
  readonly kind: string;
  readonly amountCents: number;
  readonly date: number;
  readonly note: string;
  readonly revision: number;
  readonly deletedAt: number | null;
}

interface GoalView {
  readonly contractVersion: number;
  readonly calculatedAt: number;
  readonly source: string;
  readonly revision: number;
  readonly state: string;
  readonly opening: {
    readonly reserve: { readonly openingCents: number; readonly openingAt: number } | null;
    readonly investment: { readonly openingCents: number; readonly openingAt: number } | null;
  };
  readonly progress: {
    readonly asOf: number;
    readonly reserve: GoalProgressView | null;
    readonly investment: GoalProgressView | null;
  };
  readonly window: {
    readonly from: number;
    readonly to: number;
    readonly entryCount: number;
    readonly reserve: {
      readonly depositCents: number;
      readonly withdrawalCents: number;
      readonly netAdditionsCents: number;
      readonly entryCount: number;
    };
    readonly investment: {
      readonly depositCents: number;
      readonly withdrawalCents: number;
      readonly netAdditionsCents: number;
      readonly entryCount: number;
    };
  } | null;
  readonly entry?: GoalEntryView | null;
}

interface EntryPageView {
  readonly revision: number;
  readonly items: readonly GoalEntryView[];
  readonly total: number;
  readonly limit: number;
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
}

let db: Db;
let app: FastifyInstance;
let cookie: string;

async function login(): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: CSRF,
    payload: { username: USERNAME, password: PASSWORD },
  });
  const found = (response.cookies as { name: string; value: string }[]).find(
    (c) => c.name === SESSION_COOKIE,
  );
  return found?.value as string;
}

function as(token: string) {
  return { Cookie: `${SESSION_COOKIE}=${token}` };
}

function authed(extra: Record<string, string> = {}) {
  return { ...CSRF, ...as(cookie), ...extra };
}

async function putOpening(body: Record<string, unknown>) {
  return app.inject({
    method: 'PUT',
    url: `${BASE}/opening`,
    headers: authed(),
    payload: body,
  });
}

async function postEntry(body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: `${BASE}/entries`,
    headers: authed(),
    payload: body,
  });
}

async function patchEntry(id: string, body: Record<string, unknown>) {
  return app.inject({
    method: 'PATCH',
    url: `${BASE}/entries/${id}`,
    headers: authed(),
    payload: body,
  });
}

async function deleteEntry(id: string, body: Record<string, unknown>) {
  return app.inject({
    method: 'DELETE',
    url: `${BASE}/entries/${id}`,
    headers: authed(),
    payload: body,
  });
}

async function getView(query = '') {
  return app.inject({ method: 'GET', url: `${BASE}${query}`, headers: as(cookie) });
}

async function listEntries(query = '') {
  return app.inject({ method: 'GET', url: `${BASE}/entries${query}`, headers: as(cookie) });
}

async function getOperation(operationId: string) {
  return app.inject({
    method: 'GET',
    url: `${BASE}/operations/${operationId}`,
    headers: as(cookie),
  });
}

/** 确认一个起始值并返回写入后的全局修订号。 */
async function confirmOpening(
  goal: 'reserve' | 'investment',
  openingCents: number,
  expectedRevision: number,
  openingAt = OPENING_AT,
): Promise<number> {
  const response = await putOpening({
    goal,
    openingCents,
    openingAt,
    expectedRevision,
    operationId: randomUUID(),
  });
  expect(response.statusCode).toBe(200);
  return (response.json() as GoalView).revision;
}

/** 记录一笔并通过 201 + 视图返回新条目与修订号。 */
async function record(
  body: {
    goal: 'reserve' | 'investment';
    kind: 'deposit' | 'withdrawal';
    amountCents: number;
    date: number;
    note?: string;
  },
  expectedRevision: number,
): Promise<{ view: GoalView; entry: GoalEntryView }> {
  const response = await postEntry({
    ...body,
    expectedRevision,
    operationId: randomUUID(),
  });
  expect(response.statusCode).toBe(201);
  const view = response.json() as GoalView;
  const entry = view.entry;
  if (entry === null || entry === undefined) throw new Error('write response must include the entry');
  return { view, entry };
}

function entryCount(): number {
  const row = db.prepare('SELECT COUNT(*) AS c FROM manual_goal_entries').get() as { c: number };
  return row.c;
}

function operationCount(): number {
  const row = db.prepare('SELECT COUNT(*) AS c FROM manual_goal_operations').get() as { c: number };
  return row.c;
}

function currentRevision(): number {
  const row = db.prepare('SELECT revision FROM manual_goal_state WHERE id = 1').get() as
    | { revision: number }
    | undefined;
  return row?.revision ?? 0;
}

beforeEach(async () => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeDatabase(db, null);

  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    JIZHANG_USERNAME: USERNAME,
    JIZHANG_PASSWORD_HASH: 'unused',
    DATA_DIR: './data',
  });
  const authService = new AuthService(db, {
    sessionTtlDays: config.sessionTtlDays,
    now: () => NOW,
  });
  await authService.setPassword(USERNAME, PASSWORD);

  app = buildApp({
    config,
    db,
    authService,
    secureCookies: false,
    now: () => NOW,
  });
  await app.ready();
  cookie = await login();
});

afterEach(async () => {
  await app.close();
  closeDatabase(db);
});

describe('auth and empty state', () => {
  it('requires a session and the CSRF header', async () => {
    const anonymous = await app.inject({ method: 'GET', url: BASE });
    expect(anonymous.statusCode).toBe(401);

    const noCsrf = await app.inject({
      method: 'POST',
      url: `${BASE}/entries`,
      headers: as(cookie),
      payload: { goal: 'reserve', kind: 'deposit', amountCents: 100, date: AUG_10, operationId: randomUUID(), expectedRevision: 0 },
    });
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json()).toMatchObject({ error: { code: 'CSRF_REQUIRED' } });
  });

  it('reports not-configured instead of fabricated zero progress', async () => {
    const response = await getView();
    expect(response.statusCode).toBe(200);
    const view = response.json() as GoalView;
    expect(view.source).toBe('manual-confirmed');
    expect(view.state).toBe('not-configured');
    expect(view.revision).toBe(0);
    expect(view.opening.reserve).toBeNull();
    expect(view.opening.investment).toBeNull();
    expect(view.progress.reserve).toBeNull();
    expect(view.progress.investment).toBeNull();
    expect(view.window).toBeNull();
  });

  it('rejects an entry before any opening exists', async () => {
    const response = await postEntry({
      goal: 'reserve',
      kind: 'deposit',
      amountCents: 1000,
      date: AUG_10,
      expectedRevision: 0,
      operationId: randomUUID(),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'FINANCIAL_INVALID' } });
    expect(entryCount()).toBe(0);
  });
});

describe('C4-01 reserve progress is manual only', () => {
  it('12000 + 1500 - 1000 = 12500 and leaves the ledger untouched', async () => {
    const balancesBefore = db
      .prepare('SELECT id, initial_balance_cents FROM accounts ORDER BY id')
      .all() as { id: string; initial_balance_cents: number }[];

    let revision = await confirmOpening('reserve', 12000, 0);
    const deposit = await record(
      { goal: 'reserve', kind: 'deposit', amountCents: 1500, date: AUG_10, note: '工资后存入' },
      revision,
    );
    revision = deposit.view.revision;
    expect(deposit.view.progress.reserve?.balanceCents).toBe(13500);

    const withdrawal = await record(
      { goal: 'reserve', kind: 'withdrawal', amountCents: 1000, date: AUG_20, note: '修车' },
      revision,
    );
    expect(withdrawal.view.progress.reserve?.balanceCents).toBe(12500);
    expect(withdrawal.view.progress.reserve?.openingCents).toBe(12000);
    expect(withdrawal.view.progress.reserve?.depositCents).toBe(1500);
    expect(withdrawal.view.progress.reserve?.withdrawalCents).toBe(1000);
    expect(withdrawal.view.source).toBe('manual-confirmed');
    expect(withdrawal.view.calculatedAt).toBe(NOW);

    const view = (await getView()).json() as GoalView;
    expect(view.progress.reserve?.balanceCents).toBe(12500);
    expect(view.opening.reserve).toMatchObject({
      openingCents: 12000,
      openingAt: OPENING_AT,
    });

    // 不写账本 / 工资 / 转账 / 账户余额:
    const counts = db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM transactions) AS transactions,
                (SELECT COUNT(*) FROM salary_records) AS salaries,
                (SELECT COUNT(*) FROM transfers) AS transfers`,
      )
      .get() as { transactions: number; salaries: number; transfers: number };
    expect(counts).toEqual({ transactions: 0, salaries: 0, transfers: 0 });
    const balancesAfter = db
      .prepare('SELECT id, initial_balance_cents FROM accounts ORDER BY id')
      .all() as { id: string; initial_balance_cents: number }[];
    expect(balancesAfter).toEqual(balancesBefore);
  });

  it('C4-02 investment tracks principal only: 5000 + 2500 - 1000 = 6500', async () => {
    let revision = await confirmOpening('investment', 5000, 0);
    revision = (
      await record(
        { goal: 'investment', kind: 'deposit', amountCents: 2500, date: AUG_10 },
        revision,
      )
    ).view.revision;
    const returned = await record(
      { goal: 'investment', kind: 'withdrawal', amountCents: 1000, date: AUG_20 },
      revision,
    );
    const investment = returned.view.progress.investment;
    expect(investment?.balanceCents).toBe(6500);
    expect(investment?.depositCents).toBe(2500);
    expect(investment?.withdrawalCents).toBe(1000);
    expect(investment?.targetState).toBe('not-applicable');
    expect(investment?.targetCents).toBeNull();
    expect(investment?.progressPercent).toBeNull();
    expect(investment?.conditionalContributionCount).toBeNull();
    // 投资与应急各自独立,不会互相加总。
    expect(returned.view.progress.reserve).toBeNull();
  });
});

describe('C4-04 invalid values are rejected without writing', () => {
  it.each([
    ['negative', -100],
    ['zero', 0],
    ['fractional', 100.5],
  ] as const)('rejects a %s amount', async (_label, amountCents) => {
    const revision = await confirmOpening('reserve', 12000, 0);
    const response = await postEntry({
      goal: 'reserve',
      kind: 'deposit',
      amountCents,
      date: AUG_10,
      expectedRevision: revision,
      operationId: randomUUID(),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'FINANCIAL_INVALID' } });
    expect(entryCount()).toBe(0);
    expect(currentRevision()).toBe(revision);
  });

  it('rejects a future date and a date before the confirmed opening', async () => {
    const revision = await confirmOpening('reserve', 12000, 0);
    const future = await postEntry({
      goal: 'reserve',
      kind: 'deposit',
      amountCents: 1000,
      date: NOW + 86_400_000,
      expectedRevision: revision,
      operationId: randomUUID(),
    });
    expect(future.statusCode).toBe(400);
    expect(future.json()).toMatchObject({ error: { code: 'FINANCIAL_INVALID' } });

    const beforeOpening = await postEntry({
      goal: 'reserve',
      kind: 'deposit',
      amountCents: 1000,
      date: OPENING_AT - 1,
      expectedRevision: revision,
      operationId: randomUUID(),
    });
    expect(beforeOpening.statusCode).toBe(400);
    expect(beforeOpening.json()).toMatchObject({ error: { code: 'FINANCIAL_INVALID' } });
    expect(entryCount()).toBe(0);
  });

  it('rejects a withdrawal larger than the recorded balance, keeping the key and rows clean', async () => {
    const revision = await confirmOpening('reserve', 12000, 0);
    const operationId = randomUUID();
    const response = await postEntry({
      goal: 'reserve',
      kind: 'withdrawal',
      amountCents: 12001,
      date: AUG_10,
      expectedRevision: revision,
      operationId,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'FINANCIAL_GOAL_HISTORY_CONFLICT' } });
    expect(entryCount()).toBe(0);
    // 只有 PUT /opening 的那条重放记录;被拒绝的写入没有留下任何痕迹。
    expect(operationCount()).toBe(1);
    expect(currentRevision()).toBe(revision);
    // 失败的校验不消耗 operationId:同一个 key 换成一笔合法记录可以成功。
    const retry = await postEntry({
      goal: 'reserve',
      kind: 'withdrawal',
      amountCents: 12000,
      date: AUG_10,
      expectedRevision: revision,
      operationId,
    });
    expect(retry.statusCode).toBe(201);
  });

  it('rejects a stale expectedRevision', async () => {
    await confirmOpening('reserve', 12000, 0);
    const stale = await postEntry({
      goal: 'reserve',
      kind: 'deposit',
      amountCents: 100,
      date: AUG_10,
      expectedRevision: 0,
      operationId: randomUUID(),
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: { code: 'FINANCIAL_REVISION_CONFLICT' } });
    expect(entryCount()).toBe(0);
  });
});

describe('C4-05 edits and deletes replay the whole history', () => {
  /** opening 1000, deposit 500, withdrawal 1200 → 余额 300(合法)。 */
  async function fundedScenario() {
    let revision = await confirmOpening('reserve', 1000, 0);
    const deposit = await record(
      { goal: 'reserve', kind: 'deposit', amountCents: 500, date: FEB_1 },
      revision,
    );
    revision = deposit.view.revision;
    const withdrawal = await record(
      { goal: 'reserve', kind: 'withdrawal', amountCents: 1200, date: MAR_1 },
      revision,
    );
    return { revision: withdrawal.view.revision, depositId: deposit.entry.id, withdrawalId: withdrawal.entry.id };
  }

  it('rejects an edit that leaves the later withdrawal unfunded, atomically', async () => {
    const { revision, depositId } = await fundedScenario();
    const rowsBefore = db.prepare('SELECT * FROM manual_goal_entries ORDER BY id').all();
    const response = await patchEntry(depositId, {
      amountCents: 100,
      expectedRevision: revision,
      operationId: randomUUID(),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'FINANCIAL_GOAL_HISTORY_CONFLICT' } });
    expect(db.prepare('SELECT * FROM manual_goal_entries ORDER BY id').all()).toEqual(rowsBefore);
    expect(currentRevision()).toBe(revision);
    expect(operationCount()).toBe(3); // opening + 2 entries, the rejected patch left nothing
  });

  it('rejects deleting the deposit that funds a later withdrawal', async () => {
    const { revision, depositId } = await fundedScenario();
    const response = await deleteEntry(depositId, {
      expectedRevision: revision,
      operationId: randomUUID(),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'FINANCIAL_GOAL_HISTORY_CONFLICT' } });
    const row = db
      .prepare('SELECT deleted_at FROM manual_goal_entries WHERE id = ?')
      .get(depositId) as { deleted_at: number | null };
    expect(row.deleted_at).toBeNull();
    expect(currentRevision()).toBe(revision);
  });

  it('accepts a funded edit, keeps revisions monotonic and soft deletes', async () => {
    const { revision, depositId, withdrawalId } = await fundedScenario();
    const edited = await patchEntry(depositId, {
      amountCents: 700,
      note: '补记',
      expectedRevision: revision,
      operationId: randomUUID(),
    });
    expect(edited.statusCode).toBe(200);
    const editedView = edited.json() as GoalView;
    expect(editedView.entry?.amountCents).toBe(700);
    expect(editedView.entry?.note).toBe('补记');
    expect(editedView.entry?.revision).toBe(2);
    expect(editedView.progress.reserve?.balanceCents).toBe(500);
    expect(editedView.revision).toBe(revision + 1);

    const deleted = await deleteEntry(withdrawalId, {
      expectedRevision: editedView.revision,
      operationId: randomUUID(),
    });
    expect(deleted.statusCode).toBe(200);
    const deletedView = deleted.json() as GoalView;
    expect(deletedView.entry?.deletedAt).toBe(NOW);
    expect(deletedView.progress.reserve?.balanceCents).toBe(1700);

    const page = (await listEntries()).json() as EntryPageView;
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(1);
    const withDeleted = (await listEntries('?includeDeleted=1')).json() as EntryPageView;
    expect(withDeleted.items).toHaveLength(2);
  });

  it('rejects editing a deleted or unknown entry', async () => {
    const { revision, withdrawalId } = await fundedScenario();
    const deleted = await deleteEntry(withdrawalId, {
      expectedRevision: revision,
      operationId: randomUUID(),
    });
    expect(deleted.statusCode).toBe(200);
    const after = deleted.json() as GoalView;
    const again = await patchEntry(withdrawalId, {
      amountCents: 100,
      expectedRevision: after.revision,
      operationId: randomUUID(),
    });
    expect(again.statusCode).toBe(404);

    const unknown = await deleteEntry('no-such-entry', {
      expectedRevision: after.revision,
      operationId: randomUUID(),
    });
    expect(unknown.statusCode).toBe(404);
  });
});

describe('opening changes replay the chronology', () => {
  it('rejects a smaller opening and a later opening that invalidate existing entries', async () => {
    let revision = await confirmOpening('reserve', 1000, 0);
    revision = (
      await record({ goal: 'reserve', kind: 'deposit', amountCents: 500, date: FEB_1 }, revision)
    ).view.revision;
    revision = (
      await record(
        { goal: 'reserve', kind: 'withdrawal', amountCents: 1400, date: MAR_1 },
        revision,
      )
    ).view.revision;
    expect(revision).toBe(3);

    const tooSmall = await putOpening({
      goal: 'reserve',
      openingCents: 100,
      openingAt: OPENING_AT,
      expectedRevision: revision,
      operationId: randomUUID(),
    });
    expect(tooSmall.statusCode).toBe(409);
    expect(tooSmall.json()).toMatchObject({ error: { code: 'FINANCIAL_GOAL_HISTORY_CONFLICT' } });

    const tooLate = await putOpening({
      goal: 'reserve',
      openingCents: 1000,
      openingAt: FEB_1 + 1,
      expectedRevision: revision,
      operationId: randomUUID(),
    });
    expect(tooLate.statusCode).toBe(409);
    expect(tooLate.json()).toMatchObject({ error: { code: 'FINANCIAL_GOAL_HISTORY_CONFLICT' } });

    const opening = db
      .prepare('SELECT opening_cents, opening_at, revision FROM manual_goal_openings WHERE goal = ?')
      .get('reserve') as { opening_cents: number; opening_at: number; revision: number };
    expect(opening).toEqual({ opening_cents: 1000, opening_at: OPENING_AT, revision: 1 });
    expect(currentRevision()).toBe(revision);

    // 900 仍然容得下 900+500−1400 = 0,所以这次更正被接受。
    const accepted = await putOpening({
      goal: 'reserve',
      openingCents: 900,
      openingAt: OPENING_AT,
      expectedRevision: revision,
      operationId: randomUUID(),
    });
    expect(accepted.statusCode).toBe(200);
    const acceptedView = accepted.json() as GoalView;
    expect(acceptedView.progress.reserve?.balanceCents).toBe(0);
    expect(acceptedView.revision).toBe(revision + 1);
  });

  it('rejects a future opening date', async () => {
    const response = await putOpening({
      goal: 'reserve',
      openingCents: 1000,
      openingAt: NOW + 1,
      expectedRevision: 0,
      operationId: randomUUID(),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'FINANCIAL_INVALID' } });
    expect(currentRevision()).toBe(0);
  });
});

describe('C4-08 operation replay', () => {
  it('replays an identical entry create without a second row or revision bump', async () => {
    const revision = await confirmOpening('reserve', 12000, 0);
    const operationId = randomUUID();
    const payload = {
      goal: 'reserve',
      kind: 'deposit',
      amountCents: 1500,
      date: AUG_10,
      note: '工资后存入',
      expectedRevision: revision,
      operationId,
    };
    const first = await postEntry(payload);
    expect(first.statusCode).toBe(201);
    const second = await postEntry(payload);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(entryCount()).toBe(1);
    expect(currentRevision()).toBe(revision + 1);

    const operation = await getOperation(operationId);
    expect(operation.statusCode).toBe(200);
    const stored = operation.json() as {
      operationId: string;
      method: string;
      resource: string;
      statusCode: number;
      response: GoalView;
      operation: { operationId: string };
    };
    expect(stored).toMatchObject({
      operationId,
      method: 'POST',
      resource: `${BASE}/entries`,
      statusCode: 201,
    });
    expect(stored.response.revision).toBe(revision + 1);
    expect(stored.operation.operationId).toBe(operationId);
  });

  it('returns 409 for the same key with a different payload', async () => {
    const revision = await confirmOpening('reserve', 12000, 0);
    const operationId = randomUUID();
    const first = await postEntry({
      goal: 'reserve',
      kind: 'deposit',
      amountCents: 1500,
      date: AUG_10,
      expectedRevision: revision,
      operationId,
    });
    expect(first.statusCode).toBe(201);

    const conflict = await postEntry({
      goal: 'reserve',
      kind: 'deposit',
      amountCents: 1600,
      date: AUG_10,
      expectedRevision: revision,
      operationId,
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: { code: 'FINANCIAL_OPERATION_MISMATCH' } });
    expect(entryCount()).toBe(1);
  });

  it('replays an opening confirmation and resolves unknown operations with 404', async () => {
    const operationId = randomUUID();
    const payload = {
      goal: 'reserve',
      openingCents: 12000,
      openingAt: OPENING_AT,
      expectedRevision: 0,
      operationId,
    };
    const first = await putOpening(payload);
    expect(first.statusCode).toBe(200);
    // 第二次提交时 expectedRevision 已经过期,但仍然必须命中重放而不是 409。
    const second = await putOpening(payload);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(currentRevision()).toBe(1);

    const unknown = await getOperation(randomUUID());
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('replays patchEntry and deleteEntry even after the record is soft-deleted', async () => {
    let revision = await confirmOpening('reserve', 12000, 0);
    const createRes = await postEntry({
      goal: 'reserve',
      kind: 'deposit',
      amountCents: 1500,
      date: AUG_10,
      expectedRevision: revision,
      operationId: randomUUID(),
    });
    const entryId = (createRes.json() as GoalView).entry!.id;
    revision = (createRes.json() as GoalView).revision;

    // PATCH replay with sparse payload
    const patchOpId = randomUUID();
    const patchPayload = {
      note: '修改后的备注',
      expectedRevision: revision,
      operationId: patchOpId,
    };
    const patchFirst = await patchEntry(entryId, patchPayload);
    expect(patchFirst.statusCode).toBe(200);
    revision = (patchFirst.json() as GoalView).revision;

    // DELETE
    const deleteOpId = randomUUID();
    const deletePayload = {
      expectedRevision: revision,
      operationId: deleteOpId,
    };
    const deleteFirst = await deleteEntry(entryId, deletePayload);
    expect(deleteFirst.statusCode).toBe(200);

    // Replay DELETE -> must return 200 with same body, not 404
    const deleteSecond = await deleteEntry(entryId, deletePayload);
    expect(deleteSecond.statusCode).toBe(200);
    expect(deleteSecond.json()).toEqual(deleteFirst.json());

    // Replay PATCH -> must return 200 with same body, not 404
    const patchSecond = await patchEntry(entryId, patchPayload);
    expect(patchSecond.statusCode).toBe(200);
    expect(patchSecond.json()).toEqual(patchFirst.json());
  });

  it('replays with special characters in note, rejects conflicting payload with 409, and atomic rollback on overdraft preserves all tables', async () => {
    const revision = await confirmOpening('reserve', 10000, 0);
    const initialAccounts = db.prepare('SELECT COUNT(*) AS c FROM accounts').get() as { c: number };
    const initialTransactions = db.prepare('SELECT COUNT(*) AS c FROM transactions').get() as { c: number };
    const initialSalaries = db.prepare('SELECT COUNT(*) AS c FROM salary_records').get() as { c: number };

    const specialNote = '特别备注："含引号"与\n换行符\t制表符 & 特殊符号 \\/ 结束';
    const operationId = randomUUID();
    const payload = {
      goal: 'reserve',
      kind: 'deposit',
      amountCents: 5000,
      date: AUG_10,
      note: specialNote,
      expectedRevision: revision,
      operationId,
    };

    // 1. First submission
    const first = await postEntry(payload);
    expect(first.statusCode).toBe(201);
    expect((first.json() as GoalView).entry?.note).toBe(specialNote);
    expect(entryCount()).toBe(1);
    expect(operationCount()).toBe(2); // opening + deposit

    // 2. Replay with identical special note
    const second = await postEntry(payload);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(entryCount()).toBe(1);
    expect(operationCount()).toBe(2);

    // 3. Same key with different payload -> 409
    const conflict = await postEntry({
      ...payload,
      amountCents: 6000,
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: { code: 'FINANCIAL_OPERATION_MISMATCH' } });
    expect(entryCount()).toBe(1);
    expect(operationCount()).toBe(2);

    // 4. Overdraft attempt on entry deletion -> atomic rollback
    const entryId = (first.json() as GoalView).entry!.id;
    const revAfterFirst = currentRevision();

    // Add withdrawal: opening 10000 + deposit 5000 = 15000, withdraw 14000 -> balance 1000
    const withdrawRes = await postEntry({
      goal: 'reserve',
      kind: 'withdrawal',
      amountCents: 14000,
      date: AUG_20,
      expectedRevision: revAfterFirst,
      operationId: randomUUID(),
    });
    expect(withdrawRes.statusCode).toBe(201);
    const revAfterWithdraw = currentRevision();

    // Try to delete initial deposit -> causes overdraft
    const invalidDeleteOpId = randomUUID();
    const badDelete = await deleteEntry(entryId, {
      expectedRevision: revAfterWithdraw,
      operationId: invalidDeleteOpId,
    });
    expect(badDelete.statusCode).toBe(409);
    expect(badDelete.json()).toMatchObject({ error: { code: 'FINANCIAL_GOAL_HISTORY_CONFLICT' } });

    // Assert complete atomicity: revision untouched, entries count unchanged, rejected operation not stored
    expect(currentRevision()).toBe(revAfterWithdraw);
    expect(entryCount()).toBe(2);
    const rejectedOp = await getOperation(invalidDeleteOpId);
    expect(rejectedOp.statusCode).toBe(404);

    // Accounts, transactions, and salaries remain completely untouched
    expect((db.prepare('SELECT COUNT(*) AS c FROM accounts').get() as { c: number }).c).toBe(initialAccounts.c);
    expect((db.prepare('SELECT COUNT(*) AS c FROM transactions').get() as { c: number }).c).toBe(initialTransactions.c);
    expect((db.prepare('SELECT COUNT(*) AS c FROM salary_records').get() as { c: number }).c).toBe(initialSalaries.c);
  });
});

describe('selected-window totals and reserve targets', () => {
  it('reports period net additions over [from, to) and can be negative', async () => {
    let revision = await confirmOpening('reserve', 12000, 0);
    // 区间外(1 月 31 日)
    revision = (
      await record(
        { goal: 'reserve', kind: 'deposit', amountCents: 999, date: Date.UTC(2026, 0, 31) },
        revision,
      )
    ).view.revision;
    // 恰好等于 from(2 月 1 日)
    revision = (
      await record({ goal: 'reserve', kind: 'deposit', amountCents: 1500, date: FEB_1 }, revision)
    ).view.revision;
    // 区间内取出
    revision = (
      await record({ goal: 'reserve', kind: 'withdrawal', amountCents: 2000, date: MAR_1 - 1 }, revision)
    ).view.revision;
    // 恰好等于 to(3 月 1 日):不计入
    revision = (
      await record({ goal: 'reserve', kind: 'deposit', amountCents: 300, date: MAR_1 }, revision)
    ).view.revision;
    expect(revision).toBe(5);

    const response = await getView(`?from=${FEB_1}&to=${MAR_1}`);
    expect(response.statusCode).toBe(200);
    const view = response.json() as GoalView;
    expect(view.window).not.toBeNull();
    expect(view.window?.from).toBe(FEB_1);
    expect(view.window?.to).toBe(MAR_1);
    expect(view.window?.entryCount).toBe(2);
    expect(view.window?.reserve).toEqual({
      depositCents: 1500,
      withdrawalCents: 2000,
      netAdditionsCents: -500,
      entryCount: 2,
    });
    expect(view.window?.investment.entryCount).toBe(0);
    // 视图余额(cumulative)与期间净额分开; 历史区间以 min(now, to - 1) 为 asOf:
    expect(view.progress.asOf).toBe(MAR_1 - 1);
    expect(view.progress.reserve?.balanceCents).toBe(12000 + 999 + 1500 - 2000);
  });

  it('C4-06 historical window before opening date emits not-started and null balance', async () => {
    // Opening confirmed on FEB_1 (2026-02-01)
    await confirmOpening('reserve', 12000, 0, FEB_1);
    await confirmOpening('investment', 5000, 1, FEB_1);

    // Query historical window January: [2026-01-01, 2026-02-01) -> asOf is FEB_1 - 1, which is before opening
    const response = await getView(`?from=${OPENING_AT}&to=${FEB_1}`);
    expect(response.statusCode).toBe(200);
    const view = response.json() as GoalView;
    expect(view.progress.asOf).toBe(FEB_1 - 1);
    expect(view.progress.reserve?.targetState).toBe('not-started');
    expect(view.progress.reserve?.balanceCents).toBeNull();
    expect(view.progress.investment?.targetState).toBe('not-started');
    expect(view.progress.investment?.balanceCents).toBeNull();
  });

  it('requires from and to together and rejects an inverted window', async () => {
    await confirmOpening('reserve', 1000, 0);
    const onlyFrom = await getView(`?from=${FEB_1}`);
    expect(onlyFrom.statusCode).toBe(400);
    const inverted = await getView(`?from=${MAR_1}&to=${FEB_1}`);
    expect(inverted.statusCode).toBe(400);
    const noWindow = await getView();
    expect((noWindow.json() as GoalView).window).toBeNull();
  });

  function insertMockPeriod(
    periodId: string,
    groupMonth: string,
    cycleKey: string,
    start: number,
    end: number,
    reserveTarget: number,
    createdAt: number = NOW,
    includeLiveSalary = true,
  ) {
    db.prepare(
      `INSERT INTO financial_periods (id, group_month, cycle_key, active_revision, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)`,
    ).run(periodId, groupMonth, cycleKey, createdAt, createdAt);

    const windowJson = JSON.stringify({
      start,
      end,
      cycleKey,
      groupMonth,
      anchorSalaryId: `anchor-${periodId}`,
      groupingRule: 'financial-cycle-frozen-month-v1',
      timeZone: 'Asia/Shanghai',
      cycle: { kind: 'natural-month' },
      warnings: [],
    });

    const decisionJson = JSON.stringify({
      incomeCents: 10000,
      ratiosBps: { growth: 2500, reserve: reserveTarget, essentials: 5000, joy: 1000 },
      targets: { growth: 2500, reserve: reserveTarget, essentials: 5000, joy: 1000 },
    });

    let sourcesJson = '[]';
    if (includeLiveSalary) {
      const salaryId = `sal-${periodId}`;
      const salaryDate = start + 86400000; // 1 day after start
      const accountId = 'builtin-default-account';
      db.prepare(
        `INSERT INTO salary_records (id, amount_cents, date, note, deleted, updated_at, account_id)
         VALUES (?, 10000, ?, '工资', 0, ?, ?)`,
      ).run(salaryId, salaryDate, createdAt, accountId);

      const sourceToken = salarySourceToken({
        id: salaryId,
        amount_cents: 10000,
        date: salaryDate,
        account_id: accountId,
      });

      const snapshot = {
        salaryId,
        amountCents: 10000,
        date: salaryDate,
        accountId,
        sourceToken,
        confirmedAt: createdAt,
      };

      sourcesJson = JSON.stringify([snapshot]);

      db.prepare(
        `INSERT INTO financial_period_sources
           (period_id, salary_id, revision, active, snapshot_json, created_at, updated_at)
         VALUES (?, ?, 1, 1, ?, ?, ?)`,
      ).run(periodId, salaryId, JSON.stringify(snapshot), createdAt, createdAt);
    }

    db.prepare(
      `INSERT INTO financial_period_revisions
         (id, period_id, revision, group_month, cycle_key, window_json, decision_json,
          sources_json, warnings_json, reason, config_revision, mapping_revision,
          confirmed_income_cents, actor_id, operation_id, created_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, '[]', 'salary-confirmation', 1, 0, 10000, NULL, NULL, ?)`,
    ).run(
      `${periodId}-rev-1`,
      periodId,
      groupMonth,
      cycleKey,
      windowJson,
      decisionJson,
      sourcesJson,
      createdAt,
    );
  }

  it('computes target 25000, 48%, gap 13000 and 9 conditional contributions (C4-03)', async () => {
    // 启用财务配置：必要开支 5000，目标月数 5
    db.prepare(
      `INSERT INTO financial_config_revisions
         (id, revision, enabled, ratios_json, essential_monthly_cents, target_months,
          cycle_json, time_zone, actor_id, operation_id, created_at)
       VALUES (?, 1, 1, ?, 5000, 5, ?, 'Asia/Shanghai', NULL, NULL, ?)`,
    ).run(
      'config-1',
      JSON.stringify({ growth: 2500, reserve: 1500, essentials: 5000, joy: 1000 }),
      JSON.stringify({ kind: 'natural-month' }),
      NOW,
    );
    // 包含当前时刻 NOW (2026-10-29) 的当月已冻结周期：2026-10-01 ~ 2026-11-01
    const octFrom = Date.UTC(2026, 9, 1);
    const octTo = Date.UTC(2026, 10, 1);
    insertMockPeriod('period-oct', '2026-10', 'cc-2026-10', octFrom, octTo, 1500, NOW);

    const revision = await confirmOpening('reserve', 12000, 0);
    expect(revision).toBe(1);

    const view = (await getView()).json() as GoalView;
    const reserve = view.progress.reserve;
    expect(reserve?.targetState).toBe('ready');
    expect(reserve?.essentialMonthlyCents).toBe(5000);
    expect(reserve?.targetMonths).toBe(5);
    expect(reserve?.monthlyReferenceCents).toBe(1500);
    expect(reserve?.targetCents).toBe(25000);
    expect(reserve?.progressPercent).toBe(48);
    expect(reserve?.gapCents).toBe(13000);
    expect(reserve?.surplusCents).toBe(0);
    expect(reserve?.conditionalContributionCount).toBe(9);
  });

  it('historicalRevisionIsNotCurrentReserveReference: refuses historical September revision when current October is no-period', async () => {
    // 启用财务配置
    db.prepare(
      `INSERT INTO financial_config_revisions
         (id, revision, enabled, ratios_json, essential_monthly_cents, target_months,
          cycle_json, time_zone, actor_id, operation_id, created_at)
       VALUES (?, 1, 1, ?, 5000, 5, ?, 'Asia/Shanghai', NULL, NULL, ?)`,
    ).run(
      'config-1',
      JSON.stringify({ growth: 2500, reserve: 1500, essentials: 5000, joy: 1000 }),
      JSON.stringify({ kind: 'natural-month' }),
      NOW,
    );
    // 仅确认了 9 月周期 [2026-09-01, 2026-10-01)；NOW 为 2026-10-29，当月没有周期 (no-period)
    const sepFrom = Date.UTC(2026, 8, 1);
    const sepTo = Date.UTC(2026, 9, 1);
    insertMockPeriod('period-sep', '2026-09', 'cc-2026-09', sepFrom, sepTo, 1500, NOW + 1000);

    await confirmOpening('reserve', 12000, 0);
    const view = (await getView()).json() as GoalView;
    const reserve = view.progress.reserve;
    // 目标基线与缺口依然有效
    expect(reserve?.targetState).toBe('ready');
    expect(reserve?.targetCents).toBe(25000);
    expect(reserve?.gapCents).toBe(13000);
    // 但当月无周期 (no-period) 时，不得借用 9 月历史方案，月度参考与有条件月数必须为 null！
    expect(reserve?.monthlyReferenceCents).toBeNull();
    expect(reserve?.conditionalContributionCount).toBeNull();
  });

  it('keeps target and gap but refuses a count when no monthly reference is confirmed', async () => {
    db.prepare(
      `INSERT INTO financial_config_revisions
         (id, revision, enabled, ratios_json, essential_monthly_cents, target_months,
          cycle_json, time_zone, actor_id, operation_id, created_at)
       VALUES (?, 1, 1, ?, 5000, 5, ?, 'UTC', NULL, NULL, ?)`,
    ).run(
      'config-1',
      JSON.stringify({ growth: 2500, reserve: 1500, essentials: 5000, joy: 1000 }),
      JSON.stringify({ kind: 'natural-month' }),
      NOW,
    );
    await confirmOpening('reserve', 12000, 0);
    const reserve = ((await getView()).json() as GoalView).progress.reserve;
    expect(reserve?.targetCents).toBe(25000);
    expect(reserve?.gapCents).toBe(13000);
    expect(reserve?.monthlyReferenceCents).toBeNull();
    expect(reserve?.conditionalContributionCount).toBeNull();
  });

  it('returns a null target when no necessary baseline was confirmed', async () => {
    await confirmOpening('reserve', 12000, 0);
    const reserve = ((await getView()).json() as GoalView).progress.reserve;
    expect(reserve?.targetState).toBe('no-baseline');
    expect(reserve?.targetCents).toBeNull();
    expect(reserve?.gapCents).toBeNull();
    expect(reserve?.conditionalContributionCount).toBeNull();
    expect(reserve?.balanceCents).toBe(12000);
  });

  it('returns null monthly reference when config is disabled or reserve target is 0', async () => {
    // 1. Config disabled
    db.prepare(
      `INSERT INTO financial_config_revisions
         (id, revision, enabled, ratios_json, essential_monthly_cents, target_months,
          cycle_json, time_zone, actor_id, operation_id, created_at)
       VALUES (?, 1, 0, ?, 5000, 5, ?, 'Asia/Shanghai', NULL, NULL, ?)`,
    ).run(
      'config-disabled',
      JSON.stringify({ growth: 2500, reserve: 1500, essentials: 5000, joy: 1000 }),
      JSON.stringify({ kind: 'natural-month' }),
      NOW,
    );
    const octFrom = Date.UTC(2026, 9, 1);
    const octTo = Date.UTC(2026, 10, 1);
    insertMockPeriod('period-oct-dis', '2026-10', 'cc-2026-10', octFrom, octTo, 1500, NOW);

    await confirmOpening('reserve', 12000, 0);
    const reserveDis = ((await getView()).json() as GoalView).progress.reserve;
    expect(reserveDis?.monthlyReferenceCents).toBeNull();
    expect(reserveDis?.conditionalContributionCount).toBeNull();

    // 2. Reserve target is 0
    db.prepare(
      `UPDATE financial_config_revisions SET enabled = 1 WHERE id = 'config-disabled'`,
    ).run();
    db.prepare(
      `UPDATE financial_period_revisions SET decision_json = ? WHERE period_id = 'period-oct-dis'`,
    ).run(
      JSON.stringify({
        incomeCents: 10000,
        ratiosBps: { growth: 4000, reserve: 0, essentials: 5000, joy: 1000 },
        targets: { growth: 4000, reserve: 0, essentials: 5000, joy: 1000 },
      }),
    );
    const reserveZero = ((await getView()).json() as GoalView).progress.reserve;
    expect(reserveZero?.monthlyReferenceCents).toBe(0);
    expect(reserveZero?.conditionalContributionCount).toBeNull(); // gap > 0 but monthly reference is 0 -> cannot estimate
  });

  it('periodManualProgressUsesExactServerWindow: [from, to) includes from and to - 1 but strictly excludes to', async () => {
    let rev = await confirmOpening('reserve', 1200000, 0, FEB_1);
    rev = await confirmOpening('investment', 500000, rev, FEB_1);

    // from 上的记录 (FEB_1)
    rev = (await record({ goal: 'reserve', kind: 'deposit', amountCents: 150000, date: FEB_1 }, rev)).view.revision;
    rev = (await record({ goal: 'investment', kind: 'deposit', amountCents: 250000, date: FEB_1 }, rev)).view.revision;

    // to - 1 上的记录 (MAR_1 - 1)
    rev = (await record({ goal: 'reserve', kind: 'withdrawal', amountCents: 100000, date: MAR_1 - 1 }, rev)).view.revision;
    rev = (await record({ goal: 'investment', kind: 'withdrawal', amountCents: 100000, date: MAR_1 - 1 }, rev)).view.revision;

    // to 上的记录 (MAR_1): 必须被严格排除在外！
    rev = (await record({ goal: 'reserve', kind: 'deposit', amountCents: 999999, date: MAR_1 }, rev)).view.revision;
    await record({ goal: 'investment', kind: 'deposit', amountCents: 888888, date: MAR_1 }, rev);

    const res = await getView(`?from=${FEB_1}&to=${MAR_1}`);
    expect(res.statusCode).toBe(200);
    const view = res.json() as GoalView;

    // 窗口统计校验
    expect(view.window).not.toBeNull();
    expect(view.window?.from).toBe(FEB_1);
    expect(view.window?.to).toBe(MAR_1);
    expect(view.window?.entryCount).toBe(4); // reserve 2 + investment 2, to 处的两笔不计入

    expect(view.window?.reserve).toEqual({
      depositCents: 150000,
      withdrawalCents: 100000,
      netAdditionsCents: 50000,
      entryCount: 2,
    });
    expect(view.window?.investment).toEqual({
      depositCents: 250000,
      withdrawalCents: 100000,
      netAdditionsCents: 150000,
      entryCount: 2,
    });

    // 期间累计余额校验 (asOf = to - 1)
    expect(view.progress.asOf).toBe(MAR_1 - 1);
    expect(view.progress.reserve?.balanceCents).toBe(1250000); // 1200000 + 150000 - 100000
    expect(view.progress.investment?.balanceCents).toBe(650000); // 500000 + 250000 - 100000

    // 期间窗口下不展示当前预测
    expect(view.progress.reserve?.monthlyReferenceCents).toBeNull();
  });
});

describe('entries cursor paging', () => {
  it('pages with a bounded cursor without duplicates or gaps', async () => {
    let revision = await confirmOpening('reserve', 100000, 0);
    for (let index = 1; index <= 5; index++) {
      revision = (
        await record(
          {
            goal: 'reserve',
            kind: 'deposit',
            amountCents: 100 * index,
            date: Date.UTC(2026, 5, index),
          },
          revision,
        )
      ).view.revision;
    }

    const first = (await listEntries('?limit=2')).json() as EntryPageView;
    expect(first.items).toHaveLength(2);
    expect(first.total).toBe(5);
    expect(first.limit).toBe(2);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).not.toBeNull();

    const second = (
      await listEntries(`?limit=2&cursor=${encodeURIComponent(first.nextCursor ?? '')}`)
    ).json() as EntryPageView;
    expect(second.items).toHaveLength(2);
    expect(second.hasMore).toBe(true);

    const third = (
      await listEntries(`?limit=2&cursor=${encodeURIComponent(second.nextCursor ?? '')}`)
    ).json() as EntryPageView;
    expect(third.items).toHaveLength(1);
    expect(third.hasMore).toBe(false);
    expect(third.nextCursor).toBeNull();

    const ids = [...first.items, ...second.items, ...third.items].map((item) => item.id);
    expect(new Set(ids).size).toBe(5);
    // 倒序:最后一天的记录最先出现。
    expect(first.items[0]?.date).toBe(Date.UTC(2026, 5, 5));

    const filtered = (await listEntries('?goal=investment')).json() as EntryPageView;
    expect(filtered.items).toHaveLength(0);
    expect(filtered.total).toBe(0);

    const bounded = await listEntries('?limit=101');
    expect(bounded.statusCode).toBe(400);
    const badCursor = await listEntries('?cursor=not-a-cursor');
    expect(badCursor.statusCode).toBe(400);
  });

  it('soft-deleted entries are excluded from normal pagination and balances but discoverable via includeDeleted=true, and illegal deletion causing overdraft is rejected', async () => {
    let rev = await confirmOpening('reserve', 5000, 0);

    // Day 1: deposit 5000 (balance = 10000)
    const rec1 = await record(
      { goal: 'reserve', kind: 'deposit', amountCents: 5000, date: Date.UTC(2026, 6, 1) },
      rev,
    );
    rev = rec1.view.revision;
    const entry1Id = rec1.entry.id;

    // Day 2: withdrawal 8000 (balance = 2000)
    const rec2 = await record(
      { goal: 'reserve', kind: 'withdrawal', amountCents: 8000, date: Date.UTC(2026, 6, 2) },
      rev,
    );
    rev = rec2.view.revision;

    // Attempting to delete entry 1 (deposit of 5000) would cause Day 2 balance to become negative (-3000)
    const illegalDelete = await deleteEntry(entry1Id, {
      expectedRevision: rev,
      operationId: randomUUID(),
    });
    expect(illegalDelete.statusCode).toBe(409);
    expect(illegalDelete.json().error.code).toBe('FINANCIAL_GOAL_HISTORY_CONFLICT');

    // Day 3: deposit 10000 (balance = 12000)
    const rec3 = await record(
      { goal: 'reserve', kind: 'deposit', amountCents: 10000, date: Date.UTC(2026, 6, 3) },
      rev,
    );
    rev = rec3.view.revision;
    const entry3Id = rec3.entry.id;

    // Deleting entry 3 is legal (remaining balance remains >= 0)
    const legalDelete = await deleteEntry(entry3Id, {
      expectedRevision: rev,
      operationId: randomUUID(),
    });
    expect(legalDelete.statusCode).toBe(200);

    // Normal list excludes soft-deleted entry 3
    const normalList = (await listEntries()).json() as EntryPageView;
    expect(normalList.total).toBe(2);
    expect(normalList.items.map((i) => i.id)).not.toContain(entry3Id);

    // includeDeleted=true returns all 3 entries with deletedAt preserved
    const fullList = (await listEntries('?includeDeleted=true')).json() as EntryPageView;
    expect(fullList.total).toBe(3);
    const deletedItem = fullList.items.find((i) => i.id === entry3Id);
    expect(deletedItem).toBeDefined();
    expect(deletedItem?.deletedAt).not.toBeNull();

    // Current balance only counts live entries (5000 + 5000 - 8000 = 2000)
    const view = (await getView()).json() as GoalView;
    expect(view.progress.reserve?.balanceCents).toBe(2000);
  });
});

describe('C4-08 backup and restore integrity', () => {
  it('preserves manual goal openings, entries and operations across backup and restore', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'c4-backup-test-'));
    const liveDbFile = path.join(tempDir, 'live.db');
    const liveDb = new Database(liveDbFile);
    try {
      liveDb.pragma('journal_mode = WAL');
      liveDb.pragma('foreign_keys = ON');
      initializeDatabase(liveDb, null);

      const service = new (await import('../src/services/financial-goals-service.js')).FinancialGoalsService(
        liveDb,
        { now: () => NOW, actorId: 'user-1' },
      );

      service.putOpening({
        goal: 'reserve',
        openingCents: 12000,
        openingAt: OPENING_AT,
        expectedRevision: 0,
        operationId: randomUUID(),
      });

      service.createEntry({
        goal: 'reserve',
        kind: 'deposit',
        amountCents: 1500,
        date: AUG_10,
        note: '存入15',
        expectedRevision: 1,
        operationId: randomUUID(),
      });

      const backupsDir = path.join(tempDir, 'backups');
      const backupResult = createBackup(liveDbFile, backupsDir);
      expect(verifyBackup(backupResult.file).ok).toBe(true);

      const restoredDbFile = path.join(tempDir, 'restored.db');
      restoreBackup(backupResult.file, restoredDbFile);

      const restoredDb = new Database(restoredDbFile, { readonly: true });
      try {
        const openingRows = restoredDb.prepare('SELECT * FROM manual_goal_openings').all();
        expect(openingRows).toHaveLength(1);
        expect((openingRows[0] as { opening_cents: number }).opening_cents).toBe(12000);

        const entryRows = restoredDb.prepare('SELECT * FROM manual_goal_entries WHERE deleted_at IS NULL').all();
        expect(entryRows).toHaveLength(1);
        expect((entryRows[0] as { amount_cents: number }).amount_cents).toBe(1500);

        const opRows = restoredDb.prepare('SELECT * FROM manual_goal_operations').all();
        expect(opRows.length).toBeGreaterThanOrEqual(2);
      } finally {
        restoredDb.close();
      }
    } finally {
      liveDb.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

