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
 *   POST   /api/v1/templates/:id/apply-current  apply to the newest cycle
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
  computePoolTrend,
  dateOnly,
  listCycleStarts,
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

  function loadCategoryHierarchy(): {
    readonly parentByCategoryId: Map<string, string>;
    readonly names: Map<string, string>;
    readonly childrenByParent: Map<string, string[]>;
  } {
    const parentByCategoryId = new Map<string, string>();
    const names = new Map<string, string>();
    const childrenByParent = new Map<string, string[]>();
    const rows = db.prepare('SELECT id, name, parent_id FROM categories').all() as {
      id: string;
      name: string;
      parent_id: string | null;
    }[];
    for (const row of rows) {
      names.set(row.id, row.name);
      if (row.parent_id === null) continue;
      parentByCategoryId.set(row.id, row.parent_id);
      const children = childrenByParent.get(row.parent_id) ?? [];
      children.push(row.id);
      childrenByParent.set(row.parent_id, children);
    }
    return { parentByCategoryId, names, childrenByParent };
  }
  function cycleConfig(): CycleConfig {
    const day = salaries.getCycleStartDay();
    return day === undefined ? NATURAL_MONTH : { kind: 'start-day', day };
  }

  /**
   * Parses `?periodStart=`.
   *
   * Absent and `''` both mean "the current cycle", matching how the stats routes treat
   * their optional window parameters. Anything present must be a finite integer.
   *
   * Validation happens here; whether the value names a REAL cycle is checked against
   * `listCycleStarts` by the caller, because "not a number" and "a number naming no
   * cycle" deserve the same 400 but for different reasons.
   */
  function parsePeriodStart(query: Record<string, unknown>): number | undefined {
    const raw = query['periodStart'];
    if (raw === undefined || raw === '') return undefined;
    const value = Number(raw);
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new ValidationError(
        'periodStart must be an epoch-millisecond timestamp of a known budget cycle.',
      );
    }
    return value;
  }

  // ── budget overview ────────────────────────────────────────────────────────
  app.get('/api/v1/budget/overview', async (request: FastifyRequest, reply: FastifyReply) => {
    const allocations = loadAllocations();
    const transactions = loadTransactions();
    const hierarchy = loadCategoryHierarchy();
    const cycle = cycleConfig();

    const requested = parsePeriodStart((request.query ?? {}) as Record<string, unknown>);
    // `group.start` is `dateOnly`-normalised inside the engine, so normalise the request
    // the same way before matching, or a timestamp with a time of day never matches.
    const target = requested === undefined ? undefined : dateOnly(requested);

    if (target !== undefined && !listCycleStarts(allocations, cycle).includes(target)) {
      // Fail loudly. Falling back to the current cycle would put one month's numbers
      // under another month's heading, which is worse than an error.
      throw new ValidationError('Unknown budget period.');
    }

    const views = computeModuleViews({
      allocationsDesc: allocations,
      transactions,
      cycle,
      ...(target === undefined ? {} : { periodStart: target }),
      parentByCategoryId: hierarchy.parentByCategoryId,
    });

    // The pool for a HISTORICAL cycle comes from the existing trend series — it is the
    // number that series already plots for that cycle, so the budget page and the chart
    // cannot disagree about it. Deriving it by truncating the allocations and calling
    // `computeCarryoverPool` would be wrong: that function's current-cycle branch only
    // carries an OVERSPENT module's shortfall, and a closed cycle's leftover from
    // un-overspent modules enters through the historical branch instead.
    //
    // When no period is requested, the code path is exactly as it was: the live pool.
    const pool =
      target === undefined
        ? computeCarryoverPool({
            allocationsDesc: allocations,
            transactions,
            currentModuleViews: views,
            cycle,
            parentByCategoryId: hierarchy.parentByCategoryId,
          })
        : (computePoolTrend({
            allocationsDesc: allocations,
            transactions,
            currentModuleViews: views,
            cycle,
            parentByCategoryId: hierarchy.parentByCategoryId,
          }).find((point) => point.periodStart === target)?.poolCents ?? 0);

    // Category names and child spending travel with the numbers so the client only renders.
    const modules = views
      .map((view) => {
        const childIds = hierarchy.childrenByParent.get(view.categoryId) ?? [];
        const { children: childViews, ...baseView } = view;
        const spentByChild = new Map(
          (childViews ?? []).map((child) => [child.categoryId, child.spentCents]),
        );
        return {
          ...baseView,
          categoryName: hierarchy.names.get(view.categoryId) ?? view.categoryId,
          ...(childIds.length === 0
            ? {}
            : {
                children: childIds.map((categoryId) => ({
                  categoryId,
                  categoryName: hierarchy.names.get(categoryId) ?? categoryId,
                  spentCents: spentByChild.get(categoryId) ?? 0,
                })),
              }),
        };
      })
      .sort((a, b) => b.budgetCents - a.budgetCents);
    const totalBudget = views.reduce((sum, view) => sum + view.budgetCents, 0);
    const totalSpent = views.reduce((sum, view) => sum + view.spentCents, 0);

    return reply.send({
      cycle,
      modules,
      carryoverPoolCents: pool,
      totalBudgetCents: totalBudget,
      totalSpentCents: totalSpent,
      hasBudget: views.length > 0,
    });
  });

  // ── which cycles can be reviewed ───────────────────────────────────────────
  // A separate endpoint rather than extra fields on the overview: the overview must
  // answer byte-identically when no period is requested, so that every existing caller
  // and test keeps its exact contract.
  app.get('/api/v1/budget/periods', async (_request: FastifyRequest, reply: FastifyReply) => {
    const cycle = cycleConfig();
    const periods = listCycleStarts(loadAllocations(), cycle);

    return reply.send({
      periods,
      currentPeriodStart: periods[periods.length - 1] ?? null,
      cycle,
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
      ...(Array.isArray(body['modules']) ? { modules: body['modules'] as never } : {}),
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

  app.post(
    '/api/v1/templates/:id/apply-current',
    async (request: FastifyRequest, reply: FastifyReply) => {
      return reply.send(salaries.applyTemplateToCurrentCycle(requireId(request)));
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
