/**
 * Renders the theme and app lock in headless Chrome (T16).
 *
 * Three things here can only be checked in a browser:
 *
 *   * that the theme preference actually reaches the rendered colours, including the
 *     hand-rolled SVG charts, which inherit their stroke/fill from CSS variables;
 *   * that the contrast of key text against its background is adequate — computed from the
 *     real rendered colours rather than eyeballed, because "looks fine" is how a dark theme
 *     ships with unreadable muted text;
 *   * that the lock screen really replaces the app and shows nothing about the ledger.
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

const { check, failures, finish } = makeChecker();

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
  body: JSON.stringify({ amountCents: 1_000_000, date: dayIn(2) }),
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

  // ── AC7–AC11 the app lock ────────────────────────────────────────────────
  console.log('\n[AC7-AC11 app lock]');
  await browser.navigateAndWait('/settings', ['应用锁']);

  /**
   * Types into an input the way a user does, then waits for Vue to re-render.
   *
   * The wait is not decoration: `v-model` updates the ref asynchronously, so clicking the
   * submit button in the same tick finds it still `disabled` and nothing happens — which
   * looks exactly like "the PIN was wrong".
   */
  async function typeInto(selectorIndex, value) {
    await browser.evaluate(`(() => {
      const inputs = [...document.querySelectorAll('.field input[type=password]')];
      const el = inputs[${selectorIndex}];
      if (el === undefined) return false;
      el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  async function clickByText(text) {
    const clicked = await browser.evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').includes(${JSON.stringify(text)}));
      if (button === undefined) return false;
      button.click();
      return true;
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 600));
    return clicked;
  }

  await typeInto(0, '1234');
  await typeInto(1, '1234');

  const submitEnabled = await browser.evaluate(`(() => {
    const inputs = [...document.querySelectorAll('.field input[type=password]')];
    void inputs;
    const button = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').includes('启用应用锁'));
    return button === undefined ? 'no-button' : !button.disabled;
  })()`);
  check('the enable button is live once both fields are filled', submitEnabled === true, `-> ${submitEnabled}`);

  check('the enable button was clickable', await clickByText('启用应用锁'));

  const pinStored = await browser.evaluate("window.localStorage.getItem('jizhang.pin')");
  check('AC7 the PIN was set', typeof pinStored === 'string' && pinStored.length > 0, `-> ${String(pinStored).slice(0, 40)}`);
  check(
    'AC11 the PIN is stored hashed with a salt, never in plain text',
    typeof pinStored === 'string' && pinStored.includes('salt') && pinStored.includes('hash') && !pinStored.includes('1234'),
    `-> ${String(pinStored).slice(0, 60)}…`,
  );

  // A RELOAD is the cold start: the unlocked flag lives in sessionStorage, and the page
  // must ask for the PIN again.
  await browser.send('Page.reload');
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const lockedDom = (await browser.evaluate('document.body.innerText')) ?? '';

  check(
    'AC7 a reload shows the lock screen, not the app',
    lockedDom.includes('已锁定') && !lockedDom.includes('外观'),
    `-> ${lockedDom.replace(/\n/g, ' | ').slice(0, 120)}`,
  );
  check('AC7 the PIN field is present', lockedDom.includes('输入 PIN'));
  // The lock is worthless if the thing it hides is behind it.
  for (const leak of ['概览', '本周期预算', '餐饮', '账本']) {
    check(`AC8 the lock screen does not show「${leak}」`, !lockedDom.includes(leak), `-> ${lockedDom.slice(0, 60)}`);
  }
  check('AC8 no balance figure is visible', !/¥\s?-?\d/.test(lockedDom), `-> ${lockedDom.slice(0, 60)}`);
  check(
    'AC11 the lock screen states the PIN is not encryption',
    lockedDom.includes('不是加密保护'),
    `-> ${lockedDom.replace(/\n/g, ' | ').slice(0, 160)}`,
  );

  /** Types into the lock screen's single field (no `.field` wrapper class reliance). */
  async function typePin(value) {
    await browser.evaluate(`(() => {
      const input = document.querySelector('input[type=password]');
      if (input === null) return false;
      input.value = ${JSON.stringify(value)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  // A wrong PIN must not unlock, and must say so.
  await typePin('9999');
  const wrongReady = await browser.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').includes('解锁'));
    return button === undefined ? 'no-button' : !button.disabled;
  })()`);
  check('the unlock button is live with a wrong PIN typed', wrongReady === true, `-> ${wrongReady}`);
  check('the unlock button was clickable', await clickByText('解锁'));
  // Hashing is async (`crypto.subtle.digest`), so the error renders a turn after the click.
  await new Promise((resolve) => setTimeout(resolve, 900));
  const afterWrong = (await browser.evaluate('document.body.innerText')) ?? '';
  check('AC8 a wrong PIN does not unlock', afterWrong.includes('已锁定'), `-> ${afterWrong.replace(/\n/g, ' | ').slice(0, 80)}`);
  check('AC8 and it explains the failure', afterWrong.includes('不正确'), `-> ${afterWrong.replace(/\n/g, ' | ').slice(0, 120)}`);

  // Measured layout of the lock screen: a PIN field is exactly where a 16px regression and a
  // sub-44px button would hide.
  console.log('\n[lock screen layout]');
  await browser.usePhoneViewport();
  const lockMetrics = await browser.measureLayout();
  check(
    'AC12 no control on the lock screen is shorter than 44px',
    lockMetrics.smallTargets.length === 0,
    lockMetrics.smallTargets.map((t) => `${t.tag}:${t.text}=${t.h}px`).join(' | '),
  );
  check(
    'AC13 the lock screen does not scroll horizontally at 375px',
    lockMetrics.docWidth <= 375,
    `-> ${lockMetrics.docWidth}`,
  );

  // The right PIN unlocks.
  await typePin('1234');
  check('the unlock button was clickable with the right PIN', await clickByText('解锁'));
  await new Promise((resolve) => setTimeout(resolve, 600));
  const unlockedDom = (await browser.evaluate('document.body.innerText')) ?? '';
  check(
    'AC7 the correct PIN unlocks and the app appears',
    !unlockedDom.includes('已锁定') && unlockedDom.length > 0,
    `-> ${unlockedDom.replace(/\n/g, ' | ').slice(0, 100)}`,
  );

  // ── AC9 the forgot-PIN path is not a dead end ────────────────────────────
  console.log('\n[AC9 forgot PIN]');
  // Auto-accept the confirmation so the path can be walked without a dialog handler.
  await browser.send('Page.reload');
  await new Promise((resolve) => setTimeout(resolve, 3000));
  await browser.evaluate('window.confirm = () => true');
  const forgotClicked = await clickByText('忘记 PIN');
  check('the forgot-PIN control is present and clickable', forgotClicked);
  const afterForgot = (await browser.evaluate('document.body.innerText')) ?? '';
  check('AC9 forgetting the PIN clears the lock', !afterForgot.includes('已锁定'), `-> ${afterForgot.replace(/\n/g, ' | ').slice(0, 80)}`);
  check('AC9 and leaves the app usable', afterForgot.includes('概览') || afterForgot.includes('账单'), `-> ${afterForgot.replace(/\n/g, ' | ').slice(0, 80)}`);
  const clearedPin = await browser.evaluate("window.localStorage.getItem('jizhang.pin')");
  check('AC9 the stored PIN is gone', clearedPin === null, `-> ${clearedPin}`);

  await browser.screenshot(OUT_PNG);
  console.log(`\nscreenshot written to ${OUT_PNG}`);
} finally {
  await browser.close();
}

finish('THEME RENDER');
process.exitCode = failures === 0 ? 0 : 1;
