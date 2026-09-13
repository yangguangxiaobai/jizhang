/**
 * Renders the colour system in headless Chrome.
 *
 * `check-color.mjs` proves the tokens are right in the source. This proves they reach the
 * screen: that a preset chosen on the settings page changes the accent the buttons are
 * painted with, survives a reload, and is applied before the bundle runs; that every text
 * pair on the real pages clears 4.5:1 under every preset in both themes; that a donut slice
 * is painted with the theme's palette variant rather than the stored light value; that an
 * envelope at 85% wears the warning colour and says so in words; and that the browser chrome
 * follows the surface.
 *
 * It resets the container first so the seeded state is known.
 *
 * Usage: node scripts/render-color.mjs <out.png> [base-url]
 */

import { execFileSync } from 'node:child_process';

import { makeChecker, openBrowser, PHONE_VIEWPORT } from './lib/browser.mjs';
import { contrast, rgbToHex, round2, toRgb } from './lib/color.mjs';

const OUT_PNG = process.argv[2] ?? 'color.png';
const ORIGIN = process.argv[3] ?? 'http://127.0.0.1:8081';
const BASE = `${ORIGIN}/api/v1`;

const { check, failures, finish } = makeChecker();

const TEXT_MIN = 4.5;

// ── a known baseline ─────────────────────────────────────────────────────────
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
const send = (method, path, body) =>
  fetch(`${BASE}${path}`, { method, headers: jsonHeaders, body: JSON.stringify(body) });

const now = new Date();
const dayIn = (day) => new Date(now.getFullYear(), now.getMonth(), day).getTime();

const FOOD = 'builtin-expense-food';
const TRANSPORT = 'builtin-expense-transport';
const HOUSING = 'builtin-expense-housing';
const SHOPPING = 'builtin-expense-shopping';
const ACCOUNT = 'builtin-default-account';

// One cycle with four envelopes, each in a different state: food at 85% (warning),
// transport at 120% (over), housing at 30% and shopping at 10% (normal).
const salary = await send('POST', '/salaries', {
  accountId: ACCOUNT,
  amountCents: 1_000_000,
  date: dayIn(2),
  allocations: [
    { categoryId: FOOD, amountCents: 400_000 },
    { categoryId: TRANSPORT, amountCents: 100_000 },
    { categoryId: HOUSING, amountCents: 300_000 },
    { categoryId: SHOPPING, amountCents: 200_000 },
  ],
});
check('the cycle was seeded', salary.status === 201, `-> ${salary.status}`);
for (const [categoryId, amountCents, day] of [
  [FOOD, 340_000, 5],
  [TRANSPORT, 120_000, 6],
  [HOUSING, 90_000, 7],
  [SHOPPING, 20_000, 8],
]) {
  const response = await send('POST', '/transactions', {
    type: 0,
    amountCents,
    categoryId,
    accountId: ACCOUNT,
    date: dayIn(day),
    note: '测试支出',
  });
  check(`a ${categoryId} bill was posted`, response.status === 201, `-> ${response.status}`);
}

// Housing keeps the REFERENCE app's colour for its slot (an un-migrated database), and
// shopping takes a colour outside the palette entirely (a custom pick).
const LEGACY_HOUSING = 0xffb0835e;
const CUSTOM_SHOPPING = 0xff336699;
const recolourHousing = await send('PATCH', `/categories/${HOUSING}`, { color: LEGACY_HOUSING });
const recolourShopping = await send('PATCH', `/categories/${SHOPPING}`, { color: CUSTOM_SHOPPING });
check(
  'two categories were recoloured for the palette checks',
  recolourHousing.status === 200 && recolourShopping.status === 200,
  `-> ${recolourHousing.status}/${recolourShopping.status}`,
);

const browser = await openBrowser({
  origin: ORIGIN,
  profileDir: `${process.env.TEMP ?? '/tmp'}/jizhang-cdp-color`,
});

/**
 * Runs in the page: the attributes, the tokens as computed, the browser-chrome meta, and the
 * rendered colour of every text element whose legibility matters, with its effective
 * background.
 *
 * A named function serialised with `toString()`: the page code is full of quotes and `${}`
 * that would be a quoting trap inside a template literal.
 */
