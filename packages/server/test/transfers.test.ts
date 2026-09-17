/**
 * 转账的验收测试（子任务 `09-13-account-transfer`）。
 *
 * 本文件里最重要的一条是 **AC4**：同一份数据，记一笔转账前后，预算总额、结转池、本月收入、
 * 本月净支出、分类占比**逐字段相等**。转账是「搬钱」，不是赚钱也不是花钱。
 *
 * 这条能成立的原因是结构性的：转账在自己的表里，`budget-engine.ts` / `stats-service.ts` /
 * `routes/budget.ts` 一行都没改，所以「别忘了过滤转账」这个问题不存在。AC4 是用来证明这一点
 * 的断言，不是靠约定维持的。
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
const DEFAULT_ACCOUNT = 'builtin-default-account';

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

async function send(
  method: 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
) {
  return app.inject({
    method,
    url,
    headers: authed(),
    ...(payload === undefined ? {} : { payload }),
  });
}

async function getJson<T>(url: string): Promise<T> {
  const response = await app.inject({ method: 'GET', url, headers: authed() });
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as T;
}

async function createAccount(name: string, initialBalanceCents: number): Promise<string> {
  const response = await send('POST', '/api/v1/accounts', {
    name,
    type: 1,
    initialBalanceCents,
  });
  expect(response.statusCode, response.body).toBe(201);
  return (response.json() as { id: string }).id;
}

async function createTransfer(input: Record<string, unknown>) {
  return send('POST', '/api/v1/transfers', input);
}

interface TransferBody {
  id: string;
  fromAccountId: string;
  toAccountId: string;
  amountCents: number;
  date: number;
  note: string;
  updatedAt: number;
}

interface BalanceItem {
  accountId: string;
  transferInCents: number;
  transferOutCents: number;
  balanceCents: number;
}

async function balances(): Promise<{ items: BalanceItem[]; totalBalanceCents: number }> {
  return getJson('/api/v1/accounts/balances');
}

async function balanceOf(accountId: string): Promise<BalanceItem> {
  const body = await balances();
  const found = body.items.find((item) => item.accountId === accountId);
  if (found === undefined) throw new Error(`no balance row for ${accountId}`);
  return found;
}

/**
 * 所有**会计口径**端点的一次快照。
 *
 * AC4 就是「转账前后这个对象逐字段相等」。把这些端点列全很重要：只比一个的话，转账恰好没
 * 影响那一个、却影响另一个的情况就漏掉了。
 */
