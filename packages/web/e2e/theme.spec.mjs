import { writeFile } from 'node:fs/promises';
import { test, expect } from './fixtures.mjs';
import { assertPhoneLayout } from './helpers.mjs';
import { contrast, rgbToHex, toRgb } from '../scripts/lib/color.mjs';

const HEADERS = { 'X-Requested-With': 'fetch' };
const PRESETS = { titanium: '钛蓝', forest: '森林绿', mono: '极简黑白' };
const MODES = { light: '浅色', dark: '深色' };
const NAV = [
  ['首页', '/'],
  ['账单', '/transactions'],
  ['预算', '/budget'],
  ['AI 助理', '/assistant'],
  ['统计', '/stats'],
  ['我的', '/settings'],
];
const SEMANTIC = ['--surface', '--ok', '--warning', '--danger', '--cat-1', '--cat-12'];
const hex = (value) => rgbToHex(toRgb(value));
const yuan = (cents) => '¥' + (cents / 100).toFixed(2);

async function api(page, path, data, method = 'POST') {
  const response = await page.request.fetch('/api/v1' + path, { method, headers: HEADERS, data });
  expect(
    response.ok(),
    path + ': ' + response.status() + (response.ok() ? '' : ' ' + (await response.text())),
  ).toBeTruthy();
  return response.json();
}

async function login(page, ledger) {
  await api(page, '/auth/login', { username: ledger.username, password: ledger.password });
  await page.addInitScript(() => localStorage.setItem('jizhang.installHintDismissed', '1'));
}

async function seed(page) {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  await api(
    page,
    '/accounts/builtin-default-account',
    { name: '工资卡', initialBalanceCents: 1800000 },
    'PATCH',
  );
  const wallet = await api(page, '/accounts', {
    name: '微信零钱',
    type: 0,
    initialBalanceCents: 250000,
  });
  const credit = await api(page, '/accounts', {
    name: '信用账户',
    type: 1,
    initialBalanceCents: -50000,
  });
  await api(page, '/salaries', {
    accountId: 'builtin-default-account',
    amountCents: 1200000,
    date,
  });
  for (const [categoryId, amountCents, note, isRefund] of [
    ['builtin-expense-food', 328650, '日常餐饮', false],
    ['builtin-expense-transport', 600, '地铁通勤', false],
    ['builtin-income-refund', 2000, '餐饮退款', true],
  ])
    await api(page, '/transactions', {
      type: isRefund ? 1 : 0,
      categoryId,
      accountId: 'builtin-default-account',
      amountCents,
      note,
      date,
      isRefund,
    });
  await api(page, '/recurring/rules', {
    name: '月度账单',
    type: 0,
    categoryId: 'builtin-expense-food',
    accountId: wallet.id,
    amountCents: 2500,
    frequency: 'monthly',
    anchorDate: date,
  });
  return { wallet, credit };
}

async function open(page, path) {
  await page.goto(path);
  await expect(page.locator('nav[aria-label="主导航"]:visible a')).toHaveCount(6);
  await expect(page.getByText('加载中…', { exact: true })).toHaveCount(0);
  if (path === '/') await expect(page.locator('.asset-total')).toBeVisible();
  await settle(page);
}

async function settle(page) {
  await page.evaluate(() =>
    Promise.allSettled(document.getAnimations().map((animation) => animation.finished)),
  );
}

async function tokens(page) {
  return page.evaluate(
    (names) => {
      const style = getComputedStyle(document.documentElement);
      return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name).trim()]));
    },
    [
      '--bg',
      '--hero',
      '--surface-soft',
      '--accent',
      '--accent-subtle',
      '--on-hero',
      '--hero-danger',
      ...SEMANTIC,
    ],
  );
}

