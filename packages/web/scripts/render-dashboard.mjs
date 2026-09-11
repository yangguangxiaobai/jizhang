/**
 * Renders the authenticated dashboard in headless Chrome and screenshots it.
 *
 * ## Why this exists
 *
 * Every other check in this task stops at HTTP. The API can be proven to return the
 * right numbers while the dashboard still renders a blank page, and no amount of
 * response-body assertions can tell the difference. This drives a real browser:
 *
 *   1. log in over the API to obtain a session cookie;
 *   2. set that cookie in the browser via the DevTools Protocol;
 *   3. load `/` and wait for the SPA to mount;
 *   4. assert the dashboard's own text is on the page, and screenshot it.
 *
 * Usage: node scripts/render-dashboard.mjs <out.png> [base-url]
 */

import { writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';

const OUT_PNG = process.argv[2] ?? 'dashboard.png';
const ORIGIN = process.argv[3] ?? 'http://127.0.0.1:8081';
const USERNAME = process.env.JIZHANG_E2E_USER ?? 'admin';
const PASSWORD = process.env.JIZHANG_E2E_PASSWORD ?? 'probe-password';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

const PORT = 9222;
const DEBUG_ORIGIN = `http://127.0.0.1:${PORT}`;

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) failures += 1;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── 1. session cookie from the API ───────────────────────────────────────────
const loginResponse = await fetch(`${ORIGIN}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
});
if (loginResponse.status !== 200) {
  console.error(`login failed: ${loginResponse.status} ${await loginResponse.text()}`);
  process.exit(1);
}
const setCookie = loginResponse.headers.getSetCookie?.() ?? [];
const sessionCookie = setCookie.find((c) => c.startsWith('jizhang_session='))?.split(';')[0];
if (sessionCookie === undefined) {
  console.error('no session cookie in the login response');
  process.exit(1);
}
console.log(`logged in as ${USERNAME}`);

// ── 2. launch Chrome with the DevTools protocol open ─────────────────────────
const { existsSync } = await import('node:fs');
const chromePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
if (chromePath === undefined) {
  console.error('no Chrome/Edge binary found');
  process.exit(1);
}

// `stdio: 'ignore'` is deliberate: the harness sandbox cannot open named pipes, so
// capturing a child's output through a pipe would fail with EPERM.
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`,
    '--window-size=390,844',
    `--user-data-dir=${process.env.TEMP ?? '/tmp'}\\jizhang-cdp-profile`,
    'about:blank',
  ],
  { stdio: 'ignore', detached: false },
);

