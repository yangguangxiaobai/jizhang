package com.yansuu1.jizhang.ui.feature.assistant

import com.yansuu1.jizhang.net.ApiException
import com.yansuu1.jizhang.repo.Clarification
import com.yansuu1.jizhang.repo.GenerationError
import com.yansuu1.jizhang.repo.GenerationSnapshot
import com.yansuu1.jizhang.ui.dateInput
import com.yansuu1.jizhang.ui.formatYuan
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeParseException
import org.json.JSONArray
import org.json.JSONObject

/**
 * Pure helper for Assistant conversation rendering, progress lifecycle filtering,
 * safe error code resolution, and summary/operation-detail formatting.
 */

enum class AssistantProgressDisplayState {
    RUNNING,
    FAILED,
    COMPLETE,
    UNKNOWN,
}

fun resolveProgressDisplayState(state: String?): AssistantProgressDisplayState {
    return when (state?.trim()) {
        "running" -> AssistantProgressDisplayState.RUNNING
        "failed" -> AssistantProgressDisplayState.FAILED
        "complete" -> AssistantProgressDisplayState.COMPLETE
        else -> AssistantProgressDisplayState.UNKNOWN
    }
}

/**
 * Historical complete progress only means backend processing ended, not that a transaction
 * was saved or succeeded. Hides completed progress without substantive payload from crowding
 * historical chat, while never hiding actual errors, cards, results, or running states.
 */
fun isHistoricalCompleteProgress(message: JSONObject): Boolean {
    val kind = message.optString("kind")
    val content = message.optJSONObject("content")
    val progress = content?.optJSONObject("progress")
    val state = progress?.optString("state")

    if (state != "complete") return false

    // Never hide messages containing errors
    if (kind == "error" || content.optJSONObject("error") != null) return false

    // Never hide messages with cards, results, or attachments
    if (content.optJSONObject("card") != null) return false
    if (content.optJSONObject("result") != null) return false
    if (content.optJSONObject("attachment") != null) return false

    // Never hide if there is non-blank conversational text
    val text = content.optString("text").orEmpty().trim()
    if (text.isNotBlank()) return false

    return true
}

/**
 * Filter messages to be displayed in LazyColumn. Preserves original item order, keys,
 * and leaves the raw message list for parent workflow/confirmation state lookups untouched.
 */
fun filterVisibleAssistantMessages(messages: List<JSONObject>): List<JSONObject> {
    return messages.filterNot { isHistoricalCompleteProgress(it) }
}

/**
 * Check if a message is purely a progress status indicator (no text, card, result, or error).
 */
fun isProgressOnlyMessage(message: JSONObject): Boolean {
    val kind = message.optString("kind")
    val content = message.optJSONObject("content")
    val hasCard = content?.optJSONObject("card") != null
    val hasResult = content?.optJSONObject("result") != null
    val hasAttachment = content?.optJSONObject("attachment") != null
    val hasText = content?.optString("text").orEmpty().trim().isNotEmpty()
    val hasError = content?.optJSONObject("error") != null || kind == "error"

    if (hasCard || hasResult || hasAttachment || hasText || hasError) return false
    return kind == "progress" || content?.optJSONObject("progress") != null
}

fun getProgressState(message: JSONObject): String? {
    val progress = message.optJSONObject("content")?.optJSONObject("progress") ?: return null
    return progress.optString("state").takeIf { it.isNotBlank() }
}

/**
 * Safe code-based actionable errors (AI_PROVIDER_ERROR/TIMEOUT/RESPONSE_INVALID,
 * assistant invalid, config, etc.) with unknown generic fallback. Never leaks raw provider text.
 */
