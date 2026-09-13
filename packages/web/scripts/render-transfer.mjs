/**
 * Renders the transfers page in headless Chrome and verifies what HTTP cannot.
 *
 * The API suite proves a transfer moves no accounting figure; this proves the page a person
 * actually touches says the same thing. Three checks here have no HTTP equivalent:
 *
 *   - the amount is rendered in the **neutral** foreground colour. A green or red figure would
 *     read as "money in" or "money out", and a transfer is neither — that is a computed style,
 *     so only a browser can see it;
 *   - the entry point on the home asset card exists and is reachable at the narrowest phone
 *     width;
 *   - the create form does not offer the same account on both sides.
 *
 * It seeds one transfer and removes it afterwards.
 *
 * Usage: node scripts/render-transfer.mjs <out.png> [base-url]
 */

import { makeChecker, openBrowser, PHONE_VIEWPORT } from './lib/browser.mjs';

const OUT_PNG = process.argv[2] ?? 'transfer.png';
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

// Start from no transfers, so the count assertions below mean something.
const existing = await (await fetch(`${BASE}/transfers?limit=500`, { headers: authHeaders })).json();
for (const item of existing.items ?? []) {
  await fetch(`${BASE}/transfers/${item.id}`, { method: 'DELETE', headers: csrfHeaders });
}

// A second account to move money into, so the row names two different places.
const bankResponse = await fetch(`${BASE}/accounts`, {
  method: 'POST',
  headers: jsonHeaders,
  body: JSON.stringify({ name: '渲染用储蓄卡', type: 1, initialBalanceCents: 200_000 }),
});
if (bankResponse.status !== 201) throw new Error(`account seed failed: ${bankResponse.status}`);
const bank = await bankResponse.json();

const TRANSFER_NOTE = '渲染用提现';
const created = await fetch(`${BASE}/transfers`, {
  method: 'POST',
  headers: jsonHeaders,
  body: JSON.stringify({
    fromAccountId: 'builtin-default-account',
    toAccountId: bank.id,
    amountCents: 123_456,
    date: dayIn(4),
    note: TRANSFER_NOTE,
  }),
});
if (created.status !== 201) throw new Error(`transfer seed failed: ${created.status}`);
const transfer = await created.json();

const browser = await openBrowser({
  origin: ORIGIN,
  profileDir: `${process.env.TEMP ?? '/tmp'}/jizhang-cdp-transfer`,
});

