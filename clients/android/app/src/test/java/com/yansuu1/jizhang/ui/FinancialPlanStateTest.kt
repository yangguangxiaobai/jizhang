package com.yansuu1.jizhang.ui

import com.yansuu1.jizhang.repo.FinancialPlanInputs
import com.yansuu1.jizhang.repo.FinancialPlanSaveRequest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class FinancialPlanStateTest {

    @Test
    fun testParseValidYuanToCents() {
        assertEquals(1000000L, FinancialPlanMoneyParser.parseYuanToCents("10000", allowZero = false, "收入"))
        assertEquals(1000050L, FinancialPlanMoneyParser.parseYuanToCents("10000.5", allowZero = false, "收入"))
        assertEquals(1000050L, FinancialPlanMoneyParser.parseYuanToCents("10000.50", allowZero = false, "收入"))
        assertEquals(1L, FinancialPlanMoneyParser.parseYuanToCents("0.01", allowZero = false, "收入"))
        assertEquals(100L, FinancialPlanMoneyParser.parseYuanToCents("1.00", allowZero = false, "收入"))
    }

    @Test
    fun testParseZeroBehavior() {
        assertEquals(0L, FinancialPlanMoneyParser.parseYuanToCents("0", allowZero = true, "储备金"))
        assertEquals(0L, FinancialPlanMoneyParser.parseYuanToCents("0.00", allowZero = true, "储备金"))

        assertThrows(IllegalArgumentException::class.java) {
            FinancialPlanMoneyParser.parseYuanToCents("0", allowZero = false, "收入")
        }
        assertThrows(IllegalArgumentException::class.java) {
            FinancialPlanMoneyParser.parseYuanToCents("0.00", allowZero = false, "收入")
        }
    }

    @Test
    fun testRejectInvalidDecimalPlaces() {
        assertThrows(IllegalArgumentException::class.java) {
            FinancialPlanMoneyParser.parseYuanToCents("100.123", allowZero = false, "收入")
        }
        assertThrows(IllegalArgumentException::class.java) {
            FinancialPlanMoneyParser.parseYuanToCents("0.001", allowZero = true, "储备金")
        }
    }

    @Test
    fun testRejectNegativeNumbers() {
        assertThrows(IllegalArgumentException::class.java) {
            FinancialPlanMoneyParser.parseYuanToCents("-100", allowZero = false, "收入")
        }
        assertThrows(IllegalArgumentException::class.java) {
            FinancialPlanMoneyParser.parseYuanToCents("-0.01", allowZero = true, "储备金")
        }
    }

    @Test
    fun testRejectMalformedOrNonNumericStrings() {
        for (input in listOf("", "  ", "abc", "+100", "1e5", "100.0.0", "100,000", "0x10")) {
            assertThrows(IllegalArgumentException::class.java) {
                FinancialPlanMoneyParser.parseYuanToCents(input, allowZero = true, "字段")
            }
        }
    }

    @Test
    fun testRejectOverflowAboveSafeInteger() {
        val overflowYuan = "90071992547409.92" // 9007199254740992 cents > MAX_SAFE_INTEGER
        assertThrows(IllegalArgumentException::class.java) {
            FinancialPlanMoneyParser.parseYuanToCents(overflowYuan, allowZero = false, "收入")
        }

        val maxSafeYuan = "90071992547409.91"
        assertEquals(9007199254740991L, FinancialPlanMoneyParser.parseYuanToCents(maxSafeYuan, allowZero = false, "收入"))
    }

    @Test
    fun testFormatCentsToYuan() {
        assertEquals("10000.00", FinancialPlanMoneyParser.formatCentsToYuan(1000000L))
        assertEquals("0.50", FinancialPlanMoneyParser.formatCentsToYuan(50L))
        assertEquals("0.05", FinancialPlanMoneyParser.formatCentsToYuan(5L))
        assertEquals("0.00", FinancialPlanMoneyParser.formatCentsToYuan(0L))
    }

    @Test
    fun testDraftValidationSuccess() {
        val draft = FinancialPlanDraft(
            monthlyIncomeText = "10000.00",
            essentialMonthlyText = "5000.00",
            reserveBalanceText = "2000.00",
        )
        val result = draft.validate()
        assertTrue(result.isSuccess)
        val inputs = result.getOrThrow()
        assertEquals(1000000L, inputs.monthlyIncomeCents)
        assertEquals(500000L, inputs.essentialMonthlyCents)
        assertEquals(200000L, inputs.reserveBalanceCents)
    }

    @Test
    fun testDraftValidationFailureOnNonPositive() {
        val zeroIncome = FinancialPlanDraft(
            monthlyIncomeText = "0",
            essentialMonthlyText = "5000.00",
            reserveBalanceText = "0.00",
        )
        assertFalse(zeroIncome.validate().isSuccess)

        val zeroEssentials = FinancialPlanDraft(
            monthlyIncomeText = "10000.00",
            essentialMonthlyText = "0",
            reserveBalanceText = "0.00",
        )
        assertFalse(zeroEssentials.validate().isSuccess)

        val zeroReserveIsValid = FinancialPlanDraft(
            monthlyIncomeText = "10000.00",
            essentialMonthlyText = "5000.00",
            reserveBalanceText = "0.00",
        )
        assertTrue(zeroReserveIsValid.validate().isSuccess)
    }

    @Test
    fun testDraftMatchesInputs() {
        val inputs = FinancialPlanInputs(1000000L, 500000L, 0L)
        val matchingDraft = FinancialPlanDraft("10000.00", "5000.00", "0.00")
        assertTrue(matchingDraft.matchesInputs(inputs))

        val differentDraft = FinancialPlanDraft("10000.00", "5000.00", "100.00")
        assertFalse(differentDraft.matchesInputs(inputs))
    }

    @Test
    fun testSaveRequestExactReplay() {
        val inputs = FinancialPlanInputs(1000000L, 500000L, 200000L)
        val req1 = FinancialPlanSaveRequest(expectedRevision = 3L, inputs = inputs)

        // Exact replay preserves expectedRevision and inputs
        val req2 = FinancialPlanSaveRequest(expectedRevision = req1.expectedRevision, inputs = req1.toInputs())
        assertEquals(req1, req2)
        assertEquals(req1.toJson().toString(), req2.toJson().toString())
    }
}
