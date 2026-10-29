import { checkRetiredWeb } from './lib/retired-web.mjs';
// End-to-end checks for the home dashboard (09-11-home-dashboard).
//
// The dashboard is a pure reader: it adds no endpoint. What it *does* add is a
// contract — the figures it shows must equal the figures the budget page and the
// charts page show, because the user will notice instantly if they differ. Since the
// client renders rather than computes, that contract is verifiable over HTTP by
// comparing the same three endpoints the dashboard and the other pages call.
//
// Also pinned here: monthly income counts recorded salaries (the change this task
// made to `monthlyTrend`), and the "recent transactions" query the dashboard relies on
// returns newest-first at its own limit.
//
// Run only against an isolated disposable ledger: resetToKnownState clears ledger data.
// This suite does not test native offline behavior and must not target production.

import { makeChecker, resetToKnownState } from './lib/e2e-reset.mjs';

const BASE = 'http://127.0.0.1:8081/api/v1';
const ORIGIN = 'http://127.0.0.1:8081';

const { check, finish } = makeChecker();

const { authHeaders: auth, jsonHeaders } = await resetToKnownState();

const get = async (url) => {
  const response = await fetch(`${BASE}${url}`, { headers: auth });
  return { status: response.status, json: await response.json() };
};
const post = async (url, body) =>
  fetch(`${BASE}${url}`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });

const now = new Date();
const dayIn = (monthOffset, day) =>
  new Date(now.getFullYear(), now.getMonth() + monthOffset, day).getTime();
const monthStart = (monthOffset) =>
  new Date(now.getFullYear(), now.getMonth() + monthOffset, 1).getTime();
const nextMonthStart = (monthOffset) =>
  new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 1).getTime();

const FOOD = 'builtin-expense-food';
const TRANSPORT = 'builtin-expense-transport';
const SALARY_TXN = 'builtin-income-salary';
const REFUND = 'builtin-income-refund';
const ACCOUNT = 'builtin-default-account';

const addTxn = async (body) => {
  const response = await post('/transactions', { accountId: ACCOUNT, ...body });
  if (response.status !== 201) {
    check(
      `create txn ${body.note ?? body.categoryId}`,
      false,
      `-> ${response.status} ${await response.text()}`,
    );
  }
  return response;
};

// ── the empty dashboard ──────────────────────────────────────────────────────
// The guidance state the dashboard shows before the user has done anything. It must
// be reportable, not a wall of zeros.
console.log('\n[empty ledger]');
const emptyTrend = (await get('/stats/monthly-trend?months=1')).json;
check('an empty ledger reports exactly one month point', emptyTrend.items.length === 1, `-> ${emptyTrend.items.length}`);
check('with zero income', emptyTrend.items[0].incomeCents === 0, `-> ${emptyTrend.items[0].incomeCents}`);
check('and zero net expense', emptyTrend.items[0].netExpenseCents === 0, `-> ${emptyTrend.items[0].netExpenseCents}`);

const emptyOverview = (await get('/budget/overview')).json;
check(
  'the budget card has nothing to show, so the dashboard guides instead',
  emptyOverview.hasBudget === false,
  `-> ${emptyOverview.hasBudget}`,
);
check('with no modules', emptyOverview.modules.length === 0, `-> ${emptyOverview.modules.length}`);
check('and a zero pool', emptyOverview.carryoverPoolCents === 0, `-> ${emptyOverview.carryoverPoolCents}`);

const emptyRecent = (await get('/transactions?limit=5')).json;
check('the recent list is empty', emptyRecent.items.length === 0, `-> ${emptyRecent.items.length}`);

// ── the month the dashboard labels ───────────────────────────────────────────
// The dashboard takes the header month from the point the server returns rather than
// from its own clock, so that label and figures cannot disagree.
console.log('\n[the current month is the server\'s month]');
const trend = (await get('/stats/monthly-trend?months=1')).json;
check(
  'the single point starts at the local first of this month',
  trend.items[0].monthStart === monthStart(0),
  `-> ${trend.items[0].monthStart} vs ${monthStart(0)}`,
);
const window = (await get(`/stats/month-window?monthStart=${trend.items[0].monthStart}`)).json;
check(
  'and the month window helper agrees with it',
  window.from === monthStart(0) && window.to === nextMonthStart(0),
  `-> ${window.from}..${window.to}`,
);

