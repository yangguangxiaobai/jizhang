# Android parity evidence — 2026-10-09

This historical round targets Android and HarmonyOS 4 via the same APK. The retired Web source has since been removed from the workspace; Android acceptance remains pending independently of its removal. HarmonyOS 5/6 source and the 2026-10-06 unsigned HAP build are historical evidence only; no new Harmony 5/6 runtime claim is made.

Final production service: https://jz.yansuu1.xyz (user correction on 2026-10-09). Custom origin remains supported. Android debug builds alone allow local HTTP for integration.

## Evidence rules

Code implementation, a successful Gradle build, API tests and device tests are separate evidence. None alone establishes complete feature acceptance. Remaining device, provider, private cutout and production checks must stay pending until actually exercised. See `.trellis/tasks/10-09-android-production-ready/notes.md` for commands and results and the parent task for emulator/integration evidence.

| Contract | Android implementation and regression evidence | Runtime acceptance |
|---|---|---|
| A1 Network | Origin validation/default; persistent session cookie; expiry/path/secure matching; clear on origin change/logout; CSRF; zero-byte bodiless POST without JSON content type; shared raw PUT/download; JVM network regressions | Emulator core flow being verified by parent; real domain pending deployment |
| A2 Auth | Session restoration gate skips network when no cookie; bounded auth/me call; central 401 routes to login; login/logout/password | Parent records emulator restart/expiry evidence; Huawei device pending |
| A3 Transactions/transfers/trash | Transaction CRUD, tags, refund links, strict dates; list search/filter/paging; transfer create/edit/delete; trash individual/bulk actions | Full mutation replay on installed APK pending |
| A4 Budget | Current/history overview; all period choices; salary create/edit/delete/template choice/allocation snapshot editor; template CRUD/default/apply; cycle setting | Budget numbers must match server fixtures; parent core-chain evidence |
| A5 Recurring | Rule CRUD/enable; explicit anchorDate; generate/pending/confirm/ignore | Idempotency is server-tested; full APK replay pending |
| A6 Stats | category-share/monthly-trend/pool-trend; range; arbitrary month via server month-window; native charts | Same-seed number/chart comparison pending |
| A7 Master data | Category/account create/edit/move/usage/delete warning; tag rename/remove | Full APK replay pending |
| A8 Data | SAF save-to-location CSV export; CSV imports; platform bytes unchanged/base64 preview/select/category override/confirm; real displayName from SAF; bounded file reads; backups list/create; CLI-only restore | Platform xlsx/GBK file picker and CSV saved-byte comparison pending |
| A9 AI | Conversations/send/archive; full server message list replaces old list; pending-only actions; attachment bytes retained per action or reselected after recreation; import selection/category override; provider configuration/save/test | Real provider and action confirmation pending |
| A10 Items | CRUD/status/purchase date; sell/retire with chosen date; photo GET/PUT/DELETE; cutout create/poll/cancel/candidate preview and PNG upload | Ordinary upload and available private cutout service replay pending |
| A11 Appearance | System/light/dark and Titanium/Forest/Mono persisted | Installed screenshot review pending |
| A12 Navigation | Six tabs 首页/账单/预算/记一笔/统计/我的; AI/settings and other child pages in 我的; back handlers | Parent installed navigation evidence |

## Monetary truth

All ledger arithmetic is server/shared owned. Current `packages/shared/src/types.ts` uses the revised refund rule: an income transaction marked as refund counts as income and does not reduce the original expense; refund links record the relationship. Earlier backend index prose describing net-expense refunds was stale. Salary income is included in monthly-trend and has no category-share slice. Transfers affect account balances without entering income/expense statistics. Item assets remain separate from ledger/account assets. Android only formats cents and renders server outputs; display ratios and graph coordinates are presentation.

## External acceptance still required

- Android version coverage beyond the available Android 15 emulator and physical HarmonyOS 4 installation.
- Real HTTPS domain deployment/login using preserved server data and signing-key continuity.
- Full feature replay with CSV/GBK/xlsx, a configured AI provider and the optional private cutout service.
- Web removal is not evidence of Android acceptance or production deployment; the checks above remain pending.
