package com.yansuu1.jizhang.ui

import com.yansuu1.jizhang.net.ApiException
import com.yansuu1.jizhang.net.AuthExpiredException
import com.yansuu1.jizhang.repo.FinancialCategoryRule
import com.yansuu1.jizhang.repo.FinancialConfig
import com.yansuu1.jizhang.repo.FinancialCycle
import com.yansuu1.jizhang.repo.FinancialCycleKind
import com.yansuu1.jizhang.repo.FinancialMappingCategory
import com.yansuu1.jizhang.repo.FinancialRatiosBps
import com.yansuu1.jizhang.repo.FinancialRefundOriginal
import com.yansuu1.jizhang.repo.FinancialRefundOriginalState
import com.yansuu1.jizhang.repo.FinancialRefundReview
import com.yansuu1.jizhang.repo.FinancialRefundSplit
import com.yansuu1.jizhang.repo.FinancialRefundState
import com.yansuu1.jizhang.repo.PurposeProvenance
import com.yansuu1.jizhang.repo.PurposeResolution
import com.yansuu1.jizhang.repo.PurposeResolutionReason
import com.yansuu1.jizhang.repo.SpendingPurpose
import com.yansuu1.jizhang.repo.isFinancialReplayResourceAllowed
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

class FinancialExecutionSheetStateTest {

    // ── Config ───────────────────────────────────────────────────────────────

    private fun config(
        revision: Long = 3,
        essential: Long? = null,
        cycle: FinancialCycle = FinancialCycle.naturalMonth(),
    ): FinancialConfig = FinancialConfig(
        revision = revision,
        enabled = true,
        ratiosBps = FinancialRatiosBps.DEFAULT,
        essentialMonthlyCents = essential,
        targetMonths = 5,
        cycle = cycle,
        timeZone = "Asia/Shanghai",
        updatedAt = 1760000000000L,
    )

    @Test
    fun configPercentConversionIsExactAndRejectsInvalidShapes() {
        assertEquals(2500, FinancialSheetDecimal.parsePercentToBps("25", "成长"))
        assertEquals(2550, FinancialSheetDecimal.parsePercentToBps("25.5", "成长"))
        assertEquals(1, FinancialSheetDecimal.parsePercentToBps("0.01", "成长"))
        assertEquals(10000, FinancialSheetDecimal.parsePercentToBps("100.00", "成长"))
        assertEquals("25", FinancialSheetDecimal.formatPercent(2500))
        assertEquals("25.5", FinancialSheetDecimal.formatPercent(2550))
        assertEquals("0.01", FinancialSheetDecimal.formatPercent(1))
        assertThrows(IllegalArgumentException::class.java) {
            FinancialSheetDecimal.parsePercentToBps("-1", "成长")
        }
        assertThrows(IllegalArgumentException::class.java) {
            FinancialSheetDecimal.parsePercentToBps("10.001", "成长")
        }
        assertThrows(IllegalArgumentException::class.java) {
            FinancialSheetDecimal.parsePercentToBps("100.01", "成长")
        }
    }

    @Test
    fun configDraftBaselineIsCanonicalAndValidationBuildsTypedRequest() {
        val draft = FinancialConfigDraftLogic.from(config())
        assertEquals("25", draft.growthPercent)
        assertEquals("15", draft.reservePercent)
        assertEquals("50", draft.essentialsPercent)
        assertEquals("10", draft.joyPercent)
        assertEquals("", draft.essentialYuan)
        assertEquals("5", draft.targetMonths)
        assertEquals(FinancialCycleKind.NATURAL_MONTH, draft.cycleKind)

        val parsed = FinancialConfigDraftLogic.validate(draft).getOrThrow()
        assertNull(parsed.essentialMonthlyCents)
        assertEquals(10000, parsed.ratios.growth + parsed.ratios.reserve + parsed.ratios.essentials + parsed.ratios.joy)
        val request = FinancialConfigDraftLogic.buildUpdate("op-1", 3, parsed)
        assertEquals("op-1", request.operationId)
        assertEquals(3, request.expectedRevision)
        assertNull(request.essentialMonthlyCents)
        assertEquals(JSONObject.NULL, request.toJson().get("essentialMonthlyCents"))
    }

