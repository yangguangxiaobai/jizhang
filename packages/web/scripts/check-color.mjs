/**
 * Static audit of the colour system.
 *
 * ## What it checks, and why each one is a build failure
 *
 * Colour is the part of a stylesheet where a wrong value looks exactly like a right one.
 * `--muted: #6b7280` and `--muted: #5f6b7a` are indistinguishable in a diff and 0.4:1 apart
 * on the page; `var(--fg)` with no definition is a valid line that paints nothing. So every
 * rule below is stated as something the source either satisfies or does not:
 *
 *   1. no colour literal in a component `<style>` — every colour is a token from main.css
 *      (category colours from the database are applied inline in templates: the sanctioned
 *      exception);
 *   2. every `var(--…)` colour token referenced anywhere is defined, and every colour token
 *      defined is referenced — this is the check that would have caught `--fg` and `--ok`
 *      being used everywhere and defined nowhere, and it is the same "no definition without
 *      a user" rule `check-motion.mjs` applies to the motion tokens;
 *   3. the hand-duplicated theme blocks agree: `:root` with `[data-theme='light']`, the
 *      system-dark block with `[data-theme='dark']`, and each preset's two dark blocks;
 *   4. every theme defines the same set of tokens, and a preset overrides only the accent
 *      rungs;
 *   5. the contrast matrix, for every theme × preset: text pairs ≥ 4.5:1, fills ≥ 3:1,
 *      computed with the WCAG formula rather than judged from a screenshot;
 *   6. the category palette passes the data-viz gates in both themes — lightness band,
 *      chroma floor, adjacent-pair separation under simulated red–green deficiency and for
 *      full-colour vision, contrast against the surface — and matches the shared list the
 *      seed data stores;
 *   7. the pieces outside the stylesheet that restate a colour or a key agree with it: the
 *      PWA manifest, the `theme-color` metas, the icon generator's accent, and the storage
 *      keys and preset names shared by `theme-init.js` and `useTheme.ts`.
 *
 * It is an audit of source: the rendered result, including the presets switched through the
 * real settings screen, is measured by `scripts/render-color.mjs` in a browser.
 *
 * Usage: node scripts/check-color.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { contrast, deltaE, oklch, round2 } from './lib/color.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, '..');
const srcDir = join(webDir, 'src');
const sharedPalettePath = join(webDir, '..', 'shared', 'src', 'palette.ts');

/** WCAG AA for text of any size; the app's body copy is 12–16px, so nothing is "large". */
const TEXT_MIN = 4.5;
/** WCAG 1.4.11 for meaningful non-text: a progress fill against its track, a swatch. */
const GRAPHIC_MIN = 3;

// The data-viz gates for a categorical palette (OKLCH bands; OKLab ΔE ×100 under the
// Machado 2009 simulation). The CVD floor of 6 is legal only with a secondary encoding,
// which the donut has: a legend with the category name, and a surface-coloured gap between
// slices. The full-colour floor has no such relief.
const BAND = { light: [0.43, 0.77], dark: [0.48, 0.67] };
const CHROMA_FLOOR = 0.1;
const CVD_TARGET = 8;
const CVD_FLOOR = 6;
const NORMAL_FLOOR = 15;

const THEMES = ['light', 'dark'];
const PRESETS = ['titanium', 'forest', 'mono'];
/** The rungs a preset is allowed to replace, and must replace all of. */
const PRESET_TOKENS = ['--accent', '--on-accent', '--accent-subtle'];
const CATEGORY_SLOTS = 12;

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) failures += 1;
};
const note = (text) => console.log(`  note  ${text}`);

function walk(dir, extensions) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, extensions));
    else if (extensions.test(entry.name)) out.push(full);
  }
  return out;
}

