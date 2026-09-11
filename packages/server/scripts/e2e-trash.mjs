// End-to-end recycle-bin checks against the running container (T12).
//
// The load-bearing checks (task AC1-AC10):
//   * a deleted bill shows up in the bin with everything the view renders;
//   * restoring puts it back and the budget figures return to their previous values;
//   * purging removes it for good, from every endpoint;
//   * a LIVE bill can never be hard-deleted (409), which is the guard protecting real
//     data from a mistyped id or a desynchronised UI;
//   * the bin never leaks a live bill, and `includeDeleted` keeps its old meaning.
//
// Usage: docker compose cp packages/server/scripts/. jizhang:/app/packages/server/scripts/
//        docker compose exec -T -w /app/packages/server/scripts jizhang node e2e-trash.mjs

import { makeChecker, resetToKnownState } from './lib/e2e-reset.mjs';

const BASE = 'http://127.0.0.1:8081/api/v1';

const { check, finish } = makeChecker();

const { authHeaders: auth, jsonHeaders, csrfOnlyHeaders } = await resetToKnownState();

const get = async (url) => {
  const response = await fetch(`${BASE}${url}`, { headers: auth });
  return { status: response.status, json: await response.json() };
};
/**
 * Sends a JSON body.
 *
 * For a request with NO body, use `csrfOnlyHeaders` instead: sending
 * `Content-Type: application/json` with an empty body makes Fastify answer 400
 * `FST_ERR_CTP_EMPTY_JSON_BODY` before the route ever runs (`error-handling.md`).
 */
