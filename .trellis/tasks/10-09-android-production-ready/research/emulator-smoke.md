# Android 15 parent-session runtime evidence

Date: 2026-10-09. Device: the existing MuMu Android 15 instance, portrait mode.
Backend: an isolated synthetic ledger on host loopback port 18081, forwarded by
adb reverse. No production credentials or data were used.

## Tested behavior

- Installed the new debug APK, entered a test server/account and logged in.
- Force-stopped and cold-launched the app: the valid session restored the dashboard.
- Created an expense of 12.34 yuan, note `native_smoke`, tag `native_check`.
  The list showed the amount/category/account/tag. Budget reported total 10000.00,
  used 12.34 and restaurant remaining 3987.66; see `android15-budget-smoke.png`.
- Logout returned to login, exercising a bodiless authenticated POST. Relogin worked.
- Expired the isolated database sessions while the shell was mounted and requested
  Budget. The first reviewed APK reproduced an empty-shell/stale-username loop.
  After the LoginScreen fix, two separate hierarchy dumps stayed on the login form.
  Relogin and another cold launch restored the valid session correctly.
- Final combined list UI displayed search, filters, paging and the saved tag.
- Salary edit opened with saved fields; submitting unchanged allocation values
  succeeded. Final source resolves category names rather than raw IDs.
- Exported transactions through Android's system CreateDocument chooser. The app
  confirmed CSV saved; the generated synthetic file was 172 bytes.
- The initial MIME-filtered import chooser displayed that exported CSV disabled.
  After the provider-compatible picker fix, the same file was selectable. Import
  reported inserted 0 / skipped 1 / read 1, preserving duplicate-ID semantics.
  See `android15-csv-roundtrip.png`.
- Created a database backup from the app; the list refreshed with a 300 KB snapshot.
- Created category `native_category` through the category dialog.
- Created account `native_account` with initial balance -10.00; the list showed
  balance -10.00 / initial -10.00.
- Created template `native_template` with restaurant 100%; the list showed 100%,
  validating the UI percentage-to-server-fraction contract without changing the
  existing default template or current allocations.

## Limits

This is Android 15 emulator evidence, not physical Android or HarmonyOS 4 evidence.
It does not establish complete feature parity. Platform GBK/xlsx imports, real
provider responses, private cutout inference, camera behavior, all edit/delete and
edge cases, and production HTTPS/preserved-data migration still need acceptance.
Web source remains the temporary reference until the full retirement gate passes.

Final reviewer build evidence: 11 JVM tests, debug/release compilation and APK
assembly, debug/release lint passed. Release variant remains development-signed
without user-local release signing material.
