/**
 * Phase 1 bill-purpose integration tests.
 *
 * Scope: transaction-service create/update DTO + atomic purpose writes,
 * operation replay/CAS/stale-token guards, type-change clearing, and the
 * durable refund-split lifecycle hooks (single + bulk paths).
 *
 * Fixtures run against a real in-memory SQLite database built from the current
 * migration set (019 included), not hand-written schema.
 */
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { closeDatabase, initializeDatabase, type Db } from '../src/db/index.js';
import { SESSION_COOKIE } from '../src/plugins/auth.js';
import { AuthService } from '../src/services/auth-service.js';
import {
  financialTransactionToken,
  readBillPurposeFacts,
  writeBillPurposeOverride,
} from '../src/services/financial-purpose-store.js';
import { TransactionService } from '../src/services/transaction-service.js';

const USERNAME = 'quiz';
const PASSWORD = 'correct horse battery staple';
const CSRF = { 'x-requested-with': 'fetch' } as const;

const FOOD = 'builtin-expense-food';
const TRANSPORT = 'builtin-expense-transport';
const SALARY = 'builtin-income-salary';
const ACCOUNT = 'builtin-default-account';

/** Fixed clock: date validation and event timestamps are deterministic. */
const NOW = Date.UTC(2026, 8, 11, 12, 0, 0);

let db: Db;
let app: FastifyInstance;
let cookie: string;
let service: TransactionService;
let clock = NOW;

async function login(): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: CSRF,
    payload: { username: USERNAME, password: PASSWORD },
  });
  const found = (response.cookies as { name: string; value: string }[]).find(
    (c) => c.name === SESSION_COOKIE,
  );
  return found?.value as string;
}

function as(token: string) {
  return { Cookie: `${SESSION_COOKIE}=${token}` };
}

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    type: 0,
    amountCents: 19_99,
    categoryId: FOOD,
    accountId: ACCOUNT,
    date: Date.UTC(2026, 7, 3),
    note: '午餐',
    ...overrides,
  };
}

async function post(body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/transactions',
    headers: { ...CSRF, ...as(cookie) },
    payload: body,
  });
}

async function patch(id: string, body: Record<string, unknown>) {
  return app.inject({
    method: 'PATCH',
    url: `/api/v1/transactions/${id}`,
    headers: { ...CSRF, ...as(cookie) },
    payload: body,
  });
}

async function createExpense(overrides: Record<string, unknown> = {}) {
  const response = await post(createBody(overrides));
  expect(response.statusCode).toBe(201);
  return response.json() as Record<string, unknown> & { id: string };
}

function tokenFor(id: string): string {
  const row = service.getByIdOrThrow(id);
  return financialTransactionToken({
    id: row.id,
    type: row.type,
    amountCents: row.amountCents,
    categoryId: row.categoryId,
    accountId: row.accountId,
    date: row.date,
    isRefund: row.isRefund,
    deleted: false,
  });
}

function purposeEvents(transactionId: string): {
  revision: number;
  purpose: string | null;
  reason: string;
  operation_id: string | null;
  actor_id: string | null;
}[] {
  return db
    .prepare(
      `SELECT revision, purpose, reason, operation_id, actor_id
         FROM financial_bill_purpose_events
        WHERE transaction_id = ?
        ORDER BY revision`,
    )
    .all(transactionId) as {
    revision: number;
    purpose: string | null;
    reason: string;
    operation_id: string | null;
    actor_id: string | null;
  }[];
}