// ── the figures the dashboard shows ──────────────────────────────────────────
console.log('\n[dashboard figures]');
await addTxn({ type: 0, amountCents: 150_000, categoryId: FOOD, date: dayIn(0, 5), note: '买菜' });
await addTxn({ type: 1, amountCents: 40_000, categoryId: REFUND, date: dayIn(0, 6), note: '退款', isRefund: true });
await addTxn({ type: 0, amountCents: 30_000, categoryId: TRANSPORT, date: dayIn(0, 7), note: '打车' });
await addTxn({ type: 1, amountCents: 200_000, categoryId: SALARY_TXN, date: dayIn(0, 8), note: '兼职收入' });
// Deliberately in a prior month: it must not leak into the current month's figures.
await addTxn({ type: 0, amountCents: 999_999, categoryId: FOOD, date: dayIn(-1, 6), note: '上月大额' });

const salaryAmount = 1_000_000;
const salaryResponse = await post('/salaries', {
  accountId: ACCOUNT,
  amountCents: salaryAmount,
  date: dayIn(0, 2),
  note: '本月工资',
});
check('salary recorded -> 201', salaryResponse.status === 201, `-> ${salaryResponse.status}`);

const summary = (await get('/stats/monthly-trend?months=1')).json.items[0];
// Income: 200,000 transaction + 40,000 refund + 1,000,000 salary. Expense: 150,000 + 30,000 (gross).
check(
  'income is the income transaction plus the refund plus the recorded salary',
  summary.incomeCents === 1_240_000,
  `-> ${summary.incomeCents}`,
);
check(
  'net expense is the month spend gross',
  summary.netExpenseCents === 180_000,
  `-> ${summary.netExpenseCents}`,
);
check(
  'a prior-month expense stays out of this month',
  summary.netExpenseCents !== 999_999 + 180_000,
  `-> ${summary.netExpenseCents}`,
);

// The dashboard reads the same endpoint the charts page reads, so equality here is
// what makes AC2 ("the two pages agree to the cent") true by construction.
const chartsTrend = (await get('/stats/monthly-trend?months=6')).json.items;
const chartsCurrent = chartsTrend[chartsTrend.length - 1];
check(
  'AC2 the dashboard month equals the charts page month',
  chartsCurrent.incomeCents === summary.incomeCents &&
    chartsCurrent.netExpenseCents === summary.netExpenseCents,
  `dashboard=${summary.incomeCents}/${summary.netExpenseCents} charts=${chartsCurrent.incomeCents}/${chartsCurrent.netExpenseCents}`,
);

// Balance is the one subtraction the dashboard performs, on two server values.
const balance = summary.incomeCents - summary.netExpenseCents;
check('the month balance is income minus net expense', balance === 1_060_000, `-> ${balance}`);

// ── the budget card ──────────────────────────────────────────────────────────
// The dashboard shows the cycle totals the budget page shows. The default template
// allocates the whole salary, so the cycle's budget is exactly the salary.
console.log('\n[budget card]');
const overview = (await get('/budget/overview')).json;
check('the cycle now has a budget', overview.hasBudget === true, `-> ${overview.hasBudget}`);
check(
  'AC3 the cycle budget is the recorded salary',
  overview.totalBudgetCents === salaryAmount,
  `-> ${overview.totalBudgetCents}`,
);
check(
  'the cycle spend covers every module of this cycle',
  overview.totalSpentCents === 180_000,
  `-> ${overview.totalSpentCents}`,
);
check(
  'the remaining is budget minus spend',
  overview.totalBudgetCents - overview.totalSpentCents === salaryAmount - 180_000,
  `-> ${overview.totalBudgetCents - overview.totalSpentCents}`,
);
check(
  'AC3 the budget page and the dashboard read one overview',
  overview.totalBudgetCents === salaryAmount && overview.hasBudget === true,
);

