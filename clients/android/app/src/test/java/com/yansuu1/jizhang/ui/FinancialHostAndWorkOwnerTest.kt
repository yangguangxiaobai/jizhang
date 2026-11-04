package com.yansuu1.jizhang.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FinancialHostAndWorkOwnerTest {

    @Test
    fun workOwner_ticketIncrementsAndCancels() {
        val owner = FinancialExecutionWorkOwner()
        val ticket1 = owner.nextTicket()
        val ticket2 = owner.nextTicket()

        assertNotEquals(ticket1, ticket2)
        assertFalse(owner.isCurrent(ticket1))
        assertTrue(owner.isCurrent(ticket2))

        owner.cancel()
        assertFalse("cancel 后之前持有的 ticket 应该全部作废", owner.isCurrent(ticket2))
    }

    @Test
    fun executionAndRefundReads_doNotInvalidateEachOther() {
        val execution = FinancialExecutionWorkOwner()
        val refunds = FinancialExecutionWorkOwner()
        val executionTicket = execution.nextTicket()
        val oldRefundTicket = refunds.nextTicket()
        val latestRefundTicket = refunds.nextTicket()
        assertTrue(execution.isCurrent(executionTicket))
        assertFalse(refunds.isCurrent(oldRefundTicket))
        assertTrue(refunds.isCurrent(latestRefundTicket))
        execution.cancel()
        assertTrue(refunds.isCurrent(latestRefundTicket))
    }

    @Test
    fun financialHost_onlySelectedStableSlotIsPlaced() {
        FinancialHostTab.entries.forEachIndexed { index, tab ->
            assertEquals(index, financialTabPlacementIndex(tab, 4))
        }
    }

    @Test(expected = IllegalArgumentException::class)
    fun financialHost_rejectsMissingRetainedSlot() {
        financialTabPlacementIndex(FinancialHostTab.EXECUTION, 3)
    }

    @Test(expected = IllegalArgumentException::class)
    fun financialHost_rejectsExtraRetainedSlot() {
        financialTabPlacementIndex(FinancialHostTab.SCENARIO, 5)
    }

    @Test
    fun financialHostTab_enumerationProperties() {
        assertEquals(4, FinancialHostTab.entries.size)
        assertEquals("本月计划", FinancialHostTab.PLAN.label)
        assertEquals("四用途执行", FinancialHostTab.EXECUTION.label)
        assertEquals("分类信封预算", FinancialHostTab.BUDGET.label)
        assertEquals("测算预估", FinancialHostTab.SCENARIO.label)
    }
}