async function accountingSnapshot(): Promise<Record<string, unknown>> {
  const [trend, share, pool, overview] = await Promise.all([
    getJson('/api/v1/stats/monthly-trend?months=3'),
    getJson(`/api/v1/stats/category-share?from=${dayIn(-1, 1)}&to=${dayIn(1, 1)}`),
    getJson('/api/v1/stats/pool-trend'),
    getJson('/api/v1/budget/overview'),
  ]);
  return { trend, share, pool, overview };
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
// 鉴权：新增的 route plugin 必须真的在 extraRoutes 里
// ---------------------------------------------------------------------------

describe('转帐端点受会话保护', () => {
  it('五个端点在没有会话时全部 401', async () => {
    // 写端点必须带 CSRF 头才能测到**会话**守卫：CSRF 检查跑在鉴权之前，一个既没会话又没
    // CSRF 头的 POST 会答 403，那条断言就只证明了 CSRF 守卫。
    const attempts: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string }[] = [
      { method: 'GET', url: '/api/v1/transfers' },
      { method: 'GET', url: '/api/v1/transfers/some-id' },
      { method: 'POST', url: '/api/v1/transfers' },
      { method: 'PATCH', url: '/api/v1/transfers/some-id' },
      { method: 'DELETE', url: '/api/v1/transfers/some-id' },
    ];

    for (const attempt of attempts) {
      const response = await app.inject({ ...attempt, headers: CSRF });
      expect(response.statusCode, `${attempt.method} ${attempt.url}`).toBe(401);
    }
  });

  it('写端点缺 CSRF 头时 403（CSRF 检查在会话检查之前）', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transfers',
      headers: { Cookie: `${SESSION_COOKIE}=${cookie}` },
      payload: { amountCents: 1 },
    });
    expect(response.statusCode).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// AC2：拒绝矩阵
// ---------------------------------------------------------------------------

describe('转账校验', () => {
  let bank: string;

  beforeEach(async () => {
    bank = await createAccount('上海银行', 0);
  });

  const valid = (): Record<string, unknown> => ({
    fromAccountId: DEFAULT_ACCOUNT,
    toAccountId: bank,
    amountCents: 100_000,
    date: dayIn(0, 3),
  });

  it('接受一笔合法转账并返回 DTO', async () => {
    const response = await createTransfer(valid());
    expect(response.statusCode, response.body).toBe(201);
    const body = response.json() as TransferBody;
    expect(body).toMatchObject({
      fromAccountId: DEFAULT_ACCOUNT,
      toAccountId: bank,
      amountCents: 100_000,
      note: '',
    });
    expect(typeof body.id).toBe('string');
  });

  it('拒绝非正数或非整数金额', async () => {
    for (const amountCents of [0, -100, 1.5, Number.NaN, '100', undefined]) {
      const response = await createTransfer({ ...valid(), amountCents });
      expect(response.statusCode, String(amountCents)).toBe(400);
    }
    expect((await createTransfer({ ...valid(), amountCents: 0 })).json().error.message).toMatch(
      /positive integer/i,
    );
  });

  it('拒绝同一个账户转给自己', async () => {
    const response = await createTransfer({ ...valid(), toAccountId: DEFAULT_ACCOUNT });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/two different accounts/i);
  });

  it('拒绝不存在或已软删除的账户', async () => {
    const unknown = await createTransfer({ ...valid(), fromAccountId: 'no-such-account' });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().error.message).toMatch(/Unknown or deleted account/);

    const doomed = await createAccount('临时', 0);
    await send('DELETE', `/api/v1/accounts/${doomed}`);
    const deleted = await createTransfer({ ...valid(), toAccountId: doomed });
    expect(deleted.statusCode).toBe(400);
    expect(deleted.json().error.message).toMatch(/Unknown or deleted account/);
  });

  it('拒绝缺失的账户字段', async () => {
    const noFrom = await createTransfer({ ...valid(), fromAccountId: undefined });
    expect(noFrom.statusCode).toBe(400);
    expect(noFrom.json().error.message).toMatch(/fromAccountId is required/);

    const noTo = await createTransfer({ ...valid(), toAccountId: '  ' });
    expect(noTo.statusCode).toBe(400);
    expect(noTo.json().error.message).toMatch(/toAccountId is required/);
  });

  it('拒绝越界日期', async () => {
    const future = await createTransfer({ ...valid(), date: NOW + 30 * 86_400_000 });
    expect(future.statusCode).toBe(400);
    expect(future.json().error.message).toMatch(/future/);

    const ancient = await createTransfer({ ...valid(), date: Date.UTC(1999, 0, 1) });
    expect(ancient.statusCode).toBe(400);
    expect(ancient.json().error.message).toMatch(/before the year 2000/);

    const notANumber = await createTransfer({ ...valid(), date: 'yesterday' });
    expect(notANumber.statusCode).toBe(400);
  });

  /**
   * 备注的宽容度是**刻意与另两个记账写入方一致**的：`TransactionService.create` 与
   * `SalaryService.create` 都写成 `typeof note === 'string' ? note : ''`，也就是「没有备注」
   * 与「备注字段给错了类型」在新建时同样表示空备注；而 `update` 三个服务都拒绝非字符串。
   *
   * 规则本身是：金额、引用、日期严格；可选文本宽容。这条测试把这份一致性钉住——不是钉住
   * 「宽容」这个选择本身。
   */
  it('新建时非字符串备注等同于空备注，编辑时则拒绝（与账单/工资写入方一致）', async () => {
    const created = await createTransfer({ ...valid(), note: 42 });
    expect(created.statusCode, created.body).toBe(201);
    expect((created.json() as TransferBody).note).toBe('');

    const id = (created.json() as TransferBody).id;
    const patched = await send('PATCH', `/api/v1/transfers/${id}`, { note: 42 });
    expect(patched.statusCode).toBe(400);
    expect(patched.json().error.message).toMatch(/note must be a string/);
  });

  it('读取不存在的转账是 404，重复删除也是 404', async () => {
    const missing = await app.inject({
      method: 'GET',
      url: '/api/v1/transfers/no-such-id',
      headers: authed(),
    });
    expect(missing.statusCode).toBe(404);

    const created = await createTransfer(valid());
    const id = (created.json() as TransferBody).id;
    expect((await send('DELETE', `/api/v1/transfers/${id}`)).statusCode).toBe(204);
    expect((await send('DELETE', `/api/v1/transfers/${id}`)).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: `/api/v1/transfers/${id}`, headers: authed() }))
        .statusCode,
    ).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// AC3 / AC5 / AC6：余额位移
// ---------------------------------------------------------------------------

