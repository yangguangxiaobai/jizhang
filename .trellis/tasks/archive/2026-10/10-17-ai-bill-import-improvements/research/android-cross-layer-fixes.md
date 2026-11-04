# Android Cross-Layer Quality & Robustness Remediations

Task: `.trellis/tasks/10-17-ai-bill-import-improvements`
Role: Independent Android Quality & Verification Engineer (`clients/android/` only)
Date: 2026-10-17
Status: COMPLETE (All independent worker review findings remediated, audited, and verified locally)

---

## 1. Scope & Hard Boundaries
- **Exclusive focus**: Android native code and unit test verification under `clients/android/`, documented in `research/android-cross-layer-fixes.md`.
- **Zero modification**: `packages/server/`, `packages/shared/`, `.trellis/spec/`, `README.md`, task protocols, device/emulator deployment, live provider credentials, model configurations, git operations.
- **Baseline preservation**: Existing uncommitted git working copy preserved without reset, staging, or disruption.

---

## 2. Technical Breakdown & Detailed Fixes

### 2.1 Item 1: `weak_collision` Hard Locking & Positive Ignored Retention
- **Root Cause & Server Alignment**:
  In `packages/server/src/services/import-batch-service.ts:2277`, the server review validation explicitly checks:
  ```typescript
  if (group.startsWith('wc:') || kind === 'weak_collision') {
    throw new ImportBatchInvalidError(`账单 ${itemId} 存在批次内弱冲突，不能导入。`);
  }
  ```
  The server strictly rejects any selected row with `weak_collision`. The client previously allowed selecting up to 1 row per weak duplicate group.
- **Remediation**:
  1. In `AssistantBatchModels.kt`:
     ```kotlin
     val isHardBlocked: Boolean
         get() = amountCents <= 0 || conflictKind == "ledger_collision" || conflictKind == "weak_collision"

     val isEligible: Boolean
         get() = !existing && amountCents > 0 && conflictKind != "ledger_collision" && conflictKind != "weak_collision"
     ```
  2. In `AssistantImportState.kt`:
     - `getBatchRowLockReason(row)`: returns `"批次内弱冲突，无法选入"` for `conflictKind == "weak_collision"`.
     - `getBatchRowStatusText(row)`: displays `"弱冲突碰撞"`.
     - `validateBatchForReview`: hard-locks and rejects any selected row with `weak_collision`:
       `"账单「${weakCollisionRow.note}」存在批次内弱冲突，不可选入"`
  3. Positive rows with status or rule ignore reasons (`amountCents > 0`, `!existing`, no collision) remain strictly eligible (`isEligible = true`) and are not hard-locked by status strings on the client.

### 2.2 Item 2: `loadFullBatch` Atomic Commit, Revision Fencing & Polling Gate Ticket
- **Snapshot Fencing**:
  `loadFullBatch` previously mutated state variables incrementally and did not verify revision consistency across multi-page HTTP responses.
  - Now, `loadFullBatch` loads batch `b`, `catsResp = getBatchCategories(..., b.version)`, and all row pages `pageResp` (bounded <= 500 rows).
  - Validates that `version`, `analysisRevision`, and `viewRevision` are strictly consistent across batch, categories, and all pages:
    - `catsResp.version == b.version && catsResp.analysisRevision == b.analysis.analysisRevision`
    - `pageResp.version == b.version && pageResp.analysisRevision == b.analysis.analysisRevision`
    - `viewRevision` matching across snapshots.
  - If any revision change occurs mid-load, the entire in-flight snapshot is dropped and retried with a bounded limit (`attempt <= 2`) to prevent busy infinite reload loops.
  - **Atomic Commit**: Only when all pages and categories succeed and verify consistent, the state is committed simultaneously (`batch = b`, `viewRevision = ...`, `activeLeaves = ...`, `suggestions = ...`, `allRows = loadedRows`).
  - **Draft Preservation**: User manual drafts (`selectedItemIds`, `userExcludedItemIds`, `categoryAssignments`, `noteOverrides`) are preserved across refreshes; only stale suggestions removed from server are pruned from approvals and suggestion assignments without auto-rebinding.
- **Analysis Polling & 401 Gate Scoping**:
  - `LaunchedEffect` is keyed by `(conversationId, batchId, batch?.analysis?.state, batch?.analysis?.analysisRevision)`.
  - Polling loop begins with ticket: `val pollTicket = gate.begin("poll-analysis", "$conversationId|$batchId|${currentAnalysis.analysisRevision}")`.
  - Every `delay` and HTTP call checks `gate.accepts(pollTicket, scopeKey)` before and after awaiting.
  - `CancellationException` is rethrown to ensure coroutine cancellation cancels only client-side polling and never cancels server-side operations.
  - `AuthExpiredException` is caught in polling, `replaceBatchFile`, and `removeBatchFile`, invoking `onAuthExpired()` ONLY if `gate.accepts(ticket, scope)` is valid, strictly preventing stale 401 responses from triggering unwanted navigation.

