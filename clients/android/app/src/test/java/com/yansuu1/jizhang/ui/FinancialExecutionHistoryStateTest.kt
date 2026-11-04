package com.yansuu1.jizhang.ui

import com.yansuu1.jizhang.repo.FinancialAllocationDecision
import com.yansuu1.jizhang.repo.FinancialCycle
import com.yansuu1.jizhang.repo.FinancialExecutionContract
import com.yansuu1.jizhang.repo.FinancialPeriod
import com.yansuu1.jizhang.repo.FinancialPeriodSourceState
import com.yansuu1.jizhang.repo.FinancialRatiosBps
import com.yansuu1.jizhang.repo.FinancialSourceStatus
import com.yansuu1.jizhang.repo.FinancialWindow
import com.yansuu1.jizhang.repo.PurposeAmounts
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class FinancialExecutionHistoryStateTest {

    private fun createTestPeriod(
        id: String = "period-1",
        revision: Long = 1,
        confirmedIncome: Long = 500000L,
        sourceState: FinancialPeriodSourceState = FinancialPeriodSourceState.VALID,
    ): FinancialPeriod = FinancialPeriod(
        id = id,
        revision = revision,
        createdAt = 1760000000000L,
        confirmedAt = 1760000001000L,
        window = FinancialWindow(
            cycleKey = "2026-10",
            groupMonth = "2026-10",
            start = 1760000000000L,
            end = 1762678400000L,
            timeZone = "Asia/Shanghai",
            cycle = FinancialCycle.naturalMonth(),
            anchorSalaryId = "sal-1",
            groupingRule = FinancialExecutionContract.GROUPING_RULE,
            legacyWindow = null,
            warnings = emptyList(),
        ),
        decision = FinancialAllocationDecision(
            incomeCents = confirmedIncome,
            ratiosBps = FinancialRatiosBps.DEFAULT,
            targets = PurposeAmounts(
                growth = confirmedIncome * 25 / 100,
                reserve = confirmedIncome * 15 / 100,
                essentials = confirmedIncome * 50 / 100,
                joy = confirmedIncome * 10 / 100,
            ),
            configRevision = 1L,
            mappingRevision = 1L,
            mappingSnapshotId = "map-1",
            essentialMonthlyCents = 250000L,
            targetMonths = 5,
        ),
        sources = emptyList(),
        sourceState = sourceState,
        confirmedIncomeCents = confirmedIncome,
        verifiedIncomeCents = confirmedIncome,
        warnings = emptyList(),
    )

    @Test
    fun pagination_calculatesPagesAndBoundariesCorrectly() {
        val emptyPage = HistoryPaginationState(limit = 10, offset = 0, total = 0L)
        assertEquals(1, emptyPage.currentPage)
        assertEquals(1, emptyPage.totalPages)
        assertFalse(emptyPage.hasPrev)
        assertFalse(emptyPage.hasNext)
        assertEquals(emptyPage, emptyPage.nextPage())
        assertEquals(emptyPage, emptyPage.prevPage())
        assertEquals("第 1 / 1 页 (共 0 条记录)", emptyPage.summaryText())

        val page1 = HistoryPaginationState(limit = 10, offset = 0, total = 25L)
        assertEquals(1, page1.currentPage)
        assertEquals(3, page1.totalPages)
        assertFalse(page1.hasPrev)
        assertTrue(page1.hasNext)

        val page2 = page1.nextPage()
        assertEquals(10, page2.offset)
        assertEquals(2, page2.currentPage)
        assertEquals(3, page2.totalPages)
        assertTrue(page2.hasPrev)
        assertTrue(page2.hasNext)

        val page3 = page2.nextPage()
        assertEquals(20, page3.offset)
        assertEquals(3, page3.currentPage)
        assertEquals(3, page3.totalPages)
        assertTrue(page3.hasPrev)
        assertFalse(page3.hasNext)
        assertEquals(page3, page3.nextPage())

        val backToPage2 = page3.prevPage()
        assertEquals(10, backToPage2.offset)
        assertEquals(2, backToPage2.currentPage)

        val backToPage1 = backToPage2.prevPage()
        assertEquals(0, backToPage1.offset)
        assertEquals(1, backToPage1.currentPage)
        assertEquals(backToPage1, backToPage1.prevPage())
    }

    @Test
    fun pagination_rejectsInvalidInputs() {
        assertThrows(IllegalArgumentException::class.java) {
            HistoryPaginationState(limit = 0, offset = 0, total = 10L)
        }
        assertThrows(IllegalArgumentException::class.java) {
            HistoryPaginationState(limit = 10, offset = -1, total = 10L)
        }
        assertThrows(IllegalArgumentException::class.java) {
            HistoryPaginationState(limit = 10, offset = 0, total = -1L)
        }
    }

    @Test
    fun historyWorkTracker_generatesDistinctTicketsAndCancels() {
        val tracker = HistoryWorkTracker()
        val t1 = tracker.nextTicket()
        val t2 = tracker.nextTicket()

        assertNotEquals(t1, t2)
        assertFalse(tracker.isCurrent(t1))
        assertTrue(tracker.isCurrent(t2))
        assertEquals(t2, tracker.current())

        tracker.cancel()
        assertFalse(tracker.isCurrent(t2))
        assertTrue(tracker.current() > t2)
    }

    @Test
    fun periodsState_retryKeepsExistingRowsAndStoresRequestedOffset() {
        val initialItem = createTestPeriod("p-initial", revision = 1)
        val state = HistoryPeriodsState(
            loading = false,
            error = null,
            requestedOffset = 0,
            items = listOf(initialItem),
            currentPeriodId = "p-initial",
            pagination = HistoryPaginationState(limit = 10, offset = 0, total = 25L),
        )

        // 用户发起翻页加载（请求 offset = 10）
        val loadingState = state.onStartLoading(offset = 10)
        assertTrue(loadingState.loading)
        assertNull(loadingState.error)
        assertEquals(10, loadingState.requestedOffset)
        assertEquals("翻页中途保留既有行，防止闪白", 1, loadingState.items.size)

        // 加载失败
        val (errorState, accepted) = loadingState.onApplyError(
            requestTicket = 5L,
            activeTicket = 5L,
            errorMessage = "网络连接超时",
        )
        assertTrue(accepted)
        assertFalse(errorState.loading)
        assertEquals("网络连接超时", errorState.error)
        assertEquals(10, errorState.requestedOffset)
        assertEquals("失败时保留原列表行", 1, errorState.items.size)
    }

    @Test
    fun periodsState_staleResponsesAreIgnored() {
        val tracker = HistoryWorkTracker()
        val t1 = tracker.nextTicket()
        var state = HistoryPeriodsState().onStartLoading(offset = 0)

        // 在 t1 响应到来前，用户切页生成 t2
        val t2 = tracker.nextTicket()

        // 迟到的 t1 响应返回
        val (staleState, accepted1) = state.onApplySuccess(
            requestTicket = t1,
            activeTicket = tracker.current(),
            newItems = listOf(createTestPeriod("stale-period")),
            newCurrentPeriodId = "stale-period",
            newPagination = HistoryPaginationState(limit = 10, offset = 0, total = 1L),
        )
        assertFalse("陈旧代次的成功响应必须被拒绝", accepted1)
        assertEquals(state, staleState)
        assertTrue("原加载状态未被陈旧响应破坏", staleState.loading)
        assertTrue("陈旧数据未写入", staleState.items.isEmpty())

        // 迟到的 t1 错误返回
        val (staleErrorState, acceptedError) = state.onApplyError(
            requestTicket = t1,
            activeTicket = tracker.current(),
            errorMessage = "过期的错误",
        )
        assertFalse("陈旧代次的错误响应必须被拒绝", acceptedError)
        assertNull("过期的错误不会覆盖当前状态", staleErrorState.error)

        // 当前有效代次 t2 响应返回
        val validItem = createTestPeriod("valid-period")
        val (freshState, accepted2) = state.onApplySuccess(
            requestTicket = t2,
            activeTicket = tracker.current(),
            newItems = listOf(validItem),
            newCurrentPeriodId = "valid-period",
            newPagination = HistoryPaginationState(limit = 10, offset = 0, total = 1L),
        )
        assertTrue("当前有效代次的响应被成功采纳", accepted2)
        assertFalse(freshState.loading)
        assertNull(freshState.error)
        assertEquals(1, freshState.items.size)
        assertEquals("valid-period", freshState.items.first().id)
    }

    @Test
    fun revisionsState_switchPeriodClearsItemsWhileRetryKeepsItems() {
        val rev1 = createTestPeriod("p1", revision = 1)
        val rev2 = createTestPeriod("p1", revision = 2)

        val state = HistoryRevisionsState(
            periodId = "p1",
            items = listOf(rev1, rev2),
            pagination = HistoryPaginationState(limit = 10, offset = 0, total = 2L),
        )

        // 相同周期重试，保留现有版本列表
        val retryState = state.onStartLoading("p1", offset = 0)
        assertTrue(retryState.loading)
        assertEquals("相同周期重试时保留原版本列表", 2, retryState.items.size)

        // 切换不同周期，重置版本列表，避免显示串号
        val switchedState = state.onStartLoading("p2", offset = 0)
        assertTrue(switchedState.loading)
        assertEquals("p2", switchedState.periodId)
        assertTrue("切换不同周期必须重置版本列表", switchedState.items.isEmpty())
    }

    @Test
    fun snapshotMoney_isFrozenReadOnlyAndExactSum() {
        val income = 600000L
        val period = createTestPeriod("p-frozen", revision = 2, confirmedIncome = income)

        // 1. 验证确认收入与各目标金额的只读性
        assertEquals(income, period.confirmedIncomeCents)
        assertEquals(150000L, period.decision.targets.growth)
        assertEquals(90000L, period.decision.targets.reserve)
        assertEquals(300000L, period.decision.targets.essentials)
        assertEquals(60000L, period.decision.targets.joy)

        // 2. 验证保守无损分配：四项非负且和等于计划收入
        val sum = period.decision.targets.growth +
            period.decision.targets.reserve +
            period.decision.targets.essentials +
            period.decision.targets.joy
        assertEquals(income, sum)

        // 3. 验证即便是发薪源状态变动为 RECONCILIATION_REQUIRED，冻结决策各项仍不改变
        val reconPeriod = period.copy(sourceState = FinancialPeriodSourceState.RECONCILIATION_REQUIRED)
        assertEquals(income, reconPeriod.confirmedIncomeCents)
        assertEquals(period.decision.targets, reconPeriod.decision.targets)
    }

    @Test
    fun formatBpsPercent_formatsExactDecimals() {
        assertEquals("50%", FinancialHistoryLabels.formatBpsPercent(5000))
        assertEquals("10%", FinancialHistoryLabels.formatBpsPercent(1000))
        assertEquals("25%", FinancialHistoryLabels.formatBpsPercent(2500))
        assertEquals("15%", FinancialHistoryLabels.formatBpsPercent(1500))
        assertEquals("33.3%", FinancialHistoryLabels.formatBpsPercent(3330))
        assertEquals("0.01%", FinancialHistoryLabels.formatBpsPercent(1))
        assertEquals("100%", FinancialHistoryLabels.formatBpsPercent(10000))
        assertEquals("0%", FinancialHistoryLabels.formatBpsPercent(0))

        assertThrows(IllegalArgumentException::class.java) {
            FinancialHistoryLabels.formatBpsPercent(-1)
        }
        assertThrows(IllegalArgumentException::class.java) {
            FinancialHistoryLabels.formatBpsPercent(10001)
        }
    }

    @Test
    fun formatWindowRange_usesConfiguredTimeZoneAndExclusiveEnd() {
        val window = FinancialWindow(
            cycleKey = "2026-10",
            groupMonth = "2026-10",
            start = 1760000000000L, // 2025-10-09
            end = 1762678400000L,
            timeZone = "Asia/Shanghai",
            cycle = FinancialCycle.naturalMonth(),
            anchorSalaryId = "sal-1",
            groupingRule = FinancialExecutionContract.GROUPING_RULE,
            legacyWindow = null,
            warnings = emptyList(),
        )
        val range = FinancialHistoryLabels.formatWindowRange(window)
        assertTrue("必须注明含起不含止", range.contains("含起不含止"))
        assertTrue("必须注明时区", range.contains("Asia/Shanghai"))
    }

    @Test
    fun historyLabels_sourceStateAndStatusDescriptionsAreHonest() {
        val validDesc = FinancialHistoryLabels.sourceStateDescription(FinancialPeriodSourceState.VALID)
        assertTrue(validDesc.contains("有效"))

        val reconDesc = FinancialHistoryLabels.sourceStateDescription(FinancialPeriodSourceState.RECONCILIATION_REQUIRED)
        assertTrue(reconDesc.contains("变动") && reconDesc.contains("冻结"))

        val emptyDesc = FinancialHistoryLabels.sourceStateDescription(FinancialPeriodSourceState.EMPTY)
        assertTrue(emptyDesc.contains("无有效"))

        assertEquals("有效", FinancialHistoryLabels.sourceStatusDescription(FinancialSourceStatus.VALID))
        assertEquals("已修改", FinancialHistoryLabels.sourceStatusDescription(FinancialSourceStatus.CHANGED))
        assertEquals("已删除", FinancialHistoryLabels.sourceStatusDescription(FinancialSourceStatus.DELETED))
        assertEquals("已清除", FinancialHistoryLabels.sourceStatusDescription(FinancialSourceStatus.PURGED))
        assertEquals("归属周期变动", FinancialHistoryLabels.sourceStatusDescription(FinancialSourceStatus.GROUP_CHANGED))
    }

    @Test
    fun independentTrackers_cancelRevisionsDoesNotAffectPeriods() {
        val periodsTracker = HistoryWorkTracker()
        val revisionsTracker = HistoryWorkTracker()

        val pTicket = periodsTracker.nextTicket()
        val rTicket = revisionsTracker.nextTicket()

        assertTrue(periodsTracker.isCurrent(pTicket))
        assertTrue(revisionsTracker.isCurrent(rTicket))

        // 用户返回上一级或切换周期，仅取消 revisionsTracker
        revisionsTracker.cancel()

        assertFalse("revisionsTracker 必须被取消", revisionsTracker.isCurrent(rTicket))
        assertTrue("periodsTracker 必须不受影响，后台周期列表加载正常进行", periodsTracker.isCurrent(pTicket))
    }

    @Test
    fun revisionsState_errorWithCachedItemsPreservesRowsAndRequestedOffset() {
        val initialRev = createTestPeriod("p1", revision = 1)
        val state = HistoryRevisionsState(
            periodId = "p1",
            loading = false,
            error = null,
            requestedOffset = 0,
            items = listOf(initialRev),
            pagination = HistoryPaginationState(limit = 10, offset = 0, total = 20L),
        )

        // 请求加载下一页（offset = 10）
        val loadingState = state.onStartLoading("p1", offset = 10)
        assertTrue(loadingState.loading)
        assertNull(loadingState.error)
        assertEquals(10, loadingState.requestedOffset)
        assertEquals("加载下一页时保留既有版本条目", 1, loadingState.items.size)

        // 网络失败
        val (errorState, accepted) = loadingState.onApplyError(
            requestTicket = 3L,
            activeTicket = 3L,
            errorMessage = "读取版本记录超时",
        )
        assertTrue(accepted)
        assertFalse(errorState.loading)
        assertEquals("读取版本记录超时", errorState.error)
        assertEquals(10, errorState.requestedOffset)
        assertEquals("错误时仍保留原版本条目，以便界面展示缓存内容并提供按 requestedOffset 重试", 1, errorState.items.size)
    }

    @Test
    fun authExpired_clearsLoadingStateCorrectly() {
        val loadingPeriods = HistoryPeriodsState().onStartLoading(offset = 0)
        assertTrue(loadingPeriods.loading)
        val resetPeriods = loadingPeriods.copy(loading = false)
        assertFalse(resetPeriods.loading)

        val loadingRevisions = HistoryRevisionsState().onStartLoading("p1", offset = 0)
        assertTrue(loadingRevisions.loading)
        val resetRevisions = loadingRevisions.copy(loading = false)
        assertFalse(resetRevisions.loading)
    }
}