function samplePage() {
  function effectiveBackground(el) {
    let node = el;
    while (node) {
      const bg = getComputedStyle(node).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
      node = node.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  }
  const root = getComputedStyle(document.documentElement);
  const token = (name) => root.getPropertyValue(name).trim();

  // Every element that carries text, sampled once per (colour, background) pair so the
  // report stays readable. Hidden elements are skipped: their colour is nobody's problem.
  const seen = new Set();
  const samples = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.children.length > 0 && [...el.childNodes].every((n) => n.nodeType !== 3 || n.textContent.trim() === '')) continue;
    if (el.closest('svg, script, style, title') !== null) continue;
    const text = (el.textContent || '').trim();
    if (text === '') continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.opacity === '0') continue;
    const background = effectiveBackground(el);
    const key = `${style.color}|${background}`;
    if (seen.has(key)) continue;
    seen.add(key);
    samples.push({
      color: style.color,
      background,
      tag: el.tagName.toLowerCase(),
      className: typeof el.className === 'string' ? el.className.slice(0, 40) : '',
      text: text.slice(0, 16),
    });
  }

  const tokens = {};
  for (const name of ['--bg', '--surface', '--accent', '--on-accent', '--accent-subtle', '--warning', '--warning-subtle', '--danger', '--danger-subtle', '--ok']) {
    tokens[name] = token(name);
  }
  for (let slot = 1; slot <= 12; slot += 1) tokens[`--cat-${slot}`] = token(`--cat-${slot}`);

  return {
    dataTheme: document.documentElement.getAttribute('data-theme'),
    dataAccent: document.documentElement.getAttribute('data-accent'),
    tokens,
    themeColorMetas: [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.content),
    samples,
    // Primary buttons, as painted.
    primaryButton: (() => {
      const button = [...document.querySelectorAll('button')].find((b) => {
        const s = getComputedStyle(b);
        return s.backgroundColor === toRgbString(token('--accent')) && b.getBoundingClientRect().height > 0;
      });
      if (button === undefined) return null;
      const s = getComputedStyle(button);
      return { color: s.color, background: s.backgroundColor, text: (button.innerText || '').trim().slice(0, 12) };
    })(),
    slices: [...document.querySelectorAll('path.slice')].map((p) => getComputedStyle(p).fill),
    fills: [...document.querySelectorAll('.fill')].map((f) => ({
      className: f.className,
      background: getComputedStyle(f).backgroundColor,
    })),
    notices: [...document.querySelectorAll('.notice')].map((n) => ({
      className: n.className,
      color: getComputedStyle(n).color,
      background: getComputedStyle(n).backgroundColor,
      text: (n.innerText || '').trim().slice(0, 30),
    })),
    text: document.body.innerText,
  };

  function toRgbString(hex) {
    const value = hex.replace('#', '');
    const n = parseInt(value, 16);
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
  }
}

async function sample() {
  return browser.evaluate(`(${samplePage.toString()})()`);
}

