# Android Independent Quality & DTO Readback Review

Task: `.trellis/tasks/10-17-ai-bill-import-improvements`
Role: Independent Android Quality & Verification Reviewer (`clients/android/` only)
Date: 2026-10-17
Status: COMPLETE (All independent findings remediated and verified locally)

---

## 1. Scope & Hard Boundaries
- **Exclusive focus**: Android native code and test verification in `clients/android/`.
- **Zero modification**: `packages/server/`, `packages/shared/`, `.trellis/spec/`, `README.md`, protocol definitions (`research/merged-import-protocol-v1.md`).
- **Zero execution**: No real provider calls, no device/emulator deployment, no model timeout or credential manipulation, no git stage/commit/reset.
- **Baseline preservation**: Existing uncommitted WIP baseline maintained without reset or staging.

---

## 2. Independent Findings & Remediations

Unlike the previous implementation status report which claimed full closure, this independent cross-layer DTO readback identified and remediated the following critical issues:

### 2.1 Server DTO Real-Field Deserialization & `viewRevision` Stale Loops
- **Issue**: `ImportBatch`, `ImportBatchRowsPage`, and `ImportBatchCategoriesResponse` lacked `viewRevision: String` fields. In `AssistantBatchImportWorkspace.kt`, the client synthesized a fake string (`"v${b.version}-r${b.analysis.analysisRevision}-${pageResp.readAt}"`), which server route strictly rejected on `POST .../review` with 409 `ImportBatchStaleVersionError` (`batch.view_revision !== input.viewRevision`).
- **Fix**: Added `viewRevision: String` to `ImportBatch`, `ImportBatchRowsPage`, `ImportBatchCategoriesResponse`, and `ReviewResponse`. Updated workspace to capture and propagate the authoritative server `viewRevision`.

### 2.2 `ReviewResponse` & `ReviewSummary` Structured Wire Shape
- **Issue**: The previous `ReviewSummary` deserialized `categoriesToCreate` and `categoriesToReuse` as single integers via `optIntFact`, but the server returns array payloads:
  - `categoriesToCreate`: `[{ name, type, selectedRows }]`
  - `categoriesToReuse`: `[{ categoryId, name, selectedRows }]`
  - `selectedRows`: `[{ itemId, type, amountCents, categoryId, suggestionId, note }]`
  - `files`: `[{ fileName, selectedRows }]`
  - `excluded`, `existing`, `conflicts`
  This caused `categoriesToCreate` and `categoriesToReuse` to always deserialize as `0`.
- **Fix**: Implemented typed DTOs `ReviewCategoryPlan`, `ReviewReusePlan`, `ReviewSelectedRow`, `ReviewFilePlan`, and mapped all fields into `ReviewSummary`, while exposing backward-compatible `.categoriesToCreateCount` and `.categoriesToReuseCount` accessors.

### 2.3 Duplicate Comparison Endpoint Typed DTO
- **Issue**: `AssistantRepository.batchRowDuplicateCandidates` returned raw `JSONObject`, and `AssistantBatchImportWorkspace` invoked legacy `decodeAssistantDuplicatePage(json)`. The new batch duplicate endpoint returns `{ source: { itemId }, total, items, nextCursor, readAt, rationale }`, whereas `decodeAssistantDuplicatePage` mandated `{ source: { id, accountName, ... } }`, causing an immediate `JSONException` crash on opening comparison.
- **Fix**: Introduced `BatchRowDuplicatePage` and `BatchRowDuplicateItem` typed DTOs. Updated repository method and workspace comparison subscreen to consume `BatchRowDuplicatePage` safely without crashing.

### 2.4 Approved Category Wire Resolution Constraint
- **Issue**: In `packages/server/src/routes/import-batches.ts:98`, the server enforces:
  `if (object['resolution'] !== undefined && object['resolution'] !== 'create') throw new ImportBatchInvalidError('approvedCategories[].resolution 仅支持 create。');`
  The Android client serialized `"resolution": "reuse"` whenever reusing a candidate, resulting in immediate 400 rejection.
- **Fix**: In `ApprovedCategory.toJson()`, enforced `resolution = "create"` on the wire while utilizing `reuseCategoryId` to specify the reuse target.

### 2.5 Review Explicit Category Assignment Requirement
- **Issue**: Normative protocol v1 resolution 7 mandates:
  `categoryAssignments[itemId]={kind:'existing',categoryId}|{kind:'suggestion',suggestionId}, explicit assignment per selected row required.`
  The Android client only transmitted items modified in `categoryAssignments`, omitting unmodified selected rows and relying on server-side fallback (which could silently default to "Other" or throw 400).
- **Fix**: In `AssistantBatchImportWorkspace`, built an explicit `fullAssignments` map containing a resolved assignment (`CategoryAssignment.Existing` or `CategoryAssignment.Suggestion`) for every selected row before invoking `repo.reviewImportBatch`.

