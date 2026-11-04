package com.yansuu1.jizhang.ui

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM regressions for the production editor helpers the sheet actually calls:
 * validation, the complete payload, keypad input and the single gated save path.
 */
class TransactionEditorHelperTest {

    private fun draft(
        type: Int = TransactionEditorHelper.EXPENSE_TYPE,
        amountText: String = "12.34",
        categoryId: String = "cat-food",
        accountId: String = "acc-1",
        dateText: String = "2026-10-22",
        note: String = "",
        tagsText: String = "",
        refundLinks: String = "",
        isRefund: Boolean = false,
    ) = TransactionEditorDraft(
        type = type,
        amountText = amountText,
        categoryId = categoryId,
        accountId = accountId,
        dateText = dateText,
        note = note,
        tagsText = tagsText,
        refundLinks = refundLinks,
        isRefund = isRefund,
    )

    private fun strings(obj: JSONObject, key: String): List<String> {
        val array = obj.getJSONArray(key)
        return List(array.length()) { array.getString(it) }
    }

    // ── validation ───────────────────────────────────────────────────────────

    @Test
    fun amountMustBeGreaterThanZeroBeforeAnythingElse() {
        assertEquals(TransactionEditorHelper.AMOUNT_ERROR, TransactionEditorHelper.validate(draft(amountText = ""), emptySet()))
        assertEquals(TransactionEditorHelper.AMOUNT_ERROR, TransactionEditorHelper.validate(draft(amountText = "0"), emptySet()))
        assertEquals(TransactionEditorHelper.AMOUNT_ERROR, TransactionEditorHelper.validate(draft(amountText = "abc"), emptySet()))
        assertNull(TransactionEditorHelper.validate(draft(amountText = "0.01"), emptySet()))
    }

    @Test
    fun categoryAndAccountAreRequiredAndParentCategoryIsRejected() {
        assertEquals(
            TransactionEditorHelper.TARGET_ERROR,
            TransactionEditorHelper.validate(draft(categoryId = ""), emptySet()),
        )
        assertEquals(
            TransactionEditorHelper.TARGET_ERROR,
            TransactionEditorHelper.validate(draft(accountId = ""), emptySet()),
        )
        assertEquals(
            TransactionEditorHelper.PARENT_CATEGORY_ERROR,
            TransactionEditorHelper.validate(draft(categoryId = "cat-parent"), setOf("cat-parent")),
        )
    }

    @Test
    fun refundSeedWithoutOriginalAccountRequiresAnExplicitChoice() {
        assertEquals(
            TransactionEditorHelper.REFUND_ACCOUNT_UNAVAILABLE_ERROR,
            TransactionEditorHelper.validate(
                draft(type = TransactionEditorHelper.INCOME_TYPE, accountId = "", isRefund = true, refundLinks = "tx-1"),
                emptySet(),
                refundAccountUnavailable = true,
            ),
        )
        // An explicitly chosen account makes the same draft valid.
        assertNull(
            TransactionEditorHelper.validate(
                draft(type = TransactionEditorHelper.INCOME_TYPE, accountId = "acc-2", isRefund = true, refundLinks = "tx-1"),
                emptySet(),
                refundAccountUnavailable = true,
            ),
        )
    }

    @Test
    fun invalidDatesSurfaceTheStrictParserMessage() {
        val message = TransactionEditorHelper.validate(draft(dateText = "2026-02-30"), emptySet())
        assertNotNull(message)
        assertTrue(message!!.contains("YYYY-MM-DD"))
    }

    // ── payload ──────────────────────────────────────────────────────────────

    @Test
    fun ordinaryExpensePayloadKeepsCompleteFieldsAndEmptyLinks() {
        val payload = TransactionEditorHelper.buildPayload(
            draft(note = "午饭", tagsText = "午餐, 工作日", refundLinks = "tx-ignored"),
        )
        assertEquals(9, payload.length())
        assertEquals(0, payload.getInt("type"))
        assertEquals(1234L, payload.getLong("amountCents"))
        assertEquals("cat-food", payload.getString("categoryId"))
        assertEquals("acc-1", payload.getString("accountId"))
        assertEquals("2026-10-22", dateInput(payload.getLong("date")))
        assertEquals("午饭", payload.getString("note"))
        assertFalse(payload.getBoolean("isRefund"))
        assertEquals(listOf("午餐", "工作日"), strings(payload, "tags"))
        assertTrue(strings(payload, "refundLinkedTxIds").isEmpty())
    }

    @Test
    fun refundIncomePayloadLinksTheOriginalExpenseAndIgnoresExpenseLinks() {
        val refund = TransactionEditorHelper.buildPayload(
            draft(
                type = TransactionEditorHelper.INCOME_TYPE,
                amountText = "25.5",
                categoryId = "cat-income-refund",
                note = "餐饮退款",
                tagsText = "退款，午餐",
                refundLinks = "tx-exp-1,tx-exp-2",
                isRefund = true,
            ),
        )
        assertEquals(1, refund.getInt("type"))
        assertEquals(2550L, refund.getLong("amountCents"))
        assertTrue(refund.getBoolean("isRefund"))
        assertEquals(listOf("tx-exp-1", "tx-exp-2"), strings(refund, "refundLinkedTxIds"))
        // Full-width comma splits the same way as ASCII.
        assertEquals(listOf("退款", "午餐"), strings(refund, "tags"))

        val plainIncome = TransactionEditorHelper.buildPayload(
            draft(type = TransactionEditorHelper.INCOME_TYPE, refundLinks = "tx-exp-1", isRefund = false),
        )
        assertFalse(plainIncome.getBoolean("isRefund"))
        assertTrue(strings(plainIncome, "refundLinkedTxIds").isEmpty())
    }

