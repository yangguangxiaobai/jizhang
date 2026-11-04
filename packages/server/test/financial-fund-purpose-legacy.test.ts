import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { closeDatabase, initializeDatabase, type Db } from '../src/db/index.js';
import { SESSION_COOKIE } from '../src/plugins/auth.js';
import { AuthService } from '../src/services/auth-service.js';
import { financialTransactionToken } from '../src/services/financial-purpose-store.js';
import { hashFinancialOperation } from '../src/services/financial-operation-store.js';
import { FinancialPlanningService } from '../src/services/financial-planning-service.js';
import { TransactionService, type TransactionDto } from '../src/services/transaction-service.js';

const NOW = Date.UTC(2026, 8, 11);
const BASE = '/api/v1/financial-planning/bill-purposes';
const input = { type: 0, amountCents: 1999, categoryId: 'builtin-expense-food', accountId: 'builtin-default-account', date: NOW };
let db: Db;
let app: FastifyInstance;
let service: TransactionService;
let headers: { cookie: string; 'x-requested-with': string };

function events(id: string) {
  return db.prepare('SELECT revision,purpose,source,operation_id FROM financial_fund_purpose_events WHERE transaction_id=? ORDER BY revision').all(id);
}
function token(row: TransactionDto): string {
  return financialTransactionToken({ ...row, deleted: false });
}
async function put(id: string, payload: Record<string, unknown>) {
  return app.inject({ method: 'PUT', url: `${BASE}/${id}`, headers, payload });
}
function legacyInput(row: TransactionDto, financialPurpose: string | null) {
  return { financialPurpose, operationId: randomUUID(), expectedRevision: row.financialPurposeRevision, expectedTransactionToken: token(row) };
}
beforeEach(async () => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeDatabase(db, null);
  const config = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', JIZHANG_USERNAME: 'test', JIZHANG_PASSWORD_HASH: 'unused', DATA_DIR: './data' });
  const authService = new AuthService(db, { sessionTtlDays: config.sessionTtlDays, now: () => NOW });
  await authService.setPassword('test', 'correct horse battery staple');
  app = buildApp({ config, db, authService, secureCookies: false, now: () => NOW });
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { 'x-requested-with': 'fetch' }, payload: { username: 'test', password: 'correct horse battery staple' } });
  const session = login.cookies.find((item) => item.name === SESSION_COOKIE);
  if (!session) throw new Error('Missing test session');
  headers = { cookie: `${SESSION_COOKIE}=${session.value}`, 'x-requested-with': 'fetch' };
  service = new TransactionService(db, { now: () => NOW });
});
afterEach(async () => { await app.close(); closeDatabase(db); });

