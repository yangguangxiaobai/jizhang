# Android Final Streaming & Interactive Dialogue Code Review

## 1. Executive Summary & Verification State
- **Audit Target**: `clients/android` Kotlin implementation for AI streaming, clarification choices, lifecycle, and visual status indicators (`.trellis/tasks/10-15-ai-streaming-interactive-dialogue`).
- **Baseline Verification**:
  - `testDebugUnitTest`: **87/87 Unit Tests Passed** (0 failures, 0 errors, 0 skipped).
  - `lintDebug`: **BUILD SUCCESSFUL** (0 lint errors).
  - `assembleDebug`: **BUILD SUCCESSFUL** (Debug APK compiled).
  - Full execution log archived at `artifacts/android-stream-check.log`.
- **Honest Verification Boundary**: All tests and validations reported herein reflect local JVM unit test suites and Gradle compilation checks (`testDebugUnitTest`, `lintDebug`, `assembleDebug`). They **must not** be conflated with live physical Android device or upstream streaming provider verification, which remain pending explicit user authorization and deployment.

---

## 2. Six Nuclear Audit Checkpoints Review

### A. Uncertain Choice Same-Request Retry (不确定 choice 同请求重试)
1. **In-Flight Lock & Request ID Preservation**:
   - `selectClarificationChoice` uses `val liveGen = activeGenerations[targetConvId] ?: currentGen` to resolve the current active generation, and preserves `liveGen.pendingChoiceRequestId ?: UUID.randomUUID().toString()`.
   - Once a choice option is clicked, `AssistantStreamReducer.lockChoice(liveGen, option.id, choiceRequestId)` locks the state to `selectedOptionId = option.id`.
   - `canSelectChoiceOption` strictly prevents tapping any different option (`optB != optA`), while permitting retry of the same option `optA`.
2. **Deterministic 4xx vs. Non-Deterministic / In-Flight Error Partitioning**:
   - `shouldUnlockChoiceOnError(error)` inspects client errors:
     - Deterministic client errors (HTTP 400, 422, etc.) unlock the choice.
     - **Crucial Invariant Hardening**: HTTP 409 `ASSISTANT_GENERATION_ACTIVE` and HTTP 409 `ASSISTANT_REQUEST_CONFLICT` explicitly **do NOT** unlock the choice (`return false`), because the server already has an active generation processing the request. HTTP 409 `ASSISTANT_CHOICE_STALE` allows unlocking because the choice has been superseded.
     - Timeouts (HTTP 408), rate limits (HTTP 429), server errors (5xx), and network `IOException` (e.g. SocketTimeoutException) strictly **do NOT** unlock the choice (`return false`).
3. **UI Safe Retry Action**:
   - If an uncertain network error occurs during a choice POST, `allowRetrySelected` displays a dedicated button: `核对此次选择（不重复创建请求）`.
   - Clicking this button re-invokes `selectClarificationChoice` using the exact identical `pendingChoiceRequestId` and canonical `GenerationInput.Choice` payload, preventing duplicate conflicting generation creations on the backend.

### B. Identity Isolation & Anti-ABA / Old GET / Session / Subscription Gates (A->B->A / 旧 GET / session / subscription 隔离)
1. **Volatile Request Gate (`AssistantRequestGate`)**:
   - Tracks lanes and generations (`lane`, `scope`, `generation`).
   - `requests.invalidateDisplay()` clears active lanes (`messages`, `composer-file`, `action-file`, `gen:*`, `reconnect:*`, `cancel:*`) and increments gate generation.
2. **A -> B -> A Prevention**:
   - When switching conversations (`selectConversation(id)`):
     - Immediately calls `cancelStreamJob(prevId)`.
     - Calls `requests.invalidateDisplay()`.
     - Delayed responses from an earlier visit to conversation A arriving after returning from conversation B are invalidated and safely dropped because the gate generation advanced.
3. **Old GET Isolation**:
   - `refreshMessages`, `getLatestGeneration`, and `getGeneration` check both `conversationId == targetId` and `requests.accepts(ticket)` before and after every suspend call.
   - Any late-arriving GET response for an inactive conversation is rejected without mutating messages or generation states.
4. **Subscription & Session Expiry**:
   - `ApiClient.streamSse` intercepts HTTP 401, clears cookies, flips `sessionExpired.value = true`, and throws `AuthExpiredException`.
   - Every streaming collect step checks `!api.sessionExpired.value`, `alive[0]`, `requests.accepts(operation)`, and `conversationId == targetConvId`, throwing `CancellationException` immediately upon lifecycle/session termination.

### C. Partial / Final Message Deduplication (partial / final 去重)
1. **Strict Keyed Identity Set (`renderedMessageIds`)**:
   - In `buildAssistantMergedItems(historicalMessages, activeGen)`:
     - Step 1: Adds all visible historical messages to `renderedMessageIds`.
     - Step 2: Adds accepted `userMessage` only if `uId !in renderedMessageIds`.
     - Step 3: Adds validated assistant messages (`validatedMessages.values`) only if `vId !in renderedMessageIds`.
     - Step 4: Provisional streaming bubbles (`provisionalMessages.values`) are rendered only if `prov.messageId !in renderedMessageIds`.
2. **Atomic Reducer In-Place Replacement**:
   - When an `AssistantGenerationEvent.Message` event arrives, `AssistantStreamReducer` atomically removes `msgId` from `provisionalMessages` and inserts the final DTO into `validatedMessages`.
   - When `refreshMessages` synchronizes the conversation, historical messages contain the finalized DTOs, and the deduplication set prevents duplicate display bubbles.

