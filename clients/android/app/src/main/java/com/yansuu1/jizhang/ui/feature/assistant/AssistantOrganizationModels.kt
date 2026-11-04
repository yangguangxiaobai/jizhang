package com.yansuu1.jizhang.ui.feature.assistant

import org.json.JSONArray
import org.json.JSONObject

/**
 * Wire models for the AI spending-organization run protocol.
 *
 * The server owns dates, eligible rows, category ids and the review fingerprint.
 * Android only renders those facts and submits the reviewed action ids; it never
 * derives a new transaction scope or rewrites a transaction payload itself.
 */
internal enum class OrganizationActionKind(val wire: String, val label: String) {
    CATEGORY("category", "分类调整"),
    TAG("tag", "标签调整"),
    CATEGORY_SUGGESTION("category-suggestion", "新建分类建议"),
    NOTE("note", "备注建议"),
    ;

    val selectable: Boolean get() = this == CATEGORY || this == TAG

    companion object {
        fun fromWire(value: String): OrganizationActionKind? = entries.firstOrNull { it.wire == value }
    }
}

internal data class OrganizationAction(
    val actionId: String,
    val kind: OrganizationActionKind,
    val transactionId: String?,
    val transactionDateLabel: String?,
    val transactionAmountCents: Long?,
    val transactionType: Int?,
    val beforeCategoryId: String?,
    val beforeCategoryName: String?,
    val afterCategoryId: String?,
    val afterCategoryName: String?,
    val beforeTags: List<String>,
    val afterTags: List<String>,
    val proposedCategoryName: String?,
    val proposedParentCategoryName: String?,
    val reason: String,
    val confidence: Double,
) {
    val selectable: Boolean get() = kind.selectable
}

internal data class OrganizationNoteSuggestion(
    val actionId: String,
    val transactionId: String,
    val transactionDateLabel: String?,
    val transactionAmountCents: Long?,
    val transactionType: Int?,
    val suggestedNote: String,
)

internal data class OrganizationRun(
    val runId: String,
    val status: String,
    val startDate: String,
    val endDate: String,
    val eligibleCount: Int,
    val completedCount: Int,
    val errorCode: String?,
    val createdAt: Long? = null,
    val updatedAt: Long? = null,
    val progress: OrganizationProgress? = null,
    val attempt: Int = 1,
    val canResume: Boolean = false,
) {
    val resumableTimeout: Boolean get() = status == "failed" && errorCode == "AI_PROVIDER_TIMEOUT" && canResume && attempt < 3
    val terminal: Boolean get() = status in setOf("ready", "failed", "cancelled")
    val canLoadCard: Boolean get() = status == "ready" && completedCount == eligibleCount
}

internal data class OrganizationProgressEvent(
    val seq: Int, val phase: String, val batch: Int,
    val completedCount: Int, val message: String, val at: Long,
)

internal data class OrganizationErrorDetail(val stage: String, val field: String?, val batch: Int)

internal data class OrganizationProgress(
    val phase: String,
    val totalBatches: Int,
    val completedBatches: Int,
    val currentBatch: Int,
    val suggestionCount: Int,
    val startedAt: Long,
    val updatedAt: Long,
    val events: List<OrganizationProgressEvent>,
    val errorDetail: OrganizationErrorDetail?,
)

internal data class OrganizationCard(
    val runId: String,
    val startDate: String,
    val endDate: String,
    val eligibleCount: Int,
    val completedCount: Int,
    val version: Long,
    val expiresAt: Long,
    val actions: List<OrganizationAction>,
    val noteSuggestions: List<OrganizationNoteSuggestion>,
    val templateProposalCount: Int,
) {
    val selectableActions: List<OrganizationAction> get() = actions.filter { it.selectable }
    val categoryActions: List<OrganizationAction> get() = actions.filter { it.kind == OrganizationActionKind.CATEGORY }
    val tagActions: List<OrganizationAction> get() = actions.filter { it.kind == OrganizationActionKind.TAG }
    val categorySuggestions: List<OrganizationAction>
        get() = actions.filter { it.kind == OrganizationActionKind.CATEGORY_SUGGESTION }
}

internal data class OrganizationApplyResult(
    val operationId: String,
    val status: String,
    val appliedActions: List<String>,
)

