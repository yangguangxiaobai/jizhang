import { test, expect } from './fixtures.mjs';
import { assertPhoneLayout } from './helpers.mjs';
import { createHash } from 'node:crypto';

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

async function expense(page, { amount, category, note, date = dateInput(), refund = false, refundOfNote }) {
  await page.goto('/transactions/new');
  if (refund) await page.getByRole('radio', { name: '收入', exact: true }).click();
  await page.getByLabel('金额（元）').fill(amount);
  // Not `exact`: the field's <label> wraps the <select>, so the label's text content
  // includes every option ("分类餐饮交通…") while its accessible name is just "分类".
  if (!refund) await page.getByLabel('分类').selectOption({ label: category });
  await page.getByLabel('日期', { exact: true }).fill(date);
  await page.getByLabel('备注', { exact: true }).fill(note);
  if (refund) {
    await page.getByLabel(/这是退款/).check();
    const candidate = page.locator('.candidate-row').filter({ hasText: refundOfNote });
    await expect(candidate).toBeVisible();
    await candidate.getByRole('button').first().click();
  }
  await assertPhoneLayout(page);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page).toHaveURL(/\/transactions$/);
}

/** Open a transaction's editor through the list's read-only detail dialog. */
const openTransaction = async (page, note) => {
  await page.locator('li').filter({ hasText: note }).getByRole('button').first().click();
  const detail = page.getByRole('dialog');
  await expect(detail).toBeVisible();
  await detail.getByRole('button', { name: '编辑', exact: true }).click();
};

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

  await expense(page, {
    amount: '23.45',
    category: '交通',
    note: '手机退款',
    refund: true,
    refundOfNote: '手机午饭',
  });
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

const assistantConversationFixture = {
  id: 'conversation-1',
  title: '新对话',
  archived: false,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

function assistantMessageFixture(id, role, kind, content) {
  return {
    id,
    conversationId: assistantConversationFixture.id,
    role,
    kind,
    content: { version: 1, ...content },
    createdAt: Date.now(),
  };
}

function assistantCardFixture(actionId, toolName, values = {}, preview = {}, attachment = undefined) {
  return {
    version: 1,
    actionId,
    toolName,
    operation: toolName === 'transaction.create' ? '新增账单' : toolName === 'platform-import.prepare' ? '账单导入' : '分类整理',
    summary: '请检查这项操作后再确认。',
    writes: true,
    affected: { count: 1 },
    values,
    warnings: [],
    fingerprint: 'fingerprint-' + actionId,
    status: 'pending',
    preview,
    ...(attachment === undefined ? {} : { attachment }),
  };
}

function assistantPendingActionFixture(actionId, toolName, status, attachment = null) {
  return {
    id: actionId,
    conversationId: assistantConversationFixture.id,
    sourceMessageId: 'card-' + actionId,
    toolName,
    arguments: {},
    preview: {},
    fingerprint: 'fingerprint-' + actionId,
    attachment,
    status,
    result: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

async function mockAssistantApi(page, handlers) {
  let timeline = [];
  let messageReads = 0;
  await page.route('**/api/v1/assistant/conversations', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { items: [assistantConversationFixture] } });
      return;
    }
    await route.fulfill({ json: assistantConversationFixture });
  });
  await page.route('**/api/v1/assistant/conversations/*/messages', async (route) => {
    if (route.request().method() === 'GET') {
      messageReads += 1;
      await route.fulfill({ json: { items: timeline } });
      return;
    }
    const input = route.request().postDataJSON();
    timeline = await handlers.onSend(input, timeline);
    await route.fulfill({ json: { items: timeline } });
  });
  await page.route('**/api/v1/assistant/actions/*/confirm', async (route) => {
    const input = route.request().postDataJSON();
    const result = await handlers.onConfirm(input, timeline);
    timeline = result.items;
    await route.fulfill({ json: { action: result.action, message: result.message } });
  });
  await page.route('**/api/v1/assistant/actions/*/cancel', async (route) => {
    await route.fulfill({ json: { action: assistantPendingActionFixture('cancelled', 'transaction.create', 'cancelled') } });
  });
  await page.route('**/api/v1/assistant/conversations/*', async (route) => {
    if (route.request().method() === 'DELETE') await route.fulfill({ json: { ok: true } });
    else await route.fallback();
  });
  return {
    get timeline() { return timeline; },
    get messageReads() { return messageReads; },
  };
}