/** Inserts one active split row + its confirmed set revision after the fact. */
function insertActiveSplit(refundTxId: string, originalTxId: string, amountCents = 500): void {
  const facts = JSON.stringify({ amountCents: 19_99, type: 1, isRefund: true });
  const originalFacts = JSON.stringify({ amountCents: 19_99, type: 0, isRefund: false });
  const revision =
    ((db
      .prepare('SELECT MAX(revision) AS r FROM financial_refund_split_sets WHERE refund_tx_id = ?')
      .get(refundTxId) as { r: number | null }).r ?? 0) + 1;
  db.prepare(
    `INSERT INTO financial_refund_split_sets
       (id, refund_tx_id, revision, status, reason, splits_json, facts_json, operation_id, created_at)
     VALUES (?, ?, ?, 'confirmed', NULL, ?, ?, NULL, ?)`,
  ).run(
    randomUUID(),
    refundTxId,
    revision,
    JSON.stringify([{ originalTransactionId: originalTxId, amountCents }]),
    JSON.stringify({ refund: JSON.parse(facts), originals: [{ transactionId: originalTxId, facts: JSON.parse(originalFacts) }] }),
    clock,
  );
  db.prepare(
    `INSERT INTO financial_refund_splits
       (id, refund_tx_id, original_tx_id, amount_cents, set_revision, state, invalid_reason,
        original_facts_json, refund_facts_json, operation_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', NULL, ?, ?, NULL, ?, ?)`,
  ).run(randomUUID(), refundTxId, originalTxId, amountCents, revision, originalFacts, facts, clock, clock);
}

function splitState(refundTxId: string): { state: string; invalid_reason: string | null } | undefined {
  return db
    .prepare('SELECT state, invalid_reason FROM financial_refund_splits WHERE refund_tx_id = ?')
    .get(refundTxId) as { state: string; invalid_reason: string | null } | undefined;
}

beforeEach(async () => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeDatabase(db, null);

  clock = NOW;
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    JIZHANG_USERNAME: USERNAME,
    JIZHANG_PASSWORD_HASH: 'unused',
    DATA_DIR: './data',
  });
  const authService = new AuthService(db, {
    sessionTtlDays: config.sessionTtlDays,
    now: () => clock,
  });
  await authService.setPassword(USERNAME, PASSWORD);

  app = buildApp({
    config,
    db,
    authService,
    secureCookies: false,
    now: () => clock,
  });
  await app.ready();

  service = new TransactionService(db, { now: () => clock });
  cookie = await login();
});

afterEach(async () => {
  await app.close();
  closeDatabase(db);
});

describe('bill purpose DTO and create', () => {
  it('adds nullable purpose/revision 0 without a resolution field', async () => {
    const created = await createExpense();
    expect(created['financialPurpose']).toBeNull();
    expect(created['financialPurposeRevision']).toBe(0);
    expect('resolution' in created).toBe(false);
  });

  it('stores an explicit purpose atomically with the bill and its create event', async () => {
    const created = await createExpense({ financialPurpose: 'essentials' });
    expect(created['financialPurpose']).toBe('essentials');
    expect(created['financialPurposeRevision']).toBe(1);

    const events = purposeEvents(created.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      revision: 1,
      purpose: 'essentials',
      reason: 'create',
    });
    expect(events[0]?.actor_id).toBeTruthy();
  });

  it('rejects a non-null purpose on income without writing the bill', async () => {
    const response = await post(
      createBody({ type: 1, categoryId: SALARY, financialPurpose: 'essentials' }),
    );
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'FINANCIAL_INVALID' } });
    const count = db.prepare('SELECT COUNT(*) AS c FROM transactions').get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('rejects an unknown purpose value', async () => {
    const response = await post(createBody({ financialPurpose: 'growth' }));
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'FINANCIAL_INVALID' } });
  });

  it('replays a purpose-bearing create with the same operationId without a duplicate', async () => {
    const operationId = randomUUID();
    const first = await post(
      createBody({ financialPurpose: 'joy', operationId }),
    );
    expect(first.statusCode).toBe(201);
    const second = await post(
      createBody({ financialPurpose: 'joy', operationId }),
    );
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    const count = db.prepare('SELECT COUNT(*) AS c FROM transactions').get() as { c: number };
    expect(count.c).toBe(1);
  });
});

