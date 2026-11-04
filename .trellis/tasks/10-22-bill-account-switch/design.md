# Bill-page account switching — design

## Boundaries

This is an Android bill-page change using the existing authenticated transaction and historical account-list APIs. Production API/DB/shared accounting contracts remain unchanged. Funding accounts are selected by ID, not name or account type. Existing salaries, transfers, account balances and statistics remain separate.

## UI

- Place a persistent labeled account selector after the month selector and before the income/expense chips, so it is visible without opening advanced filters.
- Prefer the existing `ListChoice` component (ManageTab.kt:59–83), which already offers a full-width labeled button, dropdown, current selection and check mark. Use “账户” as the label and “全部账户” as the empty-ID option.
- Build choices from the existing `accountNames` data, including historical accounts. Follow the existing name ordering to avoid an unrelated ordering change. Keep an explicit unavailable/historical fallback for a currently selected ID absent from metadata.
- Selecting an account applies immediately to the existing `accountFilter`; selecting the already selected value is a no-op. Existing clear-chip and clear-filter actions operate on the same state. No second account filter or advanced-sheet draft is introduced for this direct entry.
- Metadata loading and failure must be understandable: retain existing valid choices when possible; expose retry if the choices could not load. Do not infer that an empty/unloaded dictionary means there are no accounts.

## Query and response ownership

The query continues to contain the selected local month `[from,to)`, optional type/account/category/tag/search, and `limit=50` with offset. Account changes reset the page before the corresponding request is issued. Pagination and explicit refresh share the same query construction.

Existing separate `LaunchedEffect` and coroutine-scope reload paths can overlap. Implementation must snapshot the complete request scope (filters and page), enforce latest-request ownership, and check cancellation before publishing. Prefer a small production-used query/state helper plus one consistent loading entry over an architectural rewrite. A monotonically increasing load token and scope check are acceptable if every publish path (items, totals, metadata, errors and loading completion) respects them. Verify cancellation is rethrown rather than swallowed in ancillary calls.

When the selected query differs from the last successfully loaded query, do not show older rows/counts as if they belong to the new account. Clear or hide the old result for the new scope. Same-scope explicit refresh may retain its previous result with a clear refreshing/error indicator. If deleting the last item makes a page invalid, correct the page under the same selected query and reload it; avoid recursive reload ownership bugs.

Account-choice metadata must not become inaccessible just because a transaction-list call fails. Keep metadata error/retry treatment small and specific; do not introduce a global caching layer.

## Compatibility

- Reuse `GET /api/v1/transactions?accountId=...` and `GET /api/v1/accounts?includeDeleted=true`.
- Do not mark historical accounts as deleted based only on a name; current DTO does not expose that flag.
- Preserve existing Chinese UI, theme tokens, month/type behavior and detail/edit/delete routes.
- Preserve `remember` lifetime; no new process/tab/detail persistence guarantee.
- The unused monthly-trend request/summary is not a visible account statistic. It must not be expanded into a new aggregation feature. If removed to simplify the modified loader, do not affect dashboard/statistics clients.

## Validation shape

Android currently has JUnit4/MockWebServer local-test dependencies, but no configured runnable Compose instrumentation suite (app/build.gradle.kts:103–131). Unit coverage must exercise actual production-used query/state/ownership code rather than an unconnected simulation. Add backend contract tests for two real accounts, combined filters, totals/pagination and retained historical-account bills if existing cases are insufficient. These tests use isolated databases/app injection, never production data.

Entry-point reachability is verified by source review and compilation in this local scope. Physical-device dropdown usability, small-screen layout and accessibility acceptance remain explicitly pending unless a device is actually exercised; no unit-test-only claim of end-to-end UI acceptance.

## Rollback

Changes must be limited to the bill page and small production-used testable helpers, related tests and feature documentation. Roll back only this task's edits, never reset the existing dirty worktree. No server rollout or DB migration is involved.
