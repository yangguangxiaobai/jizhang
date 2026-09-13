// End-to-end statistics checks against the running container (T8).
//
// The load-bearing assertions (parent task AC5 / T8 AC1-AC4):
//   * a refund reduces net expense and NEVER appears as income;
//   * a category whose refunds cancel its spending nets to zero;
//   * a refund-dominant category is reported, not dropped;
//   * the pool series ends exactly where the budget page says it does.
//
// Usage: docker compose cp packages/server/scripts/. jizhang:/app/packages/server/scripts/
//        docker compose exec -T -w /app/packages/server/scripts jizhang node e2e-stats.mjs

import { makeChecker, resetToKnownState } from './lib/e2e-reset.mjs';

const BASE = 'http://127.0.0.1:8081/api/v1';

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
const SALARY = 'builtin-income-salary';
const ACCOUNT = 'builtin-default-account';

const accountId = (await get('/accounts')).json.items[0].id;
void accountId;

const addTxn = async (body) => {
  const response = await post('/transactions', { accountId: ACCOUNT, ...body });
  if (response.status !== 201) {
    check(`create txn ${body.note ?? body.categoryId}`, false, `-> ${response.status} ${await response.text()}`);
  }
  return response;
};

// ── category share ───────────────────────────────────────────────────────────
console.log('\n[category share]');
const WINDOW = `from=${monthStart(0)}&to=${nextMonthStart(0)}`;

await addTxn({ type: 0, amountCents: 150_000, categoryId: FOOD, date: dayIn(0, 5), note: '买菜' });
await addTxn({
  type: 0,
  amountCents: 50_000,
  categoryId: FOOD,
  date: dayIn(0, 6),
  note: '退货',
  isRefund: true,
});
await addTxn({ type: 0, amountCents: 30_000, categoryId: TRANSPORT, date: dayIn(0, 7), note: '地铁' });
await addTxn({ type: 1, amountCents: 900_000, categoryId: SALARY, date: dayIn(0, 8), note: '工资' });

let share = (await get(`/stats/category-share?${WINDOW}`)).json;
// Food 150,000 − 50,000 refund = 100,000; transport 30,000. Total 130,000.
check('AC5 net expense is reduced by the refund (130000)', share.totalCents === 130_000, `-> ${share.totalCents}`);

const food = share.items.find((i) => i.categoryId === FOOD);
check('AC5 the food category nets 100000, not 150000', food.amountCents === 100_000, `-> ${food.amountCents}`);

const salaryInShare = share.items.find((i) => i.categoryId === SALARY);
check('AC2 income does not appear in the expense share', salaryInShare === undefined);

check('the refund is NOT reported as income anywhere in the share', share.items.every((i) => i.amountCents <= 150_000));
check('items are sorted largest spend first', share.items[0].categoryId === FOOD);
check('each item carries its display name and colour', typeof food.categoryName === 'string' && typeof food.color === 'number');

// Transport becomes refund-dominant: 30,000 + 70,000 spent vs 100,000 refunded.
await addTxn({ type: 0, amountCents: 70_000, categoryId: TRANSPORT, date: dayIn(0, 9), note: '打车' });
await addTxn({
  type: 0,
  amountCents: 100_000,
  categoryId: TRANSPORT,
  date: dayIn(0, 10),
  note: '打车退款',
  isRefund: true,
});
share = (await get(`/stats/category-share?${WINDOW}`)).json;
const transport = share.items.find((i) => i.categoryId === TRANSPORT);
check('AC1 a refund-dominant category is reported, not dropped', transport !== undefined);
// 30,000 + 70,000 − 100,000 = 0, so it is listed with a zero net rather than dropped.
check('AC1 its net expense is exactly zero', transport.amountCents === 0, `-> ${transport?.amountCents}`);
check('the window total is food only (100000)', share.totalCents === 100_000, `-> ${share.totalCents}`);
check('a zero-net category keeps a 0 ratio', transport.ratio === 0);

// ── monthly trend ────────────────────────────────────────────────────────────
console.log('\n[monthly trend]');
const trend = (await get('/stats/monthly-trend?months=6')).json.items;
check('AC4 six points, one per month', trend.length === 6, `-> ${trend.length}`);