describe('bill purpose explicit edit', () => {
  it('sets, edits, no-ops, clears and preserves across unrelated patches', async () => {
    const created = await createExpense();

    const set = await patch(created.id, {
      financialPurpose: 'essentials',
      operationId: randomUUID(),
      expectedFinancialPurposeRevision: 0,
      expectedTransactionToken: tokenFor(created.id),
    });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toMatchObject({
      financialPurpose: 'essentials',
      financialPurposeRevision: 1,
    });

    // Omitted on an unrelated patch: keep the override and revision.
    const noteOnly = await patch(created.id, { note: 'changed note' });
    expect(noteOnly.statusCode).toBe(200);
    expect(noteOnly.json()).toMatchObject({
      note: 'changed note',
      financialPurpose: 'essentials',
      financialPurposeRevision: 1,
    });

    const edit = await patch(created.id, {
      financialPurpose: 'joy',
      operationId: randomUUID(),
      expectedFinancialPurposeRevision: 1,
      expectedTransactionToken: tokenFor(created.id),
    });
    expect(edit.statusCode).toBe(200);
    expect(edit.json()).toMatchObject({
      financialPurpose: 'joy',
      financialPurposeRevision: 2,
    });

    // Same value is a no-op: revision and event history stay untouched.
    const noop = await patch(created.id, {
      financialPurpose: 'joy',
      operationId: randomUUID(),
      expectedFinancialPurposeRevision: 2,
      expectedTransactionToken: tokenFor(created.id),
    });
    expect(noop.statusCode).toBe(200);
    expect(noop.json()).toMatchObject({
      financialPurpose: 'joy',
      financialPurposeRevision: 2,
    });

    const clear = await patch(created.id, {
      financialPurpose: null,
      operationId: randomUUID(),
      expectedFinancialPurposeRevision: 2,
      expectedTransactionToken: tokenFor(created.id),
    });
    expect(clear.statusCode).toBe(200);
    expect(clear.json()).toMatchObject({
      financialPurpose: null,
      financialPurposeRevision: 3,
    });

    expect(purposeEvents(created.id).map((event) => event.purpose)).toEqual([
      'essentials',
      'joy',
      null,
    ]);
  });

  it('requires operationId, expected revision and token for an explicit purpose patch', async () => {
    const created = await createExpense();
    const missingAll = await patch(created.id, { financialPurpose: 'essentials' });
    expect(missingAll.statusCode).toBe(400);
    expect(missingAll.json()).toMatchObject({ error: { code: 'FINANCIAL_INVALID' } });

    const partial = await patch(created.id, {
      financialPurpose: 'essentials',
      operationId: randomUUID(),
    });
    expect(partial.statusCode).toBe(400);
    expect(partial.json()).toMatchObject({ error: { code: 'FINANCIAL_INVALID' } });
  });

  it('rejects guard fields without an explicit purpose', async () => {
    const created = await createExpense();
    const response = await patch(created.id, { operationId: randomUUID() });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'FINANCIAL_INVALID' } });
  });

  it('returns FINANCIAL_REVISION_CONFLICT on a stale purpose revision and leaves no event', async () => {
    const created = await createExpense();
    const operationId = randomUUID();
    const first = await patch(created.id, {
      financialPurpose: 'essentials',
      operationId,
      expectedFinancialPurposeRevision: 0,
      expectedTransactionToken: tokenFor(created.id),
    });
    expect(first.statusCode).toBe(200);

    const stale = await patch(created.id, {
      financialPurpose: 'joy',
      operationId: randomUUID(),
      expectedFinancialPurposeRevision: 0,
      expectedTransactionToken: tokenFor(created.id),
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: { code: 'FINANCIAL_REVISION_CONFLICT' } });
    expect(purposeEvents(created.id)).toHaveLength(1);
  });

  it('returns FINANCIAL_SOURCE_CHANGED on a stale transaction token', async () => {
    const created = await createExpense();
    const staleToken = tokenFor(created.id);
    const amountChange = await patch(created.id, { amountCents: 25_00 });
    expect(amountChange.statusCode).toBe(200);

    const response = await patch(created.id, {
      financialPurpose: 'essentials',
      operationId: randomUUID(),
      expectedFinancialPurposeRevision: 0,
      expectedTransactionToken: staleToken,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'FINANCIAL_SOURCE_CHANGED' } });
    expect(purposeEvents(created.id)).toHaveLength(0);
  });

  it('replays the stored response before re-validating a now-stale token', async () => {
    const created = await createExpense();
    const operationId = randomUUID();
    const payload = {
      financialPurpose: 'essentials',
      operationId,
      expectedFinancialPurposeRevision: 0,
      expectedTransactionToken: tokenFor(created.id),
    };
    const first = await patch(created.id, payload);
    expect(first.statusCode).toBe(200);

    // Make the original request's token/revision stale.
    const later = await patch(created.id, { amountCents: 30_00 });
    expect(later.statusCode).toBe(200);

    const replay = await patch(created.id, payload);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    // The replay did not run the ledger write a second time.
    expect(service.getByIdOrThrow(created.id).amountCents).toBe(30_00);
  });

  it('returns FINANCIAL_OPERATION_MISMATCH when the same operationId carries different facts', async () => {
    const created = await createExpense();
    const operationId = randomUUID();
    const first = await patch(created.id, {
      financialPurpose: 'essentials',
      operationId,
      expectedFinancialPurposeRevision: 0,
      expectedTransactionToken: tokenFor(created.id),
    });
    expect(first.statusCode).toBe(200);

    const mismatch = await patch(created.id, {
      financialPurpose: 'joy',
      operationId,
      expectedFinancialPurposeRevision: 1,
      expectedTransactionToken: tokenFor(created.id),
    });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json()).toMatchObject({ error: { code: 'FINANCIAL_OPERATION_MISMATCH' } });
  });
});

