/** The public cutout proxy must stay authenticated, typed, bounded, and private. */
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { closeDatabase, initializeDatabase, type Db } from '../src/db/index.js';
import { SESSION_COOKIE } from '../src/plugins/auth.js';
import { AuthService } from '../src/services/auth-service.js';
import { MAX_ITEM_PHOTO_BYTES } from '../src/services/item-service.js';

const USERNAME = 'cutout-test';
const PASSWORD = 'correct horse battery staple';
const CSRF = { 'x-requested-with': 'fetch' } as const;
const SERVICE_URL = 'http://jizhang-cutout:8090';
const JOB_ID = 'a'.repeat(32);
const WEBP_BYTES = Buffer.alloc(30);
WEBP_BYTES.write('RIFF', 0, 'ascii');
WEBP_BYTES.writeUInt32LE(22, 4);
WEBP_BYTES.write('WEBP', 8, 'ascii');
WEBP_BYTES.write('VP8X', 12, 'ascii');
WEBP_BYTES.writeUInt32LE(10, 16);

function streamBytesAbove(limit: number): ReadableStream<Uint8Array> {
  let remaining = limit + 1;
  return new ReadableStream({
    pull(controller) {
      if (remaining === 0) {
        controller.close();
        return;
      }
      const size = Math.min(4 * 1024 * 1024, remaining);
      remaining -= size;
      controller.enqueue(new Uint8Array(size));
    },
  });
}

let db: Db;
let app: FastifyInstance;
let cookie: string;
let fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>;

function headers() {
  return { ...CSRF, Cookie: SESSION_COOKIE + '=' + cookie };
}

async function login(): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: CSRF,
    payload: { username: USERNAME, password: PASSWORD },
  });
  expect(response.statusCode, response.body).toBe(200);
  const session = (response.cookies as { name: string; value: string }[]).find(
    (entry) => entry.name === SESSION_COOKIE,
  );
  if (session === undefined) throw new Error('login did not set the session cookie');
  return session.value;
}

