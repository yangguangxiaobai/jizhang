package com.yansuu1.jizhang.ui.feature.assistant

import org.json.JSONObject

internal const val IMPORT_SELECTION_LIMIT = 100
internal const val IMPORT_PREVIEW_LIMIT = 200
internal data class AssistantImportRow(
    val id: String, val title: String, val dateLabel: String, val amountCents: Long,
    val category: String, val status: String, val eligible: Boolean, val softDuplicate: Boolean,
    val type: Int = 0,
    val recommendation: Boolean = false, val reason: String = "", val categoryId: String = "",
    val sourceNote: String = "", val isRefund: Boolean = false, val refundWarning: String = "", val rawStatus: String = "", val sourceCategory: String = "",
)
internal fun assistantImportRows(card: JSONObject): List<AssistantImportRow> {
    val rows = card.optJSONObject("preview")?.optJSONArray("rows") ?: return emptyList()
    val analysis = card.optJSONObject("preview")?.optJSONObject("analysis")
    val suggestions = analysis?.optJSONArray("recommendations")
    return (0 until minOf(rows.length(), IMPORT_PREVIEW_LIMIT)).mapNotNull { index ->
        val row = rows.optJSONObject(index) ?: return@mapNotNull null
        val id = row.optString("id")
        if (id.isBlank() || id.length > 100 || id != id.trim()) return@mapNotNull null
        val eligible = !row.optBoolean("alreadyExists") && row.optLong("amountCents") > 0
        val suggestion = if (analysis?.optString("status") == "complete" && suggestions != null) (0 until suggestions.length()).mapNotNull { suggestions.optJSONObject(it) }.firstOrNull { it.optString("id") == id } else null
        AssistantImportRow(id, row.optString("note").ifBlank { row.optString("counterparty").ifBlank { "未命名账单" } },
            row.optString("dateLabel"), row.optLong("amountCents"), row.optString("categoryName"),
            when {
                row.optBoolean("alreadyExists") -> "已存在"
                row.optLong("amountCents") <= 0 -> "金额无效"
                row.optBoolean("possibleDuplicate") -> "疑似重复"
                row.optBoolean("ignored") -> row.optString("ignoreReason").ifBlank { "规则排除" }
                else -> "可导入"
            },
            eligible, row.optBoolean("possibleDuplicate"), row.optInt("type", -1), suggestion?.optBoolean("include") == true, suggestion?.optString("reason").orEmpty(),
            suggestion?.optString("categoryId")?.takeUnless { it == "null" }.orEmpty(), row.optString("note"), row.optBoolean("isRefund"), row.optString("refundWarning").takeUnless { it == "null" }.orEmpty(), row.optString("rawStatus"), row.optString("sourceCategory"))
    }.distinctBy { it.id }
}
internal fun reconcileImportSelection(previous: Set<String>?, rows: List<AssistantImportRow>): Set<String> {
    val eligible = rows.take(IMPORT_PREVIEW_LIMIT).filter { it.eligible }
    val ids = eligible.map { it.id }.toSet()
    return (previous?.filter { it in ids } ?: eligible.filter { it.recommendation }.map { it.id }).take(IMPORT_SELECTION_LIMIT).toSet()
}
internal fun selectVisibleImportRows(selected: Set<String>, visible: List<AssistantImportRow>): Set<String> =
    (selected + visible.filter { it.eligible }.map { it.id }).take(IMPORT_SELECTION_LIMIT).toSet()
internal fun filterImportRows(
    rows: List<AssistantImportRow>,
    query: String,
    filter: String,
    selected: Set<String> = emptySet(),
): List<AssistantImportRow> = rows.filter {
    (filter == "全部" || (filter == "已选入" && it.id in selected) || (filter == "未选" && it.id !in selected) || (filter == "疑似重复" && it.softDuplicate)) &&
        listOf(it.title, it.category, it.dateLabel, it.status).any { text -> text.contains(query.trim(), ignoreCase = true) }
}
internal data class AssistantRequestTicket(val lane: String, val scope: String, val generation: Long)
/** Volatile gate; invalidation also rejects A→B→A and disposed-account completions. */
internal class AssistantRequestGate {
    private var next = 0L
    private val current = mutableMapOf<String, AssistantRequestTicket>()
    fun begin(lane: String, scope: String): AssistantRequestTicket = AssistantRequestTicket(lane, scope, ++next).also { current[lane] = it }
    fun accepts(ticket: AssistantRequestTicket, scope: String): Boolean = ticket.scope == scope && current[ticket.lane] == ticket
    fun invalidateDisplay() {
        current.keys.removeAll {
            it in setOf("messages", "composer-file", "action-file") ||
                it.startsWith("gen:") || it.startsWith("reconnect:") || it.startsWith("cancel:")
        }
        next++
    }
    fun invalidate() { current.clear(); next++ }
}