describe('type change clears an expense-only purpose', () => {
  it('clears with a type-change audit when type becomes income', async () => {
    const created = await createExpense({ financialPurpose: 'essentials' });
    const response = await patch(created.id, { type: 1, categoryId: SALARY });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      type: 1,
      financialPurpose: null,
      financialPurposeRevision: 2,
    });
    expect(purposeEvents(created.id).at(-1)).toMatchObject({
      revision: 2,
      purpose: null,
      reason: 'type-change',
    });
  });

  it('prepareUpdate mirrors the income transition without writing', () => {
    const created = service.create(createBody({ financialPurpose: 'joy' })) as unknown as {
      id: string;
    };
    const before = service.getByIdOrThrow(created.id);
    const prepared = service.prepareUpdate(created.id, { type: 1, categoryId: SALARY });
    expect(prepared.type).toBe(1);
    expect(prepared.financialPurpose).toBeNull();
    expect(service.getByIdOrThrow(created.id)).toEqual(before);
  });
});

describe('purpose store raw helpers', () => {
  it('read/write aliases keep revision stable on a no-op and append on change', () => {
    const created = service.create(createBody()) as unknown as { id: string };
    expect(readBillPurposeFacts(db, created.id)).toMatchObject({
      financialPurpose: null,
      revision: 0,
    });

    const first = db.transaction(() =>
      writeBillPurposeOverride(db, {
        transactionId: created.id,
        purpose: 'essentials',
        expectedRevision: 0,
        reason: 'create',
        operationId: null,
        actorId: null,
        now: clock,
      }),
    )();
    expect(first).toEqual({ revision: 1, financialPurpose: 'essentials' });

    const noop = db.transaction(() =>
      writeBillPurposeOverride(db, {
        transactionId: created.id,
        purpose: 'essentials',
        expectedRevision: 1,
        reason: 'explicit-edit',
        operationId: null,
        actorId: null,
        now: clock,
      }),
    )();
    expect(noop).toEqual({ revision: 1, financialPurpose: 'essentials' });
    expect(purposeEvents(created.id)).toHaveLength(1);
  });

  it('treats corrupt persisted facts as FINANCIAL_UNAVAILABLE', () => {
    const created = service.create(createBody()) as unknown as { id: string };
    db.prepare('UPDATE transactions SET financial_purpose_revision = -1 WHERE id = ?').run(
      created.id,
    );
    expect(() => readBillPurposeFacts(db, created.id)).toThrowError(
      expect.objectContaining({ statusCode: 503, code: 'FINANCIAL_UNAVAILABLE' }),
    );
  });
});