internal fun parseOrganizationRun(json: JSONObject): OrganizationRun {
    val status = json.requiredString("status")
    require(status in setOf("running", "ready", "failed", "cancelled")) {
        "未知的整理状态：$status"
    }
    return OrganizationRun(
        runId = json.requiredString("runId"),
        status = status,
        startDate = json.requiredString("startDate"),
        endDate = json.requiredString("endDate"),
        eligibleCount = json.requiredNonNegativeInt("eligibleCount"),
        completedCount = json.requiredNonNegativeInt("completedCount"),
        errorCode = json.optionalString("errorCode"),
        createdAt = json.optionalLong("createdAt"),
        updatedAt = json.optionalLong("updatedAt"),
        progress = if (!json.has("progress") || json.isNull("progress")) null else
            parseOrganizationProgress(json.getJSONObject("progress")),
        attempt = if (!json.has("attempt")) 1 else json.requiredNonNegativeInt("attempt").also {
            require(it >= 1) { "整理尝试次数无效。" }
        },
        canResume = if (!json.has("canResume")) false else json.get("canResume").let {
            require(it is Boolean) { "整理继续状态无效。" }
            it
        },
    ).also {
        require(it.completedCount <= it.eligibleCount) { "整理进度计数无效。" }
        require(it.status != "ready" || it.canLoadCard) { "整理尚未完整完成。" }
    }
}

private fun parseOrganizationProgress(json: JSONObject): OrganizationProgress {
    val array = json.getJSONArray("events")
    val events = (0 until array.length()).map { index ->
        val event = array.getJSONObject(index)
        OrganizationProgressEvent(
            event.requiredNonNegativeInt("seq"), event.requiredString("phase"),
            event.requiredNonNegativeInt("batch"), event.requiredNonNegativeInt("completedCount"),
            event.requiredString("message"), event.requiredLong("at"),
        )
    }
    require(events.zipWithNext().all { (a, b) -> b.seq > a.seq && b.completedCount >= a.completedCount }) {
        "整理事件顺序无效。"
    }
    val detail = if (json.isNull("errorDetail") || !json.has("errorDetail")) null else {
        val item = json.getJSONObject("errorDetail")
        OrganizationErrorDetail(item.requiredString("stage"), item.optionalString("field"), item.requiredNonNegativeInt("batch"))
    }
    return OrganizationProgress(
        json.requiredString("phase"), json.requiredNonNegativeInt("totalBatches"),
        json.requiredNonNegativeInt("completedBatches"), json.requiredNonNegativeInt("currentBatch"),
        json.requiredNonNegativeInt("suggestionCount"), json.requiredLong("startedAt"),
        json.requiredLong("updatedAt"), events, detail,
    ).also {
        require(it.completedBatches <= it.totalBatches && it.currentBatch <= it.totalBatches &&
            it.startedAt >= 0 && it.updatedAt >= it.startedAt) { "整理批次或时间无效。" }
    }
}

internal fun parseOrganizationCard(json: JSONObject): OrganizationCard {
    require(json.requiredString("status") == "ready") { "整理审查卡片尚未就绪。" }
    require(json.requiredNonNegativeInt("completedCount") == json.requiredNonNegativeInt("eligibleCount")) {
        "整理审查卡片覆盖不完整。"
    }
    val actionArray = json.optJSONArray("actions") ?: throw IllegalArgumentException("服务器未返回整理动作。")
    val actions = (0 until actionArray.length()).map { index ->
        val item = actionArray.optJSONObject(index) ?: throw IllegalArgumentException("整理动作格式无效。")
        parseOrganizationAction(item)
    }
    val noteArray = json.optJSONArray("noteSuggestions")
    val notes = if (noteArray == null) {
        emptyList()
    } else {
        (0 until noteArray.length()).map { index ->
            val item = noteArray.optJSONObject(index) ?: throw IllegalArgumentException("备注建议格式无效。")
            OrganizationNoteSuggestion(
                actionId = item.requiredString("actionId"),
                transactionId = item.requiredString("transactionId"),
                transactionDateLabel = item.optionalString("transactionDateLabel"),
                transactionAmountCents = item.optionalLong("transactionAmountCents"),
                transactionType = item.optionalInt("transactionType"),
                suggestedNote = item.requiredString("suggestedNote"),
            )
        }
    }
    return OrganizationCard(
        runId = json.requiredString("runId"),
        startDate = json.requiredString("startDate"),
        endDate = json.requiredString("endDate"),
        eligibleCount = json.requiredNonNegativeInt("eligibleCount"),
        completedCount = json.requiredNonNegativeInt("completedCount"),
        version = json.requiredLong("version"),
        expiresAt = json.requiredLong("expiresAt"),
        actions = actions,
        noteSuggestions = notes,
        templateProposalCount = json.optJSONArray("templateProposals")?.length() ?: 0,
    )
}

