# Statistics windows and exact-category drilldown

## 1. Scope / Trigger

Applies to C3 native statistics, server ranges, historical trends and exact account/category drilldowns. Ordinary expense stays gross; refunds are income, not expense offsets. No schema or production deployment is required.

## 2. Signatures

- Shared `resolveStatsWindow(kind: 'month'|'last30', month: string|null, now: number, timeZone: string): StatsWindow`.
- `GET /api/v1/stats/window?kind=month|last30&month?&timeZone?` returns `{kind,from,to,timeZone,label,calculatedAt}`. Omitted month at HTTP boundary means the captured server clock's current month in that zone; the shared helper requires an explicit month for kind=month.
- `GET /api/v1/stats/category-share?from&to&accountId?&categoryId?` returns existing items/totalCents/expenseCents/refundIncomeCents/from/to plus `expenseCount`, nullable `accountId`/`categoryId` echoes.
- `GET /api/v1/stats/monthly-trend?months&endMonth?` preserves items, adds range; endMonth is YYYY-MM. Existing pool/range/month-window endpoints remain compatible.
- Android `TransactionDrilldownQuery` carries the exact from/to/categoryId/categoryName/accountId?/rangeLabel/expectedTotalCents. Type is fixed to expense (0).

## 3. Contracts

- Windows are half-open `[from,to)`. last30 is 720 real hours ending at the same captured now, never next month start. Calendar boundaries use explicit IANA zone.
- Historical month boundary contracts:
  - Repeated midnight (fall-back): When a time zone experiences a historical fall-back transition across month start (e.g. `America/St_Johns` 2009-11, where 00:01 local fell back to 23:01, producing two local 00:00:00 midnights at 02:30Z and 03:30Z), the month window must anchor at the **earliest valid instant** (the first 00:00:00 at `2009-11-01T02:30:00Z`). The adjacent preceding month window (`2009-10`) `to` matches this exact instant. Any transaction at `02:30:30Z` is counted in November. This contract applies strictly to statistics windows and does not expand historical time zone guarantees for other financial cycles.
  - Skipped midnight (spring-forward gap): When local midnight does not exist (e.g. `America/Asuncion` 2017-10, where 00:00:00 jumped directly to 01:00:00), the window begins at the first valid instant after the offset transition (`2017-10-01T04:00:00Z`, local 01:00:00).
  - Single half-open window: Both cases preserve the single half-open `[from, to)` contract and API signature without introducing multi-segment window interfaces.
- Category/account filters are literal IDs combined with date and live-row predicates. Category does not include descendants; refund subtotal uses the refund row's own category/account, not an inferred original attribution.
- `expenseCount` counts all matching expense rows, not just a display page. Monthly income includes salaries and refunds; historical `netExpenseCents` retains gross expense meaning and UI calls it 支出.
- Native clients use server totals, not a local money sum. Drilldown validates scope echoes and full loader count/predicates, 500-row batches with 100000-row cap, refusing incomplete/duplicate/changed-total pages. A fresh server total differing from entry statistic is marked changed, not called an exact snapshot.
- Stats source remains mounted under a dialog; detail is read-only and Back closes detail before drilldown. Request generation/disposal and authenticated scope before/after protect success, failure and finalization. Same-query refresh can retain explicitly stale prior data; new query immediately isolates it.
- Default category window is current month, trend is 6 months with its own server-month caption. Extra range/display options fold. Pool chart and per-period details remain in the advanced envelope tool. Deterministic review never calls AI or treats income minus expense as actual savings.

## 4. Validation & Error Matrix

| Condition | Outcome |
|---|---|
| Invalid month/zone/kind | 400 VALIDATION, no silent current-month fallback |
| Fractional/unsafe/duplicate/malformed range or empty ID | 400 VALIDATION |
| Valid unknown exact ID | Successful empty exact scope, not all rows |
| Unsupported window or filtered summary | Explicit unavailable/upgrade, no device guess or fake zero |
| Incomplete pages / summary count mismatch | Reject full read; no partial-success total |
| Scope/generation change | Discard old result/error/finalization |
| Source total changed | Visible refresh/recheck warning |

## 5. Good / Base / Bad Cases

Good: fixed 2026-10-29 12:00 +08 resolves last30 from 09-29 12:00 to 10-29 12:00; 504 exact matching bills span two pages and agree with server category total; America/St_Johns 2009-11 resolves to earliest instant 2009-11-01T02:30:00Z and aligns adjacent 2009-10 to; America/Asuncion 2017-10 resolves to first instant 2017-10-01T04:00:00Z. Base: API/JVM/lint/compile pass, device navigation remains pending. Bad: using device next-month start or first500 rows as a complete financial total; using global monotonic binary search across non-monotonic fall-back boundaries.

## 6. Tests Required

- shared stats-window: fixed rolling window, cross-year/leap month/DST, repeated midnight earliest instant (America/St_Johns 2009-11), skipped midnight gap (America/Asuncion 2017-10), invalid zone/month/now.
- server stats: wages/refunds/gross expense, endMonth, 504 filtered rows and all matching transaction pages, stats/window endpoint historical repeated midnight regression (America/St_Johns 2009-11 -> 02:30Z), precise ID/boundary/count semantics, auth/no-store regressions.
- Android StatsWindowTest and TransactionDrilldownQueryTest: strict integer fields, server captions, 1203-page load, predicates/caps/changed values, scope mismatch and late callbacks.
- Device evidence remains separate: filter switching, retained scroll/detail Back, hidden layers, small-screen and TalkBack.

## 7. Wrong vs Correct

Wrong: derive a rolling cutoff from device calendar, sum visible bills, label gross expense net expense, or apply a naive global binary search over fall-back month boundaries selecting the second local midnight (03:30Z) or creating gaps between adjacent months. Correct: request the server window, forward its exact scope, use bounded candidate midnight search with civil-part verification selecting the earliest valid instant, render authoritative totals and disclose distinct gross/net/manual facts.