describe('转账只动余额', () => {
  let bank: string;

  beforeEach(async () => {
    bank = await createAccount('上海银行', 564_285);
  });

  it('转出减少、转入增加、总额完全不变（AC3）', async () => {
    const before = await balances();
    const created = await createTransfer({
      fromAccountId: DEFAULT_ACCOUNT,
      toAccountId: bank,
      amountCents: 100_000,
      date: dayIn(0, 3),
    });
    expect(created.statusCode, created.body).toBe(201);
    const after = await balances();

    const from = await balanceOf(DEFAULT_ACCOUNT);
    const to = await balanceOf(bank);
    expect(from).toMatchObject({ transferOutCents: 100_000, transferInCents: 0, balanceCents: -100_000 });
    expect(to).toMatchObject({ transferInCents: 100_000, transferOutCents: 0, balanceCents: 664_285 });
    expect(after.totalBalanceCents).toBe(before.totalBalanceCents);
  });

  it('删除转账后两个账户的余额精确还原（AC5）', async () => {
    const before = await balances();
    const created = await createTransfer({
      fromAccountId: bank,
      toAccountId: DEFAULT_ACCOUNT,
      amountCents: 12_345,
      date: dayIn(0, 4),
    });
    const id = (created.json() as TransferBody).id;
    expect((await balanceOf(bank)).balanceCents).toBe(564_285 - 12_345);

    expect((await send('DELETE', `/api/v1/transfers/${id}`)).statusCode).toBe(204);
    const restored = await balances();
    expect(restored).toEqual(before);
    expect((await balanceOf(bank)).balanceCents).toBe(564_285);
  });

  it('改金额或换账户时四个相关账户的余额都正确（AC6）', async () => {
    const wallet = await createAccount('钱包', 1_000);
    const created = await createTransfer({
      fromAccountId: DEFAULT_ACCOUNT,
      toAccountId: bank,
      amountCents: 50_000,
      date: dayIn(0, 3),
    });
    const id = (created.json() as TransferBody).id;

    // 换转入方 + 改金额：银行回到原值，钱包拿到新的金额。
    const patched = await send('PATCH', `/api/v1/transfers/${id}`, {
      toAccountId: wallet,
      amountCents: 7_000,
    });
    expect(patched.statusCode, patched.body).toBe(200);

    expect(await balanceOf(bank)).toMatchObject({ transferInCents: 0, balanceCents: 564_285 });
    expect(await balanceOf(wallet)).toMatchObject({ transferInCents: 7_000, balanceCents: 8_000 });
    expect(await balanceOf(DEFAULT_ACCOUNT)).toMatchObject({
      transferOutCents: 7_000,
      balanceCents: -7_000,
    });
    // 换账户、改金额都不创造钱。
    expect((await balances()).totalBalanceCents).toBe(564_285 + 1_000);
  });

  it('把转入方改成转出方自己被拒绝，且原纪录不动（AC6）', async () => {
    const created = await createTransfer({
      fromAccountId: DEFAULT_ACCOUNT,
      toAccountId: bank,
      amountCents: 50_000,
      date: dayIn(0, 3),
    });
    const id = (created.json() as TransferBody).id;

    const patched = await send('PATCH', `/api/v1/transfers/${id}`, {
      toAccountId: DEFAULT_ACCOUNT,
    });
    expect(patched.statusCode).toBe(400);

    const unchanged = await app.inject({
      method: 'GET',
      url: `/api/v1/transfers/${id}`,
      headers: authed(),
    });
    expect((unchanged.json() as TransferBody).toAccountId).toBe(bank);
  });
});

// ---------------------------------------------------------------------------
// AC4：对会计口径零影响（本任务的核心断言）
// ---------------------------------------------------------------------------

