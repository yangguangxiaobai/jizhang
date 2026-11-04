package com.yansuu1.jizhang.ui.feature.assistant

import org.json.JSONObject

/** Read-only current ledger projection. No selection or review draft is owned here. */
internal data class AssistantDuplicateItem(
    val id: String, val date: Long, val amountCents: Long, val type: Int,
    val isRefund: Boolean, val accountName: String, val categoryName: String, val note: String,
)
internal data class AssistantDuplicatePage(
    val sourceId: String, val sourceAccount: String, val sourceOrder: String,
    val sourceCounterparty: String, val sourceStatus: String,
    val total: Int, val items: List<AssistantDuplicateItem>, val nextCursor: String?,
    val readAt: Long, val rationale: String,
)
private fun JSONObject.optionalText(key: String): String = if (isNull(key)) "" else optString(key)
/** JSONObject.getLong/getInt silently truncate fractional numbers; ledger facts must not. */
private fun JSONObject.integerFact(key: String): Long {
    val raw = get(key)
    require(raw is Number) { "候选整数事实无效，请刷新" }
    return raw.toString().toLongOrNull() ?: error("候选整数事实无效，请刷新")
}
internal fun decodeAssistantDuplicatePage(value: JSONObject): AssistantDuplicatePage {
    val source = value.getJSONObject("source")
    val array = value.getJSONArray("items")
    require(array.length() <= 50) { "候选分页超出限制，请刷新" }
    val totalFact = value.integerFact("total")
    require(totalFact in 0..Int.MAX_VALUE.toLong()) { "候选数量无效，请刷新" }
    val total = totalFact.toInt()
    val items = (0 until array.length()).map { index ->
        val row = array.getJSONObject(index)
        val id = row.getString("id")
        val amount = row.integerFact("amountCents")
        val typeFact = row.integerFact("type")
        require(id.isNotBlank() && id.length <= 100 && amount > 0 && typeFact in 0..1) { "候选账单无效，请刷新" }
        AssistantDuplicateItem(id, row.integerFact("date"), amount, typeFact.toInt(), row.getBoolean("isRefund"),
            row.optionalText("accountName").ifBlank { "名称不可用" },
            row.optionalText("categoryName").ifBlank { "名称不可用" }, row.getString("note"))
    }
    require(items.map { it.id }.distinct().size == items.size) { "候选账单编号重复，请刷新" }
    val cursor = value.optionalText("nextCursor").takeIf { it.isNotBlank() }
    require(cursor == null || cursor.length <= 100) { "候选分页无效，请刷新" }
    return AssistantDuplicatePage(source.getString("id"), source.optionalText("accountName"),
        source.optionalText("externalId"), source.optionalText("counterparty"), source.optionalText("rawStatus"),
        total, items, cursor, value.integerFact("readAt"), value.getString("rationale"))
}
