import { test, expect } from './fixtures.mjs';
import { assertPhoneLayout } from './helpers.mjs';

const dateInput = (monthOffset = 0, day = 1) => {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() + monthOffset, day);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};
const yuan = (cents) => `¥${(cents / 100).toFixed(2)}`;
const json = async (page, path) => {
  const response = await page.request.get(`/api/v1${path}`);
  expect(response.ok(), `${path}: ${response.status()}`).toBeTruthy();
  return response.json();
};

async function login(page, ledger) {
  await page.addInitScript(() => {
    // A valid-shaped old PIN record used to hide the whole app after a reload.
    localStorage.setItem(
      'jizhang.pin',
      JSON.stringify({ salt: 'legacy-salt', hash: 'legacy-hash' }),
    );
  });
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('用户名').fill(ledger.username);
  await page.getByLabel('密码', { exact: true }).fill(ledger.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
  await expect(page.getByText('已锁定', { exact: true })).toHaveCount(0);
}

async function createTemplate(page) {
  await page.goto('/templates');
  await page.getByRole('button', { name: '新建模板', exact: true }).click();
  await page.getByLabel('模板名称').fill('手机工资模板');
  while ((await page.getByRole('button', { name: /移除第/ }).count()) > 2) {
    await page
      .getByRole('button', { name: /移除第/ })
      .last()
      .click();
  }
  await page.getByLabel('第 1 个模块的比例').fill('50');
  await page.getByLabel('第 2 个模块的比例').fill('40');
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  await page.getByLabel('第 1 个模块的比例').fill('60');
  await assertPhoneLayout(page);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.templates > li').filter({ hasText: '手机工资模板' })).toBeVisible();
}

async function salary(page, amount, date = dateInput(), template = '手机工资模板') {
  await page.goto('/salary/new');
  await page.getByLabel('工资金额（元）').fill(amount);
  await page.getByLabel('发薪日').fill(date);
  // The receiving account is required by the server, so the form must offer it and
  // preselect one — otherwise saving would 400 and the flow below would break.
  const accountField = page.getByLabel('收款账户');
  await expect(accountField).toBeVisible();
  await expect(accountField).not.toHaveValue('');
  if (template !== undefined) await page.getByLabel('分配模板').selectOption({ label: template });
  await expect(page.locator('.balance')).toContainText('与工资一致');
  await assertPhoneLayout(page);
  await page.getByRole('button', { name: /保存.*预算|保存并开始新周期/ }).click();
  await expect(page).toHaveURL(/\/budget$/);
  await expect(page.locator('.summary')).toBeVisible();
}

async function expense(page, { amount, category, note, date = dateInput(), refund = false }) {
  await page.goto('/transactions/new');
  await page.getByLabel('金额（元）').fill(amount);
  // Not `exact`: the field's <label> wraps the <select>, so the label's text content
  // includes every option ("分类餐饮交通…") while its accessible name is just "分类".
  await page.getByLabel('分类').selectOption({ label: category });
  await page.getByLabel('日期', { exact: true }).fill(date);
  await page.getByLabel('备注', { exact: true }).fill(note);
  if (refund) await page.getByLabel(/这是退款/).check();
  await assertPhoneLayout(page);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page).toHaveURL(/\/transactions$/);
}

/**
 * Opens a transaction's edit view from the list.
 *
 * By row, not by text: the note is rendered inside a composed line
 * ("9月1日 周二 · 默认账户 · 手机午饭"), so no element's text content is exactly the note
 * and `getByText(note, { exact: true })` can never match it.
 */
const openTransaction = (page, note) =>
  page.locator('li').filter({ hasText: note }).getByRole('button').first().click();

async function budgetModule(page, category, remaining) {
  await page.goto('/budget');
  const row = page
    .locator('.modules > li')
    .filter({ has: page.locator('.name', { hasText: category }) });
  await expect(row).toBeVisible();
  await expect(row.locator('.figures strong')).toHaveText(yuan(remaining));
  return row;
}