### D. EOF & Blocking Read Cancellation (EOF / 阻塞读取取消)
1. **Immediate Network Interruption via Transport Cancellation**:
   - `cancellableBlockingFlow` pairs a child IO reader coroutine with an immediate `cancelTransport = { call.cancel() }`.
   - Cancelling the subscriber or navigating away invokes OkHttp `Call.cancel()` immediately before waiting for the blocked IO thread, instantly breaking Okio buffer reads with an `IOException` ("Canceled") instead of hanging indefinitely.
2. **Unterminated EOF Protection in `SseParser`**:
   - Incomplete lines or events without terminating empty lines (`\n\n` / `\r\r`) at EOF are discarded without dispatching corrupted fragments.
   - Standalone CR (`\r`) delimiters are processed without blocking lookahead across chunk boundaries.
3. **Stream EOF Reconcile Handling**:
   - If SSE stream collection reaches normal EOF without encountering a terminal event while status is still `accepted` or `running`, `shouldReconcileAfterStreamEof` triggers an immediate safe GET to `repo.getGeneration` to reconcile the generation's terminal status, preventing permanent running spinners.

### E. History Card Status Priority (history 卡状态优先)
1. **Authoritative Action Status Precedence**:
   - In `buildAssistantMergedItems`:
     - Reads all historical messages to build `historyActionStatuses`.
     - If history contains an action marked `confirmed` or `cancelled`, that terminal status overrides any stale cached snapshot card (`status = "pending"`).
     - Clones validated messages with updated status if historical records have finalized the action, preventing resurrection of actionable pending buttons.
2. **Current-Gen Pending Financial Alert Filtering**:
   - `PendingFinancialNotice` is rendered **only** when `hasActualPendingAction` is true (i.e. at least one card belonging to the current generation is genuinely pending in history).
   - Old cards from prior generations do not trigger the live pending banner.
3. **Clean Answered Signal**:
   - `AnsweredSignal` is displayed when `activeGen.outcome == "answer"` and the current generation contains no action cards, providing clear visual closure that no ledger write is pending.

### F. Separation of Reading Scroll & Financial Confirmation (阅读滚动和财务确认分离)
1. **Geometry-Based Scroll Bottom Calculation**:
   - `isGeometryAtBottom` measures `lastItem.offset + lastItem.size <= viewportEndOffset + tolerancePx` and `!isScrollInProgress`.
   - Accurately distinguishes between a user genuinely at the bottom vs. a user viewing the top of a large bubble.
2. **Preservation of User Reading Scroll Position**:
   - When user is at the bottom, incoming text deltas scroll down smoothly using `listState.scrollToItem(lastIndex)`.
   - When user scrolled up to read earlier history, scrolling is **never** forced downward. A floating pill "有新消息，跳到最新" is displayed.
3. **Zero Financial Mutation on Choice Selection**:
   - Option buttons in `ClarificationCard` send only `GenerationInput.Choice` or `GenerationInput.ChoiceText` to `/generations`. They **never** call `/confirm` and **never** book transactions.
   - Financial ledger booking requires an explicit, separate, second-step confirmation: clicking "核对并继续 →" on an `AssistantActionCard`, which opens `AssistantConfirmationScreen` with detailed breakdown, warnings, and an independent "确认执行" dialog calling `repo.confirmAction`.

---

## 3. Targeted Bug Fixes & Regressions Added

1. **`shouldUnlockChoiceOnError` 409 Invariant Hardening**:
   - Added explicit protection for 409 `ASSISTANT_GENERATION_ACTIVE` and `ASSISTANT_REQUEST_CONFLICT`. When these errors occur, the choice selection remains locked so the client cannot send duplicate conflicting options while the server is actively generating.
   - Added unit test regressions in `AssistantConversationHelperTest.kt`.
2. **`selectClarificationChoice` Live State Retrieval**:
   - Ensured `selectClarificationChoice` retrieves `activeGenerations[targetConvId] ?: currentGen` to prevent any stale lambda closure from generating a new UUID on retry.

---

## 4. Verification Evidence & Test Summary

- Command executed:
  ```bash
  cd clients/android && ./gradlew testDebugUnitTest --rerun-tasks lintDebug assembleDebug --no-parallel
  ```
- Outcome: **BUILD SUCCESSFUL in 2m 15s**, 53 actionable tasks executed.
- Test Suite Results:
  - `CancellableBlockingFlowTest`: 1 passed.
  - `NetworkContractTest`: 10 passed.
  - `SseParserTest`: 12 passed.
  - `InputContractTest`: 4 passed.
  - `ProviderSettingsHelperTest`: 5 passed.
  - `AssistantConversationHelperTest`: 21 passed.
  - `AssistantDuplicateStateTest`: 5 passed.
  - `AssistantIdentityCoordinatorTest`: 6 passed.
  - `AssistantImportStateTest`: 10 passed.
  - `AssistantStreamReducerTest`: 13 passed.
  - **Total**: 87 tests passed (0 failures, 0 errors, 0 skipped).
- Lint Results:
  - `lintDebug`: 0 errors reported; HTML report generated at `build/reports/lint-results-debug.html`.
- Assemble Results:
  - `assembleDebug`: Debug APK successfully assembled.

---

## 5. Scope & Compliance Attestation
- **No Backend / Model / Config Changes**: Zero edits made to `packages/server`, database schemas, migrations, or upstream provider configurations.
- **No Spec / README Edits**: `clients/android/README.md` and spec files left untouched (preserved for parent agent).
- **No Deployment / APK Install / Live Booking**: No APK installed on real devices; no production deployments; no live model accounting transactions executed.
- **No Nested Agents**: All analysis and modifications performed directly within the assigned execution track.
