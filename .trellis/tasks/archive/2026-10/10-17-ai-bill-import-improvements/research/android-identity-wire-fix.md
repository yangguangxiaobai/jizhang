# Android Identity Wire Fix & Production Decoder Full Verification

Task: `.trellis/tasks/10-17-ai-bill-import-improvements`  
Date: 2026-10-17  
Scope: Android batch model decoder fix, 3-branch unit tests, real server fixture full 34-row validation, verification logs. Server, shared, spec, README, protocol fixtures, device/deploy/model configurations preserved without modification.

---

## 1. Problem Statement & Failing Baseline

During wire fixture verification against real Fastify server JSON fixtures (`research/android-server-wire-fixture-check.md`), `realServerWireResponsesDecodedByProductionDecodersConsistentWithViewRevisionAndCatalog` threw:

```
java.lang.IllegalArgumentException: Unknown identityKind: platform_order
    at com.yansuu1.jizhang.ui.feature.assistant.ImportBatchRow$Companion.fromJson(AssistantBatchModels.kt:411)
```

- **Pre-Fix Test Results**: 155 unit tests (154 passed, 1 failed).
- **Failing Test**: `com.yansuu1.jizhang.net.AssistantBatchNetworkContractTest > realServerWireResponsesDecodedByProductionDecodersConsistentWithViewRevisionAndCatalog`.
- **Root Cause**: Android production decoder checked:
  ```kotlin
  val identityKind = obj.optCleanString("identityKind") ?: "occurrence"
  if (identityKind != "occurrence" && identityKind != "legacy_order") {
      throw IllegalArgumentException("Unknown identityKind: $identityKind")
  }
  ```
  The server wire contract (`packages/server/src/services/import-batch-types.ts:83`) defines:
  ```typescript
  export type ImportIdentityKind = 'platform_order' | 'occurrence';
  ```
  Real WeChat statement rows generate `identityKind: "platform_order"`. The Android decoder was rejecting valid server `platform_order` rows while retaining an unsupported `legacy_order` branch that does not exist in the server batch protocol.

---

## 2. Targeted Production Fixes

### 2.1 Authoritative `identityKind` Strict Guard (`AssistantBatchModels.kt`)
Updated `ImportBatchRow.fromJson` to enforce authoritative server identity enum values:
```kotlin
val itemId = obj.optCleanString("itemId")
    ?: throw IllegalArgumentException("ImportBatchRow requires non-empty itemId")
val identityKind = obj.optCleanString("identityKind") ?: "occurrence"
if (identityKind != "platform_order" && identityKind != "occurrence") {
    throw IllegalArgumentException("Unknown identityKind: $identityKind")
}
```
- Replaced outdated `legacy_order` with `platform_order`.
- Strict guard preserved: reject any unknown or unsupported identity kind (including `legacy_order`) with `IllegalArgumentException("Unknown identityKind: $identityKind")`.
- No fake support for `legacy_order` in batch production protocol.

### 2.2 Semantic Null Handling on `ai.reason` (`AssistantBatchModels.kt`)
Updated `ImportRowAi.fromJson` to use `optCleanString`:
```kotlin
reason = obj.optCleanString("reason") ?: "",
```
In real wire rows (e.g. Row 0 of `rows.json`), server produces `"reason": null`. Using `optCleanString("reason") ?: ""` guarantees that null or blank reason values on the wire cleanly map to empty string `""` across both JVM test runner and Android framework `libcore/json` runtime, preventing literal `"null"` string coercion.

---

## 3. Unit Test Additions & Full Row Validation

### 3.1 3-Branch Production Decoder Test
Added `productionRowDecoderAcceptsPlatformOrderAndOccurrenceAndRejectsUnknownIdentityKind` in `AssistantBatchNetworkContractTest.kt`:
1. **Branch 1 (`platform_order`)**: Validates decoding of `identityKind: "platform_order"`, verifying `row.identityKind == "platform_order"`.
2. **Branch 2 (`occurrence`)**: Validates decoding of `identityKind: "occurrence"`, verifying `row.identityKind == "occurrence"`.
3. **Branch 3 (`unknown` / fail-close)**:
   - Validates that `identityKind: "legacy_order"` is strictly rejected with `IllegalArgumentException: Unknown identityKind: legacy_order`.
   - Validates that arbitrary unknown string `identityKind: "custom_kind"` is strictly rejected with `IllegalArgumentException: Unknown identityKind: custom_kind`.

### 3.2 Real Fixture Full 34 Rows Verification
Enhanced `realServerWireResponsesDecodedByProductionDecodersConsistentWithViewRevisionAndCatalog` in `AssistantBatchNetworkContractTest.kt`:
- Validates **all 34 rows** from real Fastify server fixture `rows.json` (not just row 0).
- Across all 34 entries:
  - `itemId.isNotBlank() == true`
  - `ordinal == index` (sequential 0..33)
  - `identityKind in ("platform_order", "occurrence")`
  - `amountCents > 0`
  - `type in (0, 1)`
  - `dateLabel.isNotBlank() == true`
  - `fallback` and `ai` sub-objects present and valid.
