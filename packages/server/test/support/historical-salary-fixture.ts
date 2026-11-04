/**
 * Fixtures for tests whose subject is NOT the salary write path.
 *
 * Fresh module-allocation salary writes are retired (P07): `POST /api/v1/salaries`
 * without `contractVersion: 1` answers 410, and a version-1 salary funds four
 * purposes instead of modules. Tests about the envelope engine, statistics,
 * transfers, recurring bills or the manual plan still need salary rows and their
 * historical `budget_allocations` snapshots to exist, because those rows are
 * real historical facts in any upgraded database.
 *
 * So instead of driving the retired route (which would turn an unrelated
 * regression into a 410), those tests insert the historical facts directly here.
 * This is deliberately the ONLY shared implementation: three copies of
 * "insert a legacy cycle" would drift, and a drift in a fixture silently changes
 * what an accounting assertion means.
 *
 * Do not use this to test salary behaviour — that belongs in
 * `salary-fund-budget.test.ts` against the current contract.
 */
import { randomUUID } from 'node:crypto';
import type { Db } from '../../src/db/index.js';

export interface HistoricalAllocationItem {
  readonly categoryId: string;
  readonly amountCents: number;
}

export interface HistoricalSalaryInput {
  readonly id?: string;
  readonly amountCents: number;
  readonly date: number;
  readonly accountId: string;
  readonly note?: string;
  readonly updatedAt?: number;
  /**
   * Frozen module snapshot for this cycle. Omit for a salary that never had
   * allocations (a version-1 four-purpose salary, or an unclaimed historical one).
   */
  readonly allocations?: readonly HistoricalAllocationItem[];
}

export interface HistoricalSalaryFixture {
  readonly id: string;
  readonly allocationId: string | null;
}

/**
 * Inserts one live salary and, when supplied, its module allocation snapshot.
 *
 * The rows are exactly what migration 003+ would have left behind: `deleted = 0`,
 * amounts already in integer cents, and the allocation date equal to the salary
 * date because the engine groups cycles by that date.
 */
export function seedHistoricalSalary(
  db: Db,
  input: HistoricalSalaryInput,
): HistoricalSalaryFixture {
  const id = input.id ?? randomUUID();
  const updatedAt = input.updatedAt ?? input.date;
  db.prepare(
    `INSERT INTO salary_records (id, amount_cents, date, note, account_id, deleted, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`,
  ).run(id, input.amountCents, input.date, input.note ?? '', input.accountId, updatedAt);

  if (input.allocations === undefined) return { id, allocationId: null };

  const allocationId = randomUUID();
  db.prepare(
    `INSERT INTO budget_allocations (id, salary_record_id, date, allocations_json, deleted, updated_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
  ).run(allocationId, id, input.date, JSON.stringify(input.allocations), updatedAt);
  return { id, allocationId };
}