// These browser flows use page.route() API fixtures. A controlling service worker would
// own some fetches and bypass those fixtures, so isolate only the assistant mock tests.
test.describe('assistant browser flows', () => {
test.use({ serviceWorkers: 'block' });

test('assistant transaction workflow waits for one explicit confirmation and keeps manual entry', async ({
  page,
  ledger,
}) => {
  await login(page, ledger);
  let sendCalls = 0;
  let confirmCalls = 0;
  let createdTransactions = 0;
  const mocked = await mockAssistantApi(page, {
    onSend: async (input) => {
      sendCalls += 1;
      expect(input.text).toContain('午饭');
      expect(typeof input.clientRequestId).toBe('string');
      return [
        assistantMessageFixture('user-1', 'user', 'text', { text: input.text }),
        assistantMessageFixture('card-tx-1', 'assistant', 'tool-card', {
          text: '请检查这笔支出草稿。',
          card: assistantCardFixture('tx-1', 'transaction.create', {
            type: 0,
            amountCents: 3500,
            categoryId: 'builtin-expense-food',
            accountId: 'builtin-default-account',
            date: Date.UTC(2026, 8, 20),
            note: '午饭',
            tags: [],
          }, { input: { amountCents: 3500, note: '午饭' } }),
        }),
      ];
    },
    onConfirm: async (_input, timeline) => {
      confirmCalls += 1;
      createdTransactions += 1;
      const completed = timeline.map((message) =>
        message.content.card?.actionId === 'tx-1'
          ? { ...message, content: { ...message.content, card: { ...message.content.card, status: 'confirmed' } } }
          : message,
      );
      const resultMessage = assistantMessageFixture('result-tx-1', 'assistant', 'result', {
        result: { version: 1, toolName: 'transaction.create', summary: '已新增一笔支出。', data: { transactionId: 'normal-transaction-id' } },
      });
      return {
        items: [...completed, resultMessage],
        action: assistantPendingActionFixture('tx-1', 'transaction.create', 'confirmed'),
        message: resultMessage,
      };
    },
  });

  await page.goto('/assistant');
  await page.getByLabel('发送消息').fill('帮我记一笔昨天午饭 35 元');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByRole('button', { name: '确认写入', exact: true })).toBeVisible();
  expect(sendCalls).toBe(1);
  expect(confirmCalls).toBe(0);
  expect(createdTransactions).toBe(0);
  await assertPhoneLayout(page);

  await page.getByRole('button', { name: '确认写入', exact: true }).click();
  await expect(page.getByText('已新增一笔支出。', { exact: true })).toBeVisible();
  expect(mocked.messageReads).toBe(2);
  expect(confirmCalls).toBe(1);
  expect(createdTransactions).toBe(1);
  await assertPhoneLayout(page);

  await page.goto('/transactions');
  await page.getByRole('button', { name: /记一笔/ }).click();
  await expect(page).toHaveURL(/\/transactions\/new$/);
});

test('assistant shows server facts and organization previews in the same timeline', async ({
  page,
  ledger,
}) => {
  await login(page, ledger);
  await mockAssistantApi(page, {
    onSend: async (input, timeline) => {
      const user = assistantMessageFixture('user-' + timeline.length, 'user', 'text', { text: input.text });
      if (input.text.includes('本月')) {
        return [
          ...timeline,
          user,
          assistantMessageFixture('monthly-result', 'assistant', 'result', {
            result: {
              version: 1,
              toolName: 'monthly.evaluate',
              summary: '本月评价依据服务端事实。',
              data: {
                period: { month: '2026-09' },
                facts: { netExpenseCents: 3500, incomeCents: 100000, evidenceIds: ['monthly.expense', 'monthly.income'] },
                evaluation: { summary: { text: '本月记录的收入覆盖了支出。', evidenceIds: ['monthly.income', 'monthly.expense'] } },
              },
            },
          }),
        ];
      }
      if (input.text.includes('分类整理')) {
        return [
          ...timeline,
          user,
          assistantMessageFixture('organization-result', 'assistant', 'result', {
            result: {
              version: 1,
              toolName: 'organization.preview',
              summary: '分类整理预览尚未写入。',
              data: { actions: [{ kind: 'category-merge', sourceName: '出行', targetName: '旅行', status: 'ready', affected: { transactions: 2 } }] },
            },
          }),
        ];
      }
      return [...timeline, user];
    },
    onConfirm: async () => { throw new Error('No write confirmation expected in the read preview test.'); },
  });

  await page.goto('/assistant');
  await page.getByLabel('发送消息').fill('本月净支出是多少？');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByText('本月评价依据服务端事实。', { exact: true })).toBeVisible();
  await page.locator('summary').filter({ hasText: '查看结果详情' }).click();
  await expect(page.locator('pre')).toContainText('"netExpenseCents": 3500');
  await page.getByLabel('发送消息').fill('请给出分类整理预览');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByText('分类整理预览尚未写入。', { exact: true })).toBeVisible();
  await page.locator('summary').filter({ hasText: '查看结果详情' }).last().click();
  await expect(page.locator('pre').last()).toContainText('category-merge');
  await expect(page.locator('pre').last()).toContainText('旅行');
  await assertPhoneLayout(page);
});

