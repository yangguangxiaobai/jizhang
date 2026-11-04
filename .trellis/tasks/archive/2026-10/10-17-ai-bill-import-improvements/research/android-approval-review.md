# Android Approval & Eligibility Independent Review

Task: `.trellis/tasks/10-17-ai-bill-import-improvements`
Role: Independent Android Quality & Verification Reviewer (`clients/android/` only)
Date: 2026-10-17
Status: COMPLETE (All independent review findings remediated and verified locally)

---

## 1. Scope & Hard Boundaries
- **Exclusive focus**: Android native code and test verification in `clients/android/`, and documentation in `research/android-approval-review.md`.
- **Zero modification**: `packages/server/`, `packages/shared/`, `.trellis/spec/`, `README.md`, protocol definitions (`research/merged-import-protocol-v1.md`).
- **Zero execution**: No real provider calls, no device/emulator deployment, no model timeout or credential manipulation, no git stage/commit/reset.
- **Baseline preservation**: Existing uncommitted WIP baseline maintained without reset or staging.

---

## 2. Independent Audit & Remediations

### 2.1 Prohibition of Auto-Approval for Proposals (`loadFullBatch` Lifecycle)
- **Defect Identified**: In previous `android-independent-review.md` §2.7, an auto-approval routine was introduced in `loadFullBatch`:
  ```kotlin
  // Prior defective code in loadFullBatch:
  suggestions.forEach { sug ->
      if (sug.suggestionId !in nextApproved) {
          nextApproved[sug.suggestionId] = ApprovedCategory(...)
      }
  }
  ```
  This auto-approved every new proposal from both AI suggestions and server-fallback "Other" suggestions upon initial load or analysis completion/retry, completely bypassing user approval. This severely violated User Requirement R4, AC4, and the Frozen Protocol v1.
- **Remediation**:
  1. **Zero Auto-Approval**: Completely removed the auto-approval loop from `loadFullBatch`. All suggestions (AI proposals and fallback Other) are strictly **UNAPPROVED by default** on first load, re-analysis, and retry.
  2. **Revision Scoping & Anti-Rebinding**: In accordance with Normative Resolution 7 (`Suggestion IDs scoped to analysisRevision so stale approvals cannot rebind`), when `analysisRevision` changes, obsolete approvals are strictly pruned (`nextApproved = approvedCategories.filterKeys { it in currentSugIds }`) and never rebound to different proposals.
  3. **Stale Assignment Invalidation**: Assignments pointing to removed/obsolete suggestions (`CategoryAssignment.Suggestion(staleId)`) are purged from `categoryAssignments`.
  4. **Manual Draft Preservation**: User manual existing category selections (`CategoryAssignment.Existing`), user note overrides (`noteOverrides`), and user selected item IDs (`selectedItemIds` / `userExcludedItemIds`) are strictly preserved across re-analysis and data refreshes.
  5. **Review Validation Gate**: If any selected row is assigned to an unapproved suggestion, `validateBatchForReview` strictly halts review with:
     `"账单「${row.note}」使用的建议分类尚未批准，请在分类建议中批准或改为现有分类"`

### 2.2 Proposal Presentation & Explicit User Approval UI
- **Real UI Fields**: In `AssistantBatchImportWorkspace.kt`, each suggestion card explicitly renders:
  - Proposal Name: `「${sug.name}」`
  - Category Type: `(支出)` or `(收入)`
  - Associated Row Counts: `关联 ${sug.relatedItemCount} 笔流水 (已选入 $selectedUsingCount 笔) · 来源: ${if (sug.origin == "ai") "AI分析" else "其他兜底"}`
  - Reuse Hint: When a matching bookable leaf category exists, renders `可复用现有分类: 「${candidate.name}」`
