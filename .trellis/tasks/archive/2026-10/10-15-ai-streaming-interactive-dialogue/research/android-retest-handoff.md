# Android Retest Handoff & Verification

Status: COMPLETE

## 1. Executive Summary & Verification State
- **Execution Mode**: Read-only inspection of Android implementation + local Gradle validation (`testDebugUnitTest lintDebug assembleDebug --no-parallel`).
- **Device & Environment Invariants**:
  - ZERO device operations conducted (`phone-verifier` remains sole device operator).
  - ZERO model provider requests initiated; no timeouts, credentials, dependencies, migrations, or database configurations altered.
  - ZERO git stage or commit operations.
  - No product/test/README/spec files touched; work restricted strictly to this document and `artifacts/android-retest-*.log`.
- **Target APK Verification**:
  - File: `clients/android/app/build/outputs/apk/debug/app-debug.apk`
  - SHA-256: `d2a37b550fb110e9b6174ec2fe874b681f924423e08c7c5be465749e3bb56da8`
  - Confirms exact byte identity with previously unhanded-off APK `d2a37b55`.

---

## 2. Actual Android Changes vs. Obsolete Diagnostic Speculations

### A. Obsolete Diagnostic Guesses in `device-retest-diagnosis.md`
1. **`409 ASSISTANT_CHOICE_STALE` Root Cause Misdiagnosis**:
   - *Diagnostic speculation*: Section 2 (根因 3) speculated that the `409 ASSISTANT_CHOICE_STALE` on free-text was caused by Android improperly packaging ordinary input as `ChoiceText` instead of `Text`, or by state locks reusing old generation IDs.
   - *Actual Root Cause & Reality*: As proven in `research/chained-choice-fix.md` and already deployed live in production (`deploy-status.md` Patch #2, image `jizhang:api-chained-choice-20261016T083118Z`), the bug was entirely **server-side**. In `create()`, `INSERT INTO assistant_generations` bound the consumed choice's `source.answered_at` into the *new* generation's own `answered_at` column. Consequently, every second hop generation was born already-answered (`answered_at !== null`), causing server `resolveInput()` to reject any subsequent choice or free-text submission with `409 ASSISTANT_CHOICE_STALE`.
   - *Conclusion*: Changing the Android composer to `GenerationInput.Text` conforms to `protocol-v1.md` §Clarification (free text superseding questions), but it was **not** the root cause fix for `409 ASSISTANT_CHOICE_STALE` in chained clarifications. The true fix was the server-side own-answered column `NULL` insertion, which is already fixed and deployed online.

---

## 3. Four Core Architectural & Interaction Verifications

### 1. Placeholder & Stop Availability During Zero-Delta (TTFT Phase)
- **Problem Solved**: Eliminated the 1–3s initial blank screen and missing Stop button (Screen-03/04) while awaiting the upstream LLM's first token.
- **Code Audit**:
  - In `AssistantConversationHelper.kt` (`buildAssistantMergedItems`):
    ```kotlin
    val effectiveProvisionals = if (sortedProvisionals.isEmpty() &&
        (activeGen.status in listOf("accepted", "running") ||
            activeGen.visualState in listOf(StreamVisualState.CONNECTING, StreamVisualState.RECEIVING))
    ) {
        listOf(StreamProvisionalMessage("provisional_${activeGen.generationId}", 0, "", false))
    } else {
        sortedProvisionals
    }
    for (prov in effectiveProvisionals) {
        if (prov.messageId !in renderedMessageIds) {
            items.add(AssistantMergedItem.ProvisionalBubble(prov.messageId, prov.text))
        }
    }
    ```
  - In `AssistantStreamingComponents.kt`:
    `StreamingGrowingBubble` defaults `text.ifBlank { "正在生成回答…" }`, renders the active `LinearProgressIndicator`, and mounts the >=48dp `OutlinedButton` ("停止生成", `onStop`).
  - In `AssistantTab.kt`:
    - Merged item `ProvisionalBubble` triggers `stopGeneration(id, gen)`.
    - The bottom composer status row also renders a secondary `TextButton("停止生成")` during `CONNECTING`/`RECEIVING`.
- **Unit Test Coverage**: `AssistantConversationHelperTest.kt` passes `buildAssistantMergedItemsProducesProvisionalBubbleEvenWhenProvisionalsEmptyDuringConnectingOrReceiving()`.

### 2. Send Auto-Scroll vs. Preserving User Upward Scroll
- **Problem Solved**: Automatically scrolls to bottom when the user initiates a send or when streaming extends at the bottom, while respecting the user's manual scroll position if they scrolled up to read earlier messages.
- **Code Audit**:
  - In `AssistantTab.kt` (`startStreamingGeneration`):
    ```kotlin
    val countAfterCreate = buildAssistantMergedItems(messages, currentState).size
    if (countAfterCreate > 0 && conversationId == targetConvId) {
        withFrameNanos {}
        listState.scrollToItem(countAfterCreate - 1)
    }
    ```
    Upon sending, viewport immediately targets the newly appended message and placeholder.
  - In `subscribeToGenerationEventsImpl`:
    ```kotlin
    val countBefore = buildAssistantMergedItems(messages, currentState).size
    val wasAtBottom = conversationId == targetConvId && isAtBottom(listState, countBefore)
    ...
    val countAfter = buildAssistantMergedItems(messages, currentState).size
    if (wasAtBottom && countAfter > 0 && conversationId == targetConvId) {
        withFrameNanos {}
        listState.scrollToItem(countAfter - 1)
    } else if (!wasAtBottom) {
        if (event is AssistantGenerationEvent.TextDelta || countAfter > countBefore) {
            newMessagesAvailable = true
        }
    }
    ```
  - Geometry-based `isGeometryAtBottom` in `AssistantConversationHelper.kt` inspects visible items, item bottom edge vs `viewportEndOffset`, and returns `false` if `state.isScrollInProgress` or user has scrolled up. If `!wasAtBottom`, it sets `newMessagesAvailable = true` ("跳到最新" pill) without jumping the viewport.

### 3. Clarification Card Deduplication
- **Problem Solved**: Eliminated duplicate clarification cards (Screen-12 where historical and live cards coexisted).
- **Code Audit**:
  - In `AssistantTab.kt` (lines 1105 & 1949):
    ```kotlin
    liveClarificationId = currentGen?.takeIf { it.visualState == StreamVisualState.AWAITING_CHOICE }?.clarification?.id
    ...
    val msgClar = extractClarification(message)
    if (msgClar != null && card == null && (liveClarificationId == null || msgClar.id != liveClarificationId)) {
        ClarificationCard(clarification = msgClar, isLive = false, ...)
    }
    ```
  - When the active generation is in `AWAITING_CHOICE`, the matching live card is exclusively rendered by `AssistantMergedItem.LiveClarification`. The historical message item suppresses duplicate rendering of that clarification ID.

### 4. Composer Text Semantics
- **Problem Solved**: Ensures ordinary user text in the bottom composer always issues `GenerationInput.Text(capturedDraft.text)`.
- **Code Audit**:
  - In `AssistantTab.kt` (lines 1398-1400):
    ```kotlin
    startStreamingGeneration(id, requestId, GenerationInput.Text(capturedDraft.text))
    ```
  - Follows `protocol-v1.md` §Clarification: "For user ordinary text while awaiting choice, supersede and proceed normally." Ordinary composer inputs do not fabricate `ChoiceText` or bind old source generation IDs.

---

## 4. Verification Evidence & Build Logs

### Command Run
```bash
cd clients/android && ./gradlew testDebugUnitTest lintDebug assembleDebug --no-parallel
```
- **Exit Code**: 0 (`BUILD SUCCESSFUL in 21s`)
- **Gradle Log Output**: `.trellis/tasks/10-15-ai-streaming-interactive-dialogue/artifacts/android-retest-gradle.log`

### Test Suite Execution (Parsed from XML in `app/build/test-results/testDebugUnitTest`)
- **Total Test Files**: 10
- **Total Tests Run**: 88
- **Failures**: 0
- **Errors**: 0
- **Skipped**: 0

| Test Suite | Tests | Failures | Errors | Skipped | Status |
|---|:---:|:---:|:---:|:---:|:---:|
| `CancellableBlockingFlowTest` | 1 | 0 | 0 | 0 | PASSED |
| `NetworkContractTest` | 10 | 0 | 0 | 0 | PASSED |
| `SseParserTest` | 12 | 0 | 0 | 0 | PASSED |
| `InputContractTest` | 4 | 0 | 0 | 0 | PASSED |
| `ProviderSettingsHelperTest` | 5 | 0 | 0 | 0 | PASSED |
| `AssistantConversationHelperTest` | 22 | 0 | 0 | 0 | PASSED |
| `AssistantDuplicateStateTest` | 5 | 0 | 0 | 0 | PASSED |
| `AssistantIdentityCoordinatorTest` | 6 | 0 | 0 | 0 | PASSED |
| `AssistantImportStateTest` | 10 | 0 | 0 | 0 | PASSED |
| `AssistantStreamReducerTest` | 13 | 0 | 0 | 0 | PASSED |

### Lint Check
- **Lint Target**: `lintDebug`
- **Report**: `clients/android/app/build/reports/lint-results-debug.txt`
- **Result**: 0 errors, 9 warnings (warnings: Compose modifier ordering conventions, Android 12 backup rule suggestions, unused launcher round icon). Clean pass.

### Debug APK Byte Identity
- **File**: `clients/android/app/build/outputs/apk/debug/app-debug.apk`
- **SHA-256**: `d2a37b550fb110e9b6174ec2fe874b681f924423e08c7c5be465749e3bb56da8`

---

## 5. Handoff Status & Recommendations
- **State**: COMPLETE. Android codebase compiles cleanly, passes 88/88 unit tests and lintDebug, and matches APK `d2a37b55`.
- **Handoff to Parent / Phone Verifier**:
  - The deployed server container is at `jizhang:api-chained-choice-20261016T083118Z` (chained choice bug fixed).
  - The local APK `d2a37b55` contains the verified UI fixes (0-delta placeholder + Stop button, scroll retention, clarification deduplication, text supersede semantics).
  - Verification on physical device can be conducted by `phone-verifier` when scheduled. No further Android code edits are required.