fun formatAssistantErrorMessage(code: String?): String {
    return when (code?.trim()) {
        "AI_PROVIDER_TIMEOUT" -> "AI 服务响应超时，请稍后重试。若持续发生，请检查服务地址与超时设置。"
        "AI_PROVIDER_ERROR" -> "暂时无法连接 AI 服务，请检查服务地址、网络和服务状态后重试。"
        "AI_NOT_CONFIGURED" -> "AI 服务尚未配置或已停用，请前往设置完成配置。"
        "AI_SECRET_UNAVAILABLE" -> "AI 密钥当前不可用，请前往设置重新保存密钥。"
        "AI_ENCRYPTION_KEY_REQUIRED" -> "服务器暂未启用 AI 密钥存储，请稍后重试或联系管理员。"
        "AI_RESPONSE_INVALID" -> "AI 服务返回内容无法识别，请检查模型配置后重试。"
        "AI_CONFIG_INVALID" -> "AI 配置无效，请检查服务地址、模型及高级请求设置。"
        "AI_INPUT_INVALID" -> "输入内容无效，请补充描述后重试。"
        "AI_ORGANIZATION_INVALID" -> "整理请求无效，请调整选择后重试。"
        "AI_ORGANIZATION_CONFLICT" -> "数据已发生变化，请刷新预览后重试。"
        "ASSISTANT_INVALID" -> "请求内容无效，请检查输入后重试。"
        "ASSISTANT_ACTION_STALE" -> "此操作已过期，请刷新对话后重新发起。"
        "ASSISTANT_ATTACHMENT_REQUIRED" -> "附件预览已失效，请重新附加原文件。"
        "ASSISTANT_NOT_FOUND" -> "对话或操作不存在，请刷新后重试。"
        "ASSISTANT_STREAM_BOUNDS" -> "流式事件超出安全大小或长度限制，请精简提问或分步交互。"
        "SSE_LINE_OVERSIZED" -> "流式响应单行数据超出安全上限，请重试。"
        "SSE_EVENT_OVERSIZED" -> "流式响应单事件数据超出安全上限，请重试。"
        "SSE_TOTAL_OVERSIZED" -> "流式响应总数据量超出安全上限，请重试。"
        "SSE_CORRUPT_UTF8" -> "流式响应包含非法字符编码，请重试。"
        else -> {
            if (code?.startsWith("AI_") == true) {
                "AI 服务暂时无法处理请求，请检查配置或稍后重试。"
            } else {
                "助手暂时无法处理请求，请稍后重试。"
            }
        }
    }
}

fun extractSafeErrorMessage(errorObject: JSONObject?, fallbackCode: String? = null): String {
    val code = errorObject?.optString("code")?.takeIf { it.isNotBlank() } ?: fallbackCode
    return formatAssistantErrorMessage(code)
}

/**
 * Format known date/plannedDate/anchorDate/periodStart fields via existing dateInput helper.
 * Strictly avoids inventing year/date if invalid, and rejects ambiguous numeric seconds,
 * non-integers, JSONObject.NULL, and malformed ISO calendar strings.
 */
fun formatAssistantFieldDate(raw: Any?): String? {
    if (raw == null || raw == JSONObject.NULL) return null

    // Reject non-integer numbers (Double, Float)
    if (raw is Double || raw is Float) return null

    if (raw is Number) {
        val epochMs = raw.toLong()
        // Reject ambiguous numeric seconds (< 100_000_000_000L = ~March 1973 in ms)
        if (epochMs < 100_000_000_000L) return null
        return try {
            Instant.ofEpochMilli(epochMs)
            dateInput(epochMs)
        } catch (_: Exception) {
            null
        }
    }

    val str = raw.toString().trim()
    if (str.isBlank()) return null

    // 1. Strict ISO local date (e.g. "2026-10-15")
    try {
        return LocalDate.parse(str).toString()
    } catch (_: DateTimeParseException) {
    }

    // 2. Strict ISO offset date-time (e.g. "2026-10-15T12:00:00Z", "2026-10-15T12:00:00+08:00")
    try {
        return OffsetDateTime.parse(str).toLocalDate().toString()
    } catch (_: DateTimeParseException) {
    }

    // 3. Strict ISO instant
    try {
        return Instant.parse(str).atZone(ZoneId.systemDefault()).toLocalDate().toString()
    } catch (_: DateTimeParseException) {
    }

    // 4. Strict ISO local date-time (e.g. "2026-10-15T12:00:00")
    try {
        return LocalDateTime.parse(str).toLocalDate().toString()
    } catch (_: DateTimeParseException) {
    }

    // 5. Space separator date-time (e.g. "2026-10-15 12:00:00")
    if (str.contains(' ') && !str.contains('T')) {
        try {
            return LocalDateTime.parse(str.replace(' ', 'T')).toLocalDate().toString()
        } catch (_: DateTimeParseException) {
        }
    }

    // Must be integer digits if numeric
    if (!str.matches(Regex("""^-?\d+$"""))) return null

    val epochMs = str.toLongOrNull() ?: return null
    if (epochMs < 100_000_000_000L) return null

    return try {
        Instant.ofEpochMilli(epochMs)
        dateInput(epochMs)
    } catch (_: Exception) {
        null
    }
}

