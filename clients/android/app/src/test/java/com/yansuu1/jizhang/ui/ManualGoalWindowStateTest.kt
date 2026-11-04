package com.yansuu1.jizhang.ui

import com.yansuu1.jizhang.repo.FinancialGoalView
import com.yansuu1.jizhang.repo.FinancialGoalWindowSlice
import com.yansuu1.jizhang.repo.FinancialGoalWindowView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Test

class ManualGoalWindowStateTest {

    private fun sampleWindow(
        from: Long = 1700000000000L,
        to: Long = 1702592000000L,
        reserveNet: Long = 50000L,
        investmentNet: Long = 120000L,
    ) = FinancialGoalWindowView(
        from = from,
        to = to,
        entryCount = 4,
        reserve = FinancialGoalWindowSlice(
            depositCents = 60000L,
            withdrawalCents = 10000L,
            netAdditionsCents = reserveNet,
            entryCount = 2,
        ),
        investment = FinancialGoalWindowSlice(
            depositCents = 150000L,
            withdrawalCents = 30000L,
            netAdditionsCents = investmentNet,
            entryCount = 2,
        ),
    )

    private fun sampleView(
        source: String = "manual-confirmed",
        window: FinancialGoalWindowView? = sampleWindow(),
    ) = FinancialGoalView(
        contractVersion = 1,
        calculatedAt = 1702592000000L,
        source = source,
        revision = 1L,
        state = "ready",
        reserveOpening = null,
        investmentOpening = null,
        asOf = 1702592000000L,
        reserveProgress = null,
        investmentProgress = null,
        window = window,
    )

    @Test
    fun requireManualGoalWindowReturnsSameWindowWhenMatching() {
        val window = sampleWindow(from = 1000L, to = 2000L, reserveNet = 8000L, investmentNet = 15000L)
        val view = sampleView(source = "manual-confirmed", window = window)
        val expected = ManualGoalWindowContext(
            from = 1000L,
            to = 2000L,
            label = "2026-11",
            timeZone = "Asia/Shanghai",
        )

        val result = requireManualGoalWindow(view, expected)
        assertSame(window, result)
        assertEquals(8000L, result.reserve.netAdditionsCents)
        assertEquals(15000L, result.investment.netAdditionsCents)
        assertEquals(60000L, result.reserve.depositCents)
        assertEquals(10000L, result.reserve.withdrawalCents)
        assertEquals(150000L, result.investment.depositCents)
        assertEquals(30000L, result.investment.withdrawalCents)
        assertEquals(4, result.entryCount)
    }

    @Test
    fun requireManualGoalWindowRejectsMismatchedFromOrTo() {
        val window = sampleWindow(from = 1000L, to = 2000L)
        val view = sampleView(window = window)

        // Mismatched from
        val wrongFrom = ManualGoalWindowContext(from = 1001L, to = 2000L, label = "W", timeZone = "UTC")
        val exFrom = assertThrows(IllegalArgumentException::class.java) {
            requireManualGoalWindow(view, wrongFrom)
        }
        assertEquals(
            "服务端回显统计区间 [1000, 2000) 与预期 [1001, 2000) 不匹配",
            exFrom.message,
        )

        // Mismatched to
        val wrongTo = ManualGoalWindowContext(from = 1000L, to = 2001L, label = "W", timeZone = "UTC")
        val exTo = assertThrows(IllegalArgumentException::class.java) {
            requireManualGoalWindow(view, wrongTo)
        }
        assertEquals(
            "服务端回显统计区间 [1000, 2000) 与预期 [1000, 2001) 不匹配",
            exTo.message,
        )
    }

    @Test
    fun requireManualGoalWindowRejectsNullWindow() {
        val view = sampleView(window = null)
        val expected = ManualGoalWindowContext(from = 1000L, to = 2000L, label = "W", timeZone = "UTC")

        val ex = assertThrows(IllegalStateException::class.java) {
            requireManualGoalWindow(view, expected)
        }
        assertEquals("服务端未返回期间目标统计数据", ex.message)
    }

    @Test
    fun requireManualGoalWindowRejectsInvalidSource() {
        val window = sampleWindow(from = 1000L, to = 2000L)
        val view = sampleView(source = "bank-verified", window = window)
        val expected = ManualGoalWindowContext(from = 1000L, to = 2000L, label = "W", timeZone = "UTC")

        val ex = assertThrows(IllegalArgumentException::class.java) {
            requireManualGoalWindow(view, expected)
        }
        assertEquals("数据来源无效，预期 manual-confirmed，实际为: bank-verified", ex.message)
    }

    @Test
    fun manualGoalWindowContextValidatesArguments() {
        // from must be non-negative
        assertThrows(IllegalArgumentException::class.java) {
            ManualGoalWindowContext(from = -1L, to = 1000L, label = "W", timeZone = "UTC")
        }

        // to must be strictly greater than from
        assertThrows(IllegalArgumentException::class.java) {
            ManualGoalWindowContext(from = 1000L, to = 1000L, label = "W", timeZone = "UTC")
        }
        assertThrows(IllegalArgumentException::class.java) {
            ManualGoalWindowContext(from = 1000L, to = 999L, label = "W", timeZone = "UTC")
        }

        // label cannot be blank
        assertThrows(IllegalArgumentException::class.java) {
            ManualGoalWindowContext(from = 1000L, to = 2000L, label = "   ", timeZone = "UTC")
        }

        // timeZone cannot be blank
        assertThrows(IllegalArgumentException::class.java) {
            ManualGoalWindowContext(from = 1000L, to = 2000L, label = "W", timeZone = "")
        }
    }
}
