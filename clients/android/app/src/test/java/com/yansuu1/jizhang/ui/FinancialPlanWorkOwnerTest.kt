package com.yansuu1.jizhang.ui

import com.yansuu1.jizhang.repo.FinancialPlanAnalysis
import com.yansuu1.jizhang.repo.FinancialPlanInputs
import com.yansuu1.jizhang.repo.FinancialPlanSaveRequest
import com.yansuu1.jizhang.repo.SavedFinancialPlan
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class FinancialPlanWorkOwnerTest {

    private val testBaseUrl = "https://jz.example.test"
    private val testInputs = FinancialPlanInputs(1000000L, 500000L, 0L)
    private val testSaveRequest = FinancialPlanSaveRequest(expectedRevision = 0L, inputs = testInputs)

    private fun mockSavedPlan(revision: Long, inputs: FinancialPlanInputs): SavedFinancialPlan {
        val analysis = FinancialPlanAnalysis(
            ruleVersion = 1,
            allocations = listOf(
                com.yansuu1.jizhang.repo.PurposeAllocation("growth", 25, 250000L),
                com.yansuu1.jizhang.repo.PurposeAllocation("reserve", 15, 150000L),
                com.yansuu1.jizhang.repo.PurposeAllocation("essentials", 50, 500000L),
                com.yansuu1.jizhang.repo.PurposeAllocation("joy", 10, 100000L),
            ),
            reserveTargetCents = 2500000L,
            reserveGapCents = 2500000L,
            reserveSurplusCents = 0L,
            reserveProgress = 0.0,
            monthsToTarget = 17L,
            targetReached = false,
            essentialShortfallCents = 0L,
            monthlyDeficitCents = 0L,
            warnings = emptyList(),
            projection = (1..12).map {
                com.yansuu1.jizhang.repo.ProjectionMonth(it, 150000L * it, 250000L * it, 0L, 0L, false)
            },
        )
        return SavedFinancialPlan(
            version = 1,
            revision = revision,
            updatedAt = 1000L,
            inputs = inputs,
            analysis = analysis,
        )
    }

    @Test
    fun testReentryRejection() {
        val owner = FinancialPlanWorkOwner()
        assertFalse(owner.isBusy)

        val ticket1 = owner.startLoad(testBaseUrl)
        assertNotNull(ticket1)
        assertTrue(owner.isBusy)
        assertEquals(FinancialPlanWorkOwner.ActionKind.LOAD, owner.activeKind)

        // Attempting another operation while busy is strictly rejected
        assertNull(owner.startLoad(testBaseUrl))
        assertNull(owner.startPreview(testInputs, testBaseUrl))
        assertNull(owner.startSave(testSaveRequest, testBaseUrl))

        owner.finish(ticket1)
        assertFalse(owner.isBusy)
        assertNull(owner.activeKind)
    }

    @Test
    fun testBaseUrlMismatchRejection() {
        val owner = FinancialPlanWorkOwner()
        val ticket = owner.startSave(testSaveRequest, testBaseUrl)
        assertNotNull(ticket)

        assertTrue(owner.owns(ticket, testBaseUrl))
        assertFalse(owner.owns(ticket, "https://other.server.test"))

        owner.finish(ticket)
    }

    @Test
    fun testGenerationInvalidation() {
        val owner = FinancialPlanWorkOwner()
        val ticket1 = owner.startLoad(testBaseUrl)
        assertNotNull(ticket1)
        owner.finish(ticket1)

        val ticket2 = owner.startPreview(testInputs, testBaseUrl)
        assertNotNull(ticket2)

        // Old ticket1 is no longer owned
        assertFalse(owner.owns(ticket1, testBaseUrl))
        assertTrue(owner.owns(ticket2, testBaseUrl))

        owner.finish(ticket2)
    }

    @Test
    fun testDisposeInvalidatesActiveWork() {
        val owner = FinancialPlanWorkOwner()
        val ticket = owner.startLoad(testBaseUrl)
        assertNotNull(ticket)
        assertTrue(owner.isBusy)

        owner.dispose()
        assertFalse(owner.isBusy)
        assertFalse(owner.owns(ticket, testBaseUrl))

        assertNull(owner.startLoad(testBaseUrl))
    }

    @Test
    fun testValidateSaveResultSuccessOnStrictRevisionAdvancement() {
        val req = FinancialPlanSaveRequest(expectedRevision = 2L, inputs = testInputs)
        val validPlan = mockSavedPlan(revision = 3L, inputs = testInputs)

        // Does not throw when inputs match and revision is expectedRevision + 1
        FinancialPlanWorkOwner.validateSaveResult(req, validPlan)
    }

    @Test
    fun testValidateSaveResultThrowsOnInputMismatch() {
        val req = FinancialPlanSaveRequest(expectedRevision = 2L, inputs = testInputs)
        val differentInputs = FinancialPlanInputs(999000L, 500000L, 0L)
        val invalidPlan = mockSavedPlan(revision = 3L, inputs = differentInputs)

        assertThrows(IllegalArgumentException::class.java) {
            FinancialPlanWorkOwner.validateSaveResult(req, invalidPlan)
        }
    }

    @Test
    fun testValidateSaveResultThrowsOnRevisionNotAdvancing() {
        val req = FinancialPlanSaveRequest(expectedRevision = 2L, inputs = testInputs)
        // Stale revision or skipped revision
        val sameRevisionPlan = mockSavedPlan(revision = 2L, inputs = testInputs)
        assertThrows(IllegalArgumentException::class.java) {
            FinancialPlanWorkOwner.validateSaveResult(req, sameRevisionPlan)
        }

        val skippedRevisionPlan = mockSavedPlan(revision = 4L, inputs = testInputs)
        assertThrows(IllegalArgumentException::class.java) {
            FinancialPlanWorkOwner.validateSaveResult(req, skippedRevisionPlan)
        }
    }
}