/** `<style>` blocks for a component, the whole file for a stylesheet. */
function styleBlocks(path, source) {
  if (path.endsWith('.css')) return [source];
  return [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
}

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Splits a stylesheet into `{ selector, body, media }` rules with brace matching, descending
 * into `@media` blocks. A regex cannot do this: a `@media` body contains braces, and a lazy
 * match would end the block at the first rule inside it.
 */
function rulesIn(css, media = null) {
  const out = [];
  let index = 0;
  while (index < css.length) {
    const open = css.indexOf('{', index);
    if (open === -1) break;
    const prelude = css.slice(index, open).trim().split('}').pop().trim();
    let depth = 1;
    let cursor = open + 1;
    while (cursor < css.length && depth > 0) {
      if (css[cursor] === '{') depth += 1;
      else if (css[cursor] === '}') depth -= 1;
      cursor += 1;
    }
    const body = css.slice(open + 1, cursor - 1);
    if (prelude.startsWith('@media')) {
      out.push(...rulesIn(body, prelude.replace(/^@media\s*/, '').replace(/\s+/g, ' ')));
    } else if (prelude.startsWith('@')) {
      // @keyframes and friends carry no tokens.
    } else {
      out.push({ selector: prelude.replace(/\s+/g, ' '), body, media });
    }
    index = cursor;
  }
  return out;
}

/** `--name: value;` pairs declared in a rule body, in order. */
function declarations(body) {
  const out = new Map();
  for (const match of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    out.set(match[1], match[2].trim());
  }
  return out;
}

const COLOUR_VALUE = /^#[0-9a-f]{6}$/i;
const isColourToken = (name, value) => name !== undefined && COLOUR_VALUE.test(value);

const files = walk(srcDir, /\.(vue|css)$/);
/** Token references can also be built in TypeScript (`\`var(--cat-${slot})\``). */
const sourceFiles = walk(srcDir, /\.(vue|css|ts)$/);
const mainCssPath = join(srcDir, 'styles', 'main.css');
const mainCss = stripComments(readFileSync(mainCssPath, 'utf8'));
const rules = rulesIn(mainCss);

console.log(`\n[scan] ${files.length} component/style file(s), ${sourceFiles.length} source file(s)`);

// ── 1. no colour literal in a component style ────────────────────────────────
console.log('\n[literals]');
const LITERAL = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/gi;
const literals = [];
for (const path of files.filter((file) => file.endsWith('.vue'))) {
  const source = readFileSync(path, 'utf8');
  for (const block of styleBlocks(path, source)) {
    const css = stripComments(block);
    for (const match of css.matchAll(LITERAL)) {
      const line = css.slice(0, match.index).split('\n').length;
      literals.push(`${relative(srcDir, path)}:${line} -> ${match[0]}`);
    }
  }
}
for (const problem of literals) console.log(`      ${problem}`);
check('no component <style> contains a colour literal', literals.length === 0, `${literals.length} suspect(s)`);

// ── 2. every colour token referenced is defined, every one defined is referenced ─
console.log('\n[token wiring]');
const rootRule = rules.find((rule) => rule.selector === ':root' && rule.media === null);
const rootDecls = rootRule === undefined ? new Map() : declarations(rootRule.body);
const colourTokens = [...rootDecls].filter(([name, value]) => isColourToken(name, value)).map(([name]) => name);
check(`:root defines colour tokens`, colourTokens.length > 0, `-> ${colourTokens.length}`);

const COLOUR_NAME = /^--(?:bg|surface|border|fg|text|muted|accent|ok|warning|danger|on-[a-z]+|[a-z]+-subtle|cat-\d+)$/;
const allSource = sourceFiles.map((path) => readFileSync(path, 'utf8')).join('\n');
const captured = [...allSource.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1]);
const referenced = new Set(captured.filter((name) => !name.endsWith('-')));
// A reference assembled at runtime — `var(--cat-${slot})` — is captured up to the `${` and
// stands for every token that starts with it.
const referencedPrefixes = captured.filter((name) => name.endsWith('-'));
const isReferenced = (name) =>
  referenced.has(name) || referencedPrefixes.some((prefix) => name.startsWith(prefix));

const undefinedRefs = [...referenced].filter((name) => COLOUR_NAME.test(name) && !colourTokens.includes(name));
for (const name of undefinedRefs) console.log(`      var(${name}) is referenced but never defined in main.css`);
check('every referenced colour token is defined', undefinedRefs.length === 0, `${undefinedRefs.length} suspect(s)`);

