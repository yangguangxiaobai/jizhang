package com.yansuu1.jizhang.ui.feature.assistant

import com.yansuu1.jizhang.repo.AssistantGenerationEvent
import com.yansuu1.jizhang.repo.Clarification
import com.yansuu1.jizhang.repo.ClarificationOption
import com.yansuu1.jizhang.repo.GenerationCreateResult
import com.yansuu1.jizhang.repo.GenerationError
import com.yansuu1.jizhang.repo.GenerationInput
import com.yansuu1.jizhang.repo.GenerationSnapshot
import com.yansuu1.jizhang.repo.PartialMessage
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class AssistantStreamReducerTest {

    @Test
    fun generationInputSerializationConformsToProtocolV1() {
        val textInput = GenerationInput.Text("帮我记一笔午餐35元")
        val textJson = textInput.toJson()
        assertEquals("text", textJson.optString("type"))
        assertEquals("帮我记一笔午餐35元", textJson.optString("text"))

        val choiceInput = GenerationInput.Choice("gen_123", "q_1", "opt_canteen")
        val choiceJson = choiceInput.toJson()
        assertEquals("choice", choiceJson.optString("type"))
        assertEquals("gen_123", choiceJson.optString("sourceGenerationId"))
        assertEquals("q_1", choiceJson.optString("questionId"))
        assertEquals("opt_canteen", choiceJson.optString("optionId"))

        val choiceTextInput = GenerationInput.ChoiceText("gen_123", "q_1", "请记录为团队团建费")
        val choiceTextJson = choiceTextInput.toJson()
        assertEquals("choice-text", choiceTextJson.optString("type"))
        assertEquals("gen_123", choiceTextJson.optString("sourceGenerationId"))
        assertEquals("q_1", choiceTextJson.optString("questionId"))
        assertEquals("请记录为团队团建费", choiceTextJson.optString("text"))
    }

    @Test
    fun initFromSnapshotMapsStatusesAndOutcomesCorrectly() {
        val snapshotAccepted = GenerationSnapshot(
            version = 1,
            id = "gen_1",
            conversationId = "conv_1",
            userMessageId = "msg_u1",
            userMessage = JSONObject().put("id", "msg_u1"),
            status = "accepted",
            delivery = "stream",
            lastSeq = 0L,
            createdAt = 1000L,
            updatedAt = 1000L,
            partialMessages = emptyList(),
            messageIds = emptyList(),
            messages = emptyList(),
            outcome = null,
            error = null,
        )
        val stateAccepted = AssistantStreamReducer.initFromSnapshot(snapshotAccepted, "req_1")
        assertEquals(StreamVisualState.CONNECTING, stateAccepted.visualState)
        assertEquals("gen_1", stateAccepted.generationId)
        assertEquals(0L, stateAccepted.lastSeq)

        val snapshotRunning = snapshotAccepted.copy(
            status = "running",
            lastSeq = 2L,
            partialMessages = listOf(PartialMessage("msg_p1", 0, "正在生成", false)),
        )
        val stateRunning = AssistantStreamReducer.initFromSnapshot(snapshotRunning, "req_1")
        assertEquals(StreamVisualState.RECEIVING, stateRunning.visualState)
        assertEquals("正在生成", stateRunning.provisionalMessages["msg_p1"]?.text)

        val snapshotChoice = snapshotAccepted.copy(
            status = "completed",
            outcome = "awaiting-choice",
        )
        val stateChoice = AssistantStreamReducer.initFromSnapshot(snapshotChoice, "req_1")
        assertEquals(StreamVisualState.AWAITING_CHOICE, stateChoice.visualState)

        val snapshotPending = snapshotAccepted.copy(
            status = "completed",
            outcome = "pending-confirmation",
        )
        val statePending = AssistantStreamReducer.initFromSnapshot(snapshotPending, "req_1")
        assertEquals(StreamVisualState.PENDING_FINANCIAL_CONFIRM, statePending.visualState)

        val snapshotAnswered = snapshotAccepted.copy(
            status = "completed",
            outcome = "answer",
        )
        val stateAnswered = AssistantStreamReducer.initFromSnapshot(snapshotAnswered, "req_1")
        assertEquals(StreamVisualState.ANSWERED, stateAnswered.visualState)

        val snapshotFailed = snapshotAccepted.copy(
            status = "failed",
            error = GenerationError("AI_PROVIDER_ERROR", "连接异常"),
        )
        val stateFailed = AssistantStreamReducer.initFromSnapshot(snapshotFailed, "req_1")
        assertEquals(StreamVisualState.FAILED, stateFailed.visualState)

        val snapshotCancelled = snapshotAccepted.copy(status = "cancelled")
        val stateCancelled = AssistantStreamReducer.initFromSnapshot(snapshotCancelled, "req_1")
        assertEquals(StreamVisualState.CANCELLED, stateCancelled.visualState)

        val snapshotInterrupted = snapshotAccepted.copy(status = "interrupted")
        val stateInterrupted = AssistantStreamReducer.initFromSnapshot(snapshotInterrupted, "req_1")
        assertEquals(StreamVisualState.RECONCILE, stateInterrupted.visualState)
    }

    @Test
    fun reduceEventIgnoresMismatchedGenerationAndDuplicateSeq() {
        val initial = ActiveGenerationState(
            generationId = "gen_1",
            clientRequestId = "req_1",
            conversationId = "conv_1",
            lastSeq = 5L,
        )

        // Mismatched generationId
        val wrongGenEvent = AssistantGenerationEvent.TextDelta(
            version = 1,
            generationId = "gen_OTHER",
            seq = 6L,
            messageId = "msg_1",
            step = 0,
            offset = 0,
            text = "不应处理",
        )
        val afterWrong = AssistantStreamReducer.reduceEvent(initial, wrongGenEvent)
        assertEquals(initial, afterWrong)

        // Duplicate seq (seq <= lastSeq)
        val duplicateSeqEvent = AssistantGenerationEvent.TextDelta(
            version = 1,
            generationId = "gen_1",
            seq = 5L,
            messageId = "msg_1",
            step = 0,
            offset = 0,
            text = "重复包",
        )
        val afterDup = AssistantStreamReducer.reduceEvent(initial, duplicateSeqEvent)
        assertEquals(initial, afterDup)
    }

    @Test
    fun reduceEventDetectsSequenceGapsAndTriggersReconcile() {
        val initial = ActiveGenerationState(
            generationId = "gen_1",
            clientRequestId = "req_1",
            conversationId = "conv_1",
            lastSeq = 2L,
        )

        // Jump from seq 2 to seq 5 (gap)
        val gapEvent = AssistantGenerationEvent.TextDelta(
            version = 1,
            generationId = "gen_1",
            seq = 5L,
            messageId = "msg_1",
            step = 0,
            offset = 0,
            text = "跳变",
        )
        val afterGap = AssistantStreamReducer.reduceEvent(initial, gapEvent)
        assertTrue(afterGap.requiresReconcile)
        assertEquals(StreamVisualState.RECONCILE, afterGap.visualState)
    }

    @Test
    fun textDeltaAppendsIncrementalUnicodeCharactersAndChecksOffset() {
        var state = ActiveGenerationState(
            generationId = "gen_1",
            clientRequestId = "req_1",
            conversationId = "conv_1",
            lastSeq = 0L,
            visualState = StreamVisualState.CONNECTING,
        )

        val delta1 = AssistantGenerationEvent.TextDelta(
            version = 1,
            generationId = "gen_1",
            seq = 1L,
            messageId = "msg_1",
            step = 0,
            offset = 0,
            text = "本月餐饮支出共计",
        )
        state = AssistantStreamReducer.reduceEvent(state, delta1)
        assertEquals(1L, state.lastSeq)
        assertEquals("本月餐饮支出共计", state.provisionalMessages["msg_1"]?.text)
        assertEquals(StreamVisualState.RECEIVING, state.visualState)
        assertFalse(state.requiresReconcile)

        val delta2 = AssistantGenerationEvent.TextDelta(
            version = 1,
            generationId = "gen_1",
            seq = 2L,
            messageId = "msg_1",
            step = 0,
            offset = "本月餐饮支出共计".length,
            text = " 320.50 元。",
        )
        state = AssistantStreamReducer.reduceEvent(state, delta2)
        assertEquals(2L, state.lastSeq)
        assertEquals("本月餐饮支出共计 320.50 元。", state.provisionalMessages["msg_1"]?.text)

        // Offset mismatch triggers reconcile
        val badOffsetDelta = AssistantGenerationEvent.TextDelta(
            version = 1,
            generationId = "gen_1",
            seq = 3L,
            messageId = "msg_1",
            step = 0,
            offset = 999, // Mismatched offset
            text = "错误偏移",
        )
        val stateAfterMismatch = AssistantStreamReducer.reduceEvent(state, badOffsetDelta)
        assertTrue(stateAfterMismatch.requiresReconcile)
        assertEquals(StreamVisualState.RECONCILE, stateAfterMismatch.visualState)
    }

    @Test
    fun messageEventReplacesProvisionalWithSameIdAndExtractsClarification() {
        val initialProvisional = StreamProvisionalMessage("msg_a1", 0, "正在查询...", false)
        val initial = ActiveGenerationState(
            generationId = "gen_1",
            clientRequestId = "req_1",
            conversationId = "conv_1",
            lastSeq = 1L,
            provisionalMessages = mapOf("msg_a1" to initialProvisional),
        )

        val clarificationJson = JSONObject()
            .put("id", "q_cat")
            .put("selection", "single")
            .put("question", "请确认这笔午餐归属于哪个分类？")
            .put("options", JSONArray()
                .put(JSONObject().put("id", "opt_1").put("label", "餐饮美食 · 工作餐"))
                .put(JSONObject().put("id", "opt_2").put("label", "商务社交 · 客户接待"))
            )
            .put("allowFreeText", true)

        val messageJson = JSONObject()
            .put("id", "msg_a1")
            .put("role", "assistant")
            .put("content", JSONObject()
                .put("text", "请确认这笔午餐归属于哪个分类？")
                .put("clarification", clarificationJson)
            )

        val msgEvent = AssistantGenerationEvent.Message(
            version = 1,
            generationId = "gen_1",
            seq = 2L,
            message = messageJson,
        )

        val updated = AssistantStreamReducer.reduceEvent(initial, msgEvent)
        assertEquals(2L, updated.lastSeq)
        // Provisional with same ID removed
        assertFalse(updated.provisionalMessages.containsKey("msg_a1"))
        // Validated message added
        assertTrue(updated.validatedMessages.containsKey("msg_a1"))
        // Clarification extracted
        assertNotNull(updated.clarification)
        assertEquals("q_cat", updated.clarification?.id)
        assertEquals(2, updated.clarification?.options?.size)
        assertEquals("餐饮美食 · 工作餐", updated.clarification?.options?.get(0)?.label)
    }

    @Test
    fun terminalEventTransitionsToFinalOutcome() {
        val initial = ActiveGenerationState(
            generationId = "gen_1",
            clientRequestId = "req_1",
            conversationId = "conv_1",
            lastSeq = 3L,
            visualState = StreamVisualState.RECEIVING,
        )

        val terminalAnswer = AssistantGenerationEvent.Terminal(
            version = 1,
            generationId = "gen_1",
            seq = 4L,
            status = "completed",
            outcome = "answer",
            messageIds = listOf("msg_1"),
            error = null,
        )
        val afterAnswer = AssistantStreamReducer.reduceEvent(initial, terminalAnswer)
        assertEquals(StreamVisualState.ANSWERED, afterAnswer.visualState)
        assertEquals("completed", afterAnswer.status)
        assertEquals("answer", afterAnswer.outcome)

        val terminalChoice = terminalAnswer.copy(seq = 4L, outcome = "awaiting-choice")
        val afterChoice = AssistantStreamReducer.reduceEvent(initial, terminalChoice)
        assertEquals(StreamVisualState.AWAITING_CHOICE, afterChoice.visualState)

        val terminalPending = terminalAnswer.copy(seq = 4L, outcome = "pending-confirmation")
        val afterPending = AssistantStreamReducer.reduceEvent(initial, terminalPending)
        assertEquals(StreamVisualState.PENDING_FINANCIAL_CONFIRM, afterPending.visualState)

        val terminalFailed = AssistantGenerationEvent.Terminal(
            version = 1,
            generationId = "gen_1",
            seq = 4L,
            status = "failed",
            outcome = null,
            messageIds = emptyList(),
            error = GenerationError("AI_PROVIDER_TIMEOUT", "响应超时"),
        )
        val afterFailed = AssistantStreamReducer.reduceEvent(initial, terminalFailed)
        assertEquals(StreamVisualState.FAILED, afterFailed.visualState)
        assertEquals("AI_PROVIDER_TIMEOUT", afterFailed.error?.code)
    }

    @Test
    fun applyReconciledSnapshotResetsRequiresReconcileFlag() {
        val desyncedState = ActiveGenerationState(
            generationId = "gen_1",
            clientRequestId = "req_1",
            conversationId = "conv_1",
            lastSeq = 2L,
            visualState = StreamVisualState.RECONCILE,
            requiresReconcile = true,
        )

        val snapshot = GenerationSnapshot(
            version = 1,
            id = "gen_1",
            conversationId = "conv_1",
            userMessageId = "msg_u1",
            userMessage = null,
            status = "running",
            delivery = "stream",
            lastSeq = 10L,
            createdAt = 1000L,
            updatedAt = 1005L,
            partialMessages = listOf(PartialMessage("msg_p1", 0, "权威已同步内容", true)),
            messageIds = listOf("msg_p1"),
            messages = emptyList(),
            outcome = null,
            error = null,
        )

        val reconciled = AssistantStreamReducer.applyReconciledSnapshot(desyncedState, snapshot)
        assertFalse(reconciled.requiresReconcile)
        assertEquals(10L, reconciled.lastSeq)
        assertEquals(StreamVisualState.RECEIVING, reconciled.visualState)
        assertEquals("权威已同步内容", reconciled.provisionalMessages["msg_p1"]?.text)
    }

    @Test
    fun initialEventSeqGapTriggersReconcileWhenLastSeqIsZero() {
        val initial = ActiveGenerationState(
            generationId = "gen_1",
            clientRequestId = "req_1",
            conversationId = "conv_1",
            lastSeq = 0L,
            visualState = StreamVisualState.CONNECTING,
        )

        // First event arrives with seq = 2 instead of expected 1 (gap from the very beginning!)
        val gapEvent = AssistantGenerationEvent.TextDelta(
            version = 1,
            generationId = "gen_1",
            seq = 2L,
            messageId = "msg_1",
            step = 0,
            offset = 0,
            text = "从第2包开始的乱序包",
        )
        val afterGap = AssistantStreamReducer.reduceEvent(initial, gapEvent)
        assertTrue(afterGap.requiresReconcile)
        assertEquals(StreamVisualState.RECONCILE, afterGap.visualState)
    }

    @Test
    fun strictSnapshotParserRejectsMissingOrInvalidFields() {
        // Missing version
        val noVersion = JSONObject()
            .put("id", "gen_1")
            .put("conversationId", "conv_1")
            .put("status", "accepted")
            .put("lastSeq", 0L)
        try {
            GenerationSnapshot.fromJson(noVersion)
            fail("Expected exception for missing version")
        } catch (_: IllegalArgumentException) {}

        // Version != 1
        val badVersion = JSONObject(noVersion.toString()).put("version", 2)
        try {
            GenerationSnapshot.fromJson(badVersion)
            fail("Expected exception for unsupported version")
        } catch (_: IllegalArgumentException) {}

        // Missing id
        val noId = JSONObject(noVersion.toString()).put("version", 1).put("id", "")
        try {
            GenerationSnapshot.fromJson(noId)
            fail("Expected exception for blank id")
        } catch (_: IllegalArgumentException) {}

        // Invalid status
        val badStatus = JSONObject(noVersion.toString()).put("version", 1).put("status", "unknown_status")
        try {
            GenerationSnapshot.fromJson(badStatus)
            fail("Expected exception for invalid status")
        } catch (_: IllegalArgumentException) {}

        // Outcome on non-completed status (violates protocol-v1)
        val invalidOutcomeStatus = JSONObject(noVersion.toString())
            .put("version", 1)
            .put("status", "running")
            .put("outcome", "answer")
        try {
            GenerationSnapshot.fromJson(invalidOutcomeStatus)
            fail("Expected exception for outcome on non-completed status")
        } catch (_: IllegalArgumentException) {}
    }

    @Test
    fun strictEventParserRejectsMissingOrInvalidFields() {
        // Missing version
        val noVersion = JSONObject()
            .put("generationId", "gen_1")
            .put("seq", 1L)
            .put("type", "state")
            .put("status", "running")
        try {
            AssistantGenerationEvent.fromJson(noVersion)
            fail("Expected exception for missing version in event")
        } catch (_: IllegalArgumentException) {}

        // Seq <= 0
        val nonPositiveSeq = JSONObject(noVersion.toString())
            .put("version", 1)
            .put("seq", 0L)
        try {
            AssistantGenerationEvent.fromJson(nonPositiveSeq)
            fail("Expected exception for non-positive seq in event")
        } catch (_: IllegalArgumentException) {}

        // Missing messageId in text-delta
        val badDelta = JSONObject()
            .put("version", 1)
            .put("generationId", "gen_1")
            .put("seq", 1L)
            .put("type", "text-delta")
            .put("step", 0)
            .put("offset", 0)
            .put("text", "hi")
        try {
            AssistantGenerationEvent.fromJson(badDelta)
            fail("Expected exception for missing messageId in text-delta")
        } catch (_: IllegalArgumentException) {}
    }

    @Test
    fun applyReconciledSnapshotRejectsIdentityMismatchAndStaleLastSeq() {
        val currentState = ActiveGenerationState(
            generationId = "gen_current",
            clientRequestId = "req_1",
            conversationId = "conv_current",
            lastSeq = 15L,
            status = "running",
            delivery = "stream",
        )

        // 1. Mismatched conversationId
        val wrongConvSnapshot = GenerationSnapshot(
            version = 1,
            id = "gen_current",
            conversationId = "conv_OTHER",
            userMessageId = "msg_u1",
            userMessage = null,
            status = "completed",
            delivery = "stream",
            lastSeq = 20L,
            createdAt = 1000L,
            updatedAt = 1005L,
            partialMessages = emptyList(),
            messageIds = emptyList(),
            messages = emptyList(),
            outcome = "answer",
            error = null,
        )
        val afterWrongConv = AssistantStreamReducer.applyReconciledSnapshot(currentState, wrongConvSnapshot)
        assertEquals(currentState, afterWrongConv)

        // 2. Mismatched generationId
        val wrongGenSnapshot = wrongConvSnapshot.copy(conversationId = "conv_current", id = "gen_OTHER")
        val afterWrongGen = AssistantStreamReducer.applyReconciledSnapshot(currentState, wrongGenSnapshot)
        assertEquals(currentState, afterWrongGen)

        // 3. Stale lastSeq (snapshot lastSeq < state lastSeq: e.g. 10 < 15)
        val staleSnapshot = wrongConvSnapshot.copy(conversationId = "conv_current", id = "gen_current", lastSeq = 10L)
        val afterStale = AssistantStreamReducer.applyReconciledSnapshot(currentState, staleSnapshot)
        assertEquals(currentState, afterStale)
    }

    @Test
    fun lockChoiceRecordsSelectedOptionIdAndPreservesRequestId() {
        val initial = ActiveGenerationState(
            generationId = "gen_1",
            clientRequestId = "req_1",
            conversationId = "conv_1",
            visualState = StreamVisualState.AWAITING_CHOICE,
            selectedOptionId = null,
            pendingChoiceRequestId = null,
        )

        val locked = AssistantStreamReducer.lockChoice(initial, "opt_dinner", "choice_req_123")
        assertEquals("opt_dinner", locked.selectedOptionId)
        assertEquals("choice_req_123", locked.pendingChoiceRequestId)

        // Subsequent lock preserves existing pendingChoiceRequestId if none supplied
        val relocked = AssistantStreamReducer.lockChoice(locked, "opt_dinner_confirm")
        assertEquals("choice_req_123", relocked.pendingChoiceRequestId)
    }
}
