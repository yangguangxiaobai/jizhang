/**
 * Renders the app in headless Chrome and measures the motion.
 *
 * ## Why this suite is not optional
 *
 * `check-motion.mjs` reads CSS source. It can prove that a duration is a token and that a
 * keyframe name is not misspelled, and it cannot prove that a single animation runs. Every
 * assertion below is about the rendered result, because that is where motion fails:
 *
 *   - an `animation-name` that resolves to nothing is not an error, it is silence;
 *   - a token override that never reaches an element looks identical in source;
 *   - `:active` cannot be produced by dispatching events at all, so press feedback that
 *     nobody has measured is press feedback that may not exist;
 *   - the keyframe properties are read from the engine, not from the file.
 *
 * ## Two things this measures that a screenshot cannot
 *
 * 1. **The reduced-motion path is exercised, not assumed.** `Emulation.setEmulatedMedia`
 *    puts the browser into `prefers-reduced-motion: reduce` and the suite then asserts that
 *    the *rendered text is identical* to the normal run and that no laid-out element is
 *    left fully transparent. That is the whole promise of the contract: motion is removed,
 *    content is not.
 * 2. **Nothing is stranded.** An element that only becomes visible because an animation
 *    revealed it is invisible under reduced motion. Counting fully-transparent laid-out
 *    boxes on both sides of the switch is how that class of bug is caught — and only after
 *    the arrival has finished, because a block sitting out its stagger delay is *supposed*
 *    to be transparent, and counting it would make the check fire on correct behaviour.
 *
 * ## Vue renames scoped keyframes
 *
 * A `@keyframes` declared inside an SFC's `<style scoped>` is emitted as `grow-y-23111426`:
 * the scope hash is appended to the name and to the `animation` reference. Global
 * keyframes from `styles/main.css` keep their bare names. Assertions therefore match by
 * prefix, and a suite that compared for equality would report every component animation as
 * missing.
 *
 * Usage: node scripts/render-motion.mjs <out.png> [base-url]
 */

import { rgbToHex, toRgb } from './lib/color.mjs';
import { execFileSync } from 'node:child_process';

import { makeChecker, openBrowser } from './lib/browser.mjs';

const OUT_PNG = process.argv[2] ?? 'motion.png';
const ORIGIN = process.argv[3] ?? 'http://127.0.0.1:8081';
const BASE = `${ORIGIN}/api/v1`;

// The sibling suites take the screenshot path first and the origin second. This one used to
// take the origin first, and a uniform runner that passed `<out.png> [base-url]` to all six
// therefore handed a Windows screenshot path to `fetch` and produced a bare
// `TypeError: fetch failed`. Same signature as the others, plus a check that says so.
if (!/^https?:\/\//.test(ORIGIN)) {
  console.error(`the base URL must start with http:// — got ${ORIGIN}`);
  console.error('usage: node scripts/render-motion.mjs <out.png> [base-url]');
  process.exit(1);
}

const { check, failures, finish } = makeChecker();

/** Properties an animation may drive without forcing layout. */
const COMPOSITOR_SAFE = new Set([
  'opacity',
  'transform',
  'fill',
  'stroke',
  'backgroundColor',
  'color',
  'boxShadow',
  'filter',
  'visibility',
]);

/** Longest acceptable delay + duration for an arriving view, in ms. */
const MAX_ARRIVAL_MS = 800;

/** How long to let an arrival finish before judging whether anything is stranded. */
const SETTLE_MS = 700;

const FOOD = 'builtin-expense-food';
const TRANSPORT = 'builtin-expense-transport';
const HOUSING = 'builtin-expense-housing';
const SALARY = 'builtin-income-salary';
const ACCOUNT = 'builtin-default-account';

const now = new Date();
/** A day inside the current month, safely in the past. */
const dayThisMonth = (day) => new Date(now.getFullYear(), now.getMonth(), day).getTime();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Parses a computed CSS time (`"0.22s"`, `"36ms"`) into milliseconds. */
function toMs(value) {
  const text = String(value).trim();
  if (text.endsWith('ms')) return Number.parseFloat(text);
  if (text.endsWith('s')) return Number.parseFloat(text) * 1000;
  return Number.parseFloat(text);
}

