import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { ConfigError, loadConfig, type AppConfig } from '../src/config';

const baseEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  JIZHANG_USERNAME: 'test-user',
  JIZHANG_PASSWORD_HASH: 'test-hash',
  DATA_DIR: './data',
};

const config: AppConfig = loadConfig(baseEnv);

/** Minimal stand-in for `packages/web/dist` so the static/SPA paths are real. */
const webFixtureDir = mkdtempSync(path.join(tmpdir(), 'jizhang-web-'));
writeFileSync(
  path.join(webFixtureDir, 'index.html'),
  '<!doctype html><html><body><div id="app">jizhang-shell</div></body></html>',
);

afterAll(() => {
  rmSync(webFixtureDir, { recursive: true, force: true });
});

async function withApp(
  run: (app: FastifyInstance) => Promise<void>,
  webDistDir: string = config.webDistDir,
): Promise<void> {
  const app = buildApp({ config, webDistDir });
  try {
    await run(app);
  } finally {
    await app.close();
  }
}

describe('GET /api/v1/health', () => {
  it('answers 200 with status, version and uptime', async () => {
    await withApp(async (app) => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

      expect(response.statusCode).toBe(200);
      const body = response.json<{ status: string; version: string; uptime: number }>();
      expect(body.status).toBe('ok');
      expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(typeof body.uptime).toBe('number');
    });
  });
});

describe('unknown /api/** route', () => {
  it('answers a JSON 404 instead of the SPA shell (AC9)', async () => {
    await withApp(
      async (app) => {
        const response = await app.inject({ method: 'GET', url: '/api/v1/nonexistent' });

        expect(response.statusCode).toBe(404);
        expect(response.headers['content-type']).toContain('application/json');
        expect(response.json()).toEqual({
          error: { code: 'NOT_FOUND', message: expect.any(String) as string },
        });
      },
      webFixtureDir,
    );
  });
});

describe('static hosting with SPA fallback', () => {
  it('serves the built index.html for a non-api, unmatched path (R4)', async () => {
    await withApp(async (app) => {
      const response = await app.inject({ method: 'GET', url: '/transactions/42' });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
      expect(response.body).toContain('jizhang-shell');
    }, webFixtureDir);
  });

  it('serves the shell at /', async () => {
    await withApp(async (app) => {
      const response = await app.inject({ method: 'GET', url: '/' });

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('jizhang-shell');
    }, webFixtureDir);
  });
});

// The browser's HTTP cache is the half of the "never cache the API" rule that the
// service worker cannot enforce. Responses here are per-session and carry the ledger;
// an HTTP cache is keyed by URL, so a stored response would outlive a logout.
describe('API cache headers', () => {
  it('marks every API response no-store', async () => {
    await withApp(async (app) => {
      // `/api` itself must count as API — a bare prefix check would let it through.
      for (const url of ['/api', '/api/v1/health', '/api/v1/transactions', '/api/v1/nope']) {
        const response = await app.inject({ method: 'GET', url });
        expect(response.headers['cache-control'], url).toBe('no-store');
      }
    }, webFixtureDir);
  });

  it('marks error responses no-store too, so a failure is not cached either', async () => {
    // This app is built without a database, so the transaction route is unregistered
    // and the request lands on the not-found handler. That is the point: the header
    // must come from the shared hook, not from the success path of each route.
    await withApp(async (app) => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/definitely-missing' });

      expect(response.statusCode).toBe(404);
      expect(response.headers['cache-control']).toBe('no-store');
    }, webFixtureDir);
  });

  it('does not mark the SPA shell no-store', async () => {
    // The shell is the one thing worth caching — an installed app must open offline.
    await withApp(async (app) => {
      const response = await app.inject({ method: 'GET', url: '/' });

      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).not.toBe('no-store');
    }, webFixtureDir);
  });
});

describe('loadConfig', () => {
  it('fails fast and names every missing required variable (AC12)', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);

    try {
      loadConfig({ NODE_ENV: 'production' });
      expect.unreachable('loadConfig should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const message = (error as ConfigError).message;
      expect(message).toContain('JIZHANG_USERNAME');
      expect(message).toContain('JIZHANG_PASSWORD_HASH');
    }
  });

  it('rejects a non-numeric PORT with a readable message', () => {
    expect(() => loadConfig({ ...baseEnv, PORT: 'not-a-port' })).toThrow(/PORT must be an integer/);
  });

  it('applies documented defaults when optional variables are absent', () => {
    const resolved = loadConfig(baseEnv);

    expect(resolved.port).toBe(8081);
    expect(resolved.host).toBe('0.0.0.0');
    expect(resolved.sessionTtlDays).toBe(30);
    expect(resolved.trustProxy).toBe(false);
    expect(resolved.nodeEnv).toBe('test');
    expect(resolved.itemCutoutServiceUrl).toBeUndefined();
  });

  it('accepts only a local HTTP item-cutout service URL', () => {
    expect(
      loadConfig({ ...baseEnv, JIZHANG_ITEM_CUTOUT_SERVICE_URL: 'http://jizhang-cutout:8090' })
        .itemCutoutServiceUrl,
    ).toBe('http://jizhang-cutout:8090');
    expect(
      loadConfig({ ...baseEnv, JIZHANG_ITEM_CUTOUT_SERVICE_URL: 'http://127.0.0.1:8090' })
        .itemCutoutServiceUrl,
    ).toBe('http://127.0.0.1:8090');
    expect(() =>
      loadConfig({ ...baseEnv, JIZHANG_ITEM_CUTOUT_SERVICE_URL: 'https://cutout.example.com' }),
    ).toThrow(/must be a root HTTP URL on the local inference host/);
  });
});
