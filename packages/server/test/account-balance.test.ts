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
const REFUND = 'builtin-income-refund';
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
  readonly totalAssetsCents: number;
  readonly totalLiabilitiesCents: number;
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

  it('一笔退款让余额增加、本月收入增加，不再冲减支出（AC4，已修订）', async () => {
    await addTransaction({ type: 0, amountCents: 20_000, categoryId: FOOD, date: dayIn(0, 5) });
    const beforeRefund = await balances();
    const trendBefore = await monthlyTrend();

    await addTransaction({
      type: 1,
      amountCents: 8_000,
      categoryId: REFUND,
      date: dayIn(0, 6),
      isRefund: true,
    });

    const afterRefund = await balances();
    const trendAfter = await monthlyTrend();

    const before = balanceOf(beforeRefund, DEFAULT_ACCOUNT);
    const after = balanceOf(afterRefund, DEFAULT_ACCOUNT);

    // 钱回来了：余额高 8000。
    expect(after.balanceCents).toBe(before.balanceCents + 8_000);
    // 支出是毛口径：退款不再冲减。
    expect(after.expenseCents).toBe(before.expenseCents);
    // ……退款就是收入。这一条与上一条来自同一个函数，必须同时成立。
    expect(after.incomeCents).toBe(before.incomeCents + 8_000);
    expect(trendAfter.incomeCents).toBe(trendBefore.incomeCents + 8_000);
    expect(trendAfter.netExpenseCents).toBe(trendBefore.netExpenseCents);
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

// ---------------------------------------------------------------------------
// 两个真实场景：信用账户还款，以及群收款/垫付
// ---------------------------------------------------------------------------

/**
 * 信用卡/抖音月付这类**信用账户**：额度是负的资产。
 *
 * 这套用例存在的意义是把「还款不是支出」变成可执行的事实。如果还款被记成一笔支出，消费会被
 * 重复计一次（买的时候一次、还的时候又一次），而这是这类记账里最容易犯、也最难自己发现的错。
 */
describe('信用账户与还款', () => {
  it('买的时候按分类记支出，欠款就是账户余额的负数', async () => {
    const credit = await createAccount('抖音月付', -50_000);

    const before = await monthlyTrend();
    await addTransaction({
      type: 0,
      amountCents: 10_000,
      categoryId: FOOD,
      date: dayIn(0, 5),
      accountId: credit,
    });
    const after = await monthlyTrend();

    // 支出在**买的那一刻**就进了分类与预算，而不是等到还款。
    expect(after.netExpenseCents).toBe(before.netExpenseCents + 10_000);
    // 欠款 = 账户余额的负数：原本欠 500，现在欠 600。
    expect(balanceOf(await balances(), credit).balanceCents).toBe(-60_000);
  });

  it('还款是转账：欠款归零，但不会再多出一笔支出', async () => {
    const credit = await createAccount('抖音月付', -50_000);
    await addTransaction({
      type: 0,
      amountCents: 10_000,
      categoryId: FOOD,
      date: dayIn(0, 5),
      accountId: credit,
    });

    const spendBeforeRepayment = await monthlyTrend();

    // 从储蓄账户还掉全部 600 的欠款。
    const repayment = await app.inject({
      method: 'POST',
      url: '/api/v1/transfers',
      headers: authed(),
      payload: {
        fromAccountId: DEFAULT_ACCOUNT,
        toAccountId: credit,
        amountCents: 60_000,
        date: dayIn(0, 6),
        note: '还抖音月付',
      },
    });
    expect(repayment.statusCode, repayment.body).toBe(201);

    const body = await balances();
    // 信用账户归零，储蓄账户少了 600。
    expect(balanceOf(body, credit).balanceCents).toBe(0);
    expect(balanceOf(body, DEFAULT_ACCOUNT).balanceCents).toBe(-60_000);

    // 关键：还款**没有**产生新的支出。总支出仍然只是那 100。
    const spendAfterRepayment = await monthlyTrend();
    expect(spendAfterRepayment.netExpenseCents).toBe(spendBeforeRepayment.netExpenseCents);
    expect(spendAfterRepayment.netExpenseCents).toBe(10_000);
  });

  /**
   * 首页那张卡要回答三件事：我有多少、我欠多少、净下来多少。欠款报**正数**，界面才不用显示
   * 「欠款 −¥1,234」。
   */
  it('总额拆成资产与欠款，欠款报正数（首页卡片用这三项）', async () => {
    const bank = await createAccount('上海银行', 564_285);
    const credit = await createAccount('抖音月付', -50_000);

    const body = await balances();
    expect(body.totalAssetsCents).toBe(564_285);
    expect(body.totalLiabilitiesCents).toBe(50_000);
    expect(body.totalBalanceCents).toBe(564_285 - 50_000);
    // 净额必须等于两个部分之差——同一次计算里出来的，不能各算各的。
    expect(body.totalAssetsCents - body.totalLiabilitiesCents).toBe(body.totalBalanceCents);
    // 而这两项也正好是按账户余额的正负分出来的。
    expect(body.items.find((item) => item.accountId === bank)?.balanceCents).toBe(564_285);
    expect(body.items.find((item) => item.accountId === credit)?.balanceCents).toBe(-50_000);
  });

  it('没有欠款时资产等于净额、欠款为 0', async () => {
    await createAccount('上海银行', 100_000);
    const body = await balances();

    expect(body.totalLiabilitiesCents).toBe(0);
    expect(body.totalAssetsCents).toBe(body.totalBalanceCents);
    expect(body.totalAssetsCents).toBe(100_000);
    // 余额恰好为 0 的账户（seeded 默认账户）既不算资产也不算欠款。
    expect(body.items).toHaveLength(2);
  });

  it('欠款超过资产时净额为负，但两项各自仍是正数', async () => {
    await createAccount('上海银行', 10_000);
    await createAccount('信用卡', -60_000);
    const body = await balances();

    expect(body.totalAssetsCents).toBe(10_000);
    expect(body.totalLiabilitiesCents).toBe(60_000);
    expect(body.totalBalanceCents).toBe(-50_000);
  });

  it('两个信用账户各自独立还款（抖音和信用卡分开还）', async () => {
    const douyin = await createAccount('抖音月付', -30_000);
    const card = await createAccount('信用卡', -20_000);

    await app.inject({
      method: 'POST',
      url: '/api/v1/transfers',
      headers: authed(),
      payload: {
        fromAccountId: DEFAULT_ACCOUNT,
        toAccountId: douyin,
        amountCents: 30_000,
        date: dayIn(0, 6),
        note: '还抖音',
      },
    });
    // 只还了抖音，信用卡的欠款原样保留。
    const mid = await balances();
    expect(balanceOf(mid, douyin).balanceCents).toBe(0);
    expect(balanceOf(mid, card).balanceCents).toBe(-20_000);

    await app.inject({
      method: 'POST',
      url: '/api/v1/transfers',
      headers: authed(),
      payload: {
        fromAccountId: DEFAULT_ACCOUNT,
        toAccountId: card,
        amountCents: 20_000,
        date: dayIn(0, 7),
        note: '还信用卡',
      },
    });
    const end = await balances();
    expect(balanceOf(end, card).balanceCents).toBe(0);
    // 全程只有两笔还款（转账），没有任何收入或支出，所以总额就是两张卡的**初始欠款之和**：
    // −300 + −200。写成这个算式而不是一个算好的字面量——本文件里我已经因为手算期望值错过一次。
    expect(end.totalBalanceCents).toBe(-30_000 + -20_000);
    expect(balanceOf(end, DEFAULT_ACCOUNT).balanceCents).toBe(-30_000 - 20_000);
  });
});

/**
 * 群收款 / 垫付：你先把钱付了，之后别人把各自那份还给你。
 *
 * 机制上就是**退款**——一笔负的支出，永远不是收入。这条用例额外钉住一件不那么显然的事：
 * **钱回到哪个账户与原来从哪个账户付的可以不同**。你把 18.70 从微信付了，朋友用支付宝转你 15，
 * 那么这一行的账户要选**支付宝**，三个数字才会同时对。
 */
describe('群收款/垫付', () => {
  it('别人还你钱：记为收入，账户余额各归各位', async () => {
    const alipay = await createAccount('支付宝', 0);

    // 你先垫付 18.70，从默认账户出。
    await addTransaction({
      type: 0,
      amountCents: 1_870,
      categoryId: FOOD,
      date: dayIn(0, 5),
      note: '帮同事买午饭',
    });
    // 朋友把 15.00 还到**支付宝**（未必是你付款的那个账户）。
    await addTransaction({
      type: 1,
      amountCents: 1_500,
      categoryId: REFUND,
      date: dayIn(0, 6),
      note: '群收款',
      isRefund: true,
      accountId: alipay,
    });

    const trend = await monthlyTrend();
    // 支出是毛口径：18.70 全额算支出。
    expect(trend.netExpenseCents).toBe(1_870);
    // 别人还的钱就是收入。
    expect(trend.incomeCents).toBe(1_500);

    const body = await balances();
    // 付钱的账户确实少了 18.70（对它来说钱真的出去了）。
    expect(balanceOf(body, DEFAULT_ACCOUNT).balanceCents).toBe(-1_870);
    // 收钱的账户确实多了 15.00。
    expect(balanceOf(body, alipay).balanceCents).toBe(1_500);
    // 净资产减少的是你自己的那份。
    expect(body.totalBalanceCents).toBe(-370);
  });

  it('只收回一部分也成立（部分群收款）', async () => {
    await addTransaction({
      type: 0,
      amountCents: 10_000,
      categoryId: FOOD,
      date: dayIn(0, 5),
      note: '垫付聚餐',
    });
    await addTransaction({
      type: 1,
      amountCents: 2_500,
      categoryId: REFUND,
      date: dayIn(0, 6),
      note: '收回一份',
      isRefund: true,
    });
    await addTransaction({
      type: 1,
      amountCents: 2_500,
      categoryId: REFUND,
      date: dayIn(0, 7),
      note: '又收回一份',
      isRefund: true,
    });

    expect((await monthlyTrend()).netExpenseCents).toBe(10_000);
    expect((await monthlyTrend()).incomeCents).toBe(5_000);
  });
});