describe('legacy bill-purpose endpoint canonical integration', () => {
  it('writes the canonical purpose and clear events with the legacy override', async () => {
    const row = service.create(input);
    const result = await put(row.id, legacyInput(row, 'joy'));
    expect(result.statusCode, result.body).toBe(200);
    expect(service.getById(row.id)).toMatchObject({ financialPurpose: 'joy', fundPurpose: 'joy', fundPurposeRevision: 1, fundPurposeSource: 'legacy-override' });
    expect(events(row.id)).toMatchObject([{ revision: 1, purpose: 'joy', source: 'legacy-override' }]);
    const view = await app.inject({ method: 'GET', url: `${BASE}/${row.id}`, headers });
    expect(view.statusCode).toBe(200);
    expect(view.json()).toMatchObject({ billPurpose: { financialPurpose: 'joy', fundPurpose: 'joy', fundPurposeRevision: 1, fundPurposeSource: 'legacy-override', fundPurposeStatus: 'resolved' } });
    const next = service.getByIdOrThrow(row.id);
    const clear = await put(row.id, legacyInput(next, null));
    expect(clear.statusCode, clear.body).toBe(200);
    expect(service.getById(row.id)).toMatchObject({ financialPurpose: null, fundPurpose: null, fundPurposeRevision: 2, fundPurposeStatus: 'unresolved' });
    expect(events(row.id)).toMatchObject([{ purpose: 'joy' }, { purpose: null }]);
  });
  it('treats an explicit legacy clear as distinct from a migrated category mapping', async () => {
    const row = service.create(input);
    db.prepare("INSERT INTO financial_fund_purposes VALUES (?, 'joy', 1, 'legacy-mapping', '{}')").run(row.id);
    db.prepare("INSERT INTO financial_fund_purpose_events VALUES (?, 1, 'joy', 'legacy-mapping', '{}', NULL, NULL, ?)").run(row.id, NOW);
    const cleared = await put(row.id, legacyInput(row, null));
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(service.getById(row.id)).toMatchObject({ financialPurpose: null, fundPurpose: null, fundPurposeRevision: 2, fundPurposeSource: 'legacy-override' });
    expect(events(row.id)).toMatchObject([{ purpose: 'joy', source: 'legacy-mapping' }, { purpose: null, source: 'legacy-override' }]);
    const same = await put(row.id, legacyInput(service.getByIdOrThrow(row.id), null));
    expect(same.statusCode, same.body).toBe(200);
    expect(events(row.id)).toHaveLength(2);
  });
  it('requires canonical CAS after four-purpose edits and preserves its safety latch', async () => {
    const initial = service.create({ ...input, fundPurpose: 'growth' });
    const updated = service.update(initial.id, { fundPurpose: 'reserve', operationId: randomUUID(), expectedFundPurposeRevision: initial.fundPurposeRevision, expectedTransactionToken: token(initial) });
    const payload = legacyInput(initial, 'joy');
    const stale = await put(initial.id, payload);
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: { code: 'FINANCIAL_REVISION_CONFLICT' } });
    expect(service.getById(initial.id)).toMatchObject({ fundPurpose: 'reserve', fundPurposeRevision: 2 });
    const invalidCas = await put(initial.id, { ...payload, operationId: randomUUID(), expectedFundPurposeRevision: 1 });
    expect(invalidCas.statusCode).toBe(409);
    const accepted = await put(initial.id, { ...payload, operationId: randomUUID(), expectedFundPurposeRevision: updated.fundPurposeRevision });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(service.getById(initial.id)).toMatchObject({ fundPurpose: 'joy', fundPurposeSource: 'explicit' });
    const current = service.getByIdOrThrow(initial.id);
    expect((await put(current.id, legacyInput(current, null))).statusCode).toBe(409);
  });
  it('rejects a stale canonical PATCH after a legacy endpoint edit', async () => {
    const row = service.create(input);
    expect((await put(row.id, legacyInput(row, 'joy'))).statusCode).toBe(200);
    expect(() => service.update(row.id, { fundPurpose: 'growth', operationId: randomUUID(), expectedFundPurposeRevision: row.fundPurposeRevision, expectedTransactionToken: token(row) })).toThrow();
    expect(service.getById(row.id)).toMatchObject({ fundPurpose: 'joy', fundPurposeRevision: 1 });
    expect(events(row.id)).toHaveLength(1);
  });
  it('replays the exact original response after source changes or purge', async () => {
    const row = service.create(input);
    const payload = legacyInput(row, 'essentials');
    const first = await put(row.id, payload);
    expect(first.statusCode, first.body).toBe(200);
    service.update(row.id, { amountCents: 2100 });
    const replay = await put(row.id, payload);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()).toEqual(first.json());
    service.softDelete(row.id);
    service.purge(row.id);
    const afterPurge = await put(row.id, payload);
    expect(afterPurge.statusCode, afterPurge.body).toBe(200);
    expect(afterPurge.json()).toEqual(first.json());
    const mismatch = await put(row.id, { ...payload, financialPurpose: 'joy' });
    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json()).toMatchObject({ error: { code: 'FINANCIAL_OPERATION_MISMATCH' } });
    expect(events(row.id)).toHaveLength(1);
  });
  it('rolls back both purpose stores and operation when canonical event insertion fails', async () => {
    const row = service.create(input);
    const payload = legacyInput(row, 'joy');
    db.exec("CREATE TRIGGER fail_legacy_fund_event BEFORE INSERT ON financial_fund_purpose_events BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    const failed = await put(row.id, payload);
    expect(failed.statusCode).toBe(500);
    expect(service.getById(row.id)).toMatchObject({ financialPurpose: null, financialPurposeRevision: 0, fundPurpose: null, fundPurposeRevision: 0 });
    expect(events(row.id)).toHaveLength(0);
    expect(db.prepare('SELECT 1 FROM financial_bill_purpose_events WHERE transaction_id=?').get(row.id)).toBeUndefined();
    expect(db.prepare('SELECT 1 FROM financial_operations WHERE operation_id=?').get(payload.operationId)).toBeUndefined();
    db.exec('DROP TRIGGER fail_legacy_fund_event');
    const retry = await put(row.id, payload);
    expect(retry.statusCode, retry.body).toBe(200);
    expect(service.getById(row.id)).toMatchObject({ financialPurpose: 'joy', fundPurpose: 'joy' });
  });
  it('replays a pre-upgrade operation without adding new fields or repairing its old facts', async () => {
    const row = service.create(input);
    const request = legacyInput(row, 'joy');
    const actor = db.prepare('SELECT id FROM users ORDER BY created_at,id LIMIT 1').get() as { id: string };
    const path = `${BASE}/${row.id}`;
    const oldResponse = { billPurpose: { transactionId: row.id, revision: 1, financialPurpose: 'joy' }, affectedPeriodIds: [] };
    const hash = hashFinancialOperation('PUT', path, { expectedRevision: request.expectedRevision, expectedTransactionToken: request.expectedTransactionToken, financialPurpose: request.financialPurpose });
    db.prepare('INSERT INTO financial_operations (operation_id,actor_id,method,resource,request_hash,status_code,response_json,committed_at) VALUES (?,?,?,?,?,200,?,?)')
      .run(request.operationId, actor.id, 'PUT', path, hash, JSON.stringify(oldResponse), NOW);
    service.softDelete(row.id);
    const replay = await put(row.id, request);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()).toEqual(oldResponse);
    expect(events(row.id)).toHaveLength(0);
    expect(db.prepare('SELECT 1 FROM financial_fund_purposes WHERE transaction_id=?').get(row.id)).toBeUndefined();
  });
  it('refuses replay by another actor', () => {
    const row = service.create(input);
    const request = legacyInput(row, 'joy');
    const one = new FinancialPlanningService(db, { now: () => NOW, actorId: 'actor-a' });
    const two = new FinancialPlanningService(db, { now: () => NOW, actorId: 'actor-b' });
    one.putBillPurpose(row.id, request);
    expect(() => two.putBillPurpose(row.id, request)).toThrowError(/operationId/);
    expect(events(row.id)).toHaveLength(1);
  });
});