- **Approval Entry Points**:
  - **Unapproved State**: Displays `状态: 未批准（入账不会创建）` in danger color. Provides explicit action buttons:
    - `"复用"`: If a matching leaf candidate exists, approves as reuse targeting `bestCandidate.categoryId`.
    - `"新建"`: Approves as a brand new category creation (`reuseCategoryId = null`).
  - **Approved State**: Displays `状态: 已批准（新建为「...」）` or `状态: 已批准（复用现有类「...」）` in accent color, and provides an explicit `"撤回"` button to revert the approval back to unapproved.
- **Unused & Cancellation Safeguards**: As mandated by AC4 and Normative Resolution 10, suggestions that are approved but not referenced by any selected row (`categoriesSkippedUnused`) or in batches that are cancelled or encounter failure do not create categories.

### 2.3 Category Reuse Wire Semantics & Server Compatibility
- **Server Wire Constraint**: In `packages/server/src/routes/import-batches.ts:115`, the server route parser enforces:
  `if (object['resolution'] !== undefined && object['resolution'] !== 'create') throw new ImportBatchInvalidError('approvedCategories[].resolution 仅支持 create。');`
  Any payload passing `"resolution": "reuse"` triggers an immediate 400 rejection.
- **Why the Server Requires This**:
  In the server domain model, `approvedCategories` represents the collection of approved *proposals*. The server determines whether the proposal creates a category or reuses an existing category via `reuseCategoryId: string | null`.
  - When `reuseCategoryId !== null`: The server executes `categoriesReused += 1; resolvedId = candidate.id;` and does **NOT** insert into the `categories` table.
  - When `reuseCategoryId === null`: The server creates a new category (unless an identical live category uniquely matches).
- **Client Guarantee**: In `ApprovedCategory.toJson()`, the wire field is set to `"resolution": "create"`, while `reuseCategoryId` specifies the target existing category. When approving as reuse, the Android client sets `name = bestCandidate.name`, `type = bestCandidate.type`, and `parentId = bestCandidate.parentId` matching the candidate. This guarantees that `name`, `type`, and `parent` agree with the candidate, preventing server rejection (`ImportBatchCategoryConflictError: 指定的复用分类不可用或名称不一致`) and ensuring that label-reuse does not inadvertently create a duplicate category.
- **Cross-Layer Note to Parent**: The wire protocol requires `resolution = "create"` even for reuse entries. This is documented here and handed off to parent for protocol documentation alignment.

### 2.4 Positive Rule-Ignored Eligibility & Server Protocol Conflict
- **Frozen Protocol & PRD Standard**:
  Under Frozen Protocol v1 (resolutions 3 & 10) and PRD R2/AC2, **ONLY three conditions are hard locks**:
  1. `existing == true` (already booked in ledger)
  2. `amountCents <= 0` (nonpositive / invalid amount)
  3. `conflictKind == "ledger_collision"` (order hash collision / ledger truncation)
  Positive transactions (`amountCents > 0`, `!existing`, no collision) with rule-ignore reasons (e.g., "中性交易", "分类:X", "理财赎回") **must remain eligible** for explicit user selection (`isEligible = true`).
- **Client Remediation**:
  In `AssistantBatchModels.kt`, removed `ignoreReason == "状态非成功" || ignoreReason?.startsWith("状态:") == true` from `isHardBlocked`:
  ```kotlin
  val isHardBlocked: Boolean
      get() = amountCents <= 0 || conflictKind == "ledger_collision"

  val isEligible: Boolean
      get() = !existing && amountCents > 0 && conflictKind != "ledger_collision"
  ```
  The Android client no longer hard-locks positive rows on client-side status strings.