### 2.6 Rule-Ignored vs Hard Block vs User Excluded
- **Issue**: The previous logic only considered `existing`, `amountCents <= 0`, and `conflictKind == "ledger_collision"` as non-eligible. Rows marked by server as `ignoreReason == "状态非成功"` or `ignoreReason.startsWith("状态:")` were treated as eligible, allowing selection and subsequently triggering server 400 rejection.
- **Fix**: Added `ImportBatchRow.isHardBlocked` (`amountCents <= 0 || ignoreReason == "金额无效" || ignoreReason == "状态非成功" || ignoreReason?.startsWith("状态:") == true`). Soft rule-ignored rows (such as neutral transactions) remain eligible for explicit user selection, while hard-blocked rows are locked with clear failure reasons.

### 2.7 Multi-Analysis Proposal Lifecycle & Draft Preservation
- **Issue**: When analysis finished or re-ran, suggestions from previous revisions became invalid on server, but stale approvals remained in `approvedCategories` and blocked subsequent review.
- **Fix**: In `loadFullBatch`, pruned `approvedCategories` to only keep suggestions present in the active `suggestions` list, auto-approved new proposals, and cleaned up assignments pointing to obsolete suggestions, while strictly preserving manual user drafts (`noteOverrides`, manual selections, and manual category overrides).

### 2.8 Nullable File Row Counts on Parser Failures
- **Issue**: Normative protocol requires `rawRowCount` and `collectedRowCount` to be `null` on parser failure (not `0`). Previous code parsed with `optIntFact` defaulting to `0`.
- **Fix**: Added `optNullableIntFact` helper; `rawRowCount` and `collectedRowCount` are now `Int?`.

### 2.9 Auth Expiration & Session Gate Handling
- **Issue**: In `confirmImportBatch`, `cancelImportBatch`, and `analyseImportBatch`, exceptions were caught broadly without invoking `onAuthExpired()` on 401.
- **Fix**: Added explicit `catch (e: AuthExpiredException) { onAuthExpired() }` across all workspace mutation flows.

---

## 3. Verification & Evidence

### 3.1 Test Suite Accounting & Exact Counts
- **Correction to Previous Report**: The previous report claimed "87 baseline + 35 new = 122". The exact, accurate breakdown verified against actual test XML results is:
  - **Baseline Suites (10 suites, 91 tests)**:
    - `TEST-com.yansuu1.jizhang.net.CancellableBlockingFlowTest.xml`: 1
    - `TEST-com.yansuu1.jizhang.net.NetworkContractTest.xml`: 10
    - `TEST-com.yansuu1.jizhang.net.SseParserTest.xml`: 12
    - `TEST-com.yansuu1.jizhang.ui.InputContractTest.xml`: 4
    - `TEST-com.yansuu1.jizhang.ui.ProviderSettingsHelperTest.xml`: 5
    - `TEST-com.yansuu1.jizhang.ui.feature.assistant.AssistantConversationHelperTest.xml`: 25
    - `TEST-com.yansuu1.jizhang.ui.feature.assistant.AssistantDuplicateStateTest.xml`: 5
    - `TEST-com.yansuu1.jizhang.ui.feature.assistant.AssistantIdentityCoordinatorTest.xml`: 6
    - `TEST-com.yansuu1.jizhang.ui.feature.assistant.AssistantImportStateTest.xml`: 10
    - `TEST-com.yansuu1.jizhang.ui.feature.assistant.AssistantStreamReducerTest.xml`: 13
    - *Subtotal baseline*: **91 tests**
  - **New Merged Import Suites (2 suites, 31 tests)**:
    - `TEST-com.yansuu1.jizhang.net.AssistantBatchNetworkContractTest.xml`: 6
    - `TEST-com.yansuu1.jizhang.ui.feature.assistant.AssistantBatchImportStateTest.xml`: 25
    - *Subtotal new*: **31 tests**
  - **Total**: **122 tests passed (0 failures, 0 errors, 0 skipped)**.

### 3.2 Command Execution & Build Artifacts
1. **Unit Tests**:
   ```bash
   cd clients/android && ./gradlew testDebugUnitTest --no-parallel
   ```
   - **Exit code**: `0`
   - **Result**: `BUILD SUCCESSFUL`, 122/122 tests passed.
2. **Lint**:
   ```bash
   cd clients/android && ./gradlew lintDebug --no-parallel
   ```
   - **Exit code**: `0`
   - **Result**: `BUILD SUCCESSFUL`, 0 errors.
3. **Assemble Debug**:
   ```bash
   cd clients/android && ./gradlew assembleDebug --no-parallel
   ```
   - **Exit code**: `0`
   - **Artifact**: `clients/android/app/build/outputs/apk/debug/app-debug.apk`
   - **Size**: 19,580,133 bytes
   - **SHA-256**: `6d324f9e27542d6abcb5df290512525e355296890df79b0c5a9d2676be400089`

---

## 4. Unresolved Requirements & Blockers
- **Device & Live Provider Verification**: Physical/emulator UI interaction and live AI provider calls are not run within this review pass (synthetic test fixtures and local contract assertions used).
- **Server Boundaries**: Server wire contract and database migrations were read-only and verified via mock/synthetic tests without server code edits.
