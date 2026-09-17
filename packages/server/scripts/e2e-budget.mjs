// End-to-end budget envelope flow against the running container: the core loop the
// whole product exists for (parent task AC2/AC3/AC4/AC5).
//
// All dates are derived from the CURRENT date going backwards, because the server
// rejects salary dates more than a day in the future. Hard-coding future months
// makes the suite fail purely because of when it is run.
//
// Usage: docker compose cp packages/server/scripts/e2e-budget.mjs jizhang:/app/packages/server/
//        docker compose exec -T -w /app/packages/server jizhang node e2e-budget.mjs

import { makeChecker, resetToKnownState } from './lib/e2e-reset.mjs';

const BASE = 'http://127.0.0.1:8081/api/v1';

const { check, finish } = makeChecker();

// Every suite starts from the same known state; see scripts/lib/e2e-reset.mjs.
const { cookie, authHeaders: auth, jsonHeaders, csrfOnlyHeaders } =
  await resetToKnownState();

// Three consecutive PAST months: [twoMonthsAgo, lastMonth, thisMonth].
const now = new Date();
const monthStart = (offset) =>
  new Date(now.getFullYear(), now.getMonth() + offset, 1);
/** A day inside the month `offset` months from now, safely in the past. */
const dayIn = (offset, day) =>
  new Date(now.getFullYear(), now.getMonth() + offset, day).getTime();

const M2 = monthStart(-2); // oldest budget cycle
const M1 = monthStart(-1); // middle cycle
const M0 = monthStart(0); // current cycle
const label = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
console.log(`months under test: ${label(M2)} (oldest), ${label(M1)}, ${label(M0)} (current)`);

