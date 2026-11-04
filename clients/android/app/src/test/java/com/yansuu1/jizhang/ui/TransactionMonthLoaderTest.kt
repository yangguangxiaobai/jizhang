package com.yansuu1.jizhang.ui

import java.time.Instant
import java.util.TimeZone
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

class TransactionMonthLoaderTest {

    private val originalTimeZone = TimeZone.getDefault()

    @Before
    fun useStableDeviceTimeZone() {
        TimeZone.setDefault(TimeZone.getTimeZone("Asia/Shanghai"))
    }

    @After
    fun restoreDeviceTimeZone() {
        TimeZone.setDefault(originalTimeZone)
    }

    // ── complete-month loader ────────────────────────────────────────────────

    @Test
    fun loadsCompleteMonthBeyondFiveHundredRowsAndIgnoresQueryPaging() = runBlocking {
        val seenParams = mutableListOf<Map<String, String>>()
        val total = 1203
        val query = TransactionQuery(
            monthOffset = 2,
            typeFilter = 0,
            accountId = "acc-1",
            categoryId = "cat-food",
            tag = "dinner",
            search = "hotpot",
            searchAllHistory = false,
            page = 7,
            pageSize = 50,
        )

        val result = loadTransactionMonth(
            query = query,
            from = 1_700_000_000_000L,
            to = 1_700_267_200_000L,
        ) { params ->
            seenParams += params
            normalPage(total, params).put("searchVersion", 1).put("searchRevision", "a".repeat(64))
        }

        assertEquals(total, result.total)
        assertEquals(total, result.items.size)
        assertEquals(total, result.items.map { it.getString("id") }.toSet().size)

        assertEquals(listOf(0, 500, 1000), seenParams.map { it.getValue("offset").toInt() })
        assertEquals(listOf(500, 500, 203), seenParams.map { it.getValue("limit").toInt() })

        val first = seenParams.first()
        assertEquals("0", first["type"])
        assertEquals("acc-1", first["accountId"])
        assertEquals("cat-food", first["categoryId"])
        assertEquals("dinner", first["tag"])
        assertEquals("hotpot", first["search"])
        assertFalse(first.containsKey("q"))
        assertEquals("1700000000000", first["from"])
        assertEquals("1700267200000", first["to"])
        assertFalse(first.containsKey("page"))
        assertFalse(first.containsKey("pageSize"))
    }

    @Test
    fun loadsEmptyMonthOnceAtOffsetZero() = runBlocking {
        var calls = 0
        val result = loadTransactionMonth(
            query = TransactionQuery(),
            from = 1_700_000_000_000L,
            to = 1_700_267_200_000L,
        ) { params ->
            calls++
            assertEquals("0", params["offset"])
            normalPage(total = 0, params = params)
        }

        assertEquals(0, result.total)
        assertTrue(result.items.isEmpty())
        assertEquals(1, calls)
    }

    @Test
    fun rejectsTotalThatChangesBetweenPages() = runBlocking {
        var calls = 0
        val error = assertFails {
            runBlocking {
                loadTransactionMonth(
                    query = TransactionQuery(),
                    from = 1_700_000_000_000L,
                    to = 1_700_267_200_000L,
                ) { _ ->
                    calls++
                    if (calls == 1) monthPage(total = 700, offset = 0, count = 500)
                    else monthPage(total = 701, offset = 500, count = 200)
                }
            }
        }

        assertTrue(error is IllegalStateException)
        assertTrue(error.message.orEmpty().contains("total changed"))
    }

    @Test
    fun rejectsDuplicateIdsAcrossPages() = runBlocking {
        var calls = 0
        val error = assertFails {
            runBlocking {
                loadTransactionMonth(
                    query = TransactionQuery(),
                    from = 1_700_000_000_000L,
                    to = 1_700_267_200_000L,
                ) { _ ->
                    calls++
                    if (calls == 1) {
                        monthPage(total = 600, offset = 0, count = 500)
                    } else {
                        monthPage(total = 600, offset = 500, count = 100).apply {
                            getJSONArray("items").getJSONObject(0).put("id", "tx-0")
                        }
                    }
                }
            }
        }

        assertTrue(error is IllegalStateException)
        assertTrue(error.message.orEmpty().contains("Duplicate transaction id"))
    }

    @Test
    fun rejectsEmptyPageBeforeReachingTotal() = runBlocking {
        var calls = 0
        val error = assertFails {
            runBlocking {
                loadTransactionMonth(
                    query = TransactionQuery(),
                    from = 1_700_000_000_000L,
                    to = 1_700_267_200_000L,
                ) { _ ->
                    calls++
                    if (calls == 1) monthPage(total = 600, offset = 0, count = 500)
                    else monthPage(total = 600, offset = 500, count = 0)
                }
            }
        }

        assertTrue(error is IllegalStateException)
        assertTrue(error.message.orEmpty().contains("Empty page"))
    }

