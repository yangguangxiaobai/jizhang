package com.yansuu1.jizhang.ui

import java.util.concurrent.TimeUnit
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * MockWebServer regressions for the payload the editor helpers hand to
 * `LedgerRepository`: a refund becomes one complete POST of a new income, an edit
 * is one complete PATCH, and the original expense is never modified.
 */
class TransactionEditorNetworkContractTest {

    private fun payloadBody(draft: TransactionEditorDraft) =
        TransactionEditorHelper.buildPayload(draft).toString()
            .toRequestBody("application/json".toMediaType())

    private fun strings(obj: JSONObject, key: String): List<String> {
        val array = obj.getJSONArray(key)
        return List(array.length()) { array.getString(it) }
    }

    @Test
    fun refundPostsOneCompleteIncomeAndNeverPatchesTheOriginal() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"id":"tx-refund-1","type":1,"isRefund":true}"""))
            val draft = TransactionEditorDraft(
                type = TransactionEditorHelper.INCOME_TYPE,
                amountText = "25.50",
                categoryId = "cat-income-refund",
                accountId = "acc-original",
                dateText = "2026-10-22",
                note = "餐饮退款",
                tagsText = "退款,午餐",
                refundLinks = "tx-expense-1",
                isRefund = true,
            )
            val request = Request.Builder()
                .url(server.url("/api/v1/transactions"))
                .header("X-Requested-With", "fetch")
                .post(payloadBody(draft))
                .build()
            OkHttpClient().newCall(request).execute().use { response ->
                assertTrue(response.isSuccessful)
            }

            val recorded = server.takeRequest()
            assertEquals("POST", recorded.method)
            assertEquals("/api/v1/transactions", recorded.path)
            assertEquals("fetch", recorded.getHeader("X-Requested-With"))

            val sent = JSONObject(recorded.body.readUtf8())
            assertEquals(9, sent.length())
            assertEquals(1, sent.getInt("type"))
            assertTrue(sent.getBoolean("isRefund"))
            assertEquals(2550L, sent.getLong("amountCents"))
            assertEquals("cat-income-refund", sent.getString("categoryId"))
            assertEquals("acc-original", sent.getString("accountId"))
            assertEquals("2026-10-22", dateInput(sent.getLong("date")))
            assertEquals("餐饮退款", sent.getString("note"))
            assertEquals(listOf("退款", "午餐"), strings(sent, "tags"))
            assertEquals(listOf("tx-expense-1"), strings(sent, "refundLinkedTxIds"))

            // The original expense is untouched: no second request, so no PATCH of it.
            assertNull(server.takeRequest(300, TimeUnit.MILLISECONDS))
        }
    }

    @Test
    fun editingSendsEveryFieldSoAPatchCannotDropValues() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"id":"tx-9"}"""))
            val serverRecord = JSONObject()
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
            val request = Request.Builder()
                .url(server.url("/api/v1/transactions/tx-9"))
                .header("X-Requested-With", "fetch")
                .patch(payloadBody(TransactionEditorHelper.draftFromTransaction(serverRecord)))
                .build()
            OkHttpClient().newCall(request).execute().use { response ->
                assertTrue(response.isSuccessful)
            }

            val recorded = server.takeRequest()
            assertEquals("PATCH", recorded.method)
            assertEquals("/api/v1/transactions/tx-9", recorded.path)
            val sent = JSONObject(recorded.body.readUtf8())
            assertEquals(9, sent.length())
            assertEquals(1, sent.getInt("type"))
            assertEquals(12345L, sent.getLong("amountCents"))
            assertEquals("cat-income", sent.getString("categoryId"))
            assertEquals("acc-9", sent.getString("accountId"))
            assertEquals("2026-09-30", dateInput(sent.getLong("date")))
            assertEquals("旧备注", sent.getString("note"))
            assertTrue(sent.getBoolean("isRefund"))
            assertEquals(listOf("甲", "乙"), strings(sent, "tags"))
            assertEquals(listOf("tx-exp-9"), strings(sent, "refundLinkedTxIds"))
            assertNull(server.takeRequest(300, TimeUnit.MILLISECONDS))
        }
    }

    @Test
    fun ordinaryCreateSendsNoResidualRefundSeed() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("""{"id":"tx-new"}"""))
            var amount = ""
            for (key in listOf("1", "2", ".", "3", "4")) amount = appendKeypadInput(amount, key)
            val draft = TransactionEditorDraft(
                type = TransactionEditorHelper.EXPENSE_TYPE,
                amountText = amount,
                categoryId = "cat-food",
                accountId = "acc-1",
                dateText = "2026-10-22",
                note = "午饭",
                tagsText = "",
                refundLinks = "stale-link",
                isRefund = false,
            )
            val request = Request.Builder()
                .url(server.url("/api/v1/transactions"))
                .header("X-Requested-With", "fetch")
                .post(payloadBody(draft))
                .build()
            OkHttpClient().newCall(request).execute().use { response ->
                assertTrue(response.isSuccessful)
            }

            val sent = JSONObject(server.takeRequest().body.readUtf8())
            assertEquals("12.34", amount)
            assertEquals(0, sent.getInt("type"))
            assertEquals(1234L, sent.getLong("amountCents"))
            assertEquals(false, sent.getBoolean("isRefund"))
            assertTrue(strings(sent, "refundLinkedTxIds").isEmpty())
            assertTrue(strings(sent, "tags").isEmpty())
        }
    }
}