- Specific boundary assertions:
  - Row 0 (neutral expense, ignored): `itemId == "po:wechat:07264ee30c7414e6bb5876e8d0ecfb1f"`, `identityKind == "platform_order"`, `ignored == true`, `ignoreReason == "中性交易"`, `fallback.categoryName == "其他"`, `fallback.newOtherSuggestionId == "nc-fallback-0-1"`, `ai.status == "none"`, `ai.include == null`, `ai.reason == ""`.
  - Row 33 (final item): `itemId == "po:wechat:7c3968b5588827812d4f0826c40113c2"`, `identityKind == "platform_order"`, `ordinal == 33`, `ignored == false`, `note == "罗文 (stylish)"`, `fallback.effectiveExistingId == "builtin-income-other"`.
  - Total ignored count: exactly 8 rows.

---

## 4. Full Verification Suite Results

Executed full clean verification via `./gradlew testDebugUnitTest lintDebug assembleDebug --rerun-tasks --no-parallel`:

| Step | Command | Exit | Result Summary | Evidence |
|---|---|---|---|---|
| **Unit Tests** | `./gradlew testDebugUnitTest --no-parallel` | 0 | **156 passed, 0 failed, 0 errors, 0 skipped** (Previous: 155 tests, 1 failed) | `app/build/test-results/testDebugUnitTest/*.xml` |
| **Lint** | `./gradlew lintDebug --no-parallel` | 0 | **0 errors, 9 baseline warnings** (0 new warnings introduced) | `app/build/reports/lint-results-debug.xml` |
| **Assemble** | `./gradlew assembleDebug --no-parallel` | 0 | **BUILD SUCCESSFUL** | `app/build/outputs/apk/debug/app-debug.apk` |

### 4.1 Unit Test Breakdown by Suite (12 XML Suites, 156 Tests)
- `TEST-com.yansuu1.jizhang.net.AssistantBatchNetworkContractTest.xml`: 20 tests, 0 failures, 0 errors
- `TEST-com.yansuu1.jizhang.net.CancellableBlockingFlowTest.xml`: 1 test, 0 failures, 0 errors
- `TEST-com.yansuu1.jizhang.net.NetworkContractTest.xml`: 10 tests, 0 failures, 0 errors
- `TEST-com.yansuu1.jizhang.net.SseParserTest.xml`: 12 tests, 0 failures, 0 errors
- `TEST-com.yansuu1.jizhang.ui.InputContractTest.xml`: 4 tests, 0 failures, 0 errors
- `TEST-com.yansuu1.jizhang.ui.ProviderSettingsHelperTest.xml`: 5 tests, 0 failures, 0 errors
- `TEST-com.yansuu1.jizhang.ui.feature.assistant.AssistantBatchImportStateTest.xml`: 45 tests, 0 failures, 0 errors
- `TEST-com.yansuu1.jizhang.ui.feature.assistant.AssistantConversationHelperTest.xml`: 25 tests, 0 failures, 0 errors
- `TEST-com.yansuu1.jizhang.ui.feature.assistant.AssistantDuplicateStateTest.xml`: 5 tests, 0 failures, 0 errors
- `TEST-com.yansuu1.jizhang.ui.feature.assistant.AssistantIdentityCoordinatorTest.xml`: 6 tests, 0 failures, 0 errors
- `TEST-com.yansuu1.jizhang.ui.feature.assistant.AssistantImportStateTest.xml`: 10 tests, 0 failures, 0 errors
- `TEST-com.yansuu1.jizhang.ui.feature.assistant.AssistantStreamReducerTest.xml`: 13 tests, 0 failures, 0 errors

### 4.2 Lint Baseline Warnings (9 warnings from XML report)
- `ModifierParameter` (4): `AssistantStreamingComponents.kt:62`, `FinanceComponents.kt:127, 257, 489`
- `DataExtractionRules` (1): `AndroidManifest.xml:8`
- `ObsoleteSdkInt` (1): `res/mipmap-anydpi-v26`
- `UnusedResources` (1): `ic_launcher_round.png`
- `IconLauncherShape` (2): `ic_launcher.png`, `ic_launcher_round.png`
- Total: 0 errors, 9 warnings. No new warnings introduced.

### 4.3 Assemble Debug Artifact
- Path: `clients/android/app/build/outputs/apk/debug/app-debug.apk`
- Size: `18,473,623` bytes (17.62 MB)
- SHA-256: `ec2ab9e55f8f78db2b84a5fd5884d413011f7fd5b05733bbebb921ce700deba0`

---

## 5. Test Resources Integrity Check

All 5 test fixture files in `clients/android/app/src/test/resources/fixtures/import/` were verified against their baseline SHA-256 hashes and remained completely untouched:
- `manifest.json`: `11f0bb6bbaa799d913e7842cca5aba89424fcbd106d0969ab1ae96ce2927495e` (UNTOUCHED)
- `batch.json`: `60080c906bc1ea0ebe091a58183090cc537ec00d5926d1fb8d1d9e93fa007c11` (UNTOUCHED)
- `rows.json`: `efd5e2a0bb34b04c55b4d53413aa6ddbd3624d51b453f1fb704d01d4eea58487` (UNTOUCHED)
- `categories.json`: `9733fb5079c56de7dcadbc50227613495e742399293febcb4f2fec241f382bc9` (UNTOUCHED)
- `review.json`: `1592dce1a040b5c0112bff3f41e4fa2680b4a2f4f0ac8a6911af927057b191d4` (UNTOUCHED)
