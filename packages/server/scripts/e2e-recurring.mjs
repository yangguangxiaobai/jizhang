// End-to-end recurring-bill checks against the running container (T13).
//
// The load-bearing checks (task AC1-AC9):
//   * a due rule produces PENDING items and posts nothing by itself;
//   * confirming creates exactly one bill, and confirming again creates NO second bill
//     (double-counted money is the failure a user cannot see);
//   * ignoring creates nothing and does not come back;
//   * disabling stops new items without stranding the ones already queued;
//   * an over-long backlog is capped and FLAGGED rather than silently dropped.
//
// All dates are derived from the current date going BACKWARDS, because the server rejects
// an anchor in the future.
//
// Usage: docker compose cp packages/server/scripts/. jizhang:/app/packages/server/scripts/
//        docker compose exec -T -w /app/packages/server/scripts jizhang node e2e-recurring.mjs

import { makeChecker, resetToKnownState } from './lib/e2e-reset.mjs';

const BASE = 'http://127.0.0.1:8081/api/v1';

const { check, finish } = makeChecker();

const { authHeaders: auth, jsonHeaders, csrfOnlyHeaders } = await resetToKnownState();

const get = async (url) => {
  const response = await fetch(`${BASE}${url}`, { headers: auth });
  return { status: response.status, json: await response.json() };
};
/** Bodiless calls must NOT send `Content-Type`, or Fastify answers 400 before routing. */
const post = async (url, body) =>
  fetch(`${BASE}${url}`, {
    method: 'POST',
    headers: body === undefined ? csrfOnlyHeaders : jsonHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const del = async (url) => fetch(`${BASE}${url}`, { method: 'DELETE', headers: csrfOnlyHeaders });

const now = new Date();
/** A local day `offset` months from now. */
const dayIn = (offset, day) =>
  new Date(now.getFullYear(), now.getMonth() + offset, day).getTime();
/** The first day of the month `offset` months from now. */
const monthStart = (offset) => new Date(now.getFullYear(), now.getMonth() + offset, 1).getTime();

const FOOD = 'builtin-expense-food';
const ACCOUNT = 'builtin-default-account';

const ruleBody = (overrides = {}) => ({
  name: '房租',
  type: 0,
  amountCents: 250_000,
  categoryId: FOOD,
  accountId: ACCOUNT,
  frequency: 'monthly',
  // Two months back on the 3rd: always in the past, and due several times by now.
  anchorDate: dayIn(-2, 3),
  ...overrides,
});

const createRule = async (overrides = {}) => {
  const response = await post('/recurring/rules', ruleBody(overrides));
  if (response.status !== 201) {
    check('create rule', false, `-> ${response.status} ${await response.text()}`);
    return undefined;
  }
  return (await response.json()).id;
};

const billCount = async () => (await get('/transactions?limit=200')).json.total;
const pendingList = async () => (await get('/recurring/pending')).json;
const ruleList = async () => (await get('/recurring/rules')).json.items;

// ── an empty state ───────────────────────────────────────────────────────────
console.log('\n[empty]');
const emptyRules = await get('/recurring/rules');
check('no rules initially', emptyRules.json.items.length === 0, `-> ${emptyRules.json.items.length}`);
const emptyPending = await get('/recurring/pending');
check('AC10 nothing pending initially', emptyPending.json.total === 0, `-> ${emptyPending.json.total}`);
const emptyGenerate = await post('/recurring/generate');
check('generating with no rules creates nothing', emptyGenerate.status === 200, `-> ${emptyGenerate.status}`);
// A Response body can only be read once, so the parsed value is kept.
const emptyGenerateBody = await emptyGenerate.json();
check('and reports zero', emptyGenerateBody.created === 0, `-> ${emptyGenerateBody.created}`);

// ── AC1 create a rule ────────────────────────────────────────────────────────
console.log('\n[AC1 rules]');
const ruleId = await createRule();
check('AC1 the rule was created', ruleId !== undefined);

const rules = await ruleList();
check('AC1 it is listed', rules.length === 1, `-> ${rules.length}`);
check('AC1 with its name and amount', rules[0]?.name === '房租' && rules[0]?.amountCents === 250_000);
check('AC1 enabled by default', rules[0]?.enabled === true);
check('AC1 its first due date is the anchor', rules[0]?.nextDueDate === dayIn(-2, 3), `-> ${rules[0]?.nextDueDate}`);

const patched = await fetch(`${BASE}/recurring/rules/${ruleId}`, {
  method: 'PATCH',
  headers: jsonHeaders,
  body: JSON.stringify({ name: '房租（改）' }),
});
check('AC1 it can be edited', patched.status === 200, `-> ${patched.status}`);
const patchedBody = await patched.json();
check('AC1 the edit stuck', patchedBody.name === '房租（改）');

// ── AC2 due dates become PENDING, never bills ────────────────────────────────
console.log('\n[AC2 due -> pending, not posted]');
const billsBefore = await billCount();
const generated = await post('/recurring/generate');
check('generation succeeds', generated.status === 200, `-> ${generated.status}`);
const generatedBody = await generated.json();
check('AC2 it created pending items', generatedBody.created > 0, `-> ${generatedBody.created}`);
// The assertion the whole design exists for.
check('AC2 NO bill was posted', (await billCount()) === billsBefore, `-> ${await billCount()} vs ${billsBefore}`);

const pending = await pendingList();
check('AC2 the queue matches what was created', pending.total === generatedBody.created, `-> ${pending.total}`);
check('AC2 items are pending', pending.items.every((item) => item.status === 'pending'));
check(
  'AC2 ordered oldest first',
  pending.items.every((item, index) => index === 0 || pending.items[index - 1].plannedDate <= item.plannedDate),
  `-> ${pending.items.map((item) => new Date(item.plannedDate).toISOString().slice(0, 10)).join(',')}`,
);
check('AC2 the amount is snapshotted from the rule', pending.items[0]?.amountCents === 250_000, `-> ${pending.items[0]?.amountCents}`);

// ── AC3 idempotent generation ────────────────────────────────────────────────
console.log('\n[AC3 generation is idempotent]');
const again = await (await post('/recurring/generate')).json();
check('AC3 a second run creates nothing', again.created === 0, `-> ${again.created}`);
check('AC3 the queue is unchanged', (await pendingList()).total === pending.total, `-> ${(await pendingList()).total}`);

// ── AC4 confirm ──────────────────────────────────────────────────────────────
console.log('\n[AC4 confirm]');
const first = pending.items[0];
const confirmed = await post(`/recurring/occurrences/${first.id}/confirm`);
check('AC4 confirm succeeds', confirmed.status === 200, `-> ${confirmed.status}`);
const confirmBody = await confirmed.json();
check('AC4 it reports a new bill', confirmBody.created === true);
check('AC4 the bill carries the rule amount', confirmBody.transaction.amountCents === 250_000, `-> ${confirmBody.transaction.amountCents}`);
check('AC4 the bill date is the planned date', confirmBody.transaction.date === first.plannedDate);
check('AC4 exactly one bill now exists', (await billCount()) === billsBefore + 1, `-> ${await billCount()}`);

const afterConfirm = await pendingList();
check('AC4 it left the pending queue', !afterConfirm.items.some((item) => item.id === first.id));
const occurrences = (await get('/recurring/occurrences')).json.items;
const confirmedRow = occurrences.find((item) => item.id === first.id);
check('AC4 it is recorded as confirmed', confirmedRow?.status === 'confirmed', `-> ${confirmedRow?.status}`);
check('AC4 linked to the bill it produced', confirmedRow?.transactionId === confirmBody.transaction.id);

// ── AC5 double confirmation must not double-count ────────────────────────────
console.log('\n[AC5 confirming twice]');
const billsBeforeRepeat = await billCount();
const repeated = await post(`/recurring/occurrences/${first.id}/confirm`);
check('AC5 the repeat succeeds (idempotent)', repeated.status === 200, `-> ${repeated.status}`);
const repeatBody = await repeated.json();
check('AC5 it reports NO new bill', repeatBody.created === false, `-> ${repeatBody.created}`);
check('AC5 it returns the SAME bill', repeatBody.transaction.id === confirmBody.transaction.id);
// The assertion that protects against money counted twice.
check(
  'AC5 the bill count did NOT grow',
  (await billCount()) === billsBeforeRepeat,
  `-> ${await billCount()} vs ${billsBeforeRepeat}`,
);

// ── AC6 ignore ───────────────────────────────────────────────────────────────
console.log('\n[AC6 ignore]');
const second = (await pendingList()).items[0];
const billsBeforeIgnore = await billCount();
const ignored = await post(`/recurring/occurrences/${second.id}/ignore`);
check('AC6 ignore succeeds', ignored.status === 200, `-> ${ignored.status}`);
check('AC6 the row is ignored', (await ignored.json()).status === 'ignored');
check('AC6 NO bill was created', (await billCount()) === billsBeforeIgnore, `-> ${await billCount()}`);
check(
  'AC6 it left the pending queue',
  !(await pendingList()).items.some((item) => item.id === second.id),
);

// A later generation must not resurrect it.
await post('/recurring/generate');
check(
  'AC6 regeneration does not bring it back',
  !(await pendingList()).items.some((item) => item.id === second.id),
);

// Confirming an ignored occurrence must fail loudly, not silently post a bill.
const confirmIgnored = await post(`/recurring/occurrences/${second.id}/confirm`);
check('AC6 confirming an ignored item -> 409', confirmIgnored.status === 409, `-> ${confirmIgnored.status}`);
check('AC6 with a CONFLICT code', (await confirmIgnored.json()).error?.code === 'CONFLICT');

// ── AC7 disabling ────────────────────────────────────────────────────────────
console.log('\n[AC7 disable]');
const disabled = await post(`/recurring/rules/${ruleId}/enabled`, { enabled: false });
check('AC7 the rule can be disabled', disabled.status === 200, `-> ${disabled.status}`);
const disabledBody = await disabled.json();
check('AC7 it reports disabled', disabledBody.enabled === false);

// Clear the queue so the next generation has nothing to re-create.
for (const item of (await pendingList()).items) {
  await post(`/recurring/occurrences/${item.id}/ignore`);
}
const billsBeforeDisabledRun = await billCount();
const disabledRun = await (await post('/recurring/generate')).json();
check('AC7 a disabled rule generates nothing', disabledRun.created === 0, `-> ${disabledRun.created}`);
check('AC7 and posts nothing', (await billCount()) === billsBeforeDisabledRun);

// Re-enabling resumes rather than replaying the backlog.
const reEnabled = await post(`/recurring/rules/${ruleId}/enabled`, { enabled: true });
check('AC7 re-enabling succeeds', reEnabled.status === 200, `-> ${reEnabled.status}`);
const reEnabledRule = await reEnabled.json();
check(
  'AC7 re-enabling moves the cursor into the future',
  reEnabledRule.nextDueDate > Date.now(),
  `-> ${new Date(reEnabledRule.nextDueDate).toISOString()}`,
);

// ── AC8 the anchor is the basis for advancement ──────────────────────────────
console.log('\n[AC8 month-end does not drift]');
// A rule anchored on the 31st: February must clamp, then March must return to the 31st.
const anchor31 = new Date(now.getFullYear(), now.getMonth() - 6, 31).getTime();
const driftRuleId = await createRule({
  name: '月末规则',
  frequency: 'monthly',
  anchorDate: anchor31,
});
check('AC8 the month-end rule was created', driftRuleId !== undefined);

await post('/recurring/generate');
const driftPending = await pendingList();
const driftDates = driftPending.items
  .filter((item) => item.ruleId === driftRuleId)
  .map((item) => new Date(item.plannedDate));
check('AC8 it produced several periods', driftDates.length >= 3, `-> ${driftDates.length}`);
// Across those periods, the day-of-month must return to 31 wherever the month allows it.
const days = driftDates.map((date) => date.getDate());
check(
  'AC8 the day returns to the anchor day in long months',
  days.includes(31),
  `-> days ${days.join(',')}`,
);

// ── AC9 the backlog cap is flagged, not silent ───────────────────────────────
console.log('\n[AC9 cap and flag]');
// A weekly rule anchored a year back is far beyond the 12-period cap.
const longRuleId = await createRule({
  name: '长期规则',
  frequency: 'weekly',
  anchorDate: dayIn(-12, 1),
  categoryId: FOOD,
});
check('AC9 the long-running rule was created', longRuleId !== undefined);

const capped = await (await post('/recurring/generate')).json();
check('AC9 it created at most 12', capped.created <= 12, `-> ${capped.created}`);
check('AC9 it reports the truncation', capped.truncated >= 1, `-> ${capped.truncated}`);

const longRule = (await ruleList()).find((rule) => rule.id === longRuleId);
check('AC9 the rule is flagged as having older due dates', longRule?.hasOlderDue === true, `-> ${longRule?.hasOlderDue}`);
const longPending = (await pendingList()).items.filter((item) => item.ruleId === longRuleId);
check('AC9 exactly 12 periods were materialised', longPending.length === 12, `-> ${longPending.length}`);
check(
  'AC9 the NEWEST periods were kept, not the oldest',
  longPending[longPending.length - 1].plannedDate > longPending[0].plannedDate,
  `-> ${new Date(longPending[0].plannedDate).toISOString()} .. ${new Date(longPending[longPending.length - 1].plannedDate).toISOString()}`,
);

// ── AC4 the budget follows a confirmation ────────────────────────────────────
console.log('\n[the budget follows a confirmation]');
// Build a cycle covering the current period, then confirm an item dated inside it.
const salary = await post('/salaries', {
  amountCents: 1_000_000,
  date: monthStart(0) + 2 * 86_400_000,
  allocations: [{ categoryId: FOOD, amountCents: 1_000_000 }],
});
check('the cycle salary was accepted', salary.status === 201, `-> ${salary.status}`);

const inCycleRuleId = await createRule({
  name: '本周期固定支出',
  frequency: 'monthly',
  anchorDate: monthStart(0) + 5 * 86_400_000,
});
await post('/recurring/generate');
const inCycle = (await pendingList()).items.find((item) => item.ruleId === inCycleRuleId);
check('a pending item exists inside the current cycle', inCycle !== undefined);

const budgetBefore = (await get('/budget/overview')).json;
const foodBefore = budgetBefore.modules.find((m) => m.categoryId === FOOD);
await post(`/recurring/occurrences/${inCycle.id}/confirm`);
const budgetAfter = (await get('/budget/overview')).json;
const foodAfter = budgetAfter.modules.find((m) => m.categoryId === FOOD);
check(
  'AC4 confirming increased the module spend by the rule amount',
  foodAfter.spentCents === foodBefore.spentCents + 250_000,
  `-> ${foodBefore.spentCents} then ${foodAfter.spentCents}`,
);

// ── deleting a rule ──────────────────────────────────────────────────────────
console.log('\n[delete a rule]');
const doomedRuleId = await createRule({ name: '待删除', frequency: 'daily', anchorDate: dayIn(-1, 1) });
await post('/recurring/generate');
const doomedPending = (await pendingList()).items.filter((item) => item.ruleId === doomedRuleId);
check('the doomed rule has pending items', doomedPending.length > 0, `-> ${doomedPending.length}`);

const removed = await del(`/recurring/rules/${doomedRuleId}`);
check('deleting succeeds', removed.status === 204, `-> ${removed.status}`);
check('it is gone from the rule list', !(await ruleList()).some((rule) => rule.id === doomedRuleId));
check(
  'its pending items were removed too, so no stranded alerts remain',
  !(await pendingList()).items.some((item) => item.ruleId === doomedRuleId),
);

// ── guard ────────────────────────────────────────────────────────────────────
console.log('\n[guard]');
const noSession = [
  ['GET', '/recurring/rules'],
  ['GET', '/recurring/pending'],
  ['GET', '/recurring/occurrences'],
];
for (const [, url] of noSession) {
  const response = await fetch(`${BASE}${url}`);
  check(`${url} requires a session -> 401`, response.status === 401, `-> ${response.status}`);
}
const noSessionPost = await fetch(`${BASE}/recurring/generate`, {
  method: 'POST',
  headers: { 'X-Requested-With': 'fetch' },
});
check('POST /recurring/generate requires a session -> 401', noSessionPost.status === 401, `-> ${noSessionPost.status}`);
const noCsrf = await fetch(`${BASE}/recurring/generate`, { method: 'POST' });
check('a mutating call without CSRF -> 403', noCsrf.status === 403, `-> ${noCsrf.status}`);

// ── the SPA route is deployed ────────────────────────────────────────────────
console.log('\n[shell]');
for (const path of ['/recurring', '/pending']) {
  const shell = await fetch(`http://127.0.0.1:8081${path}`);
  const html = await shell.text();
  check(`GET ${path} serves the SPA shell`, shell.status === 200 && html.includes('<div id="app"'), `-> ${shell.status}`);
}

finish('RECURRING E2E');
