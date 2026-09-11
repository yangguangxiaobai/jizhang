/**
 * Renders the budget page in headless Chrome and verifies the period switcher works.
 *
 * The API suites prove the historical endpoint returns the right numbers. This proves a
 * person can actually reach them: that the switcher appears, that choosing a past cycle
 * changes what is on screen, that the page SAYS it is showing history (otherwise the
 * same layout silently displays different numbers), and that the control is reachable at
 * the narrowest phone width.
 *
 * It seeds two past cycles and one current cycle over HTTP, then drives the real
 * `<select>`.
 *
 * Usage: node scripts/render-budget.mjs <out.png> [base-url]
 */

import { execFileSync } from 'node:child_process';

import { makeChecker, openBrowser, PHONE_VIEWPORT } from './lib/browser.mjs';

const OUT_PNG = process.argv[2] ?? 'budget.png';
const ORIGIN = process.argv[3] ?? 'http://127.0.0.1:8081';
const BASE = `${ORIGIN}/api/v1`;

const { check, failures, finish } = makeChecker();

// ── start from the suite baseline ────────────────────────────────────────────
// This script asserts on the OLDEST cycle, so it must not inherit whatever cycles a
// previously-run suite left behind — that is exactly how a run passes in isolation and
// fails in sequence.
//
// The reset is invoked INSIDE the container through the server's own module rather than
// imported: `lib/e2e-reset.mjs` resolves `dist/` relative to itself, so importing it from
// the web package would look for a path that only exists in the image.
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
const authHeaders = { Cookie: cookie };

const now = new Date();
const dayIn = (offset, day) =>
  new Date(now.getFullYear(), now.getMonth() + offset, day).getTime();

const FOOD = 'builtin-expense-food';
const TRANSPORT = 'builtin-expense-transport';
const ACCOUNT = 'builtin-default-account';

const post = async (path, body) =>
  fetch(`${BASE}${path}`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) });

// Two past cycles with distinct budgets, plus the current one.
const oldest = await post('/salaries', {
  amountCents: 500_000,
  date: dayIn(-2, 3),
  allocations: [
    { categoryId: FOOD, amountCents: 300_000 },
    { categoryId: TRANSPORT, amountCents: 200_000 },
  ],
});
const middle = await post('/salaries', {
  amountCents: 1_000_000,
  date: dayIn(-1, 5),
  allocations: [
    { categoryId: FOOD, amountCents: 400_000 },
    { categoryId: TRANSPORT, amountCents: 600_000 },
  ],
});
const current = await post('/salaries', {
  amountCents: 2_000_000,
  date: dayIn(0, 2),
  allocations: [{ categoryId: FOOD, amountCents: 2_000_000 }],
});
check(
  'three cycles were seeded',
  oldest.status === 201 && middle.status === 201 && current.status === 201,
  `-> ${oldest.status}/${middle.status}/${current.status}`,
);
await post('/transactions', {
  type: 0,
  amountCents: 200_000,
  categoryId: FOOD,
  accountId: ACCOUNT,
  date: dayIn(-2, 12),
  note: '旧周期买菜',
});

const periods = (await (await fetch(`${BASE}/budget/periods`, { headers: authHeaders })).json())
  .periods;
check('the server reports three cycles', periods.length === 3, `-> ${periods.length}`);

const browser = await openBrowser({
  origin: ORIGIN,
  profileDir: `${process.env.TEMP ?? '/tmp'}/jizhang-cdp-budget`,
});

