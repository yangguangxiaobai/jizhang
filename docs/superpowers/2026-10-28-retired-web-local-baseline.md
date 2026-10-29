# Retired Web test-fixture local baseline

Historical recovery record captured from the pre-deletion workspace inspection on 2026-10-28. These two test-only files are not an active Web client or toolchain. `fixtures.mjs` had uncommitted changes and `reference-host.mjs` was untracked; neither could be recovered completely from the old Git commit. The text below preserves their inspected content, not executable files or evidence of a running service.

## `packages/web/e2e/fixtures.mjs`

```javascript
/** Every test owns its HTTP listener and a new temporary ledger. Never use .env/data/. */
import { test as base, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../../server/dist/app.js';
import { loadConfig } from '../../server/dist/config.js';
import { closeDatabase, initializeDatabase, openDatabase } from '../../server/dist/db/index.js';
import { AuthService } from '../../server/dist/services/auth-service.js';
import { startWebReference } from './reference-host.mjs';

export const test = base.extend({
  ledger: async ({ browserName }, use) => {
    const tempRoot = realpathSync(tmpdir());
    const dataDir = mkdtempSync(join(tempRoot, `jizhang-iphone-${browserName}-`));
    const username = 'iphone-test';
    const password = randomBytes(18).toString('hex');
    let cutoutFetch = async () =>
      new Response(JSON.stringify({ error: { code: 'CUTOUT_UNAVAILABLE', message: 'No test worker configured.' } }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    const fetchImpl = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      return url.hostname === 'jizhang-cutout' ? cutoutFetch(input, init) : fetch(input, init);
    };
    const config = loadConfig({
      NODE_ENV: 'test', LOG_LEVEL: 'silent', JIZHANG_USERNAME: username,
      JIZHANG_PASSWORD_HASH: 'unused-existing-test-user', DATA_DIR: dataDir,
      JIZHANG_AI_ENCRYPTION_KEY: 'ab'.repeat(32),
      JIZHANG_ITEM_CUTOUT_SERVICE_URL: 'http://jizhang-cutout:8090',
    });
    let db;
    let app;
    let port = 0;
    let reference;
    let referencePort = 0;
    const start = async () => {
      app = buildApp({ config, db, secureCookies: false, fetchImpl });
      await app.listen({ host: '127.0.0.1', port });
      const address = app.server.address();
      if (address === null || typeof address === 'string') throw new Error('No isolated test port');
      port = address.port;
      reference = await startWebReference({
        distDir: resolve(dirname(fileURLToPath(import.meta.url)), '../dist'),
        apiOrigin: `http://127.0.0.1:${port}`, port: referencePort,
      });
      referencePort = reference.port;
    };
    const stop = async () => {
      if (reference !== undefined) { await reference.close(); reference = undefined; }
      if (app !== undefined) { await app.close(); app = undefined; }
    };
    let refusal;
    try {
      db = openDatabase(config);
      initializeDatabase(db, dataDir);
      await new AuthService(db, { sessionTtlDays: config.sessionTtlDays }).setPassword(username, password);
      await start();
      await use({
        username, password, origin: reference.origin, stop, start,
        setCutoutFetch: (handler) => { cutoutFetch = handler; },
        restart: async () => { await stop(); closeDatabase(db); db = openDatabase(config); await start(); },
      });
    } finally {
      await stop();
      if (db !== undefined) closeDatabase(db);
      // A computed recursive-delete target must be verified, including symlink resolution.
      const target = realpathSync(dataDir);
      if (dirname(target) !== tempRoot || !basename(target).startsWith('jizhang-iphone-')) {
        // Recorded rather than thrown: a throw from `finally` would replace the test's own
        // failure with this one, hiding the bug that actually broke the run. Reported below,
        // where it can only surface if the body itself completed.
        refusal = `Refusing to remove an unexpected test directory: ${target}`;
      } else {
        rmSync(target, { recursive: true, force: true });
      }
    }
    if (refusal !== undefined) throw new Error(refusal);
  },
  baseURL: async ({ ledger }, use) => use(ledger.origin),
  browserErrors: [async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await use(errors);
    expect(errors, 'No uncaught browser errors').toEqual([]);
  }, { auto: true }],
});
export { expect };
```

## `packages/web/e2e/reference-host.mjs`

```javascript
/** Temporary test-only Web host. Never imported by the API or Docker entry point. */
import { preview } from 'vite';

export async function startWebReference({ distDir, apiOrigin, port = 0 }) {
  const server = await preview({
    configFile: false,
    root: distDir,
    logLevel: 'silent',
    build: { outDir: distDir },
    preview: {
      host: '127.0.0.1', port, strictPort: true,
      proxy: { '^/api(?:/|$)': { target: apiOrigin } },
    },
  });
  const address = server.httpServer.address();
  if (address === null || typeof address === 'string') {
    await server.close();
    throw new Error('No isolated Web reference port');
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    port: address.port,
    close: () => server.close(),
  };
}
```