describe('转账不影响任何会计数字（AC4）', () => {
  let bank: string;

  beforeEach(async () => {
    bank = await createAccount('上海银行', 564_285);

    // 数据必须是非空的，否则「前后相等」是句空话。
    const salary = await app.inject({
      method: 'POST',
      url: '/api/v1/salaries',
      headers: authed(),
      payload: {
        accountId: DEFAULT_ACCOUNT,
        amountCents: 1_000_000,
        date: dayIn(0, 2),
        allocations: [
          { categoryId: FOOD, amountCents: 600_000 },
          { categoryId: 'builtin-expense-transport', amountCents: 400_000 },
        ],
      },
    });
    expect(salary.statusCode, salary.body).toBe(201);

    for (const [amountCents, day, isRefund] of [
      [150_000, 4, false],
      [40_000, 5, true],
      [90_000, 6, false],
    ] as const) {
      const txn = await app.inject({
        method: 'POST',
        url: '/api/v1/transactions',
        headers: authed(),
        payload: isRefund
          ? {
              type: 1,
              amountCents,
              categoryId: 'builtin-income-refund',
              accountId: DEFAULT_ACCOUNT,
              date: dayIn(0, day),
              isRefund: true,
            }
          : {
              type: 0,
              amountCents,
              categoryId: FOOD,
              accountId: DEFAULT_ACCOUNT,
              date: dayIn(0, day),
              isRefund: false,
            },
      });
      expect(txn.statusCode, txn.body).toBe(201);
    }
  });

  it('记一笔转账前后，所有口径端点逐字段相等', async () => {
    const before = await accountingSnapshot();

    const created = await createTransfer({
      fromAccountId: DEFAULT_ACCOUNT,
      toAccountId: bank,
      amountCents: 250_000,
      date: dayIn(0, 8),
      note: '提现',
    });
    expect(created.statusCode, created.body).toBe(201);

    const after = await accountingSnapshot();
    expect(after).toEqual(before);
  });

  it('转账不会出现在分类占比里，也不会变成一笔账单', async () => {
    await createTransfer({
      fromAccountId: DEFAULT_ACCOUNT,
      toAccountId: bank,
      amountCents: 250_000,
      date: dayIn(0, 8),
    });

    // 账单列表里没有它——转账只有自己的列表。
    const list = await getJson<{ total: number }>('/api/v1/transactions');
    expect(list.total).toBe(3);

    const share = await getJson<{ totalCents: number }>(
      `/api/v1/stats/category-share?from=${dayIn(-1, 1)}&to=${dayIn(1, 1)}`,
    );
    // 毛支出 = 150000 + 90000；退款 40000 是收入、不冲减支出，与转账无关。
    expect(share.totalCents).toBe(240_000);
  });
});

// ---------------------------------------------------------------------------
// 列表与过滤
// ---------------------------------------------------------------------------

describe('转账列表', () => {
  it('按日期倒序，支持分页', async () => {
    const bank = await createAccount('上海银行', 0);
    for (const day of [3, 5, 4]) {
      await createTransfer({
        fromAccountId: DEFAULT_ACCOUNT,
        toAccountId: bank,
        amountCents: day * 1_000,
        date: dayIn(0, day),
      });
    }

    const page = await getJson<{ items: TransferBody[]; total: number; limit: number }>(
      '/api/v1/transfers?limit=2',
    );
    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(2);
    expect(page.items.map((item) => item.amountCents)).toEqual([5_000, 4_000]);

    const second = await getJson<{ items: TransferBody[] }>('/api/v1/transfers?limit=2&offset=2');
    expect(second.items.map((item) => item.amountCents)).toEqual([3_000]);
  });

  it('accountId 过滤把两个方向都取回来', async () => {
    const bank = await createAccount('上海银行', 0);
    const wallet = await createAccount('钱包', 0);
    await createTransfer({
      fromAccountId: DEFAULT_ACCOUNT,
      toAccountId: bank,
      amountCents: 1_000,
      date: dayIn(0, 3),
    });
    await createTransfer({
      fromAccountId: bank,
      toAccountId: wallet,
      amountCents: 2_000,
      date: dayIn(0, 4),
    });
    await createTransfer({
      fromAccountId: wallet,
      toAccountId: DEFAULT_ACCOUNT,
      amountCents: 3_000,
      date: dayIn(0, 5),
    });

    const forBank = await getJson<{ items: TransferBody[]; total: number }>(
      `/api/v1/transfers?accountId=${bank}`,
    );
    expect(forBank.total).toBe(2);
    expect(forBank.items.map((item) => item.amountCents).sort()).toEqual([1_000, 2_000]);
  });

  it('软删除的转账不出现在列表里', async () => {
    const bank = await createAccount('上海银行', 0);
    const created = await createTransfer({
      fromAccountId: DEFAULT_ACCOUNT,
      toAccountId: bank,
      amountCents: 1_000,
      date: dayIn(0, 3),
    });
    const id = (created.json() as TransferBody).id;
    await send('DELETE', `/api/v1/transfers/${id}`);

    expect((await getJson<{ total: number }>('/api/v1/transfers')).total).toBe(0);
  });

  it('拒绝越界的 limit 与负 offset', async () => {
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/transfers?limit=0', headers: authed() }))
        .statusCode,
    ).toBe(400);
    expect(
      (await app.inject({
        method: 'GET',
        url: '/api/v1/transfers?limit=9999',
        headers: authed(),
      })).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/transfers?offset=-1', headers: authed() }))
        .statusCode,
    ).toBe(400);
  });
});
