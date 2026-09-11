/**
 * Budget, salary and template routes (T6 PRD R1/R5).
 *
 *   GET    /api/v1/budget/overview     module views + carryover pool
 *   GET    /api/v1/salaries            list
 *   GET    /api/v1/salaries/:id        detail incl. allocation
 *   POST   /api/v1/salaries            record a salary (starts a cycle)
 *   PATCH  /api/v1/salaries/:id        edit the record
 *   PUT    /api/v1/salaries/:id/allocations  replace the snapshot
 *   DELETE /api/v1/salaries/:id        soft delete the record AND its allocation
 *   GET    /api/v1/templates           list
 *   POST   /api/v1/templates           create
 *   PATCH  /api/v1/templates/:id       edit
 *   DELETE /api/v1/templates/:id       soft delete (never the default)
 *   POST   /api/v1/templates/:id/default  make it the only default
 *   GET/PUT /api/v1/settings           cycle start day
 *
 * `/budget/overview` is the only place the envelope arithmetic is exposed, and it
 * delegates entirely to `@jizhang/shared`'s engine — the server never re-derives
 * net expense or carryover itself (design.md §5).
 *
 * Registered inside the auth module, so the guard applies to all of it.
 */
import {
  NATURAL_MONTH,
  computeCarryoverPool,
  computeModuleViews,
  type BudgetAllocation,
  type CycleConfig,
  type Transaction,
} from '@jizhang/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/index.js';
import {
  CYCLE_START_DAY_KEY,
  MAX_CYCLE_START_DAY,
  MIN_CYCLE_START_DAY,
  SalaryService,
  parseAllocationsJson,
} from '../services/salary-service.js';
import { TemplateService } from '../services/template-service.js';
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

export interface BudgetRoutesOptions {
  readonly db: Db;
  readonly now?: (() => number) | undefined;
}

export async function registerBudgetRoutes(
  app: FastifyInstance,
  options: BudgetRoutesOptions,
): Promise<void> {
  const { db } = options;
  const salaries = new SalaryService(db, options);
  const templates = new TemplateService(db, options);

  /** Reads every live allocation, newest first, in the engine's input shape. */
  function loadAllocations(): BudgetAllocation[] {
    const rows = db
      .prepare(
        'SELECT id, salary_record_id, date, allocations_json FROM budget_allocations WHERE deleted = 0 ORDER BY date DESC, updated_at DESC',
      )
      .all() as {
      id: string;
      salary_record_id: string;
      date: number;
      allocations_json: string;
    }[];

    return rows.map((row) => ({
      id: row.id,
      salaryRecordId: row.salary_record_id,
      date: row.date,
      allocations: parseAllocationsJson(row.allocations_json),
    }));
  }

  /** Reads every live transaction in the shared engine's input shape. */
  function loadTransactions(): Transaction[] {
    const rows = db
      .prepare(
        'SELECT id, type, amount_cents, category_id, date, is_refund FROM transactions WHERE deleted = 0',
      )
      .all() as {
      id: string;
      type: number;
      amount_cents: number;
      category_id: string;
      date: number;
      is_refund: number;
    }[];

    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      amountCents: row.amount_cents,
      categoryId: row.category_id,
      date: row.date,
      isRefund: row.is_refund === 1,
    }));
  }

  function cycleConfig(): CycleConfig {
    const day = salaries.getCycleStartDay();
    return day === undefined ? NATURAL_MONTH : { kind: 'start-day', day };
  }

  // ── budget overview ────────────────────────────────────────────────────────
  app.get('/api/v1/budget/overview', async (_request: FastifyRequest, reply: FastifyReply) => {
    const allocations = loadAllocations();
    const transactions = loadTransactions();
    const cycle = cycleConfig();

    const views = computeModuleViews({
      allocationsDesc: allocations,
      transactions,
      cycle,
    });
    const pool = computeCarryoverPool({
      allocationsDesc: allocations,
      transactions,
      currentModuleViews: views,
      cycle,
    });

    // Category names travel with the numbers so the client renders without a join.
    const names = new Map<string, string>();
    for (const row of db
      .prepare('SELECT id, name FROM categories')
      .all() as { id: string; name: string }[]) {
      names.set(row.id, row.name);
    }

    const totalBudget = views.reduce((sum, view) => sum + view.budgetCents, 0);
    const totalSpent = views.reduce((sum, view) => sum + view.spentCents, 0);

    return reply.send({
      cycle,
      modules: views
        .map((view) => ({
          ...view,
          categoryName: names.get(view.categoryId) ?? view.categoryId,
        }))
        .sort((a, b) => b.budgetCents - a.budgetCents),
      carryoverPoolCents: pool,
      totalBudgetCents: totalBudget,
      totalSpentCents: totalSpent,
      hasBudget: views.length > 0,
    });
  });

  // ── salaries ───────────────────────────────────────────────────────────────
  app.get('/api/v1/salaries', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ items: salaries.list() });
  });

  app.get('/api/v1/salaries/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send(salaries.getByIdOrThrow(requireId(request)));
  });

  app.post('/api/v1/salaries', async (request: FastifyRequest, reply: FastifyReply) => {
    const created = salaries.create((request.body ?? {}) as Record<string, unknown>);
    return reply.status(201).send(created);
  });

  app.patch('/api/v1/salaries/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const updated = salaries.update(
      requireId(request),
      (request.body ?? {}) as Record<string, unknown>,
    );
    return reply.send(updated);
  });

  app.put(
    '/api/v1/salaries/:id/allocations',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      return reply.send(salaries.replaceAllocations(requireId(request), body['allocations']));
    },
  );

  app.delete('/api/v1/salaries/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    salaries.softDelete(requireId(request));
    return reply.status(204).send();
  });

  // ── templates ──────────────────────────────────────────────────────────────
  app.get('/api/v1/templates', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ items: templates.list() });
  });

  app.post('/api/v1/templates', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const created = templates.create(
      typeof body['name'] === 'string' ? body['name'] : '',
      Array.isArray(body['modules']) ? (body['modules'] as never) : [],
      body['isDefault'] === true,
    );
    return reply.status(201).send(created);
  });

  app.patch('/api/v1/templates/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const updated = templates.update(requireId(request), {
      ...(body['name'] === undefined ? {} : { name: String(body['name']) }),
      ...(Array.isArray(body['modules'])
        ? { modules: body['modules'] as never }
        : {}),
    });
    return reply.send(updated);
  });

  app.delete('/api/v1/templates/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    templates.softDelete(requireId(request));
    return reply.status(204).send();
  });

  app.post(
    '/api/v1/templates/:id/default',
    async (request: FastifyRequest, reply: FastifyReply) => {
      return reply.send(templates.setDefault(requireId(request)));
    },
  );

  // ── settings ───────────────────────────────────────────────────────────────
  app.get('/api/v1/settings', async (_request: FastifyRequest, reply: FastifyReply) => {
    const day = salaries.getCycleStartDay();
    return reply.send({
      cycleStartDay: day ?? null,
      minCycleStartDay: MIN_CYCLE_START_DAY,
      maxCycleStartDay: MAX_CYCLE_START_DAY,
      key: CYCLE_START_DAY_KEY,
    });
  });

  app.put('/api/v1/settings', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const raw = body['cycleStartDay'];

    let day: number | null;
    if (raw === null || raw === undefined || raw === '') {
      day = null;
    } else if (typeof raw === 'number') {
      day = raw;
    } else {
      throw new ValidationError('cycleStartDay must be a number or null.');
    }

    const applied = salaries.setCycleStartDay(day);
    return reply.send({ cycleStartDay: applied ?? null });
  });
}