// ── seed ─────────────────────────────────────────────────────────────────────
// The donut only renders when a category has a positive net expense, so a ledger with no
// spending of its own would silently skip the arc assertion — the one animation that
// proves the "arcs" principle. The suite therefore starts from the shared baseline and
// seeds its own spending rather than inheriting whatever the previous suite left behind.
//
// Wait for the server first. Nothing about this app's own suites needs it — the wait was
// added while chasing a bare `TypeError: fetch failed`, and it is what turned that into a
// message naming the unreachable URL, which is how the real cause surfaced: this suite had
// its two arguments the other way round from its five siblings, so a uniform runner handed
// it a screenshot path as the base URL. The wait stays because a suite that seeds over HTTP
// should say which host it could not reach instead of failing inside `fetch`.
async function waitForHealth(attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) return true;
    } catch {
      // not up yet
    }
    await sleep(250);
  }
  return false;
}

if (!(await waitForHealth())) {
  console.error(`the server at ${BASE} never became reachable; start it before running this suite`);
  process.exit(1);
}

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

const loginResponse = await fetch(`${BASE}/auth/login`, {
  method: 'POST',
  headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: process.env.JIZHANG_E2E_USER ?? 'admin',
    password: process.env.JIZHANG_E2E_PASSWORD ?? 'probe-password',
  }),
});
const sessionCookie = (loginResponse.headers.getSetCookie?.() ?? [])
  .find((entry) => entry.startsWith('jizhang_session='))
  ?.split(';')[0];
if (sessionCookie === undefined) throw new Error('seeding login failed');
const jsonHeaders = {
  'X-Requested-With': 'fetch',
  'Content-Type': 'application/json',
  Cookie: sessionCookie,
};

for (const body of [
  { type: 0, amountCents: 150_000, categoryId: FOOD, date: dayThisMonth(5), note: '买菜' },
  { type: 0, amountCents: 48_000, categoryId: FOOD, date: dayThisMonth(9), note: '午饭' },
  { type: 0, amountCents: 30_000, categoryId: TRANSPORT, date: dayThisMonth(7), note: '打车' },
  { type: 0, amountCents: 220_000, categoryId: HOUSING, date: dayThisMonth(3), note: '房租' },
  { type: 1, amountCents: 900_000, categoryId: SALARY, date: dayThisMonth(1), note: '工资' },
]) {
  const response = await fetch(`${BASE}/transactions`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ accountId: ACCOUNT, ...body }),
  });
  if (!response.ok) throw new Error(`seeding ${body.note} failed: ${response.status}`);
}

// A recurring rule anchored two months back is due several times by now, so the dashboard
// renders its 待确认 card — which is the only element in the app that uses the overshoot
// easing, and therefore the only way the exaggeration assertion below can mean anything.
// The card is conditional by design ("a permanent 0-item card would be worse than no card"),
// so the fixture has to create the condition rather than the assertion skip it.
{
  const response = await fetch(`${BASE}/recurring/rules`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      name: '房租',
      type: 0,
      amountCents: 250_000,
      categoryId: FOOD,
      accountId: ACCOUNT,
      frequency: 'monthly',
      anchorDate: new Date(now.getFullYear(), now.getMonth() - 2, 3).getTime(),
    }),
  });
  if (!response.ok) throw new Error(`seeding the recurring rule failed: ${response.status}`);
}

const browser = await openBrowser({
  origin: ORIGIN,
  profileDir: `${process.env.TEMP ?? '/tmp'}/jizhang-cdp-motion`,
});
console.log(`browser: ${browser.browserVersion}`);
console.log(`origin:  ${ORIGIN}`);

/** Arrival timings of a view's top-level blocks, in DOM order, in milliseconds. */
async function arrivalTimings() {
  const raw =
    (await browser.evaluate(`(() => {
      return [...document.querySelectorAll('.view-slot > *')].map((el) => {
        const style = getComputedStyle(el);
        return {
          tag: el.tagName.toLowerCase(),
          className: typeof el.className === 'string' ? el.className.slice(0, 30) : '',
          name: style.animationName,
          delay: style.animationDelay,
          duration: style.animationDuration,
          fill: style.animationFillMode,
        };
      });
    })()`)) ?? [];
  return raw.map((entry) => ({
    ...entry,
    delay: toMs(entry.delay),
    duration: toMs(entry.duration),
  }));
}

/**
 * Fully transparent elements that still occupy a box.
 *
 * These are the elements an animation might have been responsible for revealing. `display:
 * none` and collapsed boxes are excluded: those are hidden on purpose and are not a
 * stranded reveal.
 */
