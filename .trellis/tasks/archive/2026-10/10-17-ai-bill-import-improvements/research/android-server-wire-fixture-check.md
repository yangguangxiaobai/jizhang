# Android Server Wire Fixture Check & Production Decoder Regression Report

Task: `.trellis/tasks/10-17-ai-bill-import-improvements`  
Date: 2026-10-17  
Scope: Regression testing real server JSON fixtures against production Android decoders. Only Android test code and test resources modified; product source code preserved intact; no server/shared/spec/protocol edits; no device/deployment/model configuration changes.

## 1. Test Resources & Safe Synthetic Provenance

Copied real Fastify server JSON fixtures generated via `app.inject` from `artifacts/import-integration-fixtures/` to dedicated, self-contained Android test resources at `clients/android/app/src/test/resources/fixtures/import/`:

- `manifest.json`: generator metadata, exit code 0, provider calls 0, source file SHA-256s.
- `batch.json`: real `GET /import-batches/:id` response (34 items, viewRevision `126d2705b6c6ea0a4f48328c4f9d8a812b2fd011b5c413ddaa614db0d0dee2d1`).
- `rows.json`: combined GET rows response containing 34 server-generated rows.
- `categories.json`: real `GET /categories` response with 8 builtin categories and 1 server-fallback suggestion (`nc-fallback-0-1`, name `"其他"`, type 0).
- `review.json`: real `POST /review` response with synthetic redacted token `<SYNTHETIC_REDACTED_REVIEW_TOKEN>`.

### Resource Security & Verification
- No cookies, session tokens, passwords, or API keys are stored in the test resources.
- `reviewToken` is strictly redacted to `<SYNTHETIC_REDACTED_REVIEW_TOKEN>`.
- Resource SHA-256s match the source artifacts byte-for-byte:
  - `manifest.json`: `11f0bb6bbaa799d913e7842cca5aba89424fcbd106d0969ab1ae96ce2927495e`
  - `batch.json`: `60080c906bc1ea0ebe091a58183090cc537ec00d5926d1fb8d1d9e93fa007c11`
  - `rows.json`: `efd5e2a0bb34b04c55b4d53413aa6ddbd3624d51b453f1fb704d01d4eea58487`
  - `categories.json`: `9733fb5079c56de7dcadbc50227613495e742399293febcb4f2fec241f382bc9`
  - `review.json`: `1592dce1a040b5c0112bff3f41e4fa2680b4a2f4f0ac8a6911af927057b191d4`

## 2. Added Production Decoder Tests

Added two regression test methods in `clients/android/app/src/test/java/com/yansuu1/jizhang/net/AssistantBatchNetworkContractTest.kt`:

1. `realServerWireResponsesDecodedByProductionDecodersConsistentWithViewRevisionAndCatalog`:
   - Decodes `batch.json` using `ImportBatch.fromJson(batchJson)`.
   - Validates dynamic `batchId`, status `"prepared"`, `viewRevision`, 34 total items, 8 ignored items.
   - Decodes `categories.json` using `ImportBatchCategoriesResponse.fromJson(catsJson)`.
   - Validates viewRevision and batchId alignment, 8 active catalog categories, and the server-fallback suggestion.
   - Inspects `rows.json` as a combined collection of 34 rows, verifying `viewRevision` and batchId alignment.
   - Invokes production `ImportBatchRow.fromJson` on row items.

2. `realServerWireReviewResponseDecodedWithSelectedRowsAndCounts`:
   - Decodes `review.json` using production `ReviewResponse.fromJson(reviewJson)`.
   - Verifies redacted token `<SYNTHETIC_REDACTED_REVIEW_TOKEN>` and matching `viewRevision`.
   - Verifies `selected == 2` with 2 selected rows:
     - Row 1: Existing category fallback (`builtin-income-other`, name `"其他收入"`, `categoryType == 1`, `note == "罗文 (stylish)"`).
     - Row 2: Server-fallback Other suggestion (`nc-fallback-0-1`, approved name `"其他"`, `categoryType == 0`, explicit empty string note `note == ""`).
   - Verifies `categoriesToCreate` contains 1 plan (`"其他"`, type 0).
   - Verifies `counts`: `total == 34`, `selected == 2`, `ruleIgnored == 8`, `userExcluded == null`.
   - **Result: PASSED.**

## 3. Real Wire Contract Finding (Reported, Unmodified Product Code)

During test execution, `realServerWireResponsesDecodedByProductionDecodersConsistentWithViewRevisionAndCatalog` threw:

```
java.lang.IllegalArgumentException: Unknown identityKind: platform_order
    at com.yansuu1.jizhang.ui.feature.assistant.ImportBatchRow$Companion.fromJson(AssistantBatchModels.kt:411)
```

### Root Cause Analysis
- Server contract definition (`packages/server/src/services/import-batch-types.ts:83`):
  ```typescript
  export type ImportIdentityKind = 'platform_order' | 'occurrence';
  ```
  Real server WeChat rows produce `identityKind: "platform_order"`.
- Android production decoder (`AssistantBatchModels.kt:409-413`):
  ```kotlin
  val identityKind = obj.optCleanString("identityKind") ?: "occurrence"
  if (identityKind != "occurrence" && identityKind != "legacy_order") {
      throw IllegalArgumentException("Unknown identityKind: $identityKind")
  }
  ```
  The Android client checks for `"occurrence"` and `"legacy_order"`, but omits the server's `"platform_order"`.
- Per instruction guidelines ("不改产品源码(发现bug先report)" and "不得手写DTO冒充解析；如果失败因为真实wire不符报告真实FAIL，别只改fixture造绿"):
  - Product code in `AssistantBatchModels.kt` was **not modified**.
  - Fixtures were **not modified** to mask the issue.
  - The actual test failure is reported honestly as a real wire discrepancy for subsequent targeted fix.

## 4. Full Android Verification Suite Summary

| Check | Command | Result | Details |
|---|---|---|---|
| Unit Tests | `./gradlew testDebugUnitTest --no-parallel` | 155 tests (154 passed, 1 failed) | `realServerWireReviewResponseDecodedWithSelectedRowsAndCounts` passed; `realServerWireResponses...` failed on `identityKind: platform_order`. |
| Lint | `./gradlew lintDebug --no-parallel` | SUCCESS | 0 errors, 0 warnings. |
| Assemble Debug | `./gradlew assembleDebug --no-parallel` | SUCCESS | APK SHA-256: `0c956aacb1eba013ac064090f407de3253f9b09a20517fcea3fe7ec4017d696e` (19,580,136 bytes). |
| Assemble Release | `./gradlew assembleRelease --no-parallel` | SUCCESS | APK SHA-256: `441b709da69b2b38e3a5c630c1f2a5f4264d323f9d43f83769ffd3c91926f047` (11,699,996 bytes). |

Full build log recorded at `artifacts/android-server-wire-fixture-check.log`.
