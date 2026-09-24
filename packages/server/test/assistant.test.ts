import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { closeDatabase, initializeDatabase, type Db } from '../src/db/index.js';
import { SESSION_COOKIE } from '../src/plugins/auth.js';
import { AuthService } from '../src/services/auth-service.js';
import { AiConfigService } from '../src/services/ai-config-service.js';
import { TransactionService } from '../src/services/transaction-service.js';
import { MasterDataService } from '../src/services/master-data-service.js';

const USERNAME = 'quiz';
const PASSWORD = 'correct horse battery staple';
const CSRF = { 'x-requested-with': 'fetch' };
const KEY = 'ab'.repeat(32);
const NOW = Date.UTC(2026, 8, 22, 12);
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const wechatBytes = readFileSync(join(FIXTURES, 'wechat-bill-sample.csv'));

let db: Db;
let app: FastifyInstance;
let cookie: string;
let providerEnvelope: unknown;
let scenario: 'transaction' | 'unknown' | 'custom' = 'transaction';
let customCall: { name: string; arguments: Record<string, unknown> } | undefined;
let testDataDir: string;

function authHeaders() {
  return { ...CSRF, Cookie: `${SESSION_COOKIE}=${cookie}` };
}

async function inject(method: 'GET' | 'POST' | 'DELETE', url: string, payload?: Record<string, unknown>) {
  return app.inject({ method, url, headers: authHeaders(), ...(payload === undefined ? {} : { payload }) });
}

function providerResponse(): Response {
  const toolCall = scenario === 'transaction'
    ? { name: 'transaction.create', arguments: { type: 'expense', amountCents: 2500, categoryId: 'builtin-expense-food', accountId: 'builtin-default-account', date: '2026-09-20', note: 'lunch' } }
    : scenario === 'custom'
      ? customCall
      : { name: 'database.drop', arguments: {} };
  providerEnvelope = { message: '请检查这笔支出。', toolCall };
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(providerEnvelope) } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
}

beforeEach(async () => {
  testDataDir = mkdtempSync(join(tmpdir(), 'assistant-test-'));
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeDatabase(db, null);
  const config = loadConfig({
    NODE_ENV: 'test', LOG_LEVEL: 'silent', JIZHANG_USERNAME: USERNAME,
    JIZHANG_PASSWORD_HASH: 'unused', JIZHANG_AI_ENCRYPTION_KEY: KEY, DATA_DIR: testDataDir,
  });
  const auth = new AuthService(db, { sessionTtlDays: config.sessionTtlDays, now: () => NOW });
  await auth.setPassword(USERNAME, PASSWORD);
  new AiConfigService(db, { aiEncryptionKey: KEY, production: false, now: () => NOW }).save({
    enabled: true,
    mode: 'chat-completions',
    name: 'assistant test provider',
    url: 'https://provider.example.test/v1/chat/completions',
    method: 'POST', model: 'test-model', timeoutMs: 10_000, headers: {}, auth: { kind: 'bearer' },
    bodyTemplate: null, responsePath: 'choices[0].message.content', secret: 'test-only-provider-secret',
  });
  scenario = 'transaction';
  customCall = undefined;
  providerEnvelope = undefined;
  app = buildApp({
    config, db, authService: auth, secureCookies: false, now: () => NOW,
    fetchImpl: async () => providerResponse(),
  });
  await app.ready();
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: CSRF, payload: { username: USERNAME, password: PASSWORD } });
  cookie = (login.cookies as { name: string; value: string }[]).find((item) => item.name === SESSION_COOKIE)?.value as string;
});

afterEach(async () => {
  await app.close();
  closeDatabase(db);
  rmSync(testDataDir, { recursive: true, force: true });
});

async function prepareTool(name: string, args: Record<string, unknown>) {
  scenario = 'custom';
  customCall = { name, arguments: args };
  const conversation = (await inject('POST', '/api/v1/assistant/conversations', {})).json();
  const response = await inject('POST', `/api/v1/assistant/conversations/${conversation.id}/messages`, { text: `prepare ${name}` });
  const item = response.json().items.at(-1);
  expect(item.kind, response.body).toBe('tool-card');
  return { conversationId: conversation.id as string, actionId: item.content.card.actionId as string, card: item.content.card };
}