internal data class AssistantImportCategory(val id: String, val name: String, val type: Int)
internal fun assistantImportCategories(card: JSONObject): List<AssistantImportCategory> {
    val array = card.optJSONObject("preview")?.optJSONArray("categories") ?: return emptyList()
    return (0 until array.length()).mapNotNull { index -> array.optJSONObject(index)?.let { AssistantImportCategory(it.optString("id"), it.optString("name"), it.optInt("type", -1)) } }
}
internal fun reviewedImportCategory(row: AssistantImportRow, overrides: Map<String, String>) = overrides[row.id] ?: row.categoryId
internal fun reviewedImportNote(row: AssistantImportRow, notes: Map<String, String>) = notes[row.id] ?: row.sourceNote

// ── Merged Batch State Helpers (protocol-v1.md) ───────────────────────────────

internal const val MERGED_MAX_BATCH_ITEMS = 500
internal const val MERGED_PAGE_SIZE = 100

internal fun getBatchRowLockReason(row: ImportBatchRow): String? = when {
    row.existing -> "已在账本中（已入账）"
    row.amountCents <= 0 -> "金额为 0 或无效，无法入账"
    row.conflictKind == "ledger_collision" -> "订单标识碰撞，无法选入"
    row.conflictKind == "weak_collision" -> "批次内弱冲突，无法选入"
    else -> null
}

internal fun getBatchRowStatusText(row: ImportBatchRow, isSelected: Boolean, isUserExcluded: Boolean): String = when {
    row.existing -> "已存在"
    row.amountCents <= 0 -> "金额无效"
    row.conflictKind == "ledger_collision" -> "标识碰撞"
    row.conflictKind == "weak_collision" -> "弱冲突碰撞"
    row.conflictKind == "fact_conflict" -> if (isSelected) "冲突选定" else "事实冲突"
    isUserExcluded -> "暂不导入"
    isSelected -> "已选入"
    row.possibleDuplicate -> "疑似重复"
    row.legacyLedgerMatch -> "疑似重复"
    row.ignored -> row.ignoreReason?.takeIf { it.isNotBlank() } ?: "规则排除"
    else -> "可导入"
}

internal fun resolveInitialCategoryAssignment(row: ImportBatchRow): CategoryAssignment? {
    val aiCat = row.ai?.categoryId?.takeIf { it.isNotBlank() && it != "null" }
    if (aiCat != null) return CategoryAssignment.Existing(aiCat)

    val aiSug = row.ai?.newSuggestionId?.takeIf { it.isNotBlank() && it != "null" }
    if (aiSug != null) return CategoryAssignment.Suggestion(aiSug)

    val fbCat = row.fallback?.effectiveExistingId?.takeIf { it.isNotBlank() && it != "null" }
    if (fbCat != null) return CategoryAssignment.Existing(fbCat)

    val fbSug = row.fallback?.newOtherSuggestionId?.takeIf { it.isNotBlank() && it != "null" }
    if (fbSug != null) return CategoryAssignment.Suggestion(fbSug)

    return null
}

internal fun batchRowNeedsAttention(
    row: ImportBatchRow,
    assignments: Map<String, CategoryAssignment> = emptyMap(),
    approvedCategories: Map<String, ApprovedCategory> = emptyMap(),
    activeCategoryIds: Set<String>? = null,
    userExcluded: Set<String> = emptySet(),
): Boolean {
    if (row.itemId in userExcluded) return false
    if (row.conflictGroup != null || row.conflictKind != null) return true
    if (row.possibleDuplicate || row.legacyLedgerMatch) return true
    if (row.ignored || row.ignoreReason != null) return true
    if (!row.isEligible) return true

    val assignment = assignments[row.itemId] ?: resolveInitialCategoryAssignment(row)
    if (assignment == null) return true
    return when (assignment) {
        is CategoryAssignment.Existing -> {
            activeCategoryIds != null && assignment.categoryId !in activeCategoryIds
        }
        is CategoryAssignment.Suggestion -> {
            assignment.suggestionId !in approvedCategories
        }
    }
}

