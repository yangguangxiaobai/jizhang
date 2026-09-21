# State Management — Frontend

> Pinia. Eight stores, each with a clear boundary. The rule that matters most: **server
> numbers are never re-derived on the client.**

---

## The stores

| Store | Owns | Notes |
|---|---|---|
| `stores/auth.ts` | the signed-in username, `checked` | the session itself is an httpOnly cookie; there is no token in JS |
| `stores/meta.ts` | categories, accounts, tag vocabulary | fetched once, cached for the session |
| `stores/transactions.ts` | the filtered list, its month grouping and totals | a **month view**; not a summary source |
| `stores/budget.ts` | budget overview, salaries, templates, cycle setting | |
| `stores/balances.ts` | each account's balance, and the balance-sheet total | deliberately NOT part of `meta` — see below |
| `stores/recurring.ts` | rules, the pending queue, its count | `generateAndReload()` swallows its own errors so a failure cannot blank the dashboard |
| `stores/trash.ts` | the recycle bin and its bulk actions | reads through its own endpoint, never a flag on the list |
| `stores/transfers.ts` | the transfer rows, the total, the account filter | rows only — a transfer's effect on a balance is `stores/balances.ts`'s figure, not a computation here |

### Why balances are their own store, and not fields on `meta`

`meta` is master data: categories and accounts change rarely and are cached for the session.
A balance changes with **every bill**, so folding it into that cached payload would mean carrying
a number that goes stale — and `meta.load()` returns early once loaded, so the stale value would
survive a navigation.

`balances` therefore has its own fetch and its own explicit refresh. The two views that show a
total (the home asset card and the accounts section of 我的) call `load(true)` on mount — forced,
because a stale total on the first screen is worse than a redundant query — and every view that
changes money (`TransactionEditView` save, `TransactionsView` delete, `SalaryEntryView`,
`SalaryRecordsView` delete, `TrashView` restore/purge, and the account editor) awaits
`load(true)` after its write. There is no lazy invalidation to forget.

The store does **no** arithmetic: `totalBalanceCents` and each row's `balanceCents` are server
figures. Adding `incomeCents` and `expenseCents` up here would be a second implementation of the
refund rule.

### The account drill-down lands on a month, and says so

`我的 → 账户` opens the ledger at `/transactions?accountId=…`. That list is a month view while a
balance is all-time, so the page prints "仅显示X月" beside the active filter (with a 清除筛选
button) rather than letting the user try to reconcile an all-time figure against one month of
rows.

---

## Local vs store state

**Local (`ref` in the component):** form fields, an editor's open/closed state, which row is
expanded, a transient error message. If only one component can see it, it does not belong in
a store.

**Store:** data two or more pages need, or data whose refresh must be coordinated. The test
is "would a second page have to fetch this again and could then disagree?".

**URL (`vue-router`):** which record is being edited (`/transactions/:id/edit`), the current
page. Putting this in a store would break the back button and deep links.

---

## Server data is cached, not recomputed

`stores/budget.ts` deliberately does **no** arithmetic:

```ts
const poolIsNegative = computed(() => (overview.value?.carryoverPoolCents ?? 0) < 0);
```

Every figure — module views, the carryover pool, the monthly trend, the category share —
arrives computed from the server, which uses `@jizhang/shared`. The client only formats.

> This is the single most important convention in this file. A client-side re-derivation of
> "net expense" would be a second implementation of the refund rule, and the two would drift
> the first time the rule changed. The budget page would then disagree with the charts page.

The one exception is `utils/money.ts`, which converts and formats; it never aggregates.

### A page does not have to go through a store

`DashboardView.vue` calls `api.stats.monthlyTrend(1)` for the month's income and net expense
and `api.transactions.list({ limit: 5 })` for its recents, holding both in local `ref`s. It
does **not** add a store for them, and it does not reuse `stores/transactions.ts`.

Two reasons, and both are the point of this section:

- **Only the dashboard shows a one-month summary**, so there is no second page to disagree
  with; the "would a second page have to fetch this again?" test fails, so it stays local.
- **`stores/transactions.ts` is a month view, not a summary source.** It queries the current
  month with `limit: 500` and derives per-month subtotals from the returned rows. Reading it
  from the dashboard would mean showing a number derived differently from the one the charts
  page gets, which is exactly the drift this file warns about.

The dashboard must agree with the charts page **to the cent**, so it reads the same endpoint
the charts page reads and lets the server do the arithmetic.

What the dashboard *may* compute is a display sign (`expenseContribution` /
`incomeContribution` imported from `@jizhang/shared`) and one subtraction for
`income − netExpense`. Those are formatting decisions over two server values, not an
independent aggregation — and the sign still comes from the shared rule rather than an inline
`type === 0 ? … : …`.

---

## Refresh paths are explicit

There is no reactive cache invalidation library. After a write, the store reloads what the
write affected, and callers await it:

```ts
async function deleteSalary(id: string): Promise<boolean> {
  await api.salaries.remove(id);
  await Promise.all([loadSalaries(), loadOverview()]);
  return true;
}
```

A write that changes a budget figure must refresh the overview as well as its own list, or
the budget page shows a stale pool. `Promise.all` keeps the two reloads concurrent.

---

## Guarding the router with auth state

`router/index.ts` awaits `auth.refresh()` when `auth.checked` is false, so a refresh on a
deep link does not bounce to `/login` and back. `checked` exists precisely to distinguish
"not signed in" from "not asked yet".

---

## Setup-style stores only

Every store is written in the setup style (a function returning refs and functions) rather
than options-style. It keeps types inferred instead of hand-written and makes a store read
like a composable.

---

## Common mistakes

- **Aggregating on the client.** Formatting is fine; summing expenses, or deciding what
  counts as income, is not.
- Forgetting to refresh a dependent store after a write (delete a salary, and the pool must
  reload too).
- Copying server data into component-local state, so the two diverge after a refresh.
- Putting navigation state in a store instead of the URL.
- Trusting `auth.username === null` before `auth.checked` is true, which shows the login
  page for a moment on every hard refresh.
- Fetching the same list in two pages instead of sharing the store, so one is stale.
