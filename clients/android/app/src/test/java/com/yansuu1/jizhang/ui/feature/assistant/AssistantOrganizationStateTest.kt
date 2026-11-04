package com.yansuu1.jizhang.ui.feature.assistant

import java.time.LocalDate
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class AssistantOrganizationStateTest {
    private val today = LocalDate.of(2026, 10, 22)

    @Test
    fun rangePresetsUseServerCalendarLabelsAndInclusiveEnd() {
        assertEquals(
            OrganizationDateRange("2026-10-01", "2026-10-31"),
            organizationRangeForPreset(OrganizationRangePreset.THIS_MONTH, today),
        )
        assertEquals(
            OrganizationDateRange("2026-09-01", "2026-09-30"),
            organizationRangeForPreset(OrganizationRangePreset.LAST_MONTH, today),
        )
        assertEquals(
            OrganizationDateRange("2026-08-01", "2026-10-22"),
            organizationRangeForPreset(OrganizationRangePreset.LAST_THREE_MONTHS, today),
        )
        assertEquals(
            OrganizationDateRange("2026-01-01", "2026-10-22"),
            organizationRangeForPreset(OrganizationRangePreset.THIS_YEAR, today),
        )
        assertNull(organizationRangeForPreset(OrganizationRangePreset.CUSTOM, today))
    }

    @Test
    fun rangeValidationRejectsInvalidAndReversedDates() {
        assertNull(organizationRangeValidationError("2026-08-01", "2026-08-31"))
        assertEquals("开始日期不能晚于结束日期。", organizationRangeValidationError("2026-09-01", "2026-08-31"))
        assertEquals("请选择有效的开始日期。", organizationRangeValidationError("2026-02-30", "2026-03-01"))
        assertEquals("请选择有效的结束日期。", organizationRangeValidationError("2026-03-01", "not-a-date"))
    }

    @Test
    fun defaultSelectionIncludesOnlyCategoryAndTagAndCapsAt100() {
        val actions = (1..105).map { action("a$it", OrganizationActionKind.CATEGORY) } +
            action("tag", OrganizationActionKind.TAG) +
            action("note", OrganizationActionKind.NOTE) +
            action("new", OrganizationActionKind.CATEGORY_SUGGESTION)
        val selected = defaultOrganizationSelection(actions)
        assertEquals(100, selected.actionIds.size)
        assertTrue(selected.truncated)
        assertFalse("note" in selected.actionIds)
        assertFalse("new" in selected.actionIds)
        assertTrue("tag" !in selected.actionIds)
    }

    @Test
    fun selectionToggleRefusesMoreThanLimitAndCanDeselect() {
        val first = action("a", OrganizationActionKind.CATEGORY)
        val second = action("b", OrganizationActionKind.TAG)
        val selected = updateOrganizationSelection(emptySet(), first, true, limit = 1)
        assertEquals(setOf("a"), selected)
        assertEquals(setOf("a"), updateOrganizationSelection(selected, second, true, limit = 1))
        assertEquals(emptySet<String>(), updateOrganizationSelection(selected, first, false, limit = 1))
        assertEquals(emptySet<String>(), updateOrganizationSelection(emptySet(), action("note", OrganizationActionKind.NOTE), true))
    }

    @Test
    fun selectedIdsFollowServerActionOrderAndSkipNonSelectable() {
        val actions = listOf(
            action("a", OrganizationActionKind.CATEGORY),
            action("note", OrganizationActionKind.NOTE),
            action("b", OrganizationActionKind.TAG),
        )
        assertEquals(listOf("a", "b"), selectedOrganizationActionIds(actions, setOf("b", "note", "a")))
    }

    @Test
    fun cardParserKeepsDisplayFactsAndSeparatesNoteSuggestions() {
        val card = parseOrganizationCard(cardJson())
        assertEquals("run-1", card.runId)
        assertEquals(2, card.eligibleCount)
        assertEquals(2, card.selectableActions.size)
        assertEquals(1, card.noteSuggestions.size)
        assertEquals(1, card.templateProposalCount)
        val category = card.categoryActions.single()
        assertEquals("2026-08-05", category.transactionDateLabel)
        assertEquals(3500L, category.transactionAmountCents)
        assertEquals("交通", category.beforeCategoryName)
        assertEquals("餐饮", category.afterCategoryName)
        assertEquals("工作餐", card.noteSuggestions.single().suggestedNote)
    }

    @Test
    fun applyResultAndErrorsParseWithoutFabricatingSuccess() {
        val result = parseOrganizationApplyResult(
            JSONObject()
                .put("operationId", "op-1")
                .put("status", "applied")
                .put("appliedActions", JSONArray(listOf("a", "b"))),
        )
        assertEquals("op-1", result.operationId)
        assertEquals(listOf("a", "b"), result.appliedActions)
        assertThrows(IllegalArgumentException::class.java) {
            parseOrganizationApplyResult(JSONObject().put("operationId", "op").put("status", "running"))
        }
        assertTrue(organizationApplyErrorMessage("AI_NOT_CONFIGURED", null).contains("AI 接口"))
        assertEquals(
            "自定义超限提示",
            organizationApplyErrorMessage("AI_ORGANIZATION_OVER_CAP", "自定义超限提示"),
        )
    }

    @Test
    fun unknownActionKindFailsClosed() {
        val json = cardJson()
        json.getJSONArray("actions").getJSONObject(0).put("kind", "invented")
        assertThrows(IllegalArgumentException::class.java) {
            parseOrganizationCard(json)
        }
    }

    private fun action(id: String, kind: OrganizationActionKind) = OrganizationAction(
        actionId = id,
        kind = kind,
        transactionId = if (kind == OrganizationActionKind.CATEGORY_SUGGESTION) null else "tx-$id",
        transactionDateLabel = "2026-08-05",
        transactionAmountCents = 100,
        transactionType = 0,
        beforeCategoryId = null,
        beforeCategoryName = null,
        afterCategoryId = null,
        afterCategoryName = null,
        beforeTags = emptyList(),
        afterTags = emptyList(),
        proposedCategoryName = null,
        proposedParentCategoryName = null,
        reason = "reason",
        confidence = 0.5,
    )

    private fun cardJson(): JSONObject {
        val actions = JSONArray()
            .put(
                JSONObject()
                    .put("actionId", "category-1")
                    .put("kind", "category")
                    .put("transactionId", "tx-1")
                    .put("transactionDateLabel", "2026-08-05")
                    .put("transactionAmountCents", 3500)
                    .put("transactionType", 0)
                    .put("beforeCategoryId", "transport")
                    .put("beforeCategoryName", "交通")
                    .put("afterCategoryId", "food")
                    .put("afterCategoryName", "餐饮")
                    .put("beforeTags", JSONArray())
                    .put("afterTags", JSONArray())
                    .put("reason", "午餐")
                    .put("confidence", 0.92),
            )
            .put(
                JSONObject()
                    .put("actionId", "tag-1")
                    .put("kind", "tag")
                    .put("transactionId", "tx-2")
                    .put("transactionDateLabel", "2026-08-06")
                    .put("transactionAmountCents", 1200)
                    .put("transactionType", 0)
                    .put("beforeCategoryId", JSONObject.NULL)
                    .put("beforeCategoryName", JSONObject.NULL)
                    .put("afterCategoryId", JSONObject.NULL)
                    .put("afterCategoryName", JSONObject.NULL)
                    .put("beforeTags", JSONArray())
                    .put("afterTags", JSONArray(listOf("工作餐")))
                    .put("reason", "标签")
                    .put("confidence", 0.8),
            )
        val notes = JSONArray().put(
            JSONObject()
                .put("actionId", "note-1")
                .put("transactionId", "tx-2")
                .put("transactionDateLabel", "2026-08-06")
                .put("transactionAmountCents", 1200)
                .put("transactionType", 0)
                .put("suggestedNote", "工作餐"),
        )
        val templates = JSONArray().put(JSONObject().put("actionId", "template-1"))
        return JSONObject()
            .put("runId", "run-1")
            .put("status", "ready")
            .put("startDate", "2026-08-01")
            .put("endDate", "2026-08-31")
            .put("eligibleCount", 2)
            .put("completedCount", 2)
            .put("version", 1000)
            .put("expiresAt", 2000)
            .put("actions", actions)
            .put("noteSuggestions", notes)
            .put("templateProposals", templates)
    }
}
