import { test, expect } from './fixtures.mjs';
import { assertPhoneLayout } from './helpers.mjs';

async function login(page, ledger) {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('用户名').fill(ledger.username);
  await page.getByLabel('密码', { exact: true }).fill(ledger.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
}

async function createPurchase(page, date) {
  const response = await page.request.post('/api/v1/transactions', {
    headers: { 'X-Requested-With': 'fetch' },
    data: {
      type: 0,
      amountCents: 450_000,
      categoryId: 'builtin-expense-shopping',
      accountId: 'builtin-default-account',
      date,
      note: '物品测试购入',
    },
  });
  const body = await response.json();
  expect(response.status(), JSON.stringify(body)).toBe(201);
  return body;
}

test('item entry links an existing bill without creating a second bill', async ({
  page,
  ledger,
}) => {
  await login(page, ledger);

  const purchaseDate = new Date();
  purchaseDate.setDate(purchaseDate.getDate() - 10);
  purchaseDate.setHours(0, 0, 0, 0);
  const purchase = await createPurchase(page, purchaseDate.getTime());
  const before = await page.request.get('/api/v1/transactions?limit=500').then((r) => r.json());

  await expect(page.getByRole('button', { name: '查看物品资产' })).toBeVisible();
  await page.getByRole('button', { name: '查看物品资产' }).click();
  await expect(page.getByRole('heading', { name: '物品资产' }).first()).toBeVisible();
  await page.getByRole('button', { name: '添加物品', exact: true }).click();
  await expect(page).toHaveURL(/\/items\/new$/);
  await page.getByLabel('物品名称').fill('家庭测试键盘');
  await page.getByLabel('物品分类').fill('数码 / 外设');
  await page
    .getByLabel('购入日期')
    .fill(
      purchaseDate.getFullYear() +
        '-' +
        String(purchaseDate.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(purchaseDate.getDate()).padStart(2, '0'),
    );
  await page.locator('.item-transaction-picker select').selectOption(purchase.id);
  await expect(page.getByText('只建立关联，不会重复记账。')).toBeVisible();
  await assertPhoneLayout(page);
  await page.getByRole('button', { name: '保存物品' }).click();
  await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: '家庭测试键盘' })).toBeVisible();
  await expect(page.getByText('物品测试购入', { exact: false })).toBeVisible();

  await page.getByRole('button', { name: '记录售出 / 退役' }).click();
  await expect(page).toHaveURL(/\/items\/[0-9a-f-]+\/close$/);
  await expect(
    page.getByRole('region', { name: '结束物品持有' }).getByRole('heading', { name: '结束持有' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '已退役' }).click();
  const today = new Date();
  await page
    .getByLabel('退役日期')
    .fill(
      today.getFullYear() +
        '-' +
        String(today.getMonth() + 1).padStart(2, '0') +
        '-' +
        String(today.getDate()).padStart(2, '0'),
    );
  await page.getByRole('button', { name: '确认退役' }).click();
  await expect(page).toHaveURL(/\/items\/[0-9a-f-]+$/);
  await expect(page.getByText('已退役', { exact: true }).first()).toBeVisible();

  const after = await page.request.get('/api/v1/transactions?limit=500').then((r) => r.json());
  expect(after.total).toBe(before.total);
  const itemId = new URL(page.url()).pathname.split('/').at(-1);
  const item = await page.request.get('/api/v1/items/' + itemId).then((r) => r.json());
  expect(item.purchaseTransactionId).toBe(purchase.id);
  expect(item.purchasePriceCents).toBe(450_000);

  await page.getByRole('link', { name: '我的' }).click();
  await expect(page.getByRole('button', { name: '进入物品资产' })).toBeVisible();
  await page.getByRole('button', { name: '进入物品资产' }).click();
  await expect(page).toHaveURL(/\/items$/);
});