const unusedTokens = colourTokens.filter((name) => !isReferenced(name));
for (const name of unusedTokens) console.log(`      ${name} is defined but never referenced`);
check('every defined colour token is referenced', unusedTokens.length === 0, `${unusedTokens.length} suspect(s)`);

// ── 3 & 4. the theme blocks agree, and define the same tokens ───────────────
console.log('\n[theme blocks]');
const find = (selector, media) =>
  rules.find((rule) => rule.selector === selector && rule.media === media);
const DARK_MEDIA = '(prefers-color-scheme: dark)';
const blocks = {
  root: rootRule,
  light: find("[data-theme='light']", null),
  darkSystem: find(":root:not([data-theme='light'])", DARK_MEDIA),
  darkExplicit: find("[data-theme='dark']", null),
};
for (const [name, rule] of Object.entries(blocks)) {
  check(`the ${name} block exists`, rule !== undefined);
}

/** Colour declarations of a block, or an empty map when it is missing. */
const colours = (rule) =>
  new Map([...declarations(rule?.body ?? '')].filter(([name, value]) => isColourToken(name, value)));

function sameTokens(label, a, b) {
  const left = colours(a);
  const right = colours(b);
  const diffs = [];
  for (const [name, value] of left) {
    if (!right.has(name)) diffs.push(`${name} missing on the right`);
    else if (right.get(name) !== value) diffs.push(`${name}: ${value} vs ${right.get(name)}`);
  }
  for (const name of right.keys()) if (!left.has(name)) diffs.push(`${name} missing on the left`);
  for (const diff of diffs) console.log(`      ${diff}`);
  check(label, diffs.length === 0, `${diffs.length} difference(s)`);
}

sameTokens(":root and [data-theme='light'] declare identical colours", blocks.root, blocks.light);
sameTokens("the system-dark and [data-theme='dark'] blocks declare identical colours", blocks.darkSystem, blocks.darkExplicit);
{
  const lightNames = [...colours(blocks.root).keys()].sort().join(',');
  const darkNames = [...colours(blocks.darkExplicit).keys()].sort().join(',');
  check('light and dark define the same set of colour tokens', lightNames === darkNames, lightNames === darkNames ? `-> ${colourTokens.length} tokens` : `-> light ${lightNames} | dark ${darkNames}`);
}

const presetBlocks = {};
for (const preset of PRESETS.filter((name) => name !== 'titanium')) {
  const light = find(`:root[data-accent='${preset}']`, null);
  const darkSystem = find(`:root:not([data-theme='light'])[data-accent='${preset}']`, DARK_MEDIA);
  const darkExplicit = find(`:root[data-theme='dark'][data-accent='${preset}']`, null);
  check(`preset ${preset}: light, system-dark and explicit-dark blocks exist`, light !== undefined && darkSystem !== undefined && darkExplicit !== undefined);
  sameTokens(`preset ${preset}: the two dark blocks declare identical colours`, darkSystem, darkExplicit);
  for (const [label, rule] of [['light', light], ['dark', darkExplicit]]) {
    const names = [...colours(rule).keys()].sort().join(',');
    check(`preset ${preset} (${label}) overrides exactly the accent rungs`, names === [...PRESET_TOKENS].sort().join(','), `-> ${names}`);
  }
  presetBlocks[preset] = { light, dark: darkExplicit };
}

// ── 5. the contrast matrix ───────────────────────────────────────────────────
console.log('\n[contrast]');

/** The tokens in effect for a theme and preset. */
function resolve(theme, preset) {
  const base = colours(theme === 'light' ? blocks.root : blocks.darkExplicit);
  if (preset !== 'titanium') {
    for (const [name, value] of colours(presetBlocks[preset]?.[theme])) base.set(name, value);
  }
  return base;
}

