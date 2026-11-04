# Design

## Boundary
Current TransactionsTab lays out an oversized month panel, top new action and explicit 50-row pagination; no daily totals exist. Change only bill layout/loading and add an additive filtered daily-summary API on transactions. Keep existing list signatures and coordinators compatible for other consumers/tests. Shared accounting contribution functions are authoritative. No schema or production deployment.

## Server
Add GET /api/v1/transactions/daily-summary before dynamic id route, reuse parsed list predicates and service query construction rather than duplicating predicates. Require bounded month range and a client timeZone (IANA, validated) so server daily keys match device grouping, including DST. Return items {day: yyyy-MM-dd, expenseCents, incomeCents, count}; use shared expenseContribution/incomeContribution on all matching live ordinary transactions, ignoring limit/offset. No salaries/transfers. Service owns validation and date grouping. Test filtered totals, refund income, limits ignored, boundaries/timezone, malformed requests/auth.

## Android
Create a production-used complete-month loader that uses existing paged API sequentially in batches up to 500, checks totals/duplicate IDs/no progress and retries only by explicit UI refresh on failure. Publish only complete results via existing generation guard; preserve same-query old data. Fetch summary independently within same query-owned result (summary failure visibly unavailable, rows still usable), with no client financial arithmetic. Compact month controls in title row; top refresh. Remove page toolbar but retain count text. Shared ListChoice renders heading only when nonblank; pass blank only on bill page. Group by stable device yyyy-MM-dd key and label using existing formatting; summary maps keyed by that date. Date header can wrap for narrow screens/large fonts.

## Compatibility
New server API requires deployment before daily summary can work on production; APK must show unavailable summaries with working list on old servers. No silent fallback to local sums. Detail refresh token retains current filters and scroll, complete-load scope starts at page zero.
