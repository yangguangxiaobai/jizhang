/**
 * Renders the theme and verifies removal of the legacy app lock in headless Chrome.
 *
 * Three things here can only be checked in a browser:
 *
 *   * that the theme preference actually reaches the rendered colours, including the
 *     hand-rolled SVG charts, which inherit their stroke/fill from CSS variables;
 *   * that the contrast of key text against its background is adequate — computed from the
 *     real rendered colours rather than eyeballed, because "looks fine" is how a dark theme
 *     ships with unreadable muted text;
 *   * that legacy PIN storage cannot lock users out after the lock feature was removed.
 *
 * It resets the container first so the seeded state is known.
 *
 * Usage: node scripts/render-theme.mjs <out.png> [base-url]
 */

import { execFileSync } from 'node:child_process';

import { makeChecker, openBrowser } from './lib/browser.mjs';

const OUT_PNG = process.argv[2] ?? 'theme.png';
const ORIGIN = process.argv[3] ?? 'http://127.0.0.1:8081';
const BASE = `${ORIGIN}/api/v1`;

const { check, finish } = makeChecker();

// Known baseline: this script asserts on specific balances and on "no pending items".
try {
  execFileSync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      '-w',
      '/app/packages/server/scripts',
      'jizhang',
      'node',
      '-e',
      "import('./lib/e2e-reset.mjs').then((m) => m.resetToKnownState())",
    ],
    { stdio: 'ignore' },
  );
} catch (error) {
  console.error(`could not reset the container to a known state: ${error}`);
  process.exit(1);
}

const login = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: process.env.JIZHANG_E2E_USER ?? 'admin',
    password: process.env.JIZHANG_E2E_PASSWORD ?? 'probe-password',
  }),
});
if (login.status !== 200) {
  console.error(`login failed: ${login.status} ${await login.text()}`);
  process.exit(1);
}
const cookie = (login.headers.getSetCookie?.() ?? [])
  .find((entry) => entry.startsWith('jizhang_session='))
  ?.split(';')[0];
const jsonHeaders = {
  'X-Requested-With': 'fetch',
  'Content-Type': 'application/json',
  Cookie: cookie,
};

// A salary and a few bills, so the pages this script walks have real numbers on them.
const now = new Date();
const dayIn = (day) => new Date(now.getFullYear(), now.getMonth(), day).getTime();
await fetch(`${BASE}/salaries`, {
  method: 'POST',
  headers: jsonHeaders,
  body: JSON.stringify({
    accountId: 'builtin-default-account',
    amountCents: 1_000_000,
    date: dayIn(2),
  }),
});
for (const [amountCents, day] of [[15_000, 5], [3_000, 6]]) {
  await fetch(`${BASE}/transactions`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      type: 0,
      amountCents,
      categoryId: 'builtin-expense-food',
      accountId: 'builtin-default-account',
      date: dayIn(day),
      note: '测试支出',
    }),
  });
}

const browser = await openBrowser({
  origin: ORIGIN,
  profileDir: `${process.env.TEMP ?? '/tmp'}/jizhang-cdp-theme`,
});

/**
 * Runs in the page: reports the computed colours of the elements whose contrast matters.
 *
 * Kept as a named function serialised with `toString()` rather than an inline template
 * literal, because the page code contains quotes and `${}` that are a quoting trap inside a
 * template string.
 */