    @Test
    fun configValidationRejectsBadRatioSumOptionalZeroAndRanges() {
        val draft = FinancialConfigDraftLogic.from(config())
        assertTrue(FinancialConfigDraftLogic.validate(draft.copy(joyPercent = "5")).isFailure)
        assertTrue(
            FinancialConfigDraftLogic.validate(
                draft.copy(
                    growthPercent = "100",
                    reservePercent = "100",
                    essentialsPercent = "100",
                    joyPercent = "100",
                ),
            ).isFailure,
        )
        assertTrue(FinancialConfigDraftLogic.validate(draft.copy(essentialYuan = "0")).isFailure)
        assertTrue(FinancialConfigDraftLogic.validate(draft.copy(essentialYuan = "0.01")).isSuccess)
        assertEquals(1L, FinancialConfigDraftLogic.validate(draft.copy(essentialYuan = "0.01")).getOrThrow().essentialMonthlyCents)
        assertTrue(FinancialConfigDraftLogic.validate(draft.copy(targetMonths = "0")).isFailure)
        assertTrue(FinancialConfigDraftLogic.validate(draft.copy(targetMonths = "121")).isFailure)
        assertTrue(FinancialConfigDraftLogic.validate(draft.copy(timeZone = "  ")).isFailure)
        assertTrue(
            FinancialConfigDraftLogic.validate(
                draft.copy(cycleKind = FinancialCycleKind.START_DAY, cycleDay = "29"),
            ).isFailure,
        )
        val startDay = FinancialConfigDraftLogic.validate(
            draft.copy(cycleKind = FinancialCycleKind.START_DAY, cycleDay = "25"),
        ).getOrThrow()
        assertEquals(FinancialCycle.startDay(25), startDay.cycle)
    }

    @Test
    fun configDirtyUsesWholeDraftIncludingEnabledAndTimezone() {
        val base = FinancialConfigDraftLogic.from(config())
        assertFalse(FinancialConfigDraftLogic.isDirty(base, base))
        assertTrue(FinancialConfigDraftLogic.isDirty(base.copy(enabled = false), base))
        assertTrue(FinancialConfigDraftLogic.isDirty(base.copy(timeZone = "UTC"), base))
        assertTrue(FinancialConfigDraftLogic.isDirty(base.copy(essentialYuan = "1"), base))
    }

    @Test
    fun configPreservesNonDefaultRatiosExactly() {
        val custom = config().copy(ratiosBps = FinancialRatiosBps(3000, 1500, 4500, 1000))
        val draft = FinancialConfigDraftLogic.from(custom)
        assertEquals("30", draft.growthPercent)
        assertEquals("45", draft.essentialsPercent)
        val parsed = FinancialConfigDraftLogic.validate(draft).getOrThrow()
        assertEquals(FinancialRatiosBps(3000, 1500, 4500, 1000), parsed.ratios)
    }

    // ── Mapping ──────────────────────────────────────────────────────────────

    private fun category(id: String, parentId: String? = null, deleted: Boolean = false) =
        FinancialMappingCategory(id = id, parentId = parentId, deleted = deleted)

    private fun rule(id: String, purpose: SpendingPurpose?) =
        FinancialCategoryRule(categoryId = id, purpose = purpose)

