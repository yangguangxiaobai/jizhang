# Android review — 2026-10-09

The dispatched reviewer inspected the Android repositories and production UI against
the server routes/services and A1–A12 requirements. No backend/deployment code was
changed. Product sources are frozen after the final build for the parent runtime checks.

## Fixed

- `LoginScreen.kt`: a remounted login screen after HTTP 401 reused the cached
  username even after cookies were cleared, returning to an expired shell. Automatic
  restoration now requires a cookie and a completed successful `auth/me` refresh;
  a timed-out refresh cannot authorize the cached username. The parent reproduced
  the pre-fix blank-shell behavior and owns the final emulator regression.
- `DashboardTab.kt`: remembered-scope `async` children could fail outside the
  local request catch. Requests now execute within the caught reload flow. Balance
  and recurring failures are visible without discarding the rest of the dashboard.
- `BudgetTab.kt`, `ItemsTab.kt`: pending-count and item-summary failures have visible
  feedback instead of silently presenting zero/no summary. HTTP 401 propagates.
- `ItemsTab.kt`: cycle settings accept every server-advertised start day (1–28),
  with a natural-month option; password fields are obscured. Settings-load failures
  are visible. Status choices scroll horizontally.
- `RecurringRulesTab.kt`: frequency choices scroll so yearly/quarterly remain
  reachable on narrow screens.
- `ItemsTab.kt`, `TransfersTrashTabs.kt`: 50-row pagination replaces inaccessible
  rows beyond a fixed 200-row list.
- `ItemsTab.kt`: photo/candidate decoding samples dimensions to at most 1600 pixels
  per edge before allocating the display/cutout bitmap. Original upload bytes remain
  unchanged; generated cutout input remains WebP.
- Transaction, recurring and item editors use integer-cent `formatYuan` when
  prefilling amounts, preventing comma-decimal locales from producing text rejected
  by the decimal parser. A locale regression verifies the round trip.
- `MainShell.kt`: corrected the stale comment claiming AI occupied the fourth tab.

## Not fixed / remaining acceptance

- The existing `GET /trash` API returns `listDeleted()` capped by `MAX_PAGE_SIZE`
  while its `total` covers all deleted rows; it exposes no paging parameters.
  Individual access beyond the cap requires a backend public-interface decision,
  outside this Android review. Bulk restore/purge remain available.
- Production HTTPS application deployment, complete feature replay with actual
  CSV/GBK/xlsx files, a configured AI provider/private cutout service, physical
  Android coverage and HarmonyOS 4 installation remain separate runtime gates.
- Local release artifacts use the configured debug key when no user-local release
  signing material is provided. They establish build/install shape, not signing
  continuity for distribution.
- Complete Android parity acceptance is not established by this static review or
  successful builds. Do not retire Web source based on these checks alone.

## Verification

From `clients/android`, using JDK 17 and the available Android SDK:

`gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:lintDebug :app:assembleRelease :app:lintRelease --no-build-cache`

Final run: **BUILD SUCCESSFUL in 43s**, 105 actionable tasks (31 executed).
Both Kotlin variants compiled; both APKs assembled; both lint tasks passed.
JUnit XML: 7 network tests + 3 input tests, zero failures/errors. Android diff
whitespace check passed. The parent owns final APK installation and expired-session
runtime verification; no emulator or synthetic ledger operation was performed here.

The parent subsequently confirmed the final APK regression on Android 15: login,
expire all isolated server sessions, request Budget, and observe the login form;
a second independent UI dump remains on login with no stale-shell reentry.

## CSV picker runtime follow-up

The parent reproduced an Android provider returning an exported `.csv` as disabled
in a `GetContent("text/csv")` chooser. `DataTab.kt` now requests `*/*` and validates
the selected provider display name as `.csv` (case insensitive), nonempty bytes,
and at most 10 MiB before UTF-8 decoding. The bounded reader enforces the size while
streaming. A rejected selection clears prior import state; CSV content validation
and all-or-nothing import remain server-owned. A new input regression covers
uppercase extensions, disguised executable names, empty files and oversized files.

Follow-up combined Gradle gate: **BUILD SUCCESSFUL in 30s**; 11 JVM tests passed
(7 network + 4 input), both Kotlin variants compiled, both APKs assembled and both
lint tasks passed. The parent owns the repeated exported-CSV chooser/import replay.