internal fun filterBatchRows(
    rows: List<ImportBatchRow>,
    query: String,
    filter: String,
    selected: Set<String>,
    userExcluded: Set<String>,
    assignments: Map<String, CategoryAssignment> = emptyMap(),
    approvedCategories: Map<String, ApprovedCategory> = emptyMap(),
    activeCategoryIds: Set<String>? = null,
): List<ImportBatchRow> {
    val q = query.trim()
    val filtered = rows.filter { row ->
        val matchesFilter = when (filter) {
            "待核对" -> batchRowNeedsAttention(row, assignments, approvedCategories, activeCategoryIds, userExcluded)
            "全部" -> true
            "已选入" -> row.itemId in selected
            "未选" -> row.itemId !in selected && row.itemId !in userExcluded && row.isEligible
            "暂不导入" -> row.itemId in userExcluded
            "疑似重复" -> row.possibleDuplicate || row.legacyLedgerMatch
            "事实冲突" -> row.conflictGroup != null
            "规则排除" -> row.ignored
            else -> true
        }
        if (!matchesFilter) return@filter false
        if (q.isBlank()) return@filter true

        val fields = listOf(
            row.note,
            row.dateLabel,
            row.rawStatus.orEmpty(),
            row.ignoreReason.orEmpty(),
            row.duplicateOfNote.orEmpty(),
            row.fallback?.categoryName.orEmpty(),
            row.ai?.reason.orEmpty(),
        ) + row.sources.map { it.fileName + " " + it.note }
        fields.any { it.contains(q, ignoreCase = true) }
    }

    return filtered.sortedWith(
        compareByDescending<ImportBatchRow> {
            batchRowNeedsAttention(it, assignments, approvedCategories, activeCategoryIds, userExcluded)
        }.thenBy { it.ordinal }.thenBy { it.itemId }
    )
}

/**
 * Handle user click on "暂不导入" (exclude action).
 * Even if row is unselected, we record it in [userExcluded] so the user gets explicit feedback.
 */
internal fun excludeBatchRow(
    row: ImportBatchRow,
    selected: Set<String>,
    userExcluded: Set<String>,
): Pair<Set<String>, Set<String>> {
    val newSelected = selected - row.itemId
    val newExcluded = userExcluded + row.itemId
    return Pair(newSelected, newExcluded)
}

/**
 * Handle user click on "重新选入" / select row.
 * Clears user-excluded status and adds to selected set if eligible.
 */
internal fun reincludeBatchRow(
    row: ImportBatchRow,
    selected: Set<String>,
    userExcluded: Set<String>,
    allRows: List<ImportBatchRow> = emptyList(),
): Pair<Set<String>, Set<String>> {
    if (!row.isEligible) return Pair(selected, userExcluded)
    val newExcluded = userExcluded - row.itemId

    // If part of fact_conflict, selecting this one unselects other items in the same conflict group
    var newSelected = selected
    if (row.conflictGroup != null && row.conflictKind == "fact_conflict") {
        val siblingIds = allRows.filter { it.conflictGroup == row.conflictGroup && it.itemId != row.itemId }.map { it.itemId }.toSet()
        newSelected = newSelected - siblingIds
    }

    if (newSelected.size < MERGED_MAX_BATCH_ITEMS) {
        newSelected = newSelected + row.itemId
    }
    return Pair(newSelected, newExcluded)
}

/**
 * Toggle selection: if selected -> exclude; if not selected -> reinclude.
 */
internal fun toggleBatchRowSelection(
    row: ImportBatchRow,
    selected: Set<String>,
    userExcluded: Set<String>,
    allRows: List<ImportBatchRow> = emptyList(),
): Pair<Set<String>, Set<String>> {
    return if (row.itemId in selected) {
        excludeBatchRow(row, selected, userExcluded)
    } else {
        reincludeBatchRow(row, selected, userExcluded, allRows)
    }
}

/**
 * Validate batch state before requesting final review.
 * Returns null if valid, or an error message if invalid.
 */
