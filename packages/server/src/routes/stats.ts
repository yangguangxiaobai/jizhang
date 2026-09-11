/**
 * Statistics routes (T8 PRD R1):
 *
 *   GET /api/v1/stats/category-share   `?from=&to=`   per-category net expense
 *   GET /api/v1/stats/monthly-trend    `?months=`     income + net expense per month
 *   GET /api/v1/stats/pool-trend                      carryover pool over time
 *   GET /api/v1/stats/range                           earliest/latest activity
 *
 * Every figure comes from `StatsService`, which in turn uses the shared accounting
 * rules — the routes do no arithmetic of their own.
 *
 * Registered inside the auth module, so the guard covers all of it.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/index.js';
import { StatsService } from '../services/stats-service.js';
import { ValidationError } from '../services/transaction-service.js';

export interface StatsRoutesOptions {
  readonly db: Db;
  readonly now?: (() => number) | undefined;
}

/** Local midnight helpers mirroring the shared engine's convention. */
function startOfMonth(epochMs: number): number {
  const date = new Date(epochMs);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

function startOfNextMonth(epochMs: number): number {
  const date = new Date(epochMs);
  return new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime();
}

export async function registerStatsRoutes(
  app: FastifyInstance,
  options: StatsRoutesOptions,
): Promise<void> {
  const service = new StatsService(options.db, options);

  app.get(
    '/api/v1/stats/category-share',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = (request.query ?? {}) as Record<string, unknown>;

      const rawFrom = query['from'];
      const rawTo = query['to'];

      // Default to the last 30 days, which is the range the reference app shows.
      const nowMs = options.now?.() ?? Date.now();
      const from =
        rawFrom === undefined || rawFrom === ''
          ? nowMs - 30 * 86_400_000
          : Number(rawFrom);
      const to =
        rawTo === undefined || rawTo === '' ? startOfNextMonth(nowMs) : Number(rawTo);

      if (!Number.isFinite(from) || !Number.isFinite(to)) {
        throw new ValidationError('from and to must be epoch-millisecond timestamps.');
      }

      return reply.send(service.categoryShare(from, to));
    },
  );

  app.get(
    '/api/v1/stats/monthly-trend',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = (request.query ?? {}) as Record<string, unknown>;
      const raw = query['months'];
      const months = raw === undefined || raw === '' ? 6 : Number(raw);

      if (!Number.isFinite(months)) {
        throw new ValidationError('months must be a number.');
      }

      return reply.send({ items: service.monthlyTrend(months) });
    },
  );

  app.get('/api/v1/stats/pool-trend', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(service.poolTrend());
  });

  app.get('/api/v1/stats/range', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(service.availableRange());
  });

  // Convenience helper for the chart range picker: the bounds of a given month.
  app.get('/api/v1/stats/month-window', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = (request.query ?? {}) as Record<string, unknown>;
    const raw = query['monthStart'];
    const anchor = raw === undefined || raw === '' ? Date.now() : Number(raw);
    if (!Number.isFinite(anchor)) {
      throw new ValidationError('monthStart must be an epoch-millisecond timestamp.');
    }
    return reply.send({
      from: startOfMonth(anchor),
      to: startOfNextMonth(anchor),
    });
  });
}