const currentMonth = trend[trend.length - 1];
check('the current month carries the income (900000)', currentMonth.incomeCents === 900_000, `-> ${currentMonth.incomeCents}`);
// Food 100,000 net + transport 0 net.
check('AC5 the current month net expense is 100000', currentMonth.netExpenseCents === 100_000, `-> ${currentMonth.netExpenseCents}`);
check('AC5 the refund never inflates income', currentMonth.incomeCents === 900_000);

const emptyMonths = trend.slice(0, 5).filter((p) => p.netExpenseCents === 0 && p.incomeCents === 0);
check('AC4 empty months are present with zeros, not missing', emptyMonths.length === 5, `-> ${emptyMonths.length}`);
check('points ascend by month label', trend[0].month < currentMonth.month, `${trend[0].month} < ${currentMonth.month}`);

// A prior-month expense must land in its own bucket.
await addTxn({ type: 0, amountCents: 12_345, categoryId: FOOD, date: dayIn(-2, 10), note: '上上月' });
const trend2 = (await get('/stats/monthly-trend?months=6')).json.items;
check('a past expense lands in its own month bucket', trend2[3].netExpenseCents === 12_345, `-> ${trend2[3].netExpenseCents}`);
check(
  'and the current month is untouched by a past-month row',
  trend2[5].netExpenseCents === 100_000,
  `-> ${trend2[5].netExpenseCents}`,
);

// ── pool trend ───────────────────────────────────────────────────────────────
console.log('\n[pool trend (the consistency contract)]');
let poolTrend = (await get('/stats/pool-trend')).json;
check('no salary yet, so the pool series is empty', poolTrend.points.length === 0);
check('and the current pool is 0', poolTrend.currentCents === 0);

// One single-module cycle, so an overrun cannot be masked by another module's
// leftover: the whole salary (100,000) is budgeted on food.
const template = await post('/templates', {
  name: '单模块',
  modules: [{ categoryId: FOOD, ratio: 1 }],
});
const templateId = (await template.json()).id;
const salary = await post('/salaries', {
  accountId: ACCOUNT,
  amountCents: 100_000,
  date: dayIn(0, 2),
  note: '本周期工资',
  templateId,
});
check('salary recorded -> 201', salary.status === 201, `-> ${salary.status}`);

await addTxn({ type: 0, amountCents: 250_000, categoryId: FOOD, date: dayIn(0, 4), note: '超支' });

// Derive the expected pool from the ledger itself rather than from a hand-written
// formula. The pool covers ALL time, and earlier sections already added spending to
// this same cycle; summing the rows also makes a lost transaction obvious.
const allRows = (await get('/transactions?limit=200')).json.items;
const foodSpentAllTime = allRows
  .filter((t) => t.categoryId === FOOD && t.type === 0)
  .reduce((sum, t) => sum + (t.isRefund ? -t.amountCents : t.amountCents), 0);
check('the overspend row exists and is counted', foodSpentAllTime > 250_000, `-> ${foodSpentAllTime}`);

poolTrend = (await get('/stats/pool-trend')).json;
const overview = (await get('/budget/overview')).json;

// budget = the 100,000 salary; the cycle's pool is that minus what was spent.
const expectedPool = 100_000 - foodSpentAllTime;
check(
  `AC3 the current pool is the overrun (${expectedPool})`,
  poolTrend.currentCents === expectedPool,
  `-> ${poolTrend.currentCents}`,
);
check('the overrun really is negative', poolTrend.currentCents < 0, `-> ${poolTrend.currentCents}`);
check(
  'AC3 the series ends exactly where the budget page says',
  poolTrend.points[poolTrend.points.length - 1].poolCents === overview.carryoverPoolCents,
  `trend=${poolTrend.points[poolTrend.points.length - 1].poolCents} budget=${overview.carryoverPoolCents}`,
);
check(
  'AC3 and matches the series own currentCents',
  poolTrend.points[poolTrend.points.length - 1].poolCents === poolTrend.currentCents,
);
check('the cycle mode is reported', poolTrend.cycle.kind === 'natural-month', JSON.stringify(poolTrend.cycle));