test('phone forms: template → salary → spending/edit/refund/delete/restore → budget', async ({
  page,
  ledger,
}, testInfo) => {
  await login(page, ledger);
  await createTemplate(page);
  await salary(page, '10000.01');
  let overview = await json(page, '/budget/overview');
  expect(overview.totalBudgetCents).toBe(1_000_001);
  expect(overview.modules.map((m) => [m.categoryName, m.budgetCents])).toEqual([
    ['餐饮', 600_001],
    ['交通', 400_000],
  ]);
  await expense(page, { amount: '123.45', category: '餐饮', note: '手机午饭' });
  await budgetModule(page, '餐饮', 587_656);

  await page.goto('/transactions');
  await openTransaction(page, '手机午饭');
  await expect(page).toHaveURL(/\/transactions\/.+\/edit$/);
  await page.getByLabel('分类').selectOption({ label: '交通' });
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await budgetModule(page, '餐饮', 600_001);
  await budgetModule(page, '交通', 387_655);

  await expense(page, { amount: '23.45', category: '交通', note: '手机退款', refund: true });
  await budgetModule(page, '交通', 390_000);
  await expense(page, { amount: '50.00', category: '购物', note: '模板外支出' });
  const unbudgeted = await budgetModule(page, '购物', -5_000);
  await expect(unbudgeted).toContainText('未分配预算');
  await expect(page.locator('.pool strong')).toHaveText(yuan(-5_000));

  await page.goto('/transactions');
  await openTransaction(page, '手机午饭');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await expect(page).toHaveURL(/\/transactions$/);
  await budgetModule(page, '交通', 402_345);
  await page.goto('/trash');
  const trashRow = page.locator('.rows > li').filter({ hasText: '手机午饭' });
  await trashRow.getByRole('button', { name: '恢复', exact: true }).click();
  await expect(trashRow).toHaveCount(0);
  await budgetModule(page, '交通', 390_000);

  await salary(page, '1000.00');
  overview = await json(page, '/budget/overview');
  expect(overview.totalBudgetCents).toBe(1_100_001);
  expect(overview.totalSpentCents).toBe(15_000);
  expect(overview.carryoverPoolCents).toBe(-5_000);
  await ledger.restart();
  await page.reload();
  await expect(page.locator('.summary')).toContainText(yuan(1_100_001));
  await assertPhoneLayout(page);
  await page.screenshot({ path: testInfo.outputPath('budget-iphone.png'), fullPage: true });

  await page.goto('/settings');
  await expect(page.getByRole('button', { name: '修改密码', exact: true })).toBeVisible();
  await expect(page.getByLabel('当前密码')).toHaveCount(0);
  await page.getByRole('button', { name: '修改密码', exact: true }).click();
  await expect(page.getByLabel('当前密码')).toBeVisible();
  await expect(page.getByText(/应用锁|忘记 PIN|立即锁定/)).toHaveCount(0);
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.getByRole('button', { name: '森林绿', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'forest');
  await assertPhoneLayout(page);
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  expect((await page.request.get('/api/v1/budget/overview')).status()).toBe(401);
});

test('applying a template explicitly rewrites the current cycle', async ({ page, ledger }) => {
  await login(page, ledger);
  await createTemplate(page);
  await salary(page, '1000.00');

  await page.goto('/templates');
  const template = page.locator('.templates > li').filter({ hasText: '手机工资模板' });
  await template.getByRole('button', { name: '编辑', exact: true }).click();
  await page.getByLabel('第 1 个模块的比例').fill('25');
  await page.getByLabel('第 2 个模块的比例').fill('75');
  await page.getByRole('button', { name: '保存', exact: true }).click();

  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('历史周期不变');
    await dialog.accept();
  });
  await page
    .locator('.templates > li')
    .filter({ hasText: '手机工资模板' })
    .getByRole('button', { name: '应用到当前周期', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText('已将');

  await budgetModule(page, '餐饮', 25_000);
  await budgetModule(page, '交通', 75_000);
});
test('hierarchical category spending rolls into a parent budget pool', async ({ page, ledger }) => {
  await login(page, ledger);
  await page.goto('/manage');

  const expenseGroup = page.locator('.group').filter({ hasText: '支出分类' });
  await expenseGroup.getByRole('button', { name: '新建', exact: true }).click();
  await page.getByLabel('名称').fill('生活');
  await page.getByRole('button', { name: '保存', exact: true }).click();

  await expenseGroup
    .locator('li')
    .filter({ hasText: '住房' })
    .getByRole('button', { name: '编辑', exact: true })
    .click();
  await page.getByLabel('父模块').selectOption({ label: '生活' });
  await page.getByRole('button', { name: '保存', exact: true }).click();

  await page.goto('/salary/new');
  await page.getByLabel('工资金额（元）').fill('1000.00');
  await page.getByLabel('发薪日').fill(dateInput());
  await expect(page.getByRole('button', { name: /保存.*预算|保存并开始新周期/ })).toBeVisible();
  await page.getByRole('button', { name: /保存.*预算|保存并开始新周期/ }).click();
  await expect(page).toHaveURL(/\/budget$/);

  await page.goto('/transactions/new');
  await expect(page.getByLabel('分类').locator('option', { hasText: '生活' })).toHaveCount(0);
  await page.getByLabel('分类').selectOption({ label: '住房' });
  await page.getByLabel('金额（元）').fill('50.00');
  await page.getByLabel('日期', { exact: true }).fill(dateInput());
  await page.getByLabel('备注', { exact: true }).fill('水电气');
  await page.getByRole('button', { name: '保存', exact: true }).click();

  const row = await budgetModule(page, '生活', 20_000);
  await expect(row.locator('.child-spend')).toContainText('住房');
  await expect(row.locator('.child-spend')).toContainText(yuan(5_000));
});
test('history and pool include template-excluded expenses across monthly salaries', async ({
  page,
  ledger,
}) => {
  await login(page, ledger);
  await createTemplate(page);
  await salary(page, '1000.00', dateInput(-1));
  await expense(page, {
    amount: '50.00',
    category: '购物',
    note: '上月模板外支出',
    date: dateInput(-1, 2),
  });
  await expense(page, {
    amount: '100.00',
    category: '餐饮',
    note: '上月餐饮',
    date: dateInput(-1, 2),
  });
  await salary(page, '2000.00');
  await expect(page.locator('.pool strong')).toHaveText(yuan(85_000));
  const periods = await json(page, '/budget/periods');
  expect(periods.periods).toHaveLength(2);
  await page.getByLabel('查看周期').selectOption(String(periods.periods[0]));
  await expect(page.locator('.history-note')).toBeVisible();
  await expect(page.locator('.summary')).toContainText(yuan(100_000));
  await expect(page.locator('.summary')).toContainText(yuan(15_000));
  await expect(page.locator('.modules > li').filter({ hasText: '购物' })).toContainText(
    yuan(-5_000),
  );
  await page.getByRole('button', { name: '回到当前周期' }).click();
  await expect(page.locator('.summary')).toContainText(yuan(200_000));
  await expect(page.locator('.pool strong')).toHaveText(yuan(85_000));
});

test('server outage is visible, draft survives, and retry saves exactly once', async ({
  page,
  ledger,
}) => {
  await login(page, ledger);
  await page.goto('/transactions/new');
  await page.getByLabel('金额（元）').fill('19.99');
  await page.getByLabel('备注', { exact: true }).fill('网络恢复测试');
  await ledger.stop();
  const reachable = await page.evaluate(() =>
    fetch('/api/v1/health')
      .then(() => true)
      .catch(() => false),
  );
  expect(reachable, 'The failure is real, not a no-op offline simulation').toBe(false);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('[role=alert]')).toContainText(/网络|连接|离线/);
  await expect(page.locator('.banner')).toContainText('记账需要联网');
  await expect(page.getByLabel('金额（元）')).toHaveValue('19.99');
  await ledger.start();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page).toHaveURL(/\/transactions$/);
  const list = await json(page, '/transactions');
  expect(list.items).toHaveLength(1);
  expect(list.items[0].amountCents).toBe(1_999);
});