- **Server Protocol Discrepancy & Hand-Off to Parent**:
  In `packages/server/src/services/import-batch-service.ts:2217`, the server review validation checks:
  ```typescript
  if (item.existing || ledgerStatusOf(item.ignoreReason) === 'blocked') {
    throw new ImportBatchInvalidError(`账单 ${itemId} 被规则阻止（${item.ignoreReason ?? '未知原因'}），不能导入。`);
  }
  ```
  where `ledgerStatusOf` (`packages/server/src/services/import-batch-identity.ts:84`) defines:
  ```typescript
  export function ledgerStatusOf(ignoreReason: string | null): 'ok' | 'blocked' {
    if (ignoreReason === null) return 'ok';
    if (ignoreReason === '金额无效' || ignoreReason === '状态非成功' || ignoreReason.startsWith('状态:')) {
      return 'blocked';
    }
    return 'ok';
  }
  ```
  **Conflict Analysis**: The server unilaterally rejects any row where `ignoreReason === '状态非成功'` or `ignoreReason.startsWith('状态:')` upon `POST .../review`, even if `amountCents > 0` and the transaction is a valid positive record that the user chose to import. The client adheres strictly to the frozen protocol and does not add client-side hard locks to mask this server-side behavior. This discrepancy is reported to parent for server-layer resolution.

---

## 3. Verification & Evidence

### 3.1 Test Suite Accounting & Exact Counts
Actual test XML results under `clients/android/app/build/test-results/testDebugUnitTest/`:

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

- **Merged Import Suites (2 suites, 35 tests)**:
  - `TEST-com.yansuu1.jizhang.net.AssistantBatchNetworkContractTest.xml`: 6
  - `TEST-com.yansuu1.jizhang.ui.feature.assistant.AssistantBatchImportStateTest.xml`: **29 tests** (4 new regression tests added:
    1. `positiveRowWithStatusIgnoreReasonIsEligibleUnderFrozenProtocol`: verifies positive rows with status ignore reasons are eligible and not hard-locked.
    2. `newSuggestionsDefaultToUnapprovedOnLoadAndRetry`: proves proposals (AI & fallback) are unapproved by default and unapproved suggestions block review.
    3. `reanalysisPrunesObsoleteApprovalsAndPreservesUserManualDraftsWithoutRebinding`: proves re-analysis prunes stale approvals, clears stale suggestion assignments, does not auto-approve new proposals, and strictly preserves manual existing category assignments, notes, and selections.
    4. `explicitUserApprovalWithReuseSpecifiesTargetCategoryIdAndMatchesMetadata`: proves explicit reuse approval sets target category ID and metadata correctly.
  - *Subtotal merged import*: **35 tests**

- **Total**: **126 tests passed (0 failures, 0 errors, 0 skipped)**.

### 3.2 Build Verification & Artifact Evidence
1. **Unit Tests**:
   ```bash
   cd clients/android && ./gradlew testDebugUnitTest --no-parallel
   ```
   - **Exit code**: `0`
   - **Result**: `BUILD SUCCESSFUL`, 126/126 passed in 1m 18s.
2. **Lint**:
   ```bash
   cd clients/android && ./gradlew lintDebug --no-parallel
   ```
   - **Exit code**: `0`
   - **Result**: `BUILD SUCCESSFUL`, 0 errors, 0 warnings in 1m 52s.
3. **Assemble Debug**:
   ```bash
   cd clients/android && ./gradlew assembleDebug --no-parallel
   ```
   - **Exit code**: `0`
   - **Artifact**: `clients/android/app/build/outputs/apk/debug/app-debug.apk`
   - **Size**: 19,580,133 bytes
   - **SHA-256**: `9E15B69F9FF4A9967BF2045FA4D99D56C91AD9A24E97BFCB40CE29A17ECE6C5F`

---

## 4. Unresolved Requirements & Blockers
- **Physical Device & Real Provider Verification**: Not performed (synthetic test fixtures used; real device/live provider execution not authorized).
- **Server Status Block Discrepancy**: The server's `ledgerStatusOf` checking `状态非成功` / `状态:` during review validation deviates from the frozen protocol's 3-lock definition. Android client adheres strictly to frozen protocol and hands off this cross-layer finding to parent.
