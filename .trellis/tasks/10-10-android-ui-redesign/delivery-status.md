# Current delivery status

Updated 2026-10-10 after the user's explicit instruction to start implementation and allow parallel sub-agents.

## Active batch

| Owner | Files | Page scope | Status |
|---|---|---|---|
| Parent | `ui/MainShell.kt`, `ui/MyTab.kt` | Main tab icon, full-screen record flow and return destination; grouped secondary menu and hides main bar on subpages | In progress |
| `home_ui` | `ui/DashboardTab.kt` | S04; server-returned values, dashboard hierarchy | In progress |
| `ledger_ui` | `ui/TransactionsTab.kt`, `ui/TransactionEditSheet.kt`, `ui/LedgerLinkPicker.kt` | S05–S10; list/filter/editor/refund relationship | In progress |
| `budget_stats_ui` | `ui/BudgetTab.kt`, `ui/StatsTab.kt`, `ui/Charts.kt` | S11–S13 and S22 | In progress |
| `motion_settings` | `MainActivity.kt`, `ui/ThemePrefs.kt`, `ui/theme/JizhangTheme.kt`, `ui/ItemsTab.kt`, new `ui/MotionTokens.kt` | S46–S48; reduced-motion preference and tokens for M01–M11 | In progress |

The file lists are mutually exclusive. Preserve pre-existing uncommitted client work from earlier delivery tasks; these agents own only the files listed here. The local Git workspace already contains unrelated Android/backend task changes. Do not reset or blanket-stage them.

## Key accounting correction

Dashboard source computed monthly “balance” (`income - netExpense`) and total budget “remaining” (`totalBudget - totalSpent`) although the current server endpoints do not return those aggregate values. The user's design document says amounts must come from the server. The active implementation therefore removes or avoids those derived aggregate displays, while retaining the server's `incomeCents`, `netExpenseCents`, `totalBalanceCents`, `carryoverPoolCents`, and each module's `remainingCents`. Progress is a visual encoding of server values, never an invented money figure. S04 was corrected in the design README before the UI agent completed.

## Remaining acceptance

S01 session-check page, S03 dedicated server-address page and S07 read-only transaction detail are now implemented. Visual review on an installed device and physical Android API 26/HarmonyOS 4 smoke acceptance remain open. No device or emulator was connected during this pass. Do not mark the full UI task complete until device acceptance and any resulting fixes are addressed.

## Final integrated verification

The following build results belong to the preceding UI implementation batch. The subsequent feature-inventory batch is documentation-only and performs no APK build or runtime acceptance.

After code review corrections, lintDebug, lintVitalRelease, assembleDebug, assembleRelease and both Kotlin variants passed. The final debug lint report has 0 errors, 5 warnings and 21 informational findings; the warnings refer to the existing manifest and launcher resources. APK sizes, checksums and exact build command are recorded in verification.md. Automated tests and device smoke acceptance were not run.

## 2026-10-10 source-backed feature inventory

The user rejected the current UI direction and requested a complete, maintained feature catalogue before further redesign. The current deliverable is `clients/android/README.md`: 313 stable feature entries (including 30 assistant tools), fields/validation/actions/states, accounting rules, current source gaps, 108 registered service API method/path entries, 38 main Kotlin source files and 13 route files. Four research reports preserve the source audit. The design README links to this current-behaviour catalogue.

Maintenance is now required in `AGENTS.md` and the native-delivery spec: update affected feature IDs, entry points, fields, limits, API coverage, gaps and the change log in the same related code change. Root/client README links make the catalogue discoverable. This is a documentation workflow, not an installed automatic update service.

Parent static verification found 313 unique IDs matching all four research reports, exact 108/108 API coverage, all 38 main Kotlin files covered, and valid local file/directory links and internal navigation anchors. Independent review and final link counts are recorded in `function-inventory-check.md`. No product code, APK, server data or deployment was changed in this inventory batch; no new build, business test or device/runtime check was performed. Existing UI task acceptance remains open.

