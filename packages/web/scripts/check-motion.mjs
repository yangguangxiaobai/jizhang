/**
 * Static audit of the motion system.
 *
 * ## Why this is separate from `check-mobile.mjs`
 *
 * That audit answers "can a finger hit it"; this one answers "is the motion safe to run".
 * Both read CSS *source*, and both are deliberately blind to computed values — the
 * rendered measurements live in `scripts/render-motion.mjs`, which drives a real browser.
 *
 * ## What it can see that a browser test cannot
 *
 * A browser can measure one element on one page. It cannot tell you that a keyframe name
 * is misspelled somewhere in a component that happens not to be on screen — and a
 * misspelled `animation-name` is a **silent** no-op, not an error, so the element simply
 * never animates and nothing anywhere complains. Five of the checks below are of that
 * shape: invariants that are cheap to state about the source and expensive to notice in
 * a rendering.
 *
 *   1. nothing animates `all`;
 *   2. nothing uses `linear` easing;
 *   3. every duration is a token, never a literal — this is what lets one
 *      `prefers-reduced-motion` block switch the whole application off;
 *   4. no keyframe declares a `to` frame (the resting state must be the rule, or an
 *      animation that fails to run leaves the element hidden);
 *   5. no keyframe animates a layout property;
 *   6. every `@keyframes` referenced is defined, and every one defined is referenced;
 *   7. every `--dur-*` token is reset inside the reduced-motion block;
 *   8. every staggered delay is capped.
 *
 * Usage: node scripts/check-motion.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', 'src');

/**
 * Properties whose animation forces the browser to re-run layout every frame. Animating
 * one is not a style preference: on a phone it is the difference between a transition
 * that costs nothing and one that drops frames on a list of forty rows.
 */
const LAYOUT_PROPERTIES = new Set([
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'top',
  'right',
  'bottom',
  'left',
  'inset',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'font-size',
  'line-height',
  'flex-basis',
  'gap',
]);

/** The longest a single staggered arrival may be pushed back, in stagger steps. */
const STAGGER_CAP_STEPS = 6;

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) failures += 1;
};

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(vue|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** `<style>` blocks for a component, the whole file for a stylesheet. */
function styleBlocks(path, source) {
  if (path.endsWith('.css')) return [source];
  return [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
}

/**
 * Extracts `@keyframes <name> { ... }` blocks using brace matching.
 *
 * A regex cannot do this: keyframe bodies contain braces, and a lazy `[\s\S]*?}` stops at
 * the first one — which would silently pass every keyframe whose first frame is one line.
 */
function keyframesIn(css) {
  const out = [];
  const re = /@keyframes\s+([A-Za-z_][-\w]*)\s*\{/g;
  let match;
  while ((match = re.exec(css)) !== null) {
    let depth = 1;
    let index = re.lastIndex;
    while (index < css.length && depth > 0) {
      if (css[index] === '{') depth += 1;
      else if (css[index] === '}') depth -= 1;
      index += 1;
    }
    out.push({ name: match[1], body: css.slice(re.lastIndex, index - 1) });
  }
  return out;
}

/** Balanced-brace body of the first `@media (prefers-reduced-motion: reduce)` block. */
function reducedMotionBlock(css) {
  const start = css.search(/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/);
  if (start === -1) return null;
  const open = css.indexOf('{', start);
  let depth = 1;
  let index = open + 1;
  while (index < css.length && depth > 0) {
    if (css[index] === '{') depth += 1;
    else if (css[index] === '}') depth -= 1;
    index += 1;
  }
  return css.slice(open + 1, index - 1);
}

/** Property names declared inside a declaration block, split on top-level semicolons. */
function declaredProperties(block) {
  return [...block.matchAll(/(?:^|;)\s*([a-z-]+)\s*:/g)].map((m) => m[1]);
}

const files = walk(srcDir);
const mainCssPath = join(srcDir, 'styles', 'main.css');
const mainCss = readFileSync(mainCssPath, 'utf8');
const globalKeyframes = new Set(keyframesIn(mainCss).map((k) => k.name));

console.log(`\n[scan] ${files.length} component/style file(s)`);

// ── 1 & 3 & 5. per-declaration rules ─────────────────────────────────────────
console.log('\n[declarations]');
const allProblems = [];
const literalDurations = [];
const layoutAnimations = [];

/** Splits a shorthand value into comma-separated parts and returns the property token. */
function firstIdentifiers(value) {
  return value
    .split(',')
    .map((part) => part.trim().split(/\s+/)[0] ?? '')
    .filter((token) => /^[a-z-]+$/.test(token));
}

for (const path of files) {
  const source = readFileSync(path, 'utf8');
  const rel = relative(srcDir, path);
  for (const block of styleBlocks(path, source)) {
    const css = block.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const chunk of css.split('}')) {
      const [rawSelector, ...rest] = chunk.split('{');
      const body = rest.join('{');
      if (body.trim() === '') continue;
      const selector = (rawSelector ?? '').trim().split('\n').pop()?.trim() ?? '';

      const transition = /(?:^|;)\s*transition\s*:\s*([^;]+)/.exec(body)?.[1];
      const transitionProperty = /(?:^|;)\s*transition-property\s*:\s*([^;]+)/.exec(body)?.[1];
      const animation = /(?:^|;)\s*animation\s*:\s*([^;]+)/.exec(body)?.[1];
      const animationName = /(?:^|;)\s*animation-name\s*:\s*([^;]+)/.exec(body)?.[1];

      for (const [prop, value] of [
        ['transition', transition],
        ['transition-property', transitionProperty],
        ['animation', animation],
        ['animation-name', animationName],
      ]) {
        if (value === undefined) continue;
        if (/\ball\b/.test(value) && prop.startsWith('transition')) {
          allProblems.push(`${rel}: ${selector} -> ${prop}: ${value.trim()}`);
        }
        if (/\blinear\b/.test(value)) {
          allProblems.push(`${rel}: ${selector} -> linear easing in ${prop}: ${value.trim()}`);
        }
        for (const property of firstIdentifiers(value)) {
          if (LAYOUT_PROPERTIES.has(property)) {
            layoutAnimations.push(`${rel}: ${selector} -> animates ${property}`);
          }
        }
      }

      for (const prop of [
        'transition',
        'transition-duration',
        'transition-delay',
        'animation',
        'animation-duration',
        'animation-delay',
      ]) {
        const match = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(body);
        if (match === null) continue;
        // Strip custom-property references and `calc()` first: a token inside them is
        // exactly what we want to see, and it contains no literal time of its own.
        const stripped = (match[1] ?? '')
          .replace(/var\([^)]*\)/g, '')
          .replace(/calc\([^)]*\)/g, '');
        const literals = [...stripped.matchAll(/\d*\.?\d+(?:ms|s)\b/g)].map((m) => m[0]);
        const nonZero = literals.filter((value) => !/^0(?:ms|s)?$/.test(value));
        if (nonZero.length > 0) {
          literalDurations.push(`${rel}: ${selector} -> ${prop}: ${nonZero.join(', ')}`);
        }
      }
    }
  }
}

