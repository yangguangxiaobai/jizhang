/**
 * AI assistant routes. Every route is registered inside the authenticated module.
 *
 *   GET  /api/v1/ai/config              redacted provider summary
 *   PUT  /api/v1/ai/config              save provider settings
 *   POST /api/v1/ai/test                make an explicit provider test request
 *   POST /api/v1/ai/transaction-draft   generate a read-only transaction draft
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/index.js';
import { AiConfigService } from '../services/ai-config-service.js';
import { AiProviderService } from '../services/ai-provider-service.js';
import type { AiProviderConfigInput } from '../services/ai-types.js';
import { AiTransactionService } from '../services/ai-transaction-service.js';

export interface AiRoutesOptions {
  readonly db: Db;
  readonly config: AppConfig;
  readonly now?: (() => number) | undefined;
  readonly fetchImpl?: typeof fetch;
}

function bodyRecord(request: FastifyRequest): Record<string, unknown> {
  const body = request.body;
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

export async function registerAiRoutes(
  app: FastifyInstance,
  options: AiRoutesOptions,
): Promise<void> {
  const config = new AiConfigService(options.db, {
    aiEncryptionKey: options.config.aiEncryptionKey,
    production: options.config.nodeEnv === 'production',
    now: options.now,
  });
  const provider = new AiProviderService(options.fetchImpl);
  const transactions = new AiTransactionService(options.db, config, provider, options.now);

  app.get('/api/v1/ai/config', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(config.summary());
  });

  app.put('/api/v1/ai/config', async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(config.save(bodyRecord(request) as AiProviderConfigInput));
  });

  app.post('/api/v1/ai/test', async (_request: FastifyRequest, reply: FastifyReply) => {
    await transactions.testProvider();
    return reply.send({ ok: true });
  });

  app.post(
    '/api/v1/ai/transaction-draft',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = bodyRecord(request);
      return reply.send(await transactions.draft(body['input']));
    },
  );
}
