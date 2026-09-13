// End-to-end transfers against the running container (child task 09-13-account-transfer).
//
// Usage: docker compose cp packages/server/scripts/. jizhang:/app/packages/server/scripts
//        docker compose exec -w /app/packages/server/scripts -T jizhang node e2e-transfers.mjs
//
// Two things this suite exists to prove, neither of which a unit test can prove on its own:
//
//   1. The five endpoints are actually behind the session guard. Registering a route plugin
//      outside `app.ts`'s `extraRoutes` leaves them wide open while every functional test
//      still passes, so this asserts 401 for each of the five individually.
//   2. A transfer changes NO accounting figure. The comparison is made over HTTP against the
//      real endpoints, with real data in them, because "the budget is unchanged" is only
//      meaningful when there is a budget.

import { makeChecker, resetToKnownState } from './lib/e2e-reset.mjs';

const BASE = 'http://127.0.0.1:8081/api/v1';

const { check, finish } = makeChecker();

// Every suite starts from the same known state; see scripts/lib/e2e-reset.mjs.
const { authHeaders: auth, jsonHeaders, csrfOnlyHeaders } = await resetToKnownState();

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
const ACCOUNT = 'builtin-default-account';

// ── 1. every endpoint requires a session ─────────────────────────────────────
//
// The mutating ones also need the CSRF header, or Fastify answers 403 (the CSRF guard runs
// BEFORE the session guard) and the assertion would prove the wrong thing.
//
// ⚠️ The header must be built here rather than reusing `csrfOnlyHeaders` from the reset helper:
// that one carries a VALID session cookie (it is for bodiless writes while signed in), so
// sending it would prove only that an authenticated request works. This is the trap the spec
// names — "the test proves the CSRF guard and silently says nothing about the session guard" —
// and it very nearly went unnoticed, because a signed-in request answers 200/400/404 rather
// than failing outright.
console.log('\n[session guard]');
const noSession = { 'X-Requested-With': 'fetch' };
const guarded = [
  ['GET', '/transfers'],
  ['GET', '/transfers/some-id'],
  ['POST', '/transfers'],
  ['PATCH', '/transfers/some-id'],
  ['DELETE', '/transfers/some-id'],
];
for (const [method, url] of guarded) {
  const response = await fetch(`${BASE}${url}`, { method, headers: noSession });
  check(`${method} ${url} without a session -> 401`, response.status === 401, `-> ${response.status}`);
}

// ── 2. a bank account to move money into ─────────────────────────────────────
console.log('\n[fixture]');
const bankResponse = await send('POST', '/accounts', {
  name: '转账目标行',
  type: 1,
  initialBalanceCents: 100_000,
});
const bank = await bankResponse.json();
check('created a second account -> 201', bankResponse.status === 201, `-> ${bankResponse.status}`);

const balancesBefore = await get('/accounts/balances');
const startTotal = balancesBefore.totalBalanceCents;
check('the default account starts at 0', balancesBefore.items.find((item) => item.accountId === ACCOUNT)?.balanceCents === 0);
check('the total starts at the new account balance', startTotal === 100_000, `-> ${startTotal}`);

// ── 3. validation refusals ───────────────────────────────────────────────────
console.log('\n[validation]');
const valid = {
  fromAccountId: ACCOUNT,
  toAccountId: bank.id,
  amountCents: 30_000,
  date: dayIn(0, 2),
};

const zero = await send('POST', '/transfers', { ...valid, amountCents: 0 });
check('rejects a zero amount -> 400', zero.status === 400, `-> ${zero.status}`);

const same = await send('POST', '/transfers', { ...valid, toAccountId: ACCOUNT });
check('rejects the same account on both sides -> 400', same.status === 400, `-> ${same.status}`);

const unknown = await send('POST', '/transfers', { ...valid, toAccountId: 'nope' });
check('rejects an unknown account -> 400', unknown.status === 400, `-> ${unknown.status}`);

const future = await send('POST', '/transfers', { ...valid, date: Date.now() + 30 * 86_400_000 });
check('rejects a future date -> 400', future.status === 400, `-> ${future.status}`);

