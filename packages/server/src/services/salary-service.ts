/**
 * Salary service: recording a salary is what starts a budget cycle.
 *
 * Contract (T6 PRD R2/R4/R5):
 *   * `budget_allocations` rows are **snapshots**. The amounts are frozen at salary
 *     time, so editing a template later never rewrites history;
 *   * when the caller supplies no allocation, amounts come from the template via
 *     `allocateSalaryCents`, whose rule is "every module but the last is
 *     `round(total × ratio)`, and the last absorbs the remainder". The parts
 *     therefore always add up to exactly the salary;
 *   * when the caller DOES supply an allocation (the "fine-tune" path), the values
 *     are used as given but must still sum to the salary;
 *   * deleting a salary soft-deletes its allocations too, or the budget engine
 *     would keep counting a cycle that the user removed;
 *   * `cycle_start_day` lives in `settings` and must be 1..28.
 *
 * Several allocations may share a cycle: the engine merges them by summing module
 * amounts, so this service must NOT merge anything itself.
 */
import { allocateSalaryCents } from '@jizhang/shared';
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/index.js';
import {
  NotFoundError,
  ValidationError,
  assertAccountUsable,
  requireNonEmptyString,
} from './transaction-service.js';
import { TemplateService } from './template-service.js';

/** `settings` key holding the optional budget cycle start day. */
export const CYCLE_START_DAY_KEY = 'budget.cycle_start_day';

/** Allowed range for the configurable cycle start day (T6 PRD R5). */
export const MIN_CYCLE_START_DAY = 1;
export const MAX_CYCLE_START_DAY = 28;

interface SalaryRow {
  readonly id: string;
  readonly amount_cents: number;
  readonly date: number;
  readonly note: string;
  readonly account_id: string;
  readonly deleted: number;
  readonly updated_at: number;
}

interface AllocationRow {
  readonly id: string;
  readonly salary_record_id: string;
  readonly date: number;
  readonly allocations_json: string;
  readonly deleted: number;
  readonly updated_at: number;
}

export interface AllocationItemDto {
  readonly categoryId: string;
  readonly amountCents: number;
}

export interface SalaryDto {
  readonly id: string;
  readonly amountCents: number;
  readonly date: number;
  readonly note: string;
  /** The account that received the money. Required: a salary with nowhere to land cannot
   * take part in a balance. */
  readonly accountId: string;
  readonly updatedAt: number;
}

export interface SalaryDetailDto extends SalaryDto {
  readonly allocationId: string | null;
  readonly allocations: AllocationItemDto[];
}

interface ParsedAllocationItem {
  readonly categoryId: string;
  readonly amountCents: number;
}

/** Tolerant reader for `allocations_json`; malformed input yields `[]`. */
export function parseAllocationsJson(raw: unknown): ParsedAllocationItem[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const decoded: unknown = JSON.parse(raw);
    if (!Array.isArray(decoded)) return [];
    const out: ParsedAllocationItem[] = [];
    for (const item of decoded) {
      if (typeof item !== 'object' || item === null) continue;
      const record = item as Record<string, unknown>;
      const categoryId = record['categoryId'];
      const amountCents = record['amountCents'];
      if (typeof categoryId !== 'string' || categoryId.trim() === '') continue;
      if (typeof amountCents !== 'number' || !Number.isInteger(amountCents)) continue;
      out.push({ categoryId, amountCents });
    }
    return out;
  } catch {
    return [];
  }
}

/** Earliest plausible salary date: 2000-01-01. */
const MIN_DATE_MS = Date.UTC(2000, 0, 1);
const FUTURE_SLACK_MS = 86_400_000;

export interface SalaryServiceOptions {
  readonly now?: () => number;
}

export interface CreateSalaryInput {
  readonly amountCents?: unknown;
  readonly date?: unknown;
  readonly note?: unknown;
  readonly accountId?: unknown;
  readonly templateId?: unknown;
  readonly allocations?: unknown;
}

export class SalaryService {
  private readonly db: Db;
  private readonly now: () => number;
  private readonly templates: TemplateService;

  constructor(db: Db, options: SalaryServiceOptions = {}) {
    this.db = db;
    this.now = options.now ?? (() => Date.now());
    this.templates = new TemplateService(db, options);
  }

