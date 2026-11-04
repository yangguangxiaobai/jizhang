import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { closeDatabase, initializeDatabase, type Db } from '../src/db/index.js';
import { SESSION_COOKIE } from '../src/plugins/auth.js';
import { AuthService } from '../src/services/auth-service.js';

const USERNAME = 'quiz';
const PASSWORD = 'correct horse battery staple';
const CSRF = { 'x-requested-with': 'fetch' } as const;
const NOW = Date.UTC(2026, 8, 21, 12, 0, 0);
const ACCOUNT = 'builtin-default-account';
const ENCRYPTION_KEY = 'ab'.repeat(32);
const API_KEY = 'organization-provider-secret';

let db: Db;
let app: FastifyInstance;
let cookie: string;
let providerBody: unknown;

function authed() {
  return { ...CSRF, Cookie: `${SESSION_COOKIE}=${cookie}` };
}

async function post(url: string, payload?: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url,
    headers: authed(),
    ...(payload === undefined ? {} : { payload }),
  });
}

function insertCategory(id: string, name: string): void {
  db.prepare(
    `INSERT INTO categories
       (id, name, type, parent_id, icon, color, sort_order, is_builtin, deleted, updated_at)
     VALUES (?, ?, 0, NULL, 'folder', 1, 20, 0, 0, ?)`,
  ).run(id, name, NOW);
}

function insertTransaction(id: string, categoryId: string, tags: string[], note: string): void {
  db.prepare(
    `INSERT INTO transactions
       (id, type, amount_cents, category_id, account_id, date, note, tags_json, is_refund, deleted, updated_at)
     VALUES (?, 0, 100, ?, ?, ?, ?, ?, 0, 0, ?)`,
  ).run(id, categoryId, ACCOUNT, NOW, note, JSON.stringify(tags), NOW);
}

function seedDependencies(): void {
  insertCategory('organization-source', '旅行');
  insertCategory('organization-target', '旅行');
  insertTransaction(
    'organization-source-tx',
    'organization-source',
    ['Trip'],
    'PRIVATE_ORG_NOTE 35元 2026-09-22 账户尾号1234',
  );
  insertTransaction('organization-target-tx-1', 'organization-target', ['trip'], 'target one');
  insertTransaction('organization-target-tx-2', 'organization-target', [], 'target two');

  db.prepare(
    `INSERT INTO budget_allocations
       (id, salary_record_id, date, allocations_json, deleted, updated_at)
     VALUES ('organization-allocation', 'salary-organization', ?, ?, 0, ?)`,
  ).run(
    NOW,
    JSON.stringify([
      { categoryId: 'organization-source', amountCents: 300 },
      { categoryId: 'organization-target', amountCents: 700 },
    ]),
    NOW,
  );
  db.prepare(
    `INSERT INTO budget_templates
       (id, name, is_default, modules_json, deleted, updated_at)
     VALUES ('organization-template', '组织测试模板', 0, ?, 0, ?)`,
  ).run(
    JSON.stringify([
      { categoryId: 'organization-source', ratio: 0.2 },
      { categoryId: 'organization-target', ratio: 0.8 },
    ]),
    NOW,
  );
  db.prepare(
    `INSERT INTO recurring_rules
       (id, name, type, amount_cents, category_id, account_id, frequency, anchor_date,
        next_due_date, has_older_due, enabled, deleted, updated_at)
     VALUES ('organization-rule', '组织周期规则', 0, 100, 'organization-source', ?, 'monthly', ?, ?, 0, 1, 0, ?)`,
  ).run(ACCOUNT, NOW, NOW, NOW);
  db.prepare(
    `INSERT INTO recurring_occurrences
       (id, rule_id, planned_date, status, transaction_id, type, amount_cents, category_id,
        account_id, note, deleted, updated_at)
     VALUES ('organization-pending', 'organization-rule', ?, 'pending', NULL, 0, 100,
        'organization-source', ?, '待确认', 0, ?)`,
  ).run(NOW, ACCOUNT, NOW);
  db.prepare(
    `INSERT INTO recurring_occurrences
       (id, rule_id, planned_date, status, transaction_id, type, amount_cents, category_id,
        account_id, note, deleted, updated_at)
     VALUES ('organization-confirmed', 'organization-rule', ?, 'confirmed', 'confirmed-tx', 0,
        100, 'organization-source', ?, '已确认历史', 0, ?)`,
  ).run(NOW + 86_400_000, ACCOUNT, NOW);
}