/** Polls the DevTools HTTP endpoint until the browser is accepting connections. */
async function waitForDevTools() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${DEBUG_ORIGIN}/json/version`);
      if (response.ok) return await response.json();
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  throw new Error('DevTools endpoint never became available');
}
const version = await waitForDevTools();
console.log(`browser: ${version.Browser}`);

const targets = await (await fetch(`${DEBUG_ORIGIN}/json/list`)).json();
const page = targets.find((t) => t.type === 'page');
if (page === undefined) throw new Error('no page target');

// ── 3. drive the page over the DevTools protocol ─────────────────────────────
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 0;
const pending = new Map();
/** Console messages the page emitted, so a runtime error cannot pass unnoticed. */
const consoleErrors = [];

socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id !== undefined) {
    const entry = pending.get(message.id);
    if (entry !== undefined) {
      pending.delete(message.id);
      entry(message);
    }
    return;
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    consoleErrors.push(message.params.args.map((a) => a.value ?? a.description).join(' '));
  }
  if (message.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(
      message.params.exceptionDetails?.exception?.description ?? 'uncaught exception',
    );
  }
});

function send(method, params = {}) {
  const id = (nextId += 1);
  return new Promise((resolve, reject) => {
    pending.set(id, (message) => {
      if (message.error !== undefined) reject(new Error(`${method}: ${message.error.message}`));
      else resolve(message.result);
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

await send('Runtime.enable');
await send('Page.enable');
await send('Network.enable');

const cookieValue = sessionCookie.slice('jizhang_session='.length);
await send('Network.setCookie', {
  name: 'jizhang_session',
  value: cookieValue,
  domain: '127.0.0.1',
  path: '/',
  httpOnly: true,
  sameSite: 'Lax',
});

await send('Page.navigate', { url: `${ORIGIN}/` });

/** Polls the DOM until the dashboard's own heading appears (or we give up). */
/** Convenience wrapper around `Runtime.evaluate` that surfaces page-side throws. */
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  // Without this, a throwing expression comes back as `undefined` and the failure
  // shows up later as a confusing "cannot read properties of undefined".
  const details = result.exceptionDetails;
  if (details !== undefined) {
    throw new Error(
      `page evaluation failed: ${details.exception?.description ?? details.text}`,
    );
  }
  return result.result?.value;
}

const markers = ['概览', '收入', '支出', '结余', '最近账单'];
let dom = '';
let mounted = false;
for (let attempt = 0; attempt < 40; attempt += 1) {
  await sleep(250);
  dom = (await evaluate('document.body.innerText')) ?? '';
  mounted = markers.every((marker) => dom.includes(marker));
  if (mounted) break;
}

console.log('\n[dashboard render]');
check('the SPA mounted and left the login screen', !dom.includes('用户名'), `-> ${dom.slice(0, 60).replace(/\n/g, ' | ')}`);
for (const marker of markers) {
  check(`the page shows「${marker}」`, dom.includes(marker));
}
check('no runtime errors were logged', consoleErrors.length === 0, consoleErrors.join(' | '));

// The dashboard's navigation is the other half of this task's frontend change.
for (const label of ['首页', '账单', '预算', '记一笔', '统计', '我的']) {
  check(`the tab bar shows「${label}」`, dom.includes(label));
}

console.log('\n--- rendered text ---');
console.log(dom.split('\n').filter((line) => line.trim() !== '').join(' | '));

// ── measured layout ──────────────────────────────────────────────────────────
// `check-mobile.mjs` audits the CSS source, which cannot see a computed size or a
// wrapped label. With a real viewport available, measure the actual boxes instead:
// this is the only place the 44px rule and "six tabs fit at 375px" are verified as
// rendered facts rather than as declared intent.
console.log('\n[measured layout]');
const VIEWPORT = 375;
await send('Emulation.setDeviceMetricsOverride', {
  width: VIEWPORT,
  height: 812,
  deviceScaleFactor: 2,
  mobile: true,
});
await sleep(400);

/**
 * Runs in the page and reports the measured layout.
 *
 * Kept as a named function and serialised with `toString()` rather than written as an
 * inline template literal: the expression contains backticks, quotes and `${}` from
 * the page code, and embedding that inside a template string is a quoting trap that
 * already cost a debugging round here.
 */
function measureLayout() {
  const tabs = Array.from(document.querySelectorAll('.tabbar .tab'));
  const bar = document.querySelector('.tabbar');
  const all = Array.from(document.querySelectorAll('button, a, input, select'));
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  };
  return {
    count: tabs.length,
    // innerText carries the decorative glyph line as well as the label, so keep the
    // last non-empty line. A glyph-only tab still fails the comparison, by design.
    labels: tabs.map((t) => {
      const lines = (t.innerText || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      return lines[lines.length - 1] || '';
    }),
    tabs: tabs.map(rect),
    barWidth: bar ? Math.round(bar.getBoundingClientRect().width) : 0,
    docWidth: document.documentElement.scrollWidth,
    smallTargets: all
      .map((el) => ({
        tag: el.tagName,
        text: (el.innerText || el.name || '').trim().slice(0, 14),
        ...rect(el),
      }))
      .filter((t) => t.h > 0 && t.h < 44),
  };
}

const metrics = await evaluate(`(${measureLayout.toString()})()`);

check(`the tab bar has ${metrics.count} items`, metrics.count === 6, `-> ${metrics.count}`);
check(
  'the tab labels are the expected six',
  metrics.labels.join(',') === '首页,账单,预算,记一笔,统计,我的',
  `-> ${metrics.labels.join(',')}`,
);
check(
  'no tab overflows the viewport',
  metrics.tabs.every((t) => t.w > 0 && t.w <= VIEWPORT),
  `-> widths ${metrics.tabs.map((t) => t.w).join(',')}`,
);
check(
  'every tab meets the 44px touch target',
  metrics.tabs.every((t) => t.h >= 44),
  `-> heights ${metrics.tabs.map((t) => t.h).join(',')}`,
);
check(
  `the page does not scroll horizontally at ${VIEWPORT}px`,
  metrics.docWidth <= VIEWPORT,
  `-> scrollWidth ${metrics.docWidth}`,
);
check(
  'no interactive control on the page is shorter than 44px',
  metrics.smallTargets.length === 0,
  metrics.smallTargets.map((t) => `${t.tag}:${t.text}=${t.h}px`).join(' | '),
);

// ── offline: the shell still opens, and does not go blank ────────────────────
// The offline policy is "read yes, write no" (parent task D4): the service worker
// precaches the shell, so a reload with the server unreachable must still paint the
// app and say so, rather than going blank or — worse — rendering the last figures it
// saw as if they were current.
//
// The server is stopped for real rather than simulated: `Network.emulateNetworkConditions`
// was verified here to leave `navigator.onLine` true and let `fetch` return 200, so it
// proves nothing. This is a single-container app, so stopping the container IS the
// connection loss a phone would experience.
console.log('\n[offline: server stopped]');

const composeDown = () => {
  try {
    execFileSync('docker', ['compose', 'stop', 'jizhang'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const composeUp = () => {
  try {
    execFileSync('docker', ['compose', 'start', 'jizhang'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

let offlineDom = '';
let offlineAppHtml = 0;
const stopped = composeDown();
check('the server could be stopped for the test', stopped);

try {
  // Give the browser a moment to see the connection actually drop.
  await sleep(1500);
  await send('Page.navigate', { url: `${ORIGIN}/` });
  await sleep(3000);

  offlineDom = (await evaluate('document.body.innerText')) ?? '';
  offlineAppHtml = (await evaluate('document.getElementById("app")?.innerHTML?.length ?? 0')) ?? 0;
} finally {
  const restarted = composeUp();
  check('the server was restarted', restarted);
}

check('the app still mounts with no server', offlineAppHtml > 0, `-> #app innerHTML ${offlineAppHtml} chars`);
check('and the page is not blank', offlineDom.trim().length > 0, `-> ${offlineDom.trim().length} chars`);
// Two acceptable offline views, and which one appears depends on whether the session
// was already resolved: the dashboard shell (session known) or the login screen (the
// session lookup itself failed). Both must render something usable and say what is
// wrong. Asserting one specific view would be asserting an implementation detail.
check(
  'the shell is usable, not a blank page',
  offlineDom.includes('我的') || offlineDom.includes('用户名'),
  `-> ${offlineDom.replace(/\n/g, ' | ').slice(0, 120)}`,
);
check(
  'the user is told they are offline, that loading failed, or cannot log in',
  /离线|无法连接|需要联网/.test(offlineDom),
  `-> ${offlineDom.replace(/\n/g, ' | ').slice(0, 160)}`,
);

