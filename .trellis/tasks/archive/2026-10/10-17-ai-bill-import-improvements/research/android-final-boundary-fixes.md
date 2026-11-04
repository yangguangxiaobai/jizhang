# Android Final Boundary Fixes & Static Review Remediation

Task: `.trellis/tasks/10-17-ai-bill-import-improvements`  
Document: `research/android-final-boundary-fixes.md`  
Scope: Android Native Layer only (`AssistantBatchModels.kt`, `AssistantBatchImportWorkspace.kt`, tests)  
Date: 2026-10-17  
Status: ALL 5 FINDINGS REMEDIATED & VERIFIED (Unit tests passed, Lint verified, APK assembled)

---

## 1. Scope & Hard Boundaries
- **Exclusive focus**: Remediate the 5 specific findings from the static cross-layer review (`research/final-cross-layer-review.md`):
  1. `ReviewSelectedRow` reads server `categoryType` and `approvedNewCategoryName`, displaying category expense/income type and planned-new badge on each row; exact empty string note `""` retained; category plan names and counts in summary preserved.
  2. `parseStrictLong` / `parseStrictInt`: Exact BigDecimal parsing via `BigDecimal(raw.toString()).longValueExact()` avoiding IEEE-754 Double precision overflow at 2^63 boundary, rejecting non-finite, fractions, strings, and out-of-range values fail-close without client 32-bit truncation.
  3. `ReviewSummary.counts`: Decodes typed `total`, `selected`, `notSelected`, `preexisting`, `ruleIgnored`, `conflictRows`, and nullable `userExcluded`; renders independent labels without conflating `ruleIgnored` with `userExcluded`; renders `null` as `"未提供"` (never 0); preserves financial amounts from server without client recalculation.
  4. `loadFullBatch`: Bounded 5 pages with pure reducer verification (`validateAndReduceBatchPages`) ensuring `uniqueItemIds.size == declaredTotal == b.summary.totalItems`, cursor exhaustion, duplicate cursor loop rejection, abnormal empty page rejection, page total consistency, retry bounding, and preservation of user manual drafts on failure.
  5. `viewRevision`: Required non-empty across all GET DTO decoders (`ImportBatch`, `ImportBatchRowsPage`, `ImportBatchCategoriesResponse`, `ReviewResponse`); strictly matched across all pages without blank wildcard fallback; legacy DTOs untouched.
- **Zero modification**: No changes to backend, shared, spec, README, protocol fixtures, device setup, provider integrations, deploy configs, git stage/commit, or nested workflows.

---

## 2. Technical Remediation Details

### 2.1 Item 1: `ReviewSelectedRow` Server Fields & Per-Row Plan Display
- **Model Decoder (`AssistantBatchModels.kt`)**:
  - Added `categoryType: Int? = null` and `approvedNewCategoryName: String? = null` to `ReviewSelectedRow`.
  - In `ReviewSelectedRow.fromJson`:
    ```kotlin
    categoryType = obj.optNullableIntFact("categoryType"),
    approvedNewCategoryName = obj.optCleanString("approvedNewCategoryName"),
    note = obj.optNullableString("note"),
    ```
  - Exact note retention: When server returns `note: ""`, `optNullableString` returns `""` (non-null). In row resolution, `r.note ?: r.resolvedNote ?: ...` preserves `""` exactly rather than falling back to draft notes or placeholders.
- **Workspace Projection (`AssistantBatchImportWorkspace.kt`)**:
  - Identified planned-new state: `val isPlannedNew = r.approvedNewCategoryName != null`.
  - Resolved category name prioritizing approved new category name:
    `val catName = r.approvedNewCategoryName ?: r.categoryName ?: ...`
  - Resolved category type label:
    `val catType = r.categoryType ?: loadedRow?.let { activeLeaves.firstOrNull { c -> c.id == r.categoryId }?.type }`
    `val catTypeLabel = when (catType) { 1 -> "收入分类"; 0 -> "支出分类"; else -> null }`
  - Per-row UI renders:
    - `"分类: $catName${if (catTypeLabel != null) " ($catTypeLabel)" else ""}"`
    - Planned-new badge when `isPlannedNew`: `Surface(color = t.accent.copy(alpha = 0.15f)) { Text("拟新建", color = t.accent) }`
    - Note display: `if (note.isNotBlank()) "备注: $note" else "备注: (空备注)"`.
  - Existing summary cards `categoriesToCreate` and `categoriesToReuse` retain full name, type, and count displays.

