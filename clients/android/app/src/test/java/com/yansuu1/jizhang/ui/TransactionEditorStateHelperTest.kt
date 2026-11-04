package com.yansuu1.jizhang.ui

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TransactionEditorStateHelperTest {

    @Test
    fun safeAmountAcceptsOnlyNonNegativeSafeIntegralCents() {
        assertEquals(0L, TransactionEditorStateHelper.safeAmountCents(0L))
        assertEquals(1_234L, TransactionEditorStateHelper.safeAmountCents(1234))
        assertEquals(1_234L, TransactionEditorStateHelper.safeAmountCents(1234.0))
        assertEquals(
            TransactionEditorStateHelper.MAX_SAFE_CENTS,
            TransactionEditorStateHelper.safeAmountCents(TransactionEditorStateHelper.MAX_SAFE_CENTS),
        )
        assertNull(TransactionEditorStateHelper.safeAmountCents(-1L))
        assertNull(TransactionEditorStateHelper.safeAmountCents(1.5))
        assertNull(TransactionEditorStateHelper.safeAmountCents(Double.NaN))
        assertNull(TransactionEditorStateHelper.safeAmountCents("1234"))
        assertNull(TransactionEditorStateHelper.safeAmountCents(null))
        assertNull(
            TransactionEditorStateHelper.safeAmountCents(TransactionEditorStateHelper.MAX_SAFE_CENTS + 1),
        )
    }

    @Test
    fun baselinePreservesOptionalPurposeFieldPresenceWithoutInventingNull() {
        val withoutField = JSONObject()
            .put("type", 0)
            .put("amountCents", 100L)
        val withExplicitNull = JSONObject(withoutField.toString()).put("financialPurpose", JSONObject.NULL)

        assertFalse(TransactionEditorStateHelper.hasPurposeField(withoutField))
        assertTrue(TransactionEditorStateHelper.hasPurposeField(withExplicitNull))
        assertNull(TransactionEditorStateHelper.baselineDraft(withoutField).financialPurpose)
        assertNull(TransactionEditorStateHelper.baselineDraft(withExplicitNull).financialPurpose)
        // Missing and explicit-null are both "no override" for the dirty check;
        // the payload omits the field either way.
        assertEquals(
            TransactionEditorStateHelper.baselineDraft(withoutField),
            TransactionEditorStateHelper.baselineDraft(withExplicitNull),
        )
        assertFalse(
            TransactionEditorHelper.buildPayload(TransactionEditorStateHelper.baselineDraft(withExplicitNull))
                .has("financialPurpose"),
        )
    }

    @Test
    fun missingAmountForcesValidationInsteadOfBecomingZero() {
        val item = JSONObject().put("type", 0).put("note", "legacy")
        assertEquals("", TransactionEditorStateHelper.safeAmountText(item))
        val draft = TransactionEditorStateHelper.baselineDraft(item)
        assertEquals(TransactionEditorHelper.AMOUNT_ERROR, TransactionEditorHelper.validate(draft, emptySet()))
    }

    @Test
    fun independentDraftAndUnsafePurposeStillValidateExplicitly() {
        val baseline = TransactionEditorDraft(
            amountText = "10.00",
            categoryId = "cat",
            accountId = "acc",
            dateText = "2026-10-27",
            financialPurpose = "essentials",
        )
        val current = baseline.copy(financialPurpose = "joy")
        val plan = TransactionEditorStateHelper.planPurpose(
            create = false,
            baseline = baseline,
            current = current,
            capability = FinancialPurposeCapability.SUPPORTED,
            snapshot = FinancialPurposeSnapshot("tx", "token", 1L, "essentials"),
            operationId = "op",
        )
        assertTrue(plan.includePurpose)
        assertEquals("joy", TransactionEditorStateHelper.buildPayload(current, plan).getString("financialPurpose"))

        val invalid = TransactionEditorDraft(
            amountText = "10.00",
            categoryId = "cat",
            accountId = "acc",
            dateText = "2026-10-27",
            financialPurpose = "growth",
        )
        assertEquals(
            "理财用途必须是必要开支或随心消费",
            TransactionEditorHelper.validate(invalid, emptySet()),
        )
    }

    @Test
    fun payloadMapKeepsArraysAsArraysForRepositoryConversion() {
        val draft = TransactionEditorDraft(
            amountText = "10.00",
            categoryId = "cat",
            accountId = "acc",
            dateText = "2026-10-27",
            tagsText = "a,b",
        )
        val plan = TransactionEditorPurposePlan.OMIT
        val map = TransactionEditorStateHelper.buildPayloadMap(draft, plan)
        assertTrue(map["tags"] is org.json.JSONArray)
        assertTrue(map["refundLinkedTxIds"] is org.json.JSONArray)
        assertEquals(9, map.size)
    }
}