// "Mounted" is not the same as "usable": prove the offline view has real, focusable
// controls rather than a static shell of text.
const offlineControls = await evaluate(
  '[...document.querySelectorAll("input, button")].filter((el) => !el.disabled).length',
);
check('the offline view has interactive controls', offlineControls >= 3, `-> ${offlineControls}`);
// The load-bearing one: a stale balance must never be presented as current. If the API
// ever becomes cacheable, or the dashboard ever renders before its load resolves, this
// fails while every other offline check still passes.
check(
  'no accounting figure is rendered as if it were current',
  !/概览/.test(offlineDom),
  `-> ${offlineDom.replace(/\n/g, ' | ').slice(0, 160)}`,
);

console.log('\n--- offline text ---');
console.log(offlineDom.split('\n').filter((line) => line.trim() !== '').join(' | '));

// Wait for the server to answer again before continuing, so the next phase is not
// racing the restart.
for (let attempt = 0; attempt < 40; attempt += 1) {
  await sleep(250);
  try {
    const response = await fetch(`${ORIGIN}/api/v1/health`);
    if (response.ok) break;
  } catch {
    // not up yet
  }
}
await send('Page.navigate', { url: `${ORIGIN}/` });
await sleep(1500);

const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
writeFileSync(OUT_PNG, Buffer.from(screenshot.data, 'base64'));
console.log(`\nscreenshot written to ${OUT_PNG}`);

socket.close();
chrome.kill();
console.log(failures === 0 ? '\nALL RENDER CHECKS PASSED' : `\n${failures} RENDER CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
