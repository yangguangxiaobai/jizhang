/** Authenticated public proxy for the private item-cutout worker. */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ItemCutoutClient } from '../services/item-cutout-client.js';
import { validateItemPhotoBytes } from '../services/item-service.js';
import { ValidationError } from '../services/transaction-service.js';

export interface ItemCutoutRoutesOptions {
  readonly serviceUrl: string | undefined;
  readonly fetchImpl?: typeof fetch;
}

interface JobParams {
  readonly jobId: string;
}

interface CandidateParams extends JobParams {
  readonly candidateId: string;
}

export async function registerItemCutoutRoutes(
  app: FastifyInstance,
  options: ItemCutoutRoutesOptions,
): Promise<void> {
  const client = new ItemCutoutClient(options.serviceUrl, options.fetchImpl ?? fetch);

  app.post('/api/v1/items/cutouts', async (request: FastifyRequest, reply) => {
    reply.header('Cache-Control', 'no-store');
    const contentType = request.headers['content-type']?.split(';', 1)[0]?.toLowerCase() ?? '';
    const body: unknown = request.body;
    if (contentType !== 'image/webp') {
      throw new ValidationError('AI 抠图输入必须为压缩后的 WebP 图片。');
    }
    if (!Buffer.isBuffer(body)) throw new ValidationError('请发送图片二进制内容。');
    validateItemPhotoBytes(contentType, body);
    return reply.status(202).send(await client.createJob(body));
  });

  app.get(
    '/api/v1/items/cutouts/:jobId',
    async (request: FastifyRequest<{ Params: JobParams }>, reply) => {
      reply.header('Cache-Control', 'no-store');
      return reply.send(await client.getJob(request.params.jobId));
    },
  );

  app.delete(
    '/api/v1/items/cutouts/:jobId',
    async (request: FastifyRequest<{ Params: JobParams }>, reply) => {
      reply.header('Cache-Control', 'no-store');
      await client.cancelJob(request.params.jobId);
      return reply.status(204).send();
    },
  );

  app.get(
    '/api/v1/items/cutouts/:jobId/candidates/:candidateId/preview',
    async (request: FastifyRequest<{ Params: CandidateParams }>, reply: FastifyReply) => {
      reply
        .header('Cache-Control', 'no-store')
        .header('X-Content-Type-Options', 'nosniff');
      const bytes = await client.getCandidatePreview(
        request.params.jobId,
        request.params.candidateId,
      );
      return reply
        .header('Content-Type', 'image/webp')
        .header('Content-Disposition', 'inline')
        .header('X-Content-Type-Options', 'nosniff')
        .header('Cache-Control', 'no-store')
        .send(bytes);
    },
  );

  app.get(
    '/api/v1/items/cutouts/:jobId/candidates/:candidateId/image',
    async (request: FastifyRequest<{ Params: CandidateParams }>, reply: FastifyReply) => {
      reply
        .header('Cache-Control', 'no-store')
        .header('X-Content-Type-Options', 'nosniff');
      const bytes = await client.getCandidateImage(
        request.params.jobId,
        request.params.candidateId,
      );
      return reply
        .header('Content-Type', 'image/png')
        .header('Content-Disposition', 'inline; filename="item-cutout.png"')
        .header('X-Content-Type-Options', 'nosniff')
        .header('Cache-Control', 'no-store')
        .send(bytes);
    },
  );
}
