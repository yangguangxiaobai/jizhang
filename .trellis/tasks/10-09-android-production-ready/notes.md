# Android delivery implementation notes (2026-10-09)

## Boundary and root causes

User approved implementation with 开始. Android-owned changes are clients/android/** and Android-specific delivery docs. Backend API/shared arithmetic stay unchanged. Web remains a read-only reference until actual full parity acceptance.

The original Kotlin UI covered many routes superficially, but not the full contract:
- CookieJar was process-memory only, returned expired/secure/path-incompatible cookies, and replaced session cookies when unrelated response cookies arrived.
- OkHttp `.method("POST", null)` rejected bodiless mutations before they reached Fastify.
- The manifest exported two launcher icons including a demo screen.
- Salary create lacked reachable management once a budget existed; no edit/delete/allocation. Templates lacked create/edit and printed fractional ratios as percentages.
- Recurring create omitted mandatory anchorDate.
- Items cutout button was placeholder; no job was ever created, candidates remained empty; no sell UI, no photo display, and edits overwrote purchaseDate with now.
- AI appended the complete server message history causing duplicate keys, discarded attachment bytes needed for import confirmation, lacked archive/provider editor and category overrides UI.
- CSV exports went to private external-app directories; document URIs were treated as actual filenames, losing extension/source detection.
- Transfer UI was only list/delete. Transaction tags/edit links, search filters/paging and category/account/template management were incomplete.

Fixes live at those actual owners: centralized request/cookie/auth handling; typed local input/file helpers; repository salary/stats/raw PUT functions; complete corresponding Compose workflows. Shared server monetary calculations are preserved.

## Checks actually run

`ANDROID_HOME=C:/Users/QUIZ/AppData/Local/Android/Sdk`, JDK17; Gradle wrapper used from clients/android.

1. Initial JVM CookieJar regressions reproduced three expected failures: expiredCookiesAreNotSent, secureCookiesAreNotSentOverHttp, unrelatedResponseDoesNotEraseSession.
2. Network tests after fixes passed: those three, persisted-session reconstruction/logout/domain isolation, URL validation, real MockWebServer zero-byte POST (CSRF/no Content-Type), raw photo PUT bytes/cookie/CSRF. Seven total.
3. Added date/cents regressions: dates pass strict rejection; unsafe-cents test reproduced failure before safe-integer bound fix. Nine total tests in final suite.
4. Combined debug `testDebugUnitTest assembleDebug lintDebug --no-build-cache` succeeded in 1m7s. Initial concurrent Gradle baseline had a manifest cache race; builds thereafter serialized. First lint exposed debug security domain includeSubdomains and edit-time suspicious indentation; fixed without suppressing errors.
5. Final debug/release tests/build/lint run is recorded below once complete.

## Parent-owned emulator evidence

Parent booted existing MuMu Android15 instance, connected adb127.0.0.1:16384, and used isolated synthetic ledger at HTTP loopback18081 with debug-only cleartext allowlist. Parent reports installed debug APK login passed, force-stop/relaunch restored session, a tagged12.34 expense succeeded, and Budget displayed total10000.00/used12.34/restaurant remaining3987.66. Screenshots and server assertions are parent-owned evidence. No production data or credentials were used.

## External pending and honest acceptance

Full feature replay on installed final APK remains required, particularly import/export with real xlsx/GBK bytes, configured AI provider/action confirmation, ordinary photo upload and private cutout candidates. HarmonyOS4 physical-device coverage and real https://jz.yansuu1.xyz deployment/auth are pending. Existing Harmony5/6 build evidence is historical; this round does not expand it. Release signing configuration is user-local; without it the release build remains development-signed. Web code cannot be removed until the parent acceptance gate is met.

## Implementer final local gate

Final serialized command: gradlew.bat :app:testDebugUnitTest :app:assembleDebug :app:lintDebug :app:assembleRelease :app:lintRelease --no-build-cache. BUILD SUCCESSFUL in 1m24s, 105 actionable tasks. Nine JVM tests passed. Debug APK17653491 bytes; release APK11241204 bytes, applicationId com.yansuu1.jizhang, versionName0.1.0/versionCode3, minSdk26. Demo source moved into debug source set; release contains only production launcher. Reviewer is taking subsequent error-feedback/day-picker/layout improvements and will re-run checks; these values identify this implementer build, not any later build.
