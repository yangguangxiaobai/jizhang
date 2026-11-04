package com.yansuu1.jizhang.ui

import com.yansuu1.jizhang.repo.FinancialGoalEntryDto
import com.yansuu1.jizhang.repo.FinancialGoalView
import com.yansuu1.jizhang.repo.ManualGoal
import com.yansuu1.jizhang.repo.ManualGoalEntryKind
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ManualGoalProgressStateTest {

    @Test
    fun parseManualGoalYuanCentsHandlesValidFormatsAndEnforcesPrecision() {
        assertEquals(12345L, parseManualGoalYuanCents("123.45", false))
        assertEquals(0L, parseManualGoalYuanCents("0", true))
        assertEquals(0L, parseManualGoalYuanCents("0.0", true))
        assertEquals(0L, parseManualGoalYuanCents("0.00", true))
        assertEquals(0L, parseManualGoalYuanCents("  0  ", true))
        assertEquals(9007199254740991L, parseManualGoalYuanCents("90071992547409.91", false))
        assertEquals(9007199254740991L, parseManualGoalYuanCents("90071992547409.91", true))
        assertEquals(100L, parseManualGoalYuanCents("1", false))
        assertEquals(100L, parseManualGoalYuanCents("1.0", false))
        assertEquals(100L, parseManualGoalYuanCents("1.00", false))
        assertEquals(50L, parseManualGoalYuanCents("0.5", false))
        assertEquals(5L, parseManualGoalYuanCents("0.05", false))
        assertEquals(12345L, parseManualGoalYuanCents("  123.45  ", false))
    }

    @Test
    fun parseManualGoalYuanCentsRejectsDisallowedZeroAndInvalidInputs() {
        // 0 不允许作存取 (allowZero = false)
        assertThrows(IllegalArgumentException::class.java) { parseManualGoalYuanCents("0", false) }
        assertThrows(IllegalArgumentException::class.java) { parseManualGoalYuanCents("0.0", false) }
        assertThrows(IllegalArgumentException::class.java) { parseManualGoalYuanCents("0.00", false) }
        assertThrows(IllegalArgumentException::class.java) { parseManualGoalYuanCents("  0  ", false) }

        // 第三位小数一律拒绝，包括 1.230，不静默舍入
        assertThrows(IllegalArgumentException::class.java) { parseManualGoalYuanCents("1.234", false) }
        assertThrows(IllegalArgumentException::class.java) { parseManualGoalYuanCents("1.234", true) }
        assertThrows(IllegalArgumentException::class.java) { parseManualGoalYuanCents("1.230", false) }
        assertThrows(IllegalArgumentException::class.java) { parseManualGoalYuanCents("1.230", true) }
        assertThrows(IllegalArgumentException::class.java) { parseManualGoalYuanCents("0.000", true) }
        assertThrows(IllegalArgumentException::class.java) { parseManualGoalYuanCents("0.000", false) }
        assertThrows(IllegalArgumentException::class.java) { parseManualGoalYuanCents("123.456", false) }

        // 超出 JS 安全整数范围 (> 9007199254740991L)
        assertThrows(IllegalArgumentException::class.java) { parseManualGoalYuanCents("90071992547409.92", false) }
        assertThrows(IllegalArgumentException::class.java) { parseManualGoalYuanCents("90071992547409.92", true) }
        assertThrows(IllegalArgumentException::class.java) { parseManualGoalYuanCents("999999999999999999999999", false) }

        // 负数
        assertThrows(IllegalArgumentException::class.java) { parseManualGoalYuanCents("-1", false) }
        assertThrows(IllegalArgumentException::class.java) { parseManualGoalYuanCents("-1", true) }
        assertThrows(IllegalArgumentException::class.java) { parseManualGoalYuanCents("-0.01", false) }
        assertThrows(IllegalArgumentException::class.java) { parseManualGoalYuanCents("-0", true) }
        assertThrows(IllegalArgumentException::class.java) { parseManualGoalYuanCents("-123.45", false) }

        // NaN、Infinity、指数与非数字
        assertThrows(IllegalArgumentException::class.java) { parseManualGoalYuanCents("NaN", false) }
        assertThrows(IllegalArgumentException::class.java) { parseManualGoalYuanCents("Infinity", false) }
        assertThrows(IllegalArgumentException::class.java) { parseManualGoalYuanCents("-Infinity", false) }
        assertThrows(IllegalArgumentException::class.java) { parseManualGoalYuanCents("1e2", false) }
        assertThrows(IllegalArgumentException::class.java) { parseManualGoalYuanCents("1E2", false) }
        assertThrows(IllegalArgumentException::class.java) { parseManualGoalYuanCents("1e-2", false) }
        assertThrows(IllegalArgumentException::class.java) { parseManualGoalYuanCents("abc", false) }
        assertThrows(IllegalArgumentException::class.java) { parseManualGoalYuanCents("+100", false) }
        assertThrows(IllegalArgumentException::class.java) { parseManualGoalYuanCents("1.", false) }
        assertThrows(IllegalArgumentException::class.java) { parseManualGoalYuanCents(".5", false) }

        // 空白
        assertThrows(IllegalArgumentException::class.java) { parseManualGoalYuanCents("", false) }
        assertThrows(IllegalArgumentException::class.java) { parseManualGoalYuanCents("   ", false) }
        assertThrows(IllegalArgumentException::class.java) { parseManualGoalYuanCents("", true) }
        assertThrows(IllegalArgumentException::class.java) { parseManualGoalYuanCents("   ", true) }
    }

    @Test
    fun scopedStatsReadRejectsOutdatedResultsWhenScopeChanges() {
        var scopeCalls = 0
        val scopeA = FinancialScope("https://jz.example.com", "userA")
        val scopeB = FinancialScope("https://jz.example.com", "userB")

        val error = assertThrows(IllegalStateException::class.java) {
            kotlinx.coroutines.runBlocking {
                scopedStatsRead(
                    resolveScope = {
                        scopeCalls++
                        if (scopeCalls == 1) scopeA else scopeB
                    },
                    read = { Unit },
                )
            }
        }
        assertTrue(error.message?.contains("认证作用域已变化") == true)
    }

    @Test
    fun entryRowKindAndSignConventions() {
        val deposit = FinancialGoalEntryDto(
            id = "e1",
            goal = ManualGoal.RESERVE,
            kind = ManualGoalEntryKind.DEPOSIT,
            amountCents = 1500L,
            date = 1000L,
            note = "存入",
            revision = 1L,
            createdAt = 1000L,
            updatedAt = 1000L,
            deletedAt = null,
        )
        assertEquals(ManualGoalEntryKind.DEPOSIT, deposit.kind)
        assertEquals(1500L, deposit.amountCents)

        val withdrawal = FinancialGoalEntryDto(
            id = "e2",
            goal = ManualGoal.RESERVE,
            kind = ManualGoalEntryKind.WITHDRAWAL,
            amountCents = 500L,
            date = 2000L,
            note = "取出",
            revision = 2L,
            createdAt = 2000L,
            updatedAt = 2000L,
            deletedAt = null,
        )
        assertEquals(ManualGoalEntryKind.WITHDRAWAL, withdrawal.kind)
        assertEquals(500L, withdrawal.amountCents)
    }
}
