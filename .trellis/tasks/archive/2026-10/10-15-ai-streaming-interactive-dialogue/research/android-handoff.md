# Android Streaming & Interactive Dialogue - Handoff & Implementation Tracking

## 1. Context & Baseline
- Target task: `.trellis/tasks/10-15-ai-streaming-interactive-dialogue`
- Normative contract: `research/protocol-v1.md`
- Normative UI design: `research/ardot-design.md` (Ardot 5 frames AI14–AI18, titanium blue `#2F6F8F`)
- Scope: `clients/android` Kotlin net/repo/ui/test
- Policy: No nested sub-agents, no git commit, no production deploy, no device/APK install, no README edits.

## 2. Critical Review Repairs & Architectural Hardening

### A. Pure Bounded Reusable SSE Parser (`SseParser.kt` & `ApiClient.kt`)
1. **Framing & Separators**:
   - Strictly parses CRLF (`\r\n`), LF (`\n`), and standalone CR (`\r`) delimiters without scanning unbounded buffers.
   - Evaluates delimiters within bounded range (`maxLineBytes + 1L`) using Okio `indexOf`.
2. **Bounds Enforcement**:
   - `maxLineBytes = 64 * 1024L` (64 KiB): Throws `ApiException(400, "SSE_LINE_OVERSIZED", ...)` if any line exceeds 64 KiB.
   - `maxEventDataBytes = 128 * 1024` (128 KiB): Accumulates multi-line data; throws `ApiException(400, "SSE_EVENT_OVERSIZED", ...)` if event data exceeds 128 KiB.
   - `maxTotalBytes = 2 * 1024 * 1024L` (2 MiB): Bounded total stream size; throws `ApiException(400, "SSE_TOTAL_OVERSIZED", ...)`.
3. **Encoding & Incomplete EOF Guarantees**:
   - Strict UTF-8 decoding using `CodingErrorAction.REPORT`. Throws `ApiException(400, "SSE_CORRUPT_UTF8", ...)` upon corrupted or unmappable byte sequences.
   - Discards incomplete events and unterminated lines at EOF if missing trailing blank line delimiter (`\n\n` / `\r\r`).
   - Ignores comment / heartbeat lines starting with `:`.
4. **Flow & Network Cancellation**:
   - `streamSse` runs purely via `flow { ... }.flowOn(Dispatchers.IO)`. Never blocks caller's Main dispatcher.
   - Registers OkHttp `Call.cancel()` on coroutine completion / cancellation handle and in `finally`.
   - Explicitly forbids HTTP redirects (300..399) with `SSE_REDIRECT_FORBIDDEN`.
   - Strictly enforces `Content-Type: text/event-stream` with `INVALID_CONTENT_TYPE`.
   - Propagates HTTP 401 via `AuthExpiredException` and flags `sessionExpired.value = true`.

### B. Strict Bounded DTO Parser (`AssistantStreamingModels.kt`)
1. **Schema & Version Strictness**:
   - `GenerationSnapshot.fromJson` and `AssistantGenerationEvent.fromJson` enforce `version == 1`. Missing or mismatched versions throw `IllegalArgumentException`.
   - Compulsory non-blank identifiers: `id`, `conversationId`, `messageId`, `generationId` validated. Silent defaulting via `optString` removed.
   - Monotonic positive event sequences: `seq >= 1L` strictly required for all streaming events; snapshot `lastSeq >= 0L`.
   - Status restricted to permitted protocol-v1 enum strings (`accepted`, `running`, `completed`, `failed`, `cancelled`, `interrupted`).
   - Outcome restriction: `outcome` validated to `answer`, `awaiting-choice`, `pending-confirmation`; throws if present on non-`completed` status.
   - Bounded lengths: IDs <= 128 chars, text deltas <= 4000 chars, message / partial arrays capped to 2048 elements.

### C. Reducer Invariants (`AssistantStreamReducer.kt`)
1. **Sequence Gap Rejection**:
   - Contiguous check: `event.seq > state.lastSeq + 1L` immediately triggers `requiresReconcile = true` and `visualState = RECONCILE`.
   - Initial event strictness: If `lastSeq == 0L` and first event has `seq > 1L` (e.g. `seq = 2L`), triggers reconciliation immediately (no last0 exemption).
   - Duplicate events (`seq <= lastSeq`) discarded.
2. **Snapshot Identity & Stale lastSeq Rejection**:
   - Verifies `snapshot.conversationId == state.conversationId && snapshot.id == state.generationId`. Rejects mismatched snapshots.
   - Stale sequence rejection: If `snapshot.lastSeq < state.lastSeq`, drops snapshot without modifying state (prevents `maxOf` corruption with older data).
3. **Offset Integrity**:
   - `TextDelta.offset` must strictly match accumulated string length in `provisionalMessages`; mismatch triggers reconcile.
4. **Provisional Replacement & Choice Request ID**:
   - Receiving `Message` event removes matching ID from `provisionalMessages` and stores final DTO in `validatedMessages`.
   - `lockChoice` captures `selectedOptionId` and persists `pendingChoiceRequestId` across retries.