    @Test
    fun rejectsShortPageBeforeReachingTotal() = runBlocking {
        var calls = 0
        val error = assertFails {
            runBlocking {
                loadTransactionMonth(
                    query = TransactionQuery(),
                    from = 1_700_000_000_000L,
                    to = 1_700_267_200_000L,
                ) { _ ->
                    calls++
                    if (calls == 1) monthPage(total = 600, offset = 0, count = 500)
                    else monthPage(total = 600, offset = 500, count = 50)
                }
            }
        }

        assertTrue(error is IllegalStateException)
        assertTrue(error.message.orEmpty().contains("returned 50 of 100"))
    }

    @Test
    fun rejectsRowWithoutId() = runBlocking {
        val error = assertFails {
            runBlocking {
                loadTransactionMonth(
                    query = TransactionQuery(),
                    from = 1_700_000_000_000L,
                    to = 1_700_267_200_000L,
                ) { _ ->
                    JSONObject()
                        .put("total", 1)
                        .put(
                            "items",
                            JSONArray().put(JSONObject().put("date", 1_700_000_000_000L)),
                        )
                }
            }
        }

        assertTrue(error is IllegalArgumentException)
        assertTrue(error.message.orEmpty().contains("id"))
    }

    @Test
    fun rejectsRowsBeyondReportedTotal() = runBlocking {
        val error = assertFails {
            runBlocking {
                loadTransactionMonth(
                    query = TransactionQuery(),
                    from = 1_700_000_000_000L,
                    to = 1_700_267_200_000L,
                ) { _ ->
                    monthPage(total = 1, offset = 0, count = 2)
                }
            }
        }

        assertTrue(error is IllegalStateException)
        assertTrue(error.message.orEmpty().contains("reported a total"))
    }

    @Test
    fun rejectsMonthAboveResourceCap() = runBlocking {
        var calls = 0
        val error = assertFails {
            runBlocking {
                loadTransactionMonth(
                    query = TransactionQuery(),
                    from = 1_700_000_000_000L,
                    to = 1_700_267_200_000L,
                ) { _ ->
                    calls++
                    monthPage(total = TRANSACTION_MONTH_MAX_ROWS + 1, offset = 0, count = 0)
                }
            }
        }

        assertTrue(error is IllegalArgumentException)
        assertTrue(error.message.orEmpty().contains(TRANSACTION_MONTH_MAX_ROWS.toString()))
        assertEquals(1, calls)
    }

    @Test
    fun propagatesCancellationFromFetch() = runBlocking {
        val cancellation = CancellationException("cancelled by caller")
        var calls = 0

        val thrown = try {
            loadTransactionMonth(
                query = TransactionQuery(),
                from = 1_700_000_000_000L,
                to = 1_700_267_200_000L,
            ) { params ->
                calls++
                if (calls == 1) normalPage(total = 1000, params = params)
                else throw cancellation
            }
            null
        } catch (error: Throwable) {
            error
        }

        assertNotNull(thrown)
        assertTrue(thrown is CancellationException)
        assertEquals("cancelled by caller", thrown?.message)
        assertEquals(2, calls)
    }

    // ── daily summary decoding ───────────────────────────────────────────────

    @Test
    fun decodesAuthoritativeDailySummariesWithoutArithmetic() {
        val response = JSONObject().put(
            "items",
            JSONArray().apply {
                put(daySummary("2026-10-22", expenseCents = 12_345L, incomeCents = 0L, count = 3))
                put(daySummary("2026-10-21", expenseCents = 0L, incomeCents = 678L, count = 2))
            },
        )

        val summaries = decodeTransactionDaySummaries(response)

        assertEquals(2, summaries.size)
        assertEquals(
            TransactionDaySummary("2026-10-22", 12_345L, 0L, 3),
            summaries["2026-10-22"],
        )
        assertEquals(
            TransactionDaySummary("2026-10-21", 0L, 678L, 2),
            summaries["2026-10-21"],
        )
    }

    @Test
    fun decodesEmptySummaryList() {
        assertTrue(decodeTransactionDaySummaries(JSONObject().put("items", JSONArray())).isEmpty())
    }

    @Test
    fun rejectsMissingOrNonArraySummaryItems() {
        assertDecodeFails(JSONObject())
        assertDecodeFails(JSONObject().put("items", JSONObject.NULL))
        assertDecodeFails(JSONObject().put("items", JSONObject()))
        assertDecodeFails(
            JSONObject().put("items", JSONArray().put("not-an-object")),
        )
    }