/** Samples painted text, not just tokens. Decorative and disabled content is exempt. */
async function assertContrast(page) {
  const pairs = await page.evaluate(() => {
    function background(element) {
      let node = element;
      while (node) {
        const value = getComputedStyle(node).backgroundColor;
        if (value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') return value;
        node = node.parentElement;
      }
      return getComputedStyle(document.body).backgroundColor;
    }
    const seen = new Set();
    const result = [];
    for (const element of document.querySelectorAll('body *')) {
      if (element.closest('svg, script, style, [aria-hidden="true"], :disabled')) continue;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (!box.width || !box.height || style.visibility === 'hidden' || Number(style.opacity) === 0)
        continue;
      const ownText = [...element.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim())
        .join('');
      const text =
        element instanceof HTMLSelectElement ? element.selectedOptions[0]?.text : ownText;
      if (!text) continue;
      const back = background(element);
      const key = style.color + '/' + back;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ text: text.slice(0, 45), color: style.color, background: back });
    }
    const graphics = [...document.querySelectorAll('.fill, .donut .slice')]
      .filter((node) => {
        const box = node.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      })
      .map((node) => ({
        foreground: node.matches('.slice')
          ? getComputedStyle(node).fill
          : getComputedStyle(node).backgroundColor,
        background: background(node.parentElement),
      }));
    return { text: result, graphics };
  });
  for (const graphic of pairs.graphics)
    expect(
      contrast(graphic.foreground, graphic.background),
      'Meaningful graphics meet 3:1',
    ).toBeGreaterThanOrEqual(3);
  expect(pairs.text.length, 'The sampler saw actual text').toBeGreaterThan(2);
  const rated = pairs.text.map((pair) => ({
    ...pair,
    ratio: contrast(pair.color, pair.background),
  }));
  expect(
    rated.filter((pair) => pair.ratio < 4.5),
    'Every enabled text pair meets WCAG AA',
  ).toEqual([]);
  return Math.min(...rated.map((pair) => pair.ratio));
}