// ── 4. the accounting snapshot must not move ─────────────────────────────────
//
// Taken AFTER the fixture is in place and with real figures in it: an empty ledger would make
// the comparison vacuous.
console.log('\n[seed a real cycle, then snapshot the accounting]');
const salary = await send('POST', '/salaries', {
  accountId: ACCOUNT,
  amountCents: 1_000_000,
  date: dayIn(0, 2),
  allocations: [{ categoryId: FOOD, amountCents: 1_000_000 }],
});
check('cycle salary accepted -> 201', salary.status === 201, `-> ${salary.status}`);
await send('POST', '/transactions', {
  type: 0,
  amountCents: 250_000,
  categoryId: FOOD,
  accountId: ACCOUNT,
  date: dayIn(0, 4),
  note: '本月买菜',
});
await send('POST', '/transactions', {
  type: 0,
  amountCents: 50_000,
  categoryId: FOOD,
  accountId: ACCOUNT,
  date: dayIn(0, 5),
  note: '退款',
  isRefund: true,
});
// An income transaction too, so the fixture covers all five kinds of money at once
// (income, expense, refund, salary, transfer) and the PAC1 self-consistency check below is
// exercised against a balance that every bucket contributes to.
await send('POST', '/transactions', {
  type: 1,
  amountCents: 50_000,
  categoryId: 'builtin-income-other',
  accountId: ACCOUNT,
  date: dayIn(0, 6),
  note: '本月兼职',
});

const snapshot = async () => ({
  trend: await get('/stats/monthly-trend?months=2'),
  share: await get(
    `/stats/category-share?from=${dayIn(-1, 1)}&to=${dayIn(1, 1)}`,
  ),
  pool: await get('/stats/pool-trend'),
  overview: await get('/budget/overview'),
  ledger: await get('/transactions?limit=100'),
});

const before = await snapshot();
check(
  'the snapshot is not vacuous (there is a budget and some spending)',
  before.overview.totalBudgetCents === 1_000_000 && before.overview.totalSpentCents === 200_000,
  `-> budget ${before.overview.totalBudgetCents} spent ${before.overview.totalSpentCents}`,
);

// The balance baseline is read HERE, after the cycle exists — not before seeding it. A
// hand-computed expectation ("start minus the amount") was wrong the first time this suite ran,
// because the salary and the bills land in the same account; read the numbers, do not predict
// them.
const ledgerBefore = await get('/accounts/balances');
const defaultBefore = ledgerBefore.items.find((item) => item.accountId === ACCOUNT)?.balanceCents;
const bankBefore = ledgerBefore.items.find((item) => item.accountId === bank.id)?.balanceCents;
check(
  'the default account holds income + salary − net spending',
  // 0 initial + 50,000 income + 1,000,000 salary − (250,000 expense − 50,000 refund)
  defaultBefore === 850_000,
  `-> ${defaultBefore}`,
);

// PAC1: the balance endpoint's own parts must add up to the figure it reports, for every row.
// This compares the API against itself rather than re-deriving the rule here — a second
// implementation of the formula in the test would agree with a wrong endpoint.
const inconsistent = ledgerBefore.items.filter(
  (item) =>
    item.balanceCents !==
    item.initialBalanceCents +
      item.incomeCents +
      item.salaryCents +
      item.transferInCents -
      item.expenseCents -
      item.transferOutCents,
);
check(
  'every account row is internally consistent (PAC1)',
  inconsistent.length === 0,
  JSON.stringify(inconsistent),
);
check(
  'the total equals the sum of the rows (PAC1)',
  ledgerBefore.totalBalanceCents ===
    ledgerBefore.items.reduce((sum, item) => sum + item.balanceCents, 0),
  `-> ${ledgerBefore.totalBalanceCents}`,
);

// ── 5. the transfer itself ───────────────────────────────────────────────────
console.log('\n[the transfer]');
const created = await send('POST', '/transfers', { ...valid, note: '搬到目标行' });
check('creates a transfer -> 201', created.status === 201, `-> ${created.status}`);
const transfer = await created.json();

