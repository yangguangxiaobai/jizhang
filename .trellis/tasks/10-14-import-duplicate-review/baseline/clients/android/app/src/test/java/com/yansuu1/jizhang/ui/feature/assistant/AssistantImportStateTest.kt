package com.yansuu1.jizhang.ui.feature.assistant

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class AssistantImportStateTest {
    private fun row(id: String, eligible: Boolean = true, soft: Boolean = false) = AssistantImportRow(id, "账单$id", "2026-10-13", 100, "餐饮", if (eligible) "可导入" else "已存在", eligible, soft, recommendation = !soft)
    @Test fun initialSelectionExcludesHardAndSoftDuplicatesAndStopsAt100() {
        val rows = listOf(row("hard", false), row("soft", soft = true)) + (1..220).map { row("$it") }
        val selected = reconcileImportSelection(null, rows)
        assertEquals(100, selected.size)
        assertFalse("hard" in selected); assertFalse("soft" in selected)
        assertFalse("201" in selected)
    }
    @Test fun explicitEmptyDoesNotBecomeAllAndReconcileDropsRemovedOrLockedRows() {
        val rows = listOf(row("a"), row("b", false), row("soft", soft = true))
        assertEquals(emptySet<String>(), reconcileImportSelection(emptySet(), rows))
        assertEquals(setOf("a", "soft"), reconcileImportSelection(setOf("a", "b", "gone", "soft"), rows))
    }
    @Test fun selectVisibleNeverExceeds100ButCanExplicitlySelectSoftDuplicates() {
        val selected = (1..99).map { "$it" }.toSet()
        assertEquals(100, selectVisibleImportRows(selected, listOf(row("soft", soft = true), row("extra"))).size)
        assertTrue("soft" in selectVisibleImportRows(emptySet(), listOf(row("soft", soft = true))))
        assertEquals(emptySet<String>(), selectVisibleImportRows(emptySet(), listOf(row("hard", false))))
    }
    @Test fun filtersAreLocalAndDateLabelIsSearchable() {
        val rows = listOf(row("a"), row("b", false), row("soft", soft = true))
        assertEquals(listOf("a"), filterImportRows(rows, " 餐饮 ", "可导入").map { it.id })
        assertEquals(3, filterImportRows(rows, "2026-10-13", "全部").size)
        assertTrue(filterImportRows(rows, "missing", "全部").isEmpty())
    }
    @Test fun decoderReadsDateLabelCaps200AndRejectsMalformedIds() {
        val array = JSONArray()
        (1..205).forEach { array.put(JSONObject().put("id", "$it").put("dateLabel", "正确日期").put("date", "错误字段").put("amountCents", 100)) }
        val rows = assistantImportRows(JSONObject().put("preview", JSONObject().put("rows", array)))
        assertEquals(200, rows.size); assertEquals("正确日期", rows.first().dateLabel)
        assertTrue(assistantImportRows(JSONObject().put("preview", JSONObject().put("rows", JSONArray().put(JSONObject().put("id", "  "))))).isEmpty())
    }
    @Test fun latestRequestIdentityRejectsSameConversationLateResponseAndDifferentAccount() {
        val gate = AssistantRequestGate()
        val old = gate.begin("messages", "server|account|A")
        val latest = gate.begin("messages", "server|account|A")
        assertFalse(gate.accepts(old, "server|account|A"))
        assertTrue(gate.accepts(latest, "server|account|A"))
        assertFalse(gate.accepts(latest, "server|otherAccount|A"))
        gate.invalidate(); gate.begin("messages", "server|account|A")
        assertFalse(gate.accepts(latest, "server|account|A"))
    }
    @Test fun displayInvalidationDoesNotReleaseOrInvalidateAnotherConversationSend() {
        val gate = AssistantRequestGate()
        val send = gate.begin("send:A", "server")
        val read = gate.begin("messages", "server|A")
        gate.invalidateDisplay()
        assertTrue(gate.accepts(send, "server"))
        assertFalse(gate.accepts(read, "server|A"))
    }
    @Test fun analysisRecommendationsNeverOverrideEligibilityAndHumanCanReverseExclusions() {
        val rows = listOf(row("hard", false).copy(recommendation = true), row("excluded").copy(recommendation = false), row("soft", soft = true).copy(recommendation = true))
        assertEquals(setOf("soft"), reconcileImportSelection(null, rows))
        assertEquals(setOf("excluded", "soft"), selectVisibleImportRows(emptySet(), rows))
    }
    @Test fun reviewedNotesPreserveUntouchedAndExplicitClearAndCategoryUsesId() {
        val source = row("a").copy(sourceNote = "a".repeat(200), categoryId = "existing-id")
        assertEquals(source.sourceNote, reviewedImportNote(source, emptyMap()))
        assertEquals("", reviewedImportNote(source, mapOf("a" to "")))
        assertEquals("edited", reviewedImportNote(source, mapOf("a" to "edited")))
        assertEquals("existing-id", reviewedImportCategory(source, emptyMap()))
        assertEquals("new-id", reviewedImportCategory(source, mapOf("a" to "new-id")))
    }

}