test('six palettes reach real pages, previews and persisted preferences without changing financial colors', async ({
  page,
  ledger,
}, testInfo) => {
  await login(page, ledger);
  await seed(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const report = [];
  for (const [mode, modeLabel] of Object.entries(MODES)) {
    const palettes = {};
    for (const [preset, label] of Object.entries(PRESETS)) {
      await open(page, '/settings');
      await page.getByRole('button', { name: modeLabel, exact: true }).click();
      await page.getByRole('button', { name: label, exact: true }).click();
      await expect(page.getByRole('button', { name: label, exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
      expect(await page.locator('html').getAttribute('data-accent')).toBe(
        preset === 'titanium' ? null : preset,
      );
      await settle(page);
      const palette = await tokens(page);
      palettes[preset] = palette;
      for (const semantic of SEMANTIC) expect(palette[semantic]).toBe(palettes.titanium[semantic]);
      for (const path of [
        '/',
        '/transactions',
        '/budget',
        '/stats',
        '/settings',
        '/transactions/new',
      ]) {
        await open(page, path);
        await assertPhoneLayout(page);
        report.push({ mode, preset, path, minimumTextContrast: await assertContrast(page) });
        if (path === '/') {
          const balance = await api(page, '/accounts/balances', undefined, 'GET');
          await expect(page.locator('.asset-total')).toHaveText(yuan(balance.totalBalanceCents));
          await expect(page.locator('.asset-split')).toContainText(
            yuan(balance.totalLiabilitiesCents),
          );
          const hero = await page
            .locator('.asset')
            .evaluate((node) => getComputedStyle(node).backgroundColor);
          expect(hex(hero)).toBe(palette['--hero']);
          const negative = page.locator('.asset-amount.negative').first();
          expect(hex(await negative.evaluate((node) => getComputedStyle(node).color))).toBe(
            palette['--hero-danger'],
          );
          await expect(page.locator('.pending-card')).toBeVisible();
          await expect(page.locator('.tabbar svg')).toHaveCount(6);
          const activeTab = page.locator('.tab.active:not(.primary)');
          const inactiveTab = page.locator('.tab:not(.active):not(.primary)').first();
          expect(
            hex(
              await activeTab
                .locator('.glyph')
                .evaluate((n) => getComputedStyle(n).backgroundColor),
            ),
          ).toBe(palette['--accent-subtle']);
          expect(
            await activeTab.locator('.glyph').evaluate((n) => getComputedStyle(n).transform),
          ).not.toBe('none');
          expect(
            await activeTab.evaluate((n) => Number(getComputedStyle(n).fontWeight)),
          ).toBeGreaterThan(
            await inactiveTab.evaluate((n) => Number(getComputedStyle(n).fontWeight)),
          );
          expect(
            await inactiveTab
              .locator('.glyph')
              .evaluate((n) => getComputedStyle(n).backgroundColor),
          ).toBe('rgba(0, 0, 0, 0)');
          for (const [name, href] of NAV)
            await expect(
              page.getByRole('navigation').getByRole('link', { name, exact: true }),
            ).toHaveAttribute('href', href);
          await page.screenshot({
            path: testInfo.outputPath('dashboard-' + mode + '-' + preset + '.png'),
            fullPage: true,
          });
        }
      }
    }
    expect(new Set(Object.values(palettes).map((p) => p['--bg'])).size).toBe(3);
    expect(new Set(Object.values(palettes).map((p) => p['--hero'])).size).toBe(3);
    await open(page, '/settings');
    for (const [preset, palette] of Object.entries(palettes)) {
      const swatch = page.locator('.theme-preview[data-accent="' + preset + '"]');
      const [pageFill, heroFill] = await swatch
        .locator('rect')
        .evaluateAll((nodes) => nodes.slice(0, 2).map((n) => getComputedStyle(n).fill));
      expect(hex(pageFill)).toBe(palette['--bg']);
      expect(hex(heroFill)).toBe(palette['--hero']);
    }
    await page.screenshot({
      path: testInfo.outputPath('settings-' + mode + '.png'),
      fullPage: true,
    });
  }
  const reportPath = testInfo.outputPath('rendered-contrast.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  await testInfo.attach('rendered-contrast', { path: reportPath, contentType: 'application/json' });
});

test('first paint, explicit overrides, system following and invalid stored values keep their contract', async ({
  page,
  ledger,
}) => {
  await login(page, ledger);
  await page.addInitScript(() => {
    window.themePaints = [];
    new MutationObserver((records) => {
      for (const record of records)
        if (record.target === document.documentElement) {
          window.themePaints.push({
            name: record.attributeName,
            value: document.documentElement.getAttribute(record.attributeName),
            beforeBody: document.body === null,
          });
        }
    }).observe(document, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-theme', 'data-accent'],
    });
  });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await open(page, '/settings');
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.getByRole('button', { name: '森林绿', exact: true }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const paints = await page.evaluate(() => window.themePaints);
  expect(
    paints.some((p) => p.name === 'data-theme' && p.value === 'dark' && p.beforeBody),
  ).toBeTruthy();
  expect(
    paints.some((p) => p.name === 'data-accent' && p.value === 'forest' && p.beforeBody),
  ).toBeTruthy();
  const dark = await tokens(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByRole('button', { name: '浅色', exact: true }).click();
  const light = await tokens(page);
  expect(light['--bg']).not.toBe(dark['--bg']);
  await page.getByRole('button', { name: '跟随系统', exact: true }).click();
  expect(await page.locator('html').getAttribute('data-theme')).toBeNull();
  await expect.poll(async () => (await tokens(page))['--bg']).toBe(dark['--bg']);
  await page.emulateMedia({ colorScheme: 'light' });
  await expect.poll(async () => (await tokens(page))['--bg']).toBe(light['--bg']);
  expect(
    await page
      .locator('meta[name="theme-color"]')
      .evaluateAll((nodes) =>
        nodes.every(
          (n) =>
            n.content ===
            getComputedStyle(document.documentElement).getPropertyValue('--surface').trim(),
        ),
      ),
  ).toBeTruthy();
  await page.evaluate(() => {
    localStorage.setItem('jizhang.theme', 'invalid');
    localStorage.setItem('jizhang.accent', 'invalid');
  });
  await page.reload();
  await expect(page.getByRole('button', { name: '跟随系统', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: '钛蓝', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await page.locator('html').getAttribute('data-accent')).toBeNull();
  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest.background_color).toBe((await tokens(page))['--bg']);
});

test('large signed balances, long names and enlarged text fit the refreshed phone layouts', async ({
  page,
  ledger,
}, testInfo) => {
  await login(page, ledger);
  const { credit } = await seed(page);
  // Use the server's valid maximum (40 characters), not an impossible account name.
  const longName = '账户' + 'W'.repeat(38);
  await api(
    page,
    '/accounts/' + credit.id,
    { name: longName, initialBalanceCents: -123456789012 },
    'PATCH',
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, '/settings');
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.getByRole('button', { name: '极简黑白', exact: true }).click();
  for (const width of [375, 390, 430, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/', '/settings']) {
      await open(page, path);
      await assertPhoneLayout(page);
      await page.addStyleTag({ content: 'html { font-size: 200%; }' });
      await assertPhoneLayout(page);
      const clipped = await page
        .locator('.asset-total, .asset-amount, .asset-name, .figure strong, .txn-amount')
        .evaluateAll((nodes) =>
          nodes
            .filter((node) => {
              const range = document.createRange();
              range.selectNodeContents(node);
              const text = range.getBoundingClientRect();
              const box = node.getBoundingClientRect();
              return (
                text.right > box.right + 1 ||
                text.left < box.left - 1 ||
                getComputedStyle(node).textOverflow === 'ellipsis'
              );
            })
            .map((node) => node.className),
        );
      expect(clipped, 'Money and account labels retain all their text').toEqual([]);
      if (path === '/') {
        await expect(page.locator('.asset-total.negative')).toBeVisible();
        await expect(page.getByText(longName, { exact: true })).toBeVisible();
      }
      await assertContrast(page);
    }
  }
  await page.screenshot({ path: testInfo.outputPath('enlarged-settings.png'), fullPage: true });
});

test('keyboard selection, reduced motion and storage failures remain usable', async ({
  page,
  ledger,
}) => {
  await api(page, '/auth/login', { username: ledger.username, password: ledger.password });
  await page.addInitScript(() => {
    for (const name of ['getItem', 'setItem', 'removeItem'])
      Object.defineProperty(Storage.prototype, name, {
        value() {
          throw new DOMException('Storage disabled', 'SecurityError');
        },
      });
  });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await open(page, '/settings');
  const choice = page.getByRole('button', { name: '森林绿', exact: true });
  await choice.focus();
  await page.keyboard.press('Space');
  await expect(choice).toHaveAttribute('aria-pressed', 'true');
  expect(
    await choice.evaluate(
      (n) => n.matches(':focus-visible') && parseFloat(getComputedStyle(n).outlineWidth) >= 2,
    ),
  ).toBeTruthy();
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--dur-base').trim(),
    ),
  ).toBe('1ms');
  await page.reload();
  await expect(page.getByRole('button', { name: '钛蓝', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: '跟随系统', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await assertPhoneLayout(page);
});

// Page-level interception cannot see a fetch owned by the service worker. Only this fault
// simulation blocks the worker; preference, rendering and existing PWA flows keep it enabled.
test.describe('deterministic HTTP faults', () => {
  test.use({ serviceWorkers: 'block' });

  test('empty, loading and failed balances never become fabricated amounts', async ({
    page,
    ledger,
  }) => {
    await login(page, ledger);
    await open(page, '/');
    await expect(page.locator('.asset-total')).toHaveText('¥0.00');
    await expect(page.getByText('还没有预算周期', { exact: true })).toBeVisible();
    await expect(page.locator('.recent .empty')).toBeVisible();
    await expect(page.locator('.pending-card')).toHaveCount(0);
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    await page.route('**/api/v1/stats/monthly-trend*', async (route) => {
      await gate;
      await route.continue();
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('加载中…', { exact: true })).toBeVisible();
    await expect(page.locator('.asset')).toHaveCount(0);
    release();
    await expect(page.locator('.asset-total')).toBeVisible();
    await page.unroute('**/api/v1/stats/monthly-trend*');
    await page.route('**/api/v1/accounts/balances', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: '余额服务暂不可用' } }),
      }),
    );
    await page.reload();
    await expect(page.getByRole('alert')).toContainText('总余额读取失败');
    await expect(page.locator('.asset')).toHaveCount(0);
    await expect(page.locator('.summary')).toBeVisible();
  });
});
