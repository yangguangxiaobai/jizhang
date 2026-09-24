/**
 * Fastify instance assembly (task PRD R2/R4, T3 R5/R6).
 *
 * `buildApp` only *builds* the instance — it never calls `listen`. That split
 * lets tests drive the app through `app.inject()` (no real port) and lets
 * index.ts own the process lifecycle (port binding, signals, shutdown).
 */
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyRequest } from 'fastify';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { AppConfig } from './config.js';
import { authModule } from './plugins/auth.js';
import { registerBudgetRoutes } from './routes/budget.js';
import { registerMasterDataRoutes } from './routes/master-data.js';
import { registerStatsRoutes } from './routes/stats.js';
import { registerTrashRoutes } from './routes/trash.js';
import { registerRecurringRoutes } from './routes/recurring.js';
import { registerPortabilityRoutes } from './routes/portability.js';
import { registerTransactionRoutes } from './routes/transactions.js';
import { registerTransferRoutes } from './routes/transfers.js';
import { registerAiRoutes } from './routes/ai.js';
import { registerAssistantRoutes } from './routes/assistant.js';
import { AuthService } from './services/auth-service.js';
import type { Db } from './db/index.js';

export interface BuildAppOptions {
  readonly config: AppConfig;
  /** Override the static-assets directory (tests point it at a fixture dir). */
  readonly webDistDir?: string;
  /**
   * Database handle. Required to enable authentication; when omitted the app runs
   * without routes that need storage (used by the static/health tests).
   */
  readonly db?: Db;
  /** Override the session-clock/argon2 wrapper (tests inject a fixed clock). */
  readonly authService?: AuthService;
  /**
   * Whether to mark the session cookie `Secure`. Defaults to on in production,
   * off otherwise so a plain-http local run can still sign in.
   */
  readonly secureCookies?: boolean;
  /**
   * Injectable clock for route-level validation (date sanity checks). Defaults to
   * the real clock; tests pin it so "in the future" assertions are deterministic.
   */
  readonly now?: (() => number) | undefined;
  /** Injectable provider transport for AI route tests. */
  readonly fetchImpl?: typeof fetch;
}

/** Everything below this prefix is API and must never answer with index.html. */
const API_PREFIX = '/api';