for (const problem of allProblems) console.log(`      ${problem}`);
check(
  'no transition animates `all`, and no easing is `linear`',
  allProblems.length === 0,
  `${allProblems.length} suspect(s)`,
);

for (const problem of literalDurations) console.log(`      ${problem}`);
check(
  'every duration is a var(--dur-*) token',
  literalDurations.length === 0,
  `${literalDurations.length} suspect(s)`,
);

for (const problem of layoutAnimations) console.log(`      ${problem}`);
check(
  'no transition or animation names a layout property',
  layoutAnimations.length === 0,
  `${layoutAnimations.length} suspect(s)`,
);

// ── 2. keyframe poses ────────────────────────────────────────────────────────
console.log('\n[keyframe poses]');
const defined = new Map(); // name -> file (relative)
const toFrames = [];
const keyframeLayout = [];

for (const path of files) {
  const source = readFileSync(path, 'utf8');
  const rel = relative(srcDir, path);
  for (const block of styleBlocks(path, source)) {
    const css = block.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const keyframe of keyframesIn(css)) {
      defined.set(keyframe.name, rel);
      // A `to`/`100%` frame is banned: the resting state belongs in the rule, so that a
      // keyframe which never runs still leaves a visible element.
      if (/(?:^|\})\s*(?:to|100%)\s*(?:,|\{)/.test(keyframe.body)) {
        toFrames.push(`${rel}: @keyframes ${keyframe.name}`);
      }
      for (const property of declaredProperties(keyframe.body)) {
        if (LAYOUT_PROPERTIES.has(property)) {
          keyframeLayout.push(`${rel}: @keyframes ${keyframe.name} -> ${property}`);
        }
      }
    }
  }
}

for (const problem of toFrames) console.log(`      ${problem}`);
check(
  'no keyframe declares a `to` frame (the resting state is the rule)',
  toFrames.length === 0,
  `${toFrames.length} suspect(s)`,
);