const balancesAfter = await get('/accounts/balances');
const fromAfter = balancesAfter.items.find((item) => item.accountId === ACCOUNT);
const toAfter = balancesAfter.items.find((item) => item.accountId === bank.id);
check(
  'the source balance dropped by exactly the amount',
  fromAfter?.balanceCents === defaultBefore - 30_000,
  `-> ${fromAfter?.balanceCents} (was ${defaultBefore})`,
);
check(
  'the destination balance rose by exactly the amount',
  toAfter?.balanceCents === bankBefore + 30_000,
  `-> ${toAfter?.balanceCents} (was ${bankBefore})`,
);
check(
  'the balance-sheet total is UNCHANGED by a transfer',
  balancesAfter.totalBalanceCents === ledgerBefore.totalBalanceCents,
  `-> ${balancesAfter.totalBalanceCents} was ${ledgerBefore.totalBalanceCents}`,
);
check('the transfer is reported on both sides', fromAfter?.transferOutCents === 30_000 && toAfter?.transferInCents === 30_000);

const after = await snapshot();
check('monthly trend is byte-identical', JSON.stringify(after.trend) === JSON.stringify(before.trend));
check('category share is byte-identical', JSON.stringify(after.share) === JSON.stringify(before.share));
check('the carryover pool series is byte-identical', JSON.stringify(after.pool) === JSON.stringify(before.pool));
check('the budget overview is byte-identical', JSON.stringify(after.overview) === JSON.stringify(before.overview));
check('the ledger is byte-identical (a transfer is not a bill)', JSON.stringify(after.ledger) === JSON.stringify(before.ledger));
check(
  'the ledger really does have rows in it',
  before.ledger.total === 3,
  `-> ${before.ledger.total}`,
);

// ── 6. list, filter, edit, delete ────────────────────────────────────────────
console.log('\n[list and filter]');
const list = await get('/transfers');
check('the transfer is listed', list.total === 1 && list.items[0].id === transfer.id, `-> ${list.total}`);

const filtered = await get(`/transfers?accountId=${bank.id}`);
check('filtering by the destination account finds it', filtered.total === 1, `-> ${filtered.total}`);
const otherSide = await get(`/transfers?accountId=${ACCOUNT}`);
check('filtering by the source account finds it too', otherSide.total === 1, `-> ${otherSide.total}`);

console.log('\n[edit]');
const patched = await send('PATCH', `/transfers/${transfer.id}`, { amountCents: 10_000 });
check('edits the amount -> 200', patched.status === 200, `-> ${patched.status}`);
const afterEdit = await get('/accounts/balances');
check(
  'the source balance followed the edit',
  afterEdit.items.find((item) => item.accountId === ACCOUNT)?.balanceCents === defaultBefore - 10_000,
  `-> ${afterEdit.items.find((item) => item.accountId === ACCOUNT)?.balanceCents}`,
);
check(
  'the total is still unchanged after the edit',
  afterEdit.totalBalanceCents === ledgerBefore.totalBalanceCents,
  `-> ${afterEdit.totalBalanceCents}`,
);

const selfPatch = await send('PATCH', `/transfers/${transfer.id}`, { toAccountId: ACCOUNT });
check('refuses to make both sides the same account -> 400', selfPatch.status === 400, `-> ${selfPatch.status}`);

console.log('\n[delete]');
const removed = await send('DELETE', `/transfers/${transfer.id}`);
check('deletes the transfer -> 204', removed.status === 204, `-> ${removed.status}`);
const afterDelete = await get('/accounts/balances');
check(
  'the whole balance sheet is restored exactly',
  JSON.stringify(afterDelete) === JSON.stringify(ledgerBefore),
  JSON.stringify(afterDelete.items),
);
check('the list is empty again', (await get('/transfers')).total === 0);
check('deleting it twice is 404', (await send('DELETE', `/transfers/${transfer.id}`)).status === 404);

finish('TRANSFERS E2E');
