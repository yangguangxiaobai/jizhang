package com.yansuu1.jizhang.ui

import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Integration of the production complete-month loader and existing coordinator.
 * These tests exercise their orchestration contract, not TransactionsTab Compose
 * execution or its inline summary-publication guard.
 */
class TransactionMonthIntegrationTest {
    @Test
    fun completeMonthBeyondFiveHundredPublishesWithoutLegacyPageCorrection() = runBlocking {
        val query = TransactionQuery(accountId = "historical-account", typeFilter = 0)
        val coordinator = TransactionLoadCoordinator()
        val generation = coordinator.startLoad(query)
        val offsets = mutableListOf<Int>()
        val result = loadTransactionMonth(query, 1000L, 2000L) { params ->
            assertEquals("historical-account", params["accountId"])
            assertEquals("0", params["type"])
            val offset = params.getValue("offset").toInt()
            offsets += offset
            page(total = 1203, offset = offset, limit = params.getValue("limit").toInt())
        }

        val outcome = coordinator.onLoadSuccess(generation, query, result.items, result.total)

        assertTrue(outcome is TransactionLoadCoordinator.LoadResultOutcome.Applied)
        assertEquals(listOf(0, 500, 1000), offsets)
        assertEquals(1203, coordinator.state.items.size)
        assertEquals(1203, coordinator.state.total)
        assertEquals(query, coordinator.state.loadedQuery)
        assertEquals(0, coordinator.state.currentQuery.page)
        assertFalse(coordinator.state.loading)
        assertNull(coordinator.state.error)
    }

    @Test
    fun scopeSwitchRejectsOldCallbacksAfterRowsPublishedWhileSummaryPending() = runBlocking {
        val oldQuery = TransactionQuery(accountId = "account-a")
        val coordinator = TransactionLoadCoordinator()
        val oldGeneration = coordinator.startLoad(oldQuery)
        val result = loadTransactionMonth(oldQuery, 1000L, 2000L) { params ->
            page(501, params.getValue("offset").toInt(), params.getValue("limit").toInt())
        }
        coordinator.onLoadSuccess(oldGeneration, oldQuery, result.items, result.total)
        // Optional summary may still be outstanding after this successful publish.
        assertFalse(coordinator.state.loading)
        val newQuery = oldQuery.copy(monthOffset = -1, accountId = "account-b")
        coordinator.startLoad(newQuery)
        val newState = coordinator.state

        assertTrue(newState.items.isEmpty())
        assertNull(newState.total)
        assertTrue(newState.loading)
        assertSame(
            TransactionLoadCoordinator.LoadResultOutcome.RejectedStale,
            coordinator.onLoadSuccess(oldGeneration, oldQuery, result.items, result.total),
        )
        assertFalse(coordinator.onLoadError(oldGeneration, oldQuery, "late failure"))
        assertFalse(coordinator.onLoadFinally(oldGeneration, oldQuery))
        assertEquals(newState, coordinator.state)
    }

    @Test
    fun sameQueryRefreshRejectsOldGenerationAndRetainsCompleteRows() = runBlocking {
        val query = TransactionQuery(accountId = "account-a")
        val coordinator = TransactionLoadCoordinator()
        val oldGeneration = coordinator.startLoad(query)
        val result = loadTransactionMonth(query, 1000L, 2000L) { params ->
            page(501, params.getValue("offset").toInt(), params.getValue("limit").toInt())
        }
        coordinator.onLoadSuccess(oldGeneration, query, result.items, result.total)
        val refreshGeneration = coordinator.startLoad(query)
        val refreshState = coordinator.state

        assertEquals(501, refreshState.items.size)
        assertEquals(501, refreshState.total)
        assertTrue(refreshState.loading)
        assertSame(
            TransactionLoadCoordinator.LoadResultOutcome.RejectedStale,
            coordinator.onLoadSuccess(oldGeneration, query, emptyList(), 0),
        )
        assertFalse(coordinator.onLoadError(oldGeneration, query, "old summary-era error"))
        assertFalse(coordinator.onLoadFinally(oldGeneration, query))
        assertEquals(refreshState, coordinator.state)
        assertTrue(coordinator.onLoadError(refreshGeneration, query, "refresh failed"))
        assertEquals(result.items, coordinator.state.items)
        assertEquals(501, coordinator.state.total)
        assertFalse(coordinator.state.loading)
        assertEquals("refresh failed", coordinator.state.error)
    }

    @Test
    fun failedOptionalSummaryDoesNotInvalidateAlreadyPublishedCompleteRows() = runBlocking {
        val query = TransactionQuery()
        val coordinator = TransactionLoadCoordinator()
        val generation = coordinator.startLoad(query)
        val result = loadTransactionMonth(query, 1000L, 2000L) { params ->
            page(501, params.getValue("offset").toInt(), params.getValue("limit").toInt())
        }
        coordinator.onLoadSuccess(generation, query, result.items, result.total)
        val published = coordinator.state
        val optionalSummary = CompletableDeferred<JSONObject>()
        assertFalse(optionalSummary.isCompleted)
        assertFalse(published.loading)
        assertEquals(501, published.items.size)

        optionalSummary.completeExceptionally(IOException("daily-summary unavailable on old server"))
        val failure = try {
            optionalSummary.await()
            null
        } catch (error: IOException) {
            error
        }

        assertTrue(failure is IOException)
        // Summary failures have their own UI state, not onLoadError. The production
        // coordinator must already be complete, so finally cannot clear/change it.
        assertFalse(coordinator.onLoadFinally(generation, query))
        assertEquals(published, coordinator.state)
        assertNull(coordinator.state.error)
        assertEquals(query, coordinator.state.loadedQuery)
    }

    private fun page(total: Int, offset: Int, limit: Int): JSONObject {
        val rows = JSONArray()
        repeat(minOf(limit, total - offset)) { index ->
            rows.put(JSONObject().put("id", "tx-${offset + index}").put("date", 1500L))
        }
        return JSONObject().put("items", rows).put("total", total)
    }
}