const TRANSPARENT_BOXES = `(() => {
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    if (Number(style.opacity) === 0) {
      out.push(el.tagName.toLowerCase() + '.' + (typeof el.className === 'string' ? el.className : ''));
    }
  }
  return out;
})()`;

try {
  await browser.installMotionRecorder();

  // ── 1. the app moves at all, and moves the right things ────────────────────
  console.log('\n[dashboard arrival]');
  const markers = ['概览', '收入', '支出', '结余', '最近账单'];
  const dashDom = await browser.navigateAndWait('/', markers);
  // `animationstart` fires when an animation *begins*, which for a staggered arrival is
  // after its delay — so the log is incomplete until the last block has started. Reading it
  // as soon as the page renders under-counts, intermittently, by exactly the number of
  // blocks that had not begun yet. Observed: 2 of 4 one run, 4 of 4 the next.
  await sleep(SETTLE_MS);
  const dashMotion = await browser.readMotionLog();

  check(
    'the dashboard rendered (the suite is not measuring an empty page)',
    dashDom.includes('最近账单'),
  );

  const dashRise = dashMotion.filter((entry) => entry.name === 'rise-in');
  check('the view blocks actually animate on arrival', dashRise.length > 0, `-> ${dashRise.length}`);
  check(
    'a view with several blocks starts more than one arrival animation',
    dashRise.length >= 3,
    `-> ${dashRise.length} started`,
  );
  check(
    'the pending-decision card pops rather than rises (the one exaggeration)',
    dashMotion.some((entry) => entry.name.startsWith('pop-in')),
    `-> ${[...new Set(dashMotion.map((entry) => entry.name))].join(', ')}`,
  );

  // ── 2. the arrival is staged (sequential), not simultaneous ────────────────
  const timings = await arrivalTimings();
  console.log(
    `      ${timings.length} block(s): ${timings
      .map((timing) => `${timing.className || timing.tag}@${timing.delay}ms/${timing.duration}ms`)
      .join(' ')}`,
  );
  check('the view has more than one top-level block to stage', timings.length >= 3, `-> ${timings.length}`);

  const delays = timings.map((timing) => timing.delay);
  check(
    'blocks arrive in DOM order (delays never go backwards)',
    delays.every((delay, index) => index === 0 || delay >= (delays[index - 1] ?? 0)),
    `-> ${delays.join(', ')}ms`,
  );
  check(
    'the arrival is staggered rather than simultaneous',
    new Set(delays).size > 1,
    `-> ${new Set(delays).size} distinct delay(s)`,
  );
  check(
    `the whole arrival finishes inside ${MAX_ARRIVAL_MS}ms`,
    timings.every((timing) => timing.delay + timing.duration <= MAX_ARRIVAL_MS),
    `-> worst ${Math.max(...timings.map((t) => t.delay + t.duration))}ms`,
  );
  check(
    'every arrival uses `backwards` fill, so nothing is left holding a frame',
    timings.every((timing) => timing.fill === 'backwards'),
    `-> ${[...new Set(timings.map((t) => t.fill))].join(', ')}`,
  );

  // ── 3. nothing animates a layout property (measured, not read) ─────────────
  console.log('\n[animated properties]');
  const offenders = [];
  const seenProperties = new Set();
  for (const entry of dashMotion) {
    for (const property of entry.properties) {
      seenProperties.add(property);
      if (!COMPOSITOR_SAFE.has(property)) {
        offenders.push(`${entry.name} animates ${property} on <${entry.tag}>`);
      }
    }
  }
  console.log(`      properties seen: ${[...seenProperties].join(', ') || '(none reported)'}`);
  check(
    'every animation drives only compositor-safe properties',
    offenders.length === 0,
    offenders.join(' | '),
  );

  // ── 4. easing is never linear ─────────────────────────────────────────────
  // Read from the animating element's computed style. The Web Animations API reports a
  // CSS animation's effect-level easing as `linear` for every animation in the app, which
  // is exactly the value that would make this check useless.
  const linear = dashMotion.filter((entry) => entry.easing === 'linear');
  check(
    'no animation uses `linear` easing',
    linear.length === 0,
    linear.map((entry) => entry.name).join(', '),
  );
  console.log(
    `      easings: ${[...new Set(dashMotion.map((entry) => entry.easing))].join(' | ')}`,
  );

  // ── 5. press feedback exists (the one thing events cannot test) ────────────
  console.log('\n[press feedback]');
  const scaleOf = (matrix) => {
    if (typeof matrix !== 'string' || matrix === 'none') return 1;
    const parts = matrix.match(/matrix\(([^)]+)\)/);
    return parts === null ? 1 : Number(parts[1].split(',')[0]);
  };
  const tabTransform = () =>
    browser.evaluate('getComputedStyle(document.querySelector(".tabbar .tab")).transform');

  const restingTransform = await tabTransform();
  const press = await browser.forcePseudoState('.tabbar .tab', ['active']);
  await sleep(250);
  const pressedTransform = await tabTransform();
  await press.release();
  await sleep(250);
  const releasedTransform = await tabTransform();

  console.log(
    `      resting=${restingTransform} pressed=${pressedTransform} released=${releasedTransform}`,
  );
  check('a tab is unscaled at rest', scaleOf(restingTransform) === 1, `-> ${scaleOf(restingTransform)}`);
  check(
    'a tab squashes under the finger',
    scaleOf(pressedTransform) < 1 && scaleOf(pressedTransform) > 0.9,
    `-> scale ${scaleOf(pressedTransform)}`,
  );
  check(
    'and returns to full size when released',
    scaleOf(releasedTransform) === 1,
    `-> scale ${scaleOf(releasedTransform)}`,
  );

  // ── 6. the active tab pill and its follow-through ─────────────────────────
  console.log('\n[tab indicator]');
  const indicator = await browser.evaluate(`(() => {
    const read = (selector) => {
      const el = document.querySelector(selector);
      const glyph = el?.querySelector('.glyph');
      if (glyph === null || glyph === undefined) return null;
      const style = getComputedStyle(glyph);
      const box = glyph.getBoundingClientRect();
      return {
        opacity: Number(style.opacity),
        background: style.backgroundColor,
        glyphTransform: style.transform,
        weight: Number(getComputedStyle(el).fontWeight),
        width: box.width,
        height: box.height,
      };
    };
    return {
      active: read('.tabbar .tab.active:not(.primary)'),
      inactive: read('.tabbar .tab:not(.active):not(.primary)'),
      tint: getComputedStyle(document.documentElement).getPropertyValue('--accent-subtle').trim(),
    };
  })()`);
  check(
    'the active tab has a visible pill',
    indicator.active !== null && indicator.active.width > 0 && indicator.active.height > 0,
    JSON.stringify(indicator.active),
  );
  check(
    'the active indicator is fully drawn in the preset tint',
    indicator.active !== null && indicator.active.opacity === 1 &&
      rgbToHex(toRgb(indicator.active.background)) === rgbToHex(toRgb(indicator.tint)),
    indicator.active?.background,
  );
  check(
    'an inactive destination has no colored pill',
    indicator.inactive !== null && ['rgba(0, 0, 0, 0)', 'transparent'].includes(indicator.inactive.background),
    indicator.inactive?.background,
  );
  check(
    'selection also has a text-weight cue',
    indicator.active !== null && indicator.inactive !== null && indicator.active.weight > indicator.inactive.weight,
  );
  check(
    'the active tab glyph is lifted (follow-through)',
    indicator.active !== null && indicator.active.glyphTransform !== 'none',
    indicator.active?.glyphTransform,
  );

  // ── 7. the charts animate, and the donut uses arcs ────────────────────────
  console.log('\n[charts]');
  const statsDom = await browser.navigateAndWait('/stats', ['分类占比', '月度收支']);
  await sleep(SETTLE_MS);
  const statsMotion = await browser.readMotionLog();
  check('the stats page rendered', statsDom.includes('月度收支'));

  const barCount = (await browser.evaluate('document.querySelectorAll(".bars rect.bar").length')) ?? 0;
  const barStarts = statsMotion.filter((entry) => entry.name.startsWith('grow-y')).length;
  console.log(`      ${barCount} bar(s) rendered, ${barStarts} growth animation(s) started`);
  check('the bar chart draws bars', barCount > 0, `-> ${barCount}`);
  check(
    'every bar animates its growth',
    // The chart re-renders when the stats response arrives, and a re-render restarts the
    // animation — so this counts starts, not bars, and asks only that each bar animated.
    barStarts >= barCount,
    `-> ${barStarts} start(s) for ${barCount} bar(s)`,
  );

  const sliceCount = (await browser.evaluate('document.querySelectorAll("svg path.slice").length')) ?? 0;
  const arcStarts = statsMotion.filter((entry) => entry.name.startsWith('arc-in')).length;
  console.log(`      ${sliceCount} donut slice(s) rendered, ${arcStarts} arc animation(s) started`);
  check(
    'the ledger has spending, so the donut renders at all',
    sliceCount >= 2,
    `-> ${sliceCount} slice(s)`,
  );
  check('every donut slice swings in along its own arc', arcStarts >= sliceCount, `-> ${arcStarts} of ${sliceCount}`);
  const arcEntry = statsMotion.find((entry) => entry.name.startsWith('arc-in'));
  if (arcEntry !== undefined) {
    check(
      'the arc animation moves the slice by rotation and scale',
      arcEntry.properties.includes('transform') && arcEntry.properties.includes('opacity'),
      `-> ${arcEntry.properties.join(', ')}`,
    );
  }

  // Both charts own a `.legend`, so the selector has to name the donut's: the bar chart's
  // legend is a static key and is deliberately not staggered.
  const legendReveals = await browser.evaluate(`(() => {
    const legend = document.querySelector('.donut + .legend');
    if (legend === null) return [];
    return [...legend.querySelectorAll('li')].map((el) => {
      const style = getComputedStyle(el);
      return { name: style.animationName, delay: style.animationDelay };
    });
  })()`);
  const sliceDelays = await browser.evaluate(`(() => {
    return [...document.querySelectorAll('svg path.slice')].map((el) =>
      getComputedStyle(el).animationDelay,
    );
  })()`);
  check(
    'the donut legend is staggered',
    legendReveals.length > 0 &&
      legendReveals.every((entry) => entry.name.startsWith('rise-in')) &&
      toMs(legendReveals[0].delay) > 0,
    `-> ${legendReveals.map((entry) => `${entry.name}@${entry.delay}`).join(' ')}`,
  );
  check(
    'the donut legend follows the arcs rather than arriving with them',
    toMs(legendReveals[0]?.delay ?? 0) > toMs(sliceDelays[0] ?? 0),
    `-> legend first at ${toMs(legendReveals[0]?.delay ?? 0)}ms, slices start at ${toMs(sliceDelays[0] ?? 0)}ms`,
  );

  // ── 8. the elevation ladder is real in both themes ───────────────────────
  // Depth is the one part of the system that cannot be checked by reading a diff and — with
  // no image-capable reviewer in the loop — cannot be checked by looking either. A shadow
  // that is a single blur reads as a grey halo rather than as an object above a surface, and
  // a light-mode ladder copied into dark mode is invisible. Both are measurable.
  //
  // Measured on the dashboard, because the attention card only exists there; the previous
  // version of this block ran on /stats, where `document.querySelector` returned null and
  // the comparison passed vacuously against a missing element.
  console.log('\n[elevation]');
  await browser.navigateAndWait('/', markers);
  await sleep(SETTLE_MS);
  const shadows = await browser.evaluate(`(() => {
    const read = (selector) => {
      const el = document.querySelector(selector);
      return el === null ? null : getComputedStyle(el).boxShadow;
    };
    const collect = () => ({
      topbar: read('.topbar'),
      pending: read('.pending-card'),
      card: read('.recent') ?? read('.card'),
    });
    document.documentElement.setAttribute('data-theme', 'light');
    const light = collect();
    document.documentElement.setAttribute('data-theme', 'dark');
    const dark = collect();
    document.documentElement.removeAttribute('data-theme');
    return { light, dark };
  })()`);

  const partCount = (value) =>
    typeof value === 'string' && value !== 'none' ? value.split(/,(?![^(]*\))/).length : 0;
  for (const theme of ['light', 'dark']) {
    const theme1 = shadows[theme];
    check(
      `${theme}: the sticky header casts a shadow over the content passing under it`,
      typeof theme1.topbar === 'string' && theme1.topbar !== 'none',
      `-> ${theme1.topbar}`,
    );
    check(
      `${theme}: the attention card is raised, and on a higher rung than the header`,
      typeof theme1.pending === 'string' &&
        theme1.pending !== 'none' &&
        theme1.pending !== theme1.topbar,
      `-> ${theme1.pending}`,
    );
    check(
      `${theme}: every shadow in use is two-part (a key shadow and an ambient one)`,
      [theme1.topbar, theme1.pending].every((value) => partCount(value) === 2),
      `-> ${[theme1.topbar, theme1.pending].map(partCount).join(', ')} part(s)`,
    );
    check(
      `${theme}: content cards stay flat, so elevation still means something`,
      theme1.card === null || theme1.card === 'none',
      `-> ${theme1.card}`,
    );
  }
  check(
    'dark mode re-derives the ladder rather than inheriting the light one',
    shadows.dark.topbar !== shadows.light.topbar,
    `-> ${shadows.light.topbar} vs ${shadows.dark.topbar}`,
  );

  // ── 9. the reduced-motion contract, exercised ────────────────────────────
  console.log('\n[reduced motion]');
  const routes = [
    ['/', ['最近账单']],
    ['/transactions', ['账单']],
    ['/budget', ['预算']],
    ['/stats', ['月度收支']],
    ['/settings', ['我的']],
  ];

  // Baseline first, with motion on, and only after the arrival has settled — a block
  // sitting out its own stagger delay is transparent on purpose.
  const baseline = new Map();
  for (const [path, routeMarkers] of routes) {
    const text = await browser.navigateAndWait(path, routeMarkers);
    const settled = await arrivalTimings();
    await sleep(SETTLE_MS);
    baseline.set(path, text.trim());
    const transparent = (await browser.evaluate(TRANSPARENT_BOXES)) ?? [];
    check(
      `with motion on, ${path} leaves nothing fully transparent once settled`,
      transparent.length === 0,
      transparent.join(', '),
    );
    check(
      `with motion on, ${path} has a real (non-zero) arrival`,
      settled.some((timing) => timing.duration >= 200) || settled.length === 0,
      `-> ${[...new Set(settled.map((t) => t.duration))].join(', ')}ms`,
    );
  }

  await browser.emulateReducedMotion(true);

  for (const [path, routeMarkers] of routes) {
    const text = await browser.navigateAndWait(path, routeMarkers);
    check(
      `reduced motion renders identical text on ${path}`,
      text.trim() === baseline.get(path),
      `-> ${text.trim().length} chars vs ${(baseline.get(path) ?? '').length}`,
    );

    const timingsUnderReduced = await arrivalTimings();
    check(
      `reduced motion collapses every arrival on ${path}`,
      timingsUnderReduced.every((timing) => timing.duration <= 2),
      `-> ${[...new Set(timingsUnderReduced.map((t) => t.duration))].join(', ')}ms`,
    );
    check(
      `reduced motion collapses the stagger on ${path}`,
      timingsUnderReduced.every((timing) => timing.delay === 0),
      `-> ${timingsUnderReduced.map((timing) => timing.delay).join(', ')}ms`,
    );
    check(
      `reduced motion leaves the resting state in place on ${path}`,
      timingsUnderReduced.every((timing) => timing.name !== 'none'),
      '-> an element with no animation would never have been revealed',
    );

    const transparent = (await browser.evaluate(TRANSPARENT_BOXES)) ?? [];
    check(
      `reduced motion strands nothing invisible on ${path}`,
      transparent.length === 0,
      transparent.join(', '),
    );
  }

  await browser.emulateReducedMotion(false);

  // ── 10. the token override reaches real elements when motion is on ────────
  console.log('\n[timing scale]');
  await browser.navigateAndWait('/', markers);
  const restored = await arrivalTimings();
  const restoredDurations = [...new Set(restored.map((timing) => timing.duration))];
  check(
    'restoring the media query restores the real durations',
    restored.every((timing) => timing.duration >= 200),
    `-> ${restoredDurations.join(', ')}ms`,
  );
  check(
    'every duration matches a token (220ms = --dur-base, 320ms = --dur-slow)',
    restored.every((timing) => [220, 320].includes(timing.duration)),
    `-> ${restoredDurations.join(', ')}ms`,
  );

  check(
    'no runtime errors were logged during the whole run',
    browser.consoleErrors.length === 0,
    browser.consoleErrors.join(' | '),
  );

  await browser.screenshot(OUT_PNG);
  console.log(`\nscreenshot written to ${OUT_PNG}`);
} finally {
  await browser.close();
}

finish('MOTION');
process.exitCode = failures === 0 ? 0 : 1;