try {
  console.log(`browser: ${browser.browserVersion}`);

  // ── the current cycle ─────────────────────────────────────────────────────
  const dom = await browser.navigateAndWait('/budget', ['本周期预算', '查看周期']);
  console.log('\n[budget page, current cycle]');
  check('the page mounted and left the login screen', !dom.includes('用户名'), `-> ${dom.slice(0, 50)}`);
  check('the period switcher is offered', dom.includes('查看周期'));
  check('it is labelled as the current cycle', dom.includes('（当前）'), `-> ${dom.slice(0, 120)}`);
  check(
    'no history notice is shown for the current cycle',
    !dom.includes('正在查看历史周期'),
    `-> ${dom.slice(0, 120)}`,
  );
  // The current cycle budgets 2,000,000 cents = ¥20000.00.
  check('the current cycle numbers are on screen', dom.includes('20000.00'), `-> ${dom.slice(0, 160)}`);
  check('no runtime errors were logged', browser.consoleErrors.length === 0, browser.consoleErrors.join(' | '));

  // ── switch to the oldest cycle ────────────────────────────────────────────
  console.log('\n[switch to a historical cycle]');
  // Choose the oldest option through the real element, then let Vue react.
  const options = await browser.evaluate(
    '[...document.querySelectorAll(".period select option")].map((o) => o.value)',
  );
  check('the switcher lists every cycle', options.length === 3, `-> ${options.length}`);

  await browser.evaluate(`(() => {
    const select = document.querySelector('.period select');
    if (select === null) return false;
    select.value = ${JSON.stringify(String(periods[0]))};
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 1200));

  const historicalDom = (await browser.evaluate('document.body.innerText')) ?? '';
  console.log('\n--- historical cycle text ---');
  console.log(historicalDom.split('\n').filter((line) => line.trim() !== '').join(' | '));

  check(
    'AC6 the page announces it is showing history',
    historicalDom.includes('正在查看历史周期'),
    `-> ${historicalDom.slice(0, 140)}`,
  );
  // The oldest cycle budgets 500,000 cents = ¥5000.00.
  check(
    'AC1 the historical budget is on screen',
    historicalDom.includes('5000.00'),
    `-> ${historicalDom.slice(0, 200)}`,
  );
  check(
    'AC1 the current cycle figure is no longer shown',
    !historicalDom.includes('20000.00'),
    `-> ${historicalDom.slice(0, 200)}`,
  );
  check(
    'AC1 the historical spend is shown',
    historicalDom.includes('2000.00'),
    `-> ${historicalDom.slice(0, 200)}`,
  );
  check('AC6 a way back to the current cycle is offered', historicalDom.includes('回到当前周期'));

  // ── measured layout at phone width, in the historical state ───────────────
  console.log('\n[measured layout]');
  await browser.usePhoneViewport();
  const metrics = await browser.measureLayout();

  check(
    `the page does not scroll horizontally at ${PHONE_VIEWPORT.width}px`,
    metrics.docWidth <= PHONE_VIEWPORT.width,
    `-> scrollWidth ${metrics.docWidth}`,
  );
  check(
    'no interactive control is shorter than 44px',
    metrics.smallTargets.length === 0,
    metrics.smallTargets.map((t) => `${t.tag}:${t.text}=${t.h}px`).join(' | '),
  );
  check('the tab bar is still six items', metrics.tabs.length === 6, `-> ${metrics.tabs.length}`);
  check(
    'the 预算 tab is the active one on this route',
    metrics.tabs.some((tab) => tab.label === '预算' && tab.w > 0),
  );

  // ── back to the current cycle ─────────────────────────────────────────────
  console.log('\n[back to the current cycle]');
  await browser.evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')];
    const back = buttons.find((b) => (b.innerText || '').includes('回到当前周期'));
    if (back === undefined) return false;
    back.click();
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 1200));

  const backDom = (await browser.evaluate('document.body.innerText')) ?? '';
  check('AC6 the history notice is gone', !backDom.includes('正在查看历史周期'), `-> ${backDom.slice(0, 120)}`);
  check('AC6 the current cycle figures are back', backDom.includes('20000.00'), `-> ${backDom.slice(0, 160)}`);

  await browser.screenshot(OUT_PNG);
  console.log(`\nscreenshot written to ${OUT_PNG}`);
} finally {
  await browser.close();
}

finish('BUDGET RENDER');
process.exitCode = failures === 0 ? 0 : 1;