    @Test
    fun payloadMapSerializesBackToTheSameWireJson() {
        val edited = draft(
            type = TransactionEditorHelper.INCOME_TYPE,
            amountText = "9.99",
            note = "退款",
            tagsText = "a,b",
            refundLinks = "tx-exp-1",
            isRefund = true,
        )
        val fromJson = TransactionEditorHelper.buildPayload(edited)
        val fromMap = JSONObject(TransactionEditorHelper.buildPayloadMap(edited))
        assertEquals(fromJson.toString(), fromMap.toString())
        // Repository conversion must keep arrays as arrays, not stringified values.
        assertTrue(fromMap.get("tags") is org.json.JSONArray)
        assertTrue(fromMap.get("refundLinkedTxIds") is org.json.JSONArray)
    }

    @Test
    fun editingRebuildsEveryFieldFromTheServerRecord() {
        val server = JSONObject()
            .put("id", "tx-9")
            .put("type", 1)
            .put("amountCents", 12345L)
            .put("categoryId", "cat-income")
            .put("accountId", "acc-9")
            .put("date", parseDateInput("2026-09-30"))
            .put("note", "旧备注")
            .put("isRefund", true)
            .put("tags", org.json.JSONArray(listOf("甲", "乙")))
            .put("refundLinkedTxIds", org.json.JSONArray(listOf("tx-exp-9")))
        val rebuilt = TransactionEditorHelper.draftFromTransaction(server)
        assertEquals(1, rebuilt.type)
        assertEquals("123.45", rebuilt.amountText)
        assertEquals("cat-income", rebuilt.categoryId)
        assertEquals("acc-9", rebuilt.accountId)
        assertEquals("2026-09-30", rebuilt.dateText)
        assertEquals("旧备注", rebuilt.note)
        assertEquals("甲, 乙", rebuilt.tagsText)
        assertEquals("tx-exp-9", rebuilt.refundLinks)
        assertTrue(rebuilt.isRefund)
        // Round-trip: saving an untouched edit keeps the same payload values.
        val payload = TransactionEditorHelper.buildPayload(rebuilt)
        assertEquals(12345L, payload.getLong("amountCents"))
        assertEquals(listOf("tx-exp-9"), strings(payload, "refundLinkedTxIds"))
        assertEquals("2026-09-30", dateInput(payload.getLong("date")))
    }

    @Test
    fun firstLeafCategorySkipsParentsAndNeverInventsOne() {
        val leaf = JSONObject().put("id", "cat-child").put("name", "午餐").put("parentId", "cat-parent")
        val parent = JSONObject().put("id", "cat-parent").put("name", "餐饮")
        assertEquals(
            "cat-child",
            TransactionEditorHelper.firstLeafCategoryId(listOf(parent, leaf), parentCategoryIds(listOf(parent, leaf))),
        )
        assertEquals("", TransactionEditorHelper.firstLeafCategoryId(listOf(parent), setOf("cat-parent")))
        assertEquals("", TransactionEditorHelper.firstLeafCategoryId(emptyList(), emptySet()))
    }

    @Test
    fun multiValueSplittingTrimsAndDropsEmptyEntries() {
        assertEquals(listOf("a", "b"), TransactionEditorHelper.splitMultiValue(" a , b ,, "))
        assertEquals(listOf("甲", "乙"), TransactionEditorHelper.splitMultiValue("甲，乙"))
        assertTrue(TransactionEditorHelper.splitMultiValue("   ").isEmpty())
    }

    // ── keypad input ─────────────────────────────────────────────────────────

    @Test
    fun keypadAppendsDigitsWithSingleDotTwoDecimalsAndSafeBackspace() {
        assertEquals("1", appendKeypadInput("", "1"))
        assertEquals("12", appendKeypadInput("1", "2"))
        assertEquals("0.", appendKeypadInput("", "."))
        assertEquals("1.2", appendKeypadInput("1.", "2"))
        assertEquals("1.23", appendKeypadInput("1.2", "3"))
        assertEquals("1.23", appendKeypadInput("1.23", "4"))
        assertEquals("1.23", appendKeypadInput("1.23", "."))
        assertEquals("7", appendKeypadInput("0", "7"))
        assertEquals("1", appendKeypadInput("1.", "back"))
        assertEquals("", appendKeypadInput("", "back"))
        assertEquals("", appendKeypadInput("1", "back"))
        // Unsupported keys leave the value untouched rather than corrupting it.
        assertEquals("1.2", appendKeypadInput("1.2", "="))
        // Twelve characters is the input ceiling.
        assertEquals("123456789012", appendKeypadInput("123456789012", "3"))
    }

