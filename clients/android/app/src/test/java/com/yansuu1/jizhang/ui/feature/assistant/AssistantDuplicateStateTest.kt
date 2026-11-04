package com.yansuu1.jizhang.ui.feature.assistant

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class AssistantDuplicateStateTest {
    private fun page() = JSONObject().put("source", JSONObject().put("id", "source").put("accountName", "微信")
        .put("externalId", JSONObject.NULL).put("counterparty", "对方").put("rawStatus", "支付成功"))
        .put("total", 2).put("nextCursor", "a").put("readAt", 123L).put("rationale", "同日同金额仅为线索")
        .put("items", JSONArray().put(JSONObject().put("id", "a").put("date", 100L).put("amountCents", 100L)
            .put("type", 1).put("isRefund", true).put("accountName", "历史账户").put("categoryName", JSONObject.NULL).put("note", "")))

    @Test fun decoderPreservesSourceFactsPaginationEmptyNotesAndRefundIdentity() {
        val decoded = decodeAssistantDuplicatePage(page())
        assertEquals("source", decoded.sourceId)
        assertEquals("", decoded.sourceOrder)
        assertEquals("支付成功", decoded.sourceStatus)
        assertEquals(2, decoded.total)
        assertEquals("a", decoded.nextCursor)
        assertEquals(123L, decoded.readAt)
        assertTrue(decoded.items.single().isRefund)
        assertEquals("", decoded.items.single().note)
        assertEquals("名称不可用", decoded.items.single().categoryName)
        val empty = decodeAssistantDuplicatePage(page().put("items", JSONArray()).put("total", 0).put("nextCursor", JSONObject.NULL))
        assertTrue(empty.items.isEmpty()); assertNull(empty.nextCursor)
    }
    @Test fun decoderPreservesFullNotesAndRejectsMalformedCandidateAndOversizedPages() {
        val value = page()
        value.getJSONArray("items").getJSONObject(0).put("note", "完整备注".repeat(300))
        assertEquals("完整备注".repeat(300), decodeAssistantDuplicatePage(value).items.single().note)
        value.getJSONArray("items").getJSONObject(0).put("type", -1)
        assertTrue(runCatching { decodeAssistantDuplicatePage(value) }.isFailure)
        val array = JSONArray()
        repeat(51) { array.put(page().getJSONArray("items").getJSONObject(0)) }
        assertTrue(runCatching { decodeAssistantDuplicatePage(page().put("items", array)) }.isFailure)
    }
    @Test fun decoderRejectsFractionalOverflowAndStringIntegerFacts() {
        for (key in listOf("amountCents", "type", "date")) {
            for (invalid in listOf<Any>(1.5, "100", 1e30)) {
                val value = page()
                value.getJSONArray("items").getJSONObject(0).put(key, invalid)
                assertTrue("$key=$invalid", runCatching { decodeAssistantDuplicatePage(value) }.isFailure)
            }
        }
        for (key in listOf("total", "readAt")) {
            assertTrue(runCatching { decodeAssistantDuplicatePage(page().put(key, 1.5)) }.isFailure)
        }
        assertTrue(runCatching { decodeAssistantDuplicatePage(page().put("total", 4294967296L)) }.isFailure)
    }
    @Test fun lateResponsesCannotCrossRowsActionsCloseReopenOrNewerPagination() {
        val gate = AssistantRequestGate()
        val first = gate.begin("comparison", "actionA|rowA")
        val nextPage = gate.begin("comparison", "actionA|rowA")
        assertFalse(gate.accepts(first, "actionA|rowA"))
        assertTrue(gate.accepts(nextPage, "actionA|rowA"))
        assertFalse(gate.accepts(nextPage, "actionA|rowB"))
        assertFalse(gate.accepts(nextPage, "actionB|rowA"))
        gate.invalidate()
        gate.begin("comparison", "actionA|rowA")
        assertFalse(gate.accepts(nextPage, "actionA|rowA"))
    }
    @Test fun explicitSelectionPreservesOtherRowsAndDraftsAndHardBlockAnd100Cap() {
        val source = AssistantImportRow("soft", "来源", "2026-10-14", 100, "餐饮", "疑似重复", true, true, sourceNote = "原备注")
        val selected = setOf("other")
        val categories = mapOf("soft" to "reviewed-category")
        val notes = mapOf("soft" to "")
        assertEquals(setOf("other", "soft"), selectVisibleImportRows(selected, listOf(source)))
        assertEquals(selected, (selected + "soft") - source.id)
        assertEquals("reviewed-category", reviewedImportCategory(source, categories))
        assertEquals("", reviewedImportNote(source, notes))
        assertEquals(selected, selectVisibleImportRows(selected, listOf(source.copy(eligible = false))))
        val full = (1..100).map { "$it" }.toSet()
        assertEquals(full, selectVisibleImportRows(full, listOf(source)))
    }
}