async function post(url, body) {
  return fetch(`${BASE}${url}`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
}
async function put(url, body) {
  return fetch(`${BASE}${url}`, {
    method: 'PUT',
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
}
async function get(url) {
  const res = await fetch(`${BASE}${url}`, { headers: auth });
  return { status: res.status, json: await res.json() };
}

const categories = (await get('/categories')).json.items;
const foodId = categories.find((c) => c.name === '餐饮').id;
const transportId = categories.find((c) => c.name === '交通').id;
const accountId = (await get('/accounts')).json.items[0].id;

let overview = (await get('/budget/overview')).json;
const foodModule = () => overview.modules.find((m) => m.categoryId === foodId);
const transportModule = () => overview.modules.find((m) => m.categoryId === transportId);

// ── AC3: recording a salary generates module budgets from the template ───────
console.log(`\n[AC3] record a salary in ${label(M2)} -> module budgets appear`);
const salary = await post('/salaries', {
  accountId,
  amountCents: 1_000_000,
  date: dayIn(-2, 5),
  note: `${label(M2)} 工资`,
});
check('POST /salaries -> 201', salary.status === 201, `-> ${salary.status}`);
const salaryBody = await salary.json();
check(
  'allocation adds up to the salary',
  salaryBody.allocations?.reduce((s, a) => s + a.amountCents, 0) === 1_000_000,
  JSON.stringify(salaryBody.allocations ?? salaryBody),
);

overview = (await get('/budget/overview')).json;
check('budget overview reports a budget', overview.hasBudget === true);
check(
  'total budget equals the salary',
  overview.totalBudgetCents === 1_000_000,
  `-> ${overview.totalBudgetCents}`,
);
check('餐饮 module budgeted 4000 yuan (40%)', foodModule()?.budgetCents === 400_000, `-> ${foodModule()?.budgetCents}`);
check('餐饮 named for the UI', foodModule()?.categoryName === '餐饮');

// ── AC2: a spend reduces the matching module ─────────────────────────────────
console.log('\n[AC2] record an expense -> the matching module is consumed');
await post('/transactions', {
  type: 0,
  amountCents: 150_000,
  categoryId: foodId,
  accountId,
  date: dayIn(-2, 10),
  note: '买菜',
});
overview = (await get('/budget/overview')).json;
check('餐饮 spent increased to 1500 yuan', foodModule()?.spentCents === 150_000, `-> ${foodModule()?.spentCents}`);
check('餐饮 remaining is 2500 yuan', foodModule()?.remainingCents === 250_000, `-> ${foodModule()?.remainingCents}`);
check('交通 untouched by a 餐饮 expense', transportModule()?.spentCents === 0);

// ── AC5: a refund counts as income and does not reduce the module spend ──────
console.log('\n[AC5] record a refund in the income tab -> spend stays gross');
const refundCategoryId = (await get('/categories?type=1')).json.items.find(
  (/** @type {{ id: string, name: string }} */ c) => c.id === 'builtin-income-refund',
)?.id;
check('退款 income category is seeded', typeof refundCategoryId === 'string');
await post('/transactions', {
  type: 1,
  amountCents: 50_000,
  categoryId: refundCategoryId,
  accountId,
  date: dayIn(-2, 11),
  note: '退货',
  isRefund: true,
});
overview = (await get('/budget/overview')).json;
check(
  '餐饮 spend is gross (1500 yuan, refund no longer deducts)',
  foodModule()?.spentCents === 150_000,
  `-> ${foodModule()?.spentCents}`,
);
const refundOnExpense = await post('/transactions', {
  type: 0,
  amountCents: 100,
  categoryId: foodId,
  accountId,
  date: dayIn(-2, 11),
  isRefund: true,
});
check(
  'a refund cannot be attached to an expense row -> 400',
  refundOnExpense.status === 400,
  `-> ${refundOnExpense.status}`,
);

// ── AC4: overspend inside the current cycle is borrowed from the pool ────────
console.log('\n[AC4] overspend -> the pool goes negative (borrowing)');
await post('/transactions', {
  type: 0,
  amountCents: 450_000,
  categoryId: foodId,
  accountId,
  date: dayIn(-2, 12),
  note: '大额支出',
});
overview = (await get('/budget/overview')).json;
check(
  '餐饮 is over budget',
  foodModule().spentCents > foodModule().budgetCents,
  `spent=${foodModule().spentCents} budget=${foodModule().budgetCents}`,
);
// 餐饮: budget 400,000, spent 150,000 + 450,000 = 600,000 (gross) -> borrowed 200,000.
check('pool is negative from that borrow', overview.carryoverPoolCents === -200_000, `-> ${overview.carryoverPoolCents}`);

// ── AC4: a new cycle closes the old one and its leftover enters the pool ─────
console.log(`\n[AC4] start a new cycle in ${label(M1)} -> ${label(M2)} leftover moves to the pool`);
await post('/salaries', { accountId, amountCents: 1_000_000, date: dayIn(-1, 5), note: `${label(M1)} 工资` });
overview = (await get('/budget/overview')).json;
check('current cycle has no spending yet', foodModule()?.spentCents === 0, `-> ${foodModule()?.spentCents}`);

// The pool is per-cycle NET, so a fully-allocated cycle that overspent one module is
// still positive when other modules went untouched. Spend is gross now (the refund is
// income):
//   budget 1,000,000 - spent 600,000 = 400,000.
check(
  'pool reflects the net leftover of the closed cycle (400000)',
  overview.carryoverPoolCents === 400_000,
  `-> ${overview.carryoverPoolCents}`,
);

// ── AC4: a single-module budget makes an overrun actually drain the pool ─────
console.log(`\n[AC4] single-module cycle in ${label(M0)} -> the overrun drains the pool`);
const single = await post('/templates', {
  name: '单模块',
  modules: [{ categoryId: foodId, ratio: 1 }],
});
const singleTemplate = await single.json();
check('created a single-module template', single.status === 201, `-> ${single.status}`);

const octoberSalary = await post('/salaries', {
  accountId,
  amountCents: 100_000,
  date: dayIn(0, 1),
  note: `${label(M0)} 工资`,
  templateId: singleTemplate.id,
});
check('salary honours the explicit templateId -> 201', octoberSalary.status === 201, `-> ${octoberSalary.status}`);
const octoberBody = await octoberSalary.json();
check(
  'the whole salary is allocated to one module',
  octoberBody.allocations?.length === 1 && octoberBody.allocations[0].amountCents === 100_000,
  JSON.stringify(octoberBody.allocations ?? octoberBody),
);

await post('/transactions', {
  type: 0,
  amountCents: 200_000,
  categoryId: foodId,
  accountId,
  date: dayIn(0, 2),
  note: '超支',
});
overview = (await get('/budget/overview')).json;
check(
  'current cycle is over budget by 1000 yuan',
  foodModule()?.remainingCents === -100_000,
  `-> ${foodModule()?.remainingCents}`,
);
// Two cycles are now closed, so the pool is their combined net leftover:
//   oldest cycle: 1,000,000 budget - 600,000 spent (gross) =   400,000
//   middle cycle: 1,000,000 budget - 0 spent               = 1,000,000
//   current cycle borrow                                   =  -100,000
//                                                         ---------
//                                                          1,300,000
check(
  'pool = both closed cycles net of the current borrow (1300000)',
  overview.carryoverPoolCents === 1_300_000,
  `-> ${overview.carryoverPoolCents}`,
);

// ── AC7: cycle start day ────────────────────────────────────────────────────
console.log('\n[AC7] cycle start day 10 -> boundary-relative accounting');
check('cycle start day defaults to null', (await get('/settings')).json.cycleStartDay === null);

const badDay = await put('/settings', { cycleStartDay: 29 });
check('rejects day 29 -> 400', badDay.status === 400, `-> ${badDay.status}`);

await put('/settings', { cycleStartDay: 10 });
check('accepts day 10', (await get('/settings')).json.cycleStartDay === 10);
overview = (await get('/budget/overview')).json;
check(
  'overview reflects start-day mode',
  overview.cycle.kind === 'start-day' && overview.cycle.day === 10,
  JSON.stringify(overview.cycle),
);

// ── AC10/AC11: templates ────────────────────────────────────────────────────
console.log('\n[AC11] templates');
const templates = (await get('/templates')).json.items;
check('a default template is always present', templates.some((t) => t.isDefault));

const badSum = await post('/templates', {
  name: 'bad',
  modules: [
    { categoryId: foodId, ratio: 0.4 },
    { categoryId: transportId, ratio: 0.3 },
  ],
});
check('rejects ratios that do not sum to 100% -> 400', badSum.status === 400, `-> ${badSum.status}`);

const dup = await post('/templates', {
  name: 'dup',
  modules: [
    { categoryId: foodId, ratio: 0.5 },
    { categoryId: foodId, ratio: 0.5 },
  ],
});
check('rejects a repeated category -> 400', dup.status === 400, `-> ${dup.status}`);

const balanced = await post('/templates', {
  name: '五五分',
  modules: [
    { categoryId: foodId, ratio: 0.5 },
    { categoryId: transportId, ratio: 0.5 },
  ],
});
check('creates a valid template -> 201', balanced.status === 201, `-> ${balanced.status}`);
const balancedTemplate = await balanced.json();

check('sets it as default', (await post(`/templates/${balancedTemplate.id}/default`, {})).status === 200);
const defaults = (await get('/templates')).json.items.filter((t) => t.isDefault);
check('exactly one default remains', defaults.length === 1 && defaults[0].id === balancedTemplate.id);

const deleteDefault = await fetch(`${BASE}/templates/${balancedTemplate.id}`, {
  method: 'DELETE',
  headers: csrfOnlyHeaders,
});
check('the default template cannot be deleted -> 400', deleteDefault.status === 400, `-> ${deleteDefault.status}`);

// ── guard ───────────────────────────────────────────────────────────────────
console.log('\n[guard]');
check('budget overview requires a session', (await fetch(`${BASE}/budget/overview`)).status === 401);
check('salaries require a session', (await fetch(`${BASE}/salaries`)).status === 401);
const noCsrf = await fetch(`${BASE}/salaries`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({ amountCents: 100, date: dayIn(0, 1) }),
});
check('recording a salary requires the CSRF header -> 403', noCsrf.status === 403, `-> ${noCsrf.status}`);

// ── SPA shells ──────────────────────────────────────────────────────────────
for (const path of ['/budget', '/salary/new', '/templates']) {
  const res = await fetch(`http://127.0.0.1:8081${path}`);
  check(`GET ${path} serves the SPA shell`, res.status === 200, `-> ${res.status}`);
}

finish('BUDGET E2E');
