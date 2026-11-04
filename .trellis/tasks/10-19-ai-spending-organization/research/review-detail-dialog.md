# Organization review transaction drill-down — 2026-10-23

## Approved follow-up and boundary

The user requests tapping an organization review card to inspect its original transaction using the APK's existing detail dialog. Continue the existing in-progress task; no new task or server contract is required.

- Gap: category/tag cards show only date, amount and a shortened identifier; no transaction drill-down exists.
- Behavior owner: `AssistantOrganizationWorkspace` renders cards, `AssistantTab` supplies its API client, and `TransactionDetailScreen` already owns authoritative transaction and metadata loading, loading/retry/auth handling and the centered dialog.
- Minimal change: wire the API client into the workspace; retain a separate selected transaction identifier; add card click callbacks (including note suggestions); reuse the existing detail component with a default-off read-only option. Checkbox taps remain selection-only. Closing the dialog leaves the workspace, selected actions and lazy-list composition mounted.
- Original ledger detail callers retain edit/refund/delete behavior. Organization drill-down hides all mutation controls. Do not duplicate fetching, financial formatting, metadata or dialog rendering.
- Out of scope: server/API/schema changes, Provider calls, selection/apply/undo changes, deployment, unrelated dirty-tree changes, and device installation without a connected device.

## Reuse contract

Keep the original detail component as the only owner of loading and presentation. Its trailing `readOnly` option defaults to false for existing ledger callers. The organization caller explicitly sets it true, gating the entire action row and deletion confirmation. Do not implement a second "AI detail" ledger decoder or reinterpret AI reasons as original notes. The dialog reads live server data, not a historical snapshot; normal load errors/retry and auth expiry still apply.

## Review and first check

Independent scoped source review found no verified blocking issue: full transaction IDs are used, detail composition leaves review mounted, read-only controls cannot mutate, original callers keep their actions. Gesture/back/large-font device verification is still pending. ADB reported no attached devices.

The first Gradle run compiled application code, then one newly added wiring assertion failed because it assumed LF while AssistantTab uses Windows CRLF. Fixed the test to accept whitespace via regex; also removed its nullable Java system-property warning. This was a test portability issue, not a runtime UI failure. Rerunning the complete Android checks.

## Final local validation

- `gradlew.bat testDebugUnitTest lintDebug assembleDebug --console=plain`: PASS.
- 25 JVM suites, 272 tests, zero failures/errors; 3 new source-wiring guards. No Compose instrumentation coverage is claimed.
- lint: zero errors, 43 existing warnings. Scoped whitespace checks passed.
- APK: `clients/android/app/build/outputs/apk/debug/app-debug.apk`, 22,218,895 bytes; SHA-256 `824E184520D50E3D2A40A1BCF2B2F6C32FD48DA65958C2FDF356CA8405F6CC5C`.
- No server changes, production deployment, paid Provider requests, staging/commit, or installation performed.
- Device acceptance pending: tap card vs checkbox, close/back/outside dismiss, preserve selection/list offset, long-note and large-font layout, missing/deleted transaction load/retry.

## Validation plan

Add regression tests for UI wiring/read-only separation and run all Android JVM tests, lintDebug and assembleDebug. Source-wiring tests are not real touch/device verification. Inspect existing detail loading behavior and preserve it. Record APK digest and device-test gaps after checks.
