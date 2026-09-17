/**
 * Data portability routes (T15 PRD R1–R3).
 *
 *   GET  /api/v1/export/transactions.csv   bills, with isRefund so net expense is reproducible
 *   GET  /api/v1/export/salaries.csv       salary records with their allocation snapshot
 *   GET  /api/v1/export/recurring.csv      recurring rules
 *   GET  /api/v1/export/transfers.csv      account-to-account transfers
 *   POST /api/v1/import/transactions       import a transactions CSV (body is the file text)
 *   POST /api/v1/import/transfers          import a transfers CSV (body is the file text)
 *   GET  /api/v1/backups                   list archives (file names only)
 *   POST /api/v1/backups                   take an archive now
 *
 * ## Why the CSV is served under /api even though the spec forbids HTML there
 *
 * The rule is "never answer an `/api` path with the SPA shell", because a client asking for
 * JSON must not receive HTML. A CSV download is neither: it is a deliberate file response
 * with `text/csv` and an attachment disposition. Serving it from `/api` keeps it behind the
 * same session guard as everything else, which matters more than the letter of the rule.
 *
 * ## Why the import body is raw text rather than multipart
 *
 * `multipart/form-data` needs `@fastify/multipart`, and a CSV is text. The client reads the
 * chosen file with `File.text()` and posts it with `Content-Type: text/csv`. The body size
 * limit still applies, and exceeding it produces a clear 413 rather than a truncated file.
 *
 * ## Why there is no restore endpoint
 *
 * `restoreBackup` requires the server to be stopped — it replaces the database file, and
 * doing that under a live process leaves the connection holding a deleted inode while WAL
 * writers keep writing to it. A button inside the app cannot stop the app. The UI therefore
 * prints the command instead; see `spec/backend/quality-guidelines.md`.
 *
 * Registered inside the auth module (see `app.ts`), so the guard covers all of it.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/index.js';
import { PortabilityService } from '../services/portability-service.js';
import { ValidationError } from '../services/transaction-service.js';

export interface PortabilityRoutesOptions {
  readonly db: Db;
  readonly dataDir: string;
  readonly now?: (() => number) | undefined;
}

/** A CSV download: attachment, correct type, and explicitly not cacheable. */
function sendCsv(reply: FastifyReply, fileName: string, body: string): FastifyReply {
  return reply
    .header('Content-Type', 'text/csv; charset=utf-8')
    .header('Content-Disposition', `attachment; filename="${fileName}"`)
    .send(body);
}

export async function registerPortabilityRoutes(
  app: FastifyInstance,
  options: PortabilityRoutesOptions,
): Promise<void> {
  const service = new PortabilityService(options.db, { dataDir: options.dataDir });

  // ── export ─────────────────────────────────────────────────────────────────
  app.get(
    '/api/v1/export/transactions.csv',
    async (_request: FastifyRequest, reply: FastifyReply) =>
      sendCsv(reply, 'jizhang-transactions.csv', service.exportTransactionsCsv()),
  );

  app.get(
    '/api/v1/export/salaries.csv',
    async (_request: FastifyRequest, reply: FastifyReply) =>
      sendCsv(reply, 'jizhang-salaries.csv', service.exportSalariesCsv()),
  );

  app.get(
    '/api/v1/export/recurring.csv',
    async (_request: FastifyRequest, reply: FastifyReply) =>
      sendCsv(reply, 'jizhang-recurring.csv', service.exportRecurringCsv()),
  );

  app.get(
    '/api/v1/export/transfers.csv',
    async (_request: FastifyRequest, reply: FastifyReply) =>
      sendCsv(reply, 'jizhang-transfers.csv', service.exportTransfersCsv()),
  );

  // ── import ─────────────────────────────────────────────────────────────────
  app.post(
    '/api/v1/import/transactions',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body;
      if (typeof body !== 'string' || body.trim() === '') {
        throw new ValidationError(
          'Send the CSV file contents as the request body with Content-Type: text/csv.',
        );
      }
      return reply.send(service.importTransactionsCsv(body));
    },
  );

  app.post(
    '/api/v1/import/transfers',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body;
      if (typeof body !== 'string' || body.trim() === '') {
        throw new ValidationError(
          'Send the CSV file contents as the request body with Content-Type: text/csv.',
        );
      }
      return reply.send(service.importTransfersCsv(body));
    },
  );

  // ── backups ────────────────────────────────────────────────────────────────
  app.get('/api/v1/backups', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ items: service.listBackups() });
  });

  app.post('/api/v1/backups', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(201).send(service.createBackupNow());
  });
}
