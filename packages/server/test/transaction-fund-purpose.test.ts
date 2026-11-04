import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initializeDatabase, type Db } from '../src/db/index.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { SESSION_COOKIE } from '../src/plugins/auth.js';
import { AuthService } from '../src/services/auth-service.js';
import { financialTransactionToken } from '../src/services/financial-purpose-store.js';
import { readFundSummary } from '../src/services/financial-fund-summary.js';
import { TransactionService, type TransactionDto } from '../src/services/transaction-service.js';

const NOW = Date.UTC(2026, 8, 11);
let db: Db;
let service: TransactionService;
const base = { type: 0, amountCents: 1999, categoryId: 'builtin-expense-food', accountId: 'builtin-default-account', date: NOW };
function token(row: TransactionDto): string {
  return financialTransactionToken({ ...row, deleted: false });
}
function patchPurpose(row: TransactionDto, fundPurpose: unknown, operationId = randomUUID()) {
  return { fundPurpose, operationId, expectedFundPurposeRevision: row.fundPurposeRevision, expectedTransactionToken: token(row) };
}
function events(id: string) {
  return db.prepare('SELECT revision,purpose,source,actor_id,operation_id FROM financial_fund_purpose_events WHERE transaction_id=? ORDER BY revision').all(id);
}
beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeDatabase(db, null);
  service = new TransactionService(db, { now: () => NOW, actorId: 'test-actor' });
});
afterEach(() => closeDatabase(db));

