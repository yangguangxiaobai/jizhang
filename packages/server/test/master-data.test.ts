/**
 * T7 acceptance tests: category/account management, builtin protection, soft
 * deletion with historical rows intact, reordering, and tag rename/delete.
 */
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { closeDatabase, initializeDatabase, type Db } from '../src/db/index.js';
import { SESSION_COOKIE } from '../src/plugins/auth.js';
import { AuthService } from '../src/services/auth-service.js';
import { MasterDataService } from '../src/services/master-data-service.js';
import { parseTagsJson } from '../src/services/tags.js';

const USERNAME = 'quiz';
const PASSWORD = 'correct horse battery staple';
const CSRF = { 'x-requested-with': 'fetch' } as const;

const NOW = Date.UTC(2026, 8, 11, 12, 0, 0);
const AUG = (day: number) => Date.UTC(2026, 7, day);

const FOOD = 'builtin-expense-food';
const TRANSPORT = 'builtin-expense-transport';
const DEFAULT_ACCOUNT = 'builtin-default-account';

let db: Db;
let app: FastifyInstance;
let cookie: string;
let service: MasterDataService;
let clock = NOW;

function authed() {
  return { ...CSRF, Cookie: `${SESSION_COOKIE}=${cookie}` };
}

async function inject(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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

async function addTransaction(
  categoryId: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const response = await inject('POST', '/api/v1/transactions', {
    type: 0,
    amountCents: 1000,
    categoryId,
    accountId: DEFAULT_ACCOUNT,
    date: AUG(10),
    ...extra,
  });
  expect(response.statusCode).toBe(201);
  return response.json().id as string;
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

  app = buildApp({
    config,
    db,
    authService,
    secureCookies: false,
    now: () => clock,
  });
  await app.ready();

  service = new MasterDataService(db, { now: () => clock });

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
// Categories
// ---------------------------------------------------------------------------

describe('category management', () => {
  it('lists the seeded categories, expense first', async () => {
    const response = await inject('GET', '/api/v1/categories');
    expect(response.statusCode).toBe(200);
    const items = response.json().items as { type: number }[];
    expect(items).toHaveLength(9);
    expect(items.filter((c) => c.type === 0)).toHaveLength(6);
    expect(items.filter((c) => c.type === 1)).toHaveLength(3);
  });

  it('filters by type', async () => {
    expect((await inject('GET', '/api/v1/categories?type=1')).json().items).toHaveLength(3);
    expect((await inject('GET', '/api/v1/categories?type=0')).json().items).toHaveLength(6);
  });

  it('rejects an out-of-range type filter', async () => {
    expect((await inject('GET', '/api/v1/categories?type=7')).statusCode).toBe(400);
  });

  it('supports one-level parent modules and keeps parents out of bill entry', async () => {
    const created = await inject('POST', '/api/v1/categories', {
      name: '生活',
      type: 0,
      icon: 'other',
      color: 4_280_000_000,
    });
    expect(created.statusCode).toBe(201);
    const parentId = created.json().id as string;

    const assigned = await inject('PATCH', `/api/v1/categories/${FOOD}`, {
      parentId,
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json().parentId).toBe(parentId);

    const parentBill = await inject('POST', '/api/v1/transactions', {
      type: 0,
      amountCents: 1000,
      categoryId: parentId,
      accountId: DEFAULT_ACCOUNT,
      date: AUG(10),
    });
    expect(parentBill.statusCode).toBe(400);
    expect(parentBill.json().error.message).toMatch(/parent category/i);

    const childBill = await addTransaction(FOOD);
    expect(childBill).toBeTruthy();

    const deleted = await inject('DELETE', `/api/v1/categories/${parentId}`);
    expect(deleted.statusCode).toBe(204);
    const child = (await inject('GET', '/api/v1/categories?includeDeleted=true'))
      .json()
      .items.find((item: { id: string }) => item.id === FOOD);
    expect(child.parentId).toBeNull();
  });

  it('rejects a second parent level', async () => {
    const first = await inject('POST', '/api/v1/categories', {
      name: '生活',
      type: 0,
      icon: 'other',
      color: 4_280_000_000,
    });
    const second = await inject('POST', '/api/v1/categories', {
      name: '家庭',
      type: 0,
      icon: 'other',
      color: 4_280_000_001,
    });
    const firstId = first.json().id as string;
    const secondId = second.json().id as string;
    expect(
      (await inject('PATCH', `/api/v1/categories/${FOOD}`, { parentId: firstId })).statusCode,
    ).toBe(200);
    const nested = await inject('PATCH', `/api/v1/categories/${firstId}`, { parentId: secondId });
    expect(nested.statusCode).toBe(400);
    expect(nested.json().error.message).toMatch(/children|parent level/i);
  });
  it('AC1 creates a category that the transaction editor can use', async () => {
    const created = await inject('POST', '/api/v1/categories', {
      name: '宠物',
      type: 0,
      icon: 'pet',
      color: 4_280_000_000,
    });
    expect(created.statusCode).toBe(201);
    const category = created.json();
    expect(category).toMatchObject({ name: '宠物', type: 0, icon: 'pet', isBuiltin: false });

    // It is now selectable: a transaction can reference it.
    const txn = await inject('POST', '/api/v1/transactions', {
      type: 0,
      amountCents: 5000,
      categoryId: category.id,
      accountId: DEFAULT_ACCOUNT,
      date: AUG(10),
    });
    expect(txn.statusCode).toBe(201);

    // And it shows up in the list the editor reads.
    const list = (await inject('GET', '/api/v1/categories')).json().items as { id: string }[];
    expect(list.some((c) => c.id === category.id)).toBe(true);
  });

  it('assigns a sort order automatically', async () => {
    const a = (await inject('POST', '/api/v1/categories', { name: 'A', type: 0 })).json();
    const b = (await inject('POST', '/api/v1/categories', { name: 'B', type: 0 })).json();
    expect(b.sortOrder).toBeGreaterThan(a.sortOrder);
  });

  it('rejects a blank name and a bad type', async () => {
    expect((await inject('POST', '/api/v1/categories', { name: '  ', type: 0 })).statusCode).toBe(
      400,
    );
    expect((await inject('POST', '/api/v1/categories', { name: 'X', type: 5 })).statusCode).toBe(
      400,
    );
  });

  it('AC3 renames a builtin category', async () => {
    const response = await inject('PATCH', `/api/v1/categories/${FOOD}`, { name: '吃饭' });
    expect(response.statusCode).toBe(200);
    expect(response.json().name).toBe('吃饭');

    const list = (await inject('GET', '/api/v1/categories')).json().items as {
      id: string;
      name: string;
    }[];
    expect(list.find((c) => c.id === FOOD)?.name).toBe('吃饭');
  });

  it('recolours and re-icons a category', async () => {
    const response = await inject('PATCH', `/api/v1/categories/${FOOD}`, {
      color: 4_000_000_000,
      icon: 'ramen',
    });
    expect(response.json()).toMatchObject({ color: 4_000_000_000, icon: 'ramen' });
  });

  it('AC2 refuses to delete a builtin category', async () => {
    const response = await inject('DELETE', `/api/v1/categories/${FOOD}`);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/builtin/i);

    const list = (await inject('GET', '/api/v1/categories')).json().items as { id: string }[];
    expect(list.some((c) => c.id === FOOD)).toBe(true);
  });

  it('deletes a custom category', async () => {
    const created = (await inject('POST', '/api/v1/categories', { name: '临时', type: 0 })).json();
    expect((await inject('DELETE', `/api/v1/categories/${created.id}`)).statusCode).toBe(204);

    const list = (await inject('GET', '/api/v1/categories')).json().items as { id: string }[];
    expect(list.some((c) => c.id === created.id)).toBe(false);
  });

  it('includeDeleted returns soft-deleted categories for historical naming', async () => {
    const created = (
      await inject('POST', '/api/v1/categories', { name: '旧分类', type: 0 })
    ).json();
    await inject('DELETE', `/api/v1/categories/${created.id}`);

    const live = (await inject('GET', '/api/v1/categories')).json().items as { id: string }[];
    expect(live.some((c) => c.id === created.id)).toBe(false);

    const history = (await inject('GET', '/api/v1/categories?includeDeleted=true')).json()
      .items as { id: string; name: string }[];
    expect(history.find((c) => c.id === created.id)?.name).toBe('旧分类');
  });

  it('deleting a category retires its recurring rules and pending items', async () => {
    const category = (
      await inject('POST', '/api/v1/categories', {
        name: '即将删除',
        type: 0,
      })
    ).json();

    const rule = await inject('POST', '/api/v1/recurring/rules', {
      name: '旧分类账单',
      type: 0,
      amountCents: 1000,
      categoryId: category.id,
      accountId: DEFAULT_ACCOUNT,
      frequency: 'monthly',
      anchorDate: Date.UTC(2026, 6, 10),
    });
    expect(rule.statusCode, rule.body).toBe(201);
    await inject('POST', '/api/v1/recurring/generate');
    const pending = (await inject('GET', '/api/v1/recurring/pending')).json().items as {
      id: string;
    }[];
    expect(pending.length).toBeGreaterThan(0);
    const confirmed = await inject(
      'POST',
      `/api/v1/recurring/occurrences/${pending[0]?.id}/confirm`,
    );
    expect(confirmed.statusCode, confirmed.body).toBe(200);

    await inject('DELETE', `/api/v1/categories/${category.id}`);

    expect((await inject('GET', '/api/v1/recurring/rules')).json().items).toHaveLength(0);
    expect((await inject('GET', '/api/v1/recurring/pending')).json().items).toHaveLength(0);
    // The confirmed occurrence is history and must survive the category delete.
    const occurrences = (await inject('GET', '/api/v1/recurring/occurrences')).json().items as {
      status: string;
      transactionId: string | null;
    }[];
    expect(occurrences.some((item) => item.status === 'confirmed')).toBe(true);
  });

  it('404s for an unknown category', async () => {
    expect((await inject('PATCH', '/api/v1/categories/nope', { name: 'x' })).statusCode).toBe(404);
    expect((await inject('DELETE', '/api/v1/categories/nope')).statusCode).toBe(404);
  });

  // AC4: the historical-name requirement
  it('AC4 a soft-deleted category still names its historical transactions', async () => {
    const created = (
      await inject('POST', '/api/v1/categories', {
        name: '宠物',
        type: 0,
      })
    ).json();
    const txnId = await addTransaction(created.id);

    await inject('DELETE', `/api/v1/categories/${created.id}`);

    // Gone from the selectable list...
    const list = (await inject('GET', '/api/v1/categories')).json().items as { id: string }[];
    expect(list.some((c) => c.id === created.id)).toBe(false);

    // ...but the transaction is untouched and its name still resolves.
    const txn = (await inject('GET', `/api/v1/transactions/${txnId}`)).json();
    expect(txn.categoryId).toBe(created.id);
    expect(service.getCategory(created.id, true)?.name).toBe('宠物');

    // And it can no longer be used for a new transaction.
    const reuse = await inject('POST', '/api/v1/transactions', {
      type: 0,
      amountCents: 100,
      categoryId: created.id,
      accountId: DEFAULT_ACCOUNT,
      date: AUG(11),
    });
    expect(reuse.statusCode).toBe(400);
  });

  it('reports how many transactions reference a category', async () => {
    await addTransaction(FOOD);
    await addTransaction(FOOD);
    const response = await inject('GET', `/api/v1/categories/${FOOD}/usage`);
    expect(response.json().transactions).toBe(2);
  });

  it('AC9 reorders categories by swapping with the neighbour', async () => {
    const before = (await inject('GET', '/api/v1/categories?type=0')).json().items as {
      id: string;
      sortOrder: number;
    }[];
    const first = before[0] as { id: string; sortOrder: number };
    const second = before[1] as { id: string; sortOrder: number };

    const moved = await inject('POST', `/api/v1/categories/${first.id}/move`, { dir: 1 });
    expect(moved.statusCode).toBe(200);

    const after = moved.json().items as { id: string; sortOrder: number }[];
    const firstAfter = after.find((c) => c.id === first.id)?.sortOrder;
    const secondAfter = after.find((c) => c.id === second.id)?.sortOrder;
    expect(firstAfter).toBe(second.sortOrder);
    expect(secondAfter).toBe(first.sortOrder);
  });

  it('moving past the end of the list is a no-op', async () => {
    const items = (await inject('GET', '/api/v1/categories?type=0')).json().items as {
      id: string;
      sortOrder: number;
    }[];
    const last = items[items.length - 1] as { id: string; sortOrder: number };

    const moved = await inject('POST', `/api/v1/categories/${last.id}/move`, { dir: 1 });
    expect(moved.statusCode).toBe(200);
    const after = moved.json().items as { id: string; sortOrder: number }[];
    expect(after.find((c) => c.id === last.id)?.sortOrder).toBe(last.sortOrder);
  });

  it('rejects an invalid move direction', async () => {
    expect((await inject('POST', `/api/v1/categories/${FOOD}/move`, { dir: 0 })).statusCode).toBe(
      400,
    );
    expect((await inject('POST', `/api/v1/categories/${FOOD}/move`, {})).statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

describe('account management', () => {
  it('lists the seeded default account', async () => {
    const items = (await inject('GET', '/api/v1/accounts')).json().items as {
      id: string;
      name: string;
      isBuiltin: boolean;
    }[];
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(DEFAULT_ACCOUNT);
    expect(items[0]?.isBuiltin).toBe(true);
  });

  it('AC10 creates an account with an initial balance', async () => {
    const created = await inject('POST', '/api/v1/accounts', {
      name: '招商银行',
      type: 1,
      initialBalanceCents: 1_234_500,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      name: '招商银行',
      type: 1,
      initialBalanceCents: 1_234_500,
      isBuiltin: false,
    });

    // Usable immediately.
    const txn = await inject('POST', '/api/v1/transactions', {
      type: 0,
      amountCents: 100,
      categoryId: FOOD,
      accountId: created.json().id,
      date: AUG(10),
    });
    expect(txn.statusCode).toBe(201);
  });

  it('accepts a negative initial balance and rejects a fractional one', async () => {
    const negative = await inject('POST', '/api/v1/accounts', {
      name: '信用卡',
      type: 2,
      initialBalanceCents: -50_000,
    });
    expect(negative.statusCode).toBe(201);
    expect(negative.json().initialBalanceCents).toBe(-50_000);

    const fractional = await inject('POST', '/api/v1/accounts', {
      name: 'Bad',
      type: 0,
      initialBalanceCents: 12.5,
    });
    expect(fractional.statusCode).toBe(400);
  });

  it('rejects an unknown account type', async () => {
    expect((await inject('POST', '/api/v1/accounts', { name: 'X', type: 9 })).statusCode).toBe(400);
  });

  it('edits an account', async () => {
    const created = (
      await inject('POST', '/api/v1/accounts', {
        name: '现金',
        type: 0,
      })
    ).json();
    const updated = await inject('PATCH', `/api/v1/accounts/${created.id}`, {
      name: '钱包',
      type: 5,
      initialBalanceCents: 200_00,
    });
    expect(updated.json()).toMatchObject({ name: '钱包', type: 5, initialBalanceCents: 20_000 });
  });

  it('refuses to delete the builtin default account', async () => {
    const response = await inject('DELETE', `/api/v1/accounts/${DEFAULT_ACCOUNT}`);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/default account/i);
  });

  it('refuses to delete the last remaining account', async () => {
    // Make the only account non-builtin so the builtin guard does not fire first.
    db.prepare('UPDATE accounts SET is_builtin = 0 WHERE id = ?').run(DEFAULT_ACCOUNT);
    const response = await inject('DELETE', `/api/v1/accounts/${DEFAULT_ACCOUNT}`);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/at least one account/i);
  });

  it('deletes a custom account and keeps its transactions readable', async () => {
    const created = (
      await inject('POST', '/api/v1/accounts', {
        name: '临时卡',
        type: 1,
      })
    ).json();
    const txnId = await addTransaction(FOOD, { accountId: created.id });

    await inject('DELETE', `/api/v1/accounts/${created.id}`);

    const items = (await inject('GET', '/api/v1/accounts')).json().items as { id: string }[];
    expect(items.some((a) => a.id === created.id)).toBe(false);

    const txn = (await inject('GET', `/api/v1/transactions/${txnId}`)).json();
    expect(txn.accountId).toBe(created.id);
    expect(service.getAccount(created.id, true)?.name).toBe('临时卡');
  });

  it('includeDeleted returns soft-deleted accounts for historical naming', async () => {
    const created = (
      await inject('POST', '/api/v1/accounts', {
        name: '旧账户',
        type: 1,
      })
    ).json();
    await inject('DELETE', `/api/v1/accounts/${created.id}`);

    const live = (await inject('GET', '/api/v1/accounts')).json().items as { id: string }[];
    expect(live.some((a) => a.id === created.id)).toBe(false);

    const history = (await inject('GET', '/api/v1/accounts?includeDeleted=true')).json().items as {
      id: string;
      name: string;
    }[];
    expect(history.find((a) => a.id === created.id)?.name).toBe('旧账户');
  });

  it('deleting an account retires its rules and pending items', async () => {
    const account = (
      await inject('POST', '/api/v1/accounts', {
        name: '即将关闭',
        type: 1,
      })
    ).json();

    const rule = await inject('POST', '/api/v1/recurring/rules', {
      name: '账户账单',
      type: 0,
      amountCents: 1000,
      categoryId: FOOD,
      accountId: account.id,
      frequency: 'monthly',
      anchorDate: Date.UTC(2026, 6, 10),
    });
    expect(rule.statusCode, rule.body).toBe(201);
    await inject('POST', '/api/v1/recurring/generate');
    const pending = (await inject('GET', '/api/v1/recurring/pending')).json().items as {
      id: string;
    }[];
    expect(pending.length).toBeGreaterThan(0);

    await inject('DELETE', `/api/v1/accounts/${account.id}`);

    expect((await inject('GET', '/api/v1/recurring/rules')).json().items).toHaveLength(0);
    expect((await inject('GET', '/api/v1/recurring/pending')).json().items).toHaveLength(0);
  });

  it('reports account usage', async () => {
    await addTransaction(FOOD);
    const response = await inject('GET', `/api/v1/accounts/${DEFAULT_ACCOUNT}/usage`);
    expect(response.json().transactions).toBe(1);
  });

  it('AC9 reorders accounts', async () => {
    const second = (await inject('POST', '/api/v1/accounts', { name: '第二', type: 0 })).json();
    const third = (await inject('POST', '/api/v1/accounts', { name: '第三', type: 0 })).json();

    const before = (await inject('GET', '/api/v1/accounts')).json().items as {
      id: string;
      sortOrder: number;
    }[];
    const thirdBefore = before.find((a) => a.id === third.id)?.sortOrder as number;

    const moved = await inject('POST', `/api/v1/accounts/${third.id}/move`, { dir: -1 });
    expect(moved.statusCode).toBe(200);

    const after = moved.json().items as { id: string; sortOrder: number }[];
    // It swapped with the account that was just above it.
    expect(after.find((a) => a.id === third.id)?.sortOrder).toBeLessThan(thirdBefore);
    expect(after.some((a) => a.id === second.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

describe('hierarchy tag API', () => {
  it('is read-only on GET and supports root/child CRUD while preserving identity on rename', async () => {
    const emptyBefore = (db.prepare('SELECT COUNT(*) AS c FROM tags').get() as {c:number}).c;
    expect((await inject('GET','/api/v1/tags/hierarchy')).statusCode).toBe(200);
    expect((db.prepare('SELECT COUNT(*) AS c FROM tags').get() as {c:number}).c).toBe(emptyBefore);
    const rootResponse=await inject('POST','/api/v1/tags/hierarchy',{name:'root'});
    expect(rootResponse.statusCode).toBe(201);
    const root=rootResponse.json() as {id:string;name:string};
    const childResponse=await inject('POST','/api/v1/tags/hierarchy',{name:'child',parentId:root.id});
    expect(childResponse.statusCode).toBe(201);
    const child=childResponse.json() as {id:string;name:string;parentId:string};
    expect(child.parentId).toBe(root.id);
    expect((await inject('DELETE',`/api/v1/tags/hierarchy/${root.id}`)).statusCode).toBe(409);
    const renamed=await inject('PATCH',`/api/v1/tags/hierarchy/${child.id}`,{name:'renamed'});
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().id).toBe(child.id);
    expect((await inject('DELETE',`/api/v1/tags/hierarchy/${child.id}`)).statusCode).toBe(204);
    expect((await inject('DELETE',`/api/v1/tags/hierarchy/${root.id}`)).statusCode).toBe(204);
  });

  it('keeps legacy rename and delete synchronized with stable metadata ids', async () => {
    await addTransaction(FOOD,{tags:['before']});
    const before=(await inject('GET','/api/v1/tags/hierarchy')).json().items as {id:string;name:string}[];
    const beforeId=before.find(t=>t.name==='before')!.id;
    expect((await inject('PATCH','/api/v1/tags',{from:'before',to:'after'})).statusCode).toBe(200);
    const after=(await inject('GET','/api/v1/tags/hierarchy')).json().items as {id:string;name:string}[];
    expect(after.find(t=>t.name==='after')?.id).toBe(beforeId);
    expect((await inject('DELETE',`/api/v1/tags/${encodeURIComponent('after')}`)).statusCode).toBe(200);
    expect((await inject('GET','/api/v1/tags/hierarchy')).json().items).toEqual([]);
    expect(db.prepare('SELECT deleted FROM tags WHERE id=?').get(beforeId)).toMatchObject({deleted:1});
  });

  it('rejects a legacy rename that would orphan a parent tag with active children', async () => {
    const root = (await inject('POST', '/api/v1/tags/hierarchy', { name: 'merge-root' })).json() as { id: string };
    await inject('POST', '/api/v1/tags/hierarchy', { name: 'merge-child', parentId: root.id });
    await addTransaction(FOOD, { tags: ['merge-root'] });
    await addTransaction(FOOD, { tags: ['other'] });

    const response = await inject('PATCH', '/api/v1/tags', { from: 'merge-root', to: 'other' });
    expect(response.statusCode).toBe(409);

    const items = (await inject('GET', '/api/v1/tags/hierarchy')).json().items as { id: string; name: string; parentId: string | null }[];
    expect(items.find((tag) => tag.name === 'merge-root')).toBeDefined();
    expect(items.find((tag) => tag.name === 'merge-child')?.parentId).toBe(root.id);
  });
});

describe('tag management (derived from transactions)', () => {
  it('lists tag names with live usage counts', async () => {
    await addTransaction(FOOD, { tags: ['家', '工作'] });
    await addTransaction(TRANSPORT, { tags: ['家'] });

    const items = (await inject('GET', '/api/v1/tags')).json().items as {
      name: string;
      count: number;
    }[];
    expect(items).toEqual([
      { name: '家', count: 2 },
      { name: '工作', count: 1 },
    ]);
  });

  it('AC6 renames a tag across every transaction that carries it', async () => {
    const first = await addTransaction(FOOD, { tags: ['家', '工作'] });
    const second = await addTransaction(TRANSPORT, { tags: ['家'] });
    await addTransaction(FOOD, { tags: ['其他'] });

    const response = await inject('PATCH', '/api/v1/tags', { from: '家', to: '家庭' });
    expect(response.statusCode).toBe(200);
    expect(response.json().updated).toBe(2);

    expect((await inject('GET', `/api/v1/transactions/${first}`)).json().tags).toEqual([
      '家庭',
      '工作',
    ]);
    expect((await inject('GET', `/api/v1/transactions/${second}`)).json().tags).toEqual(['家庭']);

    const items = response.json().items as { name: string }[];
    // Compare as a set: the service orders by usage count then name, and relying on
    // `localeCompare` ordering for Chinese here would make the test brittle.
    expect(new Set(items.map((t) => t.name))).toEqual(new Set(['家庭', '其他', '工作']));
  });

  it('renaming onto an existing tag merges them without duplicating', async () => {
    const id = await addTransaction(FOOD, { tags: ['家', '家庭'] });

    await inject('PATCH', '/api/v1/tags', { from: '家', to: '家庭' });

    expect((await inject('GET', `/api/v1/transactions/${id}`)).json().tags).toEqual(['家庭']);
  });

  it('renaming to the same name is a no-op', async () => {
    await addTransaction(FOOD, { tags: ['家'] });
    const response = await inject('PATCH', '/api/v1/tags', { from: '家', to: '家' });
    expect(response.json().updated).toBe(0);
  });

  it('rejects a blank source or target', async () => {
    expect((await inject('PATCH', '/api/v1/tags', { from: '', to: 'x' })).statusCode).toBe(400);
    expect((await inject('PATCH', '/api/v1/tags', { from: 'x', to: '  ' })).statusCode).toBe(400);
    expect((await inject('PATCH', '/api/v1/tags', { from: 'x' })).statusCode).toBe(400);
  });

  it('AC7 deletes a tag from every transaction, leaving the others alone', async () => {
    const first = await addTransaction(FOOD, { tags: ['家', '工作'] });
    const second = await addTransaction(TRANSPORT, { tags: ['家'] });

    const response = await inject('DELETE', `/api/v1/tags/${encodeURIComponent('家')}`);
    expect(response.statusCode).toBe(200);
    expect(response.json().updated).toBe(2);

    expect((await inject('GET', `/api/v1/transactions/${first}`)).json().tags).toEqual(['工作']);
    expect((await inject('GET', `/api/v1/transactions/${second}`)).json().tags).toEqual([]);

    const items = response.json().items as { name: string }[];
    expect(items.map((t) => t.name)).toEqual(['工作']);
  });

  it('AC7 deleting an unknown tag changes nothing', async () => {
    const id = await addTransaction(FOOD, { tags: ['家'] });
    const response = await inject('DELETE', `/api/v1/tags/${encodeURIComponent('不存在')}`);
    expect(response.json().updated).toBe(0);
    expect((await inject('GET', `/api/v1/transactions/${id}`)).json().tags).toEqual(['家']);
  });

  it('AC8 a multi-row rewrite is atomic', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      ids.push(await addTransaction(FOOD, { tags: ['家', `n${i}`] }));
    }

    await inject('PATCH', '/api/v1/tags', { from: '家', to: '家庭' });

    // Every row must have moved: a partial rewrite would leave mixed spellings.
    for (const id of ids) {
      const tags = (await inject('GET', `/api/v1/transactions/${id}`)).json().tags as string[];
      expect(tags).toContain('家庭');
      expect(tags).not.toContain('家');
    }

    const rows = db.prepare('SELECT tags_json FROM transactions WHERE deleted = 0').all() as {
      tags_json: string;
    }[];
    for (const row of rows) {
      expect(parseTagsJson(row.tags_json)).not.toContain('家');
    }
  });

  it('ignores soft-deleted transactions when rewriting tags', async () => {
    const live = await addTransaction(FOOD, { tags: ['家'] });
    const deleted = await addTransaction(FOOD, { tags: ['家'] });
    await inject('DELETE', `/api/v1/transactions/${deleted}`);

    const response = await inject('PATCH', '/api/v1/tags', { from: '家', to: '家庭' });
    expect(response.json().updated).toBe(1);

    expect((await inject('GET', `/api/v1/transactions/${live}`)).json().tags).toEqual(['家庭']);
    // The deleted row keeps its old tag; it is out of the ledger either way.
    const row = db.prepare('SELECT tags_json FROM transactions WHERE id = ?').get(deleted) as {
      tags_json: string;
    };
    expect(parseTagsJson(row.tags_json)).toEqual(['家']);
  });

  it('renaming preserves tag order and de-duplication', async () => {
    const id = await addTransaction(FOOD, { tags: ['a', 'b', 'c'] });
    await inject('PATCH', '/api/v1/tags', { from: 'b', to: 'B' });
    expect((await inject('GET', `/api/v1/transactions/${id}`)).json().tags).toEqual([
      'a',
      'B',
      'c',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

describe('master-data writes are protected', () => {
  it('rejects every mutating endpoint without a session', async () => {
    const attempts = [
      { method: 'POST' as const, url: '/api/v1/categories', headers: CSRF },
      { method: 'PATCH' as const, url: `/api/v1/categories/${FOOD}`, headers: CSRF },
      { method: 'DELETE' as const, url: `/api/v1/categories/${FOOD}`, headers: CSRF },
      { method: 'POST' as const, url: '/api/v1/accounts', headers: CSRF },
      { method: 'PATCH' as const, url: '/api/v1/tags', headers: CSRF },
      { method: 'DELETE' as const, url: '/api/v1/tags/x', headers: CSRF },
    ];
    for (const attempt of attempts) {
      const response = await app.inject(attempt);
      expect(response.statusCode, `${attempt.method} ${attempt.url}`).toBe(401);
    }
  });

  it('protects the tag hierarchy endpoints without a session', async () => {
    const attempts = [
      { method: 'GET' as const, url: '/api/v1/tags/hierarchy' },
      { method: 'POST' as const, url: '/api/v1/tags/hierarchy', headers: CSRF, payload: { name: 'x' } },
      { method: 'PATCH' as const, url: '/api/v1/tags/hierarchy/x', headers: CSRF, payload: { name: 'y' } },
      { method: 'DELETE' as const, url: '/api/v1/tags/hierarchy/x', headers: CSRF },
    ];
    for (const attempt of attempts) {
      const response = await app.inject(attempt);
      expect(response.statusCode, `${attempt.method} ${attempt.url}`).toBe(401);
    }
  });

  it('requires the CSRF header on writes when signed in', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/categories',
      headers: { Cookie: `${SESSION_COOKIE}=${cookie}` },
      payload: { name: 'X', type: 0 },
    });
    expect(response.statusCode).toBe(403);
  });

  it('requires the CSRF header on hierarchy writes when signed in', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tags/hierarchy',
      headers: { Cookie: `${SESSION_COOKIE}=${cookie}` },
      payload: { name: 'X' },
    });
    expect(response.statusCode).toBe(403);
  });
});