    @Test
    fun mappingFourStatesDistinguishInheritFromExplicitUnresolved() {
        val choices = FinancialMappingDraftLogic.choicesOf(
            listOf(
                rule("a", SpendingPurpose.ESSENTIALS),
                rule("b", null),
                rule("c", SpendingPurpose.JOY),
            ),
        )
        assertEquals(FinancialRuleChoice.ESSENTIALS, choices["a"])
        assertEquals(FinancialRuleChoice.EXPLICIT_UNRESOLVED, choices["b"])
        assertEquals(FinancialRuleChoice.JOY, choices["c"])
        assertNull(choices["missing"])

        val rules = FinancialMappingDraftLogic.rulesOf(
            mapOf(
                "a" to FinancialRuleChoice.ESSENTIALS,
                "b" to FinancialRuleChoice.INHERIT,
                "c" to FinancialRuleChoice.EXPLICIT_UNRESOLVED,
            ),
        )
        assertEquals(listOf("a", "c"), rules.map { it.categoryId })
        assertEquals(SpendingPurpose.ESSENTIALS, rules[0].purpose)
        assertNull(rules[1].purpose)
    }

    @Test
    fun mappingInheritanceWalksNearestAncestorAndStopsOnExplicitUnresolved() {
        val parents = mapOf("root" to null, "mid" to "root", "leaf" to "mid")
        val inherited = FinancialMappingDraftLogic.effectivePurpose(
            categoryId = "leaf",
            choices = mapOf("root" to FinancialRuleChoice.ESSENTIALS),
            parentById = parents,
        )
        assertEquals(SpendingPurpose.ESSENTIALS, inherited.purpose)
        assertEquals("root", inherited.sourceCategoryId)
        assertTrue(inherited.ruleFound)

        val stopped = FinancialMappingDraftLogic.effectivePurpose(
            categoryId = "leaf",
            choices = mapOf(
                "root" to FinancialRuleChoice.ESSENTIALS,
                "mid" to FinancialRuleChoice.EXPLICIT_UNRESOLVED,
            ),
            parentById = parents,
        )
        assertNull(stopped.purpose)
        assertTrue(stopped.stoppedByExplicitUnresolved)
        assertEquals("mid", stopped.sourceCategoryId)

        val own = FinancialMappingDraftLogic.effectivePurpose(
            categoryId = "leaf",
            choices = mapOf("leaf" to FinancialRuleChoice.JOY),
            parentById = parents,
        )
        assertEquals(SpendingPurpose.JOY, own.purpose)
        assertEquals("leaf", own.sourceCategoryId)
    }

    @Test
    fun mappingRowsKeepLiveAndDeletedHistoricalRulesWithoutGuessingNames() {
        val rows = FinancialMappingDraftLogic.buildRows(
            categories = listOf(
                category("root"),
                category("child", "root"),
                category("deleted-rule", "root", deleted = true),
                category("deleted-empty", "root", deleted = true),
            ),
            labels = mapOf("root" to "生活", "child" to "餐饮", "deleted-rule" to "旧分类"),
            rules = listOf(rule("deleted-rule", SpendingPurpose.JOY)),
        )
        assertEquals(listOf("root", "child", "deleted-rule").toSet(), rows.map { it.categoryId }.toSet())
        assertEquals(1, rows.first { it.categoryId == "child" }.depth)
        assertTrue(rows.first { it.categoryId == "deleted-rule" }.deleted)
        assertTrue(rows.first { it.categoryId == "deleted-rule" }.hasRule)
        assertFalse(rows.any { it.categoryId == "deleted-empty" })
    }

    @Test
    fun mappingRowsIncludeRuleForCategoryMissingFromSnapshotAndSurviveCycles() {
        val rows = FinancialMappingDraftLogic.buildRows(
            categories = listOf(category("a", "b"), category("b", "a")),
            labels = emptyMap(),
            rules = listOf(rule("orphan", null)),
        )
        assertTrue(rows.any { it.categoryId == "a" })
        assertTrue(rows.any { it.categoryId == "b" })
        assertTrue(rows.any { it.categoryId == "orphan" && it.deleted })
        assertEquals(3, rows.size)
    }

