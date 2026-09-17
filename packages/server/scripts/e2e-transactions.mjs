// End-to-end transaction flow against the running container.
//
// Usage: docker compose cp packages/server/scripts/e2e-transactions.mjs jizhang:/app/packages/server/
//        docker compose exec -T -w /app/packages/server jizhang node e2e-transactions.mjs

import { makeChecker, resetToKnownState } from './lib/e2e-reset.mjs';

const BASE = 'http://127.0.0.1:8081/api/v1';
const JSON_CSRF = { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json' };
const CSRF_ONLY = { 'X-Requested-With': 'fetch' };

const { check, finish } = makeChecker();

// Every suite starts from the same known state; see scripts/lib/e2e-reset.mjs.
const { cookie, authHeaders: auth, db } = await resetToKnownState();

/** Marks a deliberately-rejected write as expected, without counting it as a failure. */
function expectRejected(response, status, label) {
  check(label, response.status === status, `-> ${response.status}`);
}

// ── master data ──────────────────────────────────────────────────────────────
const categories = await (await fetch(`${BASE}/categories`, { headers: auth })).json();
check(
  'GET /categories returns the 9 seeded categories',
  categories.items?.length === 9,
  `-> ${categories.items?.length}`,
);
const expenseCategories = categories.items.filter((c) => c.type === 0);
const incomeCategories = categories.items.filter((c) => c.type === 1);
check('6 expense + 3 income', expenseCategories.length === 6 && incomeCategories.length === 3);

const accounts = await (await fetch(`${BASE}/accounts`, { headers: auth })).json();
check('GET /accounts returns the default account', accounts.items?.length === 1, `-> ${accounts.items?.[0]?.name}`);
const accountId = accounts.items[0].id;
const foodId = expenseCategories.find((c) => c.name === '餐饮').id;
const transportId = expenseCategories.find((c) => c.name === '交通').id;
const salaryId = incomeCategories.find((c) => c.name === '工资').id;
const refundId = incomeCategories.find((c) => c.name === '退款').id;

// ── create ───────────────────────────────────────────────────────────────────
const AUG = (day) => new Date(2026, 7, day).getTime();

async function create(body) {
  return fetch(`${BASE}/transactions`, {
    method: 'POST',
    headers: { ...JSON_CSRF, ...auth },
    body: JSON.stringify({ accountId, ...body }),
  });
}

/** A create that is expected to be rejected; not counted as a failure. */
async function expectRejectedCreate(body, status, label) {
  const response = await create(body);
  check(label, response.status === status, `-> ${response.status}`);
  return response;
}

const created = await create({
  type: 0,
  amountCents: 1999,
  categoryId: foodId,
  date: AUG(3),
  note: '午餐',
  tags: ['午餐', '工作', '午餐', ''],
});
const createdBody = await created.json();
check('POST /transactions -> 201', created.status === 201, `-> ${created.status}`);
check('AC5 19.99 yuan stored as exactly 1999 cents', createdBody.amountCents === 1999);
check(
  'AC6 tags de-duplicated and trimmed on write',
  JSON.stringify(createdBody.tags) === JSON.stringify(['午餐', '工作']),
  JSON.stringify(createdBody.tags),
);

// Non-integer cents must be rejected.
await expectRejectedCreate(
  { type: 0, amountCents: 1998.99, categoryId: foodId, date: AUG(3) },
  400,
  'AC4 non-integer cents rejected -> 400',
);

// Unknown reference.
await expectRejectedCreate(
  { type: 0, amountCents: 100, categoryId: 'nope', date: AUG(3) },
  400,
  'AC10 unknown category rejected -> 400',
);

// ── more rows, including a refund and an income ──────────────────────────────
await create({ type: 0, amountCents: 50000, categoryId: foodId, date: AUG(15), note: '聚餐' });
await create({ type: 1, amountCents: 20000, categoryId: refundId, date: AUG(16), note: '退款', isRefund: true });
await create({ type: 0, amountCents: 3000, categoryId: transportId, date: AUG(20), note: '地铁' });
await create({ type: 1, amountCents: 900000, categoryId: salaryId, date: AUG(5), note: '工资' });

// ── list + totals ────────────────────────────────────────────────────────────
const listRes = await fetch(`${BASE}/transactions?limit=100`, { headers: auth });
const list = await listRes.json();
// 5 rows exist at this point: the tagged one plus the four added above. The
// "50% off" row is created later, for the LIKE-escaping check.
check('GET /transactions lists all rows so far', list.total === 5, `-> ${list.total}`);

// Gross expense = 1999 + 50000 + 3000 = 54999 cents (the refund no longer reduces it).
const expenses = list.items.filter((t) => t.type === 0);
const netExpense = expenses.reduce(
  (sum, t) => sum + t.amountCents,
  0,
);
check(
  'AC7 expense is gross (54999)',
  netExpense === 54999,
  `-> ${netExpense}`,
);
const income = list.items
  .filter((t) => t.type === 1)
  .reduce((sum, t) => sum + t.amountCents, 0);
check('AC7 refund included in income (920000)', income === 920000, `-> ${income}`);

// ── filters ──────────────────────────────────────────────────────────────────
const byCategory = await (
  await fetch(`${BASE}/transactions?categoryId=${foodId}`, { headers: auth })
).json();
check('AC8 filter by category -> 2 rows', byCategory.total === 2, `-> ${byCategory.total}`);

const byType = await (await fetch(`${BASE}/transactions?type=1`, { headers: auth })).json();
check('AC8 filter by income type -> 2 rows', byType.total === 2, `-> ${byType.total}`);

const byRange = await (
  await fetch(`${BASE}/transactions?from=${AUG(1)}&to=${AUG(10)}`, { headers: auth })
).json();
check('AC8 filter by date range -> 2 rows', byRange.total === 2, `-> ${byRange.total}`);

const byTag = await (
  await fetch(`${BASE}/transactions?tag=${encodeURIComponent('午餐')}`, { headers: auth })
).json();
check('AC8 filter by tag -> 1 row', byTag.total === 1, `-> ${byTag.total}`);

// ── AC9 LIKE escaping ────────────────────────────────────────────────────────
await create({ type: 0, amountCents: 100, categoryId: foodId, date: AUG(21), note: '折扣 50% off' });
const percentSearch = await (
  await fetch(`${BASE}/transactions?q=${encodeURIComponent('%')}`, { headers: auth })
).json();
check(
  'AC9 "%" matches literally, not as a wildcard',
  percentSearch.total === 1 && percentSearch.items[0].note === '折扣 50% off',
  `-> ${percentSearch.total}`,
);

// ── update ───────────────────────────────────────────────────────────────────
const patched = await fetch(`${BASE}/transactions/${createdBody.id}`, {
  method: 'PATCH',
  headers: { ...JSON_CSRF, ...auth },
  body: JSON.stringify({ amountCents: 2500, note: '改过的备注' }),
});
const patchedBody = await patched.json();
check('AC2 PATCH updates the supplied fields', patched.status === 200 && patchedBody.amountCents === 2500);
check(
  'AC2 PATCH leaves untouched fields alone',
  patchedBody.categoryId === foodId && JSON.stringify(patchedBody.tags) === JSON.stringify(['午餐', '工作']),
);

// ── tags vocabulary ──────────────────────────────────────────────────────────
// Checked BEFORE the soft delete below, because `GET /tags` counts only live rows:
// the row carrying the tag here is the one that gets deleted, so afterwards the
// vocabulary is legitimately empty.
const tags = await (await fetch(`${BASE}/tags`, { headers: auth })).json();
check(
  'GET /tags returns the vocabulary with counts',
  Array.isArray(tags.items) &&
    tags.items.some((t) => t.name === '午餐' && t.count === 1) &&
    tags.items.some((t) => t.name === '工作' && t.count === 1),
  JSON.stringify(tags.items),
);

// ── soft delete ──────────────────────────────────────────────────────────────
const del = await fetch(`${BASE}/transactions/${createdBody.id}`, {
  method: 'DELETE',
  headers: { ...CSRF_ONLY, ...auth },
});
check('AC3 DELETE -> 204', del.status === 204, `-> ${del.status}`);

const afterDelete = await (await fetch(`${BASE}/transactions`, { headers: auth })).json();
check('AC3 deleted row is hidden by default', afterDelete.items.every((t) => t.id !== createdBody.id));

const withDeleted = await (
  await fetch(`${BASE}/transactions?includeDeleted=true`, { headers: auth })
).json();
check(
  'AC3 deleted row is still present with includeDeleted',
  withDeleted.items.some((t) => t.id === createdBody.id),
);

{
  const row = db
    .prepare('SELECT deleted FROM transactions WHERE id = ?')
    .get(createdBody.id);
  check('AC3 row is soft-deleted, not removed', row?.deleted === 1, JSON.stringify(row));
}

db.close();

// A soft-deleted row must leave the tag vocabulary; this is the behaviour that
// initially looked like a bug.
const tagsAfterDelete = await (await fetch(`${BASE}/tags`, { headers: auth })).json();
check(
  'AC3 soft delete removes the row from the tag vocabulary',
  Array.isArray(tagsAfterDelete.items) && tagsAfterDelete.items.length === 0,
  JSON.stringify(tagsAfterDelete.items),
);

// ── guard ────────────────────────────────────────────────────────────────────
const anonList = await fetch(`${BASE}/transactions`);
check('transactions list requires a session -> 401', anonList.status === 401, `-> ${anonList.status}`);

const anonWrite = await fetch(`${BASE}/transactions`, {
  method: 'POST',
  headers: JSON_CSRF,
  body: JSON.stringify({ type: 0, amountCents: 100, categoryId: foodId, accountId, date: AUG(1) }),
});
check('transaction create requires a session -> 401', anonWrite.status === 401, `-> ${anonWrite.status}`);

const noCsrf = await fetch(`${BASE}/transactions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({ type: 0, amountCents: 100, categoryId: foodId, accountId, date: AUG(1) }),
});
check('transaction create requires the CSRF header -> 403', noCsrf.status === 403, `-> ${noCsrf.status}`);

// ── SPA shell still served ───────────────────────────────────────────────────
const spa = await fetch('http://127.0.0.1:8081/transactions');
check('GET /transactions serves the SPA shell', spa.status === 200, `-> ${spa.status}`);

finish('TRANSACTION E2E');
