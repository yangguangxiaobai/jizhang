package com.yansuu1.jizhang.ui

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class TransactionTagSelectionTest {
    @Test fun readsRealTagNamesAndDeduplicatesWithoutUsingCounts() {
        val response = JSONObject("""{"items":[{"name":"餐饮","count":5},{"name":" AA "},{"name":"餐饮"},{"name":""},{"count":3},{"name":null}]}""")
        assertEquals(listOf("餐饮", "AA"), TransactionEditorHelper.tagNames(response))
    }
    @Test fun supportsEmptyCatalogue() {
        assertEquals(emptyList<String>(), TransactionEditorHelper.tagNames(JSONObject("""{"items":[]}""")))
    }
    @Test(expected = IllegalStateException::class) fun malformedCatalogueDoesNotPretendToBeEmpty() {
        TransactionEditorHelper.tagNames(JSONObject())
    }
    @Test fun selectingExistingTagPreservesManualAndLegacyTags() {
        assertEquals("手输新标签, 旧标签, 餐饮", TransactionEditorHelper.toggleTag("手输新标签，旧标签", "餐饮"))
    }
    @Test fun deselectionRemovesOnlyMatchingNameAndAllItsDuplicates() {
        assertEquals("餐饮AA, 新标签", TransactionEditorHelper.toggleTag("AA，餐饮AA, AA, 新标签", "AA"))
    }
    @Test fun repeatedToggleReturnsToSameSemanticSelection() {
        val original = "保留, 手动"
        assertEquals(original, TransactionEditorHelper.toggleTag(TransactionEditorHelper.toggleTag(original, "选择"), "选择"))
        assertEquals(original, TransactionEditorHelper.toggleTag(original, " "))
    }
    @Test fun selectedNamesUseExistingPayloadContract() {
        val text = TransactionEditorHelper.toggleTag("手动", "已有")
        val draft = TransactionEditorDraft(amountText = "1.00", categoryId = "c", accountId = "a", dateText = "2026-10-26", tagsText = text)
        val tags = TransactionEditorHelper.buildPayload(draft).getJSONArray("tags")
        assertEquals(listOf("手动", "已有"), (0 until tags.length()).map { tags.getString(it) })
    }
}