### 2.3 Item 3: Strict Numeric Readers & Wire Format Fail-Close
- **Strict Readers Implementation** (`AssistantBatchModels.kt`):
  - `requireLongFact` / `optLongFact` / `requireIntFact` / `optIntFact` / `optNullableIntFact`:
    - Refuse string numbers (`raw is String` throws `IllegalArgumentException` rather than converting).
    - Refuse fractional numbers (`d % 1.0 != 0.0` throws `IllegalArgumentException` rather than truncating).
    - Refuse non-finite numbers (`Double.NaN`, `Double.isInfinite()` throws `IllegalArgumentException`).
    - Enforce bounds checking (`Int.MIN_VALUE..Int.MAX_VALUE`, `Long.MIN_VALUE..Long.MAX_VALUE`).
    - Required core facts (`requireLongFact`, `requireIntFact`) throw if missing or null, rather than silently defaulting to 0.
- **Nullable Wire Fields Preserved**:
  - `ImportRowAi.include`: typed as `Boolean?`. A wire payload of `"include": null` or missing key preserves `null`, avoiding the erasure of the server's "no recommendation" state into an explicit exclusion (`false`).
  - In `ImportBatchFile`, `rawRowCount` and `collectedRowCount` are typed as `Int?` and preserve `null` on failed parses without defaulting to 0.
  - Core ID & status fail-close:
    - `ImportBatchRow.itemId` required non-empty.
    - `ImportBatchRow.type` must be `0` or `1`, else throws `IllegalArgumentException`.
    - `ImportBatchFile.parseStatus` fails close to `"failed"` if unexpected.
- **Production Reader Malformed Wire Tests**:
  - Added direct unit tests calling `ImportBatchRow.fromJson`, `ImportBatchRowsPage.fromJson`, `ReviewResponse.fromJson`, and `ImportBatchFile.fromJson` with malformed wire fixtures (fractions, strings, NaN, missing IDs).

### 2.4 Item 4: Suggestion Approval, Multiple Candidates Dialog & Proposal Renaming
- **Prohibition of Auto-Approval**:
  Proposals (both AI and fallback) remain strictly UNAPPROVED by default on first load and analysis completion.
- **Multiple Leaf Candidates Resolution**:
  - When `sug.candidates` has multiple leaf candidates, the client NEVER executes `firstOrNull` auto-selection.
  - UI renders `"匹配到 N 个同名/同类型候选分类，需明确选择"` and provides an explicit `"选择复用候选..."` button that launches `CandidateSelectionDialog`.
  - The dialog lists each candidate with its name, type, and parent category description. Tapping a candidate explicitly binds its `categoryId`, `name`, `type`, and `parentId`.
  - When exactly 1 leaf candidate exists, an explicit button `"复用「${cand.name}」"` is shown for user confirmation.
- **Proposal Renaming**:
  - An explicit `"改名新建"` action opens `RenameProposalDialog`.
  - Allows editing the proposed category name while locking `type` and `parentId` to the suggestion (preventing crossing expense/income types or invalid parent structures).
  - Creates `ApprovedCategory` with the custom name and `reuseCategoryId = null`.
- **Retraction & Unused Proposal Handling**:
  - Approved suggestions provide an explicit `"撤回"` button to revert back to unapproved.
  - In accordance with server protocol, approved proposals not referenced by any selected row (`categoriesSkippedUnused`) do not create categories upon confirmation.

### 2.5 Item 5: Authoritative Review Sheet & Unbounded Scroll Crash Elimination
- **Crash Prevention**:
  Eliminated the nested vertical scroll structure (`Column(verticalScroll)` containing nested list) which causes `IllegalStateException: Vertically scrollable component was measured with an infinity maximum height constraints` in Compose.
  - The entire `ModalBottomSheet` content is rendered within a single bounded `LazyColumn` (`fillMaxHeight(0.88f)`).
  - Handles up to 500 selected rows smoothly via lazy item recycling without initial bulk measurement overhead.
- **Authoritative Financial Facts**:
  All financial totals (`selected`, `amountCents`, `expenseCents`, `incomeCents`, `refundIncomeCents`, `excluded`, `existing`, `conflicts`) are read directly from the server's `summary` DTO and formatted, never recalculated client-side.
