package com.yansuu1.jizhang.ui

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TransactionEditorPurposeTest {

    private fun sampleDraft(
        type: Int = TransactionEditorHelper.EXPENSE_TYPE,
        purpose: String? = null,
    ) = TransactionEditorDraft(
        type = type,
        amountText = "50.00",
        categoryId = "cat-food",
        accountId = "acc-cash",
        dateText = "2026-10-27",
        note = "午餐",
        tagsText = "餐饮",
        refundLinks = "",
        isRefund = false,
        financialPurpose = purpose,
    )

    @Test
    fun draftFromTransaction_decodesExpenseFinancialPurpose() {
        val expenseWithPurpose = JSONObject().apply {
            put("id", "tx-1")
            put("type", TransactionEditorHelper.EXPENSE_TYPE)
            put("amountCents", 5000L)
            put("categoryId", "cat-food")
            put("accountId", "acc-1")
            put("date", 1700000000000L)
            put("note", "买菜")
            put("financialPurpose", "essentials")
        }
        assertEquals("essentials", TransactionEditorHelper.draftFromTransaction(expenseWithPurpose).financialPurpose)

        val expenseWithoutPurpose = JSONObject().apply {
            put("id", "tx-2")
            put("type", TransactionEditorHelper.EXPENSE_TYPE)
            put("amountCents", 3000L)
            put("categoryId", "cat-food")
            put("accountId", "acc-1")
            put("date", 1700000000000L)
        }
        assertNull(TransactionEditorHelper.draftFromTransaction(expenseWithoutPurpose).financialPurpose)
        assertFalse(TransactionEditorStateHelper.hasPurposeField(expenseWithoutPurpose))
    }

    @Test
    fun draftFromTransaction_incomeClearsFinancialPurpose() {
        val incomeWithPurpose = JSONObject().apply {
            put("id", "tx-3")
            put("type", TransactionEditorHelper.INCOME_TYPE)
            put("amountCents", 10000L)
            put("categoryId", "cat-salary")
            put("accountId", "acc-bank")
            put("date", 1700000000000L)
            put("financialPurpose", "essentials")
        }
        assertNull(
            "收入账单解析时必须清理用途",
            TransactionEditorHelper.draftFromTransaction(incomeWithPurpose).financialPurpose,
        )
    }

    @Test
    fun draftFromTransaction_neverCoercesMissingOrUnsafeCentsToZero() {
        val missing = JSONObject().put("id", "tx-4").put("type", 0)
        assertEquals("", TransactionEditorStateHelper.safeAmountText(missing))

        val unsafe = JSONObject()
            .put("id", "tx-5")
            .put("type", 0)
            .put("amountCents", 9_007_199_254_740_992L)
        assertEquals("", TransactionEditorStateHelper.safeAmountText(unsafe))

        val fractional = JSONObject()
            .put("id", "tx-6")
            .put("type", 0)
            .put("amountCents", 12.5)
        assertEquals("", TransactionEditorStateHelper.safeAmountText(fractional))

        val normal = JSONObject()
            .put("id", "tx-7")
            .put("type", 0)
            .put("amountCents", 1234L)
        assertEquals("12.34", TransactionEditorStateHelper.safeAmountText(normal))
    }

    @Test
    fun validate_financialPurposeConstraints() {
        assertNull(TransactionEditorHelper.validate(sampleDraft(purpose = "essentials"), emptySet()))
        assertNull(TransactionEditorHelper.validate(sampleDraft(purpose = "joy"), emptySet()))
        assertNull(TransactionEditorHelper.validate(sampleDraft(purpose = null), emptySet()))

        assertEquals(
            "理财用途必须是必要开支或随心消费",
            TransactionEditorHelper.validate(sampleDraft(purpose = "invalid_purpose"), emptySet()),
        )
        assertEquals(
            "非支出账单不可指定理财用途",
            TransactionEditorHelper.validate(
                sampleDraft(type = TransactionEditorHelper.INCOME_TYPE, purpose = "essentials"),
                emptySet(),
            ),
        )
    }

    @Test
    fun ordinaryPayloadOmitsPurposeSoUnchangedEditsNeverSendIt() {
        val payload = TransactionEditorHelper.buildPayload(sampleDraft(purpose = null))
        assertFalse("普通保存不能携带 financialPurpose", payload.has("financialPurpose"))
        assertFalse(payload.has("operationId"))
        assertFalse(payload.has("expectedFinancialPurposeRevision"))
        assertFalse(payload.has("expectedTransactionToken"))
        assertEquals(9, payload.length())
    }

    @Test
    fun unchangedPurposeEditUsesOmitPlanEvenOnSupportedServer() {
        val baseline = sampleDraft(purpose = "essentials")
        val current = sampleDraft(purpose = "essentials")
        val plan = TransactionEditorStateHelper.planPurpose(
            create = false,
            baseline = baseline,
            current = current,
            capability = FinancialPurposeCapability.SUPPORTED,
        )
        assertEquals(TransactionEditorPurposePlan.OMIT, plan)
        assertFalse(TransactionEditorStateHelper.buildPayload(current, plan).has("financialPurpose"))
    }

    @Test
    fun explicitPurposeChangeCarriesGuardsAndFullCombinedPayload() {
        val baseline = sampleDraft(purpose = "essentials")
        val current = sampleDraft(purpose = "joy")
        val snapshot = FinancialPurposeSnapshot(
            transactionId = "tx-1",
            transactionToken = "token-abc",
            revision = 4L,
            financialPurpose = "essentials",
        )
        val plan = TransactionEditorStateHelper.planPurpose(
            create = false,
            baseline = baseline,
            current = current,
            capability = FinancialPurposeCapability.SUPPORTED,
            snapshot = snapshot,
            operationId = "op-1",
        )
        val payload = TransactionEditorStateHelper.buildPayload(current, plan)

        assertEquals("joy", payload.getString("financialPurpose"))
        assertEquals("op-1", payload.getString("operationId"))
        assertEquals(4L, payload.getLong("expectedFinancialPurposeRevision"))
        assertEquals("token-abc", payload.getString("expectedTransactionToken"))
        // The combined PATCH still contains every ordinary editable field.
        assertEquals(5000L, payload.getLong("amountCents"))
        assertEquals("cat-food", payload.getString("categoryId"))
        assertEquals("acc-cash", payload.getString("accountId"))
        assertTrue(payload.has("tags"))
        assertTrue(payload.has("refundLinkedTxIds"))
    }

    @Test
    fun explicitClearSendsNullAndGuards() {
        val baseline = sampleDraft(purpose = "joy")
        val current = sampleDraft(purpose = null)
        val plan = TransactionEditorStateHelper.planPurpose(
            create = false,
            baseline = baseline,
            current = current,
            capability = FinancialPurposeCapability.SUPPORTED,
            snapshot = FinancialPurposeSnapshot("tx-1", "token", 2L, "joy"),
            operationId = "op-2",
        )
        val payload = TransactionEditorStateHelper.buildPayload(current, plan)
        assertTrue(payload.has("financialPurpose"))
        assertTrue(payload.isNull("financialPurpose"))
        assertEquals("op-2", payload.getString("operationId"))
        assertEquals(2L, payload.getLong("expectedFinancialPurposeRevision"))
    }

    @Test
    fun stalePurposeSnapshotBlocksInsteadOfWritingAStaleOverride() {
        val baseline = sampleDraft(purpose = "essentials")
        val current = sampleDraft(purpose = "joy")
        val snapshot = FinancialPurposeSnapshot("tx-1", "token", 2L, "joy")
        try {
            TransactionEditorStateHelper.planPurpose(
                create = false,
                baseline = baseline,
                current = current,
                capability = FinancialPurposeCapability.SUPPORTED,
                snapshot = snapshot,
                operationId = "op-3",
            )
            throw AssertionError("expected stale snapshot rejection")
        } catch (e: IllegalStateException) {
            assertEquals(TransactionEditorStateHelper.PURPOSE_RELOAD_MESSAGE, e.message)
        }
    }

    @Test
    fun legacyAndUnknownServersOmitPurposeEvenWhenDraftChanged() {
        val baseline = sampleDraft(purpose = null)
        val current = sampleDraft(purpose = "joy")
        for (capability in listOf(
            FinancialPurposeCapability.LEGACY_UNSUPPORTED,
            FinancialPurposeCapability.UNKNOWN,
        )) {
            val plan = TransactionEditorStateHelper.planPurpose(
                create = false,
                baseline = baseline,
                current = current,
                capability = capability,
            )
            assertEquals(TransactionEditorPurposePlan.OMIT, plan)
            assertFalse(TransactionEditorStateHelper.buildPayload(current, plan).has("financialPurpose"))
        }
    }

    @Test
    fun incomeConversionOmitsPurposeAndLetsTheBackendClearImplicitly() {
        val baseline = sampleDraft(purpose = "essentials")
        val current = sampleDraft(type = TransactionEditorHelper.INCOME_TYPE, purpose = null)
        val plan = TransactionEditorStateHelper.planPurpose(
            create = false,
            baseline = baseline,
            current = current,
            capability = FinancialPurposeCapability.SUPPORTED,
            snapshot = FinancialPurposeSnapshot("tx-1", "token", 1L, "essentials"),
            operationId = "unused",
        )
        assertEquals(TransactionEditorPurposePlan.OMIT, plan)
        val payload = TransactionEditorStateHelper.buildPayload(current, plan)
        assertFalse(payload.has("financialPurpose"))
        assertFalse(payload.has("operationId"))
        assertFalse(payload.has("expectedFinancialPurposeRevision"))
        assertFalse(payload.has("expectedTransactionToken"))
    }

    @Test
    fun createWithPurposeCarriesOperationIdButNoRevisionGuard() {
        val baseline = sampleDraft(purpose = null)
        val current = sampleDraft(purpose = "essentials")
        val plan = TransactionEditorStateHelper.planPurpose(
            create = true,
            baseline = baseline,
            current = current,
            capability = FinancialPurposeCapability.SUPPORTED,
            operationId = "op-create",
        )
        val payload = TransactionEditorStateHelper.buildPayload(current, plan)
        assertEquals("essentials", payload.getString("financialPurpose"))
        assertEquals("op-create", payload.getString("operationId"))
        assertFalse(payload.has("expectedFinancialPurposeRevision"))
        assertFalse(payload.has("expectedTransactionToken"))
    }

    @Test
    fun draftEquality_detectsDirtyPurpose() {
        val d1 = sampleDraft(purpose = null)
        val d2 = sampleDraft(purpose = "essentials")
        val d3 = sampleDraft(purpose = "joy")

        assertNotEquals(d1, d2)
        assertNotEquals(d2, d3)
        assertEquals(d1, sampleDraft(purpose = null))
    }

}