    @Test
    fun mappingValidationRejectsUnknownRulesAndMoreThanTwoThousandEntries() {
        val allowed = setOf("a", "b")
        assertTrue(
            FinancialMappingDraftLogic.validate(
                mapOf("a" to FinancialRuleChoice.ESSENTIALS, "outside" to FinancialRuleChoice.JOY),
                allowed,
            ).isFailure,
        )
        val tooMany = (1..2001).associate { index -> "c$index" to FinancialRuleChoice.JOY }
        assertTrue(FinancialMappingDraftLogic.validate(tooMany, tooMany.keys).isFailure)
        assertEquals(
            listOf(FinancialCategoryRule("a", SpendingPurpose.ESSENTIALS)),
            FinancialMappingDraftLogic.validate(mapOf("a" to FinancialRuleChoice.ESSENTIALS), allowed).getOrThrow(),
        )
    }

    // ── Refund ───────────────────────────────────────────────────────────────

    private fun resolution(): PurposeResolution = PurposeResolution(
        purpose = null,
        provenance = PurposeProvenance.UNRESOLVED,
        ruleCategoryId = null,
        mappingRevision = 0,
        reason = PurposeResolutionReason.NOT_MAPPED,
    )

    private fun original(
        id: String,
        amountCents: Long,
        remainingCents: Long = amountCents,
        state: FinancialRefundOriginalState = FinancialRefundOriginalState.LIVE,
        token: String = "token-$id",
    ) = FinancialRefundOriginal(
        transactionId = id,
        transactionToken = token,
        amountCents = amountCents,
        date = 1760000000000L,
        periodId = null,
        resolution = resolution(),
        otherConfirmedRefundCents = amountCents - remainingCents,
        remainingRefundableCents = remainingCents,
        state = state,
    )

    private fun review(
        amountCents: Long = 10000,
        splits: List<FinancialRefundSplit> = emptyList(),
        originals: List<FinancialRefundOriginal> = listOf(
            original("o1", 6000),
            original("o2", 4000),
        ),
        suggested: List<FinancialRefundSplit>? = null,
        legacyIds: List<String> = emptyList(),
    ) = FinancialRefundReview(
        refundTransactionId = "refund-1",
        refundToken = "refund-token",
        amountCents = amountCents,
        date = 1760000000000L,
        revision = 7,
        state = FinancialRefundState.REVIEW_REQUIRED,
        splits = splits,
        validAttributedCents = splits.sumOf { it.amountCents },
        unresolvedCents = amountCents - splits.sumOf { it.amountCents },
        reasons = listOf("legacy-links-require-confirmation"),
        originals = originals,
        suggestedSplits = suggested,
        legacyOriginalIds = legacyIds,
    )

    @Test
    fun refundInitialDraftUsesExistingSplitsAndExactDecimalText() {
        val loaded = review(splits = listOf(FinancialRefundSplit("o1", 3050)))
        assertEquals(mapOf("o1" to "30.50"), FinancialRefundDraftLogic.initialDraft(loaded))
    }

    @Test
    fun refundValidationBuildsExactSplitsTokensAndPendingRemainder() {
        val loaded = review(suggested = listOf(FinancialRefundSplit("o1", 10000)), legacyIds = listOf("o1"))
        assertEquals(mapOf("o1" to "100.00"), FinancialRefundDraftLogic.suggestedDraft(loaded))
        val draft = FinancialRefundDraftLogic.validate(
            mapOf("o1" to "30.00", "o2" to "20.50"),
            loaded,
        ).getOrThrow()
        assertEquals(5050L, draft.totalCents)
        assertEquals(4950L, draft.remainingCents)
        assertEquals(listOf("o1", "o2"), draft.splits.map { it.originalTransactionId })
        assertEquals(listOf("token-o1", "token-o2"), draft.originals.map { it.expectedTransactionToken })
        val request = FinancialRefundDraftLogic.buildRequest("op-r", loaded, draft)
        assertEquals(7, request.expectedRevision)
        assertEquals("refund-token", request.expectedRefundToken)
        assertEquals(draft.splits.toSet(), request.splits.toSet())
        assertEquals(draft.originals.toSet(), request.originals.toSet())
    }

