package com.yansuu1.jizhang.ui

import com.yansuu1.jizhang.net.ApiClient
import com.yansuu1.jizhang.net.ApiException
import com.yansuu1.jizhang.repo.FinancialAllocationDecision
import com.yansuu1.jizhang.repo.FinancialConfig
import com.yansuu1.jizhang.repo.FinancialConfigResponse
import com.yansuu1.jizhang.repo.FinancialCycle
import com.yansuu1.jizhang.repo.FinancialExecutionContract
import com.yansuu1.jizhang.repo.FinancialExecutionRepository
import com.yansuu1.jizhang.repo.FinancialMappingPolicy
import com.yansuu1.jizhang.repo.FinancialMeta
import com.yansuu1.jizhang.repo.FinancialPeriod
import com.yansuu1.jizhang.repo.FinancialPeriodReason
import com.yansuu1.jizhang.repo.FinancialPeriodSourceState
import com.yansuu1.jizhang.repo.FinancialPeriodsResponse
import com.yansuu1.jizhang.repo.FinancialRatiosBps
import com.yansuu1.jizhang.repo.FinancialRules
import com.yansuu1.jizhang.repo.FinancialSalarySource
import com.yansuu1.jizhang.repo.FinancialSourceSnapshot
import com.yansuu1.jizhang.repo.FinancialSourceStatus
import com.yansuu1.jizhang.repo.FinancialWindow
import com.yansuu1.jizhang.repo.PurposeAmounts
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class ExistingSalaryExecutionTest {

    private fun config(enabled: Boolean = true): FinancialConfigResponse {
        val meta = FinancialMeta(
            contractVersion = FinancialExecutionContract.CONTRACT_VERSION,
            rules = FinancialRules(
                allocation = FinancialExecutionContract.ALLOCATION_RULE,
                cycle = FinancialExecutionContract.CYCLE_RULE,
                purpose = FinancialExecutionContract.PURPOSE_RULE,
                refund = FinancialExecutionContract.REFUND_RULE,
                execution = FinancialExecutionContract.EXECUTION_RULE,
            ),
            calculatedAt = 1_700_000_000_000L,
        )
        val cfg = FinancialConfig(
            revision = 3L,
            enabled = enabled,
            ratiosBps = FinancialRatiosBps.DEFAULT,
            essentialMonthlyCents = null,
            targetMonths = 5,
            cycle = FinancialCycle.naturalMonth(),
            timeZone = "Asia/Shanghai",
            updatedAt = 1_700_000_000_000L,
        )
        return FinancialConfigResponse(meta = meta, config = cfg, mappingRevision = 7L, legacyCycle = null)
    }

    private fun source(
        id: String = "salary-1",
        amountCents: Long = 100_000L,
        groupMonth: String = "2026-10",
        selectable: Boolean = true,
        includedPeriodId: String? = null,
        token: String = "tok-$id",
    ): FinancialSalarySource = FinancialSalarySource(
        salaryId = id,
        amountCents = amountCents,
        date = 1_790_000_000_000L,
        accountId = "acc-1",
        sourceToken = token,
        updatedAt = 1_790_000_000_000L,
        includedPeriodId = includedPeriodId,
        includedRevision = if (includedPeriodId != null) 1L else null,
        proposedGroupMonth = groupMonth,
        proposedWindow = null,
        selectable = selectable,
        reason = null,
    )

    private fun period(
        id: String = "period-1",
        revision: Long = 1L,
        groupMonth: String = "2026-10",
        sourceState: FinancialPeriodSourceState = FinancialPeriodSourceState.VALID,
        sources: List<FinancialSourceSnapshot> = listOf(
            FinancialSourceSnapshot(
                salaryId = "salary-old",
                amountCents = 80_000L,
                date = 1_790_000_000_000L,
                accountId = "acc-1",
                sourceToken = "tok-old",
                confirmedAt = 1_790_000_000_000L,
                status = FinancialSourceStatus.VALID,
                current = null,
            ),
        ),
    ): FinancialPeriod {
        val window = FinancialWindow(
            cycleKey = "cycle-$id",
            groupMonth = groupMonth,
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
                incomeCents = 80_000L,
                ratiosBps = FinancialRatiosBps.DEFAULT,
                targets = PurposeAmounts(20_000L, 12_000L, 40_000L, 8_000L),
                configRevision = 1L,
                mappingRevision = 7L,
                mappingSnapshotId = null,
                essentialMonthlyCents = null,
                targetMonths = 5,
            ),
            sources = sources,
            sourceState = sourceState,
            confirmedIncomeCents = 80_000L,
            verifiedIncomeCents = 80_000L,
            warnings = emptyList(),
        )
    }

    @Test
    fun newPeriodProposalWithSingleOrMultipleSourcesInSameMonth() {
        val cfg = config(enabled = true)
        val s1 = source("salary-1", groupMonth = "2026-10")
        val s2 = source("salary-2", groupMonth = "2026-10")

        val proposal = ExistingSalaryProposalBuilder.build(cfg, listOf(s1, s2), emptyList())
        assertNotNull(proposal)
        assertNull(proposal?.periodId)
        assertEquals(0L, proposal?.expectedRevision)
        assertEquals(3L, proposal?.expectedConfigRevision)
        assertEquals(7L, proposal?.expectedMappingRevision)
        assertEquals(2, proposal?.selectedSources?.size)
        assertEquals(listOf("salary-1", "salary-2"), proposal?.selectedSources?.map { it.salaryId })
        assertEquals(FinancialMappingPolicy.PRESERVE, proposal?.mappingPolicy)
        assertEquals(FinancialPeriodReason.SALARY_CONFIRMATION, proposal?.reason)
    }

    @Test
    fun mismatchedMonthsOrUnselectableSourcesAreRejected() {
        val cfg = config(enabled = true)
        val s1 = source("salary-1", groupMonth = "2026-10")
        val s2 = source("salary-2", groupMonth = "2026-11") // Different month
        assertNull("不同归属月份应拒绝合并提案", ExistingSalaryProposalBuilder.build(cfg, listOf(s1, s2), emptyList()))

        val unselectable = source("salary-bad", selectable = false)
        assertNull("不可选工资源应拒绝", ExistingSalaryProposalBuilder.build(cfg, listOf(unselectable), emptyList()))

        val alreadyIncluded = source("salary-inc", includedPeriodId = "period-exists")
        assertNull("已纳入周期的工资源应拒绝", ExistingSalaryProposalBuilder.build(cfg, listOf(alreadyIncluded), emptyList()))

        val disabledCfg = config(enabled = false)
        assertNull("规划未启用时应拒绝提案", ExistingSalaryProposalBuilder.build(disabledCfg, listOf(s1), emptyList()))
    }

    @Test
    fun existingPeriodAppendPreservesValidSourcesAndBlocksReconcileRequired() {
        val cfg = config(enabled = true)
        val sNew = source("salary-new", groupMonth = "2026-10")
        val existingValid = period("period-10", revision = 4L, sourceState = FinancialPeriodSourceState.VALID)

        val proposal = ExistingSalaryProposalBuilder.build(cfg, listOf(sNew), listOf(existingValid))
        assertNotNull(proposal)
        assertEquals("period-10", proposal?.periodId)
        assertEquals(4L, proposal?.expectedRevision)
        assertEquals(listOf("salary-old", "salary-new"), proposal?.selectedSources?.map { it.salaryId })

        // 若已有周期状态处于 RECONCILIATION_REQUIRED，必须阻断追加，强制用户走对齐重算流程
        val existingReconcile = period("period-reconcile", revision = 5L, sourceState = FinancialPeriodSourceState.RECONCILIATION_REQUIRED)
        assertNull(
            "已有周期若有工资源变动（非 VALID），禁止直接追加新工资",
            ExistingSalaryProposalBuilder.build(cfg, listOf(sNew), listOf(existingReconcile)),
        )
    }

    @Test
    fun ambiguousMultipleExistingPeriodsRejectProposal() {
        val cfg = config(enabled = true)
        val s = source("salary-new", groupMonth = "2026-10")
        val p1 = period("period-1", groupMonth = "2026-10")
        val p2 = period("period-2", groupMonth = "2026-10")
        assertNull("同一月份存在多个已有周期时属于歧义数据，必须拒绝自动猜测", ExistingSalaryProposalBuilder.build(cfg, listOf(s), listOf(p1, p2)))
    }

    @Test
    fun formatEpochDateInZoneHandlesTimeZonesCorrectly() {
        // 1789000000000 ms -> 2026-09-10 00:26:40 UTC / 08:26:40 Shanghai
        val epochMs = 1_789_000_000_000L
        val shanghai = formatEpochDateInZone(epochMs, "Asia/Shanghai")
        assertEquals("2026-09-10", shanghai)

        // 空或非法时区不崩溃
        val fallback = formatEpochDateInZone(epochMs, "INVALID_ZONE")
        assertTrue(fallback.matches(Regex("^\\d{4}-\\d{2}-\\d{2}$")))
    }
}
