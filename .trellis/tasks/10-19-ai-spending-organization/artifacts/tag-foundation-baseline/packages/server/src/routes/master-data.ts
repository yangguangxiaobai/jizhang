/**
 * Master-data routes: categories, accounts and the derived tag vocabulary.
 *
 *   GET    /api/v1/categories            list (`?type=0|1&includeDeleted=true`)
 *   POST   /api/v1/categories            create
 *   PATCH  /api/v1/categories/:id        rename / re-icon / recolour / reorder
 *   DELETE /api/v1/categories/:id        soft delete (builtins refuse)
 *   POST   /api/v1/categories/:id/move   `{dir:-1|1}` swap with the neighbour
 *   GET    /api/v1/accounts              list (`?includeDeleted=true`)
 *   GET    /api/v1/accounts/balances     every live account's balance + the total
 *   POST   /api/v1/accounts              create
 *   PATCH  /api/v1/accounts/:id          edit
 *   DELETE /api/v1/accounts/:id          soft delete (builtin + last-one refuse)
 *   POST   /api/v1/accounts/:id/move     `{dir:-1|1}`
 *   GET    /api/v1/tags                  vocabulary with usage counts
 *   PATCH  /api/v1/tags                  `{from,to}` rename everywhere
 *   DELETE /api/v1/tags/:name            remove everywhere
 *
 * Registered inside the auth module, so the guard covers all of it.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/index.js';
import { AccountBalanceService } from '../services/account-balance-service.js';
import {
  CATEGORY_TYPE_EXPENSE,
  CATEGORY_TYPE_INCOME,
  MasterDataService,
} from '../services/master-data-service.js';
import { ValidationError } from '../services/transaction-service.js';

interface IdParams {
  id?: string;
}

function requireId(request: FastifyRequest): string {
  const id = (request.params as IdParams).id;
  if (typeof id !== 'string' || id.trim() === '') {
    throw new ValidationError('An id is required.');
  }
  return id;
}

function optionalType(query: Record<string, unknown>): number | undefined {
  const raw = query['type'];
  if (raw === undefined || raw === '') return undefined;
  const parsed = Number(raw);
  if (parsed !== CATEGORY_TYPE_EXPENSE && parsed !== CATEGORY_TYPE_INCOME) {
    throw new ValidationError('type must be 0 (expense) or 1 (income).');
  }
  return parsed;
}

function optionalIncludeDeleted(query: Record<string, unknown>): boolean {
  const raw = query['includeDeleted'];
  if (raw === undefined || raw === '') return false;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new ValidationError('includeDeleted must be true or false.');
}

/** `{dir:-1|1}` from a move request. */
function requireDirection(body: Record<string, unknown>): -1 | 1 {
  const raw = body['dir'];
  if (raw !== -1 && raw !== 1) {
    throw new ValidationError('dir must be -1 (up) or 1 (down).');
  }
  return raw;
}

export interface MasterDataRoutesOptions {
  readonly db: Db;
  readonly now?: (() => number) | undefined;
}

export async function registerMasterDataRoutes(
  app: FastifyInstance,
  options: MasterDataRoutesOptions,
): Promise<void> {
  const service = new MasterDataService(options.db, options);
  const balances = new AccountBalanceService(options.db);

  // ── categories ────────────────────────────────────────────────────────────
  app.get('/api/v1/categories', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = (request.query ?? {}) as Record<string, unknown>;
    const type = optionalType(query);
    return reply.send({ items: service.listCategories(type, optionalIncludeDeleted(query)) });
  });

  app.post('/api/v1/categories', async (request: FastifyRequest, reply: FastifyReply) => {
    const created = service.createCategory((request.body ?? {}) as Record<string, unknown>);
    return reply.status(201).send(created);
  });

  app.patch('/api/v1/categories/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const updated = service.updateCategory(
      requireId(request),
      (request.body ?? {}) as Record<string, unknown>,
    );
    return reply.send(updated);
  });

  app.delete('/api/v1/categories/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    service.deleteCategory(requireId(request));
    return reply.status(204).send();
  });

  app.post('/api/v1/categories/:id/move', async (request: FastifyRequest, reply: FastifyReply) => {
    const dir = requireDirection((request.body ?? {}) as Record<string, unknown>);
    return reply.send({ items: service.moveCategory(requireId(request), dir) });
  });

  // ── accounts ──────────────────────────────────────────────────────────────
  app.get('/api/v1/accounts', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = (request.query ?? {}) as Record<string, unknown>;
    return reply.send({ items: service.listAccounts(optionalIncludeDeleted(query)) });
  });

  // A separate endpoint rather than extra fields on the list above: the account list is
  // master data (stable, cached for the session by the client) while a balance changes with
  // every bill. Folding them together would make one cached payload carry a number that goes
  // stale, which is exactly the staleness the balances store exists to avoid.
  //
  // The path sits beside `PATCH`/`DELETE /accounts/:id`; there is no `GET /accounts/:id`, so
  // the static segment is unambiguous.
  app.get('/api/v1/accounts/balances', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(balances.balances());
  });

  app.post('/api/v1/accounts', async (request: FastifyRequest, reply: FastifyReply) => {
    const created = service.createAccount((request.body ?? {}) as Record<string, unknown>);
    return reply.status(201).send(created);
  });

  app.patch('/api/v1/accounts/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const updated = service.updateAccount(
      requireId(request),
      (request.body ?? {}) as Record<string, unknown>,
    );
    return reply.send(updated);
  });

  app.delete('/api/v1/accounts/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    service.deleteAccount(requireId(request));
    return reply.status(204).send();
  });

  app.post('/api/v1/accounts/:id/move', async (request: FastifyRequest, reply: FastifyReply) => {
    const dir = requireDirection((request.body ?? {}) as Record<string, unknown>);
    return reply.send({ items: service.moveAccount(requireId(request), dir) });
  });

  // ── tags (no table: the name is the identity) ─────────────────────────────
  app.get('/api/v1/tags', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ items: service.listTags() });
  });

  app.patch('/api/v1/tags', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const from = body['from'];
    const to = body['to'];
    if (typeof from !== 'string' || typeof to !== 'string') {
      throw new ValidationError('Both "from" and "to" tag names are required.');
    }
    const result = service.renameTag(from, to);
    return reply.send({ ...result, items: service.listTags() });
  });

  app.delete('/api/v1/tags/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const name = (request.params as IdParams).id;
    if (typeof name !== 'string' || name.trim() === '') {
      throw new ValidationError('A tag name is required.');
    }
    const result = service.deleteTag(decodeURIComponent(name));
    return reply.send({ ...result, items: service.listTags() });
  });

  // ── impact preview: how many transactions reference a category/account ────
  app.get('/api/v1/categories/:id/usage', async (request: FastifyRequest, reply: FastifyReply) => {
    const id = requireId(request);
    service.getCategoryOrThrow(id);
    return reply.send({ transactions: service.countTransactionsForCategory(id) });
  });

  app.get('/api/v1/accounts/:id/usage', async (request: FastifyRequest, reply: FastifyReply) => {
    const id = requireId(request);
    service.getAccountOrThrow(id);
    return reply.send({ transactions: service.countTransactionsForAccount(id) });
  });
}
