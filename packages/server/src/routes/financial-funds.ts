import type { FastifyInstance } from 'fastify';
import type { Db } from '../db/index.js';
import { requireUserId } from '../plugins/auth.js';
import { FinancialFundService } from '../services/financial-fund-service.js';

/**
 * Four-purpose fund reads and prospective configuration.
 *
 * Registered through the auth module's `extraRoutes`, so the shared guard (session +
 * CSRF) covers every route here. Activity remains unavailable until complete refund-graph
 * attribution is implemented; capabilities advertises it as unsupported.
 */
export async function registerFinancialFundRoutes(
  app: FastifyInstance,
  options: { db: Db; now?: (() => number) | undefined; serverTimeZone?: string | undefined },
): Promise<void> {
  const service = new FinancialFundService(options.db, options);

  app.get('/api/v1/financial-funds/capabilities', async () => service.capabilities());
  app.get('/api/v1/financial-funds/config', async () => service.getConfig());
  app.put('/api/v1/financial-funds/config', async (request) =>
    service.updateConfig(request.body, requireUserId(request)),
  );
  app.get('/api/v1/financial-funds/summary', async () => service.getSummary());
  app.get('/api/v1/financial-funds/migration-issues', async (request) => {
    const query = (request.query ?? {}) as Record<string, unknown>;
    return service.listIssues(query['limit'], query['offset']);
  });
  app.post('/api/v1/financial-funds/grants/review', async (request) =>
    service.reviewGrant(request.body, requireUserId(request)),
  );
}