// The alert the dashboard shows is driven by `overBudgetModules` and a negative pool,
// independently. This cycle's modules are all within budget, so no module alert fires
// even though the pool IS negative — the prior month was left overspent, and a closed
// cycle's shortfall is carried in the pool. Asserting both separately is the point:
// a naive `pool >= 0` check here would have called correct engine output a bug.
const overspentModules = overview.modules.filter((m) => m.spentCents > m.budgetCents);
check(
  'no module of this cycle is over budget',
  overspentModules.length === 0,
  `-> ${overspentModules.map((m) => m.categoryName).join(',')}`,
);
check(
  'the pool is negative because the PRIOR month was overspent',
  overview.carryoverPoolCents === -999_999,
  `-> ${overview.carryoverPoolCents}`,
);
check(
  'so the dashboard has a pool alert but no module alert',
  overspentModules.length === 0 && overview.carryoverPoolCents < 0,
);

// ── the recent list ──────────────────────────────────────────────────────────
// The dashboard asks for 5 and relies on the server's ordering. This is the check
// that the query it uses actually means "the newest five, newest first".
console.log('\n[recent transactions]');
const recent = (await get('/transactions?limit=5')).json;
check('the limit is honoured', recent.items.length === 5, `-> ${recent.items.length}`);
check('the total reports everything', recent.total === 5, `-> ${recent.total}`);

const dates = recent.items.map((t) => t.date);
let descending = true;
for (let index = 1; index < dates.length; index += 1) {
  if (dates[index] > dates[index - 1]) descending = false;
}
check('rows come back newest first', descending, `-> ${dates.join(',')}`);
check(
  'and the newest row is the most recent activity',
  recent.items[0].note === '兼职收入',
  `-> ${recent.items[0].note}`,
);
check(
  'the prior-month row is present but last',
  recent.items[recent.items.length - 1].note === '上月大额',
  `-> ${recent.items[recent.items.length - 1].note}`,
);

// Two rows sharing a date must fall back to `updatedAt` descending, which is the
// ordering the reference dashboard used and the dashboard therefore displays.
//
// The date is derived BACKWARDS from today: a salary or transaction dated in the
// future is rejected on purpose (it catches a mistyped year), so a hard-coded day of
// the month would make this suite pass or fail depending on when it runs.
const tiedDate = dayIn(0, 9);
check('the tie-break date is in the past, not the future', tiedDate < Date.now(), `-> ${new Date(tiedDate).toISOString()}`);
const firstTie = await addTxn({ type: 0, amountCents: 100, categoryId: FOOD, date: tiedDate, note: '同一天A' });
const secondTie = await addTxn({ type: 0, amountCents: 200, categoryId: FOOD, date: tiedDate, note: '同一天B' });
check('both same-day rows were created', firstTie.status === 201 && secondTie.status === 201);
const tied = (await get('/transactions?limit=2')).json;
check(
  'same-day rows are ordered by updatedAt descending',
  tied.items[0].note === '同一天B' && tied.items[1].note === '同一天A',
  `-> ${tied.items.map((t) => t.note).join(',')}`,
);

// A limit of 1 must stay a limit of 1 — the dashboard's 5 must not silently grow.
const one = (await get('/transactions?limit=1')).json;
check('a limit of 1 returns exactly 1 row', one.items.length === 1, `-> ${one.items.length}`);

// Former Web routes are retired.
await checkRetiredWeb(check, ['/', '/transactions'], ORIGIN);

const apiUnknown = await fetch(`${BASE}/definitely-not-a-route`, { headers: auth });
check(
  'an unknown /api path still answers JSON',
  apiUnknown.headers.get('content-type')?.includes('json') === true,
  `-> ${apiUnknown.headers.get('content-type')}`,
);

const health = await fetch(`${BASE}/health`);
check('health is unaffected', health.status === 200, `-> ${health.status}`);

// ── guard ────────────────────────────────────────────────────────────────────
console.log('\n[guard]');
for (const url of ['/stats/monthly-trend', '/budget/overview', '/transactions?limit=5']) {
  const response = await fetch(`${BASE}${url}`);
  check(`${url} requires a session`, response.status === 401, `-> ${response.status}`);
}

finish('HOME E2E');
