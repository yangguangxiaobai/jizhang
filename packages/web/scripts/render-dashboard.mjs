/**
 * Renders the authenticated dashboard in headless Chrome and verifies what HTTP cannot.
 *
 * The API can be proven to return the right numbers while the page still renders blank,
 * and the static CSS audit cannot see a computed size, a wrapped label, or a sentence
 * assembled from template fragments. This drives a real browser — log in over the API,
 * set the session cookie, load `/`, read and measure the DOM — and it has already caught
 * a defect that every HTTP assertion passed: a budget alert rendered as
 * `，已从结余池借用`, a dangling clause with no leading text.
 *
 * It also verifies the offline contract for real: the container is stopped (in a
 * `try/finally`, so a failing assertion cannot leave the app down) and the page must
 * still open, say it cannot connect, and render NO stale balance as if it were current.
 * `Network.emulateNetworkConditions` was measured here to leave `navigator.onLine` true
 * and `fetch` returning 200, so it proves nothing.
 *
 * Usage: node scripts/render-dashboard.mjs <out.png> [base-url]
 */

import { makeChecker, openBrowser, PHONE_VIEWPORT } from './lib/browser.mjs';

const OUT_PNG = process.argv[2] ?? 'dashboard.png';
const ORIGIN = process.argv[3] ?? 'http://127.0.0.1:8081';

const { check, failures, finish } = makeChecker();

const browser = await openBrowser({
  origin: ORIGIN,
  profileDir: `${process.env.TEMP ?? '/tmp'}/jizhang-cdp-dashboard`,
});
console.log(`browser: ${browser.browserVersion}`);

try {
  // ── the dashboard renders its own content ──────────────────────────────────
  const markers = ['概览', '收入', '支出', '结余', '最近账单'];
  const dom = await browser.navigateAndWait('/', markers);

  console.log('\n[dashboard render]');
  check(
    'the SPA mounted and left the login screen',
    !dom.includes('用户名'),
    `-> ${dom.slice(0, 60).replace(/\n/g, ' | ')}`,
  );
  for (const marker of markers) {
    check(`the page shows「${marker}」`, dom.includes(marker));
  }
  check('no runtime errors were logged', browser.consoleErrors.length === 0, browser.consoleErrors.join(' | '));

  for (const label of ['首页', '账单', '预算', '记一笔', '统计', '我的']) {
    check(`the tab bar shows「${label}」`, dom.includes(label));
  }

  console.log('\n--- rendered text ---');
  console.log(dom.split('\n').filter((line) => line.trim() !== '').join(' | '));

  // ── measured layout at the narrowest supported phone ──────────────────────
  console.log('\n[measured layout]');
  await browser.usePhoneViewport();
  const metrics = await browser.measureLayout();

  check('the tab bar has 6 items', metrics.tabs.length === 6, `-> ${metrics.tabs.length}`);
  check(
    'the tab labels are the expected six',
    metrics.tabs.map((tab) => tab.label).join(',') === '首页,账单,预算,记一笔,统计,我的',
    `-> ${metrics.tabs.map((tab) => tab.label).join(',')}`,
  );
  check(
    'no tab overflows the viewport',
    metrics.tabs.every((tab) => tab.w > 0 && tab.w <= PHONE_VIEWPORT.width),
    `-> widths ${metrics.tabs.map((tab) => tab.w).join(',')}`,
  );
  check(
    'every tab meets the 44px touch target',
    metrics.tabs.every((tab) => tab.h >= 44),
    `-> heights ${metrics.tabs.map((tab) => tab.h).join(',')}`,
  );
  check(
    `the page does not scroll horizontally at ${PHONE_VIEWPORT.width}px`,
    metrics.docWidth <= PHONE_VIEWPORT.width,
    `-> scrollWidth ${metrics.docWidth}`,
  );
  check(
    'no interactive control on the page is shorter than 44px',
    metrics.smallTargets.length === 0,
    metrics.smallTargets.map((t) => `${t.tag}:${t.text}=${t.h}px`).join(' | '),
  );

  // ── offline: the server really stops ──────────────────────────────────────
  console.log('\n[offline: server stopped]');
  const stopped = browser.stopServer();
  check('the server could be stopped for the test', stopped);

  let offlineDom = '';
  let offlineAppHtml = 0;
  try {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    offlineDom = await browser.navigateAndWait('/', ['用户名'], { attempts: 16, delay: 250 });
    offlineAppHtml =
      (await browser.evaluate('document.getElementById("app")?.innerHTML?.length ?? 0')) ?? 0;
  } finally {
    check('the server was restarted', browser.startServer());
  }

  check('the app still mounts with no server', offlineAppHtml > 0, `-> #app ${offlineAppHtml} chars`);
  check('and the page is not blank', offlineDom.trim().length > 0, `-> ${offlineDom.trim().length} chars`);
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
  const offlineControls = await browser.evaluate(
    '[...document.querySelectorAll("input, button")].filter((el) => !el.disabled).length',
  );
  check('the offline view has interactive controls', offlineControls >= 3, `-> ${offlineControls}`);
  // The load-bearing one: a stale balance must never be presented as current.
  check(
    'no accounting figure is rendered as if it were current',
    !/概览/.test(offlineDom),
    `-> ${offlineDom.replace(/\n/g, ' | ').slice(0, 160)}`,
  );

  console.log('\n--- offline text ---');
  console.log(offlineDom.split('\n').filter((line) => line.trim() !== '').join(' | '));

  await browser.waitForServer();
  await browser.navigateAndWait('/', markers);
  await browser.screenshot(OUT_PNG);
  console.log(`\nscreenshot written to ${OUT_PNG}`);
} finally {
  await browser.close();
}

finish('RENDER');
process.exitCode = failures === 0 ? 0 : 1;
