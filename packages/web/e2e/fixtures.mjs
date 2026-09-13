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

export const test = base.extend({
  ledger: async ({ browserName }, use) => {
    const tempRoot = realpathSync(tmpdir());
    const dataDir = mkdtempSync(join(tempRoot, `jizhang-iphone-${browserName}-`));
    const username = 'iphone-test';
    const password = randomBytes(18).toString('hex');
    const config = loadConfig({
      NODE_ENV: 'test', LOG_LEVEL: 'silent', JIZHANG_USERNAME: username,
      JIZHANG_PASSWORD_HASH: 'unused-existing-test-user', DATA_DIR: dataDir,
      WEB_DIST_DIR: resolve(dirname(fileURLToPath(import.meta.url)), '../dist'),
    });
    let db;
    let app;
    let port = 0;
    const start = async () => {
      app = buildApp({ config, db, secureCookies: false });
      await app.listen({ host: '127.0.0.1', port });
      const address = app.server.address();
      if (address === null || typeof address === 'string') throw new Error('No isolated test port');
      port = address.port;
    };
    const stop = async () => { if (app !== undefined) { await app.close(); app = undefined; } };
    let refusal;
    try {
      db = openDatabase(config);
      initializeDatabase(db, dataDir);
      await new AuthService(db, { sessionTtlDays: config.sessionTtlDays }).setPassword(username, password);
      await start();
      await use({
        username, password, origin: `http://127.0.0.1:${port}`, stop, start,
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