const TEXT_PAIRS = [
  ['--fg', '--bg'],
  ['--fg', '--surface'],
  ['--muted', '--bg'],
  ['--muted', '--surface'],
  ['--accent', '--bg'],
  ['--accent', '--surface'],
  ['--ok', '--bg'],
  ['--ok', '--surface'],
  ['--warning', '--bg'],
  ['--warning', '--surface'],
  ['--danger', '--bg'],
  ['--danger', '--surface'],
  ['--on-accent', '--accent'],
  ['--on-ok', '--ok'],
  ['--on-warning', '--warning'],
  ['--accent', '--accent-subtle'],
  ['--ok', '--ok-subtle'],
  ['--warning', '--warning-subtle'],
  ['--danger', '--danger-subtle'],
];
/** A progress fill against its track (`--bg`), and the same fills inside a card. */
const GRAPHIC_PAIRS = [
  ['--accent', '--bg'],
  ['--warning', '--bg'],
  ['--danger', '--bg'],
  ['--accent', '--surface'],
];

let worstText = { ratio: Infinity };
for (const theme of THEMES) {
  for (const preset of PRESETS) {
    const tokens = resolve(theme, preset);
    const failing = [];
    let worst = { ratio: Infinity };
    const rate = (pairs, floor) => {
      for (const [fore, back] of pairs) {
        const f = tokens.get(fore);
        const b = tokens.get(back);
        if (f === undefined || b === undefined) {
          failing.push(`${fore} on ${back}: token missing`);
          continue;
        }
        const ratio = contrast(f, b);
        if (ratio < worst.ratio) worst = { ratio, fore, back, f, b };
        if (ratio < floor) failing.push(`${fore} (${f}) on ${back} (${b}) = ${round2(ratio)}:1 < ${floor}`);
      }
    };
    rate(TEXT_PAIRS, TEXT_MIN);
    rate(GRAPHIC_PAIRS, GRAPHIC_MIN);
    for (const problem of failing) console.log(`      ${problem}`);
    check(
      `${theme}/${preset}: text ≥ ${TEXT_MIN}:1 and fills ≥ ${GRAPHIC_MIN}:1`,
      failing.length === 0,
      `worst ${worst.fore} on ${worst.back} ${round2(worst.ratio)}:1`,
    );
    if (worst.ratio < worstText.ratio) worstText = { ...worst, theme, preset };
  }
}
note(`worst pair overall: ${worstText.theme}/${worstText.preset} ${worstText.fore} on ${worstText.back} ${round2(worstText.ratio)}:1`);
for (const theme of THEMES) {
  const tokens = resolve(theme, 'titanium');
  const border = round2(contrast(tokens.get('--border'), tokens.get('--surface')));
  note(`${theme}: --border on --surface ${border}:1 (decorative outline; a 3:1 control boundary is not claimed)`);
}