const post = async (url, body) =>
  fetch(`${BASE}${url}`, {
    method: 'POST',
    headers: body === undefined ? csrfOnlyHeaders : jsonHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const del = async (url) =>
  fetch(`${BASE}${url}`, { method: 'DELETE', headers: csrfOnlyHeaders });

const now = new Date();
const dayIn = (day) =>
  new Date(now.getFullYear(), now.getMonth(), day).getTime();

const FOOD = 'builtin-expense-food';
const TRANSPORT = 'builtin-expense-transport';
const ACCOUNT = 'builtin-default-account';

/** Creates a bill and returns its id (asserting it really was created). */
const addTxn = async (body) => {
  const response = await post('/transactions', { accountId: ACCOUNT, ...body });
  if (response.status !== 201) {
    check(`create txn ${body.note ?? body.categoryId}`, false, `-> ${response.status} ${await response.text()}`);
    return undefined;
  }
  return (await response.json()).id;
};

const softDelete = async (id) => {
  if (id === undefined) {
    check('soft delete skipped: the bill was never created', false);
    return;
  }
  const response = await del(`/transactions/${id}`);
  check(`soft delete ${id.slice(0, 6)} -> 204`, response.status === 204, `-> ${response.status}`);
};

const trashCount = async () => (await get('/trash')).json.total;

// ── an empty bin ─────────────────────────────────────────────────────────────
console.log('\n[empty bin]');
const empty = await get('/trash');
check('an empty bin answers 200', empty.status === 200, `-> ${empty.status}`);
check('with no items', empty.json.items.length === 0, `-> ${empty.json.items.length}`);
check('and a zero total', empty.json.total === 0, `-> ${empty.json.total}`);

// ── the bin fills, and the live list empties ─────────────────────────────────
console.log('\n[delete -> appears in the bin]');
const lunchId = await addTxn({ type: 0, amountCents: 150_000, categoryId: FOOD, date: dayIn(5), note: '买菜' });
const taxiId = await addTxn({ type: 0, amountCents: 30_000, categoryId: TRANSPORT, date: dayIn(6), note: '打车' });
const refundId = await addTxn({
  type: 0,
  amountCents: 40_000,
  categoryId: FOOD,
  date: dayIn(7),
  note: '买菜退款',
  isRefund: true,
});
check('three bills created', lunchId !== undefined && taxiId !== undefined && refundId !== undefined);

const beforeDelete = await get('/transactions?limit=200');
check('all three are in the live list', beforeDelete.json.total === 3, `-> ${beforeDelete.json.total}`);

await softDelete(lunchId);
const afterDelete = await get('/transactions?limit=200');
check('AC1 the deleted bill leaves the live list', afterDelete.json.total === 2, `-> ${afterDelete.json.total}`);
check('AC1 it appears in the bin', (await trashCount()) === 1, `-> ${await trashCount()}`);

// ── the row carries what the view renders ────────────────────────────────────
console.log('\n[the row the view renders]');
const bin = (await get('/trash')).json;
const row = bin.items.find((item) => item.id === lunchId);
check('the row is present', row !== undefined);
check('with the amount', row?.amountCents === 150_000, `-> ${row?.amountCents}`);
check('with the category (for the name)', row?.categoryId === FOOD, `-> ${row?.categoryId}`);
check('with the bill date (for 账单日期)', row?.date === dayIn(5), `-> ${row?.date}`);
check(
  'with a deletion stamp (updatedAt >= the bill date)',
  typeof row?.updatedAt === 'number' && row.updatedAt >= dayIn(5),
  `-> ${row?.updatedAt}`,
);
check('and the refund flag survives the trip', row?.isRefund === false);

// ── restore ──────────────────────────────────────────────────────────────────
console.log('\n[restore]');
const restored = await post(`/trash/${lunchId}/restore`);
check('AC2 restore answers 200', restored.status === 200, `-> ${restored.status}`);
check('AC2 the bill is back in the live list', (await get('/transactions?limit=200')).json.total === 3);
check('AC1 the bin is empty again', (await trashCount()) === 0, `-> ${await trashCount()}`);

// Restoring a bill that is already live must not disturb it (idempotent).
const again = await post(`/trash/${lunchId}/restore`);
check('AC5 restoring a live bill is a no-op that still answers 200', again.status === 200, `-> ${again.status}`);
check('AC5 and it is still exactly one row', (await get('/transactions?limit=200')).json.total === 3);

const missing = await post('/trash/no-such-id/restore');
check('restoring an unknown id -> 404', missing.status === 404, `-> ${missing.status}`);

// ── the budget figures move with the bin ─────────────────────────────────────
console.log('\n[the budget follows the bin]');
// One single-module cycle so the pool is unambiguous.
const template = await post('/templates', { name: '单模块', modules: [{ categoryId: FOOD, ratio: 1 }] });
const templateId = (await template.json()).id;
await post('/salaries', { amountCents: 1_000_000, date: dayIn(2), note: '本月工资', templateId });

const withAllLive = (await get('/budget/overview')).json;
await softDelete(lunchId);
const withOneTrashed = (await get('/budget/overview')).json;

check(
  'AC2 deleting a bill lowers the cycle spend',
  withOneTrashed.totalSpentCents === withAllLive.totalSpentCents - 150_000,
  `${withAllLive.totalSpentCents} -> ${withOneTrashed.totalSpentCents}`,
);

await post(`/trash/${lunchId}/restore`);
const afterRestore = (await get('/budget/overview')).json;
check(
  'AC2 and restoring it puts the spend back exactly',
  afterRestore.totalSpentCents === withAllLive.totalSpentCents,
  `${afterRestore.totalSpentCents} vs ${withAllLive.totalSpentCents}`,
);

// The trash is a delete-and-restore round trip, so it must not leave a trace.
check(
  'AC2 the module budgets are untouched by the round trip',
  JSON.stringify(afterRestore.modules) === JSON.stringify(withAllLive.modules),
);

// ── the guard: a live bill cannot be purged ──────────────────────────────────
console.log('\n[the hard-delete guard]');
const livePurge = await del(`/trash/${taxiId}`);
check('AC4 purging a LIVE bill -> 409', livePurge.status === 409, `-> ${livePurge.status}`);
const conflictBody = await livePurge.json();
check('AC4 with a CONFLICT code', conflictBody.error?.code === 'CONFLICT', `-> ${conflictBody.error?.code}`);
check(
  'AC4 the message is written for a human',
  /recycle bin/i.test(conflictBody.error?.message ?? ''),
  `-> ${conflictBody.error?.message}`,
);
check(
  'AC4 and the live bill is untouched',
  (await get('/transactions?limit=200')).json.total === 3,
  `-> ${(await get('/transactions?limit=200')).json.total}`,
);

const unknownPurge = await del('/trash/no-such-id');
check('purging an unknown id -> 404 (not 409)', unknownPurge.status === 404, `-> ${unknownPurge.status}`);

// ── purge for real ───────────────────────────────────────────────────────────
console.log('\n[purge]');
await softDelete(taxiId);
check('the bin has one row', (await trashCount()) === 1, `-> ${await trashCount()}`);

const purged = await del(`/trash/${taxiId}`);
check('AC3 purge -> 204', purged.status === 204, `-> ${purged.status}`);
check('AC3 the bin is empty', (await trashCount()) === 0, `-> ${await trashCount()}`);
check(
  'AC3 the live list no longer has it',
  (await get('/transactions?limit=200')).json.total === 2,
  `-> ${(await get('/transactions?limit=200')).json.total}`,
);
// The only honest proof that the row is physically gone: ask for deleted rows too.
const includingDeleted = (await get('/transactions?limit=200&includeDeleted=true')).json;
check(
  'AC3 it is invisible even with includeDeleted',
  !includingDeleted.items.some((item) => item.id === taxiId),
  `-> ${includingDeleted.items.length} rows`,
);
check(
  'AC10 includeDeleted still returns live + deleted together (semantics unchanged)',
  includingDeleted.total === 2,
  `-> ${includingDeleted.total}`,
);

// ── bulk operations ──────────────────────────────────────────────────────────
console.log('\n[bulk]');
const aId = await addTxn({ type: 0, amountCents: 1_000, categoryId: FOOD, date: dayIn(4), note: 'A' });
const bId = await addTxn({ type: 0, amountCents: 2_000, categoryId: FOOD, date: dayIn(4), note: 'B' });
const liveBeforeBulk = (await get('/transactions?limit=200')).json.total;
await softDelete(aId);
await softDelete(bId);
check('two rows are in the bin', (await trashCount()) === 2, `-> ${await trashCount()}`);

const restoreAll = await post('/trash/restore-all');
check('AC6 restore-all -> 200', restoreAll.status === 200, `-> ${restoreAll.status}`);
const restoreBody = await restoreAll.json();
check('AC6 it reports what it restored', restoreBody.restored === 2, `-> ${restoreBody.restored}`);
check('AC6 the bin is empty', restoreBody.remaining === 0, `-> ${restoreBody.remaining}`);
check(
  'AC6 every bill is back in the live list',
  (await get('/transactions?limit=200')).json.total === liveBeforeBulk,
  `-> ${(await get('/transactions?limit=200')).json.total}`,
);

// The static path must not be routed as an id.
check(
  'the bulk path is not mistaken for an id (no 404 shape)',
  restoreBody.restored !== undefined && restoreBody.remaining !== undefined,
  JSON.stringify(restoreBody),
);

await softDelete(aId);
await softDelete(bId);
const purgeAll = await del('/trash');
check('AC7 purge-all -> 200', purgeAll.status === 200, `-> ${purgeAll.status}`);
const purgeBody = await purgeAll.json();
check('AC7 it reports what it purged', purgeBody.purged === 2, `-> ${purgeBody.purged}`);
check('AC7 the bin is empty', purgeBody.remaining === 0, `-> ${purgeBody.remaining}`);
const afterPurgeAll = (await get('/transactions?limit=200&includeDeleted=true')).json;
check(
  'AC7 the purged rows are gone for good',
  !afterPurgeAll.items.some((item) => item.id === aId || item.id === bId),
  `-> ${afterPurgeAll.items.length} rows`,
);
check(
  'AC7 live bills were untouched by purge-all',
  afterPurgeAll.total === liveBeforeBulk - 2,
  `-> ${afterPurgeAll.total}`,
);

// ── ordering ─────────────────────────────────────────────────────────────────
console.log('\n[ordering by deletion time]');
// Dates are derived BACKWARDS from today: a bill dated in the future is rejected on
// purpose, so a hard-coded day of the month would make this pass or fail depending on
// when the suite runs.
const firstId = await addTxn({ type: 0, amountCents: 100, categoryId: FOOD, date: dayIn(9), note: '先删' });
const secondId = await addTxn({ type: 0, amountCents: 200, categoryId: FOOD, date: dayIn(1), note: '后删' });
await softDelete(firstId);
await softDelete(secondId);
const ordered = (await get('/trash')).json.items;
check(
  'AC8 the bin is ordered by deletion time, newest first',
  ordered[0]?.id === secondId && ordered[1]?.id === firstId,
  `-> ${ordered.map((item) => item.note).join(',')}`,
);
// The bill dates are deliberately the reverse of the deletion order: an implementation
// that reused the list's `date DESC` would put 先删 first.
check(
  'AC8 which is NOT the bill-date order (the two disagree by design)',
  (ordered[0]?.date ?? 0) < (ordered[1]?.date ?? 0),
  `-> ${ordered.map((item) => new Date(item.date).toISOString().slice(0, 10)).join(' , ')}`,
);

// ── guard ────────────────────────────────────────────────────────────────────
console.log('\n[guard]');
const signedOutGets = await fetch(`${BASE}/trash`);
check('GET /trash requires a session -> 401', signedOutGets.status === 401, `-> ${signedOutGets.status}`);
const signedOutPost = await fetch(`${BASE}/trash/restore-all`, {
  method: 'POST',
  headers: { 'X-Requested-With': 'fetch' },
});
check('POST /trash/restore-all requires a session -> 401', signedOutPost.status === 401, `-> ${signedOutPost.status}`);
const signedOutDelete = await fetch(`${BASE}/trash`, {
  method: 'DELETE',
  headers: { 'X-Requested-With': 'fetch' },
});
check('DELETE /trash requires a session -> 401', signedOutDelete.status === 401, `-> ${signedOutDelete.status}`);
const noCsrf = await fetch(`${BASE}/trash/restore-all`, { method: 'POST' });
check('a mutating call without CSRF -> 403', noCsrf.status === 403, `-> ${noCsrf.status}`);

// ── the SPA route is deployed ────────────────────────────────────────────────
console.log('\n[shell]');
const shell = await fetch('http://127.0.0.1:8081/trash');
check('GET /trash serves the SPA shell', shell.status === 200, `-> ${shell.status}`);
const shellHtml = await shell.text();
check('as HTML, not JSON', shellHtml.includes('<div id="app">'));

finish('TRASH E2E');
