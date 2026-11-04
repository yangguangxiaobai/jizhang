package com.yansuu1.jizhang.ui

import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** Production query/loader behavior, not assertions against Compose source text. */
class TransactionDrilldownQueryTest {
    private val scope = FinancialScope("https://ledger.example", "reader")
    private val query = TransactionDrilldownQuery(
        from = 1_000L,
        to = 2_000L,
        categoryId = "food-leaf",
        categoryName = "餐饮",
        accountId = "historical-account",
        rangeLabel = "服务端固定范围",
        expectedTotalCents = 12_345L,
    )

    @Test
    fun preservesExactExpenseCategoryAccountAndHalfOpenRange() {
        assertEquals(
            mapOf(
                "from" to "1000", "to" to "2000", "type" to "0",
                "categoryId" to "food-leaf", "accountId" to "historical-account",
                "limit" to "50", "offset" to "0",
            ),
            query.transactionQuery().toServerParams(query.from, query.to),
        )
        val allAccounts = query.copy(accountId = null).transactionQuery().toServerParams(query.from, query.to)
        assertFalse(allAccounts.containsKey("accountId"))
        assertFalse(allAccounts.containsKey("q"))
        assertFalse(allAccounts.containsKey("tag"))
    }

    @Test
    fun invalidQueryCannotSilentlyBroadenCategoryOrAccountScope() {
        listOf(
            { query.copy(from = query.to) },
            { query.copy(categoryId = " ") },
            { query.copy(accountId = " ") },
            { query.copy(expectedTotalCents = -1L) },
        ).forEach { invalid -> assertFailure<IllegalArgumentException> { invalid() } }
    }

    @Test
    fun loadsAllPagesBeyondFiveHundredAndUsesServerMoneyVerbatim() = runBlocking {
        val calls = mutableListOf<Map<String, String>>()
        val seenQueries = mutableListOf<TransactionDrilldownQuery>()
        var scopeReads = 0
        val result = loadTransactionDrilldown(
            query = query,
            resolveScope = { scopeReads++; scope },
            fetchSummary = { requested ->
                seenQueries += requested
                summary(count = 1_203, cents = query.expectedTotalCents)
            },
            fetchTransactions = { params ->
                calls += params
                page(total = 1_203, params = params)
            },
        )

        assertEquals(listOf(query), seenQueries)
        assertEquals(listOf("0", "500", "1000"), calls.map { it["offset"] })
        assertEquals(listOf("500", "500", "203"), calls.map { it["limit"] })
        calls.forEach { params ->
            assertEquals("1000", params["from"])
            assertEquals("2000", params["to"])
            assertEquals("0", params["type"])
            assertEquals("food-leaf", params["categoryId"])
            assertEquals("historical-account", params["accountId"])
            assertEquals("12345", params["expectedExpenseCents"])
            assertEquals("1203", params["expectedExpenseCount"])
        }
        assertEquals(1_203, result.items.size)
        assertEquals(1_203, result.expenseCount)
        // Every row is 7 cents: the fixture deliberately cannot produce this server total.
        // The loader validates counts/predicates, never computes money from list rows.
        assertEquals(12_345L, result.totalCents)
        assertFalse(result.statisticsChanged)
        assertEquals(2, scopeReads)
    }

    @Test
    fun amountChangeIsWarningMetadataNotFailedCompletenessOrAnExactMatchClaim() = runBlocking {
        val result = loadTransactionDrilldown(
            query,
            resolveScope = { scope },
            fetchSummary = { summary(count = 1, cents = 98_765L) },
            fetchTransactions = { page(1, it) },
        )
        assertEquals(98_765L, result.totalCents)
        assertEquals(1, result.expenseCount)
        assertTrue(result.statisticsChanged)
        assertEquals(1, result.items.size)
    }

    @Test
    fun successfulEmptyScopeStillRequiresAuthoritativeZeroCountAndAmount() = runBlocking {
        val result = loadTransactionDrilldown(
            query.copy(expectedTotalCents = 0),
            resolveScope = { scope },
            fetchSummary = { summary(count = 0, cents = 0) },
            fetchTransactions = { page(0, it) },
        )
        assertTrue(result.items.isEmpty())
        assertEquals(0, result.expenseCount)
        assertEquals(0L, result.totalCents)
        assertFalse(result.statisticsChanged)
    }

