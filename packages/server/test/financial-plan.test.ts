/**
 * 四用途财务规划的服务端契约测试(T14 / `spec/backend/financial-plan.md`)。
 *
 * 这些用例覆盖的是**服务端才有的风险**,而不是 shared 已经钉死的算术:
 *
 * 1. 鉴权与 CSRF:三个路由都在 auth 模块里,无会话必须 401、无 CSRF 头必须 403;
 * 2. 持久化与修订号 CAS:创建、更新、冲突、以及"上一次保存的重放"幂等;
 * 3. 预览只读:POST preview 不写任何 `settings` 行;
 * 4. 账本不变性:保存计划后 salary/transaction/transfer/template/allocation 行
 *    **逐字节**不变(计划是独立域,不是账本的一部分);
 * 5. 损坏信封 503 且**不被覆盖**——这是最容易写错、后果最重的一条;
 * 6. 其他 settings 键不受影响。
 */
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { closeDatabase, initializeDatabase, type Db } from '../src/db/index.js';
import { SESSION_COOKIE } from '../src/plugins/auth.js';
import { AuthService } from '../src/services/auth-service.js';
import { seedHistoricalSalary } from './support/historical-salary-fixture.js';
import { allocateSalaryCents } from '@jizhang/shared';
import { CYCLE_START_DAY_KEY } from '../src/services/salary-service.js';
import { FINANCIAL_PLAN_SETTINGS_KEY } from '../src/services/financial-plan-service.js';

const USERNAME = 'quiz';
const PASSWORD = 'correct horse battery staple';
const CSRF = { 'x-requested-with': 'fetch' } as const;

const NOW = Date.UTC(2026, 9, 26, 12, 0, 0);
const BASE = '/api/v1/financial-plan';

/** 验收数字:10000 收入 / 5000 必要支出 / 0 储备。 */
const ACCEPTANCE = {
  monthlyIncomeCents: 10000,
  essentialMonthlyCents: 5000,
  reserveBalanceCents: 0,
} as const;

let db: Db;
let app: FastifyInstance;
let cookie: string;
let clock = NOW;

async function login(): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: CSRF,
    payload: { username: USERNAME, password: PASSWORD },
  });
  return (response.cookies as { name: string; value: string }[]).find(
    (c) => c.name === SESSION_COOKIE,
  )?.value as string;
}

function authed(): Record<string, string> {
  return { ...CSRF, Cookie: `${SESSION_COOKIE}=${cookie}` };
}

async function get(url: string) {
  return app.inject({ method: 'GET', url, headers: authed() });
}

async function post(url: string, payload: unknown) {
  return app.inject({ method: 'POST', url, headers: authed(), payload: payload as object });
}

async function put(payload: unknown) {
  return app.inject({ method: 'PUT', url: BASE, headers: authed(), payload: payload as object });
}

/** 当前 `financial.plan.v1` 原始字符串,用于断言"没有写入"。 */
function rawPlanRow(): string | undefined {
  const row = db
    .prepare('SELECT value_json FROM settings WHERE key = ?')
    .get(FINANCIAL_PLAN_SETTINGS_KEY) as { value_json: string } | undefined;
  return row?.value_json;
}

/** 除计划键以外的所有 settings 行,用于"别的键没被动过"的断言。 */
function otherSettings(): unknown[] {
  return db
    .prepare('SELECT key, value_json, updated_at FROM settings WHERE key != ? ORDER BY key')
    .all(FINANCIAL_PLAN_SETTINGS_KEY);
}

/** 整张账本侧表的内容快照(行数与内容都算),用于不变性断言。 */
function ledgerSnapshot(): Record<string, unknown[]> {
  const snapshot: Record<string, unknown[]> = {};
  for (const table of [
    'salary_records',
    'budget_allocations',
    'budget_templates',
    'transactions',
    'transfers',
    'categories',
    'accounts',
    'tags',
    'recurring_rules',
  ]) {
    snapshot[table] = db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
  }
  return snapshot;
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
  const authService = new AuthService(db, { sessionTtlDays: config.sessionTtlDays, now: () => clock });
  await authService.setPassword(USERNAME, PASSWORD);

  app = buildApp({ config, db, authService, secureCookies: false, now: () => clock });
  await app.ready();
  cookie = await login();
});

afterEach(async () => {
  await app.close();
  closeDatabase(db);
});

// ---------------------------------------------------------------------------
// 鉴权 / CSRF
// ---------------------------------------------------------------------------