internal fun parseOrganizationApplyResult(json: JSONObject): OrganizationApplyResult {
    val status = json.requiredString("status")
    require(status == "applied" || status == "undone") { "未知的整理操作结果：$status" }
    val array = json.optJSONArray("appliedActions") ?: JSONArray()
    val ids = (0 until array.length()).mapNotNull { index ->
        array.optString(index).takeIf { it.isNotBlank() }
    }
    return OrganizationApplyResult(
        operationId = json.requiredString("operationId"),
        status = status,
        appliedActions = ids,
    )
}

private fun parseOrganizationAction(json: JSONObject): OrganizationAction {
    val wireKind = json.requiredString("kind")
    val kind = OrganizationActionKind.fromWire(wireKind)
        ?: throw IllegalArgumentException("未知的整理动作类型：$wireKind")
    return OrganizationAction(
        actionId = json.requiredString("actionId"),
        kind = kind,
        transactionId = json.optionalString("transactionId"),
        transactionDateLabel = json.optionalString("transactionDateLabel"),
        transactionAmountCents = json.optionalLong("transactionAmountCents"),
        transactionType = json.optionalInt("transactionType"),
        beforeCategoryId = json.optionalString("beforeCategoryId"),
        beforeCategoryName = json.optionalString("beforeCategoryName"),
        afterCategoryId = json.optionalString("afterCategoryId"),
        afterCategoryName = json.optionalString("afterCategoryName"),
        beforeTags = json.stringList("beforeTags"),
        afterTags = json.stringList("afterTags"),
        proposedCategoryName = json.optionalString("proposedCategoryName"),
        proposedParentCategoryName = json.optionalString("proposedParentCategoryName"),
        reason = json.requiredString("reason"),
        confidence = json.requiredDouble("confidence").coerceIn(0.0, 1.0),
    )
}

private fun JSONObject.requiredString(key: String): String {
    val value = optionalString(key)
    require(value != null) { "缺少字段：$key" }
    return value
}

private fun JSONObject.optionalString(key: String): String? {
    if (!has(key) || isNull(key)) return null
    return optString(key).trim().takeIf { it.isNotEmpty() }
}

private fun JSONObject.requiredLong(key: String): Long {
    require(has(key) && !isNull(key)) { "缺少字段：$key" }
    val raw = get(key)
    require(raw is Number) { "字段必须是整数：$key" }
    return try { java.math.BigDecimal(raw.toString()).longValueExact() } catch (_: Exception) {
        throw IllegalArgumentException("字段整数越界或格式无效：$key")
    }
}

private fun JSONObject.optionalLong(key: String): Long? {
    if (!has(key) || isNull(key)) return null
    val raw = get(key)
    require(raw is Number) { "字段必须是整数：$key" }
    return try { java.math.BigDecimal(raw.toString()).longValueExact() } catch (_: Exception) {
        throw IllegalArgumentException("字段整数越界或格式无效：$key")
    }
}

private fun JSONObject.requiredNonNegativeInt(key: String): Int {
    val value = requiredLong(key)
    require(value <= Int.MAX_VALUE) { "字段整数越界：$key" }
    require(value >= 0) { "字段不能为负数：$key" }
    return value.toInt()
}

private fun JSONObject.optionalInt(key: String): Int? {
    if (!has(key) || isNull(key)) return null
    val value = requiredLong(key)
    require(value in Int.MIN_VALUE..Int.MAX_VALUE) { "字段整数越界：$key" }
    return value.toInt()
}

private fun JSONObject.requiredDouble(key: String): Double {
    require(has(key) && !isNull(key)) { "缺少字段：$key" }
    return getDouble(key)
}

private fun JSONObject.stringList(key: String): List<String> {
    val array = optJSONArray(key) ?: return emptyList()
    return (0 until array.length()).mapNotNull { index ->
        array.optString(index).trim().takeIf { it.isNotEmpty() }
    }
}