    @Test
    fun scopedSummaryMustContainExactRangeCategoryCountAndIntegerCents() {
        val invalidSummaries = listOf(
            summary(1).put("from", query.from + 1),
            summary(1).put("to", query.to + 1),
            summary(1).apply { remove("categoryId") },
            summary(1).apply { remove("accountId") },
            summary(1).put("categoryId", "food-parent"),
            summary(1).put("accountId", "other-account"),
            summary(1).put("accountId", JSONObject.NULL),
            summary(1).apply { getJSONArray("items").getJSONObject(0).put("categoryId", "food-parent") },
            summary(1).apply { remove("expenseCount") },
            summary(1).put("expenseCount", 1.5),
            summary(1).put("totalCents", "12345"),
            summary(1).put("totalCents", JSONObject.NULL),
            summary(1).put("totalCents", 9_007_199_254_740_992L),
            summary(1).apply { getJSONArray("items").getJSONObject(0).put("amountCents", 1L) },
            summary(0, cents = 1L),
        )
        invalidSummaries.forEach { response ->
            var listCalls = 0
            assertFailure<IllegalArgumentException> {
                runBlocking {
                    loadTransactionDrilldown(
                        query,
                        resolveScope = { scope },
                        fetchSummary = { response },
                        fetchTransactions = { listCalls++; page(1, it) },
                    )
                }
            }
            assertEquals(0, listCalls)
        }
    }

    @Test
    fun summaryCountMustAgreeWithFullyLoadedListBeforeAnythingIsComplete() {
        assertFailure<IllegalArgumentException> {
            runBlocking {
                loadTransactionDrilldown(
                    query,
                    resolveScope = { scope },
                    fetchSummary = { summary(2) },
                    fetchTransactions = { page(1, it) },
                )
            }
        }
    }

    @Test
    fun refusesOverLimitSummaryWithoutRequestingAnyListPage() {
        var listCalls = 0
        assertFailure<IllegalArgumentException> {
            runBlocking {
                loadTransactionDrilldown(
                    query,
                    resolveScope = { scope },
                    fetchSummary = { summary(TRANSACTION_MONTH_MAX_ROWS + 1) },
                    fetchTransactions = { listCalls++; page(1, it) },
                )
            }
        }
        assertEquals(0, listCalls)
    }

    @Test
    fun wrongCategoryAccountTypeOrBoundaryRowsFailInsteadOfBeingFilteredAway() {
        val invalidRows = listOf(
            row().put("categoryId", "food-parent"),
            row().put("categoryId", "food-child"),
            row().put("accountId", "another-account"),
            row().put("type", 1),
            row().put("type", "0"),
            row().put("date", query.from - 1),
            row().put("date", query.to),
            row().put("date", "1500"),
            row().put("amountCents", JSONObject.NULL),
        )
        invalidRows.forEach { invalid ->
            assertFailure<IllegalArgumentException> {
                runBlocking {
                    loadTransactionDrilldown(
                        query,
                        resolveScope = { scope },
                        fetchSummary = { summary(1) },
                        fetchTransactions = { response(1, listOf(invalid)) },
                    )
                }
            }
        }
    }

    @Test
    fun allAccountsAcceptsDifferentFundingAccountsAndBothInRangeBoundaryRows() = runBlocking {
        val result = loadTransactionDrilldown(
            query.copy(accountId = null),
            resolveScope = { scope },
            fetchSummary = { summary(2).put("accountId", JSONObject.NULL) },
            fetchTransactions = { params ->
                assertFalse(params.containsKey("accountId"))
                response(2, listOf(
                    row("start").put("date", query.from),
                    row("end").put("date", query.to - 1).put("accountId", "second-account"),
                ))
            },
        )
        assertEquals(2, result.items.size)
    }

    @Test
    fun missingOrRepeatedTailNeverReturnsPartialSuccess() {
        listOf("missing", "duplicate", "changed-total").forEach { mode ->
            assertFailure<IllegalStateException> {
                runBlocking {
                    loadTransactionDrilldown(
                        query,
                        resolveScope = { scope },
                        fetchSummary = { summary(501) },
                        fetchTransactions = { params ->
                            if (params["offset"] == "0") page(501, params)
                            else when (mode) {
                                "missing" -> response(501, emptyList())
                                "duplicate" -> response(501, listOf(row("tx-0")))
                                else -> response(502, listOf(row("tx-500")))
                            }
                        },
                    )
                }
            }
        }
    }

    @Test
    fun authScopeChangeRejectsBothACompletedResultAndAnEarlierScopeError() {
        listOf(false, true).forEach { failList ->
            var scopeReads = 0
            val oldFailure = IOException("old-user error must not be published")
            val failure = assertFailure<IllegalStateException> {
                runBlocking {
                    loadTransactionDrilldown(
                        query,
                        resolveScope = {
                            scopeReads++
                            if (scopeReads == 1) scope else scope.copy(username = "other-user")
                        },
                        fetchSummary = { summary(1) },
                        fetchTransactions = { if (failList) throw oldFailure else page(1, it) },
                    )
                }
            }
            assertTrue(failure.message.orEmpty().contains("认证范围已变化"))
            assertEquals(2, scopeReads)
        }
    }

