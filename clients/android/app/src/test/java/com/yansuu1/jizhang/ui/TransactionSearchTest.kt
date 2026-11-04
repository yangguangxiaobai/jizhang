package com.yansuu1.jizhang.ui

import java.io.File
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class TransactionSearchTest {
    private val revision = "a".repeat(64)

    @Test fun scopesAndFiltersUseNewParameter() {
        val query = TransactionQuery(search = "12%_", accountId = "a", typeFilter = 0, monthOffset = -2)
        val all = query.toServerParams(100, 200)
        assertEquals("12%_", all["search"])
        assertEquals("a", all["accountId"])
        assertEquals("0", all["type"])
        assertFalse(all.containsKey("q"))
        assertFalse(all.containsKey("from"))
        assertFalse(all.containsKey("to"))
        val month = query.copy(searchAllHistory = false).toServerParams(100, 200)
        assertEquals("100", month["from"])
        assertEquals("200", month["to"])
        val cleared = TransactionQueryHelper.clearFilters(query.copy(searchAllHistory = false))
        assertFalse(cleared.isAllHistorySearch)
        assertTrue(cleared.searchAllHistory)
        assertEquals("100", cleared.toServerParams(100, 200)["from"])
        assertEquals(0, cleared.typeFilter)
        assertEquals(-2, cleared.monthOffset)
    }

    @Test fun everyPageIncludingEmptyMustProveSearchSupport() = runBlocking {
        val query = TransactionQuery(search = "coffee")
        fun page(total: Int, start: Int, count: Int) = JSONObject().put("total", total).put("items", JSONArray().apply {
            repeat(count) { put(JSONObject().put("id", "tx-${start + it}")) }
        })
        val empty = loadTransactionMonth(query, 1, 2) { page(0, 0, 0).put("searchVersion", 1).put("searchRevision", revision) }
        assertEquals(0, empty.total)
        val emptyError = runCatching { loadTransactionMonth(query, 1, 2) { page(0, 0, 0) } }.exceptionOrNull()
        assertTrue(emptyError is IllegalStateException)
        var calls = 0
        val secondError = runCatching {
            loadTransactionMonth(query, 1, 2) {
                calls++
                if (calls == 1) page(501, 0, 500).put("searchVersion", 1).put("searchRevision", revision) else page(501, 500, 1)
            }
        }.exceptionOrNull()
        assertEquals(2, calls)
        assertTrue(secondError is IllegalStateException)
        for (invalid in listOf<Any>("1", 0, 2, JSONObject.NULL)) {
            assertTrue(runCatching { requireTransactionSearchVersion(JSONObject().put("searchVersion", invalid), true) }.isFailure)
        }
        requireTransactionSearchVersion(JSONObject(), false)
    }

    @Test fun historyLoadsAllPagesWithoutDateBoundsAndRejectsOverLimit() = runBlocking {
        val query = TransactionQuery(search = "面", accountId = "a", typeFilter = 1)
        val offsets = mutableListOf<Int>()
        val result = loadTransactionMonth(query, 100, 200) { params ->
            assertFalse(params.containsKey("from"))
            assertFalse(params.containsKey("to"))
            assertEquals("a", params["accountId"])
            assertEquals("1", params["type"])
            val offset = params.getValue("offset").toInt()
            offsets.add(offset)
            JSONObject().put("searchVersion", 1).put("searchRevision", revision).put("total", 501).put("items", JSONArray().apply {
                repeat(if (offset == 0) 500 else 1) { put(JSONObject().put("id", "tx-${offset + it}")) }
            })
        }
        assertEquals(listOf(0, 500), offsets)
        assertEquals(501, result.items.size)
        assertTrue(runCatching {
            loadTransactionMonth(query, 100, 200) {
                JSONObject().put("searchVersion", 1).put("searchRevision", revision).put("total", TRANSACTION_MONTH_MAX_ROWS + 1).put("items", JSONArray())
            }
        }.isFailure)
    }

    @Test fun changedOrMissingRevisionRejectsSameCountReplacement() = runBlocking {
        val query = TransactionQuery(search = "x")
        for (secondRevision in listOf<String?>(null, "b".repeat(64), "not-a-hash", "")) {
            var calls = 0
            val error = runCatching {
                loadTransactionMonth(query, 1, 2) {
                    calls++
                    val first = calls == 1
                    JSONObject().put("searchVersion", 1).put("total", 501).put("items", JSONArray().apply {
                        // The second page can contain unique IDs and retain the same total after a replacement.
                        repeat(if (first) 500 else 1) { put(JSONObject().put("id", "tx-${if (first) it else 501}")) }
                    }).apply {
                        if (first) put("searchRevision", revision)
                        else if (secondRevision != null) put("searchRevision", secondRevision)
                    }
                }
            }.exceptionOrNull()
            assertEquals(2, calls)
            assertTrue(error is IllegalStateException)
        }
        val emptyWithoutRevision = runCatching {
            loadTransactionMonth(query, 1, 2) { JSONObject().put("searchVersion", 1).put("total", 0).put("items", JSONArray()) }
        }.exceptionOrNull()
        assertTrue(emptyWithoutRevision is IllegalStateException)
    }

    @Test fun monthSummaryRequiresMarkerEvenWhenEmpty() {
        val empty = JSONObject().put("items", JSONArray())
        assertTrue(runCatching { decodeTransactionDaySummaries(empty, searching = true) }.isFailure)
        assertTrue(decodeTransactionDaySummaries(empty, searching = false).isEmpty())
        empty.put("searchVersion", 1).put("searchRevision", revision)
        assertTrue(decodeTransactionDaySummaries(empty, searching = true, expectedSearchRevision = revision).isEmpty())
        val changed = runCatching {
            decodeTransactionDaySummaries(empty, searching = true, expectedSearchRevision = "b".repeat(64))
        }.exceptionOrNull()
        assertTrue(changed is TransactionSearchRevisionChangedException)
        assertTrue(changed!!.message.orEmpty().contains("账单已变化"))
        empty.remove("searchRevision")
        assertTrue(runCatching { decodeTransactionDaySummaries(empty, searching = true, expectedSearchRevision = revision) }.isFailure)
    }

    @Test fun changedSummaryInvalidatesOnlyTheOwnedPublishedList() {
        val coordinator = TransactionLoadCoordinator()
        val query = TransactionQuery(search = "x", searchAllHistory = false)
        val gen = coordinator.startLoad(query)
        coordinator.onLoadSuccess(gen, query, listOf(JSONObject().put("id", "tx")), 1)
        assertTrue(coordinator.invalidateLoaded(gen, query, TransactionSearchRevisionChangedException().message.orEmpty()))
        assertTrue(coordinator.state.items.isEmpty())
        assertNull(coordinator.state.total)
        assertNull(coordinator.state.loadedQuery)
        assertTrue(coordinator.state.error.orEmpty().contains("账单已变化"))
        val newer = coordinator.startLoad(query)
        coordinator.onLoadSuccess(newer, query, listOf(JSONObject().put("id", "new")), 1)
        assertFalse(coordinator.invalidateLoaded(gen, query, "stale"))
        assertEquals("new", coordinator.state.items.single().getString("id"))
    }

    @Test fun monthSearchRefreshHidesOldRowsUntilSummaryIsResolved() {
        val coordinator = TransactionLoadCoordinator()
        val query = TransactionQuery(search = "x", searchAllHistory = false)
        val first = coordinator.startLoad(query)
        coordinator.onLoadSuccess(first, query, listOf(JSONObject().put("id", "old")), 1)
        val refresh = coordinator.startLoad(query)
        assertTrue(coordinator.state.loading)
        assertTrue(coordinator.state.items.isEmpty())
        assertNull(coordinator.state.total)
        val serverMessage = "搜索结果过多或文本过大，请缩小月份、账户或关键词范围后重试。"
        assertTrue(coordinator.invalidateLoaded(refresh, query, serverMessage))
        assertTrue(coordinator.state.items.isEmpty())
        assertEquals(serverMessage, coordinator.state.error)
        val retry = coordinator.startLoad(query)
        coordinator.onLoadSuccess(retry, query, listOf(JSONObject().put("id", "verified")), 1)
        assertEquals("verified", coordinator.state.items.single().getString("id"))
    }

    @Test fun ordinaryServerErrorIsPreservedAndDoesNotErasePriorRows() {
        val coordinator = TransactionLoadCoordinator()
        val query = TransactionQuery(search = "x")
        val first = coordinator.startLoad(query)
        coordinator.onLoadSuccess(first, query, listOf(JSONObject().put("id", "tx")), 1)
        val refresh = coordinator.startLoad(query)
        val serverMessage = "搜索结果过多或文本过大，请缩小月份、账户或关键词范围后重试。"
        assertTrue(coordinator.onLoadError(refresh, query, serverMessage))
        assertEquals(serverMessage, coordinator.state.error)
        assertEquals("tx", coordinator.state.items.single().getString("id"))
    }

    @Test fun screenWiresSnapshotInvalidationAndSkipsHistorySummary() {
        val root = generateSequence(File(requireNotNull(System.getProperty("user.dir")))) { it.parentFile }
            .first { File(it, "app/src/main/java").isDirectory || File(it, "clients/android/app/src/main/java").isDirectory }
        val android = if (File(root, "app/src/main/java").isDirectory) root else File(root, "clients/android")
        val source = File(android, "app/src/main/java/com/yansuu1/jizhang/ui/TransactionsTab.kt").readText()
        assertTrue(source.contains("if (stepQuery.isAllHistorySearch) return"))
        assertTrue(source.contains("expectedSearchRevision = result.searchRevision"))
        assertTrue(source.contains("if (!stepQuery.requiresSearchSummary)"))
        assertTrue(source.contains("if (stepQuery.requiresSearchSummary && e.status == 400)"))
        val summaryAt = source.indexOf("ledger.dailyTransactionSummary(")
        val deferredPublishAt = source.indexOf("if (stepQuery.requiresSearchSummary) {", summaryAt)
        assertTrue(summaryAt >= 0 && deferredPublishAt > summaryAt)
        assertTrue(source.substring(deferredPublishAt).contains("loadCoordinator.onLoadSuccess(stepGen, stepQuery"))
        val handler = source.substringAfter("catch (e: TransactionSearchRevisionChangedException)")
            .substringBefore("catch (e: Exception)")
        assertTrue(handler.contains("loadCoordinator.invalidateLoaded(stepGen, stepQuery"))
        assertTrue(handler.contains("return"))
        assertTrue(source.contains("e.message ?: \"加载失败\""))
    }

    @Test fun searchScopeChangesRejectOldGenerations() {
        val coordinator = TransactionLoadCoordinator()
        val all = TransactionQuery(search = "x")
        val old = coordinator.startLoad(all)
        val month = all.copy(searchAllHistory = false)
        val current = coordinator.startLoad(month)
        assertEquals(TransactionLoadCoordinator.LoadResultOutcome.RejectedStale,
            coordinator.onLoadSuccess(old, all, listOf(JSONObject().put("id", "old")), 1))
        assertFalse(coordinator.onLoadError(old, all, "old error"))
        assertFalse(coordinator.onLoadFinally(old, all))
        assertTrue(coordinator.onLoadSuccess(current, month, emptyList(), 0) is TransactionLoadCoordinator.LoadResultOutcome.Applied)
        assertTrue(coordinator.state.items.isEmpty())
    }
}