// ── salary income ────────────────────────────────────────────────────────────
// A salary row is not a transaction, so aggregating the ledger alone under-reports
// income. These checks pin the extended rule AND its narrow blast radius: the budget
// engine's pool must not move just because income now counts salaries.
console.log('\n[monthly income includes salaries]');
const incomeTxnTotal = allRows
  .filter((t) => t.type === 1)
  .reduce((sum, t) => sum + t.amountCents, 0);

const trendAfterSalary = (await get('/stats/monthly-trend?months=6')).json.items;
const nowAfter = trendAfterSalary[trendAfterSalary.length - 1];
// 100,000 was recorded via POST /salaries above and belongs to the current month.
check(
  'the current month income is transactions + the recorded salary',
  nowAfter.incomeCents === incomeTxnTotal + 100_000,
  `-> ${nowAfter.incomeCents} vs ${incomeTxnTotal} + 100000`,
);
check(
  'and it is strictly more than the transactions alone',
  nowAfter.incomeCents > incomeTxnTotal,
  `-> ${nowAfter.incomeCents} > ${incomeTxnTotal}`,
);

// A salary in a prior month must land in that month's bucket, not the current one.
const priorSalary = 777_000;
await post('/salaries', { accountId: ACCOUNT, amountCents: priorSalary, date: dayIn(-1, 3), note: '上月工资' });
const trendPrior = (await get('/stats/monthly-trend?months=6')).json.items;
check(
  'a prior-month salary lands in its own bucket',
  trendPrior[trendPrior.length - 2].incomeCents === priorSalary,
  `-> ${trendPrior[trendPrior.length - 2].incomeCents}`,
);
check(
  'and it does not raise the current month income',
  trendPrior[trendPrior.length - 1].incomeCents === nowAfter.incomeCents,
  `-> ${trendPrior[trendPrior.length - 1].incomeCents}`,
);

// A salary that is a pure income record must not create spending.
check(
  'salary income never becomes net expense',
  trendPrior[trendPrior.length - 2].netExpenseCents === 0,
  `-> ${trendPrior[trendPrior.length - 2].netExpenseCents}`,
);

// The budget engine reads salary allocations (as it always did), NOT this income
// rule. Adding a salary with no template allocates against the default template and
// must therefore leave the pool contract intact.
const poolAfterSalary = (await get('/stats/pool-trend')).json;
const overviewAfterSalary = (await get('/budget/overview')).json;
check(
  'AC3 the pool contract survives the income change',
  poolAfterSalary.points[poolAfterSalary.points.length - 1].poolCents ===
    overviewAfterSalary.carryoverPoolCents,
  `trend=${poolAfterSalary.points[poolAfterSalary.points.length - 1].poolCents} budget=${overviewAfterSalary.carryoverPoolCents}`,
);

// ── range + month window helpers ─────────────────────────────────────────────
console.log('\n[helpers]');
const range = (await get('/stats/range')).json;
check('range reports the earliest activity', typeof range.earliest === 'number' && range.earliest !== null);
const windowRes = (await get(`/stats/month-window?monthStart=${dayIn(0, 15)}`)).json;
check('month-window gives local month bounds', windowRes.from === monthStart(0) && windowRes.to === nextMonthStart(0));

const badMonths = await fetch(`${BASE}/stats/monthly-trend?months=abc`, { headers: auth });
check('a non-numeric month count is rejected -> 400', badMonths.status === 400, `-> ${badMonths.status}`);

// ── guard ────────────────────────────────────────────────────────────────────
console.log('\n[guard]');
for (const url of ['/stats/category-share', '/stats/monthly-trend', '/stats/pool-trend', '/stats/range']) {
  const res = await fetch(`${BASE}${url}`);
  check(`${url} requires a session`, res.status === 401, `-> ${res.status}`);
}

// ── SPA shell ────────────────────────────────────────────────────────────────
const spa = await fetch('http://127.0.0.1:8081/stats');
check('GET /stats serves the SPA shell', spa.status === 200, `-> ${spa.status}`);

finish('STATS E2E');