async function confirmTool(actionId: string) {
  return inject('POST', `/api/v1/assistant/actions/${actionId}/confirm`, {});
}

describe('assistant authenticated routes and confirmation contract', () => {
  it('prepares a typed transaction card and creates exactly one transaction only after confirmation', async () => {
    const conversation = await inject('POST', '/api/v1/assistant/conversations', {});
    expect(conversation.statusCode).toBe(200);
    const id = conversation.json().id as string;
    const response = await inject('POST', `/api/v1/assistant/conversations/${id}/messages`, { text: '午饭花了 25 元', clientRequestId: 'request-1' });
    expect(response.statusCode).toBe(200);
    expect(response.json().items.at(-1).content.card).toMatchObject({ toolName: 'transaction.create', writes: true, status: 'pending' });
    expect((db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE deleted = 0').get() as { count: number }).count).toBe(0);

    const actionId = response.json().items.at(-1).content.card.actionId as string;
    const [confirmed, simultaneous] = await Promise.all([
      inject('POST', `/api/v1/assistant/actions/${actionId}/confirm`, {}),
      inject('POST', `/api/v1/assistant/actions/${actionId}/confirm`, {}),
    ]);
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(simultaneous.statusCode).toBe(200);
    expect(confirmed.json().action.status).toBe('confirmed');
    expect((db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE deleted = 0').get() as { count: number }).count).toBe(1);

    const repeated = await inject('POST', `/api/v1/assistant/actions/${actionId}/confirm`, {});
    expect(repeated.statusCode).toBe(200);
    expect((db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE deleted = 0').get() as { count: number }).count).toBe(1);
  });

  it('rejects an unknown provider tool without writes and persists only a bounded safe error', async () => {
    scenario = 'unknown';
    const conversation = (await inject('POST', '/api/v1/assistant/conversations', {})).json();
    const response = await inject('POST', `/api/v1/assistant/conversations/${conversation.id}/messages`, { text: 'do something unsafe' });
    expect(response.statusCode).toBe(200);
    expect(response.json().items.at(-1).kind).toBe('error');
    expect((db.prepare('SELECT COUNT(*) AS count FROM transactions').get() as { count: number }).count).toBe(0);
    const persisted = db.prepare('SELECT content_json FROM assistant_messages').all() as { content_json: string }[];
    expect(JSON.stringify(persisted)).not.toContain('database.drop');
  });

  it('previews a byte attachment, rejects a digest mismatch, validates selected rows, then imports once', async () => {
    const conversation = (await inject('POST', '/api/v1/assistant/conversations', {})).json();
    const file = {
      fileName: 'wechat-bill-sample.csv',
      source: 'auto',
      fileBase64: wechatBytes.toString('base64'),
    };
    const previewResponse = await inject('POST', `/api/v1/assistant/conversations/${conversation.id}/messages`, { text: '导入账单', attachment: file });
    expect(previewResponse.statusCode, previewResponse.body).toBe(200);
    const cardMessage = previewResponse.json().items.find((item: { content: { card?: unknown } }) => item.content.card !== undefined);
    const card = cardMessage.content.card as { actionId: string; preview: { rows: { id: string; ignored: boolean; alreadyExists: boolean }[] } };
    const selectedIds = card.preview.rows.filter((row) => !row.ignored && !row.alreadyExists).slice(0, 1).map((row) => row.id);
    expect(selectedIds.length).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE deleted = 0').get() as { count: number }).count).toBe(0);

    const mismatch = await inject('POST', `/api/v1/assistant/actions/${card.actionId}/confirm`, { fileBase64: Buffer.from('different').toString('base64'), selectedIds });
    expect(mismatch.statusCode).toBe(409);
    expect((db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE deleted = 0').get() as { count: number }).count).toBe(0);

    const refreshed = await inject('POST', `/api/v1/assistant/conversations/${conversation.id}/messages`, { text: '重新预览导入', attachment: file });
    const refreshedCard = refreshed.json().items.filter((item: { content: { card?: unknown } }) => item.content.card !== undefined).at(-1).content.card as { actionId: string };
    const invalidSelection = await inject('POST', `/api/v1/assistant/actions/${refreshedCard.actionId}/confirm`, { fileBase64: file.fileBase64, selectedIds: ['fabricated-row-id'] });
    expect(invalidSelection.statusCode).toBe(409);
    expect((db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE deleted = 0').get() as { count: number }).count).toBe(0);
    const refreshedAgain = await inject('POST', `/api/v1/assistant/conversations/${conversation.id}/messages`, { text: '确认正确行', attachment: file });
    const currentCard = refreshedAgain.json().items.filter((item: { content: { card?: unknown } }) => item.content.card !== undefined).at(-1).content.card as { actionId: string; preview: { rows: { id: string; ignored: boolean; alreadyExists: boolean }[] } };
    const currentSelectedIds = currentCard.preview.rows.filter((row) => !row.ignored && !row.alreadyExists).slice(0, 1).map((row) => row.id);
    const confirmed = await inject('POST', `/api/v1/assistant/actions/${currentCard.actionId}/confirm`, { fileBase64: file.fileBase64, selectedIds: currentSelectedIds });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().action.status).toBe('confirmed');
    expect((db.prepare('SELECT COUNT(*) AS count FROM transactions WHERE deleted = 0').get() as { count: number }).count).toBe(1);
    const rows = db.prepare('SELECT content_json FROM assistant_messages').all() as { content_json: string }[];
    expect(JSON.stringify(rows)).not.toContain(file.fileBase64);
  });

  it('previews transaction edits and soft delete/restore, then revalidates before each write', async () => {
    const service = new TransactionService(db, { now: () => NOW });
    const original = service.create({ type: 0, amountCents: 1800, categoryId: 'builtin-expense-food', accountId: 'builtin-default-account', date: Date.UTC(2026, 8, 19), note: 'before' });
    const edit = await prepareTool('transaction.update', { id: original.id, changes: { note: 'after', amountCents: 2100 } });
    expect(service.getByIdOrThrow(original.id)).toMatchObject({ note: 'before', amountCents: 1800 });
    const edited = await confirmTool(edit.actionId);
    expect(edited.statusCode).toBe(200);
    expect(service.getByIdOrThrow(original.id)).toMatchObject({ note: 'after', amountCents: 2100 });

    const deletion = await prepareTool('transaction.delete', { id: original.id });
    expect((db.prepare('SELECT deleted FROM transactions WHERE id = ?').get(original.id) as { deleted: number }).deleted).toBe(0);
    expect((await confirmTool(deletion.actionId)).statusCode).toBe(200);
    expect((db.prepare('SELECT deleted FROM transactions WHERE id = ?').get(original.id) as { deleted: number }).deleted).toBe(1);

    const restoration = await prepareTool('transaction.restore', { id: original.id });
    expect((await confirmTool(restoration.actionId)).statusCode).toBe(200);
    expect((db.prepare('SELECT deleted FROM transactions WHERE id = ?').get(original.id) as { deleted: number }).deleted).toBe(0);
  });

  it('confirms transfer, salary, and current-cycle budget-template writes through domain services', async () => {
    const secondAccount = new MasterDataService(db, { now: () => NOW }).createAccount({ name: 'Transfer destination', type: 0 });
    const transfer = await prepareTool('transfer.create', { fromAccountId: 'builtin-default-account', toAccountId: secondAccount.id, amountCents: 4000, date: '2026-09-20', note: 'move' });
    expect((db.prepare('SELECT COUNT(*) AS count FROM transfers WHERE deleted = 0').get() as { count: number }).count).toBe(0);
    expect((await confirmTool(transfer.actionId)).statusCode).toBe(200);
    expect((db.prepare('SELECT COUNT(*) AS count FROM transfers WHERE deleted = 0').get() as { count: number }).count).toBe(1);

    const templateId = (db.prepare('SELECT id FROM budget_templates WHERE is_default = 1').get() as { id: string }).id;
    const salary = await prepareTool('salary.create', { amountCents: 100_000, accountId: 'builtin-default-account', date: '2026-09-20', templateId, note: 'salary' });
    expect((db.prepare('SELECT COUNT(*) AS count FROM salary_records WHERE deleted = 0').get() as { count: number }).count).toBe(0);
    expect((await confirmTool(salary.actionId)).statusCode).toBe(200);
    expect((db.prepare('SELECT COUNT(*) AS count FROM salary_records WHERE deleted = 0').get() as { count: number }).count).toBe(1);

    const apply = await prepareTool('budget.template.apply', { templateId });
    expect(apply.card.values.salaryCount).toBe(1);
    expect((await confirmTool(apply.actionId)).statusCode).toBe(200);
    expect((db.prepare('SELECT COUNT(*) AS count FROM budget_allocations WHERE deleted = 0').get() as { count: number }).count).toBe(1);
  });

  it('confirms safe category/account create-update-delete actions only after previews', async () => {
    const category = await prepareTool('category.create', { name: 'Assistant test category', type: 0 });
    expect((db.prepare("SELECT COUNT(*) AS count FROM categories WHERE name = 'Assistant test category' AND deleted = 0").get() as { count: number }).count).toBe(0);
    const categoryCreated = await confirmTool(category.actionId);
    const categoryId = categoryCreated.json().message.content.result.data.category.id as string;
    const categoryUpdate = await prepareTool('category.update', { id: categoryId, changes: { name: 'Assistant updated category' } });
    expect((await confirmTool(categoryUpdate.actionId)).statusCode).toBe(200);
    expect((db.prepare('SELECT name FROM categories WHERE id = ?').get(categoryId) as { name: string }).name).toBe('Assistant updated category');
    const categoryDelete = await prepareTool('category.delete', { id: categoryId });
    expect((await confirmTool(categoryDelete.actionId)).statusCode).toBe(200);
    expect((db.prepare('SELECT deleted FROM categories WHERE id = ?').get(categoryId) as { deleted: number }).deleted).toBe(1);

    const account = await prepareTool('account.create', { name: 'Assistant unused account', type: 0, initialBalanceCents: 500 });
    expect((db.prepare("SELECT COUNT(*) AS count FROM accounts WHERE name = 'Assistant unused account' AND deleted = 0").get() as { count: number }).count).toBe(0);
    const accountCreated = await confirmTool(account.actionId);
    const accountId = accountCreated.json().message.content.result.data.account.id as string;
    const accountUpdate = await prepareTool('account.update', { id: accountId, changes: { name: 'Assistant renamed account' } });
    expect((await confirmTool(accountUpdate.actionId)).statusCode).toBe(200);
    expect((db.prepare('SELECT name FROM accounts WHERE id = ?').get(accountId) as { name: string }).name).toBe('Assistant renamed account');
    const accountDelete = await prepareTool('account.delete', { id: accountId });
    expect((await confirmTool(accountDelete.actionId)).statusCode).toBe(200);
    expect((db.prepare('SELECT deleted FROM accounts WHERE id = ?').get(accountId) as { deleted: number }).deleted).toBe(1);
  });

  it('keeps backup creation preview inert and creates a named backup only on confirmation', async () => {
    const sourceDb = new Database(join(testDataDir, 'jizhang.db'));
    initializeDatabase(sourceDb, null);
    closeDatabase(sourceDb);
    const preview = await prepareTool('backup.create', {});
    expect((await inject('GET', '/api/v1/backups')).json().items).toHaveLength(0);
    const confirmed = await confirmTool(preview.actionId);
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json().message.content.result.data.fileName).toMatch(/^jizhang-/);
    expect((await inject('GET', '/api/v1/backups')).json().items).toHaveLength(1);
  });
});
