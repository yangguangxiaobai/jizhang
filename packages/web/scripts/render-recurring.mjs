/**
 * Renders the recurring-bill screens in headless Chrome.
 *
 * The API suites prove the endpoints behave; this proves a person can act on them. Two
 * things in particular are only observable in a browser:
 *
 *   * the dashboard's reminder card must appear WITH a real count when something is
 *     pending and disappear entirely when nothing is — it was built as a placeholder that
 *     must never show a fake zero;
 *   * the confirm/ignore controls must be reachable at 375px, which is where a two-button
 *     row is most likely to squeeze.
 *
 * It seeds its own rule over HTTP so the browser only has to render.
 *
 * Usage: node scripts/render-recurring.mjs <out.png> [base-url]
 */

import { execFileSync } from 'node:child_process';

import { makeChecker, openBrowser, PHONE_VIEWPORT } from './lib/browser.mjs';

const OUT_PNG = process.argv[2] ?? 'recurring.png';
const ORIGIN = process.argv[3] ?? 'http://127.0.0.1:8081';
const BASE = `${ORIGIN}/api/v1`;

const { check, failures, finish } = makeChecker();

// Start from the suite baseline. This script asserts on "nothing pending" at the end, so
// it must not inherit another suite's queue.
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
/**
 * For bodiless mutating calls.
 *
 * The CSRF header is required on every mutation, and `Content-Type` must be ABSENT when
 * there is no body — Fastify answers 400 `FST_ERR_CTP_EMPTY_JSON_BODY` before the route
 * runs. Sending the wrong one here fails silently enough to look like a UI bug.
 */
const csrfHeaders = { 'X-Requested-With': 'fetch', Cookie: cookie };
const authHeaders = { Cookie: cookie };

const now = new Date();
/** A local day `offset` months back — never in the future. */
const monthsAgo = (offset, day) =>
  new Date(now.getFullYear(), now.getMonth() - offset, day).getTime();

const RULE_NAME = '每月房租';

const created = await fetch(`${BASE}/recurring/rules`, {
  method: 'POST',
  headers: jsonHeaders,
  body: JSON.stringify({
    name: RULE_NAME,
    type: 0,
    amountCents: 320_000,
    categoryId: 'builtin-expense-food',
    accountId: 'builtin-default-account',
    frequency: 'monthly',
    anchorDate: monthsAgo(2, 3),
  }),
});
check('the rule was seeded', created.status === 201, `-> ${created.status}`);

const generated = await fetch(`${BASE}/recurring/generate`, {
  method: 'POST',
  // No body -> CSRF header only. Sending `Content-Type` here is what made this call fail
  // with a 400 that looked like "nothing was generated".
  headers: csrfHeaders,
});
check('generation succeeded', generated.status === 200, `-> ${generated.status}`);
const generatedBody = await generated.json();
check('pending items were generated', generatedBody.created > 0, `-> ${generatedBody.created}`);
const pendingTotal = generatedBody.pending;
check('the reported queue size is a number', typeof pendingTotal === 'number', `-> ${pendingTotal}`);

const browser = await openBrowser({
  origin: ORIGIN,
  profileDir: `${process.env.TEMP ?? '/tmp'}/jizhang-cdp-recurring`,
});