describe('financial plan — auth and CSRF', () => {
  it('rejects unauthenticated GET, POST preview and PUT with 401', async () => {
    // 只带 CSRF 头、故意不带 Cookie:否则这些断言只是在测 CSRF 守卫。
    const noSession = { 'x-requested-with': 'fetch' };

    for (const request of [
      { method: 'GET' as const, url: BASE },
      { method: 'POST' as const, url: `${BASE}/preview`, payload: ACCEPTANCE },
      { method: 'PUT' as const, url: BASE, payload: { ...ACCEPTANCE, expectedRevision: 0 } },
    ]) {
      const response = await app.inject({ ...request, headers: noSession });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
    }
  });

  it('rejects a mutating request without the CSRF header with 403', async () => {
    // 有会话但没有 X-Requested-With:CSRF 守卫在鉴权之后、路由之前。
    const withSessionOnly = { Cookie: `${SESSION_COOKIE}=${cookie}` };

    const preview = await app.inject({
      method: 'POST',
      url: `${BASE}/preview`,
      headers: withSessionOnly,
      payload: ACCEPTANCE,
    });
    expect(preview.statusCode).toBe(403);
    expect(preview.json()).toMatchObject({ error: { code: 'CSRF_REQUIRED' } });

    const save = await app.inject({
      method: 'PUT',
      url: BASE,
      headers: withSessionOnly,
      payload: { ...ACCEPTANCE, expectedRevision: 0 },
    });
    expect(save.statusCode).toBe(403);
  });

  it('leaves an unknown financial-plan subpath as a signed-in 404', async () => {
    const response = await get(`${BASE}/nope`);
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});

// ---------------------------------------------------------------------------
// GET — 空状态与读取
// ---------------------------------------------------------------------------

describe('GET /api/v1/financial-plan', () => {
  it('answers {plan:null} before anything is saved', async () => {
    const response = await get(BASE);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ plan: null });
  });

  it('answers no-store so a cached plan cannot outlive logout', async () => {
    const response = await get(BASE);
    expect(response.headers['cache-control']).toBe('no-store');
  });
});

// ---------------------------------------------------------------------------
// POST preview — 只读
// ---------------------------------------------------------------------------

describe('POST /api/v1/financial-plan/preview', () => {
  it('returns the acceptance analysis without writing anything', async () => {
    const before = otherSettings();

    const response = await post(`${BASE}/preview`, ACCEPTANCE);
    expect(response.statusCode).toBe(200);

    const { analysis } = response.json() as { analysis: Record<string, unknown> };
    expect(analysis['ruleVersion']).toBe(1);
    expect((analysis['allocations'] as { amountCents: number }[]).map((a) => a.amountCents)).toEqual([
      2500, 1500, 5000, 1000,
    ]);
    expect(analysis['reserveTargetCents']).toBe(25000);
    expect(analysis['reserveGapCents']).toBe(25000);
    expect(analysis['monthsToTarget']).toBe(17);

    // 关键:预览没有落盘,GET 仍然是空状态,别的 settings 键也没动。
    expect(rawPlanRow()).toBeUndefined();
    expect(otherSettings()).toEqual(before);
    expect((await get(BASE)).json()).toEqual({ plan: null });
  });

  it('does not disturb an already saved plan', async () => {
    await put({ ...ACCEPTANCE, expectedRevision: 0 });
    const saved = rawPlanRow();

    const preview = await post(`${BASE}/preview`, {
      monthlyIncomeCents: 999,
      essentialMonthlyCents: 1,
      reserveBalanceCents: 0,
    });
    expect(preview.statusCode).toBe(200);

    // 已保存内容和 updatedAt 都没变。
    expect(rawPlanRow()).toBe(saved);
  });

  it('rejects invalid input with 400 FINANCIAL_PLAN_INVALID', async () => {
    for (const bad of [
      { monthlyIncomeCents: 0, essentialMonthlyCents: 100, reserveBalanceCents: 0 },
      { monthlyIncomeCents: 100, essentialMonthlyCents: 0, reserveBalanceCents: 0 },
      { monthlyIncomeCents: 100, essentialMonthlyCents: 100, reserveBalanceCents: -1 },
      { monthlyIncomeCents: 10.5, essentialMonthlyCents: 100, reserveBalanceCents: 0 },
      { monthlyIncomeCents: '100', essentialMonthlyCents: 100, reserveBalanceCents: 0 },
      { monthlyIncomeCents: 100, essentialMonthlyCents: 100 },
      {},
    ]) {
      const response = await post(`${BASE}/preview`, bad);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'FINANCIAL_PLAN_INVALID' } });
    }
    expect(rawPlanRow()).toBeUndefined();
  });

  it('rejects a body whose derived target leaves the safe integer range', async () => {
    const response = await post(`${BASE}/preview`, {
      monthlyIncomeCents: 100,
      essentialMonthlyCents: Math.floor(Number.MAX_SAFE_INTEGER / 5) + 1,
      reserveBalanceCents: 0,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'FINANCIAL_PLAN_INVALID' } });
  });
});

