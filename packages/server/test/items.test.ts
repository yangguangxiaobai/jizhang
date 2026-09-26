/**
 * Item inventory acceptance tests: isolated records, lifecycle costs, optional
 * transaction links, authenticated photos, and photo backup coverage.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { backupDatabase } from '../src/db/migrate.js';
import { closeDatabase, initializeDatabase, type Db } from '../src/db/index.js';
import { SESSION_COOKIE } from '../src/plugins/auth.js';
import { AuthService } from '../src/services/auth-service.js';
import type { ItemDto, ItemSummaryDto } from '../src/services/item-service.js';

const USERNAME = 'quiz';
const PASSWORD = 'correct horse battery staple';
const CSRF = { 'x-requested-with': 'fetch' } as const;
const NOW = new Date(2026, 8, 26, 12, 0, 0).getTime();
const PURCHASE_DATE = new Date(2024, 4, 26).getTime();
const PURCHASE_CENTS = 879_900;
const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const WEBP_BYTES = Buffer.alloc(30);
WEBP_BYTES.write('RIFF', 0, 'ascii');
WEBP_BYTES.writeUInt32LE(22, 4);
WEBP_BYTES.write('WEBP', 8, 'ascii');
WEBP_BYTES.write('VP8X', 12, 'ascii');
WEBP_BYTES.writeUInt32LE(10, 16);

let db: Db;
let app: FastifyInstance;
let cookie: string;
const tempDirs: string[] = [];

function headers() {
  return { ...CSRF, Cookie: SESSION_COOKIE + '=' + cookie };
}

async function login(): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: CSRF,
    payload: { username: USERNAME, password: PASSWORD },
  });
  expect(response.statusCode, response.body).toBe(200);
  const session = (response.cookies as { name: string; value: string }[]).find(
    (entry) => entry.name === SESSION_COOKIE,
  );
  if (session === undefined) throw new Error('login did not set the session cookie');
  return session.value;
}

async function createTransaction(
  type: 0 | 1,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/transactions',
    headers: headers(),
    payload: {
      type,
      amountCents: 879_900,
      categoryId: type === 0 ? 'builtin-expense-shopping' : 'builtin-income-other',
      accountId: 'builtin-default-account',
      date: PURCHASE_DATE,
      note: type === 0 ? '相机购入' : '相机售出',
      ...overrides,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return (response.json() as { id: string }).id;
}

async function createItem(overrides: Record<string, unknown> = {}): Promise<ItemDto> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/items',
    headers: headers(),
    payload: {
      name: 'Sony α7C II',
      category: '数码 / 摄影器材',
      purchasePriceCents: PURCHASE_CENTS,
      purchaseDate: PURCHASE_DATE,
      ...overrides,
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as ItemDto;
}

async function financialSnapshot(): Promise<unknown[]> {
  const urls = [
    '/api/v1/accounts/balances',
    '/api/v1/stats/category-share?from=' + PURCHASE_DATE + '&to=' + (NOW + 86_400_000),
    '/api/v1/stats/monthly-trend?months=1',
    '/api/v1/budget/overview',
  ];
  const responses = await Promise.all(
    urls.map((url) => app.inject({ method: 'GET', url, headers: headers() })),
  );
  for (const response of responses) expect(response.statusCode, response.body).toBe(200);
  return responses.map((response) => response.json());
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
  cookie = await login();
});

afterEach(async () => {
  await app.close();
  closeDatabase(db);
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('item routes and lifecycle', () => {
  it('requires an authenticated session', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/items' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: expect.any(String), message: expect.any(String) },
    });
  });

  it('creates, filters, updates, sells, and computes server-owned costs', async () => {
    const item = await createItem();
    expect(item.status).toBe('active');
    expect(item.heldDays).toBe(853);
    expect(item.dailyCostCents).toBe(Math.round(PURCHASE_CENTS / 853));

    const filtered = await app.inject({
      method: 'GET',
      url: '/api/v1/items?status=active&category=' + encodeURIComponent('数码 / 摄影器材'),
      headers: headers(),
    });
    expect(filtered.statusCode).toBe(200);
    expect((filtered.json() as { total: number }).total).toBe(1);

    const idle = await app.inject({
      method: 'PATCH',
      url: '/api/v1/items/' + item.id,
      headers: headers(),
      payload: { status: 'idle', note: '日常使用' },
    });
    expect(idle.statusCode).toBe(200);
    expect((idle.json() as ItemDto).status).toBe('idle');

    const sold = await app.inject({
      method: 'POST',
      url: '/api/v1/items/' + item.id + '/sell',
      headers: headers(),
      payload: {
        closedDate: NOW,
        salePriceCents: 400_000,
      },
    });
    expect(sold.statusCode, sold.body).toBe(200);
    const soldItem = sold.json() as ItemDto;
    expect(soldItem.status).toBe('sold');
    expect(soldItem.netCostCents).toBe(479_900);
    expect(soldItem.dailyCostCents).toBe(Math.round(479_900 / 853));

    const duplicateSale = await app.inject({
      method: 'POST',
      url: '/api/v1/items/' + item.id + '/sell',
      headers: headers(),
      payload: { closedDate: NOW, salePriceCents: 1 },
    });
    expect(duplicateSale.statusCode).toBe(409);
    expect(duplicateSale.json()).toMatchObject({ error: { code: 'CONFLICT' } });
  });

  it('supports unknown price and same-day items without fabricating a daily cost', async () => {
    const item = await createItem({
      name: '赠送的纪念品',
      purchasePriceCents: null,
      purchaseDate: NOW,
    });
    expect(item.heldDays).toBe(0);
    expect(item.netCostCents).toBeNull();
    expect(item.dailyCostCents).toBeNull();
  });

  it('validates dates, amounts, categories, and transaction link types', async () => {
    const expenseId = await createTransaction(0);
    const linked = await createItem({ purchaseTransactionId: expenseId });
    expect(linked.purchaseTransactionId).toBe(expenseId);

    const incomeId = await createTransaction(1);
    const wrongPurchaseType = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: headers(),
      payload: {
        name: '错误关联',
        purchaseDate: PURCHASE_DATE,
        purchaseTransactionId: incomeId,
      },
    });
    expect(wrongPurchaseType.statusCode).toBe(400);

    const future = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: headers(),
      payload: { name: '未来物品', purchaseDate: NOW + 2 * 86_400_000 },
    });
    expect(future.statusCode).toBe(400);

    const negative = await app.inject({
      method: 'POST',
      url: '/api/v1/items',
      headers: headers(),
      payload: { name: '负数', purchaseDate: PURCHASE_DATE, purchasePriceCents: -1 },
    });
    expect(negative.statusCode).toBe(400);

    const futureClose = await app.inject({
      method: 'POST',
      url: '/api/v1/items/' + linked.id + '/retire',
      headers: headers(),
      payload: { closedDate: NOW + 86_400_000 },
    });
    expect(futureClose.statusCode).toBe(400);

    const retired = await app.inject({
      method: 'POST',
      url: '/api/v1/items/' + linked.id + '/retire',
      headers: headers(),
      payload: { closedDate: PURCHASE_DATE + 5 * 86_400_000 },
    });
    expect(retired.statusCode).toBe(200);
    const movedPurchaseDate = await app.inject({
      method: 'PATCH',
      url: '/api/v1/items/' + linked.id,
      headers: headers(),
      payload: { purchaseDate: PURCHASE_DATE + 6 * 86_400_000 },
    });
    expect(movedPurchaseDate.statusCode).toBe(400);
    expect(movedPurchaseDate.json()).toMatchObject({
      error: { message: '购入日期不能晚于售出或退役日期。' },
    });
  });

  it('searches literal SQL wildcard characters as text', async () => {
    await createItem({ name: '相机 100%' });
    await createItem({ name: '相机 1000' });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/items?q=%25',
      headers: headers(),
    });
    expect(response.statusCode).toBe(200);
    const result = response.json() as { items: ItemDto[]; total: number };
    expect(result.total).toBe(1);
    expect(result.items[0]?.name).toBe('相机 100%');
  });

  it('links existing bills without creating or mutating ledger rows or financial views', async () => {
    const expenseId = await createTransaction(0);
    const incomeId = await createTransaction(1, { amountCents: 400_000, date: NOW });
    const beforeCount = (
      db.prepare('SELECT COUNT(*) AS count FROM transactions').get() as { count: number }
    ).count;
    const before = await financialSnapshot();

    const item = await createItem({ purchaseTransactionId: expenseId });
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/items/' + item.id,
      headers: headers(),
      payload: { note: '保留原账单，不重复记账' },
    });
    const sold = await app.inject({
      method: 'POST',
      url: '/api/v1/items/' + item.id + '/sell',
      headers: headers(),
      payload: { closedDate: NOW, salePriceCents: 400_000, saleTransactionId: incomeId },
    });
    expect(sold.statusCode).toBe(200);
    expect((sold.json() as ItemDto).saleTransactionId).toBe(incomeId);
    const removed = await app.inject({
      method: 'DELETE',
      url: '/api/v1/items/' + item.id,
      headers: headers(),
    });
    expect(removed.statusCode).toBe(204);

    const afterCount = (
      db.prepare('SELECT COUNT(*) AS count FROM transactions').get() as { count: number }
    ).count;
    expect(afterCount).toBe(beforeCount);
    expect(await financialSnapshot()).toEqual(before);
    expect(db.prepare('SELECT deleted FROM transactions WHERE id = ?').get(expenseId)).toEqual({
      deleted: 0,
    });
  });

  it('keeps item references when a linked transaction is later deleted', async () => {
    const expenseId = await createTransaction(0);
    const item = await createItem({ purchaseTransactionId: expenseId });
    const removed = await app.inject({
      method: 'DELETE',
      url: '/api/v1/transactions/' + expenseId,
      headers: headers(),
    });
    expect(removed.statusCode).toBe(204);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/items/' + item.id,
      headers: headers(),
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as ItemDto).purchaseTransactionId).toBe(expenseId);
    const edited = await app.inject({
      method: 'PATCH',
      url: '/api/v1/items/' + item.id,
      headers: headers(),
      payload: { note: '原账单已删除，但物品仍可编辑' },
    });
    expect(edited.statusCode).toBe(200);
    expect((edited.json() as ItemDto).purchaseTransactionId).toBe(expenseId);
  });
});

describe('item photo persistence', () => {
  it('requires authentication and validates MIME, signature, and size', async () => {
    const item = await createItem();
    const anonymous = await app.inject({
      method: 'PUT',
      url: '/api/v1/items/' + item.id + '/photo',
      headers: { 'content-type': 'image/png', ...CSRF },
      payload: PNG_BYTES,
    });
    expect(anonymous.statusCode).toBe(401);

    const mismatch = await app.inject({
      method: 'PUT',
      url: '/api/v1/items/' + item.id + '/photo',
      headers: { ...headers(), 'content-type': 'image/png' },
      payload: Buffer.from('not an image'),
    });
    expect(mismatch.statusCode).toBe(400);

    const tooManyPixels = Buffer.from(PNG_BYTES);
    tooManyPixels.writeUInt32BE(100_000, 16);
    tooManyPixels.writeUInt32BE(1_000, 20);
    const dimensions = await app.inject({
      method: 'PUT',
      url: '/api/v1/items/' + item.id + '/photo',
      headers: { ...headers(), 'content-type': 'image/png' },
      payload: tooManyPixels,
    });
    expect(dimensions.statusCode).toBe(400);
    expect(dimensions.json()).toMatchObject({
      error: { message: expect.stringContaining('4000 万像素') },
    });

    const oversized = await app.inject({
      method: 'PUT',
      url: '/api/v1/items/' + item.id + '/photo',
      headers: { ...headers(), 'content-type': 'image/png' },
      payload: Buffer.concat([PNG_BYTES, Buffer.alloc(2 * 1024 * 1024)]),
    });
    expect(oversized.statusCode).toBe(413);
    expect(oversized.json()).toMatchObject({ error: { code: 'ITEM_PHOTO_TOO_LARGE' } });
  });

  it('serves only the authenticated stored image and keeps it inside the database backup', async () => {
    const item = await createItem();
    const upload = await app.inject({
      method: 'PUT',
      url: '/api/v1/items/' + item.id + '/photo',
      headers: { ...headers(), 'content-type': 'image/png' },
      payload: PNG_BYTES,
    });
    expect(upload.statusCode).toBe(204);

    const photo = await app.inject({
      method: 'GET',
      url: '/api/v1/items/' + item.id + '/photo',
      headers: headers(),
    });
    expect(photo.statusCode).toBe(200);
    expect(photo.headers['content-type']).toBe('image/png');
    expect(photo.headers['cache-control']).toBe('no-store');
    expect(photo.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(photo.rawPayload)).toEqual(PNG_BYTES);

    const directory = mkdtempSync(path.join(tmpdir(), 'jizhang-item-photo-'));
    tempDirs.push(directory);
    const backupPath = backupDatabase(db, directory);
    expect(backupPath).not.toBeNull();
    if (backupPath === null) throw new Error('database backup was not created');
    const backup = new Database(backupPath, { readonly: true });
    try {
      const row = backup
        .prepare('SELECT mime_type, image_bytes FROM asset_item_photos WHERE item_id = ?')
        .get(item.id) as { mime_type: string; image_bytes: Buffer } | undefined;
      expect(row?.mime_type).toBe('image/png');
      expect(Buffer.from(row?.image_bytes ?? [])).toEqual(PNG_BYTES);
    } finally {
      backup.close();
    }

    const webpItem = await createItem({ name: 'WebP 照片' });
    const webpUpload = await app.inject({
      method: 'PUT',
      url: '/api/v1/items/' + webpItem.id + '/photo',
      headers: { ...headers(), 'content-type': 'image/webp' },
      payload: WEBP_BYTES,
    });
    expect(webpUpload.statusCode).toBe(204);
    const webp = await app.inject({
      method: 'GET',
      url: '/api/v1/items/' + webpItem.id + '/photo',
      headers: headers(),
    });
    expect(webp.statusCode).toBe(200);
    expect(webp.headers['content-type']).toBe('image/webp');
    expect(Buffer.from(webp.rawPayload)).toEqual(WEBP_BYTES);
  });
});

describe('item summaries and deletion', () => {
  it('counts statuses and keeps soft-deleted items out of summaries', async () => {
    const active = await createItem();
    const idle = await createItem({ name: '耳机', status: 'idle' });
    const retired = await createItem({ name: '旧键盘' });
    const retirement = await app.inject({
      method: 'POST',
      url: '/api/v1/items/' + retired.id + '/retire',
      headers: headers(),
      payload: { closedDate: NOW },
    });
    expect(retirement.statusCode).toBe(200);

    const firstSummary = await app.inject({
      method: 'GET',
      url: '/api/v1/items/summary',
      headers: headers(),
    });
    const summary = firstSummary.json() as ItemSummaryDto;
    expect(summary).toMatchObject({
      totalItems: 3,
      activeItems: 1,
      idleItems: 1,
      soldItems: 0,
      retiredItems: 1,
      cumulativePurchaseCents: PURCHASE_CENTS * 3,
    });
    expect(summary.currentDailyCostCents).toBe(
      Math.round(PURCHASE_CENTS / 853) + Math.round(PURCHASE_CENTS / 853),
    );

    await app.inject({
      method: 'DELETE',
      url: '/api/v1/items/' + active.id,
      headers: headers(),
    });
    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/items/summary',
      headers: headers(),
    });
    expect((after.json() as ItemSummaryDto).totalItems).toBe(2);
    expect((after.json() as ItemSummaryDto).activeItems).toBe(0);
    const hidden = await app.inject({
      method: 'GET',
      url: '/api/v1/items/' + active.id,
      headers: headers(),
    });
    expect(hidden.statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/items/' + idle.id, headers: headers() }))
        .statusCode,
    ).toBe(200);
  });
});