/** Clicks a segmented button on the settings page by its label. */
async function chooseOnSettings(label) {
  await browser.navigateAndWait('/settings', ['外观', label]);
  const clicked = await browser.evaluate(`(() => {
    const buttons = [...document.querySelectorAll('.segmented button')];
    const target = buttons.find((b) => (b.innerText || '').trim() === ${JSON.stringify(label)});
    if (target === undefined) return false;
    target.click();
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 400));
  return clicked;
}

const same = (a, b) => rgbToHex(toRgb(a)) === rgbToHex(toRgb(b));

const PAGES = [
  ['/', '概览'],
  ['/transactions', '账单'],
  ['/budget', '本周期预算'],
  ['/stats', '统计'],
];

try {
  console.log(`browser: ${browser.browserVersion}`);
  await browser.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'light' }],
  });

  // ── the preset control ────────────────────────────────────────────────────
  console.log('\n[presets]');
  await browser.navigateAndWait('/', ['概览']);
  const initial = await sample();
  check('no data-accent attribute by default (the titanium preset)', initial.dataAccent === null, `-> ${initial.dataAccent}`);
  const titaniumAccent = initial.tokens['--accent'];

  check('the 森林绿 button is on the settings page', await chooseOnSettings('森林绿'));
  // The budget page, not the dashboard: the dashboard's only buttons are outlined, and the
  // painted-button assertion needs a solid primary (记工资) to read.
  await browser.navigateAndWait('/budget', ['本周期预算', '记工资']);
  const forest = await sample();
  check('choosing 森林绿 sets data-accent="forest"', forest.dataAccent === 'forest', `-> ${forest.dataAccent}`);
  check('and the accent actually changes', forest.tokens['--accent'] !== titaniumAccent, `-> ${titaniumAccent} → ${forest.tokens['--accent']}`);
  check(
    'the primary buttons are painted with the new accent',
    forest.primaryButton !== null && same(forest.primaryButton.background, forest.tokens['--accent']),
    `-> ${forest.primaryButton?.background} (${forest.primaryButton?.text})`,
  );
  const storedAccent = await browser.evaluate("window.localStorage.getItem('jizhang.accent')");
  check('the preset is persisted', storedAccent === 'forest', `-> ${storedAccent}`);

  // A reload is the cold start: the attribute must already be there when the document is
  // created, which only the inline `theme-init.js` can do. An observer installed at
  // document start records the moment `data-accent` first appears and whether `<body>`
  // existed yet: the inline script runs while the head is still being parsed, so a value
  // set by the bundle (which cannot run before `<body>`) would be caught as late.
  //
  // It observes `document`, not `document.documentElement`: at the moment this script runs
  // the `<html>` element does not exist yet, and `observe(null)` throws.
  await browser.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      window.__accentSeen = null;
      new MutationObserver((mutations, observer) => {
        for (const mutation of mutations) {
          if (mutation.target !== document.documentElement || mutation.attributeName !== 'data-accent') continue;
          window.__accentSeen = {
            value: document.documentElement.getAttribute('data-accent'),
            beforeBody: document.body === null,
          };
          observer.disconnect();
          return;
        }
      }).observe(document, { attributes: true, subtree: true });
    })();`,
  });
  await browser.navigateAndWait('/', ['概览']);
  const early = await browser.evaluate('window.__accentSeen');
  check(
    'theme-init.js applies the preset while the head is still parsing, before the bundle',
    early !== null && early.value === 'forest' && early.beforeBody === true,
    `-> ${JSON.stringify(early)}`,
  );

  check('the 极简黑白 button is on the settings page', await chooseOnSettings('极简黑白'));
  await browser.navigateAndWait('/budget', ['本周期预算', '记工资']);
  const mono = await sample();
  check('choosing 极简黑白 sets data-accent="mono"', mono.dataAccent === 'mono', `-> ${mono.dataAccent}`);
  check('mono paints the buttons in the foreground colour', mono.tokens['--accent'] !== forest.tokens['--accent'] && mono.primaryButton !== null && same(mono.primaryButton.background, mono.tokens['--accent']), `-> ${mono.tokens['--accent']}`);

  check('the 钛蓝 button is on the settings page', await chooseOnSettings('钛蓝'));
  await browser.navigateAndWait('/', ['概览']);
  const backToTitanium = await sample();
  check('choosing 钛蓝 removes the attribute', backToTitanium.dataAccent === null, `-> ${backToTitanium.dataAccent}`);
  check('and forgets the stored preset', (await browser.evaluate("window.localStorage.getItem('jizhang.accent')")) === null);
  check('and the accent is the titanium one again', backToTitanium.tokens['--accent'] === titaniumAccent, `-> ${backToTitanium.tokens['--accent']}`);

  // ── contrast on the real pages, every preset in both themes ───────────────
  console.log('\n[contrast matrix]');
  for (const theme of ['浅色', '深色']) {
    await chooseOnSettings(theme);
    for (const preset of ['钛蓝', '森林绿', '极简黑白']) {
      await chooseOnSettings(preset);
      for (const [path, marker] of PAGES) {
        const dom = await browser.navigateAndWait(path, [marker]);
        const sampled = await sample();
        const rated = sampled.samples.map((item) => ({ ...item, ratio: contrast(item.color, item.background) }));
        const worst = rated.reduce((min, item) => (item.ratio < min.ratio ? item : min), rated[0] ?? { ratio: 99 });
        const label = `${theme}/${preset} ${path}`;
        check(`${label} rendered`, dom.includes(marker), `-> ${dom.slice(0, 30).replace(/\n/g, ' ')}`);
        check(
          `${label} every text element ≥ ${TEXT_MIN}:1`,
          worst.ratio >= TEXT_MIN,
          `worst ${round2(worst.ratio)}:1 <${worst.tag} class="${worst.className}"> "${worst.text}" ${worst.color} on ${worst.background}`,
        );
        if (sampled.primaryButton !== null) {
          const ratio = contrast(sampled.primaryButton.color, sampled.primaryButton.background);
          check(`${label} primary-button text ≥ ${TEXT_MIN}:1 on the accent`, ratio >= TEXT_MIN, `-> ${round2(ratio)}:1 (${sampled.primaryButton.text})`);
        }
      }
    }
  }
  check('no runtime errors were logged', browser.consoleErrors.length === 0, browser.consoleErrors.join(' | ').slice(0, 200));

  // ── the browser chrome follows the surface ────────────────────────────────
  console.log('\n[theme-color]');
  await chooseOnSettings('钛蓝');
  await chooseOnSettings('深色');
  await browser.navigateAndWait('/', ['概览']);
  const darkChrome = await sample();
  check('in dark, every theme-color meta is the dark surface', darkChrome.themeColorMetas.length > 0 && darkChrome.themeColorMetas.every((value) => same(value, darkChrome.tokens['--surface'])), `-> ${darkChrome.themeColorMetas.join(', ')} vs ${darkChrome.tokens['--surface']}`);
  await chooseOnSettings('浅色');
  await browser.navigateAndWait('/', ['概览']);
  const lightChrome = await sample();
  check('in light, every theme-color meta is the light surface', lightChrome.themeColorMetas.every((value) => same(value, lightChrome.tokens['--surface'])), `-> ${lightChrome.themeColorMetas.join(', ')}`);
  check('and the two surfaces differ, so the meta really moved', lightChrome.tokens['--surface'] !== darkChrome.tokens['--surface']);

  // ── the category palette, as painted ──────────────────────────────────────
  console.log('\n[category palette]');
  await browser.navigateAndWait('/stats', ['统计', '分类占比']);
  const lightStats = await sample();
  check('the donut has four slices', lightStats.slices.length === 4, `-> ${lightStats.slices.length}`);
  const paints = (sampled) => sampled.slices.map((fill) => rgbToHex(toRgb(fill)));
  const lightPaints = paints(lightStats);
  const expectLight = {
    food: lightStats.tokens['--cat-1'],
    transport: lightStats.tokens['--cat-2'],
    housing: lightStats.tokens['--cat-3'],
    shopping: '#336699',
  };
  for (const [name, hex] of Object.entries(expectLight)) {
    check(`light: the ${name} slice is painted ${name === 'shopping' ? 'its custom colour' : 'with its palette token'}`, lightPaints.includes(hex.toLowerCase()), `-> ${hex} in ${lightPaints.join(', ')}`);
  }

  await chooseOnSettings('深色');
  await browser.navigateAndWait('/stats', ['统计', '分类占比']);
  const darkStats = await sample();
  const darkPaints = paints(darkStats);
  check('dark: the food slice is painted with the dark variant of its slot', darkPaints.includes(darkStats.tokens['--cat-1'].toLowerCase()), `-> ${darkStats.tokens['--cat-1']} in ${darkPaints.join(', ')}`);
  check('dark: the un-migrated housing colour still lands on its slot, in the dark variant', darkPaints.includes(darkStats.tokens['--cat-3'].toLowerCase()), `-> ${darkStats.tokens['--cat-3']}`);
  check('dark: the slot variant differs from the stored light value', darkStats.tokens['--cat-1'] !== lightStats.tokens['--cat-1'], `-> ${lightStats.tokens['--cat-1']} → ${darkStats.tokens['--cat-1']}`);
  check('dark: a custom colour passes through unchanged', darkPaints.includes('#336699'));
  check('dark: no slice is painted black (an SVG attribute cannot hold var())', !darkPaints.includes('#000000'), `-> ${darkPaints.join(', ')}`);
  // The 3:1 guarantee is the palette's. A custom colour is the user's own choice and passes
  // through unchanged, so it is reported rather than gated.
  for (const [label, sampled] of [['light', lightStats], ['dark', darkStats]]) {
    const rated = sampled.slices.map((fill) => [rgbToHex(toRgb(fill)), round2(contrast(fill, sampled.tokens['--surface']))]);
    const palette = rated.filter(([hex]) => hex !== '#336699');
    const faint = palette.filter(([, ratio]) => ratio < 3);
    check(`${label}: every palette slice ≥ 3:1 against the card`, palette.length === 3 && faint.length === 0, faint.map(([hex, ratio]) => `${hex}=${ratio}`).join(' | ') || `-> ${palette.map(([hex, ratio]) => `${hex}=${ratio}`).join(', ')}`);
    const custom = rated.find(([hex]) => hex === '#336699');
    console.log(`  note  ${label}: the custom colour #336699 measures ${custom?.[1]}:1 on the card (not gated)`);
  }

  // ── the envelope tones ────────────────────────────────────────────────────
  console.log('\n[budget tones]');
  for (const theme of ['浅色', '深色']) {
    await chooseOnSettings(theme);
    const dom = await browser.navigateAndWait('/budget', ['本周期预算']);
    const sampled = await sample();
    const byClass = (fragment) => sampled.fills.filter((fill) => fill.className.split(' ').includes(fragment));
    const warningFills = byClass('warning');
    const overFills = byClass('over');
    const normalFills = byClass('normal');
    check(`${theme}: one envelope at 85% wears the warning tone`, warningFills.length === 1 && same(warningFills[0].background, sampled.tokens['--warning']), `-> ${warningFills.map((f) => f.background).join(', ')} vs ${sampled.tokens['--warning']}`);
    check(`${theme}: one envelope at 120% wears the danger tone`, overFills.length === 1 && same(overFills[0].background, sampled.tokens['--danger']), `-> ${overFills.map((f) => f.background).join(', ')}`);
    check(`${theme}: the two envelopes under 80% wear the accent`, normalFills.length === 2 && normalFills.every((fill) => same(fill.background, sampled.tokens['--accent'])), `-> ${normalFills.map((f) => f.background).join(', ')}`);
    check(`${theme}: the tones are also stated in words`, dom.includes('接近上限') && dom.includes('已超支'));
    check(`${theme}: the page counts both tiers`, dom.includes('1 个模块已超支') && dom.includes('1 个模块接近上限'), `-> ${dom.replace(/\n/g, ' | ').slice(0, 200)}`);
    const warningNotice = sampled.notices.find((n) => n.className.includes('notice-warning'));
    const dangerNotice = sampled.notices.find((n) => n.className.includes('notice-danger'));
    check(`${theme}: the warning notice is the warning tint with warning text`, warningNotice !== undefined && same(warningNotice.background, sampled.tokens['--warning-subtle']) && same(warningNotice.color, sampled.tokens['--warning']), `-> ${warningNotice?.color} on ${warningNotice?.background}`);
    check(`${theme}: the danger notice is the danger tint with danger text`, dangerNotice !== undefined && same(dangerNotice.background, sampled.tokens['--danger-subtle']) && same(dangerNotice.color, sampled.tokens['--danger']), `-> ${dangerNotice?.color} on ${dangerNotice?.background}`);
    for (const notice of sampled.notices) {
      const ratio = contrast(notice.color, notice.background);
      check(`${theme}: notice "${notice.text.slice(0, 12)}" text ≥ ${TEXT_MIN}:1 on its tint`, ratio >= TEXT_MIN, `-> ${round2(ratio)}:1`);
    }
    for (const fill of [...warningFills, ...overFills, ...normalFills]) {
      const ratio = contrast(fill.background, sampled.tokens['--bg']);
      check(`${theme}: fill ${fill.className.split(' ').pop()} ≥ 3:1 against its track`, ratio >= 3, `-> ${round2(ratio)}:1`);
    }
  }

  // The dashboard repeats the worst tier in one sentence.
  const home = await browser.navigateAndWait('/', ['概览', '本周期剩余']);
  const homeSample = await sample();
  const homeNotice = homeSample.notices.find((n) => n.className.includes('notice-danger'));
  check('the dashboard names the overspent module in a danger notice', homeNotice !== undefined && home.includes('1 个模块超支'), `-> ${homeNotice?.text}`);

  // ── the settings page at phone width ──────────────────────────────────────
  console.log('\n[settings layout]');
  await browser.navigateAndWait('/settings', ['外观', '主色']);
  await browser.usePhoneViewport();
  const metrics = await browser.measureLayout();
  check('no control on the settings page is shorter than 44px', metrics.smallTargets.length === 0, metrics.smallTargets.map((t) => `${t.tag}:${t.text}=${t.h}px`).join(' | '));
  check(`the settings page does not scroll horizontally at ${PHONE_VIEWPORT.width}px`, metrics.docWidth <= PHONE_VIEWPORT.width, `-> ${metrics.docWidth}`);

  await chooseOnSettings('跟随系统');
  await browser.screenshot(OUT_PNG);
  console.log(`\nscreenshot written to ${OUT_PNG}`);
} finally {
  await browser.close();
}

finish('COLOUR RENDER');
process.exitCode = failures === 0 ? 0 : 1;