    @Test
    fun refundValidationEnforcesOriginalAndRefundCapsAndNonLiveState() {
        val loaded = review(originals = listOf(original("o1", 1000, remainingCents = 500)))
        assertTrue(FinancialRefundDraftLogic.validate(mapOf("o1" to "5.01"), loaded).isFailure)
        assertTrue(FinancialRefundDraftLogic.validate(mapOf("o1" to "5.00"), loaded).isSuccess)

        val capped = review() // total 10000
        assertTrue(
            FinancialRefundDraftLogic.validate(
                mapOf("o1" to "60.00", "o2" to "40.01"),
                capped,
            ).isFailure,
        )
        val deleted = review(
            originals = listOf(original("o1", 1000, state = FinancialRefundOriginalState.DELETED)),
        )
        assertTrue(FinancialRefundDraftLogic.validate(mapOf("o1" to "1.00"), deleted).isFailure)
        val blankToken = review(
            originals = listOf(original("o1", 1000, token = "")),
        )
        assertTrue(FinancialRefundDraftLogic.validate(mapOf("o1" to "1.00"), blankToken).isFailure)
    }

    @Test
    fun refundEmptyDraftExplicitlyClearsAndExternalCandidateUsesFetchedToken() {
        val loaded = review(splits = listOf(FinancialRefundSplit("o1", 1000)))
        val cleared = FinancialRefundDraftLogic.validate(emptyMap(), loaded).getOrThrow()
        assertTrue(cleared.splits.isEmpty())
        assertTrue(cleared.originals.isEmpty())
        assertEquals(10000L, cleared.remainingCents)

        val external = FinancialRefundCandidate(
            originalId = "picked",
            token = "picked-token",
            amountCents = 2000,
            remainingCents = 2000,
            date = 0,
            state = FinancialRefundOriginalState.LIVE,
            otherConfirmedRefundCents = 0,
            isExternal = true,
        )
        val draft = FinancialRefundDraftLogic.validate(
            mapOf("picked" to "12.34"),
            loaded,
            mapOf("picked" to external),
        ).getOrThrow()
        assertEquals("picked-token", draft.originals.single().expectedTransactionToken)
        assertEquals(1234L, draft.splits.single().amountCents)
    }

    // ── Failure classification / replay resource ─────────────────────────────

    @Test
    fun writeFailureClassificationSeparatesDefinitiveRejectionFromUnknown() {
        assertTrue(classifyFinancialWriteFailure(AuthExpiredException()) is FinancialWriteFailure.AuthExpired)
        assertEquals(
            "FINANCIAL_REVISION_CONFLICT",
            (classifyFinancialWriteFailure(
                ApiException(409, "FINANCIAL_REVISION_CONFLICT", "changed"),
            ) as FinancialWriteFailure.Rejected).code,
        )
        assertTrue(
            classifyFinancialWriteFailure(ApiException(503, "FINANCIAL_UNAVAILABLE", "down")) is
                FinancialWriteFailure.Unknown,
        )
        assertTrue(
            classifyFinancialWriteFailure(ApiException(408, "TIMEOUT", "timeout")) is
                FinancialWriteFailure.Unknown,
        )
        assertTrue(classifyFinancialWriteFailure(IOException("offline")) is FinancialWriteFailure.Unknown)
        assertTrue(classifyFinancialWriteFailure(IllegalStateException("decode")) is FinancialWriteFailure.Unknown)
    }

    @Test
    fun refundPathIsEncodedAndAllowedForExactReplay() {
        val segment = financialPathSegment("refund 1")
        assertEquals("refund%201", segment)
        val path = "$FINANCIAL_PLANNING_PATH/refunds/$segment/splits"
        assertTrue(isFinancialReplayResourceAllowed(path))
        assertFalse(isFinancialReplayResourceAllowed("$FINANCIAL_PLANNING_PATH/refunds/..%2Fsecret/splits"))
        // Encoded path separators must never become replayable.
        assertFalse(
            isFinancialReplayResourceAllowed(
                "$FINANCIAL_PLANNING_PATH/refunds/${financialPathSegment("refund/1")}/splits",
            ),
        )
    }
}