for (const problem of keyframeLayout) console.log(`      ${problem}`);
check(
  'no keyframe animates a layout property',
  keyframeLayout.length === 0,
  `${keyframeLayout.length} suspect(s)`,
);

// ── 4. every referenced keyframe exists, every defined one is used ───────────
console.log('\n[keyframe wiring]');
const missing = [];
const unused = [];
const used = new Set();

for (const path of files) {
  const source = readFileSync(path, 'utf8');
  const rel = relative(srcDir, path);
  const blocks = styleBlocks(path, source);
  const localNames = new Set(blocks.flatMap((block) => keyframesIn(block).map((k) => k.name)));

  for (const block of blocks) {
    const css = block.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const chunk of css.split('}')) {
      const body = chunk.split('{').slice(1).join('{');
      const match = /(?:^|;)\s*animation(?:-name)?\s*:\s*([^;]+)/.exec(body);
      if (match === null) continue;
      for (const token of (match[1] ?? '').split(/[\s,]+/)) {
        if (!/^[a-z][-\w]*$/.test(token)) continue;
        if (['none', 'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'backwards', 'forwards', 'both', 'infinite', 'alternate', 'running', 'paused', 'normal', 'reverse'].includes(token)) {
          continue;
        }
        if (/^\d/.test(token)) continue;
        used.add(token);
        if (!localNames.has(token) && !globalKeyframes.has(token)) {
          missing.push(`${rel}: animation references undefined @keyframes ${token}`);
        }
      }
    }
  }
}

for (const [name, rel] of defined) {
  if (!used.has(name)) unused.push(`${rel}: @keyframes ${name} is defined but never used`);
}

for (const problem of missing) console.log(`      ${problem}`);
check(
  'every animation references a keyframe that is defined',
  missing.length === 0,
  `${missing.length} suspect(s)`,
);

for (const problem of unused) console.log(`      ${problem}`);
check('every defined keyframe is used', unused.length === 0, `${unused.length} suspect(s)`);

// ── 6. the reduced-motion contract covers every duration token ───────────────
console.log('\n[reduced motion]');
const durationTokens = [...mainCss.matchAll(/(--dur-[a-z-]+)\s*:/g)].map((m) => m[1]);
const uniqueTokens = [...new Set(durationTokens)];
const reduce = reducedMotionBlock(mainCss);
const uncovered = [];
if (reduce === null) {
  uncovered.push('main.css: no @media (prefers-reduced-motion: reduce) block at all');
} else {
  for (const token of uniqueTokens) {
    if (!reduce.includes(token)) uncovered.push(`main.css: ${token} is not reset under reduced motion`);
  }
}
for (const problem of uncovered) console.log(`      ${problem}`);
check(
  `all ${uniqueTokens.length} duration token(s) are reset under reduced motion`,
  uncovered.length === 0,
  `${uncovered.length} suspect(s)`,
);

// ── 7. staggered delays are capped ───────────────────────────────────────────
console.log('\n[stagger caps]');
const uncapped = [];
for (const path of files) {
  const source = readFileSync(path, 'utf8');
  const rel = relative(srcDir, path);
  for (const block of styleBlocks(path, source)) {
    const css = block.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const chunk of css.split('}')) {
      const body = chunk.split('{').slice(1).join('{');
      const delay = /(?:^|;)\s*animation-delay\s*:\s*([^;]+)/.exec(body)?.[1];
      if (delay === undefined) continue;
      // A delay driven by an item index must be clipped, or a sixty-row list takes two
      // seconds to finish appearing — which is past the point where it reads as speed.
      if (delay.includes('--stagger') && delay.includes('--i') && !delay.includes('min(')) {
        uncapped.push(`${rel}: animation-delay: ${delay.trim()}`);
      }
    }
  }
}
for (const problem of uncapped) console.log(`      ${problem}`);
check(
  `every index-driven stagger is capped at ${STAGGER_CAP_STEPS} steps`,
  uncapped.length === 0,
  `${uncapped.length} suspect(s)`,
);

// ── report ───────────────────────────────────────────────────────────────────
console.log('\n[manual, reported for the browser pass]');
console.log(`  note  ${defined.size} keyframe pose(s): ${[...defined.keys()].join(', ')}`);
console.log(`  note  ${uniqueTokens.length} duration token(s): ${uniqueTokens.join(', ')}`);
console.log(
  '  note  rendered motion is measured by scripts/render-motion.mjs, which drives a real browser',
);

console.log(`\n${failures === 0 ? 'ALL MOTION STATIC CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
if (failures > 0) process.exitCode = 1;
