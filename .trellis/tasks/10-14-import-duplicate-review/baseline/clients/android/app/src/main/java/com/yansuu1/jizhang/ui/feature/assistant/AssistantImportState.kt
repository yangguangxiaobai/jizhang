package com.yansuu1.jizhang.ui.feature.assistant

import org.json.JSONObject

internal const val IMPORT_SELECTION_LIMIT = 100
internal const val IMPORT_PREVIEW_LIMIT = 200
internal data class AssistantImportRow(
    val id: String, val title: String, val dateLabel: String, val amountCents: Long,
    val category: String, val status: String, val eligible: Boolean, val softDuplicate: Boolean,
    val type: Int = 0,
    val recommendation: Boolean = false, val reason: String = "", val categoryId: String = "",
    val sourceNote: String = "", val isRefund: Boolean = false, val refundWarning: String = "", val rawStatus: String = "",
)
internal fun assistantImportRows(card: JSONObject): List<AssistantImportRow> {
    val rows = card.optJSONObject("preview")?.optJSONArray("rows") ?: return emptyList()
    val analysis = card.optJSONObject("preview")?.optJSONObject("analysis")
    val suggestions = analysis?.optJSONArray("recommendations")
    return (0 until minOf(rows.length(), IMPORT_PREVIEW_LIMIT)).mapNotNull { index ->
        val row = rows.optJSONObject(index) ?: return@mapNotNull null
        val id = row.optString("id")
        if (id.isBlank() || id.length > 100 || id != id.trim()) return@mapNotNull null
        val eligible = !row.optBoolean("alreadyExists") && !row.optBoolean("ignored") && row.optLong("amountCents") > 0
        val suggestion = if (analysis?.optString("status") == "complete" && suggestions != null) (0 until suggestions.length()).mapNotNull { suggestions.optJSONObject(it) }.firstOrNull { it.optString("id") == id } else null
        AssistantImportRow(id, row.optString("note").ifBlank { row.optString("counterparty").ifBlank { "未命名账单" } },
            row.optString("dateLabel"), row.optLong("amountCents"), row.optString("categoryName"),
            when { row.optBoolean("alreadyExists") -> "已存在"; row.optBoolean("ignored") -> row.optString("ignoreReason").ifBlank { "来源规则禁止导入" }; row.optLong("amountCents") <= 0 -> "金额无效"; row.optBoolean("possibleDuplicate") -> "疑似重复，请核对"; else -> "可导入" },
            eligible, row.optBoolean("possibleDuplicate"), row.optInt("type", -1), suggestion?.optBoolean("include") == true, suggestion?.optString("reason").orEmpty(),
            suggestion?.optString("categoryId")?.takeUnless { it == "null" }.orEmpty(), row.optString("note"), row.optBoolean("isRefund"), row.optString("refundWarning").takeUnless { it == "null" }.orEmpty(), row.optString("rawStatus"))
    }.distinctBy { it.id }
}
internal fun reconcileImportSelection(previous: Set<String>?, rows: List<AssistantImportRow>): Set<String> {
    val eligible = rows.take(IMPORT_PREVIEW_LIMIT).filter { it.eligible }
    val ids = eligible.map { it.id }.toSet()
    return (previous?.filter { it in ids } ?: eligible.filter { it.recommendation }.map { it.id }).take(IMPORT_SELECTION_LIMIT).toSet()
}
internal fun selectVisibleImportRows(selected: Set<String>, visible: List<AssistantImportRow>): Set<String> =
    (selected + visible.filter { it.eligible }.map { it.id }).take(IMPORT_SELECTION_LIMIT).toSet()
internal fun filterImportRows(rows: List<AssistantImportRow>, query: String, filter: String): List<AssistantImportRow> = rows.filter {
    (filter == "全部" || (filter == "可导入" && it.eligible && !it.softDuplicate) || (filter == "疑似重复" && it.softDuplicate) || (filter == "不可导入" && !it.eligible)) &&
        listOf(it.title, it.category, it.dateLabel, it.status).any { text -> text.contains(query.trim(), ignoreCase = true) }
}
internal data class AssistantRequestTicket(val lane: String, val scope: String, val generation: Long)
/** Volatile gate; invalidation also rejects A→B→A and disposed-account completions. */
internal class AssistantRequestGate {
    private var next = 0L
    private val current = mutableMapOf<String, AssistantRequestTicket>()
    fun begin(lane: String, scope: String): AssistantRequestTicket = AssistantRequestTicket(lane, scope, ++next).also { current[lane] = it }
    fun accepts(ticket: AssistantRequestTicket, scope: String): Boolean = ticket.scope == scope && current[ticket.lane] == ticket
    fun invalidateDisplay() { current.keys.removeAll { it in setOf("messages", "composer-file", "action-file") }; next++ }
    fun invalidate() { current.clear(); next++ }
}

internal data class AssistantImportCategory(val id: String, val name: String, val type: Int)
internal fun assistantImportCategories(card: JSONObject): List<AssistantImportCategory> {
    val array = card.optJSONObject("preview")?.optJSONArray("categories") ?: return emptyList()
    return (0 until array.length()).mapNotNull { index -> array.optJSONObject(index)?.let { AssistantImportCategory(it.optString("id"), it.optString("name"), it.optInt("type", -1)) } }
}
internal fun reviewedImportCategory(row: AssistantImportRow, overrides: Map<String, String>) = overrides[row.id] ?: row.categoryId
internal fun reviewedImportNote(row: AssistantImportRow, notes: Map<String, String>) = notes[row.id] ?: row.sourceNote
