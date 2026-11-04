# Device-reported execution UI repair — 2026-10-27

## Request and boundary

User reported execution-page 查看/刷新状态 taps unresponsive, category-envelope page not scrolling, and previous plans not viewable; then explicitly requested continuation. This is a repair to the active Phase 1 task, not a change to financial accounting.

Smallest gaps and owners:
- The host permanently composes three full-size overlapping tab trees; alpha=0 and an empty pointerInput block do not remove hidden content from hit testing. Fix in FinancialHostScreen, preserve compositions/drafts and leave guards, but place only the selected child so hidden tabs cannot intercept gestures.
- Execution refresh has no visible progress/error when cached data exists. Fix in FinancialExecutionWorkspace; distinguish refresh failure from successful empty data and refund queue failure from empty queue.
- Server and native repository already offer confirmed-period list and append-only revisions, but the execution workspace has no UI path to inspect them. Add a read-only, paginated history sheet using those existing endpoints and frozen decision fields.

Expected files: host and host tests; workspace; new history sheet/state/tests; Android maintained inventory; this task evidence. No changes to server contracts/schema, old ledger/envelope arithmetic, salary records, account balances or automatic historical writes. Existing manual scenario only keeps its latest explicitly saved input; never pretend overwritten legacy snapshots are recoverable from the execution period tables.

## Delegation and validation

- Configured coder: persistent tab placement and regression checks.
- Configured frontend: workspace feedback/refund action and history read UI.
- Configured reviewer: independently check persistence semantics; first debugger invocation failed without results, replaced with reviewer.
- Parent: integration review, local Gradle unit tests/lint/assembleDebug, inventory and exact evidence.

Source wiring tests are not actual gesture/device evidence. Device was not connected during the preceding probe; recheck availability for acceptance, do not claim physical verification without a real run. Do not inspect SSH private keys or require production access for this client-side repair. No automatic commit or deployment.

## Pre-fix device reproduction

SDK platform-tools adb (not the unrelated MuMu adb on PATH) detects HUAWEI JER-AN20, serial TNL0220A15028072. App was already authenticated and foreground. Read-only navigation on the installed previous APK reproduced:
- Execution tab visually shows a 43-refund banner with 查看 and the no-period 刷新状态 card. UIAutomator exposes only host header/tabs, not those visible controls. Tapping 查看 does not open the review dialog (artifacts/jizhang-budget-before.png and jizhang-review-before.xml).
- Category budget tab: vertical swipe from (550,1800) to (550,700) leaves the visible 工资与分配 / 预算周期 / 周期概览 content unchanged (artifacts/jizhang-envelope-before.png and jizhang-envelope-swiped-before.png).
- Switching to Scenario after the budget swipe shows the Scenario list scrolled down; scrolling it back up reveals the saved legacy scenario r3, updated 2026-10-27 13:04. Thus the invisible Scenario actually consumed the Budget swipe. The legacy plan exists; it is distinct from the currently empty execution-period collection.
- No salary/transaction/refund/plan mutation made. No production SSH or database access required.

## Acceptance

- Inactive tabs remain composed but are not placed/drawn/hit-tested; active tab receives taps and scrolling.
- Refresh visibly in progress, duplicate refresh disabled, failed refresh keeps last success and shows error.
- Refund queue error has retry action, never a false empty success.
- History entry available for empty and populated current execution; list pagination, period/revision drill-down and failure/retry states preserve selected identity and reject stale responses.
- Confirmed historical values remain frozen and read-only; no forecasts/targets labeled actual savings.
- Local Android gates and updated APK hash recorded separately from device acceptance.

## Final local validation and installation

- Final command: `clients/android/gradlew.bat testDebugUnitTest lintDebug assembleDebug --console=plain` → BUILD SUCCESSFUL (1m30s), 2026-10-27 15:38. Gradle required user-approved wider access to existing user cache/SDK. Failed earlier attempts: initial sandbox lock denial, missing heightIn import (fixed), then a Lint run while sources were being updated produced shifted SuspiciousIndentation errors; stable final full rerun passed with no suppression/baseline change.
- Gradle XML count: 42 suites, 454 tests, 0 failures, 0 errors. Lint final text: 0 errors / 43 warnings (retained baseline).
- APK: clients/android/app/build/outputs/apk/debug/app-debug.apk, 22,795,658 bytes, SHA256 `0E14D45AAF134835E3D38F5A89B0E4FF59092DAE701A80E956C83B8C2A143244`.
- SDK adb `install -r` on JER-AN20 returned Success; launcher started. No clear-data/uninstall used. Updated APK installed, but phone locked during build; keyguard/proximity overlay prevented post-install in-app touch verification. User asked to unlock; no credential entry or bypass attempted. Therefore repaired clicks/scroll/history are not yet device-accepted.
- Independent reviewer found shared history-ticket request invalidation could strand loading; fixed with separate period/revision owners, canceled-view loading reset, auth reset and cached-revision failure retry. Parent additionally separated refund read tickets from execution refresh, made refund review list scrollable, and moved populated-period action row below heading with horizontal overflow handling.
- No accounting/server code or production DB changes, no git commit. Existing legacy scenario r3 observed before install and never edited; no history fabricated.