test('AI natural-language draft fills the form but waits for normal save', async ({
  page,
  ledger,
}) => {
  await login(page, ledger);
  await page.route('**/api/v1/ai/transaction-draft', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        type: 0,
        amountCents: 3_500,
        categoryId: 'builtin-expense-food',
        accountId: 'builtin-default-account',
        date: Date.UTC(2026, 8, 20),
        note: '午饭',
        tags: ['午餐'],
        confidence: 0.96,
        reason: '用户描述了午饭消费。',
        missing: [],
      }),
    });
  });

  await page.goto('/transactions/new');
  await page.getByLabel('自然语言记账描述').fill('昨天午饭 35 元，默认账户支付');
  await page.getByRole('button', { name: 'AI 识别', exact: true }).click();
  await expect(page.getByLabel('金额（元）')).toHaveValue('35.00');
  await expect(page.getByLabel('备注', { exact: true })).toHaveValue('午饭');
  await expect(page.getByLabel('分类')).toHaveValue('builtin-expense-food');
  await expect(page.getByRole('status')).toContainText('填入下方表单');

  const before = await json(page, '/transactions');
  expect(before.total).toBe(0);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page).toHaveURL(/\/transactions$/);
  await expect(page.locator('li').filter({ hasText: '午饭' })).toBeVisible();
});

test('phone routes, installation hint and light/dark layouts remain usable', async ({
  page,
  ledger,
}, testInfo) => {
  await login(page, ledger);
  await expect(page.getByRole('complementary').filter({ hasText: '添加到主屏幕' })).toBeVisible();

  // The home screen's asset card: the total is the first figure a user looks for, and it
  // must be the server's own number rather than a blank or a fabricated zero.
  await page.goto('/');
  const assetTotal = page.locator('.asset-total');
  await expect(assetTotal).toBeVisible();
  const liveTotal = await json(page, '/accounts/balances');
  const cents = Math.round(Number((await assetTotal.innerText()).replace(/[^0-9.-]/g, '')) * 100);
  expect(cents).toBe(liveTotal.totalBalanceCents);
  await expect(page.locator('.asset-rows > li')).toHaveCount(liveTotal.items.length);

  for (const width of [375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    for (const route of [
      '/',
      '/transactions',
      '/budget',
      '/salary/new',
      '/templates',
      '/stats',
      '/manage',
      '/data',
      '/settings',
      '/settings/ai',
      '/trash',
      '/transfers',
      '/transfers/new',
    ]) {
      await page.goto(route);
      await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
      await expect(page.locator('main')).not.toContainText('加载中');
      await assertPhoneLayout(page);
    }
  }
  await page.screenshot({ path: testInfo.outputPath('settings-iphone.png'), fullPage: true });
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'standalone', { get: () => true }),
  );
  await page.goto('/');
  await expect(page.getByRole('complementary').filter({ hasText: '添加到主屏幕' })).toHaveCount(0);
});