    @Test
    fun typedAmountsRoundTripThroughTheSameParserUsedForSaving() {
        var text = ""
        for (key in listOf("9", "9", ".", "9", "5")) text = appendKeypadInput(text, key)
        assertEquals("99.95", text)
        assertEquals(9995L, parseYuanToCents(text))
        assertEquals(9995L, TransactionEditorHelper.buildPayload(draft(amountText = text)).getLong("amountCents"))
    }

    // ── single gated save path ───────────────────────────────────────────────

    @Test
    fun secondTapWhileTheFirstWriteIsInFlightCannotWriteAgain() {
        val saving = AtomicBoolean(false)
        val started = CountDownLatch(1)
        val release = CompletableDeferred<Unit>()
        val writes = AtomicInteger(0)
        val createFlags = AtomicReference(mutableListOf<Boolean>())
        val saved = AtomicBoolean(false)
        val error = AtomicReference<String?>(null)
        val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
        val submitter = TransactionEditorSubmitter(
            isSaving = { saving.get() },
            setSaving = { saving.set(it) },
            onError = { error.set(it) },
            onAuthExpired = {},
            write = { create, _ ->
                writes.incrementAndGet()
                createFlags.get().add(create)
                started.countDown()
                release.await()
            },
            onSaved = { saved.set(true) },
        )

        assertTrue(submitter.submit(scope, create = true, draft = draft(), parentIds = emptySet()))
        assertTrue(started.await(3, TimeUnit.SECONDS))
        assertTrue(saving.get())
        // Both entry points (top bar and bottom button) hit the same gate.
        assertFalse(submitter.submit(scope, create = true, draft = draft(), parentIds = emptySet()))
        assertFalse(submitter.submit(scope, create = false, draft = draft(), parentIds = emptySet()))

        release.complete(Unit)
        val deadline = System.currentTimeMillis() + 3_000
        while (saving.get() && System.currentTimeMillis() < deadline) Thread.sleep(10)

        assertFalse(saving.get())
        assertEquals(1, writes.get())
        assertEquals(listOf(true), createFlags.get())
        assertTrue(saved.get())
        assertNull(error.get())
    }

    @Test
    fun invalidDraftNeverReachesTheNetworkAndKeepsTheGateOpen() {
        val saving = AtomicBoolean(false)
        val writes = AtomicInteger(0)
        val error = AtomicReference<String?>(null)
        val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
        val submitter = TransactionEditorSubmitter(
            isSaving = { saving.get() },
            setSaving = { saving.set(it) },
            onError = { error.set(it) },
            onAuthExpired = {},
            write = { _, _ -> writes.incrementAndGet() },
            onSaved = {},
        )

        assertFalse(submitter.submit(scope, create = true, draft = draft(amountText = ""), parentIds = emptySet()))
        assertEquals(0, writes.get())
        assertEquals(TransactionEditorHelper.AMOUNT_ERROR, error.get())
        assertFalse(saving.get())
        // Parent category is rejected before the request too.
        assertFalse(
            submitter.submit(
                scope,
                create = false,
                draft = draft(categoryId = "cat-parent"),
                parentIds = setOf("cat-parent"),
            ),
        )
        assertEquals(TransactionEditorHelper.PARENT_CATEGORY_ERROR, error.get())
        assertEquals(0, writes.get())
    }

    @Test
    fun authExpiryGoesToTheSessionHandlerAndFailureLeavesADraftRetryable() {
        val saving = AtomicBoolean(false)
        val errors = AtomicReference(mutableListOf<String>())
        var authExpired = 0
        var savedCount = 0
        val attempts = AtomicInteger(0)
        val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
        val submitter = TransactionEditorSubmitter(
            isSaving = { saving.get() },
            setSaving = { saving.set(it) },
            onError = { errors.get().add(it) },
            onAuthExpired = { authExpired++ },
            write = { _, _ ->
                when (attempts.incrementAndGet()) {
                    1 -> throw com.yansuu1.jizhang.net.AuthExpiredException()
                    2 -> throw IllegalStateException("网络错误")
                    else -> Unit
                }
            },
            onSaved = { savedCount++ },
        )

        assertTrue(submitter.submit(scope, create = true, draft = draft(), parentIds = emptySet()))
        waitUntil { !saving.get() }
        assertEquals(1, authExpired)
        assertTrue(errors.get().isEmpty())

        assertTrue(submitter.submit(scope, create = true, draft = draft(), parentIds = emptySet()))
        waitUntil { !saving.get() }
        assertEquals(listOf("网络错误"), errors.get())
        assertEquals(0, savedCount)

        // The draft was kept and the same gate still allows a deliberate retry.
        assertTrue(submitter.submit(scope, create = true, draft = draft(), parentIds = emptySet()))
        waitUntil { !saving.get() }
        assertEquals(1, savedCount)
        assertEquals(3, attempts.get())
    }

    private fun waitUntil(condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + 3_000
        while (!condition() && System.currentTimeMillis() < deadline) Thread.sleep(10)
        assertTrue(condition())
    }
}