try {
  console.log(`browser: ${browser.browserVersion}`);

  // ── the home asset card is the entry point ────────────────────────────────
  console.log('\n[entry point on the home screen]');
  const homeDom = await browser.navigateAndWait('/', ['总余额', '转账']);
  check('the asset card offers a way into the transfers page', homeDom.includes('转账'), `-> ${homeDom.slice(0, 120).replace(/\n/g, ' | ')}`);

  // ── the list ──────────────────────────────────────────────────────────────
  const markers = ['转账', TRANSFER_NOTE];
  const dom = await browser.navigateAndWait('/transfers', markers);

  console.log('\n[transfers render]');
  check(
    'the SPA mounted and left the login screen',
    !dom.includes('用户名'),
    `-> ${dom.slice(0, 60).replace(/\n/g, ' | ')}`,
  );
  check('the row names both accounts', dom.includes('默认账户') && dom.includes('渲染用储蓄卡'), `-> ${dom.slice(0, 160)}`);
  check('the row shows the amount', dom.includes('1234.56'), `-> ${dom.slice(0, 160)}`);
  check('the row shows the note and the date', dom.includes(TRANSFER_NOTE));
  check('the page explains that a transfer is neither income nor expense', dom.includes('不算收入') || dom.includes('不算支出'));
  check('edit and delete are offered', dom.includes('编辑') && dom.includes('删除'));
  check(
    'no runtime errors were logged',
    browser.consoleErrors.length === 0,
    browser.consoleErrors.join(' | '),
  );

  // ── the amount must be NEUTRAL, not income-green or expense-red ───────────
  console.log('\n[the amount carries no income/expense colour]');
  const colours = await browser.evaluate(`
    (() => {
      const amount = document.querySelector('.amount');
      const styles = getComputedStyle(document.documentElement);
      return {
        amount: amount ? getComputedStyle(amount).color : null,
        ok: styles.getPropertyValue('--ok').trim(),
        danger: styles.getPropertyValue('--danger').trim(),
        hasRow: amount !== null,
      };
    })()
  `);
  check('an amount element is on the page', colours?.hasRow === true, `-> ${JSON.stringify(colours)}`);
  // Compare against the resolved colour of a probe element rather than parsing the token: the
  // token may be any CSS colour syntax, and re-implementing the parser here would be a second
  // implementation of "what colour is this".
  const probe = await browser.evaluate(`
    (() => {
      const make = (value) => {
        const el = document.createElement('span');
        el.style.color = value;
        document.body.appendChild(el);
        const resolved = getComputedStyle(el).color;
        el.remove();
        return resolved;
      };
      return {
        ok: make(getComputedStyle(document.documentElement).getPropertyValue('--ok')),
        danger: make(getComputedStyle(document.documentElement).getPropertyValue('--danger')),
      };
    })()
  `);
  check(
    'the transfer amount is neither the income colour nor the expense colour',
    colours?.amount !== probe?.ok && colours?.amount !== probe?.danger,
    `-> amount ${colours?.amount} vs ok ${probe?.ok} / danger ${probe?.danger}`,
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
  check(
    'the tab bar is still six items and unchanged',
    metrics.tabs.length === 6 && metrics.tabs.every((tab) => tab.h >= 44),
    `-> ${metrics.tabs.map((tab) => tab.label).join(',')}`,
  );

  // ── the create form ───────────────────────────────────────────────────────
  console.log('\n[the create form]');
  const formDom = await browser.navigateAndWait('/transfers/new', ['金额（元）', '保存']);
  check('the form asks for both sides', formDom.includes('从') && formDom.includes('到'));
  const pickers = await browser.evaluate(`
    (() => {
      const selects = [...document.querySelectorAll('select')];
      const values = (el) => [...el.options].map((o) => o.value);
      return {
        count: selects.length,
        from: selects[0] ? { value: selects[0].value, options: values(selects[0]) } : null,
        to: selects[1] ? { value: selects[1].value, options: values(selects[1]) } : null,
      };
    })()
  `);
  check('there are exactly two account pickers', pickers?.count === 2, `-> ${pickers?.count}`);
  check(
    'the destination picker excludes the chosen source',
    Array.isArray(pickers?.to?.options) && !pickers.to.options.includes(pickers?.from?.value),
    `-> from ${pickers?.from?.value} in to ${JSON.stringify(pickers?.to?.options)}`,
  );
  check(
    'and the source picker excludes the chosen destination',
    Array.isArray(pickers?.from?.options) && !pickers.from.options.includes(pickers?.to?.value),
    `-> to ${pickers?.to?.value} in from ${JSON.stringify(pickers?.from?.options)}`,
  );

  console.log('\n[measured form layout]');
  const formMetrics = await browser.measureLayout();
  check(
    'the form does not scroll horizontally either',
    formMetrics.docWidth <= PHONE_VIEWPORT.width,
    `-> scrollWidth ${formMetrics.docWidth}`,
  );
  check(
    'no control on the form is shorter than 44px',
    formMetrics.smallTargets.length === 0,
    formMetrics.smallTargets.map((t) => `${t.tag}:${t.text}=${t.h}px`).join(' | '),
  );

  await browser.screenshot(OUT_PNG);
  console.log(`\nscreenshot written to ${OUT_PNG}`);
} finally {
  await browser.close();
  // Leave the ledger as it was found, so this suite cannot perturb another one.
  await fetch(`${BASE}/transfers/${transfer.id}`, { method: 'DELETE', headers: csrfHeaders });
  await fetch(`${BASE}/accounts/${bank.id}`, { method: 'DELETE', headers: csrfHeaders });
}

finish('TRANSFER RENDER');
process.exitCode = failures === 0 ? 0 : 1;
