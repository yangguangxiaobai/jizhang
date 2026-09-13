/**
 * 账户余额的验收测试（子任务 `09-13-account-balance`）。
 *
 * 这里钉住四件事：
 *
 * 1. **账户真的持有钱了**：初始资金、账单、工资都进到对应账户的余额里。
 * 2. **退款让余额增加，同时不算收入**（AC4）。两处断言写在同一个用例里，因为它们是同一条
 *    规则的两半 —— 只要有人把退款规则改成本地判断，这两半就会分头漂移。
 * 3. **工资必须指定账户**：缺失或指向不存在/已删除账户都是 400，不静默兜底（AC2）。
 * 4. **新端点受鉴权保护**（AC8）。
 *
 * 余额是**派生**的：这些用例全部通过接口读，不去数据库里找余额列 —— 因为没有这一列，
 * 而且 `db.test.ts` 有一条断言保证不会有。
 */
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { closeDatabase, initializeDatabase, type Db } from '../src/db/index.js';
import { SESSION_COOKIE } from '../src/plugins/auth.js';
import { AuthService } from '../src/services/auth-service.js';

const USERNAME = 'quiz';
const PASSWORD = 'correct horse battery staple';
const CSRF = { 'x-requested-with': 'fetch' } as const;

/** 2026 年 9 月 15 日中午：当月边界明确，不受"今天"影响。 */
const NOW = new Date(2026, 8, 15, 12, 0, 0).getTime();

const FOOD = 'builtin-expense-food';
const TRANSPORT = 'builtin-expense-transport';
const DEFAULT_ACCOUNT = 'builtin-default-account';

/** `offset` 个月后、`day` 号的本地时间戳。 */
function dayIn(monthOffset: number, day: number): number {
  const anchor = new Date(NOW);
  return new Date(anchor.getFullYear(), anchor.getMonth() + monthOffset, day).getTime();
}

let db: Db;
let app: FastifyInstance;
let cookie: string;

function authed() {
  return { ...CSRF, Cookie: `${SESSION_COOKIE}=${cookie}` };
}

interface BalanceItem {
  readonly accountId: string;
  readonly name: string;
  readonly type: number;
  readonly initialBalanceCents: number;
  readonly incomeCents: number;
  readonly expenseCents: number;
  readonly salaryCents: number;
  readonly balanceCents: number;
}

interface BalancesBody {
  readonly items: BalanceItem[];
  readonly totalBalanceCents: number;
}

async function balances(): Promise<BalancesBody> {
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/accounts/balances',
    headers: authed(),
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as BalancesBody;
}

function balanceOf(body: BalancesBody, accountId: string): BalanceItem {
  const found = body.items.find((item) => item.accountId === accountId);
  if (found === undefined) throw new Error(`no balance row for ${accountId}`);
  return found;
}

async function createAccount(name: string, initialBalanceCents: number): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/accounts',
    headers: authed(),
    payload: { name, type: 1, initialBalanceCents },
  });
  expect(response.statusCode, response.body).toBe(201);
  return (response.json() as { id: string }).id;
}

async function addTransaction(input: Record<string, unknown>): Promise<void> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/transactions',
    headers: authed(),
    payload: { accountId: DEFAULT_ACCOUNT, ...input },
  });
  expect(response.statusCode, response.body).toBe(201);
}

async function createSalary(payload: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/salaries',
    headers: authed(),
    payload,
  });
}

async function monthlyTrend(): Promise<{ incomeCents: number; netExpenseCents: number }> {
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/stats/monthly-trend?months=1',
    headers: authed(),
  });
  expect(response.statusCode, response.body).toBe(200);
  const body = response.json() as {
    items: { incomeCents: number; netExpenseCents: number }[];
  };
  const current = body.items[body.items.length - 1];
  if (current === undefined) throw new Error('monthly-trend returned no months');
  return current;
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

  app = buildApp({ config, db, authService, secureCookies: false, now: () => NOW });
  await app.ready();

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: CSRF,
    payload: { username: USERNAME, password: PASSWORD },
  });
  cookie = (login.cookies as { name: string; value: string }[]).find(
    (c) => c.name === SESSION_COOKIE,
  )?.value as string;
});

afterEach(async () => {
  await app.close();
  closeDatabase(db);
});

// ---------------------------------------------------------------------------
// 接口形状与初始资金
// ---------------------------------------------------------------------------