/**
 * Money formatting showing explicit currency unit (¥).
 */
fun formatAssistantFieldMoney(raw: Any?): String? {
    if (raw == null || raw == JSONObject.NULL) return null
    if (raw is Double || raw is Float) return null
    val str = raw.toString().trim()
    if (!str.matches(Regex("""^-?\d+$"""))) return null
    val cents = str.toLongOrNull() ?: return null
    val formatted = formatYuan(cents)
    return if (formatted.startsWith("-")) "-¥${formatted.substring(1)}" else "¥$formatted"
}

/**
 * Transaction type enum formatting: 0/expense -> 支出, 1/income -> 收入, 2/transfer -> 转账.
 */
fun formatAssistantFieldType(raw: Any?): String? {
    if (raw == null || raw == JSONObject.NULL) return null
    return when (raw.toString().trim().lowercase()) {
        "0", "expense" -> "支出"
        "1", "income" -> "收入"
        "2", "transfer" -> "转账"
        else -> null
    }
}

fun isSensitiveDetailKey(key: String): Boolean {
    val lower = key.lowercase().trim()
    return lower in setOf("secret", "apikey", "token", "password", "filebase64", "sha256", "fingerprint", "hash", "md5") ||
        lower.contains("secret") || lower.contains("password") || lower.contains("token") || lower.contains("credential") || lower.contains("apikey")
}

fun isIgnoredSummaryKey(key: String): Boolean {
    val lower = key.lowercase().trim()
    return isSensitiveDetailKey(lower) ||
        lower in setOf("id", "ids") ||
        lower.endsWith("id") || lower.endsWith("ids")
}

/**
 * Safe summary fields for assistant result card.
 * Handles known date/plannedDate/anchorDate/periodStart fields, type enums, money units,
 * and filters raw IDs, secrets, and raw JSON strings.
 * Skips sensitive and ID parent object keys before recursion.
 */