  private requireAmount(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
      throw new ValidationError(
        'amountCents must be a positive integer number of cents.',
      );
    }
    return value;
  }

  private requireDate(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new ValidationError('date must be an epoch-millisecond timestamp.');
    }
    if (value < MIN_DATE_MS) throw new ValidationError('date is before the year 2000.');
    if (value > this.now() + FUTURE_SLACK_MS) {
      throw new ValidationError('date is in the future.');
    }
    return value;
  }

  toDto(row: SalaryRow): SalaryDto {
    return {
      id: row.id,
      amountCents: row.amount_cents,
      date: row.date,
      note: row.note,
      accountId: row.account_id,
      updatedAt: row.updated_at,
    };
  }

  /** Read-only access to the allocation table, used by tests and diagnostics. */
  getAllocationRow(salaryId: string): AllocationRow | undefined {
    return this.db
      .prepare('SELECT * FROM budget_allocations WHERE salary_record_id = ?')
      .get(salaryId) as AllocationRow | undefined;
  }

  getById(id: string): SalaryDetailDto | undefined {
    const row = this.db
      .prepare('SELECT * FROM salary_records WHERE id = ? AND deleted = 0')
      .get(id) as SalaryRow | undefined;
    if (row === undefined) return undefined;

    const allocation = this.getAllocationRow(id);
    return {
      ...this.toDto(row),
      allocationId:
        allocation !== undefined && allocation.deleted === 0 ? allocation.id : null,
      allocations:
        allocation !== undefined && allocation.deleted === 0
          ? parseAllocationsJson(allocation.allocations_json)
          : [],
    };
  }

  getByIdOrThrow(id: string): SalaryDetailDto {
    const found = this.getById(id);
    if (found === undefined) throw new NotFoundError('Salary record not found.');
    return found;
  }

  list(limit = 200): SalaryDto[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM salary_records WHERE deleted = 0 ORDER BY date DESC, updated_at DESC LIMIT ?',
      )
      .all(limit) as SalaryRow[];
    return rows.map((row) => this.toDto(row));
  }

  /**
   * Live salary records inside `[from, to)`, for income aggregation.
   *
   * Windowed rather than reusing `list()`: that one applies `LIMIT 200`, so summing
   * its output over a long chart range would silently truncate history and under-report
   * income.
   */
  listInWindow(from: number, to: number): { amountCents: number; date: number }[] {
    const rows = this.db
      .prepare(
        `SELECT amount_cents, date
           FROM salary_records
          WHERE deleted = 0 AND date >= ? AND date < ?
          ORDER BY date`,
      )
      .all(from, to) as { amount_cents: number; date: number }[];

    return rows.map((row) => ({ amountCents: row.amount_cents, date: row.date }));
  }

  /**
   * Records a salary and its allocation snapshot.
   *
   * @param input.allocations optional fine-tuned allocation; when omitted the
   *   template's ratios generate the amounts.
   */
  create(input: CreateSalaryInput): SalaryDetailDto {
    const amountCents = this.requireAmount(input.amountCents);
    const date = this.requireDate(input.date);
    const note = typeof input.note === 'string' ? input.note : '';
    // Required, not defaulted. Silently picking an account would put the money somewhere the
    // user did not choose, and a wrong balance is harder to notice than a rejected form.
    const accountId = requireNonEmptyString(input.accountId, 'accountId');
    assertAccountUsable(this.db, accountId);

    const templateId =
      typeof input.templateId === 'string' && input.templateId.trim() !== ''
        ? input.templateId.trim()
        : undefined;

    const allocations = this.resolveAllocations(input.allocations, amountCents, templateId);

    const salaryId = randomUUID();
    const allocationId = randomUUID();
    const nowMs = this.now();

    const run = this.db.transaction((): void => {
      this.db
        .prepare(
          `INSERT INTO salary_records (id, amount_cents, date, note, account_id, deleted, updated_at)
           VALUES (?, ?, ?, ?, ?, 0, ?)`,
        )
        .run(salaryId, amountCents, date, note, accountId, nowMs);

      this.db
        .prepare(
          `INSERT INTO budget_allocations (id, salary_record_id, date, allocations_json, deleted, updated_at)
           VALUES (?, ?, ?, ?, 0, ?)`,
        )
        .run(allocationId, salaryId, date, JSON.stringify(allocations), nowMs);
    });
    run();

    return this.getByIdOrThrow(salaryId);
  }

  /**
   * Produces the allocation to snapshot.
   *
   * Fine-tuned values win, but must still add up to the salary — otherwise the
   * module budgets would not account for the whole pay cheque.
   */
  private resolveAllocations(
    raw: unknown,
    amountCents: number,
    templateId: string | undefined,
  ): ParsedAllocationItem[] {
    let items: ParsedAllocationItem[];

    if (raw !== undefined) {
      if (!Array.isArray(raw) || raw.length === 0) {
        throw new ValidationError('allocations must be a non-empty list of module amounts.');
      }
      items = [];
      for (const entry of raw) {
        if (typeof entry !== 'object' || entry === null) {
          throw new ValidationError('Each allocation needs categoryId and amountCents.');
        }
        const record = entry as Record<string, unknown>;
        const categoryId = record['categoryId'];
        const amount = record['amountCents'];
        if (typeof categoryId !== 'string' || categoryId.trim() === '') {
          throw new ValidationError('Each allocation needs a categoryId.');
        }
        if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0) {
          throw new ValidationError(
            `Allocation for ${categoryId} must be a non-negative integer number of cents.`,
          );
        }
        items.push({ categoryId: categoryId.trim(), amountCents: amount });
      }
    } else {
      const template =
        templateId === undefined
          ? this.templates.getDefault()
          : this.templates.getById(templateId);
      if (template === undefined) {
        throw new ValidationError(
          templateId === undefined
            ? 'No template is available to allocate this salary.'
            : `Unknown template: ${templateId}`,
        );
      }
      items = allocateSalaryCents(amountCents, template.modules);
    }

    const sum = items.reduce((total, item) => total + item.amountCents, 0);
    if (sum !== amountCents) {
      const difference = amountCents - sum;
      throw new ValidationError(
        difference > 0
          ? `Undistributed ${difference} cents — the allocation must add up to the salary.`
          : `The allocation exceeds the salary by ${-difference} cents.`,
      );
    }

    // Every referenced category must exist, so the budget page never has modules
    // it cannot name.
    for (const item of items) {
      const found = this.db
        .prepare('SELECT 1 AS x FROM categories WHERE id = ? AND deleted = 0')
        .get(item.categoryId) as { x: number } | undefined;
      if (found === undefined) {
        throw new ValidationError(`Unknown or deleted category: ${item.categoryId}`);
      }
    }

    return items;
  }

  /**
   * Salary and allocation are one accounting fact. Never accept a different
   * salary amount while leaving its old budget behind, and never silently
   * recompute a hand-tuned snapshot. The caller must supply a balanced allocation
   * alongside an amount change. A date change moves the snapshot in the same
   * transaction, otherwise income and budget would land in different cycles.
   */
  update(
    id: string,
    changes: {
      readonly amountCents?: unknown;
      readonly date?: unknown;
      readonly note?: unknown;
      readonly accountId?: unknown;
      readonly allocations?: unknown;
    },
  ): SalaryDetailDto {
    const current = this.getByIdOrThrow(id);
    if (changes.amountCents === undefined && changes.date === undefined &&
        changes.note === undefined && changes.accountId === undefined &&
        changes.allocations === undefined) return current;

    const amountCents = changes.amountCents === undefined
      ? current.amountCents : this.requireAmount(changes.amountCents);
    const date = changes.date === undefined ? current.date : this.requireDate(changes.date);
    if (changes.note !== undefined && typeof changes.note !== 'string') {
      throw new ValidationError('note must be a string.');
    }
    const note = changes.note === undefined ? current.note : changes.note;
    // Moving a salary to another account is a normal correction ("I filed it against the
    // wrong card"), so it is allowed and needs no other field. The balance simply follows:
    // both accounts are recomputed from the rows, so there is nothing to keep in sync.
    const accountId = changes.accountId === undefined
      ? current.accountId
      : requireNonEmptyString(changes.accountId, 'accountId');
    if (accountId !== current.accountId) assertAccountUsable(this.db, accountId);
    if (amountCents !== current.amountCents && changes.allocations === undefined) {
      throw new ValidationError('Changing the salary amount requires explicit allocations that add up to the new salary.');
    }
    const items = changes.allocations === undefined
      ? undefined : this.resolveAllocations(changes.allocations, amountCents, undefined);
    const nowMs = this.now();

    this.db.transaction(() => {
      this.db.prepare('UPDATE salary_records SET amount_cents = ?, date = ?, note = ?, account_id = ?, updated_at = ? WHERE id = ?')
        .run(amountCents, date, note, accountId, nowMs, id);
      if (items !== undefined) {
        this.writeAllocation(id, date, items, nowMs);
      } else if (date !== current.date) {
        this.db.prepare('UPDATE budget_allocations SET date = ?, updated_at = ? WHERE salary_record_id = ?')
          .run(date, nowMs, id);
      }
    })();
    return this.getByIdOrThrow(id);
  }

  /** All snapshot rewrites also synchronize their date with the salary. */
  private writeAllocation(id: string, date: number, items: ParsedAllocationItem[], nowMs: number): void {
    const existing = this.getAllocationRow(id);
    if (existing === undefined) {
      this.db.prepare(`INSERT INTO budget_allocations (id, salary_record_id, date, allocations_json, deleted, updated_at)
        VALUES (?, ?, ?, ?, 0, ?)`)
        .run(randomUUID(), id, date, JSON.stringify(items), nowMs);
    } else {
      this.db.prepare('UPDATE budget_allocations SET date = ?, allocations_json = ?, deleted = 0, updated_at = ? WHERE id = ?')
        .run(date, JSON.stringify(items), nowMs, existing.id);
    }
  }

  /** Replaces the allocation snapshot without silently changing the salary. */
  replaceAllocations(id: string, raw: unknown): SalaryDetailDto {
    if (raw === undefined) throw new ValidationError('allocations are required.');
    const salary = this.getByIdOrThrow(id);
    const items = this.resolveAllocations(raw, salary.amountCents, undefined);
    this.db.transaction(() => this.writeAllocation(id, salary.date, items, this.now()))();
    return this.getByIdOrThrow(id);
  }

  /**
   * Soft-deletes the salary AND its allocation.
   *
   * Both must go: the budget engine reads allocations, so leaving one behind would
   * keep a deleted salary in the current cycle.
   */
  softDelete(id: string): void {
    this.getByIdOrThrow(id);
    const nowMs = this.now();

    const run = this.db.transaction((): void => {
      this.db
        .prepare('UPDATE salary_records SET deleted = 1, updated_at = ? WHERE id = ?')
        .run(nowMs, id);
      this.db
        .prepare(
          'UPDATE budget_allocations SET deleted = 1, updated_at = ? WHERE salary_record_id = ?',
        )
        .run(nowMs, id);
    });
    run();
  }

  // ── settings: budget.cycle_start_day ───────────────────────────────────────

  /** The configured cycle start day, or `undefined` for natural-month mode. */
  getCycleStartDay(): number | undefined {
    const row = this.db
      .prepare('SELECT value_json FROM settings WHERE key = ?')
      .get(CYCLE_START_DAY_KEY) as { value_json: string } | undefined;
    if (row === undefined) return undefined;

    try {
      const decoded: unknown = JSON.parse(row.value_json);
      if (typeof decoded !== 'object' || decoded === null) return undefined;
      const day = (decoded as Record<string, unknown>)['day'];
      if (typeof day !== 'number' || !Number.isInteger(day)) return undefined;
      if (day < MIN_CYCLE_START_DAY || day > MAX_CYCLE_START_DAY) return undefined;
      return day;
    } catch {
      return undefined;
    }
  }

  /** Sets the cycle start day. `null` clears it back to natural-month mode. */
  setCycleStartDay(day: number | null): number | undefined {
    if (day === null) {
      this.db.prepare('DELETE FROM settings WHERE key = ?').run(CYCLE_START_DAY_KEY);
      return undefined;
    }

    if (
      !Number.isInteger(day) ||
      day < MIN_CYCLE_START_DAY ||
      day > MAX_CYCLE_START_DAY
    ) {
      throw new ValidationError(
        `Cycle start day must be an integer between ${MIN_CYCLE_START_DAY} and ${MAX_CYCLE_START_DAY}.`,
      );
    }

    this.db
      .prepare(
        `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run(CYCLE_START_DAY_KEY, JSON.stringify({ day }), this.now());

    return day;
  }
}