### D. AssistantTab Subscription Lifecycle, Identity Gates & Dynamic Scroll (`AssistantTab.kt`)
1. **Owned Subscription Lifecycle**:
   - Dedicated `Job` tracked per conversation (`activeStreamJobs`). Cancelled when navigating away (`selectConversation`), disposing the tab (`DisposableEffect`), or reconnecting.
   - Closing the client subscription cancels only the SSE collection / OkHttp Call; does NOT cancel the server generation.
   - Explicit Stop button issues `POST /cancel` to cancel the server generation.
2. **Identity Verification (Anti-ABA)**:
   - Full gate check (`alive[0]`, `requests.accepts(operation, baseUrl)`, `conversationId == targetId`, `!api.sessionExpired.value`) verified before and after EVERY suspend `await` call.
   - Gate checks enforced inside `catch` handlers for cancel, reconnect, and streaming creation before touching notices or state.
3. **Re-subscription of Restored Running Snapshots**:
   - In `refreshMessages`, when `getLatestGeneration` returns a snapshot with status `accepted` or `running`, it automatically launches `subscribeToGenerationEvents` with `afterSeq = snapshot.lastSeq` if no collector is currently active.
4. **Terminal / Busy Race Resolution**:
   - `sendingConversationIds` cleared immediately upon receiving `AssistantGenerationEvent.Terminal` before calling `refreshMessages(targetConvId)`, ensuring terminal messages are installed and rendered.
5. **Unified Display Merging (`buildAssistantMergedItems`)**:
   - Single ordered stream: visible raw history -> accepted user message -> validated messages -> provisional streaming bubbles -> live clarification card -> terminal status badges.
   - Validated messages replace provisional messages in place with matching stable IDs; prevents duplicates or vanishing cards.
   - Live clarification card rendered only once when awaiting choice; historical clarification options rendered disabled.
   - Explicit visual renders for all states: `CONNECTING` (progress spinner), `RECEIVING` (growing bubble with Stop button), `AWAITING_CHOICE` (options >= 48dp), `PENDING_FINANCIAL_CONFIRM` (titanium blue alert notice + proposal card), `ANSWERED` (`AnsweredSignalBox`), `FAILED` (error card with code/message), `CANCELLED` (cancellation banner), `RECONCILE` (`ReconcileAlertCard`).
6. **Preserved Choice Client Request ID**:
   - `selectClarificationChoice` reuses `currentGen.pendingChoiceRequestId ?: UUID.randomUUID().toString()`, preventing duplicate POSTs with new UUIDs on network retries.
7. **Dynamic Scroll Reading Preservation**:
   - Assesses `isAtBottom` before each chunk update against the dynamic item count (`buildAssistantMergedItems.size`).
   - If user is at bottom, scrolls down. If `motion.reduced` is true, performs instant `scrollToItem` rather than disabling scrolling.
   - If user scrolled up to read earlier history, scrolling is NOT forced down, and "有新消息，跳到最新" button is surfaced.
8. **Preserved Legacy Compatibility**:
   - Human financial confirmations, duplicate reviews, 100-item selection caps, SHA-256 validation, drafts, and multipart photo uploads remain completely intact and unaffected.

## 3. Verification Evidence

### A. Unit Tests
- Command: `cd clients/android && ./gradlew testDebugUnitTest --rerun-tasks`
- Result: **BUILD SUCCESSFUL in 46s**, all 74 unit tests passed without failure.
- Key Test Suites:
  - `SseParserTest`: CRLF/LF/CR framing, comment skipping, 64KiB line limit, 128KiB event limit, 2MiB stream limit, malformed UTF-8 rejection, incomplete EOF handling.
  - `AssistantStreamReducerTest`: Sequence gap rejection (including initial seq=2 when lastSeq=0), duplicate seq rejection, offset mismatch reconcile, strict snapshot and event JSON parsing, snapshot identity and stale lastSeq rejection, choice locking and request ID preservation.
  - `AssistantIdentityCoordinatorTest`: Gate isolation, A->B->A race rejection, server URL change invalidation, full invalidation, old GET mismatch gates.
  - `AssistantConversationHelperTest`: Unified display items merge order, provisional replacement by validated message, visual status card rendering, sensitive credential suppression.
  - `NetworkContractTest`: Bodiless POST CSRF, raw photo PUT session cookies, URL validation, SSE redirect prohibition (300..399), text/event-stream content-type enforcement.

### B. Lint Check
- Command: `cd clients/android && ./gradlew lintDebug`
- Result: **BUILD SUCCESSFUL in 36s**, 0 errors reported.

### C. Build Check
- Command: `cd clients/android && ./gradlew assembleDebug`
- Result: **BUILD SUCCESSFUL in 17s**, debug APK successfully assembled.

## 4. Independent Audit Focused Repairs (Hardening Iteration)