### 2.2 Item 2: Exact Long/Int Parsing Fail-Close at 2^63 Boundary
- **Root Cause**:
  Previously, `parseStrictLong` converted `raw.toDouble()` and compared `d > Long.MAX_VALUE.toDouble()`. Because `Long.MAX_VALUE.toDouble()` rounds up to `2^63` in IEEE-754 double precision, `9223372036854775808` evaluated `>` as false and was cast via `toLong()`.
- **Exact Reader Implementation (`AssistantBatchModels.kt`)**:
  ```kotlin
  private fun parseStrictLong(key: String, raw: Any): Long {
      if (raw is String) {
          throw IllegalArgumentException("Field '$key' expected number, got String: $raw")
      }
      if (raw !is Number) {
          throw IllegalArgumentException("Field '$key' expected number, got ${raw.javaClass.simpleName}")
      }
      if (raw is Double || raw is Float) {
          val d = raw.toDouble()
          if (d.isNaN() || d.isInfinite()) {
              throw IllegalArgumentException("Field '$key' is non-finite: $d")
          }
      }
      val bd = try {
          java.math.BigDecimal(raw.toString())
      } catch (e: Exception) {
          throw IllegalArgumentException("Field '$key' invalid number format: $raw", e)
      }
      return try {
          bd.longValueExact()
      } catch (e: ArithmeticException) {
          throw IllegalArgumentException("Field '$key' is fractional or out of range for Long: $raw", e)
      }
  }
  ```
  - Analogous implementation for `parseStrictInt` using `bd.intValueExact()`.
  - Handles `Long.MAX_VALUE` (9223372036854775807L) and `Long.MIN_VALUE` (-9223372036854775808L) exactly.
  - Rejects `2^63` (`9223372036854775808`), `2^63 + 1`, `-2^63 - 1` with `ArithmeticException: Overflow`.
  - Rejects fractional values (`12.34`, `12.5`) with `ArithmeticException: Rounding necessary`.
  - Rejects `Double.NaN`, `Double.POSITIVE_INFINITY`, `Double.NEGATIVE_INFINITY`.
  - Supports 53-bit safe JS integer values (e.g. 9007199254740991L) without client 32-bit truncation.

### 2.3 Item 3: `ReviewSummary.counts` Typed DTO & Projection
- **Model Decoder (`AssistantBatchModels.kt`)**:
  - Added `ReviewSummaryCounts`:
    ```kotlin
    data class ReviewSummaryCounts(
        val total: Int,
        val selected: Int,
        val notSelected: Int,
        val preexisting: Int,
        val ruleIgnored: Int,
        val conflictRows: Int,
        val userExcluded: Int? = null,
    )
    ```
  - Added `counts: ReviewSummaryCounts? = null` to `ReviewSummary`.
  - Decoded using `obj.optJSONObject("counts")?.let { ReviewSummaryCounts.fromJson(it) }`.
- **UI Projection (`AssistantBatchImportWorkspace.kt`)**:
  - Independent dimensions:
    - 批次记录总数: `c.total`
    - 未选入笔数: `c.notSelected`
    - 规则忽略账单: `c.ruleIgnored` (separate from user exclusion)
    - 账本已存在账单: `c.preexisting`
    - 冲突账单笔数: `c.conflictRows`
    - 用户主动排除: `if (c.userExcluded != null) "${c.userExcluded} 笔" else "未提供"` (null rendered as `"未提供"`, never 0).
  - Legacy fallback preserved when `counts == null`.
  - Server financial amounts (`amountCents`, `expenseCents`, `incomeCents`, `refundIncomeCents`) displayed directly without client recalculation.