fun formatSafeSummaryFields(value: JSONObject): List<Pair<String, String>> {
    val labels = mapOf(
        "name" to "名称",
        "note" to "备注",
        "amountCents" to "金额",
        "expenseCents" to "支出",
        "incomeCents" to "收入",
        "date" to "日期",
        "plannedDate" to "计划日期",
        "anchorDate" to "锚点日期",
        "periodStart" to "周期起点",
        "type" to "类型",
        "accountName" to "账户",
        "fromAccountName" to "转出账户",
        "toAccountName" to "转入账户",
        "categoryName" to "分类",
        "templateName" to "模板",
        "salaryCount" to "工资周期数",
        "source" to "来源",
        "total" to "总行数",
        "selected" to "已选行数",
        "count" to "数量",
        "inserted" to "新增",
        "skipped" to "跳过",
        "ignored" to "忽略",
    )
    val values = linkedMapOf<String, String>()
    fun visit(objectValue: JSONObject, depth: Int) {
        if (depth > 2 || values.size >= 6) return
        val keys = objectValue.keys()
        while (keys.hasNext() && values.size < 6) {
            val key = keys.next()
            // Skip sensitive and ID keys BEFORE summary recursion
            if (isIgnoredSummaryKey(key) || isSensitiveDetailKey(key)) continue

            val nested = objectValue.optJSONObject(key)
            if (nested != null) {
                visit(nested, depth + 1)
                continue
            }
            val label = labels[key] ?: continue
            val raw = objectValue.opt(key) ?: continue
            if (raw == JSONObject.NULL) continue
            val display = when {
                key == "type" -> formatAssistantFieldType(raw)
                key in setOf("date", "plannedDate", "anchorDate", "periodStart") || key.endsWith("Date") -> formatAssistantFieldDate(raw)
                key in setOf("amountCents", "expenseCents", "incomeCents") || key.endsWith("Cents") -> formatAssistantFieldMoney(raw)
                raw is String -> {
                    val trimmed = raw.trim()
                    if (trimmed.startsWith("{") || trimmed.startsWith("[")) null else trimmed.takeIf { it.isNotBlank() }
                }
                raw is Number -> raw.toString()
                raw is Boolean -> if (raw) "是" else "否"
                raw is JSONArray -> "${raw.length()} 项"
                else -> null
            } ?: continue
            if (display.isNotBlank()) values[label] = display
        }
    }
    visit(value, 0)
    return values.entries.map { it.key to it.value }
}

/**
 * Formats full operation details for values/preview.
 * Formats dates, money with currency units, type enums, and suppresses secrets and raw JSON strings.
 * Preserves essential reference identifiers (categoryId, accountId, parentId, *Ids) for confirmation.
 */
fun formatOperationDetails(value: JSONObject): List<String> {
    val lines = mutableListOf<String>()
    fun visit(raw: Any?, path: String) {
        when (raw) {
            is JSONObject -> {
                val keys = raw.keys()
                while (keys.hasNext()) {
                    val key = keys.next()
                    if (!isSensitiveDetailKey(key)) {
                        visit(raw.opt(key), if (path.isEmpty()) key else "$path.$key")
                    }
                }
            }
            is JSONArray -> {
                (0 until raw.length()).forEach { index ->
                    visit(raw.opt(index), "$path[${index + 1}]")
                }
            }
            null, JSONObject.NULL -> Unit
            else -> {
                if (path.isEmpty()) return
                val lastKey = path.substringAfterLast('.').substringBefore('[')
                if (isSensitiveDetailKey(lastKey)) return
                val formattedValue = when {
                    lastKey == "type" -> formatAssistantFieldType(raw) ?: raw.toString()
                    lastKey in setOf("date", "plannedDate", "anchorDate", "periodStart") || lastKey.endsWith("Date") ->
                        formatAssistantFieldDate(raw) ?: return
                    path.endsWith("Cents") -> formatAssistantFieldMoney(raw) ?: raw.toString()
                    raw is Boolean -> if (raw) "是" else "否"
                    raw is String -> {
                        val trimmed = raw.trim()
                        if (trimmed.startsWith("{") || trimmed.startsWith("[")) return
                        trimmed
                    }
                    else -> raw.toString()
                }
                lines += "$path：$formattedValue"
            }
        }
    }
    visit(value, "")
    return lines
}

/**
 * Layout geometry representation of a visible list item for pure, unit-testable scroll calculations.
 */
data class ScrollItemGeometry(
    val index: Int,
    val offset: Int,
    val size: Int,
)

fun shouldClearNewMessagesAvailable(
    isAtBottom: Boolean,
    isScrollInProgress: Boolean,
): Boolean {
    return isAtBottom && !isScrollInProgress
}

fun shouldClearNewMessagesAvailable(
    hasNewMessages: Boolean,
    isAtBottom: Boolean,
    isScrollInProgress: Boolean,
): Boolean {
    return hasNewMessages && isAtBottom && !isScrollInProgress
}