### Defect 1: Subscribe Collect Normal EOF Missing Terminal
- **Fix**: When `repo.streamGenerationEvents(...).collect { ... }` finishes normally without throwing an exception, if `shouldReconcileAfterStreamEof(currentState)` is true (i.e. status still `accepted` or `running`), client immediately invokes `repo.getGeneration(targetConvId, currentState.generationId)` via safe GET (NO model POST) and applies snapshot reconciliation to avoid UI running/stuck forever.
- **Helper & Regression**: Added `shouldReconcileAfterStreamEof` and `reconcileStreamCompletion` to `AssistantConversationHelper.kt` with full regression tests.

### Defect 2: History Authoritative Card Status over Stale Snapshot
- **Fix**: In `buildAssistantMergedItems`, authoritative action statuses (`historyActionStatuses`) from `historicalMessages` take precedence over stale cached snapshot cards. If history marks an action as `confirmed` or `cancelled`, the validated card reflects that terminal state and does not resurrect stale `pending` state.
- **Pending Notice & Answered Signal**: `PendingFinancialNotice` is rendered ONLY if there is an actual currently-pending action belonging to the current generation. Historical cards from prior generations do NOT prevent `AnsweredSignal` from showing when current generation outcome is `answer` with no cards.

### Defect 3: Live State Reconciliation, Immediate Stop Cancellation & Safe Busy Clearing
- **Fix**: `stopGeneration` immediately invokes `cancelStreamJob(targetConvId)` to cancel local jobs before making network calls.
- **Race Protection**: `stopGeneration` and `reconnectGeneration` re-read live state `activeGenerations[targetConvId]` after awaiting network responses and match `generationId` before updating state via `reconcileStopSuccess` / `reconcileReconnectSuccess`, avoiding overwriting newer states.
- **Failed Stop Reconcile**: Failed stop transitions to `visualState = RECONCILE` with `requiresReconcile = true`, preventing duplicate actions.
- **Auth & Lifecycle**: Properly handles `AuthExpiredException` via `onAuthExpired()`. `clearConversationLocalState(id)` explicitly cancels owned stream job (`cancelStreamJob(id)`).

### Defect 4: Safe Error Code Guidance Mapping in FailureAlert
- **Fix**: `FailureAlert` uses `formatAssistantErrorMessage(item.error?.code)` rather than displaying arbitrary/unvetted backend error strings.
- **Safe Mapping**: Added safe mappings for `ASSISTANT_STREAM_BOUNDS`, `SSE_LINE_OVERSIZED`, `SSE_EVENT_OVERSIZED`, `SSE_TOTAL_OVERSIZED`, `SSE_CORRUPT_UTF8`, and fallback generic guidance for unknown codes.

### Defect 5: Choice Request ID Retention & Deterministic 4xx Unlocking
- **Fix**: Retains `pendingChoiceRequestId` and `selectedOptionId` across retries/network failures (`canSelectChoiceOption`), preventing duplicate choices with different options.
- **Error Handling**: Deterministic 4xx errors (`shouldUnlockChoiceOnError`: 400..499 excluding 408 and 429) safely unlock the choice via `AssistantStreamReducer.unlockChoice`. Timeouts, server errors (5xx), and network failures keep the lock to permit same-attempt retry only.

### Defect 6: Accurate Geometry-Based Scroll Bottom & Throttle Delta
- **Fix**: `isAtBottom` calculates accurate geometry using `ScrollItemGeometry(index, offset, size)`: `(lastItem.offset + lastItem.size) <= viewportEndOffset + tolerancePx` and `!isScrollInProgress`, fixing the false positive where a giant bubble with only its top visible was detected as bottom.
- **Smooth Streaming**: Streaming deltas scroll immediately without per-delta animation (`listState.scrollToItem`), preventing jank. When user is reading/scrolled up, `newMessagesAvailable = true` is set for text-deltas even when item count is unchanged (`sameitemgrows`).

### Defect 7: Standalone CR SSE Parsing Without Lookahead Blocking
- **Fix**: `SseParser.SseStreamReader` returns standalone CR lines immediately with delimiter length 1 without calling `source.request` looking ahead, and carries `skipOptionalLf = true` into the next line read.
- **Regression**: Retained existing LF streaming test and added `streamingSourceEmitsEventBeforeSourceFinishesAndDoesNotReadPastStandaloneCrEvent` with controlled `Source` proving zero lookahead past frame.

## 5. Verification Evidence (Full Passes)

### A. Unit Tests
- Command: `cd clients/android && ./gradlew testDebugUnitTest`
- Result: **BUILD SUCCESSFUL**, all 81 unit tests in Debug and 81 unit tests in Release passed without failure.

### B. Lint Check
- Command: `cd clients/android && ./gradlew lintDebug`
- Result: **BUILD SUCCESSFUL**, 0 errors reported.

### C. Build Check
- Command: `cd clients/android && ./gradlew assembleDebug`
- Result: **BUILD SUCCESSFUL**, debug APK successfully assembled.

## 6. Honest Remaining Checkpoints & Out-of-Scope Items
- **Physical Device & Real Provider Verification**: Build and local unit verification succeeded. Live end-to-end device testing with upstream streaming provider requires deployment and production cutover, which remains separate and subject to explicit user authorization.
- **Scope Compliance**: Zero changes made to server code, production deployment configurations, database migrations, or `clients/android/README.md`. No git commits made. No nested subagents used.
