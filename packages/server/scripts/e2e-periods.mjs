// End-to-end historical-cycle review checks against the running container (T14).
//
// The load-bearing checks (task AC1-AC9):
//   * a past cycle can be reviewed and returns THAT cycle's figures, not the current
//     one relabelled;
//   * spending from a neighbouring cycle does not leak across the boundary;
//   * an unknown period is refused (400) rather than silently answered with the current
//     cycle — showing one month's numbers under another month's heading is worse than
//     an error;
//   * asking for the newest period explicitly is byte-identical to omitting it, which is
//     what proves the new parameter did not fork the existing code path;
//   * the period list agrees with the pool-trend series (anti-drift).
//
// All dates are derived from the current date going BACKWARDS: the server rejects a
// salary dated in the future, so a hard-coded month would fail depending on when this
// runs.
//
// Usage: docker compose cp packages/server/scripts/. jizhang:/app/packages/server/scripts/
//        docker compose exec -T -w /app/packages/server/scripts jizhang node e2e-periods.mjs

import { makeChecker, resetToKnownState } from './lib/e2e-reset.mjs';

const BASE = 'http://127.0.0.1:8081/api/v1';

const { check, finish } = makeChecker();

const { authHeaders: auth, jsonHeaders, csrfOnlyHeaders } = await resetToKnownState();