beforeEach(async () => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeDatabase(db, null);
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    JIZHANG_USERNAME: USERNAME,
    JIZHANG_PASSWORD_HASH: 'unused',
    DATA_DIR: './data',
    JIZHANG_ITEM_CUTOUT_SERVICE_URL: SERVICE_URL,
  });
  const authService = new AuthService(db, { sessionTtlDays: config.sessionTtlDays });
  await authService.setPassword(USERNAME, PASSWORD);

  fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === '/jobs' && init?.method === 'POST') {
      return new Response(JSON.stringify({ jobId: JOB_ID }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname === '/jobs/' + JOB_ID && (init?.method ?? 'GET') === 'GET') {
      return new Response(
        JSON.stringify({
          jobId: JOB_ID,
          state: 'ready',
          message: '已生成 1 个透明候选，请选择一张。',
          candidates: [{ id: '0', width: 28, height: 28 }],
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.pathname.endsWith('/preview')) {
      return new Response(Buffer.from('preview'), {
        headers: { 'content-type': 'image/webp' },
      });
    }
    if (url.pathname.endsWith('/image')) {
      return new Response(Buffer.from('png'), { headers: { 'content-type': 'image/png' } });
    }
    if (url.pathname === '/jobs/' + JOB_ID && init?.method === 'DELETE') {
      return new Response(null, { status: 204 });
    }
    return new Response('unmatched mocked route', { status: 500 });
  });

  app = buildApp({
    config,
    db,
    authService,
    secureCookies: false,
    fetchImpl,
  });
  await app.ready();
  cookie = await login();
});

afterEach(async () => {
  await app.close();
  closeDatabase(db);
});

describe('authenticated item cutout proxy', () => {
  it('keeps every operation behind the existing session and CSRF guards', async () => {
    const read = await app.inject({ method: 'GET', url: '/api/v1/items/cutouts/' + JOB_ID });
    expect(read.statusCode).toBe(401);

    const noCsrf = await app.inject({
      method: 'POST',
      url: '/api/v1/items/cutouts',
      payload: WEBP_BYTES,
      headers: { Cookie: SESSION_COOKIE + '=' + cookie, 'content-type': 'image/webp' },
    });
    expect(noCsrf.statusCode).toBe(403);
  });

  it('proxies bounded WebP jobs and returns no-store, correctly-typed candidates', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/items/cutouts',
      headers: { ...headers(), 'content-type': 'image/webp' },
      payload: WEBP_BYTES,
    });
    expect(created.statusCode, created.body).toBe(202);
    expect(created.json()).toEqual({ jobId: JOB_ID });
    expect(created.headers['cache-control']).toBe('no-store');
    const createCall = fetchImpl.mock.calls.find(([input, init]) => {
      return new URL(input instanceof Request ? input.url : String(input)).pathname === '/jobs' &&
        init?.method === 'POST';
    });
    expect(createCall).toBeDefined();
    expect(Buffer.from(createCall?.[1]?.body as Uint8Array)).toEqual(WEBP_BYTES);

    const status = await app.inject({
      method: 'GET',
      url: '/api/v1/items/cutouts/' + JOB_ID,
      headers: headers(),
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ state: 'ready', candidates: [{ id: '0' }] });
    expect(status.headers['cache-control']).toBe('no-store');

    const preview = await app.inject({
      method: 'GET',
      url: `/api/v1/items/cutouts/${JOB_ID}/candidates/0/preview`,
      headers: headers(),
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers['content-type']).toBe('image/webp');
    expect(preview.headers['cache-control']).toBe('no-store');
    expect(preview.headers['x-content-type-options']).toBe('nosniff');
    expect(preview.rawPayload).toEqual(Buffer.from('preview'));

    const image = await app.inject({
      method: 'GET',
      url: `/api/v1/items/cutouts/${JOB_ID}/candidates/0/image`,
      headers: headers(),
    });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/png');
    expect(image.rawPayload).toEqual(Buffer.from('png'));

    const cancelled = await app.inject({
      method: 'DELETE',
      url: '/api/v1/items/cutouts/' + JOB_ID,
      headers: headers(),
    });
    expect(cancelled.statusCode).toBe(204);
    expect(cancelled.headers['cache-control']).toBe('no-store');
  });

  it('rejects malformed, oversized, and non-WebP inputs before contacting inference', async () => {
    const badType = await app.inject({
      method: 'POST',
      url: '/api/v1/items/cutouts',
      headers: { ...headers(), 'content-type': 'image/png' },
      payload: WEBP_BYTES,
    });
    expect(badType.statusCode).toBe(400);

    const badSignature = await app.inject({
      method: 'POST',
      url: '/api/v1/items/cutouts',
      headers: { ...headers(), 'content-type': 'image/webp' },
      payload: Buffer.from('not a WebP image'),
    });
    expect(badSignature.statusCode).toBe(400);

    const oversized = await app.inject({
      method: 'POST',
      url: '/api/v1/items/cutouts',
      headers: { ...headers(), 'content-type': 'image/webp' },
      payload: Buffer.concat([WEBP_BYTES, Buffer.alloc(MAX_ITEM_PHOTO_BYTES)]),
    });
    expect(oversized.statusCode).toBe(413);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('streams worker JSON and image responses through strict byte caps', async () => {
    fetchImpl.mockResolvedValueOnce(
      new Response(streamBytesAbove(64 * 1024), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    const oversizedStatus = await app.inject({
      method: 'GET',
      url: '/api/v1/items/cutouts/' + JOB_ID,
      headers: headers(),
    });
    expect(oversizedStatus.statusCode).toBe(502);
    expect(oversizedStatus.json().error.code).toBe('CUTOUT_UPSTREAM_INVALID');

    fetchImpl.mockResolvedValueOnce(
      new Response(streamBytesAbove(16 * 1024 * 1024), {
        headers: { 'content-type': 'image/png' },
      }),
    );
    const oversizedImage = await app.inject({
      method: 'GET',
      url: `/api/v1/items/cutouts/${JOB_ID}/candidates/0/image`,
      headers: headers(),
    });
    expect(oversizedImage.statusCode).toBe(502);
    expect(oversizedImage.json().error.code).toBe('CUTOUT_UPSTREAM_INVALID');
  });

  it('maps a disabled service to a stable code without leaking the internal URL', async () => {
    // Rebuild with cutout disabled; ordinary item routes remain available.
    const config = loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      JIZHANG_USERNAME: USERNAME,
      JIZHANG_PASSWORD_HASH: 'unused',
      DATA_DIR: './data',
    });
    const disabledApp = buildApp({
      config,
      db,
      authService: new AuthService(db, { sessionTtlDays: config.sessionTtlDays }),
      secureCookies: false,
    });
    await disabledApp.ready();
    try {
      const response = await disabledApp.inject({
        method: 'POST',
        url: '/api/v1/items/cutouts',
        headers: { ...headers(), 'content-type': 'image/webp' },
        payload: WEBP_BYTES,
      });
      expect(response.statusCode).toBe(503);
      expect(response.json().error.code).toBe('CUTOUT_UNAVAILABLE');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).not.toContain(SERVICE_URL);
    } finally {
      await disabledApp.close();
    }
  });
});