try {
  console.log(`browser: ${browser.browserVersion}`);

  // ── the dashboard reminder card ────────────────────────────────────────────
  console.log('\n[AC10 the dashboard reminder]');
  const dashDom = await browser.navigateAndWait('/', ['待确认', '去确认']);
  check('the reminder card is shown', dashDom.includes('待确认'), `-> ${dashDom.slice(0, 100)}`);
  check(
    'AC10 it carries the REAL count, not a placeholder',
    dashDom.includes(`${pendingTotal} 笔到期账单`),
    `-> expected ${pendingTotal}; ${dashDom.replace(/\n/g, ' | ').slice(0, 200)}`,
  );
  check('AC10 it offers a way in', dashDom.includes('去确认'));
  check('the dashboard itself still rendered', dashDom.includes('概览'));

  // ── the pending queue ──────────────────────────────────────────────────────
  console.log('\n[the pending queue]');
  const pendingDom = await browser.navigateAndWait('/pending', ['确认记账', '忽略这期']);
  check('the page mounted', !pendingDom.includes('用户名'), `-> ${pendingDom.slice(0, 50)}`);
  check('every row offers confirm and ignore', pendingDom.includes('确认记账') && pendingDom.includes('忽略这期'));
  check('the queued rule is named', pendingDom.includes(RULE_NAME), `-> ${pendingDom.slice(0, 120)}`);
  check('the amount is shown', pendingDom.includes('3200.00'), `-> ${pendingDom.slice(0, 200)}`);
  check('the due date is shown', pendingDom.includes('到期'));
  check(
    'there is deliberately NO confirm-all button',
    !/全部确认|一键确认/.test(pendingDom),
    '-> a bulk confirm would post bills the user never read',
  );
  check('no runtime errors were logged', browser.consoleErrors.length === 0, browser.consoleErrors.join(' | '));

  console.log('\n--- pending text ---');
  console.log(pendingDom.split('\n').filter((line) => line.trim() !== '').join(' | '));

  // ── measured layout ───────────────────────────────────────────────────────
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

  // ── the rules screen ───────────────────────────────────────────────────────
  console.log('\n[the rules screen]');
  const rulesDom = await browser.navigateAndWait('/recurring', [RULE_NAME, '新建周期账单']);
  check('the rule is listed', rulesDom.includes(RULE_NAME));
  check('it shows the cadence', rulesDom.includes('每月'), `-> ${rulesDom.slice(0, 150)}`);
  check('it offers pause, edit and delete', rulesDom.includes('暂停') && rulesDom.includes('编辑') && rulesDom.includes('删除'));
  check('the new-rule action is present', rulesDom.includes('新建周期账单'));

  const rulesMetrics = await browser.measureLayout();
  check(
    'the rules screen has no undersized control either',
    rulesMetrics.smallTargets.length === 0,
    rulesMetrics.smallTargets.map((t) => `${t.tag}:${t.text}=${t.h}px`).join(' | '),
  );

  await browser.screenshot(OUT_PNG);

  // ── AC10 the card disappears when nothing is pending ──────────────────────
  console.log('\n[AC10 the card disappears]');
  const queue = await (await fetch(`${BASE}/recurring/pending`, { headers: authHeaders })).json();
  for (const item of queue.items) {
    const ignored = await fetch(`${BASE}/recurring/occurrences/${item.id}/ignore`, {
      method: 'POST',
      headers: csrfHeaders,
    });
    // Checked, not fire-and-forget: a silently failing ignore here would look like the
    // reminder card refusing to disappear.
    check(`ignoring ${item.id.slice(0, 6)} succeeded`, ignored.status === 200, `-> ${ignored.status}`);
  }
  const remaining = await (await fetch(`${BASE}/recurring/pending`, { headers: authHeaders })).json();
  check('the queue could be emptied for this check', remaining.total === 0, `-> ${remaining.total}`);

  const emptyDash = await browser.navigateAndWait('/', ['概览']);
  // The card must be ABSENT, not present with a zero: a permanent "0 items" strip is
  // worse than no strip.
  check('AC10 the reminder card is gone', !emptyDash.includes('待确认'), `-> ${emptyDash.replace(/\n/g, ' | ').slice(0, 200)}`);
  check('AC10 while the dashboard still works', emptyDash.includes('概览') && emptyDash.includes('最近账单'));

  const emptyPending = await browser.navigateAndWait('/pending', ['没有待确认的账单']);
  check('AC10 the pending page shows an empty state, not a blank page', emptyPending.includes('没有待确认的账单'));
  check('AC10 and offers a way to manage the rules', emptyPending.includes('管理周期账单'));

  console.log(`\nscreenshot written to ${OUT_PNG}`);
} finally {
  await browser.close();
}

finish('RECURRING RENDER');
process.exitCode = failures === 0 ? 0 : 1;