const get = async (url) => {
  const response = await fetch(`${BASE}${url}`, { headers: auth });
  return { status: response.status, json: await response.json() };
};
/** No body is ever sent here, so the CSRF header goes WITHOUT `Content-Type`. */
const post = async (url, body) =>
  fetch(`${BASE}${url}`, {
    method: 'POST',
    headers: body === undefined ? csrfOnlyHeaders : jsonHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const now = new Date();
/** A local timestamp `day` days into the month `offset` months from now. */
const dayIn = (offset, day) =>
  new Date(now.getFullYear(), now.getMonth() + offset, day).getTime();
const label = (epochMs) => {
  const date = new Date(epochMs);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

const FOOD = 'builtin-expense-food';
const TRANSPORT = 'builtin-expense-transport';
const ACCOUNT = 'builtin-default-account';

const addTxn = async (body) => {
  const response = await post('/transactions', { accountId: ACCOUNT, ...body });
  if (response.status !== 201) {
    check(`create txn ${body.note ?? body.categoryId}`, false, `-> ${response.status} ${await response.text()}`);
  }
  return response;
};

// ── no cycles at all ─────────────────────────────────────────────────────────
console.log('\n[empty]');
const emptyPeriods = await get('/budget/periods');
check('AC5 an empty ledger answers 200', emptyPeriods.status === 200, `-> ${emptyPeriods.status}`);
check('AC5 with no periods', emptyPeriods.json.periods.length === 0, `-> ${emptyPeriods.json.periods.length}`);
check('AC5 and a null current period', emptyPeriods.json.currentPeriodStart === null, `-> ${emptyPeriods.json.currentPeriodStart}`);
check('AC5 the cycle mode is reported', emptyPeriods.json.cycle.kind === 'natural-month', JSON.stringify(emptyPeriods.json.cycle));

// ── two past cycles and the current one ──────────────────────────────────────
console.log('\n[build three cycles]');
// Cycle A: budget 300,000 food + 200,000 transport, spends 200,000 food.
const salaryA = await post('/salaries', {
  amountCents: 500_000,
  date: dayIn(-2, 3),
  allocations: [
    { categoryId: FOOD, amountCents: 300_000 },
    { categoryId: TRANSPORT, amountCents: 200_000 },
  ],
});
check('AC1 the oldest salary was accepted', salaryA.status === 201, `-> ${salaryA.status}`);
await addTxn({ type: 0, amountCents: 200_000, categoryId: FOOD, date: dayIn(-2, 12), note: '旧周期买菜' });

// Cycle B: budget 400,000 food + 600,000 transport, spends 120,000 food.
const salaryB = await post('/salaries', {
  amountCents: 1_000_000,
  date: dayIn(-1, 5),
  allocations: [
    { categoryId: FOOD, amountCents: 400_000 },
    { categoryId: TRANSPORT, amountCents: 600_000 },
  ],
});
check('the middle salary was accepted', salaryB.status === 201, `-> ${salaryB.status}`);
await addTxn({ type: 0, amountCents: 120_000, categoryId: FOOD, date: dayIn(-1, 10), note: '中周期买菜' });

// Current cycle: budget 1,000,000 food.
const salaryC = await post('/salaries', {
  amountCents: 1_000_000,
  date: dayIn(0, 2),
  allocations: [{ categoryId: FOOD, amountCents: 1_000_000 }],
});
check('the current salary was accepted', salaryC.status === 201, `-> ${salaryC.status}`);

const periods = (await get('/budget/periods')).json;
check('AC5 three periods are listed', periods.periods.length === 3, `-> ${periods.periods.length}`);
check(
  'AC5 they ascend',
  periods.periods[0] < periods.periods[1] && periods.periods[1] < periods.periods[2],
  `-> ${periods.periods.join(', ')}`,
);
check(
  'AC5 the current period is the newest',
  periods.currentPeriodStart === periods.periods[2],
  `-> ${periods.currentPeriodStart}`,
);
// The identifier is the earliest SALARY DAY in the cycle, not the 1st of the month.
check(
  'AC5 a period start is the earliest salary day, not the first of the month',
  new Date(periods.periods[0]).getDate() === 3,
  `-> day ${new Date(periods.periods[0]).getDate()}`,
);
check(
  'AC5 the list is labelled as expected',
  periods.periods.map(label).join(',') ===
    [dayIn(-2, 3), dayIn(-1, 5), dayIn(0, 2)].map(label).join(','),
  `-> ${periods.periods.map(label).join(', ')}`,
);

// ── the anti-drift contract ──────────────────────────────────────────────────
console.log('\n[period list vs pool trend]');
const trend = (await get('/stats/pool-trend')).json;
check(
  'AC7 the period list equals the pool-trend series, point for point',
  periods.periods.join(',') === trend.points.map((point) => point.periodStart).join(','),
  `periods=${periods.periods.length} trend=${trend.points.length}`,
);

// ── reviewing the oldest cycle ───────────────────────────────────────────────
console.log('\n[review the oldest cycle]');
const oldest = periods.periods[0];
const currentOverview = (await get('/budget/overview')).json;
const historical = (await get(`/budget/overview?periodStart=${oldest}`)).json;

const histFood = historical.modules.find((m) => m.categoryId === FOOD);
const histTransport = historical.modules.find((m) => m.categoryId === TRANSPORT);
check('AC1 the oldest cycle budget is 500000', historical.totalBudgetCents === 500_000, `-> ${historical.totalBudgetCents}`);
check('AC1 its spend is 200000', historical.totalSpentCents === 200_000, `-> ${historical.totalSpentCents}`);
check('AC1 the food module carries its own budget', histFood?.budgetCents === 300_000, `-> ${histFood?.budgetCents}`);
check('AC1 and its own spend', histFood?.spentCents === 200_000, `-> ${histFood?.spentCents}`);
check('AC1 the transport module is present and untouched', histTransport?.budgetCents === 200_000, `-> ${histTransport?.budgetCents}`);
check('AC1 transport has no spend of its own', histTransport?.spentCents === 0, `-> ${histTransport?.spentCents}`);

// The proof it is a different cycle rather than the current one relabelled.
check(
  'AC1 the historical figures DIFFER from the current cycle',
  historical.totalBudgetCents !== currentOverview.totalBudgetCents ||
    historical.totalSpentCents !== currentOverview.totalSpentCents,
  `hist=${historical.totalBudgetCents}/${historical.totalSpentCents} current=${currentOverview.totalBudgetCents}/${currentOverview.totalSpentCents}`,
);
check(
  'AC1 no neighbouring spending leaked in (200000, not 320000)',
  historical.totalSpentCents === 200_000,
  `-> ${historical.totalSpentCents}`,
);
check(
  'AC1 the modules carry category names, as the live overview does',
  typeof histFood?.categoryName === 'string' && histFood.categoryName.length > 0,
  `-> ${histFood?.categoryName}`,
);

// ── reviewing the middle cycle ───────────────────────────────────────────────
console.log('\n[review the middle cycle]');
const middle = (await get(`/budget/overview?periodStart=${periods.periods[1]}`)).json;
check('AC1 the middle cycle budget is 1000000', middle.totalBudgetCents === 1_000_000, `-> ${middle.totalBudgetCents}`);
check('AC1 its spend is 120000', middle.totalSpentCents === 120_000, `-> ${middle.totalSpentCents}`);
check(
  'AC1 the two historical cycles report different numbers',
  middle.totalBudgetCents !== historical.totalBudgetCents,
  `middle=${middle.totalBudgetCents} oldest=${historical.totalBudgetCents}`,
);

// ── AC2: an overspent historical module is reported, not clamped ─────────────
console.log('\n[overspend inside a historical cycle]');
await addTxn({ type: 0, amountCents: 250_000, categoryId: TRANSPORT, date: dayIn(-2, 20), note: '旧周期打车超支' });
const overspent = (await get(`/budget/overview?periodStart=${oldest}`)).json;
const transportAfter = overspent.modules.find((m) => m.categoryId === TRANSPORT);
check(
  'AC2 the historical transport module is now over budget',
  transportAfter.spentCents > transportAfter.budgetCents,
  `${transportAfter.spentCents} vs ${transportAfter.budgetCents}`,
);
check(
  'AC2 its remaining is negative, not clamped to zero',
  transportAfter.remainingCents < 0,
  `-> ${transportAfter.remainingCents}`,
);
check(
  'AC2 the cycle total reflects it',
  overspent.totalSpentCents === 200_000 + 250_000,
  `-> ${overspent.totalSpentCents}`,
);

// ── AC2: the pool of a historical cycle ──────────────────────────────────────
console.log('\n[historical carryover pool]');
check(
  'AC2 the historical pool matches the trend point for that cycle',
  overspent.carryoverPoolCents ===
    (await get('/stats/pool-trend')).json.points.find((p) => p.periodStart === oldest)?.poolCents,
  `overview=${overspent.carryoverPoolCents}`,
);

// ── AC3: invalid input is refused ────────────────────────────────────────────
console.log('\n[invalid period input]');
const unknown = await get(`/budget/overview?periodStart=${new Date(2000, 0, 1).getTime()}`);
check('AC3 an unknown period -> 400', unknown.status === 400, `-> ${unknown.status}`);
check('AC3 with a VALIDATION code', unknown.json.error?.code === 'VALIDATION', `-> ${unknown.json.error?.code}`);
check(
  'AC3 and a human-readable reason',
  /unknown budget period/i.test(unknown.json.error?.message ?? ''),
  `-> ${unknown.json.error?.message}`,
);
// The point of the 400: it must NOT quietly answer with the current cycle's numbers.
check(
  'AC3 the response carries no modules at all',
  unknown.json.modules === undefined,
  `-> ${JSON.stringify(unknown.json).slice(0, 80)}`,
);

const notANumber = await get('/budget/overview?periodStart=abc');
check('AC3 a non-numeric period -> 400', notANumber.status === 400, `-> ${notANumber.status}`);
check('AC3 with a VALIDATION code', notANumber.json.error?.code === 'VALIDATION', `-> ${notANumber.json.error?.code}`);

// ── AC4: the omitted path is untouched ───────────────────────────────────────
console.log('\n[the default path is unchanged]');
const omitted = (await get('/budget/overview')).json;
const emptyParam = (await get('/budget/overview?periodStart=')).json;
check(
  'AC4 an empty periodStart equals omitting it, field for field',
  JSON.stringify(emptyParam) === JSON.stringify(omitted),
);

const newestExplicit = (await get(`/budget/overview?periodStart=${periods.currentPeriodStart}`)).json;
check(
  'AC4 asking for the newest period explicitly equals omitting it, field for field',
  JSON.stringify(newestExplicit) === JSON.stringify(omitted),
  `explicit=${newestExplicit.totalBudgetCents}/${newestExplicit.carryoverPoolCents} omitted=${omitted.totalBudgetCents}/${omitted.carryoverPoolCents}`,
);

// A timestamp carrying a time of day must resolve to the same cycle: the engine's key is
// date-normalised.
const withTime = (
  await get(`/budget/overview?periodStart=${oldest + 13 * 3_600_000}`)
).json;
check(
  'AC4 a time-of-day timestamp resolves to the same cycle',
  JSON.stringify(withTime) === JSON.stringify(overspent),
  `-> ${withTime.totalBudgetCents}`,
);

// ── guard ────────────────────────────────────────────────────────────────────
console.log('\n[guard]');
const signedOut = await fetch(`${BASE}/budget/periods`);
check('GET /budget/periods requires a session -> 401', signedOut.status === 401, `-> ${signedOut.status}`);
const signedOutOverview = await fetch(`${BASE}/budget/overview?periodStart=${oldest}`);
check('GET /budget/overview requires a session -> 401', signedOutOverview.status === 401, `-> ${signedOutOverview.status}`);

finish('PERIODS E2E');
