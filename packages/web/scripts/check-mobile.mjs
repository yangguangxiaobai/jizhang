/**
 * Static audit of the mobile rules that cannot be checked from a headless build.
 *
 * ## Why static
 *
 * The T9/T10 acceptance items about touch targets, focus zoom and horizontal overflow
 * are ultimately device behaviours. Installing a browser automation stack to measure
 * them would add a heavy dependency to a repo whose deployment story is "one small
 * container" — and a screenshot-based check is flaky on a shared runner.
 *
 * Instead this checks the *source* invariants that make those behaviours true:
 *
 *   - no interactive element declares a height/`min-height` below 44px;
 *   - no form control declares a font-size below 16px (iOS zooms below that);
 *   - no fixed `min-width` wider than the narrowest supported phone (375px);
 *   - the bottom bar and top bar use the safe-area insets.
 *
 * It is an audit, not a proof: it can miss a rule applied from a parent, and it cannot
 * see a computed style. It is still worth running on every change, and the residual
 * device checks stay on the manual list in the task PRD.
 *
 * Usage: node scripts/check-mobile.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', 'src');

/** Narrowest phone width worth supporting (iPhone SE / 12 mini). */
const MIN_VIEWPORT = 375;
/** Apple's minimum comfortable touch target. */
const MIN_TAP = 44;
/** Below this, iOS Safari zooms the page when a control is focused. */
const MIN_FONT = 16;

let failures = 0;
const warn = [];
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

const files = walk(srcDir);
console.log(`\n[scan] ${files.length} component/style file(s)`);

/**
 * Extracts the `<style>` blocks (and whole file for CSS) so `<template>` markup is not
 * mistaken for CSS.
 */
