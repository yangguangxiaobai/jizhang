package com.yansuu1.jizhang.ui

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * JVM regressions for the refund seed applied when a user records a refund of an
 * expense: pre-linked original, empty amount, today, visible income leaf category
 * and the original receiving account only while it is still active.
 */
class TransactionRefundSeedHelperTest {

    private val today = "2026-10-22"

    private fun expense(accountId: String = "acc-original") = JSONObject()
        .put("id", "tx-expense-1")
        .put("type", 0)
        .put("amountCents", 5000L)
        .put("categoryId", "cat-food")
        .put("accountId", accountId)
        .put("date", parseDateInput("2026-10-01"))
        .put("note", "午饭")
        .put("isRefund", false)

    private val incomeLeaf = JSONObject()
        .put("id", "cat-income-refund")
        .put("name", "退款")
        .put("parentId", "cat-income-parent")

    private val incomeParent = JSONObject()
        .put("id", "cat-income-parent")
        .put("name", "其他收入")
        .put("type", 1)

    @Test
    fun seedPrefillsLinksTodayAndEmptyAmountWithoutTouchingTheOriginal() {
        val seed = TransactionRefundSeedHelper.buildRefundSeed(
            original = expense(),
            incomeCategories = listOf(incomeParent, incomeLeaf),
            incomeParentIds = setOf("cat-income-parent"),
            activeAccountIds = setOf("acc-original", "acc-other"),
            todayText = today,
        )
        val draft = seed.toDraft()

        assertEquals("tx-expense-1", seed.originalTransactionId)
        assertEquals(TransactionEditorHelper.INCOME_TYPE, draft.type)
        assertTrue(draft.isRefund)
        assertEquals("tx-expense-1", draft.refundLinks)
        // The original total is not the refundable remainder, so the amount stays empty.
        assertEquals("", draft.amountText)
        assertEquals(today, draft.dateText)
        // Parent categories are never seeded: the server rejects them.
        assertEquals("cat-income-refund", draft.categoryId)
        // The original receiving account is reused while it is still selectable.
        assertEquals("acc-original", draft.accountId)
        assertFalse(seed.originalAccountUnavailable)
        assertEquals("", draft.note)
        assertEquals("", draft.tagsText)
    }

    @Test
    fun inactiveOriginalAccountLeavesAnExplicitEmptyChoice() {
        val seed = TransactionRefundSeedHelper.buildRefundSeed(
            original = expense(accountId = "acc-deleted"),
            incomeCategories = listOf(incomeLeaf),
            incomeParentIds = emptySet(),
            activeAccountIds = setOf("acc-original"),
            todayText = today,
        )
        val draft = seed.toDraft()

        assertTrue(seed.originalAccountUnavailable)
        assertEquals("", draft.accountId)
        assertEquals("", draft.amountText)
        // Never silently substitute the first active account.
        assertFalse(draft.accountId == "acc-original")
        // An amount alone is not enough: the account still needs an explicit choice.
        assertEquals(
            TransactionEditorHelper.AMOUNT_ERROR,
            TransactionEditorHelper.validate(draft, emptySet(), refundAccountUnavailable = true),
        )
        assertEquals(
            TransactionEditorHelper.REFUND_ACCOUNT_UNAVAILABLE_ERROR,
            TransactionEditorHelper.validate(
                draft.copy(amountText = "20.00"),
                emptySet(),
                refundAccountUnavailable = true,
            ),
        )
    }

    @Test
    fun missingIncomeLeafCategorySeedsNothingInsteadOfAParentCategory() {
        val seed = TransactionRefundSeedHelper.buildRefundSeed(
            original = expense(),
            incomeCategories = listOf(incomeParent),
            incomeParentIds = setOf("cat-income-parent"),
            activeAccountIds = setOf("acc-original"),
            todayText = today,
        )
        assertEquals("", seed.categoryId)
        assertEquals("", seed.toDraft().categoryId)
    }

    @Test
    fun seededDraftIsTheDiscardBaselineSoAnUntouchedRefundIsNotDirty() {
        val seed = TransactionRefundSeedHelper.buildRefundSeed(
            original = expense(),
            incomeCategories = listOf(incomeLeaf),
            incomeParentIds = emptySet(),
            activeAccountIds = setOf("acc-original"),
            todayText = today,
        )
        val applied = seed.toDraft()
        val sameDraft = TransactionEditorDraft(
            type = applied.type,
            amountText = applied.amountText,
            categoryId = applied.categoryId,
            accountId = applied.accountId,
            dateText = applied.dateText,
            note = applied.note,
            tagsText = applied.tagsText,
            refundLinks = applied.refundLinks,
            isRefund = applied.isRefund,
        )
        assertEquals(applied, sameDraft)
    }

    @Test
    fun seedPayloadPostsANewIncomeAndNeverAsksToModifyTheOriginal() {
        val seed = TransactionRefundSeedHelper.buildRefundSeed(
            original = expense(),
            incomeCategories = listOf(incomeLeaf),
            incomeParentIds = emptySet(),
            activeAccountIds = setOf("acc-original"),
            todayText = today,
        )
        val filled = seed.toDraft().copy(amountText = "20.00")
        val payload = TransactionEditorHelper.buildPayload(filled)

        assertEquals(1, payload.getInt("type"))
        assertTrue(payload.getBoolean("isRefund"))
        assertEquals(2000L, payload.getLong("amountCents"))
        assertEquals("cat-income-refund", payload.getString("categoryId"))
        assertEquals("acc-original", payload.getString("accountId"))
        assertEquals(today, dateInput(payload.getLong("date")))
        val links = payload.getJSONArray("refundLinkedTxIds")
        assertEquals(1, links.length())
        assertEquals("tx-expense-1", links.getString(0))
        // The original record's own fields are untouched by the seed.
        assertEquals(5000L, expense().getLong("amountCents"))
    }

    @Test
    fun nonExpenseOrAlreadyRefundedRecordsAreRefused() {
        assertTrue(TransactionRefundSeedHelper.isRefundableExpense(expense()))
        assertFalse(TransactionRefundSeedHelper.isRefundableExpense(expense().put("type", 1)))
        assertFalse(TransactionRefundSeedHelper.isRefundableExpense(expense().put("isRefund", true)))
        assertFalse(TransactionRefundSeedHelper.isRefundableExpense(JSONObject().put("type", 0)))

        try {
            TransactionRefundSeedHelper.buildRefundSeed(
                original = expense().put("type", 1),
                incomeCategories = listOf(incomeLeaf),
                incomeParentIds = emptySet(),
                activeAccountIds = setOf("acc-original"),
                todayText = today,
            )
            fail("Seeded a refund from a non-expense record")
        } catch (_: IllegalArgumentException) {
            // Reported to the user as a blocking load error; nothing is seeded.
        }
    }
}