describe('GET /accounts/balances', () => {
  it('未带会话时返回 401（新端点必须在受保护的路由组里）', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/accounts/balances',
      headers: CSRF,
    });
    expect(response.statusCode).toBe(401);
  });

  it('没有任何流水时，余额就是初始资金之和', async () => {
    const bank = await createAccount('上海银行', 564_285);
    const body = await balances();

    expect(balanceOf(body, DEFAULT_ACCOUNT).balanceCents).toBe(0);
    expect(balanceOf(body, bank)).toMatchObject({
      name: '上海银行',
      initialBalanceCents: 564_285,
      incomeCents: 0,
      expenseCents: 0,
      salaryCents: 0,
      balanceCents: 564_285,
    });
    expect(body.totalBalanceCents).toBe(564_285);
  });

  it('总额等于各账户余额之和，账户顺序与账户列表一致', async () => {
    const bank = await createAccount('上海银行', 100_000);
    const wallet = await createAccount('钱包', 5_000);
    await addTransaction({ type: 0, amountCents: 1_000, categoryId: FOOD, date: dayIn(0, 10) });

    const body = await balances();
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/accounts',
      headers: authed(),
    });
    const listed = (list.json() as { items: { id: string }[] }).items.map((a) => a.id);

    expect(body.items.map((item) => item.accountId)).toEqual(listed);
    expect(body.totalBalanceCents).toBe(
      body.items.reduce((sum, item) => sum + item.balanceCents, 0),
    );
    expect(balanceOf(body, bank).balanceCents).toBe(100_000);
    expect(balanceOf(body, wallet).balanceCents).toBe(5_000);
    expect(body.totalBalanceCents).toBe(104_000);
  });

  it('支出从它所在的账户扣钱，不影响其它账户', async () => {
    const bank = await createAccount('上海银行', 100_000);
    await addTransaction({
      type: 0,
      amountCents: 12_000,
      categoryId: FOOD,
      date: dayIn(0, 10),
      accountId: bank,
    });

    const body = await balances();
    expect(balanceOf(body, bank)).toMatchObject({ expenseCents: 12_000, balanceCents: 88_000 });
    expect(balanceOf(body, DEFAULT_ACCOUNT).balanceCents).toBe(0);
  });

  it('收入账单进它所在的账户', async () => {
    await addTransaction({
      type: 1,
      amountCents: 7_500,
      categoryId: 'builtin-income-other',
      date: dayIn(0, 10),
    });

    const item = balanceOf(await balances(), DEFAULT_ACCOUNT);
    expect(item.incomeCents).toBe(7_500);
    expect(item.balanceCents).toBe(7_500);
  });

  it('一笔退款让余额增加、净支出减少，同时**不**改变本月收入（AC4）', async () => {
    await addTransaction({ type: 0, amountCents: 20_000, categoryId: FOOD, date: dayIn(0, 5) });
    const beforeRefund = await balances();
    const trendBefore = await monthlyTrend();

    await addTransaction({
      type: 0,
      amountCents: 8_000,
      categoryId: FOOD,
      date: dayIn(0, 6),
      isRefund: true,
    });

    const afterRefund = await balances();
    const trendAfter = await monthlyTrend();

    const before = balanceOf(beforeRefund, DEFAULT_ACCOUNT);
    const after = balanceOf(afterRefund, DEFAULT_ACCOUNT);

    // 钱回来了：余额高 8000，净支出低 8000。
    expect(after.balanceCents).toBe(before.balanceCents + 8_000);
    expect(after.expenseCents).toBe(before.expenseCents - 8_000);
    // ……但退款永远不是收入。这一条与上一条来自同一个函数，必须同时成立。
    expect(after.incomeCents).toBe(before.incomeCents);
    expect(trendAfter.incomeCents).toBe(trendBefore.incomeCents);
    expect(trendAfter.netExpenseCents).toBe(trendBefore.netExpenseCents - 8_000);
  });

  it('软删除账户后，它的余额退出资产表而历史账单仍在账本里（已定决策）', async () => {
    const wallet = await createAccount('微信', 49_12);
    await addTransaction({
      type: 0,
      amountCents: 1_000,
      categoryId: FOOD,
      date: dayIn(0, 10),
      accountId: wallet,
    });
    expect(balanceOf(await balances(), wallet).balanceCents).toBe(3_912);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/accounts/${wallet}`,
      headers: authed(),
    });
    expect(removed.statusCode).toBe(204);

    const after = await balances();
    expect(after.items.some((item) => item.accountId === wallet)).toBe(false);
    expect(after.totalBalanceCents).toBe(0);

    // 账单本身没有被删掉。
    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/transactions?accountId=${wallet}`,
      headers: authed(),
    });
    expect((list.json() as { total: number }).total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 工资必须指定账户
// ---------------------------------------------------------------------------

describe('salary account', () => {
  it('不带 accountId 时返回 400，并说明原因', async () => {
    const response = await createSalary({ amountCents: 1_000_000, date: dayIn(0, 5) });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: 'VALIDATION', message: expect.stringMatching(/accountId/i) },
    });
  });

  it('accountId 指向不存在的账户时返回 400', async () => {
    const response = await createSalary({
      amountCents: 1_000_000,
      date: dayIn(0, 5),
      accountId: 'no-such-account',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/Unknown or deleted account/);
  });

  it('accountId 指向已软删除的账户时返回 400', async () => {
    const wallet = await createAccount('临时账户', 0);
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/accounts/${wallet}`,
      headers: authed(),
    });

    const response = await createSalary({
      amountCents: 1_000_000,
      date: dayIn(0, 5),
      accountId: wallet,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/Unknown or deleted account/);
  });

  it('工资进指定账户，并出现在 DTO 里和那个账户的余额里', async () => {
    const bank = await createAccount('上海银行', 0);
    const created = await createSalary({
      amountCents: 1_000_000,
      date: dayIn(0, 5),
      accountId: bank,
    });
    expect(created.statusCode, created.body).toBe(201);
    expect((created.json() as { accountId: string }).accountId).toBe(bank);

    const body = await balances();
    const item = balanceOf(body, bank);
    // 工资记在 salaryCents 桶里，不混进 incomeCents —— 与 monthlyTrend 的口径一致。
    expect(item.salaryCents).toBe(1_000_000);
    expect(item.incomeCents).toBe(0);
    expect(item.balanceCents).toBe(1_000_000);
    expect(body.totalBalanceCents).toBe(1_000_000);
  });

  it('列出的工资记录也带 accountId', async () => {
    const bank = await createAccount('上海银行', 0);
    await createSalary({ amountCents: 1_000_000, date: dayIn(0, 5), accountId: bank });

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/salaries',
      headers: authed(),
    });
    const items = (list.json() as { items: { accountId: string }[] }).items;
    expect(items).toHaveLength(1);
    expect(items[0]?.accountId).toBe(bank);
  });

  it('编辑工资可以改收款账户，余额随之从旧账户挪到新账户（AC2）', async () => {
    const bank = await createAccount('上海银行', 0);
    const created = await createSalary({
      amountCents: 1_000_000,
      date: dayIn(0, 5),
      accountId: DEFAULT_ACCOUNT,
    });
    const id = (created.json() as { id: string }).id;
    expect(balanceOf(await balances(), DEFAULT_ACCOUNT).balanceCents).toBe(1_000_000);

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/salaries/${id}`,
      headers: authed(),
      payload: { accountId: bank },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect((patched.json() as { accountId: string }).accountId).toBe(bank);

    const body = await balances();
    expect(balanceOf(body, DEFAULT_ACCOUNT).balanceCents).toBe(0);
    expect(balanceOf(body, bank).balanceCents).toBe(1_000_000);
    // 换账户不创造钱。
    expect(body.totalBalanceCents).toBe(1_000_000);
  });

  it('改成不存在的账户返回 400，且余额不动', async () => {
    const created = await createSalary({
      amountCents: 1_000_000,
      date: dayIn(0, 5),
      accountId: DEFAULT_ACCOUNT,
    });
    const id = (created.json() as { id: string }).id;

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/salaries/${id}`,
      headers: authed(),
      payload: { accountId: 'no-such-account' },
    });
    expect(patched.statusCode).toBe(400);
    expect(balanceOf(await balances(), DEFAULT_ACCOUNT).balanceCents).toBe(1_000_000);
  });

  it('删除工资后，钱离开那个账户', async () => {
    const created = await createSalary({
      amountCents: 1_000_000,
      date: dayIn(0, 5),
      accountId: DEFAULT_ACCOUNT,
    });
    const id = (created.json() as { id: string }).id;

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/salaries/${id}`,
      headers: authed(),
    });
    expect(removed.statusCode).toBe(204);

    const body = await balances();
    expect(balanceOf(body, DEFAULT_ACCOUNT).balanceCents).toBe(0);
    expect(body.totalBalanceCents).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 跨口径一致性：余额与既有端点说的是同一件事
// ---------------------------------------------------------------------------

describe('余额与既有口径一致', () => {
  it('工资同时出现在账户余额和本月收入里，数字相同', async () => {
    const bank = await createAccount('上海银行', 0);
    await createSalary({ amountCents: 1_000_000, date: dayIn(0, 5), accountId: bank });
    await addTransaction({
      type: 1,
      amountCents: 20_000,
      categoryId: 'builtin-income-other',
      date: dayIn(0, 6),
      accountId: bank,
    });
    await addTransaction({ type: 0, amountCents: 30_000, categoryId: TRANSPORT, date: dayIn(0, 7), accountId: bank });

    const body = await balances();
    const item = balanceOf(body, bank);
    const trend = await monthlyTrend();

    // 收入 = 工资 + 收入账单，两处必须一致。
    expect(item.salaryCents + item.incomeCents).toBe(trend.incomeCents);
    // 支出也一样。
    expect(item.expenseCents).toBe(trend.netExpenseCents);
    // 而余额 = 初始 + 收入 + 工资 − 支出。
    expect(item.balanceCents).toBe(item.initialBalanceCents + trend.incomeCents - trend.netExpenseCents);
  });

  it('读取余额不会写入任何东西（同一个请求两次结果相同）', async () => {
    await addTransaction({ type: 0, amountCents: 5_000, categoryId: FOOD, date: dayIn(0, 3) });

    const first = await balances();
    const second = await balances();
    expect(second).toEqual(first);
  });
});
