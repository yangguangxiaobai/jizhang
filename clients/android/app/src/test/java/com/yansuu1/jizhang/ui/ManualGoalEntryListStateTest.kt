package com.yansuu1.jizhang.ui

import com.yansuu1.jizhang.repo.FinancialGoalEntryDto
import com.yansuu1.jizhang.repo.FinancialGoalEntryPageView
import com.yansuu1.jizhang.repo.ManualGoal
import com.yansuu1.jizhang.repo.ManualGoalEntryKind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ManualGoalEntryListStateTest {

    private fun sampleEntry(
        id: String,
        goal: ManualGoal = ManualGoal.RESERVE,
        amountCents: Long = 1000L,
        date: Long = 1700000000000L,
    ) = FinancialGoalEntryDto(
        id = id,
        goal = goal,
        kind = ManualGoalEntryKind.DEPOSIT,
        amountCents = amountCents,
        date = date,
        note = "entry-$id",
        revision = 1L,
        createdAt = date,
        updatedAt = date,
        deletedAt = null,
    )

    private fun samplePage(
        items: List<FinancialGoalEntryDto>,
        total: Int,
        revision: Long = 1L,
        hasMore: Boolean = false,
        nextCursor: String? = null,
    ) = FinancialGoalEntryPageView(
        contractVersion = 1,
        calculatedAt = 1700000000000L,
        source = "manual-confirmed",
        revision = revision,
        items = items,
        total = total,
        limit = 100,
        hasMore = hasMore,
        nextCursor = nextCursor,
    )

    @Test
    fun all235EntriesRemainReachableAndEditable() {
        val query = ManualGoalEntryQuery(goal = ManualGoal.RESERVE)
        var state = ManualGoalEntryListState(query = query)

        // Page 1: 100 items (0..99)
        val page1Items = (0 until 100).map { sampleEntry("entry-$it") }
        val page1 = samplePage(items = page1Items, total = 235, hasMore = true, nextCursor = "cursor-1")
        state = appendManualGoalEntryPage(state, page1)
        assertEquals(100, state.items.size)
        assertEquals(235, state.total)
        assertTrue(state.hasMore)
        assertEquals("cursor-1", state.nextCursor)
        assertFalse(state.restartRequired)

        // Page 2: 100 items (100..199)
        val page2Items = (100 until 200).map { sampleEntry("entry-$it") }
        val page2 = samplePage(items = page2Items, total = 235, hasMore = true, nextCursor = "cursor-2")
        state = appendManualGoalEntryPage(state, page2)
        assertEquals(200, state.items.size)
        assertTrue(state.hasMore)
        assertEquals("cursor-2", state.nextCursor)

        // Page 3: 35 items (200..234)
        val page3Items = (200 until 235).map { sampleEntry("entry-$it") }
        val page3 = samplePage(items = page3Items, total = 235, hasMore = false, nextCursor = null)
        state = appendManualGoalEntryPage(state, page3)

        // All 235 unique items present
        assertEquals(235, state.items.size)
        assertEquals(235, state.total)
        assertFalse(state.hasMore)
        assertNull(state.nextCursor)
        assertEquals(235, state.items.map { it.id }.toSet().size)

        // Earliest page records (e.g. entry-0) and latest records (entry-234) are accessible and retain identity
        val firstEntry = state.items.first()
        val lastEntry = state.items.last()
        assertEquals("entry-0", firstEntry.id)
        assertEquals("entry-234", lastEntry.id)
    }

    @Test
    fun nextPageFailurePreservesLoadedItemsAndPermitsRetry() {
        val query = ManualGoalEntryQuery()
        var state = ManualGoalEntryListState(query = query)

        val page1Items = (0 until 100).map { sampleEntry("entry-$it") }
        val page1 = samplePage(items = page1Items, total = 150, hasMore = true, nextCursor = "cur-1")
        state = appendManualGoalEntryPage(state, page1)
        assertEquals(100, state.items.size)

        // Simulate page 2 fetch error
        state = markManualGoalEntryPageLoading(state)
        assertTrue(state.loading)
        state = markManualGoalEntryPageError(state, "网络连接超时，已保留前 100 条记录")

        assertFalse(state.loading)
        assertEquals(100, state.items.size)
        assertEquals("网络连接超时，已保留前 100 条记录", state.error)
        assertTrue(state.hasMore)
        assertEquals("cur-1", state.nextCursor)

        // Retry succeeds
        val page2Items = (100 until 150).map { sampleEntry("entry-$it") }
        val page2 = samplePage(items = page2Items, total = 150, hasMore = false, nextCursor = null)
        state = appendManualGoalEntryPage(state, page2)
        assertEquals(150, state.items.size)
        assertNull(state.error)
        assertFalse(state.hasMore)
    }

    @Test
    fun revisionChangeFlagsRestartRequiredWithoutMixedSnapshot() {
        val query = ManualGoalEntryQuery()
        var state = ManualGoalEntryListState(query = query)

        val page1Items = (0 until 100).map { sampleEntry("entry-$it") }
        val page1 = samplePage(items = page1Items, total = 200, revision = 1L, hasMore = true, nextCursor = "c1")
        state = appendManualGoalEntryPage(state, page1)

        // Page 2 arrives with revision = 2L (concurrent mutation occurred)
        val page2Items = (100 until 200).map { sampleEntry("entry-$it") }
        val page2 = samplePage(items = page2Items, total = 200, revision = 2L, hasMore = false, nextCursor = null)
        val updated = appendManualGoalEntryPage(state, page2)

        assertTrue(updated.restartRequired)
        assertEquals("数据版本已变更，请刷新重试", updated.error)
        assertEquals(100, updated.items.size) // Did NOT append page 2
    }

    @Test
    fun rejectsEmptyPageWithHasMoreTrue() {
        val query = ManualGoalEntryQuery()
        val state = ManualGoalEntryListState(query = query)

        val emptyPageWithHasMore = samplePage(items = emptyList(), total = 50, hasMore = true, nextCursor = "c1")
        assertThrows(IllegalArgumentException::class.java) {
            appendManualGoalEntryPage(state, emptyPageWithHasMore)
        }
    }

    @Test
    fun rejectsHasMoreWithoutValidNextCursor() {
        val query = ManualGoalEntryQuery()
        val state = ManualGoalEntryListState(query = query)

        // First page: hasMore=true but nextCursor=null
        val pageNullCursor = samplePage(items = listOf(sampleEntry("e1")), total = 10, hasMore = true, nextCursor = null)
        assertThrows(IllegalArgumentException::class.java) {
            appendManualGoalEntryPage(state, pageNullCursor)
        }

        // First page: hasMore=true but nextCursor is blank
        val pageBlankCursor = samplePage(items = listOf(sampleEntry("e1")), total = 10, hasMore = true, nextCursor = "   ")
        assertThrows(IllegalArgumentException::class.java) {
            appendManualGoalEntryPage(state, pageBlankCursor)
        }

        // First page: hasMore=false but carries nextCursor
        val pageFalseHasMoreWithCursor = samplePage(items = listOf(sampleEntry("e1")), total = 1, hasMore = false, nextCursor = "unexpected-cur")
        assertThrows(IllegalArgumentException::class.java) {
            appendManualGoalEntryPage(state, pageFalseHasMoreWithCursor)
        }

        // Second page append: hasMore=true but nextCursor=null
        val validPage1 = samplePage(items = listOf(sampleEntry("e1")), total = 10, hasMore = true, nextCursor = "cur-1")
        val state1 = appendManualGoalEntryPage(state, validPage1)
        val appendPageNullCursor = samplePage(items = listOf(sampleEntry("e2")), total = 10, hasMore = true, nextCursor = null)
        assertThrows(IllegalArgumentException::class.java) {
            appendManualGoalEntryPage(state1, appendPageNullCursor)
        }
    }

    @Test
    fun rejectsNonAdvancingCursor() {
        val query = ManualGoalEntryQuery()
        val page1 = samplePage(items = listOf(sampleEntry("e1")), total = 10, hasMore = true, nextCursor = "same-cursor")
        val state = appendManualGoalEntryPage(ManualGoalEntryListState(query = query), page1)

        val page2 = samplePage(items = listOf(sampleEntry("e2")), total = 10, hasMore = true, nextCursor = "same-cursor")
        assertThrows(IllegalArgumentException::class.java) {
            appendManualGoalEntryPage(state, page2)
        }
    }

    @Test
    fun rejectsDuplicateEntryIds() {
        val query = ManualGoalEntryQuery()
        val page1 = samplePage(items = listOf(sampleEntry("e1"), sampleEntry("e2")), total = 10, hasMore = true, nextCursor = "c1")
        val state = appendManualGoalEntryPage(ManualGoalEntryListState(query = query), page1)

        // Page 2 contains "e2" again
        val page2 = samplePage(items = listOf(sampleEntry("e2"), sampleEntry("e3")), total = 10, hasMore = false, nextCursor = null)
        assertThrows(IllegalArgumentException::class.java) {
            appendManualGoalEntryPage(state, page2)
        }
    }
}