    @Test
    fun sameScopeFailureAndCancellationKeepTheirOriginalIdentity() {
        val original = IOException("unavailable")
        var scopeReads = 0
        val thrown = assertFailure<IOException> {
            runBlocking {
                loadTransactionDrilldown(
                    query,
                    resolveScope = { scopeReads++; scope },
                    fetchSummary = { throw original },
                    fetchTransactions = { error("must not fetch") },
                )
            }
        }
        assertSame(original, thrown)
        assertEquals(2, scopeReads)
        val cancellation = CancellationException("dismissed")
        val cancelled = assertFailure<CancellationException> {
            runBlocking {
                loadTransactionDrilldown(
                    query,
                    resolveScope = { scope },
                    fetchSummary = { throw cancellation },
                    fetchTransactions = { error("must not fetch") },
                )
            }
        }
        assertSame(cancellation, cancelled)
    }

    @Test
    fun delayedLoaderSuccessAndFailureCannotPublishOverTheNewAttempt() = runBlocking {
        listOf(false, true).forEach { oldFails ->
            val owner = StatsReadOwner()
            val oldTicket = owner.start()
            val tail = CompletableDeferred<Unit>()
            var visible: String
            visible = "old-loading"
            assertEquals("old-loading", visible)
            val oldJob = launch(start = CoroutineStart.UNDISPATCHED) {
                try {
                    val loaded = loadTransactionDrilldown(
                        query,
                        resolveScope = { scope },
                        fetchSummary = { summary(1) },
                        fetchTransactions = {
                            tail.await()
                            if (oldFails) throw IOException("late old failure")
                            page(1, it)
                        },
                    )
                    if (owner.owns(oldTicket)) visible = "old-success-${loaded.expenseCount}"
                } catch (error: Exception) {
                    if (owner.owns(oldTicket)) visible = "old-error"
                } finally {
                    if (owner.owns(oldTicket)) visible = "old-finally"
                }
            }
            val latest = owner.start()
            visible = "new-query-loading"
            tail.complete(Unit)
            oldJob.join()
            assertTrue(owner.owns(latest))
            assertEquals("new-query-loading", visible)
        }
    }

    @Test
    fun lateSuccessErrorAndFinallyDoNotOwnARefreshOrDisposedQuery() {
        val owner = StatsReadOwner()
        val old = owner.start()
        val latest = owner.start()
        var displayed = "new-query-loading"
        if (owner.owns(old)) displayed = "old-success"
        if (owner.owns(old)) displayed = "old-error"
        if (owner.owns(old)) displayed = "old-finally"
        assertEquals("new-query-loading", displayed)
        assertTrue(owner.owns(latest))
        owner.dispose()
        assertFalse(owner.owns(old))
        assertFalse(owner.owns(latest))
        val newQueryOwner = StatsReadOwner()
        val current = newQueryOwner.start()
        assertTrue(newQueryOwner.owns(current))
        assertFalse(owner.owns(current))
    }

    private fun summary(count: Int, cents: Long = query.expectedTotalCents): JSONObject = JSONObject()
        .put("from", query.from)
        .put("to", query.to)
        .put("accountId", query.accountId ?: JSONObject.NULL)
        .put("categoryId", query.categoryId)
        .put("totalCents", cents)
        .put("expenseCount", count)
        .put("items", JSONArray().apply {
            if (count > 0) put(JSONObject().put("categoryId", query.categoryId).put("amountCents", cents))
        })

    private fun row(id: String = "tx-0"): JSONObject = JSONObject()
        .put("id", id)
        .put("date", 1_500L)
        .put("type", 0)
        .put("categoryId", query.categoryId)
        .put("accountId", query.accountId)
        .put("amountCents", 7L)

    private fun page(total: Int, params: Map<String, String>): JSONObject {
        val offset = params.getValue("offset").toInt()
        val count = minOf(params.getValue("limit").toInt(), total - offset)
        return response(total, List(count) { row("tx-${offset + it}") })
    }

    private fun response(total: Int, items: List<JSONObject>): JSONObject = JSONObject()
        .put("total", total)
        .put("items", JSONArray(items))

    private inline fun <reified T : Throwable> assertFailure(block: () -> Unit): T {
        try {
            block()
        } catch (failure: Throwable) {
            if (failure !is T) throw AssertionError("Expected ${T::class.java.simpleName}, got $failure", failure)
            return failure
        }
        fail("Expected ${T::class.java.simpleName}")
        throw AssertionError("unreachable")
    }
}
