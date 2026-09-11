// End-to-end master-data management against the running container (T7).
//
// Usage: docker compose cp packages/server/scripts/e2e-master-data.mjs jizhang:/app/packages/server/
//        docker compose exec -T -w /app/packages/server jizhang node e2e-master-data.mjs

import { makeChecker, resetToKnownState } from './lib/e2e-reset.mjs';

const BASE = 'http://127.0.0.1:8081/api/v1';

const { check, finish } = makeChecker();

// Every suite starts from the same known state; see scripts/lib/e2e-reset.mjs.
const { authHeaders: auth, jsonHeaders, csrfOnlyHeaders } = await resetToKnownState();

/**
 * The CSRF header is required on EVERY mutating request, including ones with no
 * body (DELETE). Only Content-Type depends on whether a body is present.
 */
const send = (method, url, body) =>
  fetch(`${BASE}${url}`, {
    method,
    headers: body === undefined ? csrfOnlyHeaders : jsonHeaders,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const get = async (url) => (await fetch(`${BASE}${url}`, { headers: auth })).json();

const today = new Date();
const dayIn = (monthOffset, day) =>
  new Date(today.getFullYear(), today.getMonth() + monthOffset, day).getTime();

const FOOD = 'builtin-expense-food';
const DEFAULT_ACCOUNT = 'builtin-default-account';

// ── categories ───────────────────────────────────────────────────────────────
console.log('\n[categories]');
const before = await get('/categories');
check('lists the 8 seeded categories', before.items.length === 8, `-> ${before.items.length}`);

const created = await send('POST', '/categories', {
  name: '宠物',
  type: 0,
  icon: 'pet',
  color: 4280000000,
});
const category = await created.json();
check('creates a category -> 201', created.status === 201, `-> ${created.status}`);
check('it is not builtin', category.isBuiltin === false);

const badName = await send('POST', '/categories', { name: '  ', type: 0 });
check('rejects a blank name -> 400', badName.status === 400, `-> ${badName.status}`);

const txn = await send('POST', '/transactions', {
  type: 0,
  amountCents: 25_000,
  categoryId: category.id,
  accountId: DEFAULT_ACCOUNT,
  date: dayIn(-1, 10),
  note: '猫粮',
  tags: ['宠物', '日常'],
});
check('the new category is usable -> 201', txn.status === 201, `-> ${txn.status}`);
const txnId = (await txn.json()).id;

// rename a builtin
const renamed = await send('PATCH', `/categories/${FOOD}`, { name: '吃饭' });
check('renames a builtin category', renamed.status === 200 && (await renamed.json()).name === '吃饭');
const listed = await get('/categories');
check(
  'the rename is visible in the list',
  listed.items.find((c) => c.id === FOOD)?.name === '吃饭',
);

// builtin delete refusal
const deleteBuiltin = await send('DELETE', `/categories/${FOOD}`);
check('builtin category cannot be deleted -> 400', deleteBuiltin.status === 400, `-> ${deleteBuiltin.status}`);

// usage preview
const usage = await get(`/categories/${category.id}/usage`);
check('reports usage (1 transaction)', usage.transactions === 1, `-> ${usage.transactions}`);

// soft delete keeps history readable
const deleted = await send('DELETE', `/categories/${category.id}`);
check('deletes a custom category -> 204', deleted.status === 204, `-> ${deleted.status}`);

const afterDelete = await get('/categories');
check('it leaves the selectable list', !afterDelete.items.some((c) => c.id === category.id));

const historical = await get(`/transactions/${txnId}`);
check('the historical transaction is untouched', historical.categoryId === category.id);
check('and still carries its note and tags', historical.note === '猫粮' && historical.tags.length === 2);

const reuse = await send('POST', '/transactions', {
  type: 0,
  amountCents: 100,
  categoryId: category.id,
  accountId: DEFAULT_ACCOUNT,
  date: dayIn(-1, 11),
});
check('the deleted category cannot be used again -> 400', reuse.status === 400, `-> ${reuse.status}`);

// reordering
const expenseBefore = (await get('/categories?type=0')).items;
const first = expenseBefore[0];
const second = expenseBefore[1];
const moved = await send('POST', `/categories/${first.id}/move`, { dir: 1 });
check('reorders categories -> 200', moved.status === 200, `-> ${moved.status}`);
const expenseAfter = (await get('/categories?type=0')).items;
check(
  'the two neighbours swapped sort order',
  expenseAfter.find((c) => c.id === first.id)?.sortOrder === second.sortOrder &&
    expenseAfter.find((c) => c.id === second.id)?.sortOrder === first.sortOrder,
);
const badDir = await send('POST', `/categories/${FOOD}/move`, { dir: 0 });
check('rejects an invalid direction -> 400', badDir.status === 400, `-> ${badDir.status}`);

// ── accounts ─────────────────────────────────────────────────────────────────
console.log('\n[accounts]');
const bank = await send('POST', '/accounts', {
  name: '招商银行',
  type: 1,
  initialBalanceCents: 1_234_500,
});
const bankAccount = await bank.json();
check('creates an account -> 201', bank.status === 201, `-> ${bank.status}`);
check('with its initial balance', bankAccount.initialBalanceCents === 1_234_500);

const card = await send('POST', '/accounts', {
  name: '信用卡',
  type: 2,
  initialBalanceCents: -50_000,
});
// Read the body ONCE: a Response body can only be consumed a single time.
const cardAccount = await card.json();
check('accepts a negative balance', cardAccount.initialBalanceCents === -50_000);

const fractional = await send('POST', '/accounts', {
  name: 'Bad',
  type: 0,
  initialBalanceCents: 12.5,
});
check('rejects a fractional balance -> 400', fractional.status === 400, `-> ${fractional.status}`);

const badType = await send('POST', '/accounts', { name: 'X', type: 9 });
check('rejects an unknown account type -> 400', badType.status === 400, `-> ${badType.status}`);

const bankTxn = await send('POST', '/transactions', {
  type: 0,
  amountCents: 100,
  categoryId: FOOD,
  accountId: bankAccount.id,
  date: dayIn(-1, 12),
});
check('the new account is usable -> 201', bankTxn.status === 201, `-> ${bankTxn.status}`);

const deleteDefault = await send('DELETE', `/accounts/${DEFAULT_ACCOUNT}`);
check('the builtin default account cannot be deleted -> 400', deleteDefault.status === 400, `-> ${deleteDefault.status}`);

const editAccount = await send('PATCH', `/accounts/${bankAccount.id}`, {
  name: '招行储蓄卡',
  initialBalanceCents: 2_000_000,
});
check(
  'edits an account',
  editAccount.status === 200 && (await editAccount.json()).name === '招行储蓄卡',
);

const deleteCard = await send('DELETE', `/accounts/${cardAccount.id}`);
check('deletes a custom account -> 204', deleteCard.status === 204, `-> ${deleteCard.status}`);

const accountsAfter = await get('/accounts');
check(
  'the deleted account is gone',
  !accountsAfter.items.some((a) => a.id === cardAccount.id),
);

const accountMove = await send('POST', `/accounts/${bankAccount.id}/move`, { dir: -1 });
check('reorders accounts -> 200', accountMove.status === 200, `-> ${accountMove.status}`);

// ── tags ─────────────────────────────────────────────────────────────────────
console.log('\n[tags]');
// Add a second transaction so a rename has to touch more than one row.
const txn2 = await send('POST', '/transactions', {
  type: 0,
  amountCents: 1000,
  categoryId: FOOD,
  accountId: DEFAULT_ACCOUNT,
  date: dayIn(-1, 13),
  tags: ['日常', '工作'],
});
check('second tagged transaction created -> 201', txn2.status === 201, `-> ${txn2.status}`);
const txn2Id = (await txn2.json()).id;

const tagsBefore = await get('/tags');
check(
  'lists tag names with counts',
  tagsBefore.items.find((t) => t.name === '日常')?.count === 2,
  JSON.stringify(tagsBefore.items),
);

const renameRes = await send('PATCH', '/tags', { from: '日常', to: '日常生活' });
const renamedTags = await renameRes.json();
check('renames a tag across transactions -> 200', renameRes.status === 200, `-> ${renameRes.status}`);
check('reports 2 rewritten rows', renamedTags.updated === 2, `-> ${renamedTags.updated}`);

const t1After = await get(`/transactions/${txnId}`);
const t2After = await get(`/transactions/${txn2Id}`);
check('row 1 shows the new tag name', t1After.tags.includes('日常生活'));
check('row 1 no longer shows the old name', !t1After.tags.includes('日常'));
check('row 2 shows the new tag name', t2After.tags.includes('日常生活'));

const blankRename = await send('PATCH', '/tags', { from: '日常', to: '   ' });
check('rejects a blank target name -> 400', blankRename.status === 400, `-> ${blankRename.status}`);

const deleteRes = await send('DELETE', `/tags/${encodeURIComponent('工作')}`);
const deletedTags = await deleteRes.json();
check('deletes a tag -> 200', deleteRes.status === 200, `-> ${deleteRes.status}`);
check('reports 1 rewritten row', deletedTags.updated === 1, `-> ${deletedTags.updated}`);

const t2Final = await get(`/transactions/${txn2Id}`);
check('the deleted tag is gone from the row', !t2Final.tags.includes('工作'));
check('the other tag survives', t2Final.tags.includes('日常生活') || t2Final.tags.includes('宠物'));

const tagsFinal = await get('/tags');
check('the vocabulary no longer lists it', !tagsFinal.items.some((t) => t.name === '工作'));

// ── guard ────────────────────────────────────────────────────────────────────
console.log('\n[guard]');
check('categories list requires a session', (await fetch(`${BASE}/categories`)).status === 401);
check(
  'category create requires a session',
  (
    await fetch(`${BASE}/categories`, {
      method: 'POST',
      headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json' },
      body: '{}',
    })
  ).status === 401,
);
const noCsrf = await fetch(`${BASE}/categories`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...auth },
  body: JSON.stringify({ name: 'X', type: 0 }),
});
check('category create requires the CSRF header -> 403', noCsrf.status === 403, `-> ${noCsrf.status}`);

// ── SPA shell ────────────────────────────────────────────────────────────────
const spa = await fetch('http://127.0.0.1:8081/manage');
check('GET /manage serves the SPA shell', spa.status === 200, `-> ${spa.status}`);

finish('MASTER-DATA E2E');
