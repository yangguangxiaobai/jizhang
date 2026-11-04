package com.yansuu1.jizhang.ui.feature.assistant

import com.yansuu1.jizhang.net.ApiException
import com.yansuu1.jizhang.repo.GenerationError
import com.yansuu1.jizhang.repo.GenerationSnapshot
import com.yansuu1.jizhang.repo.PartialMessage
import com.yansuu1.jizhang.ui.dateInput
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.snapshots.Snapshot
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AssistantConversationHelperTest {

    private fun createTestSnapshot(
        id: String,
        conversationId: String,
        status: String,
        outcome: String? = null,
        lastSeq: Long = 0L,
        delivery: String = "stream",
        messages: List<JSONObject> = emptyList(),
        partialMessages: List<PartialMessage> = emptyList(),
    ): GenerationSnapshot {
        return GenerationSnapshot(
            version = 1,
            id = id,
            conversationId = conversationId,
            userMessageId = "msg_u1",
            userMessage = null,
            status = status,
            delivery = delivery,
            lastSeq = lastSeq,
            createdAt = 1000L,
            updatedAt = 1000L,
            partialMessages = partialMessages,
            messageIds = messages.mapNotNull { it.optString("id").takeIf { id -> id.isNotBlank() } },
            messages = messages,
            outcome = outcome,
            error = null,
        )
    }

    @Test
    fun filterVisibleAssistantMessagesHidesHistoricalCompleteProgressWithoutError() {
        val completeProgress = JSONObject()
            .put("id", "msg_1")
            .put("role", "tool")
            .put("kind", "progress")
            .put("content", JSONObject().put("version", 1).put("progress", JSONObject().put("state", "complete")))

        val normalMessage = JSONObject()
            .put("id", "msg_2")
            .put("role", "user")
            .put("content", JSONObject().put("text", "今天买香蕉花了13.5"))

        val filtered = filterVisibleAssistantMessages(listOf(completeProgress, normalMessage))
        assertEquals(1, filtered.size)
        assertEquals("msg_2", filtered[0].optString("id"))
    }

    @Test
    fun filterVisibleAssistantMessagesPreservesRunningFailedAndErrorProgress() {
        val runningProgress = JSONObject()
            .put("id", "msg_run")
            .put("role", "tool")
            .put("kind", "progress")
            .put("content", JSONObject().put("version", 1).put("progress", JSONObject().put("state", "running")))

        val failedProgress = JSONObject()
            .put("id", "msg_failed")
            .put("role", "tool")
            .put("kind", "progress")
            .put("content", JSONObject().put("version", 1).put("progress", JSONObject().put("state", "failed")))

        val completeProgressWithError = JSONObject()
            .put("id", "msg_err")
            .put("role", "tool")
            .put("kind", "progress")
            .put("content", JSONObject().put("version", 1)
                .put("progress", JSONObject().put("state", "complete"))
                .put("error", JSONObject().put("code", "AI_PROVIDER_ERROR")))

        val unknownProgress = JSONObject()
            .put("id", "msg_unknown")
            .put("role", "tool")
            .put("kind", "progress")
            .put("content", JSONObject().put("version", 1).put("progress", JSONObject().put("state", "something_else")))

        val all = listOf(runningProgress, failedProgress, completeProgressWithError, unknownProgress)
        val filtered = filterVisibleAssistantMessages(all)
        assertEquals(4, filtered.size)
        assertEquals(listOf("msg_run", "msg_failed", "msg_err", "msg_unknown"), filtered.map { it.optString("id") })
    }

    @Test
    fun filterVisibleAssistantMessagesPreservesCardsAndResultsEvenIfProgressPresent() {
        val messageWithCard = JSONObject()
            .put("id", "msg_card")
            .put("role", "assistant")
            .put("content", JSONObject().put("version", 1)
                .put("progress", JSONObject().put("state", "complete"))
                .put("card", JSONObject().put("toolName", "transaction.create")))

        val filtered = filterVisibleAssistantMessages(listOf(messageWithCard))
        assertEquals(1, filtered.size)
        assertEquals("msg_card", filtered[0].optString("id"))
    }

    @Test
    fun resolveProgressDisplayStateRecognizesKnownAndUnknownStates() {
        assertEquals(AssistantProgressDisplayState.RUNNING, resolveProgressDisplayState("running"))
        assertEquals(AssistantProgressDisplayState.FAILED, resolveProgressDisplayState("failed"))
        assertEquals(AssistantProgressDisplayState.COMPLETE, resolveProgressDisplayState("complete"))
        assertEquals(AssistantProgressDisplayState.UNKNOWN, resolveProgressDisplayState("unknown"))
        assertEquals(AssistantProgressDisplayState.UNKNOWN, resolveProgressDisplayState(null))
        assertEquals(AssistantProgressDisplayState.UNKNOWN, resolveProgressDisplayState(""))
    }

    @Test
    fun isProgressOnlyMessageDistinguishesProgressFromConversationalPayload() {
        val pureProgress = JSONObject()
            .put("kind", "progress")
            .put("content", JSONObject().put("progress", JSONObject().put("state", "running")))
        assertTrue(isProgressOnlyMessage(pureProgress))

        val progressWithText = JSONObject()
            .put("kind", "progress")
            .put("content", JSONObject().put("text", "正在分析您的账单...").put("progress", JSONObject().put("state", "running")))
        assertFalse(isProgressOnlyMessage(progressWithText))

        val progressWithError = JSONObject()
            .put("kind", "progress")
            .put("content", JSONObject().put("error", JSONObject().put("code", "AI_PROVIDER_ERROR")))
        assertFalse(isProgressOnlyMessage(progressWithError))
    }

    @Test
    fun formatAssistantErrorMessageMapsActionableSafeCodesAndGenericFallback() {
        assertEquals(
            "暂时无法连接 AI 服务，请检查服务地址、网络和服务状态后重试。",
            formatAssistantErrorMessage("AI_PROVIDER_ERROR")
        )
        assertEquals(
            "AI 服务响应超时，请稍后重试。若持续发生，请检查服务地址与超时设置。",
            formatAssistantErrorMessage("AI_PROVIDER_TIMEOUT")
        )
        assertEquals(
            "AI 服务返回内容无法识别，请检查模型配置后重试。",
            formatAssistantErrorMessage("AI_RESPONSE_INVALID")
        )
        assertEquals(
            "AI 配置无效，请检查服务地址、模型及高级请求设置。",
            formatAssistantErrorMessage("AI_CONFIG_INVALID")
        )
        assertEquals(
            "请求内容无效，请检查输入后重试。",
            formatAssistantErrorMessage("ASSISTANT_INVALID")
        )
        assertEquals(
            "AI 服务尚未配置或已停用，请前往设置完成配置。",
            formatAssistantErrorMessage("AI_NOT_CONFIGURED")
        )
        // Unknown AI code
        assertEquals(
            "AI 服务暂时无法处理请求，请检查配置或稍后重试。",
            formatAssistantErrorMessage("AI_CUSTOM_UNKNOWN")
        )
        // Generic fallback for null or unknown non-AI codes
        assertEquals(
            "助手暂时无法处理请求，请稍后重试。",
            formatAssistantErrorMessage("INTERNAL_UNKNOWN_ERR")
        )
        assertEquals(
            "助手暂时无法处理请求，请稍后重试。",
            formatAssistantErrorMessage(null)
        )
    }

    @Test
    fun formatAssistantFieldDateFormatsValidEpochAndIsoDatesWithoutInventingDates() {
        // Known test epoch: 1791907200000 formatted via dateInput in current locale/timezone
        val expectedDate = dateInput(1791907200000L)
        val formatted = formatAssistantFieldDate(1791907200000L)
        assertEquals(expectedDate, formatted)

        // String epoch ms
        assertEquals(expectedDate, formatAssistantFieldDate("1791907200000"))

        // ISO format string
        assertEquals("2026-10-15", formatAssistantFieldDate("2026-10-15"))
        assertEquals("2026-10-15", formatAssistantFieldDate("2026-10-15T12:00:00Z"))
        assertEquals("2026-10-15", formatAssistantFieldDate("2026-10-15T12:00:00+08:00"))
        assertEquals("2026-10-15", formatAssistantFieldDate("2026-10-15 12:00:00"))

        // Legitimate dates outside arbitrary 2000..2100 constraints
        assertEquals("1995-05-20", formatAssistantFieldDate("1995-05-20"))
        assertEquals("2150-01-01", formatAssistantFieldDate("2150-01-01"))

        // Invalid calendar dates must be strictly rejected
        assertNull(formatAssistantFieldDate("2026-99-99"))
        assertNull(formatAssistantFieldDate("2026-02-30"))
        assertNull(formatAssistantFieldDate("2026-10-15Tgarbage"))
        assertNull(formatAssistantFieldDate("Tgarbage"))

        // Ambiguous numeric seconds must be rejected rather than converted
        assertNull(formatAssistantFieldDate(1791907200L))
        assertNull(formatAssistantFieldDate("1791907200"))

        // JSONObject.NULL, null, blank, and non-integer values must be rejected
        assertNull(formatAssistantFieldDate(null))
        assertNull(formatAssistantFieldDate(JSONObject.NULL))
        assertNull(formatAssistantFieldDate(""))
        assertNull(formatAssistantFieldDate(1791907200000.5))
        assertNull(formatAssistantFieldDate("1791907200000.5"))
        assertNull(formatAssistantFieldDate(123.45))
        assertNull(formatAssistantFieldDate("123.45"))
        assertNull(formatAssistantFieldDate(0L))
        assertNull(formatAssistantFieldDate(-100L))
        assertNull(formatAssistantFieldDate(12345L)) // Out-of-range epoch (< 100_000_000_000L)
        assertNull(formatAssistantFieldDate("invalid-date"))
    }

    @Test
    fun formatAssistantFieldMoneyFormatsExplicitCurrencyUnit() {
        assertEquals("¥86.00", formatAssistantFieldMoney(8600L))
        assertEquals("¥86.00", formatAssistantFieldMoney("8600"))
        assertEquals("¥0.00", formatAssistantFieldMoney(0L))
        assertEquals("-¥13.50", formatAssistantFieldMoney(-1350L))
        assertNull(formatAssistantFieldMoney("invalid"))
        assertNull(formatAssistantFieldMoney(null))
    }

    @Test
    fun formatAssistantFieldTypeFormatsEnumValuesCorrectly() {
        assertEquals("支出", formatAssistantFieldType(0))
        assertEquals("支出", formatAssistantFieldType("0"))
        assertEquals("支出", formatAssistantFieldType("expense"))

        assertEquals("收入", formatAssistantFieldType(1))
        assertEquals("收入", formatAssistantFieldType("1"))
        assertEquals("收入", formatAssistantFieldType("income"))

        assertEquals("转账", formatAssistantFieldType(2))
        assertEquals("转账", formatAssistantFieldType("2"))
        assertEquals("转账", formatAssistantFieldType("transfer"))

        assertNull(formatAssistantFieldType(99))
        assertNull(formatAssistantFieldType("unknown"))
        assertNull(formatAssistantFieldType(null))
    }

    @Test
    fun formatSafeSummaryFieldsFormatsReviewScreenFactFieldsAccurately() {
        // Matches the observed review screen bug: type=0, amountCents=8600, date=1791907200000
        val input = JSONObject()
            .put("type", 0)
            .put("amountCents", 8600L)
            .put("date", 1791907200000L)
            .put("note", "大米先生充值")
            .put("transactionId", "raw-tx-uuid-1234") // Should be excluded

        val expectedDate = dateInput(1791907200000L)
        val fields = formatSafeSummaryFields(input).toMap()
        assertEquals("支出", fields["类型"])
        assertEquals("¥86.00", fields["金额"])
        assertEquals(expectedDate, fields["日期"])
        assertEquals("大米先生充值", fields["备注"])
        assertFalse(fields.containsKey("transactionId"))
        assertFalse(fields.containsKey("ID"))
    }

    @Test
    fun formatSafeSummaryFieldsSkipsSensitiveAndIdParentObjectsBeforeRecursion() {
        val input = JSONObject()
            .put("name", "正常名称")
            .put("secretCredentials", JSONObject().put("note", "leaked-secret-note").put("name", "leaked-secret-name"))
            .put("passwordInfo", JSONObject().put("note", "leaked-password-note"))
            .put("categoryIds", JSONObject().put("note", "leaked-ids-note"))
            .put("transactionId", JSONObject().put("note", "leaked-id-note"))

        val fields = formatSafeSummaryFields(input).toMap()
        assertEquals("正常名称", fields["名称"])
        assertFalse(fields.containsValue("leaked-secret-note"))
        assertFalse(fields.containsValue("leaked-secret-name"))
        assertFalse(fields.containsValue("leaked-password-note"))
        assertFalse(fields.containsValue("leaked-ids-note"))
        assertFalse(fields.containsValue("leaked-id-note"))
    }

    @Test
    fun formatOperationDetailsRetainsReferenceChangesWhileSuppressingSecretsAndFormattingData() {
        val input = JSONObject()
            .put("type", 0)
            .put("amountCents", 1500L)
            .put("plannedDate", 1791907200000L)
            .put("categoryId", "cat-food-123")
            .put("accountId", "acc-cmb-456")
            .put("parentId", "parent-789")
            .put("before", JSONObject().put("categoryId", "cat-old").put("amountCents", 1000L))
            .put("after", JSONObject().put("categoryId", "cat-new").put("amountCents", 1500L))
            .put("secret", "must-not-leak")
            .put("apiKey", "key-must-not-leak")
            .put("password", "pwd-must-not-leak")
            .put("sha256", "hash-must-not-leak")

        val expectedDate = dateInput(1791907200000L)
        val details = formatOperationDetails(input)

        // Reference fields and before/after changes must be preserved for confirmation inspection
        assertTrue(details.any { it == "categoryId：cat-food-123" })
        assertTrue(details.any { it == "accountId：acc-cmb-456" })
        assertTrue(details.any { it == "parentId：parent-789" })
        assertTrue(details.any { it == "before.categoryId：cat-old" })
        assertTrue(details.any { it == "after.categoryId：cat-new" })

        // Data formatting: dates, money, and types
        assertTrue(details.any { it == "type：支出" })
        assertTrue(details.any { it == "amountCents：¥15.00" })
        assertTrue(details.any { it == "before.amountCents：¥10.00" })
        assertTrue(details.any { it == "after.amountCents：¥15.00" })
        assertTrue(details.any { it == "plannedDate：$expectedDate" })

        // Secrets, keys, and hashes must remain suppressed
        assertFalse(details.any { it.contains("must-not-leak") })
        assertFalse(details.any { it.startsWith("secret") })
        assertFalse(details.any { it.startsWith("apiKey") })
        assertFalse(details.any { it.startsWith("password") })
        assertFalse(details.any { it.startsWith("sha256") })
    }

    @Test
    fun buildAssistantMergedItemsMergesHistoryUserValidatedAndProvisionalSeamlessly() {
        val historyMsg1 = JSONObject().put("id", "msg_h1").put("role", "user").put("content", JSONObject().put("text", "早安"))
        val historyMsg2 = JSONObject().put("id", "msg_h2").put("role", "assistant").put("content", JSONObject().put("text", "早！"))

        val userMsg = JSONObject().put("id", "msg_u3").put("role", "user").put("content", JSONObject().put("text", "午餐35元"))
        val valMsg = JSONObject().put("id", "msg_p1").put("role", "assistant").put("content", JSONObject().put("text", "已为您生成午餐记账卡片"))

        val prov1 = StreamProvisionalMessage(messageId = "msg_p1", step = 0, text = "正在生成午餐记账...", validated = false)
        val prov2 = StreamProvisionalMessage(messageId = "msg_p2", step = 1, text = "请问是否需要备注？", validated = false)

        val activeGen = ActiveGenerationState(
            generationId = "gen_1",
            clientRequestId = "req_1",
            conversationId = "conv_1",
            userMessage = userMsg,
            validatedMessages = mapOf("msg_p1" to valMsg),
            provisionalMessages = mapOf("msg_p1" to prov1, "msg_p2" to prov2),
            visualState = StreamVisualState.RECEIVING,
        )

        val items = buildAssistantMergedItems(listOf(historyMsg1, historyMsg2), activeGen)

        // msg_h1, msg_h2, msg_u3, msg_p1 (validated), msg_p2 (provisional)
        // msg_p1 provisional must be replaced by msg_p1 validated!
        assertEquals(5, items.size)
        assertTrue(items[0] is AssistantMergedItem.Message && (items[0] as AssistantMergedItem.Message).message.optString("id") == "msg_h1")
        assertTrue(items[1] is AssistantMergedItem.Message && (items[1] as AssistantMergedItem.Message).message.optString("id") == "msg_h2")
        assertTrue(items[2] is AssistantMergedItem.Message && (items[2] as AssistantMergedItem.Message).message.optString("id") == "msg_u3")
        assertTrue(items[3] is AssistantMergedItem.Message && (items[3] as AssistantMergedItem.Message).message.optString("id") == "msg_p1")
        assertTrue(items[4] is AssistantMergedItem.ProvisionalBubble && (items[4] as AssistantMergedItem.ProvisionalBubble).messageId == "msg_p2")
    }

    @Test
    fun buildAssistantMergedItemsRendersVisualStatusCardsAppropriately() {
        val activeGenAnswered = ActiveGenerationState(
            generationId = "gen_ans",
            clientRequestId = "req_1",
            conversationId = "conv_1",
            status = "completed",
            outcome = "answer",
            visualState = StreamVisualState.ANSWERED,
        )
        val itemsAnswered = buildAssistantMergedItems(emptyList(), activeGenAnswered)
        assertEquals(1, itemsAnswered.size)
        assertTrue(itemsAnswered[0] is AssistantMergedItem.AnsweredSignal)

        val activeGenFailed = ActiveGenerationState(
            generationId = "gen_fail",
            clientRequestId = "req_1",
            conversationId = "conv_1",
            status = "failed",
            error = GenerationError("AI_TIMEOUT", "超时"),
            visualState = StreamVisualState.FAILED,
        )
        val itemsFailed = buildAssistantMergedItems(emptyList(), activeGenFailed)
        assertEquals(1, itemsFailed.size)
        assertTrue(itemsFailed[0] is AssistantMergedItem.FailureAlert)
        assertEquals("AI_TIMEOUT", (itemsFailed[0] as AssistantMergedItem.FailureAlert).error?.code)

        val activeGenCancelled = ActiveGenerationState(
            generationId = "gen_cancel",
            clientRequestId = "req_1",
            conversationId = "conv_1",
            status = "cancelled",
            visualState = StreamVisualState.CANCELLED,
        )
        val itemsCancelled = buildAssistantMergedItems(emptyList(), activeGenCancelled)
        assertEquals(1, itemsCancelled.size)
        assertTrue(itemsCancelled[0] is AssistantMergedItem.CancelledAlert)

        val activeGenReconcile = ActiveGenerationState(
            generationId = "gen_rec",
            clientRequestId = "req_1",
            conversationId = "conv_1",
            status = "interrupted",
            visualState = StreamVisualState.RECONCILE,
        )
        val itemsReconcile = buildAssistantMergedItems(emptyList(), activeGenReconcile)
        assertEquals(1, itemsReconcile.size)
        assertTrue(itemsReconcile[0] is AssistantMergedItem.ReconcileAlert)
    }

    @Test
    fun defect2_prefersAuthoritativeHistoryStatusAndSuppressesPendingFooterWhenConfirmedOrCancelled() {
        val actionId = "act_123"
        // Active generation snapshot cached with stale "pending" status and outcome "pending-confirmation"
        val cardJsonStale = JSONObject().put("actionId", actionId).put("status", "pending")
        val staleMsg = JSONObject().put("id", "msg_card_1").put("role", "assistant")
            .put("content", JSONObject().put("card", cardJsonStale))

        val activeGen = ActiveGenerationState(
            generationId = "gen_pending_1",
            clientRequestId = "req_1",
            conversationId = "conv_1",
            status = "completed",
            outcome = "pending-confirmation",
            visualState = StreamVisualState.PENDING_FINANCIAL_CONFIRM,
            validatedMessages = mapOf("msg_card_1" to staleMsg),
        )

        // Case A: History has the card confirmed
        val cardJsonConfirmed = JSONObject().put("actionId", actionId).put("status", "confirmed")
        val historyMsgConfirmed = JSONObject().put("id", "msg_card_1").put("role", "assistant")
            .put("generationId", "gen_pending_1")
            .put("content", JSONObject().put("card", cardJsonConfirmed))

        val itemsConfirmed = buildAssistantMergedItems(listOf(historyMsgConfirmed), activeGen)
        // 1 message item only, NO PendingFinancialNotice!
        assertEquals(1, itemsConfirmed.size)
        val msgItem = itemsConfirmed[0] as AssistantMergedItem.Message
        assertEquals("confirmed", msgItem.message.optJSONObject("content")?.optJSONObject("card")?.optString("status"))
        assertTrue(itemsConfirmed.none { it is AssistantMergedItem.PendingFinancialNotice })

        // Case B: History has the card cancelled
        val cardJsonCancelled = JSONObject().put("actionId", actionId).put("status", "cancelled")
        val historyMsgCancelled = JSONObject().put("id", "msg_card_1").put("role", "assistant")
            .put("generationId", "gen_pending_1")
            .put("content", JSONObject().put("card", cardJsonCancelled))

        val itemsCancelled = buildAssistantMergedItems(listOf(historyMsgCancelled), activeGen)
        assertEquals(1, itemsCancelled.size)
        val msgItemCancelled = itemsCancelled[0] as AssistantMergedItem.Message
        assertEquals("cancelled", msgItemCancelled.message.optJSONObject("content")?.optJSONObject("card")?.optString("status"))
        assertTrue(itemsCancelled.none { it is AssistantMergedItem.PendingFinancialNotice })

        // Case C: Truly pending card in history shows PendingFinancialNotice
        val historyMsgPending = JSONObject().put("id", "msg_card_1").put("role", "assistant")
            .put("generationId", "gen_pending_1")
            .put("content", JSONObject().put("card", cardJsonStale))

        val itemsPending = buildAssistantMergedItems(listOf(historyMsgPending), activeGen)
        assertEquals(2, itemsPending.size)
        assertTrue(itemsPending.any { it is AssistantMergedItem.PendingFinancialNotice })
    }

    @Test
    fun defect2_answeredSignalConsidersOnlyCurrentGenCardsNotAllHistorical() {
        // Historical message from a previous generation contains a card
        val oldHistoryCard = JSONObject().put("id", "msg_old").put("generationId", "gen_old")
            .put("content", JSONObject().put("card", JSONObject().put("actionId", "act_old").put("status", "confirmed")))

        // Current generation completed with outcome="answer" and NO cards
        val activeGenAnswerOnly = ActiveGenerationState(
            generationId = "gen_current",
            clientRequestId = "req_curr",
            conversationId = "conv_1",
            status = "completed",
            outcome = "answer",
            visualState = StreamVisualState.ANSWERED,
            validatedMessages = mapOf(
                "msg_reply" to JSONObject().put("id", "msg_reply").put("content", JSONObject().put("text", "这是回答"))
            ),
        )

        val items = buildAssistantMergedItems(listOf(oldHistoryCard), activeGenAnswerOnly)
        // Must contain AnsweredSignal because the card belonged to gen_old, NOT gen_current!
        assertTrue(items.any { it is AssistantMergedItem.AnsweredSignal })

        // But if current generation DID produce a card, AnsweredSignal must be suppressed
        val currentCardMsg = JSONObject().put("id", "msg_curr_card").put("generationId", "gen_current")
            .put("content", JSONObject().put("card", JSONObject().put("actionId", "act_curr").put("status", "pending")))
        val activeGenWithCard = activeGenAnswerOnly.copy(
            validatedMessages = mapOf("msg_curr_card" to currentCardMsg),
        )
        val itemsWithCard = buildAssistantMergedItems(listOf(oldHistoryCard), activeGenWithCard)
        assertTrue(itemsWithCard.none { it is AssistantMergedItem.AnsweredSignal })
    }

    @Test
    fun defect1_streamEofReconciliationHelperWorksCorrectly() {
        val runningState = ActiveGenerationState(
            generationId = "gen_1",
            clientRequestId = "req_1",
            conversationId = "conv_1",
            status = "running",
            visualState = StreamVisualState.RECEIVING,
        )
        assertTrue(shouldReconcileAfterStreamEof(runningState))

        val completedState = runningState.copy(status = "completed", visualState = StreamVisualState.ANSWERED)
        assertFalse(shouldReconcileAfterStreamEof(completedState))

        // Normal EOF with available snapshot
        val snap = createTestSnapshot(
            id = "gen_1",
            conversationId = "conv_1",
            status = "completed",
            outcome = "answer",
            lastSeq = 10L,
            delivery = "stream",
        )
        val reconciled = reconcileStreamCompletion(runningState, snap)
        assertEquals("completed", reconciled.status)
        assertEquals("answer", reconciled.outcome)
        assertEquals(StreamVisualState.ANSWERED, reconciled.visualState)
        assertFalse(reconciled.requiresReconcile)

        // Normal EOF with failed GET snapshot (null) marks for reconcile rather than hanging running forever
        val failedReconciled = reconcileStreamCompletion(runningState, null)
        assertTrue(failedReconciled.requiresReconcile)
        assertEquals(StreamVisualState.RECONCILE, failedReconciled.visualState)
    }

    @Test
    fun defect3_stopAndReconnectRaceHelpersPreserveLiveState() {
        val initialGen = ActiveGenerationState(
            generationId = "gen_stop",
            clientRequestId = "req_1",
            conversationId = "conv_1",
            status = "running",
            lastSeq = 1L,
            visualState = StreamVisualState.RECEIVING,
        )
        // While stop request was in-flight, live deltas arrived!
        val liveGenWithDeltas = initialGen.copy(
            lastSeq = 5L,
            provisionalMessages = mapOf(
                "p1" to StreamProvisionalMessage("p1", 0, "中间到达的文本", false)
            ),
        )

        val cancelledSnapshot = createTestSnapshot(
            id = "gen_stop",
            conversationId = "conv_1",
            status = "cancelled",
            lastSeq = 5L,
            delivery = "stream",
            partialMessages = listOf(
                com.yansuu1.jizhang.repo.PartialMessage("p1", 0, "中间到达的文本", false)
            ),
        )

        // Reconciling stop success against live generation retains in-flight provisional text
        val result = reconcileStopSuccess(liveGenWithDeltas, "gen_stop", cancelledSnapshot)
        assertNotNull(result)
        assertEquals("cancelled", result?.status)
        assertEquals(StreamVisualState.CANCELLED, result?.visualState)
        assertEquals("中间到达的文本", result?.provisionalMessages?.get("p1")?.text)

        // If liveGen has advanced past snapshot lastSeq (liveGen.lastSeq = 5, snapshot.lastSeq = 4),
        // reconciling against liveGen rejects the stale snapshot, whereas reconciling against captured initialGen (lastSeq = 1)
        // would have erroneously accepted the stale snapshot!
        val staleSnapshot = createTestSnapshot(
            id = "gen_stop",
            conversationId = "conv_1",
            status = "cancelled",
            lastSeq = 4L,
        )
        val rejectedStaleResult = reconcileStopSuccess(liveGenWithDeltas, "gen_stop", staleSnapshot)
        assertEquals(5L, rejectedStaleResult?.lastSeq) // Live state preserved

        // If generation changed while stop was in-flight, rejects stale state update
        val mismatchedResult = reconcileStopSuccess(liveGenWithDeltas, "gen_DIFFERENT", cancelledSnapshot)
        assertNull(mismatchedResult)

        // Stop failure marks live generation as requiring reconcile to prevent duplicate actions
        val failureResult = reconcileStopFailure(liveGenWithDeltas, "gen_stop")
        assertNotNull(failureResult)
        assertTrue(failureResult!!.requiresReconcile)
        assertEquals(StreamVisualState.RECONCILE, failureResult.visualState)
    }

    @Test
    fun defect4_failureAlertMapsCodesSafelyAndSuppressesRawMessages() {
        assertEquals(
            "流式事件超出安全大小或长度限制，请精简提问或分步交互。",
            formatAssistantErrorMessage("ASSISTANT_STREAM_BOUNDS")
        )
        assertEquals(
            "流式响应单行数据超出安全上限，请重试。",
            formatAssistantErrorMessage("SSE_LINE_OVERSIZED")
        )
        assertEquals(
            "流式响应单事件数据超出安全上限，请重试。",
            formatAssistantErrorMessage("SSE_EVENT_OVERSIZED")
        )
        assertEquals(
            "流式响应总数据量超出安全上限，请重试。",
            formatAssistantErrorMessage("SSE_TOTAL_OVERSIZED")
        )
        assertEquals(
            "流式响应包含非法字符编码，请重试。",
            formatAssistantErrorMessage("SSE_CORRUPT_UTF8")
        )
        // Unknown codes map safely without leaking arbitrary server text
        assertEquals(
            "助手暂时无法处理请求，请稍后重试。",
            formatAssistantErrorMessage("UNRECOGNIZED_ARBITRARY_EXCEPTION_MESSAGE")
        )
    }

    @Test
    fun defect5_choiceLockingRetryAndErrorHandlingRules() {
        val choiceState = ActiveGenerationState(
            generationId = "gen_choice",
            clientRequestId = "req_1",
            conversationId = "conv_1",
            status = "completed",
            outcome = "awaiting-choice",
            visualState = StreamVisualState.AWAITING_CHOICE,
            selectedOptionId = "opt_A",
            pendingChoiceRequestId = "choice_req_123",
        )

        // Locked to opt_A: cannot select different option opt_B
        assertFalse(canSelectChoiceOption(choiceState, "opt_B"))
        // But CAN re-select opt_A for explicit retry of same attempt
        assertTrue(canSelectChoiceOption(choiceState, "opt_A"))

        // Error handling:
        // Deterministic 400 Bad Request or 422 Unprocessable can unlock
        assertTrue(shouldUnlockChoiceOnError(ApiException(400, "BAD_REQUEST", "Bad request")))
        assertTrue(shouldUnlockChoiceOnError(ApiException(422, "UNPROCESSABLE", "Unprocessable")))

        // 409 ASSISTANT_GENERATION_ACTIVE and ASSISTANT_REQUEST_CONFLICT MUST NOT unlock choice
        assertFalse(shouldUnlockChoiceOnError(ApiException(409, "ASSISTANT_GENERATION_ACTIVE", "Active generation running")))
        assertFalse(shouldUnlockChoiceOnError(ApiException(409, "ASSISTANT_REQUEST_CONFLICT", "Request conflict")))
        // But 409 ASSISTANT_CHOICE_STALE can unlock
        assertTrue(shouldUnlockChoiceOnError(ApiException(409, "ASSISTANT_CHOICE_STALE", "Stale choice")))

        // Timeouts (408), rate limits (429), 5xx server errors, and network exceptions MUST NOT unlock
        assertFalse(shouldUnlockChoiceOnError(ApiException(408, "TIMEOUT", "Timeout")))
        assertFalse(shouldUnlockChoiceOnError(ApiException(429, "RATE_LIMIT", "Too many requests")))
        assertFalse(shouldUnlockChoiceOnError(ApiException(500, "SERVER_ERROR", "Internal server error")))
        assertFalse(shouldUnlockChoiceOnError(ApiException(503, "UNAVAILABLE", "Service unavailable")))
        assertFalse(shouldUnlockChoiceOnError(java.io.IOException("Socket timeout")))
    }

    @Test
    fun defect6_geometryScrollAtBottomAccurateCalculations() {
        // 1. Empty list is at bottom
        assertTrue(isGeometryAtBottom(emptyList(), viewportEndOffset = 800, totalCount = 0))

        // 2. Normal list scrolled to bottom
        val normalItems = listOf(
            ScrollItemGeometry(index = 0, offset = 0, size = 200),
            ScrollItemGeometry(index = 1, offset = 200, size = 300),
            ScrollItemGeometry(index = 2, offset = 500, size = 250), // bottom = 750 <= 800
        )
        assertTrue(isGeometryAtBottom(normalItems, viewportEndOffset = 800, totalCount = 3))

        // 3. Giant bubble: top is visible at offset 0, but height is 2000px in an 800px viewport!
        // index == totalCount - 1, but bottom = 2000 > 800! NOT at bottom!
        val giantBubbleItems = listOf(
            ScrollItemGeometry(index = 0, offset = 0, size = 2000)
        )
        assertFalse(isGeometryAtBottom(giantBubbleItems, viewportEndOffset = 800, totalCount = 1))

        // 4. Giant bubble scrolled all the way to its bottom:
        // top is at -1250, size is 2000 => bottom = 750 <= 800! Truly at bottom!
        val giantBubbleScrolled = listOf(
            ScrollItemGeometry(index = 0, offset = -1250, size = 2000)
        )
        assertTrue(isGeometryAtBottom(giantBubbleScrolled, viewportEndOffset = 800, totalCount = 1))

        // 5. User actively dragging/scrolling suppresses auto-bottom
        assertTrue(isGeometryAtBottom(normalItems, viewportEndOffset = 800, totalCount = 3, isScrollInProgress = false))
        assertFalse(isGeometryAtBottom(normalItems, viewportEndOffset = 800, totalCount = 3, isScrollInProgress = true))

        // 6. Last item not yet at bottom of list
        val scrolledUp = listOf(
            ScrollItemGeometry(index = 0, offset = 0, size = 200),
            ScrollItemGeometry(index = 1, offset = 200, size = 300),
        )
        assertFalse(isGeometryAtBottom(scrolledUp, viewportEndOffset = 800, totalCount = 5))
    }

    @Test
    fun buildAssistantMergedItemsProducesProvisionalBubbleEvenWhenProvisionalsEmptyDuringConnectingOrReceiving() {
        val connectingGen = ActiveGenerationState(
            generationId = "gen_conn_1",
            clientRequestId = "req_c1",
            conversationId = "conv_1",
            status = "accepted",
            visualState = StreamVisualState.CONNECTING,
            provisionalMessages = emptyMap(),
        )
        val itemsConnecting = buildAssistantMergedItems(emptyList(), connectingGen)
        assertEquals(1, itemsConnecting.size)
        assertTrue(itemsConnecting[0] is AssistantMergedItem.ProvisionalBubble)
        val bubbleConn = itemsConnecting[0] as AssistantMergedItem.ProvisionalBubble
        assertEquals("provisional_gen_conn_1", bubbleConn.messageId)
        assertEquals("", bubbleConn.text)

        val receivingGen = ActiveGenerationState(
            generationId = "gen_recv_2",
            clientRequestId = "req_r2",
            conversationId = "conv_1",
            status = "running",
            visualState = StreamVisualState.RECEIVING,
            provisionalMessages = emptyMap(),
        )
        val itemsReceiving = buildAssistantMergedItems(emptyList(), receivingGen)
        assertEquals(1, itemsReceiving.size)
        assertTrue(itemsReceiving[0] is AssistantMergedItem.ProvisionalBubble)
        val bubbleRecv = itemsReceiving[0] as AssistantMergedItem.ProvisionalBubble
        assertEquals("provisional_gen_recv_2", bubbleRecv.messageId)
        assertEquals("", bubbleRecv.text)
    }

    @Test
    fun shouldClearNewMessagesAvailableWhenAtBottomAndNotScrolling() {
        // 1. Truly at bottom and user not dragging -> clears
        assertTrue(shouldClearNewMessagesAvailable(isAtBottom = true, isScrollInProgress = false))
        assertTrue(shouldClearNewMessagesAvailable(hasNewMessages = true, isAtBottom = true, isScrollInProgress = false))

        // 2. Truly at bottom but user is actively dragging/scrolling -> preserves indicator
        assertFalse(shouldClearNewMessagesAvailable(isAtBottom = true, isScrollInProgress = true))
        assertFalse(shouldClearNewMessagesAvailable(hasNewMessages = true, isAtBottom = true, isScrollInProgress = true))

        // 3. Not at bottom and not scrolling -> preserves indicator
        assertFalse(shouldClearNewMessagesAvailable(isAtBottom = false, isScrollInProgress = false))
        assertFalse(shouldClearNewMessagesAvailable(hasNewMessages = true, isAtBottom = false, isScrollInProgress = false))

        // 4. Not at bottom and user scrolling -> preserves indicator
        assertFalse(shouldClearNewMessagesAvailable(isAtBottom = false, isScrollInProgress = true))
        assertFalse(shouldClearNewMessagesAvailable(hasNewMessages = true, isAtBottom = false, isScrollInProgress = true))

        // 5. No new messages -> false regardless
        assertFalse(shouldClearNewMessagesAvailable(hasNewMessages = false, isAtBottom = true, isScrollInProgress = false))
    }

    @Test
    fun testSnapshotFlowEmitsWhenNewMessagesAvailableChangesWithUnchangedGeometry() = runBlocking {
        var newMessagesAvailable by mutableStateOf(false)
        var isAtBottom by mutableStateOf(true)
        var isScrollInProgress by mutableStateOf(false)

        val emissions = mutableListOf<Triple<Boolean, Boolean, Boolean>>()
        val job = launch {
            snapshotFlow {
                Triple(newMessagesAvailable, isAtBottom, isScrollInProgress)
            }.collect {
                emissions.add(it)
            }
        }

        // Give the coroutine a tick to emit the initial state
        kotlinx.coroutines.yield()
        assertEquals(1, emissions.size)
        assertEquals(Triple(false, true, false), emissions.first())

        // Geometry stays exactly the same, but newMessagesAvailable flips false -> true
        Snapshot.withMutableSnapshot {
            newMessagesAvailable = true
        }
        Snapshot.sendApplyNotifications()
        kotlinx.coroutines.yield()

        assertEquals(2, emissions.size)
        assertEquals(Triple(true, true, false), emissions[1])

        // Verify the helper decision on this emission triggers clearing
        val (hasNew, atBottom, isScrolling) = emissions.last()
        assertTrue(hasNew)
        assertTrue(shouldClearNewMessagesAvailable(atBottom, isScrolling))
        assertTrue(shouldClearNewMessagesAvailable(hasNew, atBottom, isScrolling))

        job.cancel()
    }

    @Test
    fun testContrastOldPairVersusNewTripleOnPendingStateChange() = runBlocking {
        var newMessagesAvailable by mutableStateOf(false)
        var isAtBottom by mutableStateOf(true)
        var isScrollInProgress by mutableStateOf(false)

        val oldPairEmissions = mutableListOf<Pair<Boolean, Boolean>>()
        val newTripleEmissions = mutableListOf<Triple<Boolean, Boolean, Boolean>>()

        val jobOld = launch {
            snapshotFlow {
                isAtBottom to isScrollInProgress
            }.collect { oldPairEmissions.add(it) }
        }
        val jobNew = launch {
            snapshotFlow {
                Triple(newMessagesAvailable, isAtBottom, isScrollInProgress)
            }.collect { newTripleEmissions.add(it) }
        }

        kotlinx.coroutines.yield()
        assertEquals(1, oldPairEmissions.size)
        assertEquals(1, newTripleEmissions.size)

        // Geometry stays unchanged (true, false), but newMessagesAvailable changes false -> true
        Snapshot.withMutableSnapshot {
            newMessagesAvailable = true
        }
        Snapshot.sendApplyNotifications()
        kotlinx.coroutines.yield()

        // Old Pair: geometry unchanged, so snapshotFlow suppressed emission (size stays 1)
        assertEquals(1, oldPairEmissions.size)

        // New Triple: observes newMessagesAvailable change, so snapshotFlow emitted (size is 2)
        assertEquals(2, newTripleEmissions.size)
        assertEquals(Triple(true, true, false), newTripleEmissions[1])

        jobOld.cancel()
        jobNew.cancel()
    }
}


