# Quality Guidelines — Native Client and API Boundary

## Current scope and gates

`clients/android` is the native Kotlin/Compose client. The former `packages/web`
Vue/PWA application, its build checks and its browser tests are retired. The other
Vue/PWA manuals linked from the [frontend index](./index.md) are historical and
non-operative; do not require their commands or treat their iPhone/PWA results as
Android acceptance.

For Android changes run the applicable gates from `clients/android`:

```bash
./gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
```

Report source/JVM checks, lint and APK compilation separately from actual device
interaction and deployment evidence. Consult the maintained Android feature catalogue
and update affected entries when UI, repository or consumed API contracts change.

## Accounting and API delivery

- Amounts are integer cents; display server-computed totals rather than duplicating
  accounting rules. Ordinary refunds (`type=1`, `isRefund=true`) count as income;
  ordinary and category-envelope expense remains gross. Confirmed refund allocations
  reduce only the separate four-purpose execution view's net spending.
- API responses, including failures and API 404s, must carry `Cache-Control: no-store`.
  This protects session-specific ledger data and prevents stale financial results.
  `packages/server/test/app.test.ts` covers the shared hook and error paths.
- The API-only server returns JSON 404 for `/` and former Web pages and assets, not a
  SPA shell, including when stale files or legacy configuration are present. Preserve
  the relevant `app.test.ts` and `check-api-only.mjs` assertions.
- `packages/server/scripts/e2e-pwa.mjs` is a legacy-named **read-only API-only probe**;
  it delegates to `check-api-only.mjs` and does not test a manifest, service worker,
  offline shell, or any client UI.
- E2E scripts using `resetToKnownState()` clear ledger data. Run them only against
  an isolated disposable database and server, never against production.

## Native Android addendum: retained financial tabs

`clients/android` is a native Compose client, not the Vue/PWA described above. Its build gates are `testDebugUnitTest`, `lintDebug`, and `assembleDebug`; source/JVM checks alone do not verify gestures.

For `FinancialHostScreen`, retained tab compositions must not imply overlapping interactive layouts. **Wrong:** three full-size siblings hidden only with `alpha(0f)` plus `pointerInput(Unit) {}`. Alpha does not remove pointer targets; the empty handler does not disable child scrollables. This caused the invisible Scenario list to scroll while Budget appeared frozen, and hid visible Execution controls from UIAutomator.

**Correct:** keep the three stable composition slots, measure them with finite constraints, and place only the selected child. Inactive slots must not be placed/drawn/hit-tested. Keep dirty/busy leave guards and active-only back ownership. Never replace this with disposal unless all draft and in-flight operation retention is deliberately preserved.

Regression assertions: selected slot index for every tab and fixed child count; retained composition wiring; on-device execution 查看 opens, budget swipe changes the visible list, hidden scenario scroll stays unchanged, and saved scenario/draft survives switching. UI hierarchy and actual taps/swipes are complementary to source checks, not replaceable by them.

## Code Review Checklist

- [ ] Are monetary values and refunds displayed using the correct server-provided view?
- [ ] Are native state ownership, leave guards, accessibility and interaction regressions covered?
- [ ] Are API no-store and retired-path JSON 404 protections preserved?
- [ ] Did the applicable Android and backend checks pass after the last relevant edit?
- [ ] Are device and deployment acceptance reported separately, with unverified items stated?
- [ ] Are all reset-based integration tests confined to an isolated disposable database?
