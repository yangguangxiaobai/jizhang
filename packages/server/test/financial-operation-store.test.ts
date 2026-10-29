/**
 * Behavior tests for the financial operation replay store.
 *
 * The store is the only thing standing between a timed-out client retry and a
 * duplicate salary/period write, so these tests pin the externally visible
 * contract:
 *
 * - canonical fingerprints (sorted object keys, unordered source/split arrays,
 *   null vs omitted, own `__proto__` keys);
 * - replay before any callback (the callback is where CAS / live-source
 *   validation happens);
 * - atomic rollback of the domain write and the operation row when the callback
 *   fails;
 * - actor scoping and durability across a real database reopen;
 * - fail-closed 503 for a corrupted stored response.
 *
 * No money maths is duplicated here: amounts are opaque integers used only to
 * make two payloads distinguishable.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initializeDatabase, type Db } from '../src/db/index.js';
import {
  canonicalFinancialPayload,
  getFinancialOperation,
  runFinancialOperation,
  type FinancialOperationInput,
} from '../src/services/financial-operation-store.js';

const ACTOR = 'user-owner';
const OTHER_ACTOR = 'user-other';
const OPERATION_ID = '11111111-1111-4111-8111-111111111111';
const RESOURCE = '/api/v1/financial-planning/periods/confirm';
const NOW = Date.UTC(2026, 9, 27, 1, 2, 3, 456);

let db: Db;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeDatabase(db, null);
});

afterEach(() => {
  closeDatabase(db);
});

function operationInput(
  overrides: Partial<FinancialOperationInput> = {},
): FinancialOperationInput {
  return {
    operationId: OPERATION_ID,
    actorId: ACTOR,
    method: 'POST',
    resource: RESOURCE,
    canonicalPayload: { expectedRevision: 0, periodId: 'period-1' },
    now: NOW,
    ...overrides,
  };
}

function operationCount(target: Db = db): number {
  const row = target
    .prepare('SELECT COUNT(*) AS count FROM financial_operations')
    .get() as { count: number };
  return row.count;
}

function totalChanges(target: Db = db): number {
  const row = target.prepare('SELECT total_changes() AS count').get() as { count: number };
  return row.count;
}

function createProbeTable(target: Db = db): void {
  target.exec('CREATE TABLE IF NOT EXISTS operation_probe (id TEXT PRIMARY KEY)');
}

function probeCount(target: Db = db): number {
  const row = target.prepare('SELECT COUNT(*) AS count FROM operation_probe').get() as {
    count: number;
  };
  return row.count;
}

function captureError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('Expected the operation to throw, but it returned normally.');
}

describe('canonicalFinancialPayload', () => {
  it('sorts object keys recursively regardless of insertion order', () => {
    const left = canonicalFinancialPayload({
      z: 1,
      a: { y: [{ b: 2, a: 1 }], x: null },
    });
    const right = canonicalFinancialPayload({
      a: { x: null, y: [{ a: 1, b: 2 }] },
      z: 1,
    });

    expect(left).toBe(right);
    expect(left).toBe('{"a":{"x":null,"y":[{"a":1,"b":2}]},"z":1}');
  });

  it('sorts unordered salary source arrays by salaryId', () => {
    const sources = [
      { salaryId: 'salary-b', expectedSourceToken: 'token-b' },
      { salaryId: 'salary-a', expectedSourceToken: 'token-a' },
    ];

    expect(canonicalFinancialPayload({ selectedSources: sources })).toBe(
      canonicalFinancialPayload({ selectedSources: [...sources].reverse() }),
    );
  });

  it('sorts refund split arrays by originalTransactionId', () => {
    const splits = [
      { originalTransactionId: 'txn-b', amountCents: 250 },
      { originalTransactionId: 'txn-a', amountCents: 125 },
    ];

    expect(canonicalFinancialPayload({ splits })).toBe(
      canonicalFinancialPayload({ splits: [...splits].reverse() }),
    );
  });

  it('keeps null distinct from omission while treating undefined as omitted', () => {
    expect(canonicalFinancialPayload({ financialPurpose: null })).not.toBe(
      canonicalFinancialPayload({}),
    );
    expect(canonicalFinancialPayload({ financialPurpose: undefined })).toBe(
      canonicalFinancialPayload({}),
    );
  });

  it('keeps an own __proto__ key distinct from an empty object', () => {
    // JSON.parse creates an own `__proto__` data property. Writing it into a
    // normal `{}` accumulator would invoke the prototype setter and silently
    // collapse this payload to `{}`, creating a hash collision.
    const parsed = JSON.parse('{"__proto__":{"x":1}}') as Record<string, unknown>;

    expect(canonicalFinancialPayload(parsed)).not.toBe(canonicalFinancialPayload({}));
    expect(canonicalFinancialPayload(parsed)).toContain('"__proto__"');
  });
});

describe('runFinancialOperation', () => {
  it('commits the domain write and replay record atomically, then replays without commit', () => {
    createProbeTable();
    let commits = 0;
    const response = { periodId: 'period-1', revision: 1 };

    const first = runFinancialOperation(db, operationInput(), () => {
      commits += 1;
      db.prepare('INSERT INTO operation_probe (id) VALUES (?)').run('domain-row');
      return { statusCode: 201, response };
    });

    expect(first).toEqual({ statusCode: 201, response });
    expect(commits).toBe(1);
    expect(probeCount()).toBe(1);
    expect(operationCount()).toBe(1);

    const replay = runFinancialOperation(db, operationInput({ now: NOW + 1 }), () => {
      commits += 1;
      throw new Error('commit must not run on replay');
    });

    expect(replay).toEqual(first);
    expect(commits).toBe(1);
    expect(probeCount()).toBe(1);
    expect(operationCount()).toBe(1);
  });

  it('returns the original response before re-running CAS or live-source validation', () => {
    let liveRevision = 0;
    const input = operationInput({
      canonicalPayload: { expectedRevision: 0, periodId: 'period-1' },
    });

    const first = runFinancialOperation(db, input, () => {
      liveRevision = 1;
      return { statusCode: 201, response: { revision: 1 } };
    });

    let callbackRan = false;
    const replay = runFinancialOperation(db, input, () => {
      callbackRan = true;
      // This is the validation a fresh request would run: the period has moved
      // on, or the source fact changed since the original attempt.
      if (liveRevision !== 0) {
        throw new Error('SIMULATED_FINANCIAL_REVISION_CONFLICT');
      }
      return { statusCode: 500, response: { revision: 0 } };
    });

    expect(replay).toEqual(first);
    expect(callbackRan).toBe(false);
    expect(liveRevision).toBe(1);
  });

  it('replays a semantically identical payload with reordered keys and identity arrays', () => {
    const firstPayload = {
      expectedRevision: 0,
      periodId: 'period-1',
      selectedSources: [
        { expectedSourceToken: 'token-b', salaryId: 'salary-b' },
        { expectedSourceToken: 'token-a', salaryId: 'salary-a' },
      ],
      splits: [
        { amountCents: 250, originalTransactionId: 'txn-b' },
        { amountCents: 125, originalTransactionId: 'txn-a' },
      ],
    };
    const reorderedPayload = {
      splits: [
        { originalTransactionId: 'txn-a', amountCents: 125 },
        { originalTransactionId: 'txn-b', amountCents: 250 },
      ],
      selectedSources: [
        { salaryId: 'salary-a', expectedSourceToken: 'token-a' },
        { salaryId: 'salary-b', expectedSourceToken: 'token-b' },
      ],
      periodId: 'period-1',
      expectedRevision: 0,
    };

    const first = runFinancialOperation(
      db,
      operationInput({ canonicalPayload: firstPayload }),
      () => ({ statusCode: 201, response: { revision: 1 } }),
    );

    let commits = 0;
    const replay = runFinancialOperation(
      db,
      operationInput({ canonicalPayload: reorderedPayload, now: NOW + 5000 }),
      () => {
        commits += 1;
        return { statusCode: 500, response: { unexpected: true } };
      },
    );

    expect(replay).toEqual(first);
    expect(commits).toBe(0);
    expect(operationCount()).toBe(1);
  });

  it('rejects a changed body with 409 FINANCIAL_OPERATION_MISMATCH without committing', () => {
    const first = runFinancialOperation(db, operationInput(), () => ({
      statusCode: 201,
      response: { revision: 1 },
    }));

    let commits = 0;
    const error = captureError(() =>
      runFinancialOperation(
        db,
        operationInput({
          canonicalPayload: { expectedRevision: 0, periodId: 'period-2' },
        }),
        () => {
          commits += 1;
          return { statusCode: 201, response: { revision: 2 } };
        },
      ),
    );

    expect(error).toMatchObject({
      statusCode: 409,
      code: 'FINANCIAL_OPERATION_MISMATCH',
    });
    expect(commits).toBe(0);
    expect(operationCount()).toBe(1);
    expect(getFinancialOperation(db, OPERATION_ID, ACTOR)?.response).toEqual(first.response);
  });

  it('rejects a reused operationId with a different method or resource', () => {
    runFinancialOperation(db, operationInput(), () => ({
      statusCode: 201,
      response: { revision: 1 },
    }));

    const variants: Partial<FinancialOperationInput>[] = [
      { method: 'PATCH' },
      { resource: '/api/v1/financial-planning/config' },
    ];

    for (const variant of variants) {
      let commits = 0;
      const error = captureError(() =>
        runFinancialOperation(db, operationInput(variant), () => {
          commits += 1;
          return { statusCode: 201, response: { revision: 2 } };
        }),
      );

      expect(error).toMatchObject({
        statusCode: 409,
        code: 'FINANCIAL_OPERATION_MISMATCH',
      });
      expect(commits).toBe(0);
    }

    expect(operationCount()).toBe(1);
  });

  it('does not replay an empty body for a payload with an own __proto__ key', () => {
    const first = runFinancialOperation(
      db,
      operationInput({ canonicalPayload: {} }),
      () => ({ statusCode: 201, response: { revision: 1 } }),
    );
    const protoPayload = JSON.parse('{"__proto__":{"x":1}}') as Record<string, unknown>;

    let commits = 0;
    const error = captureError(() =>
      runFinancialOperation(db, operationInput({ canonicalPayload: protoPayload }), () => {
        commits += 1;
        return { statusCode: 201, response: { revision: 2 } };
      }),
    );

    expect(error).toMatchObject({
      statusCode: 409,
      code: 'FINANCIAL_OPERATION_MISMATCH',
    });
    expect(commits).toBe(0);
    expect(getFinancialOperation(db, OPERATION_ID, ACTOR)?.response).toEqual(first.response);
  });

  it('rolls back both the domain write and the operation record when commit throws', () => {
    createProbeTable();
    let attempts = 0;

    const error = captureError(() =>
      runFinancialOperation(db, operationInput(), () => {
        attempts += 1;
        db.prepare('INSERT INTO operation_probe (id) VALUES (?)').run('partial-domain-row');
        throw new Error('SIMULATED_CAS_OR_LIVE_VALIDATION_FAILURE');
      }),
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('SIMULATED_CAS_OR_LIVE_VALIDATION_FAILURE');
    expect(attempts).toBe(1);
    expect(probeCount()).toBe(0);
    expect(operationCount()).toBe(0);
    expect(getFinancialOperation(db, OPERATION_ID, ACTOR)).toBeUndefined();

    // A failed validation must not consume the operationId: the same key is
    // reusable after the transient conflict is resolved.
    const retried = runFinancialOperation(db, operationInput(), () => {
      attempts += 1;
      db.prepare('INSERT INTO operation_probe (id) VALUES (?)').run('retried-domain-row');
      return { statusCode: 201, response: { revision: 1 } };
    });

    expect(retried.statusCode).toBe(201);
    expect(attempts).toBe(2);
    expect(probeCount()).toBe(1);
    expect(operationCount()).toBe(1);
  });

  it('reads without writing and does not expose one actor record to another', () => {
    runFinancialOperation(db, operationInput(), () => ({
      statusCode: 201,
      response: { revision: 1 },
    }));
    const changesBefore = totalChanges();

    expect(getFinancialOperation(db, 'missing-operation', ACTOR)).toBeUndefined();
    expect(getFinancialOperation(db, OPERATION_ID, OTHER_ACTOR)).toBeUndefined();
    expect(getFinancialOperation(db, OPERATION_ID, ACTOR)).toEqual({
      operationId: OPERATION_ID,
      method: 'POST',
      resource: RESOURCE,
      statusCode: 201,
      response: { revision: 1 },
      committedAt: NOW,
    });
    expect(totalChanges()).toBe(changesBefore);
    expect(operationCount()).toBe(1);

    // A repeated GET still does not write anything.
    expect(getFinancialOperation(db, 'missing-operation', ACTOR)).toBeUndefined();
    expect(totalChanges()).toBe(changesBefore);
  });

  it('replays for the same actor across logical sessions and keeps the first committedAt', () => {
    const first = runFinancialOperation(db, operationInput({ now: NOW }), () => ({
      statusCode: 201,
      response: { revision: 1 },
    }));

    let commits = 0;
    const replay = runFinancialOperation(
      db,
      operationInput({ now: NOW + 7 * 24 * 60 * 60 * 1000 }),
      () => {
        commits += 1;
        return { statusCode: 500, response: { unexpected: true } };
      },
    );

    expect(replay).toEqual(first);
    expect(commits).toBe(0);
    expect(getFinancialOperation(db, OPERATION_ID, ACTOR)?.committedAt).toBe(NOW);
    expect(operationCount()).toBe(1);
  });

  it('never replays another actor response for the same operationId', () => {
    const ownerResponse = { owner: ACTOR, revision: 1 };
    runFinancialOperation(db, operationInput(), () => ({
      statusCode: 201,
      response: ownerResponse,
    }));

    let commits = 0;
    const error = captureError(() =>
      runFinancialOperation(db, operationInput({ actorId: OTHER_ACTOR }), () => {
        commits += 1;
        return { statusCode: 201, response: { owner: OTHER_ACTOR, revision: 2 } };
      }),
    );

    expect(error).toMatchObject({
      statusCode: 409,
      code: 'FINANCIAL_OPERATION_MISMATCH',
    });
    expect(commits).toBe(0);
    expect(getFinancialOperation(db, OPERATION_ID, OTHER_ACTOR)).toBeUndefined();
    expect(getFinancialOperation(db, OPERATION_ID, ACTOR)).toMatchObject({
      statusCode: 201,
      response: ownerResponse,
    });

    const row = db
      .prepare('SELECT actor_id FROM financial_operations WHERE operation_id = ?')
      .get(OPERATION_ID) as { actor_id: string };
    expect(row.actor_id).toBe(ACTOR);
  });

  it('fails closed with 503 FINANCIAL_UNAVAILABLE for a corrupted stored response', () => {
    runFinancialOperation(db, operationInput(), () => ({
      statusCode: 201,
      response: { revision: 1 },
    }));
    db.prepare('UPDATE financial_operations SET response_json = ? WHERE operation_id = ?').run(
      '{"broken":',
      OPERATION_ID,
    );
    const changesBefore = totalChanges();

    const getError = captureError(() => getFinancialOperation(db, OPERATION_ID, ACTOR));
    expect(getError).toMatchObject({
      statusCode: 503,
      code: 'FINANCIAL_UNAVAILABLE',
    });

    let commits = 0;
    const replayError = captureError(() =>
      runFinancialOperation(db, operationInput(), () => {
        commits += 1;
        return { statusCode: 201, response: { revision: 2 } };
      }),
    );
    expect(replayError).toMatchObject({
      statusCode: 503,
      code: 'FINANCIAL_UNAVAILABLE',
    });
    expect(commits).toBe(0);
    expect(operationCount()).toBe(1);
    expect(totalChanges()).toBe(changesBefore);

    const row = db
      .prepare('SELECT response_json FROM financial_operations WHERE operation_id = ?')
      .get(OPERATION_ID) as { response_json: string };
    expect(row.response_json).toBe('{"broken":');
  });
});

describe('durable replay across database reopen', () => {
  it('preserves the exact response and committedAt after closing and reopening the file', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'jizhang-operation-store-'));
    const file = path.join(directory, 'jizhang.db');
    let openDb: Db | undefined;
    let reopened: Db | undefined;

    try {
      openDb = new Database(file);
      openDb.pragma('journal_mode = WAL');
      openDb.pragma('foreign_keys = ON');
      initializeDatabase(openDb, null);

      const response = {
        period: { id: 'period-1', revision: 3 },
        status: 'confirmed',
        warnings: ['LEGACY_WINDOW_DIFFERS'],
      };
      const first = runFinancialOperation(openDb, operationInput(), () => ({
        statusCode: 201,
        response,
      }));
      expect(first).toEqual({ statusCode: 201, response });

      closeDatabase(openDb);
      openDb = undefined;

      reopened = new Database(file);
      reopened.pragma('foreign_keys = ON');
      initializeDatabase(reopened, null);

      expect(getFinancialOperation(reopened, OPERATION_ID, ACTOR)).toEqual({
        operationId: OPERATION_ID,
        method: 'POST',
        resource: RESOURCE,
        statusCode: 201,
        response,
        committedAt: NOW,
      });

      let commits = 0;
      const replay = runFinancialOperation(reopened, operationInput({ now: NOW + 1 }), () => {
        commits += 1;
        return { statusCode: 500, response: { unexpected: true } };
      });
      expect(replay).toEqual({ statusCode: 201, response });
      expect(commits).toBe(0);
      expect(getFinancialOperation(reopened, OPERATION_ID, ACTOR)?.committedAt).toBe(NOW);
    } finally {
      if (openDb?.open) closeDatabase(openDb);
      if (reopened?.open) closeDatabase(reopened);
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