const SPA_METHODS = new Set(['GET', 'HEAD']);

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const { config } = options;
  const webDistDir = options.webDistDir ?? config.webDistDir;
  const hasWebBuild = existsSync(path.join(webDistDir, 'index.html'));

  const app = Fastify({
    logger: { level: config.logLevel },
    trustProxy: config.trustProxy,
    // A CSV import posts the file as raw text. Without this parser Fastify has no handler
    // for `text/csv` and answers 415 before the route runs.
    bodyLimit: 8 * 1024 * 1024,
  });

  app.addContentTypeParser(
    'text/csv',
    { parseAs: 'string' },
    (_request, body, done) => {
      done(null, body);
    },
  );

  // Platform bill import: Alipay GBK CSV and WeChat xlsx must arrive as raw bytes.
  // A browser File.text() would corrupt GBK; the server decodes after the body lands.
  const bufferParser = (
    _request: FastifyRequest,
    body: Buffer,
    done: (err: Error | null, body?: unknown) => void,
  ): void => {
    done(null, body);
  };
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, bufferParser);
  app.addContentTypeParser(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    { parseAs: 'buffer' },
    bufferParser,
  );

  // ── Unified error contract: { error: { code, message } } (design.md §5) ──────
  // Fastify 5 types the handler's error as `unknown` by default, so the
  // FastifyError generic is supplied explicitly.
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    const statusCode =
      typeof error.statusCode === 'number' && error.statusCode >= 400 ? error.statusCode : 500;
    const code =
      typeof error.code === 'string' && error.code !== ''
        ? error.code
        : statusCode >= 500
          ? 'INTERNAL_ERROR'
          : 'REQUEST_ERROR';

    if (statusCode >= 500) {
      // Log the real thing, never hand it to the client.
      request.log.error({ err: error }, 'request failed');
      return reply.status(statusCode).send({ error: { code, message: 'Internal Server Error' } });
    }

    request.log.warn({ err: error }, 'request rejected');
    return reply.status(statusCode).send({ error: { code, message: error.message } });
  });

  // ── API responses must never be stored by the browser ───────────────────────
  // The service worker already refuses to cache `/api/**` (`vite.config.ts` registers
  // an explicit `NetworkOnly` route). This is the other half of that rule, applied to
  // the browser's own HTTP cache:
  //
  //   * Privacy — API responses are per-session and carry the ledger, and an HTTP cache
  //     is keyed by URL, so a stored response outlives a logout on a shared device. That
  //     is the same reasoning `spec/frontend/quality-guidelines.md` gives for the service
  //     worker; it applies to the HTTP cache identically.
  //   * Consistent staleness — the app is online-first (parent task D4), so there is no
  //     version of "serve this from cache" that is correct. A cacheable 200 can also
  //     satisfy a request while the server is unreachable, which turns a failure the UI
  //     would have reported into a silent success.
  //
  // `no-store` rather than a validator: there is nothing here worth reusing. Note that
  // the SPA shell deliberately keeps its own caching — an installed app must still open
  // with no connection — so this is scoped to the API prefix only.
  app.addHook('onSend', (request, reply, payload, done) => {
    if (request.url === API_PREFIX || request.url.startsWith(`${API_PREFIX}/`)) {
      reply.header('Cache-Control', 'no-store');
    }
    done(null, payload);
  });

  // ── Health (AC6 / AC8; used by the container HEALTHCHECK) ───────────────────
  app.get('/api/v1/health', () => ({
    status: 'ok',
    version: config.version,
    uptime: Math.round(process.uptime()),
  }));

  // ── Authentication (T3) ─────────────────────────────────────────────────────
  // Registered as ONE module: the guard hook and the routes must share a context,
  // or the routes escape the guard. Registered before the static/not-found
  // handlers so the guard runs for API routes while static assets and the SPA
  // shell stay public (the login page has to be able to load).
  const authService =
    options.authService ??
    (options.db === undefined
      ? undefined
      : new AuthService(options.db, { sessionTtlDays: config.sessionTtlDays }));

  if (authService !== undefined && options.db !== undefined) {
    const secureCookies =
      options.secureCookies ?? config.nodeEnv === 'production';
    const db = options.db;

    // Protected route groups are passed INTO the auth module so the guard's hooks
    // apply to them (see plugins/auth.ts `extraRoutes`).
    void app.register(authModule, {
      config,
      authService,
      secureCookies,
      extraRoutes: [
        (instance) =>
          registerTransactionRoutes(instance, { db, now: options.now }),
        (instance) =>
          registerMasterDataRoutes(instance, { db, now: options.now }),
        (instance) => registerBudgetRoutes(instance, { db, now: options.now }),
        // Must be in this array, not a sibling `app.register`: a hook and the routes it should
        // protect have to share an encapsulation context, or the routes escape the guard
        // silently (`plugins/auth.ts`, and `spec/backend/index.md` "the most expensive
        // mistake"). Asserted endpoint-by-endpoint in `e2e-transfers.mjs`.
        (instance) => registerTransferRoutes(instance, { db, now: options.now }),
        (instance) => registerStatsRoutes(instance, { db, now: options.now }),
        (instance) => registerTrashRoutes(instance, { db, now: options.now }),
        (instance) => registerRecurringRoutes(instance, { db, now: options.now }),
        (instance) =>
          registerPortabilityRoutes(instance, {
            db,
            dataDir: config.dataDir,
            now: options.now,
          }),
        (instance) =>
          registerAiRoutes(instance, {
            db,
            config,
            now: options.now,
            fetchImpl: options.fetchImpl,
          }),
        (instance) =>
          registerAssistantRoutes(instance, {
            db,
            config,
            now: options.now,
            fetchImpl: options.fetchImpl,
          }),
      ],
    });
  } else {
    app.log.warn('no database supplied — authentication routes are disabled');
  }

  // ── Static web build at / with SPA fallback (R4) ────────────────────────────
  if (hasWebBuild) {
    // wildcard:false registers one route per file that exists at boot, so a
    // missing path falls through to the not-found handler below instead of
    // being swallowed by the plugin's own wildcard context.
    app.register(fastifyStatic, {
      root: webDistDir,
      index: ['index.html'],
      wildcard: false,
    });
  } else {
    app.log.warn(
      { webDistDir },
      'web build not found — static hosting disabled (run `pnpm --filter web run build`)',
    );
  }

  app.setNotFoundHandler((request, reply) => {
    const url = request.url;

    // AC9: an unmatched /api/** route answers JSON, never the SPA shell.
    if (url === API_PREFIX || url.startsWith(`${API_PREFIX}/`)) {
      request.log.warn({ method: request.method, url }, 'api route not found');
      return reply
        .status(404)
        .send({ error: { code: 'NOT_FOUND', message: `Route ${request.method} ${url} not found` } });
    }

    if (hasWebBuild && SPA_METHODS.has(request.method)) {
      return reply.sendFile('index.html');
    }

    return reply
      .status(404)
      .send({ error: { code: 'NOT_FOUND', message: `Route ${request.method} ${url} not found` } });
  });

  return app;
}