// ── 6. the category palette ──────────────────────────────────────────────────
console.log('\n[category palette]');
const sharedSource = stripComments(readFileSync(sharedPalettePath, 'utf8'));
const sharedHex = [...sharedSource.matchAll(/slot\(\s*(\d+)\s*,\s*'[^']*'\s*,\s*'(#[0-9a-f]{6})'\s*\)/g)].map((m) => [Number(m[1]), m[2]]);
check(`the shared palette lists ${CATEGORY_SLOTS} slots`, sharedHex.length === CATEGORY_SLOTS && sharedHex.every(([slot], index) => slot === index + 1), `-> ${sharedHex.length}`);

for (const theme of THEMES) {
  const tokens = resolve(theme, 'titanium');
  const palette = [];
  for (let slot = 1; slot <= CATEGORY_SLOTS; slot += 1) palette.push(tokens.get(`--cat-${slot}`));
  check(`${theme}: --cat-1..${CATEGORY_SLOTS} are all defined`, palette.every((value) => value !== undefined));
  if (!palette.every((value) => value !== undefined)) continue;

  if (theme === 'light') {
    const mismatched = sharedHex.filter(([slot, hex]) => palette[slot - 1].toLowerCase() !== hex.toLowerCase());
    for (const [slot, hex] of mismatched) console.log(`      slot ${slot}: shared ${hex} vs --cat-${slot} ${palette[slot - 1]}`);
    check('light: the stylesheet and the shared list agree slot by slot', mismatched.length === 0, `${mismatched.length} difference(s)`);
  }

  const [lo, hi] = BAND[theme];
  const offBand = palette.map((hex, i) => [i + 1, hex, round2(oklch(hex).L)]).filter(([, , L]) => L < lo || L > hi);
  for (const [slot, hex, L] of offBand) console.log(`      --cat-${slot} ${hex} L ${L} outside ${lo}–${hi}`);
  check(`${theme}: every slot inside the lightness band ${lo}–${hi}`, offBand.length === 0, `${offBand.length} suspect(s)`);

  const grey = palette.map((hex, i) => [i + 1, hex, round2(oklch(hex).C)]).filter(([, , C]) => C < CHROMA_FLOOR);
  for (const [slot, hex, C] of grey) console.log(`      --cat-${slot} ${hex} chroma ${C} reads as grey`);
  check(`${theme}: every slot above the chroma floor ${CHROMA_FLOOR}`, grey.length === 0, `${grey.length} suspect(s)`);

  const pairs = palette.slice(1).map((_, i) => [i, i + 1]);
  let cvdWorst = null;
  for (const kind of ['protan', 'deutan']) {
    for (const [i, j] of pairs) {
      const d = deltaE(palette[i], palette[j], kind);
      if (cvdWorst === null || d < cvdWorst.d) cvdWorst = { d, kind, i, j };
    }
  }
  const cvdLabel = `worst --cat-${cvdWorst.i + 1}↔--cat-${cvdWorst.j + 1} ΔE ${round2(cvdWorst.d)} (${cvdWorst.kind})`;
  check(`${theme}: adjacent slots stay apart under red–green deficiency (ΔE ≥ ${CVD_FLOOR})`, cvdWorst.d >= CVD_FLOOR, cvdLabel);
  if (cvdWorst.d < CVD_TARGET && cvdWorst.d >= CVD_FLOOR) {
    note(`${theme}: ${cvdLabel} is in the ${CVD_FLOOR}–${CVD_TARGET} band; legal because the donut labels every slice and gaps them`);
  }

  let normalWorst = null;
  for (const [i, j] of pairs) {
    const d = deltaE(palette[i], palette[j]);
    if (normalWorst === null || d < normalWorst.d) normalWorst = { d, i, j };
  }
  check(`${theme}: adjacent slots stay apart for full-colour vision (ΔE ≥ ${NORMAL_FLOOR})`, normalWorst.d >= NORMAL_FLOOR, `worst --cat-${normalWorst.i + 1}↔--cat-${normalWorst.j + 1} ΔE ${round2(normalWorst.d)}`);

  const surface = tokens.get('--surface');
  const faint = palette.map((hex, i) => [i + 1, hex, round2(contrast(hex, surface))]).filter(([, , ratio]) => ratio < GRAPHIC_MIN);
  for (const [slot, hex, ratio] of faint) console.log(`      --cat-${slot} ${hex} on ${surface} = ${ratio}:1`);
  check(`${theme}: every slot ≥ ${GRAPHIC_MIN}:1 against --surface`, faint.length === 0, `${faint.length} suspect(s)`);

  // The six seeded expense slots share one donut, ordered by amount rather than by slot, so
  // any two of them can touch. Reported rather than gated: six colours cannot all clear the
  // adjacent floors pairwise, and the legend plus the slice gap are what carry the
  // remainder. The number is printed so a palette change that makes it worse is visible.
  const six = palette.slice(0, 6);
  let sixWorst = null;
  for (let i = 0; i < six.length; i += 1) {
    for (let j = i + 1; j < six.length; j += 1) {
      for (const kind of ['protan', 'deutan', undefined]) {
        const d = deltaE(six[i], six[j], kind);
        if (sixWorst === null || d < sixWorst.d) sixWorst = { d, i, j, kind: kind ?? 'normal' };
      }
    }
  }
  note(`${theme}: seeded expense slots 1–6, worst of all pairs --cat-${sixWorst.i + 1}↔--cat-${sixWorst.j + 1} ΔE ${round2(sixWorst.d)} (${sixWorst.kind})`);
}

// ── 7. everything outside the stylesheet that restates a colour or a key ──────
console.log('\n[shell]');
const light = resolve('light', 'titanium');
const dark = resolve('dark', 'titanium');

const viteConfig = readFileSync(join(webDir, 'vite.config.ts'), 'utf8');
const manifestBg = /background_color:\s*'(#[0-9a-f]{6})'/i.exec(viteConfig)?.[1];
const manifestTheme = /theme_color:\s*'(#[0-9a-f]{6})'/i.exec(viteConfig)?.[1];
check('manifest background_color is the light --bg', manifestBg === light.get('--bg'), `-> ${manifestBg} vs ${light.get('--bg')}`);
check('manifest theme_color is the light --surface', manifestTheme === light.get('--surface'), `-> ${manifestTheme} vs ${light.get('--surface')}`);

const html = readFileSync(join(webDir, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const metas = [...html.matchAll(/<meta\s+name="theme-color"\s+content="(#[0-9a-f]{6})"\s+media="\(prefers-color-scheme:\s*(light|dark)\)"/gi)].map((m) => [m[2].toLowerCase(), m[1]]);
const metaFor = (theme) => metas.find(([name]) => name === theme)?.[1];
check('index.html theme-color (light) is the light --surface', metaFor('light') === light.get('--surface'), `-> ${metaFor('light')}`);
check('index.html theme-color (dark) is the dark --surface', metaFor('dark') === dark.get('--surface'), `-> ${metaFor('dark')}`);

const icons = readFileSync(join(here, 'generate-icons.mjs'), 'utf8');
const iconAccent = /ACCENT\s*=\s*\{\s*r:\s*0x([0-9a-f]{2}),\s*g:\s*0x([0-9a-f]{2}),\s*b:\s*0x([0-9a-f]{2})/i.exec(icons);
const iconHex = iconAccent === null ? undefined : `#${iconAccent[1]}${iconAccent[2]}${iconAccent[3]}`.toLowerCase();
check('the icon accent is the light --accent of the default preset', iconHex === light.get('--accent'), `-> ${iconHex} vs ${light.get('--accent')}`);

const themeInit = readFileSync(join(webDir, 'theme-init.js'), 'utf8');
const useTheme = readFileSync(join(srcDir, 'composables', 'useTheme.ts'), 'utf8');
for (const key of ['THEME_KEY', 'ACCENT_KEY']) {
  const inInit = new RegExp(`${key}\\s*=\\s*'([^']+)'`).exec(themeInit)?.[1];
  const inComposable = new RegExp(`${key}\\s*=\\s*'([^']+)'`).exec(useTheme)?.[1];
  check(`${key} is the same in theme-init.js and useTheme.ts`, inInit !== undefined && inInit === inComposable, `-> ${inInit} vs ${inComposable}`);
}
const initPresets = [...themeInit.matchAll(/accent === '([a-z]+)'/g)].map((m) => m[1]).sort().join(',');
const cssPresets = PRESETS.filter((name) => name !== 'titanium').sort().join(',');
check('theme-init.js accepts exactly the presets the stylesheet defines', initPresets === cssPresets, `-> ${initPresets} vs ${cssPresets}`);
const typePresets = /type AccentPreset\s*=\s*([^;]+);/.exec(useTheme)?.[1]?.match(/'([a-z]+)'/g)?.map((v) => v.replace(/'/g, '')).sort().join(',');
check('useTheme.ts types exactly the presets the stylesheet defines', typePresets === [...PRESETS].sort().join(','), `-> ${typePresets}`);

// ── report ───────────────────────────────────────────────────────────────────
console.log('\n[manual, reported for the browser pass]');
note(`${colourTokens.length} colour token(s): ${colourTokens.join(', ')}`);
note('rendered colours, the presets and the budget tones are measured by scripts/render-color.mjs');

console.log(`\n${failures === 0 ? 'ALL COLOUR STATIC CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
if (failures > 0) process.exitCode = 1;