### 2.4 Item 4: Pure Pagination Reducer `validateAndReduceBatchPages`
- **Pure Checker Function (`AssistantBatchModels.kt`)**:
  `validateAndReduceBatchPages` evaluates accumulated `pages`:
  1. `expectedViewRevision.isNotBlank()` and strictly matches each `page.viewRevision`.
  2. Bounded max pages check (`pages.size <= maxPages`).
  3. Consistency of `version` and `analysisRevision` across every page.
  4. Total consistency: `page.total == declaredTotal` on every page.
  5. Duplicate cursor detection: `seenCursors.add(nextCursor)` ensures no loop.
  6. Abnormal empty page check: if `declaredTotal > 0 && page.items.isEmpty() && loadedRows.size < declaredTotal`, fails.
  7. Unique item IDs: `seenItemIds.add(item.itemId)` verifies no duplicates across pages.
  8. Cursor exhaustion check: `lastPage.nextCursor` must be null/blank; if non-empty, fails with unexhausted cursor error.
  9. Strict total matching: `seenItemIds.size == declaredTotal`.
- **Load Flow Integration (`AssistantBatchImportWorkspace.kt`)**:
  - `loadFullBatch` collects up to 5 pages and delegates verification to `validateAndReduceBatchPages`.
  - If validation fails, atomic commit is aborted (`allRows` and `batch` are not mutated).
  - Up to 2 bounded retries with 500ms delay.
  - On retry exhaustion, sets clear `errorMessage` without clearing user drafts (`selectedItemIds`, `userExcludedItemIds`, `noteOverrides`, `categoryAssignments`, `approvedCategories`).

### 2.5 Item 5: Strict Non-Empty `viewRevision` Across GET DTOs
- **Model Enforcements (`AssistantBatchModels.kt`)**:
  - `ImportBatch`: `viewRevision = root.optCleanString("viewRevision") ?: throw IllegalArgumentException("ImportBatch requires non-empty viewRevision")`
  - `ImportBatchRowsPage`: `viewRevision = obj.optCleanString("viewRevision") ?: throw IllegalArgumentException("ImportBatchRowsPage requires non-empty viewRevision")`
  - `ImportBatchCategoriesResponse`: `viewRevision = obj.optCleanString("viewRevision") ?: throw IllegalArgumentException("ImportBatchCategoriesResponse requires non-empty viewRevision")`
  - `ReviewResponse`: `viewRevision = obj.optCleanString("viewRevision") ?: throw IllegalArgumentException("ReviewResponse requires non-empty viewRevision")`
- **Workspace Fencing (`AssistantBatchImportWorkspace.kt`)**:
  - Removed `(b.viewRevision.isBlank() || catsResp.viewRevision.isBlank() || ...)` wildcard pattern.
  - Requires `b.viewRevision.isNotBlank() && catsResp.viewRevision.isNotBlank() && catsResp.viewRevision == b.viewRevision`.
  - Atomic commit assigns `viewRevision = b.viewRevision`.

---

## 3. Verification & Execution Evidence

### 3.1 Unit Test Execution (`./gradlew testDebugUnitTest --no-parallel`)
- **Execution Command**: `cd clients/android && ./gradlew testDebugUnitTest --no-parallel`
- **Outcome**: `BUILD SUCCESSFUL in 6s` (23 actionable tasks: 3 executed, 20 up-to-date)
- **Total Tests**: **153 passed**, 0 failed, 0 skipped across 12 test suites:
  - `AssistantBatchNetworkContractTest`: **17 tests**, 0 failures (added 4 comprehensive tests)
  - `AssistantBatchImportStateTest`: **45 tests**, 0 failures (added 11 comprehensive tests)
  - `AssistantConversationHelperTest`: 25 tests, 0 failures
  - `AssistantStreamReducerTest`: 13 tests, 0 failures
  - `SseParserTest`: 12 tests, 0 failures
  - `NetworkContractTest`: 10 tests, 0 failures
  - `AssistantImportStateTest`: 10 tests, 0 failures
  - `AssistantIdentityCoordinatorTest`: 6 tests, 0 failures
  - `AssistantDuplicateStateTest`: 5 tests, 0 failures
  - `ProviderSettingsHelperTest`: 5 tests, 0 failures
  - `InputContractTest`: 4 tests, 0 failures
  - `CancellableBlockingFlowTest`: 1 test, 0 failures

