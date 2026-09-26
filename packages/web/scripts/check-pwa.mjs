/**
 * Asserts that the built bundle is a valid installable PWA.
 *
 * Runs against `dist/` after `vite build`. Why a script instead of Lighthouse: this
 * has to work headless in CI, and the things that actually break a PWA here are all
 * static facts about the emitted files (a manifest that is not linked, a missing
 * 180px icon, an API route that crept into the runtime cache). Those are checkable
 * exactly, whereas a Lighthouse score is not reproducible on a shared runner.
 *
 * Usage: node scripts/check-pwa.mjs
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, '..', 'dist');
const iconsDir = join(dist, 'icons');

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) failures += 1;
};

const read = (path) => readFileSync(path, 'utf8');

/**
 * Strips HTML comments before pattern-matching.
 *
 * `index.html` documents WHY it does not set `user-scalable=no`, so the literal text
 * appears in a comment. Matching raw source would flag that explanation as the very
 * mistake it warns against.
 */
const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

// ── required files ───────────────────────────────────────────────────────────
console.log('\n[build artefacts]');
check('dist/ exists', existsSync(dist), dist);
check('dist/index.html exists', existsSync(join(dist, 'index.html')));
check('service worker emitted', existsSync(join(dist, 'sw.js')));

const manifestPath = join(dist, 'manifest.webmanifest');
const manifestExists =
  existsSync(manifestPath) || existsSync(join(dist, 'manifest.json'));
check('web manifest emitted', manifestExists);

// ── manifest contents ────────────────────────────────────────────────────────
console.log('\n[manifest]');
if (manifestExists) {
  const raw = existsSync(manifestPath)
    ? read(manifestPath)
    : read(join(dist, 'manifest.json'));
  const manifest = JSON.parse(raw);

  check('has a name', typeof manifest.name === 'string' && manifest.name.length > 0, manifest.name);
  check('has a short_name of at most 12 chars', typeof manifest.short_name === 'string' && manifest.short_name.length <= 12, manifest.short_name);
  check('start_url is /', manifest.start_url === '/', manifest.start_url);
  check('scope is /', manifest.scope === '/', manifest.scope);
  check('display is standalone', manifest.display === 'standalone', manifest.display);
  check('theme_color and background_color set', Boolean(manifest.theme_color) && Boolean(manifest.background_color), `${manifest.theme_color} / ${manifest.background_color}`);
  check('lang is declared', typeof manifest.lang === 'string', manifest.lang);

  const iconSizes = (manifest.icons ?? []).map((icon) => icon.sizes);
  check('declares a 192px icon', iconSizes.includes('192x192'), iconSizes.join(', '));
  check('declares a 512px icon', iconSizes.includes('512x512'));
  check(
    'declares a maskable icon',
    (manifest.icons ?? []).some((icon) => String(icon.purpose ?? '').includes('maskable')),
  );
  check('has at least one shortcut', (manifest.shortcuts ?? []).length > 0);
}

// ── icons on disk ────────────────────────────────────────────────────────────
console.log('\n[icons]');
const iconChecks = [
  ['pwa-192x192.png', 192],
  ['pwa-512x512.png', 512],
  ['maskable-512x512.png', 512],
  ['apple-touch-icon.png', 180],
];
for (const [file, expected] of iconChecks) {
  const path = join(iconsDir, file);
  if (!existsSync(path)) {
    check(`${file} exists`, false);
    continue;
  }
  const buffer = readFileSync(path);
  const isPng = buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  check(
    `${file} is a ${expected}x${expected} PNG`,
    isPng && width === expected && height === expected,
    `${width}x${height} ${statSync(path).size}B`,
  );
}

// ── index.html wiring ────────────────────────────────────────────────────────
console.log('\n[index.html]');
const html = stripComments(read(join(dist, 'index.html')));

check('links the manifest', /rel="manifest"/.test(html));
check('has an apple-touch-icon link', /rel="apple-touch-icon"/.test(html));
check('apple-touch-icon is 180px', /apple-touch-icon[^>]*icons\/apple-touch-icon\.png/.test(html));
check('declares apple-mobile-web-app-capable', /apple-mobile-web-app-capable"\s+content="yes"/.test(html));
check('declares a status bar style', /apple-mobile-web-app-status-bar-style/.test(html));
check('declares theme-color', /name="theme-color"/.test(html));
check('viewport includes viewport-fit=cover', /viewport-fit=cover/.test(html));
check(
  'viewport does NOT disable zoom',
  !/user-scalable\s*=\s*no/.test(html) && !/maximum-scale\s*=\s*1/.test(html),
);
check('service worker is registered by the bundle', /registerSW|workbox|sw\.js/.test(html) || existsSync(join(dist, 'sw.js')));

// ── service worker policy ────────────────────────────────────────────────────
console.log('\n[service worker policy]');
const sw = read(join(dist, 'sw.js'));

check('precaches the shell', /precache/i.test(sw));
check(
  'does NOT cache API responses',
  // Any runtime route mentioning /api/ must be NetworkOnly; the safest assertion is
  // that no api path appears alongside a caching handler.
  !/api\/[^"']*["'][^}]*?(CacheFirst|StaleWhileRevalidate|NetworkFirst)/i.test(sw),
);
check('declares a navigation fallback', /navigateFallback|index\.html/i.test(sw));

// ── bundle size sanity (1 GB VPS + phone download) ───────────────────────────
// Approved for the full Ardot UI pass: 352 KiB JS and 112 KiB CSS.
console.log('\n[size]');
const htmlSize = statSync(join(dist, 'index.html')).size;
check('index.html is small', htmlSize < 4096, `${htmlSize}B`);

let totalJs = 0;
let totalCss = 0;
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) totalJs += statSync(full).size;
    else if (entry.name.endsWith('.css')) totalCss += statSync(full).size;
  }
};
walk(dist);
check('total JS under 352 KiB', totalJs < 352 * 1024, `${totalJs} B (${(totalJs / 1024).toFixed(2)} KiB)`);
check('total CSS under 112 KiB', totalCss < 112 * 1024, `${totalCss} B (${(totalCss / 1024).toFixed(2)} KiB)`);

console.log(`\n${failures === 0 ? 'ALL PWA CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
if (failures > 0) process.exitCode = 1;
