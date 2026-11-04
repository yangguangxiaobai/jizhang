package com.yansuu1.jizhang.ui

import com.yansuu1.jizhang.repo.FinancialAllocationDecision
import com.yansuu1.jizhang.repo.FinancialConfig
import com.yansuu1.jizhang.repo.FinancialConfigResponse
import com.yansuu1.jizhang.repo.FinancialCycle
import com.yansuu1.jizhang.repo.FinancialLegacyWindow
import com.yansuu1.jizhang.repo.FinancialMeta
import com.yansuu1.jizhang.repo.FinancialPeriod
import com.yansuu1.jizhang.repo.FinancialPeriodSourceState
import com.yansuu1.jizhang.repo.FinancialPeriodReason
import com.yansuu1.jizhang.repo.FinancialRatiosBps
import com.yansuu1.jizhang.repo.FinancialRules
import com.yansuu1.jizhang.repo.FinancialSalarySource
import com.yansuu1.jizhang.repo.FinancialSourceSnapshot
import com.yansuu1.jizhang.repo.FinancialSourceStatus
import com.yansuu1.jizhang.repo.FinancialWindow
import com.yansuu1.jizhang.repo.PurposeAmounts
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SalaryFinancialProposalTest {

    private val meta = FinancialMeta(
        contractVersion = 1L,
        rules = FinancialRules(
            allocation = "financial-allocation-bps-v1",
            cycle = "financial-cycle-frozen-month-v1",
            purpose = "financial-purpose-snapshot-v1",
            refund = "financial-refund-splits-v1",
            execution = "financial-net-v1",
        ),
        calculatedAt = 100L,
    )

    private fun config(
        enabled: Boolean = true,
        revision: Long = 3L,
        mappingRevision: Long = 7L,
    ) = FinancialConfigResponse(
        meta = meta,
        config = FinancialConfig(
            revision = revision,
            enabled = enabled,
            ratiosBps = FinancialRatiosBps.DEFAULT,
            essentialMonthlyCents = null,
            targetMonths = 5,
            cycle = FinancialCycle.naturalMonth(),
            timeZone = "Asia/Shanghai",
            updatedAt = null,
        ),
        mappingRevision = mappingRevision,
        legacyCycle = null,
    )

    private fun source(
        id: String = "salary-new",
        token: String = "token-new",
        selectable: Boolean = true,
        groupMonth: String = "2026-10",
        includedPeriodId: String? = null,
    ) = FinancialSalarySource(
        salaryId = id,
        amountCents = 100000L,
        date = 1_790_000_000_000L,
        accountId = "acc-1",
        sourceToken = token,
        updatedAt = 2L,
        includedPeriodId = includedPeriodId,
        includedRevision = null,
        proposedGroupMonth = groupMonth,
        proposedWindow = null,
        selectable = selectable,
        reason = null,
    )

    private fun snapshot(
        id: String,
        token: String,
        status: FinancialSourceStatus = FinancialSourceStatus.VALID,
    ) = FinancialSourceSnapshot(
        salaryId = id,
        amountCents = 100000L,
        date = 1_790_000_000_000L,
        accountId = "acc-1",
        sourceToken = token,
        confirmedAt = 1L,
        status = status,
        current = null,
    )

    private fun period(
        id: String = "period-1",
        revision: Long = 4L,
        sources: List<FinancialSourceSnapshot> = listOf(snapshot("salary-old", "token-old")),
    ): FinancialPeriod {
        val window = FinancialWindow(
            cycleKey = "2026-10",
            groupMonth = "2026-10",
            start = 1_789_000_000_000L,
            end = 1_791_000_000_000L,
            timeZone = "Asia/Shanghai",
            cycle = FinancialCycle.naturalMonth(),
            anchorSalaryId = "salary-old",
            groupingRule = "financial-cycle-frozen-month-v1",
            legacyWindow = null,
            warnings = emptyList(),
        )
        return FinancialPeriod(
            id = id,
            revision = revision,
            createdAt = 1L,
            confirmedAt = 2L,
            window = window,
            decision = FinancialAllocationDecision(
                incomeCents = 100000L,
                ratiosBps = FinancialRatiosBps.DEFAULT,
                targets = PurposeAmounts(25000L, 15000L, 50000L, 10000L),
                configRevision = 1L,
                mappingRevision = 7L,
                mappingSnapshotId = null,
                essentialMonthlyCents = null,
                targetMonths = 5,
            ),
            sources = sources,
            sourceState = FinancialPeriodSourceState.VALID,
            confirmedIncomeCents = 100000L,
            verifiedIncomeCents = 100000L,
            warnings = emptyList(),
        )
    }

    @Test
    fun newPeriodProposalUsesActualSalaryConfigAndMappingRevisions() {
        val proposal = SalaryFinancialProposalBuilder.build(config(), source(), emptyList())
        requireNotNull(proposal)
        assertNull(proposal.periodId)
        assertEquals(0L, proposal.expectedRevision)
        assertEquals(3L, proposal.expectedConfigRevision)
        assertEquals(7L, proposal.expectedMappingRevision)
        assertEquals(1, proposal.selectedSources.size)
        assertEquals("salary-new", proposal.selectedSources.single().salaryId)
        assertEquals("token-new", proposal.selectedSources.single().expectedSourceToken)
        assertEquals(FinancialPeriodReason.SALARY_CONFIRMATION, proposal.reason)
    }

    @Test
    fun existingSamePeriodKeepsEveryValidExistingSourcePlusTheNewSalary() {
        val existing = period(
            revision = 9L,
            sources = listOf(
                snapshot("salary-old", "token-old"),
                snapshot("salary-deleted", "token-deleted", FinancialSourceStatus.DELETED),
            ),
        )
        val proposal = SalaryFinancialProposalBuilder.build(config(), source(), listOf(existing))
        requireNotNull(proposal)
        assertEquals("period-1", proposal.periodId)
        assertEquals(9L, proposal.expectedRevision)
        assertEquals(
            listOf("salary-old", "salary-new"),
            proposal.selectedSources.map { it.salaryId },
        )
        assertEquals("token-old", proposal.selectedSources.first().expectedSourceToken)
    }

    @Test
    fun disabledConfigOrUnselectableSourceDoesNotOfferAPeriod() {
        assertNull(SalaryFinancialProposalBuilder.build(config(enabled = false), source(), emptyList()))
        assertNull(SalaryFinancialProposalBuilder.build(config(), source(selectable = false), emptyList()))
        assertNull(
            "已纳入周期的工资不应再次弹出确认",
            SalaryFinancialProposalBuilder.build(config(), source(includedPeriodId = "period-1"), listOf(period())),
        )
    }

    @Test
    fun ambiguousExistingPeriodsAreNotGuessed() {
        val first = period("period-1")
        val second = period("period-2")
        assertNull(SalaryFinancialProposalBuilder.build(config(), source(), listOf(first, second)))
    }

    @Test
    fun existingPeriodInAnotherGroupMonthIsNotReused() {
        val proposal = SalaryFinancialProposalBuilder.build(
            config(),
            source(groupMonth = "2026-11"),
            listOf(period()),
        )
        requireNotNull(proposal)
        assertNull(proposal.periodId)
        assertEquals(0L, proposal.expectedRevision)
    }
}