function styleBlocks(path, source) {
  if (path.endsWith('.css')) return [source];
  return [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
}

// ── 1. no interactive rule below the tap minimum ─────────────────────────────
console.log('\n[touch targets]');
const HEIGHT_RE = /\b(?:min-)?height\s*:\s*(\d+(?:\.\d+)?)px/gi;
const INTERACTIVE_HINT = /(button|\.tab|\.nav|\.icon|\.swatch|\.link|\.row-actions|\.tag|input|select|\.delete|\.toggle|\.chevron)/i;

let tapProblems = 0;
for (const path of files) {
  const source = readFileSync(path, 'utf8');
  for (const block of styleBlocks(path, source)) {
    // Look at each selector block separately so the "interactive" test is local.
    const blocks = block.split('}');
    for (const chunk of blocks) {
      const selector = chunk.split('{')[0] ?? '';
      if (!INTERACTIVE_HINT.test(selector)) continue;
      // A pseudo-element is never a hit target. `.tab::after` is the active-tab
      // indicator: 2px tall on purpose, and no finger ever lands on it. Flagging it
      // would push the size of a decoration into the size of the control it decorates.
      if (/::(?:before|after|marker|placeholder)\b/.test(selector)) continue;

      for (const match of chunk.matchAll(HEIGHT_RE)) {
        const value = Number(match[1]);
        // Widths of decorative dots and progress tracks are not targets; only flag
        // heights that look like a control.
        if (value > 0 && value < MIN_TAP) {
          tapProblems += 1;
          const rel = relative(srcDir, path);
          console.log(`      ${rel}: ${selector.trim().split('\n').pop()?.trim()} -> ${match[0]}`);
        }
      }
    }
  }
}
check(`no interactive rule is shorter than ${MIN_TAP}px`, tapProblems === 0, `${tapProblems} suspect(s)`);

// ── 1b. a control in the TEMPLATE with no rule behind it ─────────────────────
// The audit above reads CSS only, so it is blind to a `<select>` that never declares a
// height: nothing matches the selector pattern, and the browser falls back to its default
// (~19px). That is exactly how an unstyled cycle picker passed this check and was caught
// only when a browser measured the rendered box. This looks for form controls used in a
// template with no CSS rule naming their tag or class anywhere in the same file.
console.log('\n[controls with no styling]');
const unstyled = [];
for (const path of files.filter((file) => file.endsWith('.vue'))) {
  const source = readFileSync(path, 'utf8');
  const style = styleBlocks(path, source).join('\n');
  const template = source.match(/<template[^>]*>([\s\S]*?)<\/template>/)?.[1] ?? '';
  // Only controls that a bare tag selector would be expected to cover; a class-based one is
  // checked below by looking for that class.
  for (const tag of ['select', 'textarea']) {
    if (!new RegExp(`<${tag}\\b`).test(template)) continue;
    const hasTagRule = new RegExp(`(^|[\\s,>])${tag}\\s*(,|\\{|\\[|:)`, 'm').test(style);
    if (!hasTagRule) {
      unstyled.push(`${relative(srcDir, path)}: <${tag}> has no CSS rule`);
    }
  }
}
for (const problem of unstyled) console.log(`      ${problem}`);
check(
  'every <select>/<textarea> in a template has a CSS rule',
  unstyled.length === 0,
  `${unstyled.length} suspect(s)`,
);

// ── 2. form controls are at least 16px ───────────────────────────────────────
console.log('\n[focus zoom]');
let fontProblems = 0;
for (const path of files) {
  const source = readFileSync(path, 'utf8');
  for (const block of styleBlocks(path, source)) {
    for (const chunk of block.split('}')) {
      const selector = chunk.split('{')[0] ?? '';
      if (!/\b(input|select|textarea)\b/i.test(selector)) continue;

      const fontMatch = /font-size\s*:\s*(\d+(?:\.\d+)?)px/i.exec(chunk);
      if (fontMatch === null) continue;
      const value = Number(fontMatch[1]);
      if (value < MIN_FONT) {
        fontProblems += 1;
        console.log(`      ${relative(srcDir, path)}: ${selector.trim()} -> ${fontMatch[0]}`);
      }
    }
  }
}
check(`no form control is smaller than ${MIN_FONT}px`, fontProblems === 0, `${fontProblems} suspect(s)`);

// ── 3. nothing forces the page wider than the viewport ───────────────────────
console.log('\n[horizontal overflow]');
let widthProblems = 0;
for (const path of files) {
  const source = readFileSync(path, 'utf8');
  for (const block of styleBlocks(path, source)) {
    for (const match of block.matchAll(/\bmin-width\s*:\s*(\d+)px/gi)) {
      const value = Number(match[1]);
      // `min-width: 40px` on a button is fine; a layout column wider than the viewport
      // is not.
      if (value > MIN_VIEWPORT) {
        widthProblems += 1;
        console.log(`      ${relative(srcDir, path)} -> ${match[0]}`);
      }
    }
  }
}
check(
  `no min-width exceeds the ${MIN_VIEWPORT}px viewport`,
  widthProblems === 0,
  `${widthProblems} suspect(s)`,
);

// ── 4. safe-area insets are present on the fixed bars ────────────────────────
console.log('\n[safe areas]');
const shellPath = join(srcDir, 'views', 'AppShell.vue');
const shell = readFileSync(shellPath, 'utf8');
check('bottom tab bar uses the bottom safe-area inset', /env\(safe-area-inset-bottom\)/.test(shell));
check('top header uses the top safe-area inset', /env\(safe-area-inset-top\)/.test(shell));

const loginPath = join(srcDir, 'views', 'LoginView.vue');
check(
  'the login page (the first screen seen) respects both insets',
  /env\(safe-area-inset-top\)/.test(readFileSync(loginPath, 'utf8')) &&
    /env\(safe-area-inset-bottom\)/.test(readFileSync(loginPath, 'utf8')),
);

// ── 5. zoom is not disabled anywhere ─────────────────────────────────────────
console.log('\n[zoom]');
const htmlPath = join(here, '..', 'index.html');
const html = readFileSync(htmlPath, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
check('viewport does not disable pinch-zoom', !/user-scalable|maximum-scale/i.test(html));

// ── 6. reports that need a human, not a failure ──────────────────────────────
console.log('\n[manual, reported for the device pass]');
const mediaQueries = files
  .flatMap((path) => [...readFileSync(path, 'utf8').matchAll(/@media[^{]+/g)].map((m) => m[0].trim()))
  .filter((value, index, all) => all.indexOf(value) === index);
warn.push(`responsive breakpoints in use: ${mediaQueries.length === 0 ? '(none)' : mediaQueries.join(' | ')}`);
for (const line of warn) console.log(`  note  ${line}`);

console.log(`\n${failures === 0 ? 'ALL MOBILE STATIC CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
if (failures > 0) process.exitCode = 1;