/**
 * Pure geometry helper to determine if the chat list is truly scrolled to the bottom.
 *
 * Avoids the false-positive bug where a giant item whose top is visible returns true
 * even though its bottom extends far below the viewport.
 *
 * Returns false if user is actively scrolling (!isScrollInProgress).
 * Returns true if the last item's bottom edge (offset + size) is <= viewportEndOffset + tolerancePx.
 */
fun isGeometryAtBottom(
    items: List<ScrollItemGeometry>,
    viewportEndOffset: Int,
    totalCount: Int,
    isScrollInProgress: Boolean = false,
    tolerancePx: Int = 4,
): Boolean {
    if (isScrollInProgress) return false
    if (totalCount == 0) return true
    if (items.isEmpty()) return false

    val lastItem = items.maxByOrNull { it.index } ?: return false
    if (lastItem.index < totalCount - 1) return false

    val itemBottom = lastItem.offset + lastItem.size
    return itemBottom <= viewportEndOffset + tolerancePx
}

/**
 * Unified display item model for Assistant chat LazyColumn.
 */
sealed class AssistantMergedItem {
    abstract val key: String

    data class Message(val message: JSONObject) : AssistantMergedItem() {
        override val key: String get() = message.optString("id").ifBlank { "msg_${message.hashCode()}" }
    }

    data class ProvisionalBubble(
        val messageId: String,
        val text: String,
    ) : AssistantMergedItem() {
        override val key: String get() = "provisional_$messageId"
    }

    data class LiveClarification(
        val clarification: Clarification,
        val selectedOptionId: String?,
    ) : AssistantMergedItem() {
        override val key: String get() = "live_clarification_${clarification.id}"
    }

    data class Connecting(val generationId: String) : AssistantMergedItem() {
        override val key: String get() = "connecting_$generationId"
    }

    data class AnsweredSignal(val generationId: String) : AssistantMergedItem() {
        override val key: String get() = "answered_signal_$generationId"
    }

    data class PendingFinancialNotice(val generationId: String) : AssistantMergedItem() {
        override val key: String get() = "pending_financial_$generationId"
    }

    data class FailureAlert(
        val generationId: String,
        val error: GenerationError?,
        val snippet: String,
    ) : AssistantMergedItem() {
        override val key: String get() = "failure_$generationId"
    }

    data class CancelledAlert(
        val generationId: String,
        val snippet: String,
    ) : AssistantMergedItem() {
        override val key: String get() = "cancelled_$generationId"
    }

    data class ReconcileAlert(
        val generationId: String,
        val snippet: String,
    ) : AssistantMergedItem() {
        override val key: String get() = "reconcile_$generationId"
    }
}

/**
 * Builds a single merged, ordered list of items for the chat UI.
 * Replaces provisional messages in place with matching validated messages by stable message ID.
 * Prevents answer/card vanishing before history reload completes.
 * Deduplicates accepted user message and choice cards.
 */