- **Comprehensive Summary Presentation**:
  1. **Financial Overview Card**: Selected count, gross expense, gross income, refund income, total amount, excluded/existing counts.
  2. **Source Files Breakdown**: Detailed breakdown iterating `sum.files` with file name and selected row count.
  3. **Category Plans Breakdown**:
     - `sum.categoriesToCreate`: proposed category name, type (`支出`/`收入`), and associated selected row count.
     - `sum.categoriesToReuse`: target category name and associated selected row count.
  4. **Selected Rows List** (`sum.selectedRows`):
     - Scrollable list iterating each row with date (`dateLabel`), direction tag (`支出`/`收入`), amount (`¥x.xx`), resolved category name (`categoryName` or resolved from `categoryId`/`suggestionId`), and note.
     - Empty notes are explicitly rendered as `备注: (空备注)` rather than omitted.
     - DTO compatibility: `ReviewSelectedRow` supports `categoryName`, `resolvedNote`, and `dateLabel` from current and pending server patches, with seamless fallback joining loaded batch rows and local note overrides.

---

## 3. Verification & Evidence

### 3.1 Test Suite Accounting & Exact Breakdown
Unit tests executed via Gradle:
```bash
cd clients/android && ./gradlew testDebugUnitTest --no-parallel
```

- **Baseline Suites (10 suites, 91 tests - unchanged baseline)**:
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
  - *Baseline Subtotal*: **91 tests**

- **Merged Import Suites (2 suites, 47 tests)**:
  - `TEST-com.yansuu1.jizhang.net.AssistantBatchNetworkContractTest.xml`: **13 tests** (+7 new tests):
    1. `categoryAssignmentJsonSerializationAndDeserialization`
    2. `approvedCategoryJsonSerializationAndDeserialization`
    3. `conflictDecisionSerializationSupportsChosenAndExcludeAll`
    4. `reviewPayloadMatchesProtocolFixtures`
    5. `reviewResponseParserReadsStrictSummary`
    6. `confirmResponseParserReadsAuthoritativeResult`
    7. `strictNumericReadersRejectFractionalAmountCentsOnProductionRowReader`
    8. `strictNumericReadersRejectStringWrongTypeOnProductionRowReader`
    9. `strictNumericReadersRejectFractionalVersionOnProductionPageAndReviewReader`
    10. `strictReadersFailCloseOnMissingCoreIdOrUnknownStatus`
    11. `nullableAiIncludePreservesNullAndDistinguishesFromFalseOnWire`
    12. `full500RowsReviewSummaryDecodesServerAuthoritativeSummaryAndSelectedRows`
    13. `crossLayerCompleteBatchFixtureRoundtrip`
  - `TEST-com.yansuu1.jizhang.ui.feature.assistant.AssistantBatchImportStateTest.xml`: **34 tests** (+5 new tests):
    - All 29 previous regression tests (boundary 0/1/100/101/200/201/500/501 selections, fact conflict single selection, SAF document validation, stale proposal clearing, note clearing, etc.)
    - +5 new tests:
      30. `weakCollisionIsHardLockedAndRejectsSelectionWhilePositiveIgnoredRemainsEligible`
      31. `ambiguousMultipleCandidatesRequireExplicitSelectionAndBindTargetMetadata`
      32. `defaultSelectionDistinguishesNullableAiInclude`
      33. `loadedMixedSnapStateConsistencyDetectionRejectsMismatchedRevisions`
      34. `pollingGateTicketRejectsLateOrCrossScopeResponses`
  - *Merged Import Subtotal*: **47 tests**

- **Grand Total**: **138 tests passed (0 failures, 0 errors, 0 skipped)**.

### 3.2 Lint Verification
```bash
cd clients/android && ./gradlew lintDebug --no-parallel
```
- **Result**: `BUILD SUCCESSFUL` (0 errors, 0 warnings).

### 3.3 Build & Artifact Evidence
```bash
cd clients/android && ./gradlew assembleDebug --no-parallel
```
- **Result**: `BUILD SUCCESSFUL`
- **Output Artifact**: `clients/android/app/build/outputs/apk/debug/app-debug.apk`
- **Size**: 19,580,141 bytes
- **SHA-256**: `09dc8aa02b9a8aaf7bbb490122fe7afdc6e2ea0233553d11618eb8927ddb85aa`

---

## 4. Unresolved Requirements & Known Limitations
- **Device & Live Provider Boundary**: Tested against unit and contract test suites with production parsers and synthetic fixtures; no physical Android device/emulator and no live external LLM provider calls were executed in this sandbox environment.
- **Server `ledgerStatusOf` Review Validation**: The server-side check rejecting `状态非成功` upon review validation remains under the jurisdiction of the backend implementation. Android client adheres strictly to the frozen protocol 3-lock standard and maintains compatibility.
