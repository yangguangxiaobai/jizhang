# Final quality readback — AI bill import improvements

Date: 2026-10-17  
Scope: documentation-only evidence reconciliation for `.trellis/tasks/10-17-ai-bill-import-improvements`. This readback does not rerun builds or alter source/tests/spec/inventory/README/task status. It rechecks existing command logs, Android XML, APK/resource hashes and synthetic wire artifacts.

## Rechecked current local evidence

### Backend + shared

`artifacts/import-final-{shared,server}-{lint,typecheck,test,build}.log` each ends with `EXIT_CODE=0`. The fresh test logs report:

- Shared: 7 test files, **187 tests passed**.
- Server: 30 test files, **684 tests passed**.
- This is the current recorded run; do not substitute older backend notes (185/662/677) or conflate the 115 API inventory count with a test delta.

### Android full test/lint/build evidence (existing run, not rerun here)

The recorded command in `research/android-identity-wire-fix.md` and `artifacts/android-identity-wire-fix.log` is `./gradlew testDebugUnitTest lintDebug assembleDebug --rerun-tasks --no-parallel`. The current local XML/artifact readback independently confirms:

- 12 `TEST-*.xml` suites; **156 tests, 0 failures, 0 errors, 0 skipped**.
- `app/build/reports/lint-results-debug.xml`: **0 errors, 9 warnings** (21 informational entries; not warnings).
- `clients/android/app/build/outputs/apk/debug/app-debug.apk`: **18,473,623 bytes**, SHA-256 `ec2ab9e55f8f78db2b84a5fd5884d413011f7fd5b05733bbebb921ce700deba0`.

This is local build/test evidence only. It does not establish APK installation, device/UI acceptance, provider behavior or production delivery.

### Wire-fixture to Kotlin production decoder

The checked-in test `realServerWireResponsesDecodedByProductionDecodersConsistentWithViewRevisionAndCatalog` at `AssistantBatchNetworkContractTest.kt:1003` loads fixture resources and passes each of the 34 `rows.json` objects through `ImportBatchRow.fromJson`; it is not a test-only DTO stand-in. The same test exercises the production batch/category decoders. The recorded fix and tests establish the server enum values `platform_order` and `occurrence` are accepted while unsupported/unknown values continue to fail closed; `ImportRowAi.reason` null maps to an empty string.

The five Android fixture resource SHA-256s were recomputed and match the published values in `research/android-identity-wire-fix.md`:

- `manifest.json`: `11f0bb6bbaa799d913e7842cca5aba89424fcbd106d0969ab1ae96ce2927495e`
- `batch.json`: `60080c906bc1ea0ebe091a58183090cc537ec00d5926d1fb8d1d9e93fa007c11`
- `rows.json`: `efd5e2a0bb34b04c55b4d53413aa6ddbd3624d51b453f1fb704d01d4eea58487`
- `categories.json`: `9733fb5079c56de7dcadbc50227613495e742399293febcb4f2fec241f382bc9`
- `review.json`: `1592dce1a040b5c0112bff3f41e4fa2680b4a2f4f0ac8a6911af927057b191d4`

The route fixture manifest records a **synthetic** Fastify `app.inject` + in-memory SQLite run, 34 rows, `analyse:false`, zero provider calls and unchanged category/account table hashes. Its review JSON has the synthetic token marker; `userExcluded` is JSON null (unknown/untracked, not numeric zero), and the response separately reports eight rule-ignored rows. The fixture does not represent a real provider, device, user export or financial confirmation.

### Migration and resource benchmark

`artifacts/merged-import-migration-check.log` is an existing synthetic temporary pre-012 SQLite probe, not a fresh run in this readback: migration 012 added the four batch tables/four indexes, preserved pre-existing tables/indexes, returned integrity `ok` and no FK violations, and a second migration/init was idempotent. No production database was inspected or migrated.

Synthetic benchmark records must remain run-specific and must not be blended:

- Latest independently reviewed run: `research/backend-independent-review-verification.log` reports 500 generated CSV rows accepted in **97 ms / +6.6 MiB heap**, 501 materialized items rejected, 3001 raw rows rejected and 64 MiB inflated XLSX rejected at the 8 MiB entry cap.
- Earlier runs have different results (for example 91 ms / +9.1 MiB in `artifacts/import-review-gates.log`; another historical record is 50 ms / about +11 MiB). These are separate runs, not contradictory values to average or combine.
- No genuine export was available for calibration. No production resource-safety claim follows from synthetic data.

## Evidence classification / final boundary

- **Local backend/shared quality gates:** PASS (fresh logs above).
- **Android unit tests, lint and APK build:** PASS based on the recorded full rerun and direct current XML/hash check; no device verification.
- **Synthetic production-decoder wire fixture:** PASS across all 34 rows using production Kotlin decoders; fixtures unchanged.
- **Isolated migration probe:** PASS as historical local synthetic evidence, not rerun in this final readback.
- **Real-export budget calibration:** NOT COMPLETE; no representative original export was used.
- **Real provider (including live failure behavior), Android device/UI, production deployment/database migration, real booking/ledger write:** NOT VERIFIED / NOT PERFORMED.

Therefore the accurate disposition is: **本地质量门通过、真实provider/设备/生产未验证、真实样本预算标定未完成。** This is not a production/release acceptance statement. No evidence supports marking the real-export benchmark or external release/commit complete. Older reports remain historical records; this readback supersedes their stale final-status summaries without rewriting those evidence files.

## Tools/readback performed

Read task contract and frozen protocol, prior integration/wire/Android identity fix/backend live-view/backend implementation/spec-migration reports; inspected logs and migration artifact; parsed the Android Gradle XML suite and lint XML; recomputed APK and five test-resource hashes; parsed the synthetic route-fixture manifest/review JSON; confirmed the test invokes the production row decoder on all fixture rows. No build, test, provider, device, deploy, dependency, source/config/spec/README change, staging, commit, task phase/status change or nested task action was performed for this readback.