fun buildAssistantMergedItems(
    historicalMessages: List<JSONObject>,
    activeGen: ActiveGenerationState?,
): List<AssistantMergedItem> {
    val items = mutableListOf<AssistantMergedItem>()
    val renderedMessageIds = mutableSetOf<String>()
    val visibleHistory = filterVisibleAssistantMessages(historicalMessages)

    // Collect authoritative action statuses from history
    val historyActionStatuses = mutableMapOf<String, String>()
    for (msg in historicalMessages) {
        val card = msg.optJSONObject("content")?.optJSONObject("card")
        if (card != null) {
            val actionId = card.optString("actionId").trim()
            val status = card.optString("status").trim()
            if (actionId.isNotBlank() && status.isNotBlank()) {
                val existing = historyActionStatuses[actionId]
                // Prefer confirmed or cancelled over pending
                if (existing == null || existing == "pending") {
                    historyActionStatuses[actionId] = status
                }
            }
        }
    }

    for (msg in visibleHistory) {
        val id = msg.optString("id")
        if (id.isNotBlank()) renderedMessageIds.add(id)
        items.add(AssistantMergedItem.Message(msg))
    }

    if (activeGen != null) {
        // 1. Accepted user message
        val uMsg = activeGen.userMessage
        if (uMsg != null) {
            val uId = uMsg.optString("id")
            if (uId.isBlank() || uId !in renderedMessageIds) {
                if (uId.isNotBlank()) renderedMessageIds.add(uId)
                items.add(AssistantMergedItem.Message(uMsg))
            }
        }

        // 2. Validated messages produced by this generation.
        // Prefer authoritative history card status over cached snapshot to prevent resurrecting stale pending cards.
        for (vMsg in activeGen.validatedMessages.values) {
            val vId = vMsg.optString("id")
            if (vId.isBlank() || vId !in renderedMessageIds) {
                if (vId.isNotBlank()) renderedMessageIds.add(vId)
                val card = vMsg.optJSONObject("content")?.optJSONObject("card")
                val actionId = card?.optString("actionId").orEmpty().trim()
                val authStatus = historyActionStatuses[actionId]
                val effectiveMsg = if (card != null && authStatus != null && card.optString("status") != authStatus) {
                    val cloned = JSONObject(vMsg.toString())
                    cloned.optJSONObject("content")?.optJSONObject("card")?.put("status", authStatus)
                    cloned
                } else {
                    vMsg
                }
                items.add(AssistantMergedItem.Message(effectiveMsg))
            }
        }

        // 3. Provisional streaming messages (only if not yet replaced by validated message)
        val sortedProvisionals = activeGen.provisionalMessages.values.sortedBy { it.step }
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

        // Determine if current generation has an actual pending financial action,
        // rather than relying purely on immutable historical generation snapshot outcome.
        val currentGenCards = mutableListOf<JSONObject>()
        for (vMsg in activeGen.validatedMessages.values) {
            vMsg.optJSONObject("content")?.optJSONObject("card")?.let { currentGenCards.add(it) }
        }
        for (hMsg in historicalMessages) {
            val genId = hMsg.optString("generationId").ifBlank {
                hMsg.optJSONObject("content")?.optString("generationId").orEmpty()
            }
            if (genId == activeGen.generationId) {
                hMsg.optJSONObject("content")?.optJSONObject("card")?.let { currentGenCards.add(it) }
            }
        }

        val hasActualPendingAction = currentGenCards.any { card ->
            val actionId = card.optString("actionId").trim()
            val effectiveStatus = historyActionStatuses[actionId] ?: card.optString("status").trim()
            effectiveStatus == "pending"
        }

        val hasCurrentGenCard = currentGenCards.isNotEmpty()

        // 4. Visual state badges/footers/cards
        when (activeGen.visualState) {
            StreamVisualState.CONNECTING -> {
                if (effectiveProvisionals.isEmpty()) {
                    items.add(AssistantMergedItem.Connecting(activeGen.generationId))
                }
            }
            StreamVisualState.AWAITING_CHOICE -> {
                val clar = activeGen.clarification
                if (clar != null) {
                    items.add(AssistantMergedItem.LiveClarification(clar, activeGen.selectedOptionId))
                }
            }
            StreamVisualState.PENDING_FINANCIAL_CONFIRM -> {
                if (hasActualPendingAction) {
                    items.add(AssistantMergedItem.PendingFinancialNotice(activeGen.generationId))
                }
            }
            StreamVisualState.ANSWERED -> {
                if (activeGen.outcome == "answer" && !hasCurrentGenCard) {
                    items.add(AssistantMergedItem.AnsweredSignal(activeGen.generationId))
                }
            }
            StreamVisualState.FAILED -> {
                val snippet = activeGen.provisionalMessages.values.sortedBy { it.step }.joinToString("\n") { it.text }
                items.add(AssistantMergedItem.FailureAlert(activeGen.generationId, activeGen.error, snippet))
            }
            StreamVisualState.CANCELLED -> {
                val snippet = activeGen.provisionalMessages.values.sortedBy { it.step }.joinToString("\n") { it.text }
                items.add(AssistantMergedItem.CancelledAlert(activeGen.generationId, snippet))
            }
            StreamVisualState.RECONCILE -> {
                val snippet = activeGen.provisionalMessages.values.sortedBy { it.step }.joinToString("\n") { it.text }
                items.add(AssistantMergedItem.ReconcileAlert(activeGen.generationId, snippet))
            }
            StreamVisualState.RECEIVING -> {
                // Handled above via ProvisionalBubble
            }
        }
    }

    return items
}