describe('financial transaction token', () => {
  it('is deterministic and changes when source facts change', () => {
    const base = {
      id: 'tx-1',
      type: 0,
      amountCents: 1000,
      categoryId: FOOD,
      accountId: ACCOUNT,
      date: NOW,
      isRefund: false,
      deleted: false,
    };
    expect(financialTransactionToken(base)).toBe(financialTransactionToken({ ...base }));
    expect(financialTransactionToken(base)).toHaveLength(64);
    expect(financialTransactionToken({ ...base, amountCents: 1001 })).not.toBe(
      financialTransactionToken(base),
    );
    expect(financialTransactionToken({ ...base, isRefund: true })).not.toBe(
      financialTransactionToken(base),
    );
    expect(financialTransactionToken({ ...base, deleted: true })).not.toBe(
      financialTransactionToken(base),
    );
  });
});

describe('refund split lifecycle hooks', () => {
  it('rolls back the bill and refund facts when the purpose audit write fails', async () => {
    const created = await createExpense({ financialPurpose: 'essentials' });
    const refund = await createExpense({
      type: 1,
      categoryId: SALARY,
      isRefund: true,
      refundLinkedTxIds: [created.id],
    });
    insertActiveSplit(refund.id, created.id);

    const snapshot = () => ({
      transactions: db.prepare('SELECT * FROM transactions ORDER BY id').all(),
      links: db.prepare('SELECT * FROM refund_links ORDER BY refund_tx_id, original_tx_id').all(),
      splits: db.prepare('SELECT * FROM financial_refund_splits ORDER BY id').all(),
      sets: db.prepare('SELECT * FROM financial_refund_split_sets ORDER BY id').all(),
      purposeEvents: db.prepare('SELECT * FROM financial_bill_purpose_events ORDER BY id').all(),
      operations: db.prepare('SELECT * FROM financial_operations ORDER BY operation_id').all(),
    });
    const before = snapshot();
    expect(before.transactions).toHaveLength(2);
    expect(before.links).toHaveLength(1);
    expect(before.splits).toHaveLength(1);
    expect(before.sets).toHaveLength(1);
    expect(before.purposeEvents).toHaveLength(1);

    // The audit insert follows the ledger update and whole-set invalidation.
    db.exec(`CREATE TRIGGER fail_purpose_audit BEFORE INSERT ON financial_bill_purpose_events
      BEGIN SELECT RAISE(ABORT, 'injected purpose audit failure'); END`);
    const input = {
      type: 1,
      categoryId: SALARY,
      financialPurpose: null,
      operationId: randomUUID(),
      expectedFinancialPurposeRevision: 1,
      expectedTransactionToken: tokenFor(created.id),
    };
    expect(() => service.update(created.id, input)).toThrow('injected purpose audit failure');
    expect(snapshot()).toEqual(before);

    // The failed operation did not consume its key; the same update can commit.
    db.exec('DROP TRIGGER fail_purpose_audit');
    expect(service.update(created.id, input)).toMatchObject({
      type: 1,
      financialPurpose: null,
      financialPurposeRevision: 2,
    });
    expect(splitState(refund.id)).toEqual({ state: 'invalidated', invalid_reason: 'type-change' });
  });

  it('invalidates the whole set on an amount change without touching legacy links', async () => {
    const created = await createExpense({ financialPurpose: 'essentials' });
    const refund = await createExpense({
      type: 1,
      categoryId: SALARY,
      isRefund: true,
      refundLinkedTxIds: [created.id],
    });
    insertActiveSplit(refund.id, created.id);

    const response = await patch(created.id, { amountCents: 25_00 });
    expect(response.statusCode).toBe(200);
    expect(splitState(refund.id)).toEqual({
      state: 'invalidated',
      invalid_reason: 'amount-change',
    });
    // Existing legacy link behavior is unchanged by a plain amount edit.
    expect(service.getRefundsForExpense(created.id)).toEqual([refund.id]);
  });

  it('invalidates on type change and clears the purpose in one transaction', async () => {
    const created = await createExpense({ financialPurpose: 'essentials' });
    const refund = await createExpense({
      type: 1,
      categoryId: SALARY,
      isRefund: true,
      refundLinkedTxIds: [created.id],
    });
    insertActiveSplit(refund.id, created.id);

    const response = await patch(created.id, { type: 1, categoryId: SALARY });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      financialPurpose: null,
      financialPurposeRevision: 2,
    });
    expect(splitState(refund.id)).toEqual({
      state: 'invalidated',
      invalid_reason: 'type-change',
    });
  });

  it('delete invalidates, restore does not reactivate, purge tombstones and detaches', async () => {
    const created = await createExpense({ financialPurpose: 'joy' });
    const refund = await createExpense({
      type: 1,
      categoryId: SALARY,
      isRefund: true,
      refundLinkedTxIds: [created.id],
    });
    insertActiveSplit(refund.id, created.id);

    service.softDelete(created.id);
    expect(splitState(refund.id)).toEqual({
      state: 'invalidated',
      invalid_reason: 'delete',
    });
    expect(service.getRefundsForExpense(created.id)).toEqual([]);

    service.restore(created.id);
    expect(splitState(refund.id)?.state).toBe('invalidated');
    // Restoring the original does not reproduce the deleted legacy link.
    expect(service.getRefundsForExpense(created.id)).toEqual([]);
    expect(service.getByIdOrThrow(created.id).financialPurpose).toBe('joy');

    service.softDelete(created.id);
    service.purge(created.id);
    expect(splitState(refund.id)).toBeUndefined();
    const purged = db
      .prepare(
        "SELECT COUNT(*) AS c FROM financial_refund_split_sets WHERE refund_tx_id = ? AND status = 'purged'",
      )
      .get(refund.id) as { c: number };
    expect(purged.c).toBe(1);
  });

  it('restoreAll invalidates stale active sets for every restored id', async () => {
    const first = await createExpense();
    const second = await createExpense({ categoryId: TRANSPORT });
    const refund = await createExpense({
      type: 1,
      categoryId: SALARY,
      isRefund: true,
      refundLinkedTxIds: [first.id, second.id],
    });
    service.softDelete(first.id);
    service.softDelete(second.id);

    // Simulate an old/partial active set that survived a delete.
    insertActiveSplit(refund.id, first.id, 300);
    insertActiveSplit(refund.id, second.id, 200);

    const restored = service.restoreAll();
    expect(restored).toBe(2);
    expect(splitState(refund.id)).toEqual({
      state: 'invalidated',
      invalid_reason: 'restore',
    });
  });

  it('purgeAll handles more than 5000 ids and tombstones the split set', () => {
    const insert = db.prepare(
      `INSERT INTO transactions
         (id, type, amount_cents, category_id, account_id, date, note, tags_json, is_refund, deleted, updated_at)
       VALUES (?, 0, 100, ?, ?, ?, '', '[]', 0, 1, ?)`,
    );
    const insertMany = db.transaction(() => {
      for (let index = 0; index < 5010; index++) {
        insert.run(`bulk-${index}`, FOOD, ACCOUNT, NOW, clock);
      }
    });
    insertMany();

    const refundId = 'bulk-refund';
    db.prepare(
      `INSERT INTO transactions
         (id, type, amount_cents, category_id, account_id, date, note, tags_json, is_refund, deleted, updated_at)
       VALUES (?, 1, 500, ?, ?, ?, '', '[]', 1, 0, ?)`,
    ).run(refundId, SALARY, ACCOUNT, NOW, clock);
    insertActiveSplit(refundId, 'bulk-0', 500);

    expect(service.purgeAll()).toBe(5010);
    const left = db.prepare('SELECT COUNT(*) AS c FROM transactions').get() as { c: number };
    expect(left.c).toBe(1); // the live refund row survives; deleted bills are gone.
    expect(splitState(refundId)).toBeUndefined();
    const purged = db
      .prepare(
        "SELECT COUNT(*) AS c FROM financial_refund_split_sets WHERE refund_tx_id = ? AND status = 'purged'",
      )
      .get(refundId) as { c: number };
    expect(purged.c).toBe(1);
  });
});