describe('canonical fund purpose on ordinary transactions', () => {
  it('round-trips and validates canonical fields through authenticated HTTP routes', async () => {
    const config = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', JIZHANG_USERNAME: 'test', JIZHANG_PASSWORD_HASH: 'unused', DATA_DIR: './data' });
    const authService = new AuthService(db, { sessionTtlDays: config.sessionTtlDays, now: () => NOW });
    await authService.setPassword('test', 'correct horse battery staple');
    const app = buildApp({ config, db, authService, secureCookies: false, now: () => NOW });
    try {
      const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { 'x-requested-with': 'fetch' }, payload: { username: 'test', password: 'correct horse battery staple' } });
      const session = login.cookies.find((cookie) => cookie.name === SESSION_COOKIE);
      expect(session).toBeDefined();
      const headers = { cookie: `${SESSION_COOKIE}=${session!.value}`, 'x-requested-with': 'fetch' };
      const created = await app.inject({ method: 'POST', url: '/api/v1/transactions', headers, payload: { ...base, fundPurpose: 'growth' } });
      expect(created.statusCode).toBe(201);
      const row = created.json() as TransactionDto;
      expect(row).toMatchObject({ fundPurpose: 'growth', fundPurposeRevision: 1 });
      const read = await app.inject({ method: 'GET', url: `/api/v1/transactions/${row.id}`, headers });
      expect(read.json()).toMatchObject({ fundPurpose: 'growth', fundPurposeRevision: 1 });
      const changed = await app.inject({ method: 'PATCH', url: `/api/v1/transactions/${row.id}`, headers, payload: patchPurpose(row, 'reserve') });
      expect(changed.statusCode).toBe(200);
      expect(changed.json()).toMatchObject({ fundPurpose: 'reserve', fundPurposeRevision: 2 });
      const bad = await app.inject({ method: 'POST', url: '/api/v1/transactions', headers, payload: { ...base, fundPurpose: 'reserve', financialPurpose: 'joy' } });
      expect(bad.statusCode).toBe(400);
      expect(bad.json()).toMatchObject({ error: { code: 'FINANCIAL_INVALID' } });
      const stale = await app.inject({ method: 'PATCH', url: `/api/v1/transactions/${row.id}`, headers, payload: patchPurpose(row, 'joy') });
      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toMatchObject({ error: { code: 'FINANCIAL_REVISION_CONFLICT' } });
    } finally { await app.close(); }
  });
  it.each(['growth', 'reserve', 'essentials', 'joy'])('round-trips %s through create, reads and PATCH', (purpose) => {
    const created = service.create({ ...base, fundPurpose: purpose });
    expect(created).toMatchObject({ fundPurpose: purpose, fundPurposeRevision: 1, fundPurposeStatus: 'resolved', fundPurposeSource: 'explicit' });
    expect(service.getById(created.id)).toMatchObject({ fundPurpose: purpose });
    expect(service.list().items[0]).toMatchObject({ fundPurpose: purpose });
    const changed = service.update(created.id, { note: 'changed' });
    expect(changed).toMatchObject({ fundPurpose: purpose, fundPurposeRevision: 1 });
    expect(events(created.id)).toHaveLength(1);
    const cleared = service.update(created.id, patchPurpose(changed, null));
    expect(cleared).toMatchObject({ fundPurpose: null, fundPurposeRevision: 2, fundPurposeStatus: 'unresolved', fundPurposeSource: 'explicit' });
    expect(events(created.id)).toMatchObject([{ revision: 1, purpose }, { revision: 2, purpose: null }]);
  });
  it('preserves unassigned omission and records an explicit null', () => {
    const created = service.create(base);
    expect(created).toMatchObject({ fundPurpose: null, fundPurposeRevision: 0, fundPurposeStatus: 'unresolved' });
    const cleared = service.update(created.id, patchPurpose(created, null));
    expect(cleared).toMatchObject({ fundPurpose: null, fundPurposeRevision: 1, fundPurposeSource: 'explicit' });
    expect(events(created.id)).toHaveLength(1);
  });
  it('translates legacy writes and rejects contradictory simultaneous fields atomically', () => {
    const legacy = service.create({ ...base, financialPurpose: 'joy' });
    expect(legacy).toMatchObject({ fundPurpose: 'joy', financialPurpose: 'joy' });
    expect(() => service.create({ ...base, financialPurpose: 'joy', fundPurpose: 'growth' })).toThrow();
    expect(() => service.update(legacy.id, { ...patchPurpose(legacy, 'growth'), financialPurpose: 'joy', expectedFinancialPurposeRevision: legacy.financialPurposeRevision })).toThrow();
    expect(service.getById(legacy.id)).toMatchObject({ fundPurpose: 'joy', financialPurpose: 'joy' });
    expect(events(legacy.id)).toHaveLength(1);
  });
  it('supports ordinary income, but a refund cannot receive a fresh independent purpose', () => {
    const income = service.create({ ...base, type: 1, categoryId: 'builtin-income-salary', fundPurpose: 'reserve' });
    expect(income).toMatchObject({ fundPurpose: 'reserve', financialPurpose: null });
    expect(readFundSummary(db, NOW).totals.income.reserve).toBe(1999);
    const refund = service.update(income.id, { isRefund: true });
    expect(refund).toMatchObject({ isRefund: true, fundPurpose: 'reserve' });
    expect(readFundSummary(db, NOW).totals.income.reserve).toBe(0);
    expect(() => service.update(refund.id, patchPurpose(refund, 'joy'))).toThrow();
  });
  it.each(['growth', 'reserve', 'essentials', 'joy'])('sets %s using guarded PATCH', (purpose) => {
    const initial = service.create(base);
    const changed = service.update(initial.id, patchPurpose(initial, purpose));
    expect(service.getById(initial.id)).toMatchObject({ fundPurpose: purpose, fundPurposeRevision: 1 });
    const noop = service.update(initial.id, patchPurpose(changed, purpose));
    expect(noop.fundPurposeRevision).toBe(1);
    expect(events(initial.id)).toHaveLength(1);
  });
  it('rolls back the ledger, canonical fact and operation when the event insert fails', () => {
    const row = service.create({ ...base, fundPurpose: 'growth' });
    db.exec("CREATE TRIGGER fail_fund_event BEFORE INSERT ON financial_fund_purpose_events BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    const operationId = randomUUID();
    expect(() => service.update(row.id, { ...patchPurpose(row, 'reserve', operationId), note: 'not committed' })).toThrow();
    expect(service.getById(row.id)).toMatchObject({ fundPurpose: 'growth', fundPurposeRevision: 1, note: '' });
    expect(events(row.id)).toHaveLength(1);
    expect(db.prepare('SELECT 1 FROM financial_operations WHERE operation_id=?').get(operationId)).toBeUndefined();
  });
  it('preserves purpose on deletion and restoration', () => {
    const row = service.create({ ...base, fundPurpose: 'reserve' });
    service.softDelete(row.id);
    expect(service.listDeleted()[0]).toMatchObject({ fundPurpose: 'reserve', fundPurposeRevision: 1 });
    expect(service.restore(row.id)).toMatchObject({ fundPurpose: 'reserve', fundPurposeRevision: 1 });
    expect(events(row.id)).toHaveLength(1);
  });
  it('rejects a stale legacy client after newer canonical growth-to-reserve decisions', () => {
    const start = service.create({ ...base, fundPurpose: 'growth' });
    const updated = service.update(start.id, patchPurpose(start, 'reserve'));
    expect(updated.financialPurposeRevision).toBe(start.financialPurposeRevision);
    const legacy = { financialPurpose: 'joy', operationId: randomUUID(), expectedFinancialPurposeRevision: start.financialPurposeRevision, expectedTransactionToken: token(start) };
    expect(() => service.update(start.id, legacy)).toThrow();
    expect(service.getById(start.id)).toMatchObject({ fundPurpose: 'reserve', fundPurposeRevision: 2 });
    expect(() => service.update(start.id, { ...legacy, operationId: randomUUID(), expectedFundPurposeRevision: 1 })).toThrow();
    const acknowledged = service.update(start.id, { ...legacy, operationId: randomUUID(), expectedFundPurposeRevision: 2 });
    expect(acknowledged).toMatchObject({ fundPurpose: 'joy', fundPurposeSource: 'explicit' });
    expect(() => service.update(start.id, { financialPurpose: null, operationId: randomUUID(), expectedFinancialPurposeRevision: acknowledged.financialPurposeRevision, expectedTransactionToken: token(acknowledged) })).toThrow();
  });
  it('preserves old clients ability to edit legacy-origin decisions with their existing guard', () => {
    const start = service.create({ ...base, financialPurpose: 'joy' });
    expect(start.fundPurposeSource).toBe('legacy-override');
    const next = service.update(start.id, { financialPurpose: 'essentials', operationId: randomUUID(), expectedFinancialPurposeRevision: start.financialPurposeRevision, expectedTransactionToken: token(start) });
    expect(next).toMatchObject({ fundPurpose: 'essentials', fundPurposeSource: 'legacy-override' });
  });
  it('guards revision and token, and replays an exact keyed update only once', () => {
    const created = service.create({ ...base, fundPurpose: 'growth' });
    const operationId = randomUUID();
    const body = patchPurpose(created, 'reserve', operationId);
    const updated = service.update(created.id, body);
    expect(service.update(created.id, body)).toEqual(updated);
    expect(() => service.update(created.id, { ...body, fundPurpose: 'joy' })).toThrow();
    expect(() => service.update(created.id, patchPurpose(created, 'joy'))).toThrow();
    expect(events(created.id)).toHaveLength(2);
  });
});