/**
 * Checks whether an active generation requires reconciliation after stream collection
 * ends normally without encountering a terminal event.
 */
fun shouldReconcileAfterStreamEof(state: ActiveGenerationState): Boolean {
    return state.status in listOf("accepted", "running")
}

/**
 * Reconciles state when a stream completes normally.
 * If snapshot is available, applies reconciled snapshot.
 * If snapshot is null or unavailable, marks for reconcile to avoid running forever.
 */
fun reconcileStreamCompletion(
    state: ActiveGenerationState,
    snapshot: GenerationSnapshot?,
): ActiveGenerationState {
    return if (snapshot != null) {
        AssistantStreamReducer.applyReconciledSnapshot(state, snapshot)
    } else {
        state.copy(
            requiresReconcile = true,
            visualState = StreamVisualState.RECONCILE,
        )
    }
}

/**
 * Production helper for reconciling stop success against live generation state.
 * Returns updated state, or null if the generation has been superseded.
 */
fun reconcileStopSuccess(
    liveGen: ActiveGenerationState?,
    targetGenerationId: String,
    cancelledSnapshot: GenerationSnapshot,
): ActiveGenerationState? {
    if (liveGen == null || liveGen.generationId != targetGenerationId) return null
    return AssistantStreamReducer.applyReconciledSnapshot(liveGen, cancelledSnapshot)
}

/**
 * Production helper for reconciling stop failure against live generation state.
 * Marks the live generation as requiring reconcile to prevent duplicate actions.
 */
fun reconcileStopFailure(
    liveGen: ActiveGenerationState?,
    targetGenerationId: String,
): ActiveGenerationState? {
    if (liveGen == null || liveGen.generationId != targetGenerationId) return null
    return liveGen.copy(
        requiresReconcile = true,
        visualState = StreamVisualState.RECONCILE,
    )
}

/**
 * Production helper for reconciling reconnect success against live generation state.
 */
fun reconcileReconnectSuccess(
    liveGen: ActiveGenerationState?,
    targetGenerationId: String,
    snapshot: GenerationSnapshot,
): ActiveGenerationState? {
    if (liveGen == null || liveGen.generationId != targetGenerationId) return null
    return AssistantStreamReducer.applyReconciledSnapshot(liveGen, snapshot)
}

/**
 * Determines whether a choice option can be clicked/selected.
 * If not locked, any option is selectable.
 * If locked, only the exact same option can be re-selected for explicit retry.
 */
fun canSelectChoiceOption(state: ActiveGenerationState, optionId: String): Boolean {
    val lockedOption = state.selectedOptionId
    return lockedOption == null || lockedOption == optionId
}

/**
 * Determines whether an error from createGeneration for a choice should unlock the choice selection.
 * Deterministic 4xx client errors (e.g. 400, 422) allow unlocking since the server rejected the choice.
 * Timeouts (408), rate limits (429), server errors (5xx), and network IO exceptions are unknown/in-flight,
 * and therefore MUST remain locked to permit only retry of the same attempt with the same requestId.
 */
fun shouldUnlockChoiceOnError(error: Throwable): Boolean {
    if (error is ApiException) {
        if (error.status == 409 && (error.code == "ASSISTANT_GENERATION_ACTIVE" || error.code == "ASSISTANT_REQUEST_CONFLICT")) {
            return false
        }
        return error.status in 400..499 && error.status != 408 && error.status != 429
    }
    return false
}