    @Test
    fun rejectsInvalidSummaryDays() {
        assertDecodeFails(
            JSONObject().put(
                "items",
                JSONArray().put(
                    JSONObject()
                        .put("expenseCents", 0L)
                        .put("incomeCents", 0L)
                        .put("count", 0),
                ),
            ),
        )
        assertDecodeFails(summaryResponse(daySummary("2026-1-01", 0L, 0L, 1)))
        assertDecodeFails(summaryResponse(daySummary("2026-02-30", 0L, 0L, 1)))
        assertDecodeFails(summaryResponse(daySummary("2026-13-01", 0L, 0L, 1)))
        assertDecodeFails(
            summaryResponse(
                daySummary("2026-10-22", 0L, 0L, 1),
                daySummary("2026-10-22", 0L, 0L, 1),
            ),
        )
    }

    @Test
    fun rejectsInvalidSummaryAmountsAndCounts() {
        assertDecodeFails(
            summaryResponse(
                JSONObject()
                    .put("day", "2026-10-22")
                    .put("incomeCents", 0L)
                    .put("count", 1),
            ),
        )
        assertDecodeFails(summaryResponse(daySummary("2026-10-22", -1L, 0L, 1)))
        assertDecodeFails(summaryResponse(daySummary("2026-10-22", 1.5, 0L, 1)))
        assertDecodeFails(
            summaryResponse(
                JSONObject()
                    .put("day", "2026-10-22")
                    .put("expenseCents", "100")
                    .put("incomeCents", 0L)
                    .put("count", 1),
            ),
        )
        assertDecodeFails(
            summaryResponse(daySummary("2026-10-22", 9_007_199_254_740_992L, 0L, 1)),
        )
        assertDecodeFails(summaryResponse(daySummary("2026-10-22", 0L, -1L, 1)))
        assertDecodeFails(
            summaryResponse(
                JSONObject()
                    .put("day", "2026-10-22")
                    .put("expenseCents", 0L)
                    .put("incomeCents", 0L),
            ),
        )
        assertDecodeFails(summaryResponse(daySummary("2026-10-22", 0L, 0L, -1)))
        assertDecodeFails(
            summaryResponse(
                JSONObject()
                    .put("day", "2026-10-22")
                    .put("expenseCents", 0L)
                    .put("incomeCents", 0L)
                    .put("count", 1.5),
            ),
        )
        assertDecodeFails(
            summaryResponse(
                JSONObject()
                    .put("day", "2026-10-22")
                    .put("expenseCents", 0L)
                    .put("incomeCents", 0L)
                    .put("count", 2_147_483_648L),
            ),
        )
    }

    // ── day key and count validation ─────────────────────────────────────────

    @Test
    fun transactionDayKeyUsesRequestedDeviceTimeZone() {
        val instant = Instant.parse("2026-10-21T17:30:00Z").toEpochMilli()

        assertEquals("2026-10-22", transactionDayKey(instant, TimeZone.getTimeZone("Asia/Shanghai")))
        assertEquals("2026-10-21", transactionDayKey(instant, TimeZone.getTimeZone("UTC")))
        assertEquals("2026-10-21", transactionDayKey(instant, TimeZone.getTimeZone("America/New_York")))
        // The test default is Asia/Shanghai; production defaults to TimeZone.getDefault().
        assertEquals("2026-10-22", transactionDayKey(instant))
    }

    @Test
    fun transactionSummaryTimeZoneMapsWholeHourFixedOffsets() {
        assertEquals("Etc/UTC", transactionSummaryTimeZone(TimeZone.getTimeZone("UTC")))
        assertEquals("Etc/UTC", transactionSummaryTimeZone(TimeZone.getTimeZone("GMT+00:00")))
        assertEquals("Etc/GMT-8", transactionSummaryTimeZone(TimeZone.getTimeZone("GMT+08:00")))
        assertEquals("Etc/GMT+5", transactionSummaryTimeZone(TimeZone.getTimeZone("GMT-05:00")))
        assertEquals("Etc/GMT-14", transactionSummaryTimeZone(TimeZone.getTimeZone("GMT+14:00")))
        assertEquals("Etc/GMT+12", transactionSummaryTimeZone(TimeZone.getTimeZone("GMT-12:00")))
    }

    @Test
    fun transactionSummaryTimeZonePreservesRegionsAndUnsupportedFractionalOffsets() {
        assertEquals("Asia/Shanghai", transactionSummaryTimeZone(TimeZone.getTimeZone("Asia/Shanghai")))
        // No exact IANA zone is assumed for a fractional fixed offset.
        assertEquals("GMT+05:30", transactionSummaryTimeZone(TimeZone.getTimeZone("GMT+05:30")))
    }