test('assistant platform import keeps bytes in memory, restores by digest, and confirms selected rows', async ({
  page,
  ledger,
}) => {
  await login(page, ledger);
  const fileBytes = Buffer.from('账单导入测试,wx-1\\r\\n', 'utf8');
  const fileName = 'wechat-bills.xlsx';
  const digest = createHash('sha256').update(fileBytes).digest('hex');
  const metadata = { source: 'wechat', fileName, sizeBytes: fileBytes.length, sha256: digest };
  const rows = [
    { id: 'wx-row-1', dateLabel: '2026-09-20', type: 0, amountCents: 3500, note: '午饭', counterparty: '食堂', sourceCategory: '餐饮', categoryName: '餐饮', accountName: '微信', ignored: false, ignoreReason: null, alreadyExists: false, possibleDuplicate: false, duplicateOfNote: null },
    { id: 'wx-row-soft', dateLabel: '2026-09-20', type: 0, amountCents: 2500, note: '咖啡', counterparty: '咖啡店', sourceCategory: '餐饮', categoryName: '餐饮', accountName: '微信', ignored: false, ignoreReason: null, alreadyExists: false, possibleDuplicate: true, duplicateOfNote: '手记咖啡' },
    { id: 'wx-row-hard', dateLabel: '2026-09-19', type: 0, amountCents: 1200, note: '已导入', counterparty: '', sourceCategory: '餐饮', categoryName: '餐饮', accountName: '微信', ignored: false, ignoreReason: null, alreadyExists: true, possibleDuplicate: false, duplicateOfNote: null },
    { id: 'wx-row-ignored', dateLabel: '2026-09-19', type: 0, amountCents: 0, note: '提现', counterparty: '', sourceCategory: '', categoryName: '', accountName: '微信', ignored: true, ignoreReason: '不计收支', alreadyExists: false, possibleDuplicate: false, duplicateOfNote: null },
  ];
  let confirmationInput;
  const mocked = await mockAssistantApi(page, {
    onSend: async (input) => {
      expect(Buffer.from(input.attachment.fileBase64, 'base64')).toEqual(fileBytes);
      const user = assistantMessageFixture('user-file', 'user', 'attachment', {
        text: input.text,
        attachment: metadata,
      });
      return [
        user,
        assistantMessageFixture('import-card', 'assistant', 'tool-card', {
          card: assistantCardFixture('import-1', 'platform-import.prepare', {
            source: 'wechat',
            total: 4,
            selected: 3,
            expenseCents: 6000,
            incomeCents: 0,
          }, { total: 4, rows }, metadata),
        }),
      ];
    },
    onConfirm: async (input, timeline) => {
      confirmationInput = input;
      const items = timeline.map((message) =>
        message.content.card?.actionId === 'import-1'
          ? { ...message, content: { ...message.content, card: { ...message.content.card, status: 'confirmed' } } }
          : message,
      );
      const resultMessage = assistantMessageFixture('import-result', 'assistant', 'result', {
        result: { version: 1, toolName: 'platform-import.prepare', summary: '已导入所选账单。', data: { inserted: input.selectedIds.length, skipped: 0 } },
      });
      return {
        items: [...items, resultMessage],
        action: assistantPendingActionFixture('import-1', 'platform-import.prepare', 'confirmed', metadata),
        message: resultMessage,
      };
    },
  });

  await page.goto('/assistant');
  await page.getByLabel('发送消息').fill('预览并导入微信账单');
  await page.getByLabel('添加账单').setInputFiles({ name: fileName, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: fileBytes });
  await expect(page.getByText(fileName + ' · application/vnd.openxmlformats-officedocument.spreadsheetml.sheet · ' + fileBytes.length + ' B')).toBeVisible();
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByText('可能重复（已有备注：手记咖啡），默认未选', { exact: true })).toBeVisible();
  await expect(page.getByText('已过滤 / 已存在（2）', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '确认导入所选行', exact: true })).toBeVisible();
  expect(JSON.stringify(mocked.timeline)).not.toContain(fileBytes.toString('utf8'));
  await assertPhoneLayout(page);

  await page.reload();
  await expect(page.getByText('刷新后请重新附加同一文件', { exact: true })).toBeVisible();
  const reattachLabel = page.locator('label').filter({ hasText: '刷新后请重新附加同一文件' });
  await expect(page.getByRole('button', { name: '确认导入所选行', exact: true })).toBeDisabled();
  await reattachLabel.locator('input[type="file"]').setInputFiles({ name: fileName, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: fileBytes });
  await expect(reattachLabel).toHaveCount(0);
  await expect(page.getByRole('button', { name: '确认导入所选行', exact: true })).toBeEnabled();
  const firstRow = page.locator('.import-row').filter({ hasText: '午饭' });
  await firstRow.locator('select').selectOption({ label: '购物' });
  await page.getByRole('button', { name: '确认导入所选行', exact: true }).click();
  await expect(page.getByText('已导入所选账单。', { exact: true })).toBeVisible();
  expect(confirmationInput.selectedIds).toEqual(['wx-row-1']);
  expect(confirmationInput.categoryOverrides).toEqual({ 'wx-row-1': '购物' });
  expect(Buffer.from(confirmationInput.fileBase64, 'base64')).toEqual(fileBytes);
  expect(confirmationInput).not.toHaveProperty('sha256');
  await assertPhoneLayout(page);
});
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
      '/assistant',
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