internal fun validateBatchForReview(
    selectedIds: Set<String>,
    rows: List<ImportBatchRow>,
    assignments: Map<String, CategoryAssignment>,
    approvedSuggestionIds: Set<String>,
    activeLeafCategoryIds: Set<String>,
): String? {
    if (selectedIds.isEmpty()) return "请至少选择一条有效账单入账"
    if (selectedIds.size > MERGED_MAX_BATCH_ITEMS) return "选择的账单数量超过 $MERGED_MAX_BATCH_ITEMS 笔上限"

    val selectedRows = rows.filter { it.itemId in selectedIds }

    // Check collision locking
    val collisionRow = selectedRows.firstOrNull { it.conflictKind == "ledger_collision" }
    if (collisionRow != null) {
        return "账单「${collisionRow.note}」存在订单标识碰撞，不可选入"
    }

    val weakCollisionRow = selectedRows.firstOrNull { it.conflictKind == "weak_collision" }
    if (weakCollisionRow != null) {
        return "账单「${weakCollisionRow.note}」存在批次内弱冲突，不可选入"
    }

    // Check nonpositive amount
    val nonPositiveRow = selectedRows.firstOrNull { it.amountCents <= 0 }
    if (nonPositiveRow != null) {
        return "账单「${nonPositiveRow.note}」金额为 0 或无效，不可选入"
    }

    // Check existing in ledger
    val existingRow = selectedRows.firstOrNull { it.existing }
    if (existingRow != null) {
        return "账单「${existingRow.note}」已在账本中，不可选入"
    }

    // Check fact_conflict group: at most 1 item selected per group
    val conflictGroups = selectedRows.filter { it.conflictGroup != null && it.conflictKind == "fact_conflict" }
        .groupBy { it.conflictGroup!! }
    for ((group, items) in conflictGroups) {
        if (items.size > 1) {
            return "冲突组「$group」选择了多条账单，请只保留一条或全部排除"
        }
    }

    // Check each selected row has valid category assignment
    for (row in selectedRows) {
        val assignment = assignments[row.itemId] ?: resolveInitialCategoryAssignment(row)
        if (assignment == null) {
            return "账单「${row.note.ifBlank { row.dateLabel }}」缺少有效分类，请手动分配分类"
        }
        when (assignment) {
            is CategoryAssignment.Existing -> {
                if (assignment.categoryId !in activeLeafCategoryIds) {
                    return "账单「${row.note.ifBlank { row.dateLabel }}」所选分类无效或非可记账叶子分类，请重新选择"
                }
            }
            is CategoryAssignment.Suggestion -> {
                if (assignment.suggestionId !in approvedSuggestionIds) {
                    return "账单「${row.note.ifBlank { row.dateLabel }}」使用的建议分类尚未批准，请在分类建议中批准或改为现有分类"
                }
            }
        }
    }

    return null
}

/** Remap drafts after file mutations (remove/replace). */
internal data class RemappedDrafts(
    val selected: Set<String>,
    val userExcluded: Set<String>,
    val assignments: Map<String, CategoryAssignment>,
    val notes: Map<String, String>,
)

internal fun remapBatchDrafts(
    selected: Set<String>,
    userExcluded: Set<String>,
    assignments: Map<String, CategoryAssignment>,
    notes: Map<String, String>,
    mutation: MutationResult,
): RemappedDrafts {
    val remap = mutation.idRemap
    val dropped = mutation.droppedDraftItemIds.toSet()
    val unchanged = mutation.identityUnchangedItemIds.toSet()

    fun remapId(id: String): String? {
        if (id in dropped) return null
        val mapped = remap[id]
        if (mapped != null) return mapped
        if (unchanged.isEmpty() || id in unchanged) return id
        return null
    }

    val newSelected = selected.mapNotNull { remapId(it) }.toSet()
    val newExcluded = userExcluded.mapNotNull { remapId(it) }.toSet()

    val newAssignments = mutableMapOf<String, CategoryAssignment>()
    assignments.forEach { (oldId, assign) ->
        val mappedId = remapId(oldId)
        if (mappedId != null) newAssignments[mappedId] = assign
    }

    val newNotes = mutableMapOf<String, String>()
    notes.forEach { (oldId, note) ->
        val mappedId = remapId(oldId)
        if (mappedId != null) newNotes[mappedId] = note
    }

    return RemappedDrafts(newSelected, newExcluded, newAssignments, newNotes)
}