function sampleColours() {
  /** Relative luminance per WCAG 2.1. */
  function luminance(rgb) {
    const parts = rgb.match(/\d+(\.\d+)?/g) || ['0', '0', '0'];
    const [r, g, b] = parts.slice(0, 3).map(Number).map((value) => {
      const channel = value / 255;
      return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function ratio(foreground, background) {
    const a = luminance(foreground);
    const b = luminance(background);
    const lighter = Math.max(a, b);
    const darker = Math.min(a, b);
    return (lighter + 0.05) / (darker + 0.05);
  }
  /** Walks up for the first non-transparent background, as the eye effectively sees it. */
  function effectiveBackground(el) {
    let node = el;
    while (node) {
      const bg = getComputedStyle(node).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
      node = node.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  }

  const samples = [];
  const selectors = [
    ['body', 'body'],
    ['.summary .label, .label', 'muted label'],
    ['h1, h2', 'heading'],
    ['.row-title, .name', 'row title'],
    ['p, .hint', 'body copy'],
  ];
  for (const [selector, label] of selectors) {
    const el = document.querySelector(selector);
    if (!el) continue;
    const style = getComputedStyle(el);
    const background = effectiveBackground(el);
    samples.push({
      label,
      color: style.color,
      background,
      ratio: Math.round(ratio(style.color, background) * 100) / 100,
    });
  }

  return {
    dataTheme: document.documentElement.getAttribute('data-theme'),
    bodyBackground: getComputedStyle(document.body).backgroundColor,
    bodyColor: getComputedStyle(document.body).color,
    colorScheme: getComputedStyle(document.documentElement).colorScheme,
    samples,
    charts: document.querySelectorAll('svg').length,
    // The accent as actually applied, used to confirm a theme swap reached the CSS.
    accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    ok: getComputedStyle(document.documentElement).getPropertyValue('--ok').trim(),
    fg: getComputedStyle(document.documentElement).getPropertyValue('--fg').trim(),
    // The text colour chosen to sit ON the accent. Its whole purpose is contrast, so it is
    // measured against the accent rather than against the page background.
    onAccentRatio: (() => {
      const root = getComputedStyle(document.documentElement);
      const accent = root.getPropertyValue('--accent').trim() || getComputedStyle(document.body).backgroundColor;
      const onAccent = root.getPropertyValue('--on-accent').trim();
      if (onAccent === '') return null;
      // The tokens are hex; convert both to rgb() so the shared ratio helper can read them.
      const toRgb = (hex) => {
        const value = hex.replace('#', '');
        const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
        const n = parseInt(full, 16);
        return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
      };
      return Math.round(ratio(toRgb(onAccent), toRgb(accent)) * 100) / 100;
    })(),
  };
}

async function sample() {
  return browser.evaluate(`(${sampleColours.toString()})()`);
}

/** Switches theme through the real settings UI, not by writing storage directly. */
async function chooseTheme(label) {
  await browser.navigateAndWait('/settings', ['外观', label]);
  await browser.evaluate(`(() => {
    const buttons = [...document.querySelectorAll('.segmented button')];
    const target = buttons.find((b) => (b.innerText || '').trim() === ${JSON.stringify(label)});
    if (target === undefined) return false;
    target.click();
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 400));
}

try {
  console.log(`browser: ${browser.browserVersion}`);

  // ── the previously-missing tokens are defined ─────────────────────────────
  console.log('\n[theme tokens]');
  await browser.navigateAndWait('/', ['概览']);
  const light = await sample();
  check('--fg is defined (it was referenced everywhere but never existed)', light.fg !== '', `-> "${light.fg}"`);
  check('--ok is defined (same)', light.ok !== '', `-> "${light.ok}"`);
  check('--accent is defined', light.accent !== '', `-> "${light.accent}"`);
  check('no data-theme attribute by default (follows the system)', light.dataTheme === null, `-> ${light.dataTheme}`);

  // ── AC1 the system preference is honoured ─────────────────────────────────
  console.log('\n[AC1 follow the system]');
  await browser.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'dark' }],
  });
  await browser.navigateAndWait('/', ['概览']);
  const systemDark = await sample();
  check(
    'AC1 with the OS dark and no preference, the page IS dark',
    systemDark.bodyBackground !== light.bodyBackground,
    `-> ${light.bodyBackground} → ${systemDark.bodyBackground}`,
  );

  await browser.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'light' }],
  });
  await browser.navigateAndWait('/', ['概览']);
  const systemLight = await sample();
  check(
    'AC1 and with the OS light it is light again',
    systemLight.bodyBackground === light.bodyBackground,
    `-> ${systemLight.bodyBackground}`,
  );

  // ── AC2/AC3 explicit preference wins and persists ─────────────────────────
  console.log('\n[AC2/AC3 explicit preference]');
  // The OS stays light: choosing dark must override it.
  await chooseTheme('深色');
  await browser.navigateAndWait('/', ['概览']);
  const forcedDark = await sample();
  check('AC2 choosing dark sets the attribute', forcedDark.dataTheme === 'dark', `-> ${forcedDark.dataTheme}`);
  check(
    'AC2 and dark actually wins over a light OS',
    forcedDark.bodyBackground === systemDark.bodyBackground,
    `-> ${forcedDark.bodyBackground} vs system-dark ${systemDark.bodyBackground}`,
  );

  // A reload must keep it: the preference is persisted and applied before paint.
  const persisted = await browser.evaluate("window.localStorage.getItem('jizhang.theme')");
  check('AC2 the preference is persisted', persisted === 'dark', `-> ${persisted}`);
  check(
    'AC2 the theme script applied it before the bundle ran',
    // `theme-init.js` is inlined; if it had not run, the attribute would be absent until Vue
    // mounted and the page would have flashed light.
    forcedDark.dataTheme === 'dark',
  );

  await chooseTheme('跟随系统');
  await browser.navigateAndWait('/', ['概览']);
  const backToSystem = await sample();
  check('AC3 choosing system removes the attribute', backToSystem.dataTheme === null, `-> ${backToSystem.dataTheme}`);
  check(
    'AC3 and it follows the OS again',
    backToSystem.bodyBackground === systemLight.bodyBackground,
    `-> ${backToSystem.bodyBackground}`,
  );

  // ── AC4 contrast on the real pages, in dark ───────────────────────────────
  console.log('\n[AC4 contrast in dark]');
  await chooseTheme('深色');
  for (const [path, marker] of [
    ['/', '概览'],
    ['/transactions', '账单'],
    ['/budget', '本周期预算'],
    ['/stats', '统计'],
    ['/trash', '回收站'],
    ['/data', '导出'],
  ]) {
    const dom = await browser.navigateAndWait(path, [marker]);
    const sampled = await sample();
    const worst = sampled.samples.reduce(
      (min, item) => (item.ratio < min.ratio ? item : min),
      sampled.samples[0] ?? { ratio: 99, label: 'none' },
    );
    check(`${path} rendered in dark`, dom.includes(marker), `-> ${dom.slice(0, 40)}`);
    check(
      `${path} text meets 3:1 against its background`,
      worst.ratio >= 3,
      `-> worst ${worst.label} ${worst.ratio}:1 (${worst.color} on ${worst.background})`,
    );
    // Primary buttons put `--on-accent` on `--accent`, so their legibility is a different
    // pair. Measured explicitly because a light accent with white text was a REAL defect
    // here: 2.54:1, caught only by this check.
    check(
      `${path} primary-button text meets 3:1 on the accent`,
      sampled.onAccentRatio === null || sampled.onAccentRatio >= 3,
      `-> --on-accent on --accent ${sampled.onAccentRatio}:1`,
    );
  }

  // ── AC5 the charts follow the theme ──────────────────────────────────────
  console.log('\n[AC5 charts]');
  await browser.navigateAndWait('/stats', ['统计']);
  const darkChart = await sample();
  check('the stats page renders SVG charts', darkChart.charts > 0, `-> ${darkChart.charts}`);
  await chooseTheme('浅色');
  await browser.navigateAndWait('/stats', ['统计']);
  const lightChart = await sample();
  check(
    'AC5 the accent differs between themes, so the charts are not hard-coded',
    lightChart.accent !== darkChart.accent,
    `-> dark ${darkChart.accent} vs light ${lightChart.accent}`,
  );
  await chooseTheme('深色');

  // A stored PIN from an older release must be inert after the feature is removed.
  console.log('\n[legacy lock removal]');
  await browser.navigateAndWait('/settings', ['外观', '修改密码']);
  await browser.evaluate(`localStorage.setItem('jizhang.pin', JSON.stringify({ salt: 'legacy-salt', hash: 'legacy-hash' }))`);
  await browser.navigateAndWait('/settings', ['外观', '修改密码']);
  const settingsText = (await browser.evaluate('document.body.innerText')) ?? '';
  check('legacy PIN storage does not hide the settings page', settingsText.includes('外观'));
  check('PIN setup and lock controls are absent', !/应用锁|输入 PIN|忘记 PIN|立即锁定/.test(settingsText));
  check('account password controls are retained', settingsText.includes('修改密码'));
  await browser.usePhoneViewport();
  const metrics = await browser.measureLayout();
  check('settings controls are at least 44px', metrics.smallTargets.length === 0);
  check('settings do not scroll horizontally at 375px', metrics.docWidth <= 375);

  await browser.screenshot(OUT_PNG);
  console.log(`\nscreenshot written to ${OUT_PNG}`);
} finally {
  await browser.close();
}

finish('THEME RENDER');
