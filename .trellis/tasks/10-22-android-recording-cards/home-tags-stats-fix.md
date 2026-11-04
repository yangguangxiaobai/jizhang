# Home action, existing tags, statistics access — 2026-10-26

User explicitly requests completing three Android corrections first. Continue the existing recording/UI correction task; pending AI model discovery remains out of scope.

## Requirements and boundary

1. Remove only the duplicate bottom-of-home content button labeled 记一笔; retain global center + action and ledger add entry.
2. Offer existing tag selection in new/edit/refund transaction forms using GET /tags through MetaRepository.tags, with multiple selections and existing manual tag input preserved. Fetch failure must not block record loading or erase tags; allow retry. Use existing name-array payload and splitMultiValue semantics, no tag writes before transaction save.
3. Restore an explicit always-visible home statistics entry using existing onOpenStats/MainShell/StatsTab; no new graph computation. Keep entry accessible even when dashboard main fetch fails.

Behavior owners: DashboardTab.kt (home content), MainShell.kt (existing callback wiring), TransactionEditSheet.kt (editor), TransactionEditorHelper.kt (existing tag split semantics, optionally minimal tested name/toggle helper). Update Android README affected stable IDs L01.04/L01.07/L04.06, navigation/API coverage and change log in the same change. Add tests for tag parsing/toggling and source wiring, acknowledging that JVM checks do not establish device touch behavior. Do not modify Provider settings, backend/data/schema, financial calculations, unrelated dirty changes, commit or deploy.

## Final results and reuse contracts

- Home statistics uses the existing callback and StatsTab only. Keep navigation outside data-dependent dashboard branches so failures cannot remove access.
- Tag vocabulary is existing GET /tags live-used names (`{items:[{name,count}]}`), not zero-use hierarchy entities. Selection uses exact names and retains legacy/manual draft tags; only explicit transaction save persists them. Catalogue load failure must never reset the main form or baseline.
- Android `gradlew.bat testDebugUnitTest lintDebug assembleDebug --console=plain`: PASS. 28 suites / 285 JVM tests; zero failures/errors. New coverage: 7 production tag-helper tests + 3 source-wiring guards; not Compose gesture evidence.
- lint: 0 errors, 43 baseline warnings; scoped whitespace check passed.
- Independent read-only source review: no verified blocking issue. No server/financial/save mutation changes found; original keyboard recovery preserved.
- APK: `clients/android/app/build/outputs/apk/debug/app-debug.apk`, 22,233,469 bytes, SHA256 `D2A0CD732D1EB528AFD2EB4645F01AAB18606CC3313307BB30F98EB19CB0B7C2`.
- ADB detected JER-AN20. No installation or live ledger interactions performed this turn. Device verification pending for row/checkbox single toggles, search/reopen, retry/401/cancellation, home/statistics/back, IME and large-font layout. No deployment or commit.

## Validation

Run Android testDebugUnitTest, lintDebug and assembleDebug; independent scoped review; inspect connected devices. APK deliverable and exact digest recorded after build. Installation is not assumed from previous install authorization.
