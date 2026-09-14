// End-to-end PWA delivery checks against the running container (T9).
//
// Why these and not Lighthouse: the failure modes that matter here are "the server
// does not serve the manifest / the service worker / the 180px icon", which are
// exact HTTP facts. Rendering and install-prompt behaviour need a real iOS device,
// which is listed as manual verification in the T9 PRD.
//
// Usage: docker compose cp packages/server/scripts/. jizhang:/app/packages/server/scripts/
//        docker compose exec -T -w /app/packages/server/scripts jizhang node e2e-pwa.mjs

import { makeChecker, resetToKnownState } from './lib/e2e-reset.mjs';

const ORIGIN = 'http://127.0.0.1:8081';

const { check, finish } = makeChecker();

// Also asserts the app still boots with the PWA wiring in place.
const { authHeaders: auth } = await resetToKnownState();

/** Fetches a path and reports status, content type and length. */
async function probe(path) {
  const response = await fetch(`${ORIGIN}${path}`, { redirect: 'manual' });
  const body = await response.arrayBuffer();
  return {
    status: response.status,
    type: response.headers.get('content-type') ?? '',
    length: body.byteLength,
    text: () => new TextDecoder().decode(body),
  };
}

// ── manifest ─────────────────────────────────────────────────────────────────
console.log('\n[manifest]');
const manifest = await probe('/manifest.webmanifest');
check('GET /manifest.webmanifest -> 200', manifest.status === 200, `-> ${manifest.status}`);
check(
  'served as JSON',
  manifest.type.includes('json') || manifest.type.includes('manifest'),
  manifest.type,
);

if (manifest.status === 200) {
  const parsed = JSON.parse(manifest.text());
  check('name is the Chinese app name', typeof parsed.name === 'string' && parsed.name.length > 0, parsed.name);
  check('display is standalone', parsed.display === 'standalone');
  check('start_url is /', parsed.start_url === '/');
  // The toolbar takes the colour of the app's own top bar (`--surface`), not the accent —
  // see `packages/web/src/composables/useTheme.ts`. The build audit pins it to the token.
  check('theme_color matches the light surface', parsed.theme_color === '#ffffff', parsed.theme_color);
  check('background_color matches the light page background', parsed.background_color === '#f7f5f0', parsed.background_color);
}

// ── service worker ───────────────────────────────────────────────────────────
console.log('\n[service worker]');
const sw = await probe('/sw.js');
check('GET /sw.js -> 200', sw.status === 200, `-> ${sw.status}`);
check(
  'served as JavaScript',
  sw.type.includes('javascript'),
  sw.type,
);
check(
  'is not cached immutably forever (updates must be able to land)',
  // A year-long immutable cache on sw.js is a classic PWA trap: clients pin to an
  // old worker and never see a release.
  !/immutable/i.test(sw.type),
  sw.type,
);

if (sw.status === 200) {
  const source = sw.text();
  check('contains a precache manifest', /precache/i.test(source));
  check('references the built index.html for navigations', /index\.html/i.test(source));
  check(
    'declares no caching handler for /api/',
    !/api\/[^"']*["'][^}]*?(CacheFirst|StaleWhileRevalidate|NetworkFirst)/i.test(source),
  );
}

// ── icons ────────────────────────────────────────────────────────────────────
console.log('\n[icons over HTTP]');
for (const [path, size] of [
  ['/icons/pwa-192x192.png', 192],
  ['/icons/pwa-512x512.png', 512],
  ['/icons/maskable-512x512.png', 512],
  ['/icons/apple-touch-icon.png', 180],
]) {
  const icon = await probe(path);
  check(
    `GET ${path} -> 200 image/png`,
    icon.status === 200 && icon.type.includes('png'),
    `-> ${icon.status} ${icon.type} ${icon.length}B`,
  );
  void size;
}

// ── index.html wiring as actually served ─────────────────────────────────────
console.log('\n[served index.html]');
const index = await probe('/');
check('GET / -> 200', index.status === 200, `-> ${index.status}`);
if (index.status === 200) {
  const html = index.text().replace(/<!--[\s\S]*?-->/g, '');
  check('links the manifest', html.includes('rel="manifest"'));
  check('links the apple-touch-icon', html.includes('rel="apple-touch-icon"'));
  check('declares apple-mobile-web-app-capable', html.includes('apple-mobile-web-app-capable'));
  check('declares theme-color', html.includes('theme-color'));
  check('registers the service worker', /registerSW|sw\.js/.test(html));
}

// ── SPA fallback with the SW installed ───────────────────────────────────────
console.log('\n[SPA fallback]');
for (const path of ['/stats', '/budget', '/manage', '/transactions/abc/edit']) {
  const page = await probe(path);
  check(`GET ${path} serves the shell`, page.status === 200, `-> ${page.status}`);
}
const unknownApi = await fetch(`${ORIGIN}/api/v1/nope`, { headers: auth });
check('an unknown API route is still JSON, never the shell', unknownApi.status === 404, `-> ${unknownApi.status}`);

// ── every referenced asset is actually reachable ─────────────────────────────
//
// A common way a deployed PWA breaks: the HTML references a hashed asset that the
// reverse proxy does not serve (wrong root, a prefix it strips, a 404 masked by the SPA
// fallback). The page then loads but renders nothing. Checking reachability here is
// cheap and catches it before it reaches a phone.
console.log('\n[referenced assets resolve]');
const indexHtml = (await probe('/')).text();
const referenced = [
  ...indexHtml.matchAll(/(?:src|href)="(\/[^"]+)"/g),
].map((match) => match[1]);
const uniqueRefs = [...new Set(referenced)].filter((path) => !path.startsWith('//'));

check('index.html references at least one hashed asset', uniqueRefs.length >= 2, `${uniqueRefs.length} refs`);

for (const path of uniqueRefs) {
  const asset = await probe(path);
  // The SPA fallback answers 200 with HTML for anything unknown, so a misconfigured
  // asset would look "fine" by status alone. Require a non-HTML content type too.
  const suspiciouslyHtml = asset.type.includes('text/html') && !path.endsWith('.html');
  check(
    `  ${path} resolves to a real asset`,
    asset.status === 200 && asset.length > 0 && !suspiciouslyHtml,
    `-> ${asset.status} ${asset.type} ${asset.length}B`,
  );
}

// ── the app still works with the PWA wiring in place ─────────────────────────
console.log('\n[app still boots]');
const health = await fetch(`${ORIGIN}/api/v1/health`);
check('GET /api/v1/health -> 200', health.status === 200, `-> ${health.status}`);
const overview = await fetch(`${ORIGIN}/api/v1/budget/overview`, { headers: auth });
check('authenticated API call still works', overview.status === 200, `-> ${overview.status}`);

finish('PWA E2E');
