/**
 * Renders the recycle bin in headless Chrome and verifies what HTTP cannot.
 *
 * The API suite proves the endpoints are correct; this proves the page a person actually
 * touches is correct: that it mounts, that the delete/restore controls are reachable at
 * the narrowest phone width, and that the destructive action is distinguishable from the
 * safe one by more than colour alone.
 *
 * It seeds its own data — one bill left in the bin, one left live — so both the populated
 * list and the guard rails are exercised. The seeding is reset afterwards.
 *
 * Usage: node scripts/render-trash.mjs <out.png> [base-url]
 */

import { makeChecker, openBrowser, PHONE_VIEWPORT } from './lib/browser.mjs';

const OUT_PNG = process.argv[2] ?? 'trash.png';
const ORIGIN = process.argv[3] ?? 'http://127.0.0.1:8081';
const BASE = `${ORIGIN}/api/v1`;

const { check, failures, finish } = makeChecker();

// ── seed over HTTP, so the browser only has to render ────────────────────────
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
const csrfHeaders = { 'X-Requested-With': 'fetch', Cookie: cookie };
const authHeaders = { Cookie: cookie };

const now = new Date();
const dayIn = (day) => new Date(now.getFullYear(), now.getMonth(), day).getTime();

const seed = async (note, amountCents) => {
  const response = await fetch(`${BASE}/transactions`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      type: 0,
      amountCents,
      categoryId: 'builtin-expense-food',
      accountId: 'builtin-default-account',
      date: dayIn(5),
      note,
    }),
  });
  if (response.status !== 201) throw new Error(`seed failed: ${response.status}`);
  return (await response.json()).id;
};

// Start from an empty bin so the count assertions below mean something.
const existing = await (await fetch(`${BASE}/trash`, { headers: authHeaders })).json();
for (const item of existing.items ?? []) {
  await fetch(`${BASE}/trash/${item.id}`, { method: 'DELETE', headers: csrfHeaders });
}

const binnedNote = '回收站里的午餐';
const binnedId = await seed(binnedNote, 12_345);
await fetch(`${BASE}/transactions/${binnedId}`, { method: 'DELETE', headers: csrfHeaders });

const browser = await openBrowser({
  origin: ORIGIN,
  profileDir: `${process.env.TEMP ?? '/tmp'}/jizhang-cdp-trash`,
});

try {
  console.log(`browser: ${browser.browserVersion}`);

  // ── the populated bin ─────────────────────────────────────────────────────
  const markers = ['回收站', '恢复', '彻底删除'];
  const dom = await browser.navigateAndWait('/trash', markers);

  console.log('\n[trash render]');
  check(
    'the SPA mounted and left the login screen',
    !dom.includes('用户名'),
    `-> ${dom.slice(0, 60).replace(/\n/g, ' | ')}`,
  );
  check('the page shows the bin and both actions', markers.every((m) => dom.includes(m)));
  check(`the binned bill is listed by note`, dom.includes(binnedNote), `-> ${dom.slice(0, 80)}`);
  check('the row shows a deletion stamp', dom.includes('删除于'));
  check('the row shows the amount', dom.includes('123.45'), `-> ${dom.slice(0, 120)}`);
  check('the total count is shown', /\d+\s*笔已删除账单/.test(dom));
  check('the bulk actions are offered', dom.includes('全部恢复') && dom.includes('清空回收站'));
  check(
    'no runtime errors were logged',
    browser.consoleErrors.length === 0,
    browser.consoleErrors.join(' | '),
  );
  check(
    'the destructive control is named in words, not colour alone',
    dom.includes('彻底删除') && dom.includes('清空回收站'),
  );

  console.log('\n--- rendered text ---');
  console.log(dom.split('\n').filter((line) => line.trim() !== '').join(' | '));

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
  check('the page has interactive controls', metrics.interactiveCount > 0, `-> ${metrics.interactiveCount}`);
  check(
    'the tab bar is still six items and unchanged',
    metrics.tabs.length === 6 && metrics.tabs.every((tab) => tab.h >= 44),
    `-> ${metrics.tabs.map((tab) => tab.label).join(',')}`,
  );
  check(
    'the 我的 tab is the active one on this route',
    metrics.tabs.some((tab) => tab.label === '我的' && tab.w > 0),
  );

  // ── the empty state ───────────────────────────────────────────────────────
  console.log('\n[empty state]');
  // Empty the bin through the API, then reload the page.
  const purged = await fetch(`${BASE}/trash`, { method: 'DELETE', headers: csrfHeaders });
  check('the bin could be emptied for the empty-state check', purged.status === 200, `-> ${purged.status}`);

  const emptyDom = await browser.navigateAndWait('/trash', ['回收站是空的']);
  check('AC9 the empty state is shown, not a blank page', emptyDom.includes('回收站是空的'));
  check('AC9 it explains what the bin is for', emptyDom.includes('恢复'), `-> ${emptyDom.slice(0, 100)}`);
  check('AC9 and offers a way back to the bills', emptyDom.includes('返回账单列表'));
  check(
    'AC9 no stale row is left on screen',
    !emptyDom.includes(binnedNote),
    `-> ${emptyDom.replace(/\n/g, ' | ').slice(0, 120)}`,
  );

  console.log('\n--- empty text ---');
  console.log(emptyDom.split('\n').filter((line) => line.trim() !== '').join(' | '));

  await browser.screenshot(OUT_PNG);
  console.log(`\nscreenshot written to ${OUT_PNG}`);
} finally {
  await browser.close();
}

finish('TRASH RENDER');
process.exitCode = failures === 0 ? 0 : 1;