beforeEach(async () => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  initializeDatabase(db, null);

  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    JIZHANG_USERNAME: USERNAME,
    JIZHANG_PASSWORD_HASH: 'unused',
    JIZHANG_AI_ENCRYPTION_KEY: ENCRYPTION_KEY,
    DATA_DIR: './data',
  });
  const authService = new AuthService(db, { sessionTtlDays: config.sessionTtlDays, now: () => NOW });
  await authService.setPassword(USERNAME, PASSWORD);
  providerBody = undefined;
  const fetchImpl: typeof fetch = async (_input, init) => {
    if (typeof init?.body === 'string') providerBody = JSON.parse(init.body) as unknown;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                suggestions: [],
                reclassifications: [
                  {
                    transactionId: 'organization-source-tx',
                    targetCategoryId: 'organization-target',
                    reason: '语义上更接近目标分类。',
                    confidence: 0.91,
                  },
                ],
                newCategories: [
                  {
                    name: '旅行餐饮',
                    type: 0,
                    parentCategoryId: null,
                    evidenceTransactionIds: ['organization-source-tx'],
                    reason: '建议为这类账单增加更细分类。',
                    confidence: 0.82,
                  },
                ],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  app = buildApp({ config, db, authService, secureCookies: false, now: () => NOW, fetchImpl });
  await app.ready();

  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: CSRF,
    payload: { username: USERNAME, password: PASSWORD },
  });
  cookie = (login.cookies as { name: string; value: string }[]).find(
    (item) => item.name === SESSION_COOKIE,
  )?.value as string;
});

afterEach(async () => {
  await app.close();
  closeDatabase(db);
});