### 3.2 Lint Check (`./gradlew lintDebug --no-parallel`)
- **Execution Command**: `cd clients/android && ./gradlew lintDebug --no-parallel`
- **Outcome**: `BUILD SUCCESSFUL in 1m 2s` (27 actionable tasks: 8 executed, 19 up-to-date)
- **Result**:
  - **0 Errors**
  - **9 Warnings** (pre-existing in unrelated baseline files: 4 `ModifierParameter` in older composables, 2 `IconLauncherShape`, 1 `DataExtractionRules`, 1 `ObsoleteSdkInt`, 1 `UnusedResources`)
  - **21 Information** (`AutoboxingStateCreation`)
  - **Zero warnings or errors** in modified files (`AssistantBatchModels.kt`, `AssistantBatchImportWorkspace.kt`).

### 3.3 APK Assembly (`./gradlew assembleDebug --no-parallel`)
- **Execution Command**: `cd clients/android && ./gradlew assembleDebug --no-parallel`
- **Outcome**: `BUILD SUCCESSFUL in 21s` (37 actionable tasks: 4 executed, 33 up-to-date)
- **Artifact**:
  - File: `clients/android/app/build/outputs/apk/debug/app-debug.apk`
  - Size: **19,580,136 bytes** (18.67 MB)
  - SHA-256: `0c956aacb1eba013ac064090f407de3253f9b09a20517fcea3fe7ec4017d696e`

---

## 4. Summary of Files Changed
1. `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantBatchModels.kt`:
   - Exact `parseStrictLong` / `parseStrictInt` with `BigDecimal.longValueExact()` / `intValueExact()`.
   - `ImportBatch`, `ImportBatchRowsPage`, `ImportBatchCategoriesResponse`, `ReviewResponse` enforce non-empty `viewRevision`.
   - `ReviewSelectedRow` reads `categoryType` and `approvedNewCategoryName`.
   - Added `ReviewSummaryCounts` and wired into `ReviewSummary.counts`.
   - Added `BatchPagesValidationResult` and `validateAndReduceBatchPages` pure checker.
2. `clients/android/app/src/main/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantBatchImportWorkspace.kt`:
   - `loadFullBatch` uses `validateAndReduceBatchPages` for strict 500-bounded pagination integrity.
   - Removed `viewRevision` blank wildcard; requires strict equality with `b.viewRevision`.
   - Selected rows UI displays category type label and planned-new badge; preserves server empty note `""`.
   - Summary card displays independent typed counts; renders nullable `userExcluded` as `"未提供"` (not 0); preserves server amounts.
3. `clients/android/app/src/test/java/com/yansuu1/jizhang/net/AssistantBatchNetworkContractTest.kt`:
   - Boundary tests for exact Long/Int overflow, 2^63, Double overflow, NaN/Infinity, fraction, string.
   - Contract test for `ReviewSelectedRow` categoryType, approvedNewCategoryName, and empty note retention.
   - Contract test for `ReviewSummary.counts` typed fields and nullable userExcluded.
   - Strict `viewRevision` fail-close tests on all 4 DTOs.
4. `clients/android/app/src/test/java/com/yansuu1/jizhang/ui/feature/assistant/AssistantBatchImportStateTest.kt`:
   - 8 tests for `validateAndReduceBatchPages` covering 500 items complete, 450 items unexhausted cursor, duplicate cursor loop, empty abnormal page, page total mismatch, version/revision mismatch, duplicate item IDs.
   - 3 tests for UI projections and draft retention on failure.
5. `.trellis/tasks/10-17-ai-bill-import-improvements/research/android-final-boundary-fixes.md`:
   - Full technical audit documentation, test XML counts, lint breakdown, and APK verification hash.
