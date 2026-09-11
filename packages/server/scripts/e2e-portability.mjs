// End-to-end data-portability checks against the running container (T15).
//
// The load-bearing checks (task AC1-AC13):
//   * an export opens as CSV with a BOM (so Excel reads Chinese) and survives a round trip
//     with the same ROW COUNT and the same NET TOTAL — a lost row is the one failure this
//     feature must not have;
//   * importing the same file twice inserts nothing the second time;
//   * a malformed file is REJECTED, not partially applied;
//   * two identical bills on the same day both survive (the natural-key alternative would
//     collapse them and lose money);
//   * backups can be listed and taken, and the listing never leaks a host path.
//
// Usage: docker compose cp packages/server/scripts/. jizhang:/app/packages/server/scripts/
//        docker compose exec -T -w /app/packages/server/scripts jizhang node e2e-portability.mjs

import { makeChecker, resetToKnownState } from './lib/e2e-reset.mjs';

const BASE = 'http://127.0.0.1:8081/api/v1';

const { check, finish } = makeChecker();

const { authHeaders: auth, jsonHeaders, csrfOnlyHeaders } = await resetToKnownState();

const get = async (url) => {
  const response = await fetch(`${BASE}${url}`, { headers: auth });
  return { status: response.status, json: await response.json() };
};
const post = async (url, body) =>
  fetch(`${BASE}${url}`, {
    method: 'POST',
    headers: body === undefined ? csrfOnlyHeaders : jsonHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
/** Imports send the CSV as raw text, which is why `text/csv` is its own content type. */
const importCsv = async (csvText) =>
  fetch(`${BASE}/import/transactions`, {
    method: 'POST',
    headers: { ...csrfOnlyHeaders, 'Content-Type': 'text/csv' },
    body: csvText,
  });

const now = new Date();
const dayIn = (day) => new Date(now.getFullYear(), now.getMonth(), day).getTime();

const FOOD = 'builtin-expense-food';
const TRANSPORT = 'builtin-expense-transport';
const ACCOUNT = 'builtin-default-account';

const addTxn = async (body) => {
  const response = await post('/transactions', { accountId: ACCOUNT, ...body });
  if (response.status !== 201) {
    check(`create txn ${body.note ?? ''}`, false, `-> ${response.status} ${await response.text()}`);
    return undefined;
  }
  return (await response.json()).id;
};

const billTotal = async () => (await get('/transactions?limit=500')).json.total;

/** Net expense across everything, derived from the rows themselves. */
async function netExpense() {
  const rows = (await get('/transactions?limit=500')).json.items;
  return rows.reduce(
    (sum, row) => sum + (row.type === 0 ? (row.isRefund ? -row.amountCents : row.amountCents) : 0),
    0,
  );
}

// ── seed a ledger worth round-tripping ───────────────────────────────────────
console.log('\n[seed]');
await addTxn({ type: 0, amountCents: 15_000, categoryId: FOOD, date: dayIn(5), note: '午饭, 加饮料', tags: ['日常'] });
await addTxn({ type: 0, amountCents: 4_000, categoryId: FOOD, date: dayIn(6), note: '退款', isRefund: true });
await addTxn({ type: 0, amountCents: 3_000, categoryId: TRANSPORT, date: dayIn(7), note: '打车' });
await addTxn({ type: 1, amountCents: 500_000, categoryId: 'builtin-income-salary', date: dayIn(2), note: '工资' });
// Two identical bills on the same day: the natural-key dedup would merge them and lose money.
await addTxn({ type: 0, amountCents: 2_500, categoryId: FOOD, date: dayIn(4), note: '咖啡' });
await addTxn({ type: 0, amountCents: 2_500, categoryId: FOOD, date: dayIn(4), note: '咖啡' });

const seededCount = await billTotal();
const seededNet = await netExpense();
check('the ledger was seeded', seededCount === 6, `-> ${seededCount}`);
check('with a non-trivial net expense', seededNet > 0, `-> ${seededNet}`);

// ── AC1 export shape ─────────────────────────────────────────────────────────
console.log('\n[export]');
const exported = await fetch(`${BASE}/export/transactions.csv`, { headers: auth });
check('the export endpoint answers 200', exported.status === 200, `-> ${exported.status}`);
check(
  'with a CSV content type',
  (exported.headers.get('content-type') ?? '').includes('text/csv'),
  `-> ${exported.headers.get('content-type')}`,
);
check(
  'as an attachment download',
  (exported.headers.get('content-disposition') ?? '').includes('attachment'),
  `-> ${exported.headers.get('content-disposition')}`,
);
const csvText = await exported.text();

// The BOM must be checked on the BYTES, not on the decoded string: `fetch` strips a
// leading U+FEFF when decoding UTF-8 per the encoding spec, so `text.startsWith('\uFEFF')`
// is false and always will be. A second request reads the raw array buffer.
const csvBytes = Buffer.from(
  await (await fetch(`${BASE}/export/transactions.csv`, { headers: auth })).arrayBuffer(),
);
check(
  'AC1 the file starts with a UTF-8 BOM',
  csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf,
  `-> ${[...csvBytes.subarray(0, 3)].map((b) => b.toString(16).padStart(2, '0')).join(' ')}`,
);
check(
  'AC1 and the BOM is followed by the header, not by data',
  csvBytes.subarray(3, 5).toString('utf8') === 'id',
  `-> ${csvBytes.subarray(3, 12).toString('utf8')}`,
);

const rawLines = csvBytes.subarray(3).toString('utf8').trim().split('\n');
check('the header has the documented columns', rawLines[0] === 'id,date,type,amount,category,account,note,tags,isRefund', `-> ${rawLines[0]}`);
check('one line per live bill plus the header', rawLines.length === seededCount + 1, `-> ${rawLines.length}`);
check('AC2 the refund flag is exported', csvText.includes('true'), '-> net expense is reproducible outside the app');
check('the type is human-readable', csvText.includes('expense') && csvText.includes('income'));
check('category names are used, not ids', csvText.includes('餐饮') && !csvText.includes(FOOD));
check('AC3 a remark with a comma is quoted', csvText.includes('"午饭, 加饮料"'));

// The other two exports exist, are CSV, and carry a BOM.
for (const kind of ['salaries', 'recurring']) {
  const response = await fetch(`${BASE}/export/${kind}.csv`, { headers: auth });
  const bodyBytes = Buffer.from(await response.arrayBuffer());
  check(
    `the ${kind} export works and has a BOM`,
    response.status === 200 && bodyBytes[0] === 0xef && bodyBytes[1] === 0xbb && bodyBytes[2] === 0xbf,
    `-> ${response.status}`,
  );
}

// The header must not leak: the export carries the whole ledger.
const anonymous = await fetch(`${BASE}/export/transactions.csv`);
check('exporting requires a session -> 401', anonymous.status === 401, `-> ${anonymous.status}`);

// ── AC5 idempotency: same file twice ─────────────────────────────────────────
console.log('\n[AC5 importing the same file twice]');
const firstImport = await importCsv(csvText);
check('the first import succeeds', firstImport.status === 200, `-> ${firstImport.status}`);
const firstBody = await firstImport.json();
check('AC5 every row already exists, so all are skipped', firstBody.inserted === 0 && firstBody.skipped === seededCount, `-> ${JSON.stringify(firstBody)}`);
check('AC5 the bill count did not change', (await billTotal()) === seededCount, `-> ${await billTotal()}`);

// ── AC4 a real round trip into an empty ledger ───────────────────────────────
console.log('\n[AC4 round trip]');
// Soft-delete everything through the ordinary route, then purge the bin. `DELETE /trash/:id`
// only ever removes an ALREADY soft-deleted row — calling it on a live bill is a 409 — so
// the two steps are not interchangeable.
const all = (await get('/transactions?limit=500')).json.items;
for (const item of all) {
  const soft = await fetch(`${BASE}/transactions/${item.id}`, {
    method: 'DELETE',
    headers: csrfOnlyHeaders,
  });
  check(`soft delete ${item.id.slice(0, 6)} -> 204`, soft.status === 204, `-> ${soft.status}`);
}
const bin = await get('/trash');
check('everything is in the bin', bin.json.total === seededCount, `-> ${bin.json.total}`);
for (const item of bin.json.items) {
  const purged = await fetch(`${BASE}/trash/${item.id}`, {
    method: 'DELETE',
    headers: csrfOnlyHeaders,
  });
  check(`purge ${item.id.slice(0, 6)} -> 204`, purged.status === 204, `-> ${purged.status}`);
}
check('the ledger was emptied', (await billTotal()) === 0, `-> ${await billTotal()}`);

const restore = await importCsv(csvText);
check('the import succeeds', restore.status === 200, `-> ${restore.status}`);
const restoreBody = await restore.json();
check('AC4 every row came back', restoreBody.inserted === seededCount, `-> ${restoreBody.inserted}`);
check('AC4 the bill count matches', (await billTotal()) === seededCount, `-> ${await billTotal()}`);
check('AC4 the net expense matches', (await netExpense()) === seededNet, `-> ${await netExpense()} vs ${seededNet}`);
check(
  'AC5 two identical same-day bills both survived',
  (await get('/transactions?limit=500')).json.items.filter((row) => row.note === '咖啡').length === 2,
);

// A second import of the same file is still a no-op.
const repeat = await (await importCsv(csvText)).json();
check('AC5 importing again inserts nothing', repeat.inserted === 0 && repeat.skipped === seededCount, `-> ${JSON.stringify(repeat)}`);

// ── AC6/AC7 malformed files are refused ──────────────────────────────────────
console.log('\n[AC6/AC7 invalid files]');
const header = 'id,date,type,amount,category,account,note,tags,isRefund';
const invalidCases = [
  ['an invalid amount', `${header}\nnew-1,2026-09-01,expense,abc,餐饮,默认账户,,-,false`],
  ['a missing column', 'id,date,amount\nnew-1,2026-09-01,10.00'],
  ['not CSV at all', '<html>nope</html>'],
  ['an unknown category', `${header}\nnew-1,2026-09-01,expense,10.00,不存在的分类,默认账户,,-,false`],
  ['an unknown account', `${header}\nnew-1,2026-09-01,expense,10.00,餐饮,不存在的账户,,-,false`],
  ['an impossible date', `${header}\nnew-1,2026-02-31,expense,10.00,餐饮,默认账户,,-,false`],
];
for (const [label, text] of invalidCases) {
  const response = await importCsv(text);
  check(`AC6/AC7 ${label} -> 400`, response.status === 400, `-> ${response.status}`);
}

// A file with a valid first row and an invalid second row must apply NEITHER.
const mixed = `${header}\ngood-1,2026-09-01,expense,10.00,餐饮,默认账户,,-,false\nbad-1,2026-09-01,expense,nope,餐饮,默认账户,,-,false`;
const mixedResponse = await importCsv(mixed);
check('AC6 the mixed file is refused', mixedResponse.status === 400, `-> ${mixedResponse.status}`);
check(
  'AC6 and NEITHER row was written (all-or-nothing)',
  (await billTotal()) === seededCount,
  `-> ${await billTotal()} vs ${seededCount}`,
);

// ── AC8 import only adds ─────────────────────────────────────────────────────
console.log('\n[AC8 import only adds]');
const snapshotBefore = (await get('/transactions?limit=500')).json.items
  .map((row) => `${row.id}:${row.amountCents}:${row.note}`)
  .sort()
  .join('|');
await importCsv(csvText);
const snapshotAfter = (await get('/transactions?limit=500')).json.items
  .map((row) => `${row.id}:${row.amountCents}:${row.note}`)
  .sort()
  .join('|');
check('AC8 every existing bill is byte-for-byte unchanged', snapshotBefore === snapshotAfter);

// ── AC9/AC10 backups ─────────────────────────────────────────────────────────
console.log('\n[AC9/AC10 backups]');
const before = await get('/backups');
check('the backup list answers 200', before.status === 200, `-> ${before.status}`);
check('it is an array', Array.isArray(before.json.items), `-> ${typeof before.json.items}`);
const countBefore = before.json.items.length;

const created = await post('/backups');
check('AC10 taking a backup -> 201', created.status === 201, `-> ${created.status}`);
const createdBody = await created.json();
check('AC10 it reports the new file', typeof createdBody.fileName === 'string', `-> ${createdBody.fileName}`);
check('AC10 with a size', createdBody.sizeBytes > 0, `-> ${createdBody.sizeBytes}`);
check(
  'AC9 the listing never leaks a host path',
  !createdBody.fileName.includes('/') && !createdBody.fileName.includes('\\'),
  `-> ${createdBody.fileName}`,
);

const after = await get('/backups');
check('AC10 the new archive appears in the list', after.json.items.length === countBefore + 1, `-> ${after.json.items.length} vs ${countBefore}`);
check(
  'AC9 entries carry name, size and time',
  after.json.items.every(
    (item) => typeof item.fileName === 'string' && typeof item.sizeBytes === 'number' && typeof item.createdAtMs === 'number',
  ),
);
check(
  'AC9 none of the listed entries expose a path',
  after.json.items.every((item) => !item.fileName.includes('/') && !item.fileName.includes('\\')),
);

// ── guard ────────────────────────────────────────────────────────────────────
console.log('\n[guard]');
for (const url of ['/backups', '/export/transactions.csv']) {
  const response = await fetch(`${BASE}${url}`);
  check(`${url} requires a session -> 401`, response.status === 401, `-> ${response.status}`);
}
const anonymousImport = await fetch(`${BASE}/import/transactions`, {
  method: 'POST',
  headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'text/csv' },
  body: 'id,date\n',
});
check('POST /import/transactions requires a session -> 401', anonymousImport.status === 401, `-> ${anonymousImport.status}`);
const noCsrf = await fetch(`${BASE}/backups`, { method: 'POST' });
check('a mutating call without CSRF -> 403', noCsrf.status === 403, `-> ${noCsrf.status}`);

// ── the SPA route is deployed ────────────────────────────────────────────────
const shell = await fetch('http://127.0.0.1:8081/data');
const html = await shell.text();
check('GET /data serves the SPA shell', shell.status === 200 && html.includes('<div id="app"'), `-> ${shell.status}`);

finish('PORTABILITY E2E');