describe('AI organization preview and category merge', () => {
  it('previews and atomically applies category/tag merges without touching confirmed snapshots', async () => {
    seedDependencies();

    const preview = await post('/api/v1/ai/organization-preview');
    expect(preview.statusCode).toBe(200);
    const body = preview.json() as {
      previewHash: string;
      actions: {
        actionId: string;
        kind: string;
        sourceId: string;
        targetId: string;
        status: string;
      }[];
    };
    const category = body.actions.find((action) => action.kind === 'category-merge');
    const tag = body.actions.find((action) => action.kind === 'tag-merge');
    expect(category).toMatchObject({
      sourceId: 'organization-source',
      targetId: 'organization-target',
      status: 'ready',
    });
    expect(tag?.status).toBe('ready');

    const applied = await post('/api/v1/ai/organization-apply', {
      previewHash: body.previewHash,
      actionIds: [category?.actionId, tag?.actionId],
    });
    expect(applied.statusCode).toBe(200);
    const operationId = applied.json().operationId as string;

    expect(
      (db.prepare('SELECT deleted FROM categories WHERE id = ?').get('organization-source') as { deleted: number }).deleted,
    ).toBe(1);
    expect(
      (db.prepare('SELECT category_id FROM transactions WHERE id = ?').get('organization-source-tx') as { category_id: string }).category_id,
    ).toBe('organization-target');
    expect(
      (db.prepare('SELECT category_id FROM recurring_occurrences WHERE id = ?').get('organization-confirmed') as { category_id: string }).category_id,
    ).toBe('organization-source');
    expect(
      (db.prepare('SELECT category_id FROM recurring_occurrences WHERE id = ?').get('organization-pending') as { category_id: string }).category_id,
    ).toBe('organization-target');
    expect(
      (db.prepare('SELECT allocations_json FROM budget_allocations WHERE id = ?').get('organization-allocation') as { allocations_json: string }).allocations_json,
    ).toBe(JSON.stringify([{ categoryId: 'organization-target', amountCents: 1000 }]));
    expect(
      (db.prepare('SELECT modules_json FROM budget_templates WHERE id = ?').get('organization-template') as { modules_json: string }).modules_json,
    ).toBe(JSON.stringify([{ categoryId: 'organization-target', ratio: 1 }]));
    expect((db.prepare('SELECT COUNT(*) AS count FROM ai_organization_audit').get() as { count: number }).count).toBe(2);
    expect(
      (db.prepare("SELECT tags_json FROM transactions WHERE id='organization-source-tx'").get() as { tags_json: string }).tags_json,
    ).toBe('["trip"]');
    expect(db.prepare("SELECT 1 AS x FROM tags WHERE name='trip' AND deleted=0").get()).toBeDefined();
    expect(
      (db.prepare('SELECT before_json, after_json FROM ai_organization_audit').all() as { before_json: string; after_json: string }[]).map((row) => `${row.before_json}${row.after_json}`).join(''),
    ).not.toContain('PRIVATE_ORG_NOTE');

    const undone = await post('/api/v1/ai/organization-undo', { operationId });
    expect(undone.statusCode).toBe(200);
    expect(
      (db.prepare('SELECT deleted FROM categories WHERE id = ?').get('organization-source') as { deleted: number }).deleted,
    ).toBe(0);
    expect(
      (db.prepare('SELECT category_id FROM transactions WHERE id = ?').get('organization-source-tx') as { category_id: string }).category_id,
    ).toBe('organization-source');
    expect(
      (db.prepare('SELECT category_id FROM recurring_occurrences WHERE id = ?').get('organization-pending') as { category_id: string }).category_id,
    ).toBe('organization-source');
    expect((db.prepare('SELECT COUNT(*) AS count FROM ai_organization_audit').get() as { count: number }).count).toBe(4);
    expect(
      (db.prepare("SELECT tags_json FROM transactions WHERE id='organization-source-tx'").get() as { tags_json: string }).tags_json,
    ).toBe('["Trip"]');
    expect(db.prepare("SELECT 1 AS x FROM tags WHERE name='Trip' AND deleted=0").get()).toBeDefined();
  });

  it('rejects a stale preview before writing', async () => {
    seedDependencies();
    const preview = await post('/api/v1/ai/organization-preview');
    const body = preview.json() as { previewHash: string; actions: { actionId: string; status: string }[] };
    db.prepare('UPDATE categories SET name = ? WHERE id = ?').run('旅行改名', 'organization-target');

    const response = await post('/api/v1/ai/organization-apply', {
      previewHash: body.previewHash,
      actionIds: body.actions.filter((action) => action.status === 'ready').map((action) => action.actionId),
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'AI_ORGANIZATION_CONFLICT' } });
    expect((db.prepare('SELECT deleted FROM categories WHERE id = ?').get('organization-source') as { deleted: number }).deleted).toBe(0);
  });

  it('sends bounded semantic facts without money, account ids, or secrets', async () => {
    seedDependencies();
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/v1/ai/config',
      headers: authed(),
      payload: {
        enabled: true,
        mode: 'chat-completions',
        name: 'organization test provider',
        url: 'https://provider.example.test/chat',
        method: 'POST',
        model: 'organization-model',
        timeoutMs: 10_000,
        headers: {},
        auth: { kind: 'bearer' },
        bodyTemplate: null,
        responsePath: 'choices[0].message.content',
        secret: API_KEY,
      },
    });
    expect(saved.statusCode).toBe(200);
    const response = await post('/api/v1/ai/organization-preview');
    expect(response.statusCode).toBe(200);
    expect(response.json().recommendations).toHaveLength(2);
    expect(JSON.stringify(providerBody)).toContain('PRIVATE_ORG_NOTE');
    expect(JSON.stringify(providerBody)).toContain('[金额]');
    expect(JSON.stringify(providerBody)).toContain('[日期]');
    expect(JSON.stringify(providerBody)).toContain('[账户]');
    expect(JSON.stringify(providerBody)).not.toContain('35元');
    expect(JSON.stringify(providerBody)).not.toContain('2026-09-22');
    expect(JSON.stringify(providerBody)).not.toContain('尾号1234');
    expect(JSON.stringify(providerBody)).not.toContain('account_id');
    expect(JSON.stringify(providerBody)).not.toContain('amountCents');
    expect(JSON.stringify(providerBody)).not.toContain(API_KEY);
  });

  it('rolls back the entire undo when direct SQL changed an affected tag after apply', async () => {
    seedDependencies();
    const preview = (await post('/api/v1/ai/organization-preview')).json() as {
      previewHash: string;
      actions: { actionId: string; kind: string; status: string }[];
    };
    const tag = preview.actions.find((action) => action.kind === 'tag-merge' && action.status === 'ready');
    const category = preview.actions.find((action) => action.kind === 'category-merge' && action.status === 'ready');
    const applied = await post('/api/v1/ai/organization-apply', {
      previewHash: preview.previewHash,
      actionIds: [tag?.actionId, category?.actionId],
    });
    expect(applied.statusCode).toBe(200);
    const operationId = applied.json().operationId as string;
    const appliedTags = (db.prepare("SELECT tags_json FROM transactions WHERE id='organization-source-tx'").get() as { tags_json: string }).tags_json;
    db.prepare("UPDATE transactions SET tags_json = '[\"external-edit\"]' WHERE id='organization-source-tx'").run();
    const concurrentTags = (db.prepare("SELECT tags_json FROM transactions WHERE id='organization-source-tx'").get() as { tags_json: string }).tags_json;
    const auditBefore = db.prepare('SELECT COUNT(*) AS count FROM ai_organization_audit').get() as { count: number };

    const undone = await post('/api/v1/ai/organization-undo', { operationId });
    expect(undone.statusCode).toBe(409);
    expect(undone.json()).toMatchObject({ error: { code: 'AI_ORGANIZATION_CONFLICT' } });
    expect((db.prepare("SELECT tags_json FROM transactions WHERE id='organization-source-tx'").get() as { tags_json: string }).tags_json).toBe(concurrentTags);
    expect(concurrentTags).not.toBe(appliedTags);
    expect((db.prepare('SELECT COUNT(*) AS count FROM ai_organization_audit').get() as { count: number }).count).toBe(auditBefore.count);
    expect((db.prepare("SELECT deleted FROM categories WHERE id='organization-source'").get() as { deleted: number }).deleted).toBe(1);
    expect((db.prepare("SELECT category_id FROM transactions WHERE id='organization-source-tx'").get() as { category_id: string }).category_id).toBe('organization-target');
    expect((db.prepare("SELECT allocations_json FROM budget_allocations WHERE id='organization-allocation'").get() as { allocations_json: string }).allocations_json).toBe(JSON.stringify([
      { categoryId: 'organization-target', amountCents: 1000 },
    ]));
  });

  it('rejects undo when a user changed an affected value afterwards', async () => {
    seedDependencies();
    const preview = (await post('/api/v1/ai/organization-preview')).json() as {
      previewHash: string;
      actions: { actionId: string; kind: string; status: string }[];
    };
    const category = preview.actions.find((action) => action.kind === 'category-merge' && action.status === 'ready');
    const applied = await post('/api/v1/ai/organization-apply', {
      previewHash: preview.previewHash,
      actionIds: [category?.actionId],
    });
    const operationId = applied.json().operationId as string;
    db.prepare('UPDATE transactions SET category_id = ? WHERE id = ?').run('builtin-expense-food', 'organization-source-tx');

    const undone = await post('/api/v1/ai/organization-undo', { operationId });
    expect(undone.statusCode).toBe(409);
    expect(undone.json()).toMatchObject({ error: { code: 'AI_ORGANIZATION_CONFLICT' } });
    expect((db.prepare('SELECT COUNT(*) AS count FROM ai_organization_audit').get() as { count: number }).count).toBe(1);
  });
});

describe('AI organization route boundary', () => {
  it('requires a session', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/ai/organization-preview',
      headers: CSRF,
    });
    expect(response.statusCode).toBe(401);
  });
});