// ---------------------------------------------------------------------------
// PUT — 创建 / 更新 / CAS
// ---------------------------------------------------------------------------

describe('PUT /api/v1/financial-plan', () => {
  it('creates revision 1 when expectedRevision is 0', async () => {
    const response = await put({ ...ACCEPTANCE, expectedRevision: 0 });
    expect(response.statusCode).toBe(200);

    const { plan } = response.json() as { plan: Record<string, unknown> };
    expect(plan['version']).toBe(1);
    expect(plan['revision']).toBe(1);
    expect(plan['updatedAt']).toBe(NOW);
    expect(plan['inputs']).toEqual(ACCEPTANCE);
    expect((plan['analysis'] as Record<string, unknown>)['reserveTargetCents']).toBe(25000);
  });

  it('round-trips through GET, recomputing the same analysis', async () => {
    const created = await put({ ...ACCEPTANCE, expectedRevision: 0 });
    const response = await get(BASE);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ plan: created.json().plan });
  });

  it('stores only the envelope — no derived money is persisted', async () => {
    await put({ ...ACCEPTANCE, expectedRevision: 0 });
    const stored = JSON.parse(rawPlanRow() as string) as Record<string, unknown>;

    expect(Object.keys(stored).sort()).toEqual(['inputs', 'revision', 'updatedAt', 'version']);
    // 派生字段一个都不许落盘,否则就出现了第二份会过期的真相。
    for (const derived of [
      'analysis',
      'allocations',
      'reserveTargetCents',
      'projection',
      'warnings',
      'monthsToTarget',
    ]) {
      expect(stored).not.toHaveProperty(derived);
    }
  });

  it('increments the revision on a CAS-matching update', async () => {
    await put({ ...ACCEPTANCE, expectedRevision: 0 });
    clock += 1000;

    const response = await put({
      monthlyIncomeCents: 20000,
      essentialMonthlyCents: 5000,
      reserveBalanceCents: 1000,
      expectedRevision: 1,
    });
    expect(response.statusCode).toBe(200);

    const { plan } = response.json() as { plan: Record<string, unknown> };
    expect(plan['revision']).toBe(2);
    expect(plan['updatedAt']).toBe(NOW + 1000);
    expect(plan['inputs']).toMatchObject({ monthlyIncomeCents: 20000 });
    // 收入变了,分配随之变化;目标只跟必要支出走,所以仍是 25000。
    expect(plan['analysis']).toMatchObject({ reserveTargetCents: 25000 });
  });

  it('rejects a stale revision with 409 and leaves the stored plan untouched', async () => {
    await put({ ...ACCEPTANCE, expectedRevision: 0 });
    const saved = rawPlanRow();

    const response = await put({
      monthlyIncomeCents: 30000,
      essentialMonthlyCents: 5000,
      reserveBalanceCents: 0,
      expectedRevision: 0,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'FINANCIAL_PLAN_CONFLICT' } });
    expect(rawPlanRow()).toBe(saved);
  });

  it('rejects updating when nothing has been saved yet with 409', async () => {
    const response = await put({ ...ACCEPTANCE, expectedRevision: 1 });
    expect(response.statusCode).toBe(409);
    expect(rawPlanRow()).toBeUndefined();
  });

  it('requires expectedRevision with 400', async () => {
    const response = await put(ACCEPTANCE);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'FINANCIAL_PLAN_INVALID' } });
    expect(rawPlanRow()).toBeUndefined();
  });

  it('rejects a negative or fractional expectedRevision with 400', async () => {
    for (const bad of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1', null]) {
      const response = await put({ ...ACCEPTANCE, expectedRevision: bad });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'FINANCIAL_PLAN_INVALID' } });
    }
  });

  it('rejects invalid inputs with 400 before writing', async () => {
    const response = await put({
      monthlyIncomeCents: -5,
      essentialMonthlyCents: 100,
      reserveBalanceCents: 0,
      expectedRevision: 0,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'FINANCIAL_PLAN_INVALID' } });
    expect(rawPlanRow()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 幂等重放 —— 只认"紧邻的前一个修订号 + 相同输入"
// ---------------------------------------------------------------------------

describe('PUT — uncertain-result replay', () => {
  it('returns the current plan for an exact re-send of the immediately previous revision', async () => {
    await put({ ...ACCEPTANCE, expectedRevision: 0 }); // → revision 1
    clock += 5000;
    await put({ ...ACCEPTANCE, expectedRevision: 1 }); // → revision 2, 输入相同

    const before = rawPlanRow();

    // 客户端超时重发它上一次的请求:expectedRevision 仍是 1,输入与当时完全一致。
    const replay = await put({ ...ACCEPTANCE, expectedRevision: 1 });
    expect(replay.statusCode).toBe(200);

    const { plan } = replay.json() as { plan: Record<string, unknown> };
    // 返回当前(revision 2),而不是再写一次。
    expect(plan['revision']).toBe(2);
    expect(plan['updatedAt']).toBe(NOW + 5000);
    expect(rawPlanRow()).toBe(before);
  });

  it('does NOT treat an arbitrarily older equal-input revision as a replay', async () => {
    await put({ ...ACCEPTANCE, expectedRevision: 0 }); // → 1
    await put({ ...ACCEPTANCE, expectedRevision: 1 }); // → 2
    await put({ ...ACCEPTANCE, expectedRevision: 2 }); // → 3

    // revision 1 是"更早"的,即使输入一样也不接受:它可能掩盖中间的真实修改。
    const stale = await put({ ...ACCEPTANCE, expectedRevision: 1 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: { code: 'FINANCIAL_PLAN_CONFLICT' } });
  });

  it('rejects a re-send of the previous revision when the inputs differ', async () => {
    await put({ ...ACCEPTANCE, expectedRevision: 0 }); // → 1
    clock += 1000;
    await put({
      monthlyIncomeCents: 20000,
      essentialMonthlyCents: 5000,
      reserveBalanceCents: 0,
      expectedRevision: 1,
    }); // → 2

    const before = rawPlanRow();
    const mismatch = await put({
      monthlyIncomeCents: 99999,
      essentialMonthlyCents: 5000,
      reserveBalanceCents: 0,
      expectedRevision: 1,
    });
    expect(mismatch.statusCode).toBe(409);
    expect(rawPlanRow()).toBe(before);
  });

  it('treats a changed reserve alone as a different replay payload', async () => {
    await put({ ...ACCEPTANCE, expectedRevision: 0 });
    await put({ ...ACCEPTANCE, expectedRevision: 1 });

    // 只差一个字段也必须判为冲突,否则"重放"会静默吞掉真实的编辑。
    const response = await put({ ...ACCEPTANCE, reserveBalanceCents: 1, expectedRevision: 1 });
    expect(response.statusCode).toBe(409);
  });

  /**
   * 创建请求的结果不确定,是**最需要幂等**的那条路径:客户端发出 PUT
   * `expectedRevision:0`,服务端写成功,但响应丢了。重发时 expectedRevision 仍是 0,
   * 而库里已经是 revision 1。若把它当作"已在存在 → 409",客户端就永远无法安全地
   * 确认自己第一次到底存没存上。
   */
  it('answers 200 for an exact create retry (expectedRevision 0, same inputs)', async () => {
    const first = await put({ ...ACCEPTANCE, expectedRevision: 0 });
    expect(first.statusCode).toBe(200);
    const storedAfterFirst = rawPlanRow();
    expect((first.json() as { plan: { revision: number } }).plan.revision).toBe(1);

    clock += 60_000;

    const retry = await put({ ...ACCEPTANCE, expectedRevision: 0 });
    expect(retry.statusCode).toBe(200);

    const { plan } = retry.json() as { plan: Record<string, unknown> };
    // 返回第一次创建的结果:同一修订号、同一 updatedAt,没有第二条历史。
    expect(plan['revision']).toBe(1);
    expect(plan['updatedAt']).toBe(NOW);
    expect(rawPlanRow()).toBe(storedAfterFirst);
  });

  it('still rejects a create retry whose inputs differ from the stored plan', async () => {
    await put({ ...ACCEPTANCE, expectedRevision: 0 });
    const stored = rawPlanRow();

    const different = await put({
      monthlyIncomeCents: 99999,
      essentialMonthlyCents: 5000,
      reserveBalanceCents: 0,
      expectedRevision: 0,
    });
    expect(different.statusCode).toBe(409);
    expect(rawPlanRow()).toBe(stored);
  });

  it('does not replay a create retry once the plan has been updated past revision 1', async () => {
    await put({ ...ACCEPTANCE, expectedRevision: 0 }); // → 1
    await put({ ...ACCEPTANCE, expectedRevision: 1 }); // → 2

    // revision 2 意味着中间发生过一次确认过的更新,再声称"创建"就是过期视图。
    const retry = await put({ ...ACCEPTANCE, expectedRevision: 0 });
    expect(retry.statusCode).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// 损坏存储 —— 503 且绝不覆盖
// ---------------------------------------------------------------------------

describe('corrupt stored plan', () => {
  function writeRaw(value: string): void {
    db.prepare(
      `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    ).run(FINANCIAL_PLAN_SETTINGS_KEY, value, NOW);
  }

  const CORRUPT_CASES: readonly [string, string][] = [
    ['not json at all', '{{{'],
    ['a JSON string', '"nope"'],
    ['an array', '[1,2,3]'],
    ['null', 'null'],
    ['an unknown version', JSON.stringify({ version: 2, revision: 1, updatedAt: 1, inputs: ACCEPTANCE })],
    ['revision 0', JSON.stringify({ version: 1, revision: 0, updatedAt: 1, inputs: ACCEPTANCE })],
    ['a fractional revision', JSON.stringify({ version: 1, revision: 1.5, updatedAt: 1, inputs: ACCEPTANCE })],
    ['a string revision', JSON.stringify({ version: 1, revision: '1', updatedAt: 1, inputs: ACCEPTANCE })],
    ['a negative updatedAt', JSON.stringify({ version: 1, revision: 1, updatedAt: -1, inputs: ACCEPTANCE })],
    ['missing inputs', JSON.stringify({ version: 1, revision: 1, updatedAt: 1 })],
    [
      'invalid inputs',
      JSON.stringify({
        version: 1,
        revision: 1,
        updatedAt: 1,
        inputs: { monthlyIncomeCents: 0, essentialMonthlyCents: 1, reserveBalanceCents: 0 },
      }),
    ],
    [
      'inputs whose target overflows',
      JSON.stringify({
        version: 1,
        revision: 1,
        updatedAt: 1,
        inputs: {
          monthlyIncomeCents: 100,
          essentialMonthlyCents: Math.floor(Number.MAX_SAFE_INTEGER / 5) + 1,
          reserveBalanceCents: 0,
        },
      }),
    ],
  ];

  it.each(CORRUPT_CASES)('answers 503 for %s', async (_label, raw) => {
    writeRaw(raw);

    const response = await get(BASE);
    expect(response.statusCode).toBe(503);
    const body = response.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('FINANCIAL_PLAN_UNAVAILABLE');
    // 固定消息,不回显任何存储内容(里面是用户的钱数)。
    expect(body.error.message).not.toContain('monthlyIncomeCents');
    expect(body.error.message).not.toContain('10000');
  });

  it('refuses to overwrite a corrupt envelope and keeps the bytes intact', async () => {
    writeRaw('{{{');
    const before = rawPlanRow();

    // 创建路径与更新路径都必须拒绝:坏数据不能被当成"空"。
    const created = await put({ ...ACCEPTANCE, expectedRevision: 0 });
    expect(created.statusCode).toBe(503);
    expect(created.json()).toMatchObject({ error: { code: 'FINANCIAL_PLAN_UNAVAILABLE' } });

    const updated = await put({ ...ACCEPTANCE, expectedRevision: 1 });
    expect(updated.statusCode).toBe(503);

    expect(rawPlanRow()).toBe(before);
  });

  it('lets preview keep working while the stored plan is corrupt', async () => {
    writeRaw('{{{');
    // 预览不读存储,因此服务端仍然可用——用户至少还能算。
    const response = await post(`${BASE}/preview`, ACCEPTANCE);
    expect(response.statusCode).toBe(200);
    expect(rawPlanRow()).toBe('{{{');
  });

  it('answers 503 (not 500) so the failure is attributable', async () => {
    writeRaw('{{{');
    const response = await app.inject({
      method: 'PUT',
      url: BASE,
      headers: authed(),
      payload: { ...ACCEPTANCE, expectedRevision: 0 },
    });
    expect(response.statusCode).toBe(503);
    expect(response.statusCode).not.toBe(500);
  });

  /**
   * 信封形状合法、输入也合法,但**派生值**越界。
   *
   * 这类信封同样不可用:目标或 12 个月投影无法精确表示。它不能报 400(用户没提交
   * 任何东西),更不能在随后的一次保存里被覆盖——那样用户存进去的钱就静默消失了。
   */
  it('answers 503 for a stored envelope whose derived target overflows', async () => {
    writeRaw(
      JSON.stringify({
        version: 1,
        revision: 3,
        updatedAt: NOW,
        inputs: {
          monthlyIncomeCents: 100,
          essentialMonthlyCents: Math.floor(Number.MAX_SAFE_INTEGER / 5) + 1,
          reserveBalanceCents: 0,
        },
      }),
    );

    const response = await get(BASE);
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: 'FINANCIAL_PLAN_UNAVAILABLE' } });
  });

  it('answers 503 for a stored envelope whose 12-month projection overflows', async () => {
    // 输入各自安全,但收入顶到 MAX_SAFE 时增长累计(3×)越界。
    writeRaw(
      JSON.stringify({
        version: 1,
        revision: 1,
        updatedAt: NOW,
        inputs: {
          monthlyIncomeCents: Number.MAX_SAFE_INTEGER,
          essentialMonthlyCents: 1,
          reserveBalanceCents: 0,
        },
      }),
    );

    const response = await get(BASE);
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: 'FINANCIAL_PLAN_UNAVAILABLE' } });
  });

  it('does not let a save overwrite a derived-invalid envelope', async () => {
    const raw = JSON.stringify({
      version: 1,
      revision: 3,
      updatedAt: NOW,
      inputs: {
        monthlyIncomeCents: 100,
        essentialMonthlyCents: Math.floor(Number.MAX_SAFE_INTEGER / 5) + 1,
        reserveBalanceCents: 0,
      },
    });
    writeRaw(raw);

    for (const body of [
      { ...ACCEPTANCE, expectedRevision: 0 },
      { ...ACCEPTANCE, expectedRevision: 3 },
      // 连"看起来正好是上一次修订"的请求也必须拒绝:读不出当前计划就不能写。
      { ...ACCEPTANCE, expectedRevision: 2 },
    ]) {
      const response = await put(body);
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ error: { code: 'FINANCIAL_PLAN_UNAVAILABLE' } });
    }

    expect(rawPlanRow()).toBe(raw);
  });

  it('answers 503 for a revision that cannot be advanced safely', async () => {
    // revision = MAX_SAFE_INTEGER 的下一步会溢出成不安全的整数,因此这样的信封
    // 已经不可用:fail closed,而不是写出一个坏修订号。
    writeRaw(
      JSON.stringify({
        version: 1,
        revision: Number.MAX_SAFE_INTEGER,
        updatedAt: NOW,
        inputs: ACCEPTANCE,
      }),
    );

    const response = await put({ ...ACCEPTANCE, expectedRevision: Number.MAX_SAFE_INTEGER });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: 'FINANCIAL_PLAN_UNAVAILABLE' } });
  });

  /**
   * 回归:写路径不能自己造出一个读不回来的信封。
   *
   * `revision = MAX_SAFE-1` 的信封是**可读**的(解析器只拒绝 `>= MAX_SAFE`),所以 GET
   * 正常返回。危险在保存:`+1` 得到 `MAX_SAFE`,而解析器拒绝该值——于是"一次成功的
   * 保存"会把可用状态变成永久 503。必须在写入之前拦住,而不是靠解析器事后发现。
   */
  it('refuses to save a plan whose next revision would be unreadable, changing nothing', async () => {
    const ceiling = Number.MAX_SAFE_INTEGER - 1;
    const raw = JSON.stringify({ version: 1, revision: ceiling, updatedAt: NOW, inputs: ACCEPTANCE });
    writeRaw(raw);

    // 保存前:可读。
    const readable = await get(BASE);
    expect(readable.statusCode).toBe(200);
    expect((readable.json() as { plan: { revision: number } }).plan.revision).toBe(ceiling);

    // 保存:拒绝,且不是 409 —— 用户没做错任何事,是存储到了不可再推进的状态。
    const save = await put({ ...ACCEPTANCE, expectedRevision: ceiling });
    expect(save.statusCode).toBe(503);
    expect(save.json()).toMatchObject({ error: { code: 'FINANCIAL_PLAN_UNAVAILABLE' } });

    // 关键:没有任何写入,因此没有自我损坏;原始信封逐字节不变且仍然可读。
    expect(rawPlanRow()).toBe(raw);

    const stillReadable = await get(BASE);
    expect(stillReadable.statusCode).toBe(200);
    expect((stillReadable.json() as { plan: { revision: number } }).plan.revision).toBe(ceiling);
  });

  it('still serves a replay at the revision ceiling without writing', async () => {
    // 重放不推进修订号,因此在天花板之下依然安全可用——这正是"拒绝"与"完全不可用"
    // 的分界:能读、能重放,只是不能再前进。
    const ceiling = Number.MAX_SAFE_INTEGER - 1;
    const raw = JSON.stringify({ version: 1, revision: ceiling, updatedAt: NOW, inputs: ACCEPTANCE });
    writeRaw(raw);

    const replay = await put({ ...ACCEPTANCE, expectedRevision: ceiling - 1 });
    expect(replay.statusCode).toBe(200);
    expect((replay.json() as { plan: { revision: number } }).plan.revision).toBe(ceiling);
    expect(rawPlanRow()).toBe(raw);
  });
});

// ---------------------------------------------------------------------------
// 隔离:账本与其他 settings 键不受影响
// ---------------------------------------------------------------------------

describe('financial plan — isolation from the ledger', () => {
  it('does not touch ledger tables on preview or save', async () => {
    // 先造出真实的账本内容:一条工资(带分配快照)、一笔交易、一次转账、
    // 一个自定义模板与一个自定义分类。
    // Salary + module snapshot are seeded directly: fresh legacy salary writes are retired,
    // and this case only needs the historical rows to exist so it can prove they survive.
    const template = db
      .prepare('SELECT modules_json FROM budget_templates WHERE is_default = 1 AND deleted = 0 LIMIT 1')
      .get() as { modules_json: string } | undefined;
    const modules =
      template === undefined
        ? []
        : (JSON.parse(template.modules_json) as { categoryId: string; ratio: number }[]);
    seedHistoricalSalary(db, {
      accountId: 'builtin-default-account',
      amountCents: 500000,
      date: Date.UTC(2026, 9, 1),
      allocations: allocateSalaryCents(500000, modules),
    });

    const category = await app.inject({
      method: 'POST',
      url: '/api/v1/categories',
      headers: authed(),
      payload: { name: '测试分类', type: 0, icon: 'other', color: 1 },
    });
    expect(category.statusCode).toBe(201);

    const account = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      headers: authed(),
      payload: { name: '测试账户', type: 0 },
    });
    expect(account.statusCode).toBe(201);
    const accountId = (account.json() as { id: string }).id;

    const tx = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      headers: authed(),
      payload: {
        type: 0,
        amountCents: 1234,
        categoryId: 'builtin-expense-food',
        accountId,
        date: Date.UTC(2026, 9, 2),
        note: '午餐',
      },
    });
    expect(tx.statusCode).toBe(201);

    const transfer = await app.inject({
      method: 'POST',
      url: '/api/v1/transfers',
      headers: authed(),
      payload: {
        fromAccountId: 'builtin-default-account',
        toAccountId: accountId,
        amountCents: 5000,
        date: Date.UTC(2026, 9, 3),
      },
    });
    expect(transfer.statusCode).toBe(201);

    const before = ledgerSnapshot();
    const otherBefore = otherSettings();

    // 预览一次,保存两次(创建 + 更新)。
    expect((await post(`${BASE}/preview`, ACCEPTANCE)).statusCode).toBe(200);
    expect((await put({ ...ACCEPTANCE, expectedRevision: 0 })).statusCode).toBe(200);
    clock += 1000;
    expect(
      (await put({
        monthlyIncomeCents: 88888,
        essentialMonthlyCents: 22222,
        reserveBalanceCents: 3333,
        expectedRevision: 1,
      })).statusCode,
    ).toBe(200);

    // 账本逐字节不变:计划的保存/投影不产生任何工资、交易、转账、模板或分配写入。
    expect(ledgerSnapshot()).toEqual(before);
    // 别的 settings 键也没被动过(只允许出现/更新 financial.plan.v1)。
    expect(otherSettings()).toEqual(otherBefore);
  });

  it('does not write a cycle-start-day setting it was never asked to change', async () => {
    db.prepare('INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)').run(
      CYCLE_START_DAY_KEY,
      JSON.stringify({ day: 10 }),
      NOW,
    );
    const before = db
      .prepare('SELECT value_json, updated_at FROM settings WHERE key = ?')
      .get(CYCLE_START_DAY_KEY);

    await put({ ...ACCEPTANCE, expectedRevision: 0 });

    expect(
      db.prepare('SELECT value_json, updated_at FROM settings WHERE key = ?').get(CYCLE_START_DAY_KEY),
    ).toEqual(before);
  });

  it('keeps the plan independent of budget overview responses', async () => {
    // 一个预算视图不该因为计划存在而变化(反之亦然)。
    const budgetBefore = await get('/api/v1/budget/overview');

    await put({ ...ACCEPTANCE, expectedRevision: 0 });

    const budgetAfter = await get('/api/v1/budget/overview');
    expect(budgetAfter.json()).toEqual(budgetBefore.json());
  });
});

// ---------------------------------------------------------------------------
// wire fixture —— 给原生客户端测试用
// ---------------------------------------------------------------------------

describe('financial plan — wire fixture', () => {
  it('exposes the exact acceptance response shape', async () => {
    const response = await put({ ...ACCEPTANCE, expectedRevision: 0 });
    const { plan } = response.json() as { plan: Record<string, unknown> };
    const analysis = plan['analysis'] as Record<string, unknown>;

    // 字段名与顺序无关,但这组键必须稳定存在——原生 DTO 依赖它。
    expect(Object.keys(plan).sort()).toEqual(
      ['analysis', 'inputs', 'revision', 'updatedAt', 'version'].sort(),
    );
    expect(Object.keys(analysis).sort()).toEqual(
      [
        'allocations',
        'essentialShortfallCents',
        'monthlyDeficitCents',
        'monthsToTarget',
        'projection',
        'reserveGapCents',
        'reserveProgress',
        'reserveSurplusCents',
        'reserveTargetCents',
        'ruleVersion',
        'targetReached',
        'warnings',
      ].sort(),
    );

    // 分配的四条按固定顺序、带 percent 与 amountCents。
    expect(analysis['allocations']).toEqual([
      { purpose: 'growth', percent: 25, amountCents: 2500 },
      { purpose: 'reserve', percent: 15, amountCents: 1500 },
      { purpose: 'essentials', percent: 50, amountCents: 5000 },
      { purpose: 'joy', percent: 10, amountCents: 1000 },
    ]);

    // 投影每条六个字段,month 1..12。
    const projection = analysis['projection'] as Record<string, unknown>[];
    expect(projection).toHaveLength(12);
    expect(projection[0]).toEqual({
      month: 1,
      reserveProjectedCents: 1500,
      growthContributionsCents: 2500,
      reserveGapCents: 23500,
      reserveSurplusCents: 0,
      targetReached: false,
    });
    expect(projection[11]).toEqual({
      month: 12,
      reserveProjectedCents: 18000,
      growthContributionsCents: 30000,
      reserveGapCents: 7000,
      reserveSurplusCents: 0,
      targetReached: false,
    });
  });

  it('carries an ETA larger than a 32-bit integer as a plain JSON number', async () => {
    // 原生 DTO 必须用 Long 承载 monthsToTarget,见 shared 的同类用例。
    const response = await post(`${BASE}/preview`, {
      monthlyIncomeCents: 7,
      essentialMonthlyCents: 1_000_000_000,
      reserveBalanceCents: 0,
    });
    expect(response.statusCode).toBe(200);
    const { analysis } = response.json() as { analysis: Record<string, unknown> };
    expect(analysis['monthsToTarget']).toBe(5_000_000_000);
    expect(analysis['monthsToTarget']).toBeGreaterThan(2 ** 31 - 1);
  });

  it('sends null (not 0) for monthsToTarget when the reserve contribution is zero', async () => {
    const response = await post(`${BASE}/preview`, {
      monthlyIncomeCents: 3,
      essentialMonthlyCents: 1,
      reserveBalanceCents: 0,
    });
    const { analysis } = response.json() as { analysis: Record<string, unknown> };
    expect(analysis['monthsToTarget']).toBeNull();
    expect((analysis['warnings'] as string[]).includes('RESERVE_CONTRIBUTION_ZERO')).toBe(true);
  });
});