    @Test
    fun validatesMatchingDailySummaryCounts() {
        val day22 = epoch("2026-10-22T12:00:00+08:00")
        val day21 = epoch("2026-10-21T12:00:00+08:00")
        val items = listOf(
            transaction("tx-1", day22),
            transaction("tx-2", day22),
            transaction("tx-3", day21),
        )
        val summaries = mapOf(
            "2026-10-22" to dayCount("2026-10-22", 2),
            "2026-10-21" to dayCount("2026-10-21", 1),
        )

        validateTransactionDaySummaryCounts(items, summaries)
    }

    @Test
    fun validatesEmptyItemsAndSummaries() {
        validateTransactionDaySummaryCounts(emptyList(), emptyMap())
    }

    @Test
    fun rejectsSummaryMissingADayPresentInRows() {
        val day22 = epoch("2026-10-22T12:00:00+08:00")
        val day21 = epoch("2026-10-21T12:00:00+08:00")
        val items = listOf(transaction("tx-1", day22), transaction("tx-2", day21))

        val error = assertFails {
            validateTransactionDaySummaryCounts(
                items,
                mapOf("2026-10-22" to dayCount("2026-10-22", 1)),
            )
        }

        assertTrue(error is IllegalArgumentException)
        assertTrue(error.message.orEmpty().contains("Missing daily summary"))
    }

    @Test
    fun rejectsSummaryWithAnExtraDay() {
        val day22 = epoch("2026-10-22T12:00:00+08:00")
        val items = listOf(transaction("tx-1", day22))

        val error = assertFails {
            validateTransactionDaySummaryCounts(
                items,
                mapOf(
                    "2026-10-22" to dayCount("2026-10-22", 1),
                    "2026-10-20" to dayCount("2026-10-20", 1),
                ),
            )
        }

        assertTrue(error is IllegalArgumentException)
        assertTrue(error.message.orEmpty().contains("unexpected day"))
    }

    @Test
    fun rejectsSummaryCountMismatchForADay() {
        val day22 = epoch("2026-10-22T12:00:00+08:00")
        val items = listOf(transaction("tx-1", day22), transaction("tx-2", day22))

        val error = assertFails {
            validateTransactionDaySummaryCounts(
                items,
                mapOf("2026-10-22" to dayCount("2026-10-22", 1)),
            )
        }

        assertTrue(error is IllegalArgumentException)
        assertTrue(error.message.orEmpty().contains("count mismatch"))
    }

    @Test
    fun rejectsRowWithoutNumericDateDuringCountValidation() {
        val error = assertFails {
            validateTransactionDaySummaryCounts(
                listOf(JSONObject().put("id", "tx-1")),
                mapOf("2026-10-22" to dayCount("2026-10-22", 1)),
            )
        }

        assertTrue(error is IllegalArgumentException)
        assertTrue(error.message.orEmpty().contains("date"))
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private fun normalPage(total: Int, params: Map<String, String>): JSONObject {
        val offset = params.getValue("offset").toInt()
        val limit = params.getValue("limit").toInt()
        val count = (total - offset).coerceAtLeast(0).coerceAtMost(limit)
        return monthPage(total, offset, count)
    }

    private fun monthPage(total: Int, offset: Int, count: Int): JSONObject {
        val rows = JSONArray()
        for (index in 0 until count) {
            rows.put(
                JSONObject()
                    .put("id", "tx-${offset + index}")
                    .put("date", 1_700_000_000_000L + offset + index),
            )
        }
        return JSONObject().put("total", total).put("items", rows)
    }

    private fun daySummary(day: String, expenseCents: Long, incomeCents: Long, count: Int): JSONObject =
        JSONObject()
            .put("day", day)
            .put("expenseCents", expenseCents)
            .put("incomeCents", incomeCents)
            .put("count", count)

    private fun daySummary(day: String, expenseCents: Double, incomeCents: Long, count: Int): JSONObject =
        JSONObject()
            .put("day", day)
            .put("expenseCents", expenseCents)
            .put("incomeCents", incomeCents)
            .put("count", count)

    private fun summaryResponse(vararg items: JSONObject): JSONObject =
        JSONObject().put("items", JSONArray().apply { items.forEach { put(it) } })

    private fun assertDecodeFails(response: JSONObject) {
        val error = assertFails { decodeTransactionDaySummaries(response) }
        assertTrue(error is IllegalArgumentException)
    }

    private fun transaction(id: String, date: Long): JSONObject =
        JSONObject().put("id", id).put("date", date)

    private fun dayCount(day: String, count: Int): TransactionDaySummary =
        TransactionDaySummary(day = day, expenseCents = 0L, incomeCents = 0L, count = count)

    private fun epoch(isoInstant: String): Long = Instant.parse(isoInstant).toEpochMilli()

    private fun assertFails(block: () -> Unit): Throwable {
        try {
            block()
        } catch (error: Throwable) {
            if (error is AssertionError) throw error
            return error
        }
        fail("Expected an exception")
        throw AssertionError("unreachable")
    }
}
