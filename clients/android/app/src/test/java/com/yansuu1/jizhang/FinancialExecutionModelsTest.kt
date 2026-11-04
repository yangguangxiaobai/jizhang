package com.yansuu1.jizhang

import com.yansuu1.jizhang.net.ApiException
import com.yansuu1.jizhang.net.AuthExpiredException
import com.yansuu1.jizhang.repo.FinancialBillPurpose
import com.yansuu1.jizhang.repo.FinancialBillPurposeUpdateRequest
import com.yansuu1.jizhang.repo.FinancialCategoryRule
import com.yansuu1.jizhang.repo.FinancialCategoryRulesUpdateRequest
import com.yansuu1.jizhang.repo.FinancialConfig
import com.yansuu1.jizhang.repo.FinancialConfigResponse
import com.yansuu1.jizhang.repo.FinancialConfigUpdateRequest
import com.yansuu1.jizhang.repo.FinancialCycle
import com.yansuu1.jizhang.repo.FinancialExecution
import com.yansuu1.jizhang.repo.FinancialExecutionCoverage
import com.yansuu1.jizhang.repo.FinancialExecutionUnsupportedException
import com.yansuu1.jizhang.repo.FinancialFundingUnavailable
import com.yansuu1.jizhang.repo.FinancialMappingPolicy
import com.yansuu1.jizhang.repo.FinancialOperationResult
import com.yansuu1.jizhang.repo.FinancialPeriod
import com.yansuu1.jizhang.repo.FinancialPeriodConfirmRequest
import com.yansuu1.jizhang.repo.FinancialPeriodProposal
import com.yansuu1.jizhang.repo.FinancialPeriodReason
import com.yansuu1.jizhang.repo.FinancialPeriodsResponse
import com.yansuu1.jizhang.repo.FinancialPreview
import com.yansuu1.jizhang.repo.FinancialRatiosBps
import com.yansuu1.jizhang.repo.FinancialRefundOriginalRef
import com.yansuu1.jizhang.repo.FinancialRefundReview
import com.yansuu1.jizhang.repo.FinancialRefundSplit
import com.yansuu1.jizhang.repo.FinancialRefundSplitsUpdateRequest
import com.yansuu1.jizhang.repo.FinancialSourceSelection
import com.yansuu1.jizhang.repo.FinancialSourceStatus
import com.yansuu1.jizhang.repo.FinancialSpendState
import com.yansuu1.jizhang.repo.SpendingPurpose
import com.yansuu1.jizhang.repo.financialCapabilitiesFailure
import com.yansuu1.jizhang.repo.isFinancialReplayResourceAllowed
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class FinancialExecutionModelsTest {

    // ── Fixtures ─────────────────────────────────────────────────────────────

    private fun rulesJson(): JSONObject = JSONObject()
        .put("allocation", "financial-allocation-bps-v1")
        .put("cycle", "financial-cycle-frozen-month-v1")
        .put("purpose", "financial-purpose-snapshot-v1")
        .put("refund", "financial-refund-splits-v1")
        .put("execution", "financial-net-v1")

    private fun metaFields(json: JSONObject = JSONObject()): JSONObject = json
        .put("contractVersion", 1L)
        .put("rules", rulesJson())
        .put("calculatedAt", 1760000000000L)

    private fun ratiosJson(
        growth: Int = 2500,
        reserve: Int = 1500,
        essentials: Int = 5000,
        joy: Int = 1000,
    ): JSONObject = JSONObject()
        .put("growth", growth)
        .put("reserve", reserve)
        .put("essentials", essentials)
        .put("joy", joy)

    private fun naturalCycleJson(): JSONObject = JSONObject().put("kind", "natural-month")

    private fun configJson(): JSONObject = JSONObject()
        .put("revision", 0L)
        .put("enabled", false)
        .put("ratiosBps", ratiosJson())
        .put("essentialMonthlyCents", JSONObject.NULL)
        .put("targetMonths", 5)
        .put("cycle", naturalCycleJson())
        .put("timeZone", "Asia/Shanghai")
        .put("updatedAt", JSONObject.NULL)

    private fun configResponseJson(): JSONObject = metaFields()
        .put("config", configJson())
        .put("mappingRevision", 0L)
        .put("legacyCycle", naturalCycleJson())

    private fun windowJson(): JSONObject = JSONObject()
        .put("cycleKey", "2026-10")
        .put("groupMonth", "2026-10")
        .put("start", 1760000000000L)
        .put("end", 1762592000000L)
        .put("timeZone", "Asia/Shanghai")
        .put("cycle", naturalCycleJson())
        .put("anchorSalaryId", "sal-1")
        .put("groupingRule", "financial-cycle-frozen-month-v1")
        .put("legacyWindow", JSONObject().put("start", 1760000000000L).put("end", JSONObject.NULL))
        .put("warnings", JSONArray())

    private fun decisionJson(): JSONObject = JSONObject()
        .put("incomeCents", 1000000L)
        .put("ratiosBps", ratiosJson())
        .put(
            "targets",
            JSONObject()
                .put("growth", 250000L)
                .put("reserve", 150000L)
                .put("essentials", 500000L)
                .put("joy", 100000L),
        )
        .put("configRevision", 0L)
        .put("mappingRevision", 0L)
        .put("mappingSnapshotId", "mapping-snapshot-1")
        .put("essentialMonthlyCents", JSONObject.NULL)
        .put("targetMonths", 5)

    private fun sourceSnapshotJson(): JSONObject = JSONObject()
        .put("salaryId", "sal-1")
        .put("amountCents", 1000000L)
        .put("date", 1760000000000L)
        .put("accountId", "acc-1")
        .put("sourceToken", "source-token-1")
        .put("confirmedAt", 1760000100000L)
        .put("status", "valid")
        .put("current", JSONObject.NULL)

    private fun salarySourceJson(): JSONObject = JSONObject()
        .put("salaryId", "sal-1")
        .put("amountCents", 1000000L)
        .put("date", 1760000000000L)
        .put("accountId", "acc-1")
        .put("sourceToken", "source-token-1")
        .put("updatedAt", 1760000000000L)
        .put("includedPeriodId", JSONObject.NULL)
        .put("includedRevision", JSONObject.NULL)
        .put("proposedGroupMonth", "2026-10")
        .put("proposedWindow", JSONObject.NULL)
        .put("selectable", true)
        .put("reason", JSONObject.NULL)

    private fun periodJson(): JSONObject = JSONObject()
        .put("id", "period-1")
        .put("revision", 1L)
        .put("createdAt", 1760000200000L)
        .put("confirmedAt", 1760000200000L)
        .put("window", windowJson())
        .put("decision", decisionJson())
        .put("sources", JSONArray().put(sourceSnapshotJson()))
        .put("sourceState", "valid")
        .put("confirmedIncomeCents", 1000000L)
        .put("verifiedIncomeCents", 1000000L)
        .put("warnings", JSONArray())

    private fun spendJson(
        purpose: String,
        target: Long,
        gross: Long,
        refund: Long,
        net: Long,
        remaining: Long,
        overspend: Long,
        state: String,
    ): JSONObject = JSONObject()
        .put("purpose", purpose)
        .put("targetCents", target)
        .put("grossCents", gross)
        .put("attributedRefundCents", refund)
        .put("netCents", net)
        .put("remainingCents", remaining)
        .put("overspendCents", overspend)
        .put("state", state)

    private fun fundingJson(purpose: String, target: Long): JSONObject = JSONObject()
        .put("purpose", purpose)
        .put("targetCents", target)
        .put("state", "not-connected")
        .put("executedCents", JSONObject.NULL)
        .put("remainingCents", JSONObject.NULL)

    private fun unresolvedJson(): JSONObject = JSONObject()
        .put("expenseCount", 0L)
        .put("grossCents", 0L)
        .put("attributedRefundCents", 0L)
        .put("netCents", 0L)
        .put("linkedRefundCount", 0L)
        .put("linkedRefundUnresolvedCents", 0L)
        .put("globalUnassignedRefundCount", 0L)
        .put("globalUnassignedRefundCents", 0L)

    private fun envelopeJson(): JSONObject = JSONObject()
        .put("mode", "legacy-reference")
        .put("contract", "legacy-gross")
        .put("totalBudgetCents", 1000000L)
        .put(
            "mappedBudgetCents",
            JSONObject()
                .put("essentials", 500000L)
                .put("joy", 100000L)
                .put("unresolved", 0L),
        )
        .put("purposeSpendingCeilingCents", 600000L)
        .put("differenceCents", 400000L)
        .put("legacyWindow", JSONObject.NULL)
        .put("windowMatches", true)
        .put("validatedNestedAllocation", false)

    private fun executionJson(
        coverage: String = "provisional",
        spendState: String = "provisional",
    ): JSONObject = metaFields()
        .put("period", periodJson())
        .put(
            "spending",
            JSONArray()
                .put(spendJson("essentials", 500000L, 100L, 30L, 70L, 499930L, 0L, spendState))
                .put(spendJson("joy", 100000L, 100050L, 0L, 100050L, -50L, 50L, spendState)),
        )
        .put(
            "funding",
            JSONArray()
                .put(fundingJson("growth", 250000L))
                .put(fundingJson("reserve", 150000L)),
        )
        .put("unresolved", unresolvedJson())
        .put("coverage", coverage)
        .put("envelopeReference", envelopeJson())

    private fun capabilitiesJson(): JSONObject = metaFields()
        .put("phase", 1)
        .put("executionSupported", true)
        .put("salaryIdempotency", true)
        .put("billPurposeOverride", true)
        .put("refundSplits", true)
        .put("fundingExecution", false)
        .put("review", false)
        .put("aiExplanation", false)
        .put(
            "limits",
            JSONObject()
                .put("pageSize", 100)
                .put("selectedSources", 200)
                .put("refundSplits", 100)
                .put("categoryRules", 2000),
        )
        .put("serverTimeZone", "Asia/Shanghai")
        .put("legacyManualPlan", true)

    private fun proposal(): FinancialPeriodProposal = FinancialPeriodProposal(
        periodId = null,
        expectedRevision = 0L,
        expectedConfigRevision = 0L,
        expectedMappingRevision = 0L,
        selectedSources = listOf(FinancialSourceSelection("sal-1", "source-token-1")),
        mappingPolicy = FinancialMappingPolicy.PRESERVE,
        reason = FinancialPeriodReason.SALARY_CONFIRMATION,
    )

    // ── Capabilities / contract version ──────────────────────────────────────

    @Test
    fun capabilitiesDecodeStrictly() {
        val decoded = com.yansuu1.jizhang.repo.FinancialCapabilitiesResponse.fromJson(capabilitiesJson())
        assertEquals(1L, decoded.meta.contractVersion)
        assertEquals(1, decoded.phase)
        assertEquals(100, decoded.limits.pageSize)
        assertEquals(200, decoded.limits.selectedSources)
        assertEquals("Asia/Shanghai", decoded.serverTimeZone)
        assertFalse(decoded.fundingExecution)
        assertTrue(decoded.executionSupported)
    }

    @Test
    fun wrongContractVersionFailsClosed() {
        val json = capabilitiesJson().put("contractVersion", 2L)
        assertThrows(IllegalArgumentException::class.java) {
            com.yansuu1.jizhang.repo.FinancialCapabilitiesResponse.fromJson(json)
        }
    }

    @Test
    fun wrongRuleVersionFailsClosed() {
        val json = capabilitiesJson()
        json.getJSONObject("rules").put("execution", "financial-net-v2")
        assertThrows(IllegalArgumentException::class.java) {
            com.yansuu1.jizhang.repo.FinancialCapabilitiesResponse.fromJson(json)
        }
    }

    @Test
    fun missingCapabilityFieldIsNotTreatedAsFalse() {
        val json = capabilitiesJson()
        json.remove("executionSupported")
        assertThrows(IllegalArgumentException::class.java) {
            com.yansuu1.jizhang.repo.FinancialCapabilitiesResponse.fromJson(json)
        }
    }

    @Test
    fun capabilitiesErrorMappingDistinguishes404From401And5xx() {
        val unsupported = financialCapabilitiesFailure(ApiException(404, "NOT_FOUND", "not found"))
        assertTrue(unsupported is FinancialExecutionUnsupportedException)

        val auth = AuthExpiredException()
        assertSame(auth, financialCapabilitiesFailure(auth))

        val unavailable = ApiException(503, "FINANCIAL_UNAVAILABLE", "unavailable")
        assertSame(unavailable, financialCapabilitiesFailure(unavailable))
    }

    // ── Config / ratios / nulls / overflow ──────────────────────────────────

    @Test
    fun configAllowsNullBaselineAndNullUpdatedAt() {
        val response = FinancialConfigResponse.fromJson(configResponseJson())
        assertEquals(0L, response.config.revision)
        assertNull(response.config.essentialMonthlyCents)
        assertNull(response.config.updatedAt)
        assertEquals(FinancialRatiosBps.DEFAULT, response.config.ratiosBps)
        assertEquals(FinancialCycle.naturalMonth(), response.config.cycle)
    }

    @Test
    fun configMissingNullableFieldFailsInsteadOfDefaulting() {
        val json = configResponseJson()
        json.getJSONObject("config").remove("essentialMonthlyCents")
        assertThrows(IllegalArgumentException::class.java) {
            FinancialConfigResponse.fromJson(json)
        }
    }

    @Test
    fun configRejectsRatiosThatDoNotSumTo10000() {
        val json = configResponseJson()
        json.getJSONObject("config").put("ratiosBps", ratiosJson(growth = 2400))
        assertThrows(IllegalArgumentException::class.java) {
            FinancialConfigResponse.fromJson(json)
        }
    }

    @Test
    fun configRejectsNegativeRatio() {
        val json = configResponseJson()
        json.getJSONObject("config").put("ratiosBps", ratiosJson(growth = -1, joy = 3501))
        assertThrows(IllegalArgumentException::class.java) {
            FinancialConfigResponse.fromJson(json)
        }
    }

    @Test
    fun configRejectsFractionalRatioAndStringAmount() {
        val fractional = configResponseJson()
        fractional.getJSONObject("config").getJSONObject("ratiosBps").put("growth", 2500.5)
        assertThrows(IllegalArgumentException::class.java) {
            FinancialConfigResponse.fromJson(fractional)
        }

        val stringAmount = configResponseJson()
        stringAmount.getJSONObject("config").put("essentialMonthlyCents", "123")
        assertThrows(IllegalArgumentException::class.java) {
            FinancialConfigResponse.fromJson(stringAmount)
        }
    }

    @Test
    fun configRejectsUnsafeIntegerAmount() {
        val json = configResponseJson()
        json.getJSONObject("config").put("essentialMonthlyCents", 9007199254740992L)
        assertThrows(IllegalArgumentException::class.java) {
            FinancialConfigResponse.fromJson(json)
        }
    }

    @Test
    fun configRejectsInvalidTargetMonthsAndCycleDay() {
        val badMonths = configResponseJson()
        badMonths.getJSONObject("config").put("targetMonths", 121)
        assertThrows(IllegalArgumentException::class.java) {
            FinancialConfigResponse.fromJson(badMonths)
        }

        val badDay = configResponseJson()
        badDay.getJSONObject("config").put("cycle", JSONObject().put("kind", "start-day").put("day", 29))
        assertThrows(IllegalArgumentException::class.java) {
            FinancialConfigResponse.fromJson(badDay)
        }

        val unknownKind = configResponseJson()
        unknownKind.getJSONObject("config").put("cycle", JSONObject().put("kind", "weekly"))
        assertThrows(IllegalArgumentException::class.java) {
            FinancialConfigResponse.fromJson(unknownKind)
        }
    }

    @Test
    fun configUpdateRequestSerializationCoversAllFrozenFields() {
        val request = FinancialConfigUpdateRequest(
            operationId = "op-1",
            expectedRevision = 3L,
            enabled = true,
            ratiosBps = FinancialRatiosBps(3000, 1000, 5000, 1000),
            essentialMonthlyCents = null,
            targetMonths = 6,
            cycle = FinancialCycle.startDay(20),
            timeZone = "Asia/Shanghai",
        )
        val json = request.toJson()
        assertEquals("op-1", json.getString("operationId"))
        assertEquals(3L, json.getLong("expectedRevision"))
        assertTrue(json.getBoolean("enabled"))
        assertEquals(3000, json.getJSONObject("ratiosBps").getInt("growth"))
        assertTrue(json.isNull("essentialMonthlyCents"))
        assertEquals(6, json.getInt("targetMonths"))
        assertEquals("start-day", json.getJSONObject("cycle").getString("kind"))
        assertEquals(20, json.getJSONObject("cycle").getInt("day"))
        assertEquals("Asia/Shanghai", json.getString("timeZone"))
    }

    // ── Proposals / periods ──────────────────────────────────────────────────

    @Test
    fun proposalSerializationPreservesNullPeriodIdAndSelectedSources() {
        val json = proposal().toJson()
        assertTrue(json.isNull("periodId"))
        assertEquals("preserve", json.getString("mappingPolicy"))
        assertEquals("salary-confirmation", json.getString("reason"))
        val sources = json.getJSONArray("selectedSources")
        assertEquals(1, sources.length())
        assertEquals("sal-1", sources.getJSONObject(0).getString("salaryId"))
        assertEquals("source-token-1", sources.getJSONObject(0).getString("expectedSourceToken"))
    }

    @Test
    fun confirmRequestFlattensProposalAndPreviewToken() {
        val request = FinancialPeriodConfirmRequest("op-1", proposal(), "preview-token-1")
        val json = request.toJson()
        assertEquals("op-1", json.getString("operationId"))
        assertEquals("preview-token-1", json.getString("previewToken"))
        assertEquals(0L, json.getLong("expectedRevision"))
        assertEquals("salary-confirmation", json.getString("reason"))
        assertFalse(json.has("proposal"))
    }

    @Test
    fun periodsDecodeAndAllowNullCurrentPeriod() {
        val json = metaFields()
            .put("items", JSONArray().put(periodJson()))
            .put("total", 1L)
            .put("limit", 50)
            .put("offset", 0)
            .put("currentPeriodId", JSONObject.NULL)
        val response = FinancialPeriodsResponse.fromJson(json)
        assertEquals(1, response.items.size)
        assertEquals("period-1", response.items[0].id)
        assertNull(response.currentPeriodId)
        assertEquals(1000000L, response.items[0].confirmedIncomeCents)
    }

    @Test
    fun periodsMissingTotalFailsClosed() {
        val json = metaFields()
            .put("items", JSONArray())
            .put("limit", 50)
            .put("offset", 0)
            .put("currentPeriodId", JSONObject.NULL)
        assertThrows(IllegalArgumentException::class.java) {
            FinancialPeriodsResponse.fromJson(json)
        }
    }

    @Test
    fun periodRejectsUnknownSourceState() {
        val json = periodJson().put("sourceState", "stale")
        assertThrows(IllegalArgumentException::class.java) {
            FinancialPeriod.fromJson(json)
        }
    }

    @Test
    fun previewDecodeRequiresTokenAndMeta() {
        val impact = JSONObject()
            .put("addedSalaryIds", JSONArray().put("sal-1"))
            .put("removedSalaryIds", JSONArray())
            .put("changedSalaryIds", JSONArray())
            .put("mappingChanged", false)
            .put("reclassifiedExpenseCount", 0L)
            .put("reclassifiedGrossCents", 0L)
        val previewFields = JSONObject()
            .put("previewToken", "preview-token-1")
            .put("proposal", proposal().toJson())
            .put("window", windowJson())
            .put("decision", decisionJson())
            .put("sources", JSONArray().put(sourceSnapshotJson()))
            .put("excludedSources", JSONArray())
            .put("previousRevision", 0L)
            .put("warnings", JSONArray())
            .put("impact", impact)
        val response = metaFields().put("preview", previewFields)
        val decoded = FinancialPreview.fromJson(response.getJSONObject("preview"), response)
        assertEquals(1L, decoded.meta.contractVersion)
        assertEquals("preview-token-1", decoded.previewToken)
        assertEquals(0L, decoded.previousRevision)
        assertEquals(1, decoded.impact.addedSalaryIds.size)
        assertEquals("sal-1", decoded.sources[0].salaryId)
        assertEquals("valid", decoded.sources[0].status.wire)

        previewFields.remove("previewToken")
        assertThrows(IllegalArgumentException::class.java) {
            FinancialPreview.fromJson(previewFields, response)
        }
    }

    // ── Category mapping / bill purpose ─────────────────────────────────────

    @Test
    fun categoryRuleKeepsExplicitNullPurpose() {
        val rule = FinancialCategoryRule("cat-1", null)
        val json = rule.toJson()
        assertTrue(json.has("purpose"))
        assertTrue(json.isNull("purpose"))

        val decoded = FinancialCategoryRule.fromJson(json)
        assertNull(decoded.purpose)
    }

    @Test
    fun categoryRuleMissingPurposeFailsClosed() {
        val json = JSONObject().put("categoryId", "cat-1")
        assertThrows(IllegalArgumentException::class.java) {
            FinancialCategoryRule.fromJson(json)
        }
    }

    @Test
    fun categoryRulesRequestRejectsDuplicateCategories() {
        assertThrows(IllegalArgumentException::class.java) {
            FinancialCategoryRulesUpdateRequest(
                operationId = "op-1",
                expectedRevision = 0L,
                expectedTopologyToken = "topology-1",
                rules = listOf(
                    FinancialCategoryRule("cat-1", SpendingPurpose.ESSENTIALS),
                    FinancialCategoryRule("cat-1", SpendingPurpose.JOY),
                ),
            )
        }
    }

    @Test
    fun billPurposeUpdateSerializesNullPurposeExplicitly() {
        val request = FinancialBillPurposeUpdateRequest(
            operationId = "op-1",
            expectedRevision = 0L,
            expectedTransactionToken = "tx-token-1",
            financialPurpose = null,
        )
        val json = request.toJson()
        assertTrue(json.has("financialPurpose"))
        assertTrue(json.isNull("financialPurpose"))
    }

    @Test
    fun billPurposeResponseDecodesResolutionAndNullPeriod() {
        val body = JSONObject()
            .put("transactionId", "tx-1")
            .put("transactionToken", "tx-token-1")
            .put("revision", 0L)
            .put("financialPurpose", "essentials")
            .put(
                "resolution",
                JSONObject()
                    .put("purpose", "essentials")
                    .put("provenance", "category-rule")
                    .put("ruleCategoryId", "cat-1")
                    .put("mappingRevision", 2L)
                    .put("reason", JSONObject.NULL),
            )
            .put("periodId", JSONObject.NULL)
        val json = metaFields().put("billPurpose", body)
        val decoded = com.yansuu1.jizhang.repo.FinancialBillPurposeResponse.fromJson(json)
        assertEquals(SpendingPurpose.ESSENTIALS, decoded.billPurpose.financialPurpose)
        assertEquals("cat-1", decoded.billPurpose.resolution.ruleCategoryId)
        assertNull(decoded.billPurpose.periodId)
    }

    // ── Refund splits ───────────────────────────────────────────────────────

    @Test
    fun refundSplitRequestRequiresExactOriginalSet() {
        assertThrows(IllegalArgumentException::class.java) {
            FinancialRefundSplitsUpdateRequest(
                operationId = "op-1",
                expectedRevision = 0L,
                expectedRefundToken = "refund-token-1",
                originals = listOf(FinancialRefundOriginalRef("orig-1", "orig-token-1")),
                splits = listOf(FinancialRefundSplit("orig-2", 100L)),
            )
        }
    }

    @Test
    fun refundSplitRequestRejectsZeroAndSerializesExactSet() {
        assertThrows(IllegalArgumentException::class.java) {
            FinancialRefundSplit("orig-1", 0L)
        }

        val request = FinancialRefundSplitsUpdateRequest(
            operationId = "op-1",
            expectedRevision = 1L,
            expectedRefundToken = "refund-token-1",
            originals = listOf(FinancialRefundOriginalRef("orig-1", "orig-token-1")),
            splits = listOf(FinancialRefundSplit("orig-1", 100L)),
        )
        val json = request.toJson()
        assertEquals(1, json.getJSONArray("originals").length())
        assertEquals(100L, json.getJSONArray("splits").getJSONObject(0).getLong("amountCents"))
    }

    @Test
    fun refundReviewDecodesNullableSuggestion() {
        val json = metaFields()
            .put("refundTransactionId", "refund-1")
            .put("refundToken", "refund-token-1")
            .put("amountCents", 100L)
            .put("date", 1760000000000L)
            .put("revision", 0L)
            .put("state", "review-required")
            .put("splits", JSONArray())
            .put("validAttributedCents", 0L)
            .put("unresolvedCents", 100L)
            .put("reasons", JSONArray().put("no-original"))
            .put("originals", JSONArray())
            .put("suggestedSplits", JSONObject.NULL)
            .put("legacyOriginalIds", JSONArray())
        val decoded = com.yansuu1.jizhang.repo.FinancialRefundResponse.fromJson(
            JSONObject().put("contractVersion", 1L).put("rules", rulesJson()).put(
                "calculatedAt",
                1760000000000L,
            ).put("refund", json),
        )
        assertNull(decoded.refund.suggestedSplits)
        assertEquals(100L, decoded.refund.unresolvedCents)
    }

    // ── Execution / provisional / null funding ──────────────────────────────

    @Test
    fun executionProvisionalPreservesNullFundingAndServerNumbers() {
        val execution = FinancialExecution.fromJson(executionJson())
        assertEquals(FinancialExecutionCoverage.PROVISIONAL, execution.coverage)
        assertEquals(FinancialSpendState.PROVISIONAL, execution.spending[0].state)
        assertEquals(2, execution.funding.size)
        assertNull(execution.funding[0].executedCents)
        assertNull(execution.funding[0].remainingCents)
        assertNull(execution.funding[1].executedCents)
        // Server values are preserved verbatim; the client never recomputes target-net.
        assertEquals(-50L, execution.spending[1].remainingCents)
        assertEquals(50L, execution.spending[1].overspendCents)
        assertEquals(70L, execution.spending[0].netCents)
    }

    @Test
    fun fundingZeroExecutedIsRejectedAsFakeProgress() {
        val json = executionJson()
        json.getJSONArray("funding").getJSONObject(0).put("executedCents", 0L)
        assertThrows(IllegalArgumentException::class.java) {
            FinancialExecution.fromJson(json)
        }
    }

    @Test
    fun fundingMissingExecutedFieldFailsInsteadOfDefaultingToNull() {
        val json = executionJson()
        json.getJSONArray("funding").getJSONObject(0).remove("executedCents")
        assertThrows(IllegalArgumentException::class.java) {
            FinancialExecution.fromJson(json)
        }
    }

    @Test
    fun executionRejectsUnknownCoverage() {
        val json = executionJson(coverage = "estimated")
        assertThrows(IllegalArgumentException::class.java) {
            FinancialExecution.fromJson(json)
        }
    }

    @Test
    fun currentExecutionAllowsNoPeriodButRejectsInconsistentReadyState() {
        val noPeriod = metaFields()
            .put("state", "no-period")
            .put("execution", JSONObject.NULL)
        val decoded = com.yansuu1.jizhang.repo.FinancialCurrentExecutionResponse.fromJson(noPeriod)
        assertNull(decoded.execution)

        val inconsistent = metaFields().put("state", "ready").put("execution", JSONObject.NULL)
        assertThrows(IllegalArgumentException::class.java) {
            com.yansuu1.jizhang.repo.FinancialCurrentExecutionResponse.fromJson(inconsistent)
        }
    }

    @Test
    fun executionDetailsRejectUnknownKind() {        val json = metaFields()
            .put("periodId", "period-1")
            .put("revision", 1L)
            .put("items", JSONArray())
            .put("total", 0L)
            .put("limit", 50)
            .put("offset", 0)
            .put(
                "items",
                JSONArray().put(
                    JSONObject()
                        .put("kind", "transfer")
                        .put("transactionId", "tx-1")
                        .put("originalTransactionId", JSONObject.NULL)
                        .put("amountCents", 100L)
                        .put("date", 1760000000000L)
                        .put("categoryId", JSONObject.NULL)
                        .put("accountId", JSONObject.NULL)
                        .put("purpose", "essentials")
                        .put("periodId", "period-1")
                        .put("resolution", JSONObject.NULL)
                        .put("status", "counted")
                        .put("reason", JSONObject.NULL)
                        .put("sourceToken", "token-1")
                        .put("splitRevision", JSONObject.NULL),
                ),
            )
        assertThrows(IllegalArgumentException::class.java) {
            com.yansuu1.jizhang.repo.FinancialExecutionDetailsResponse.fromJson(json)
        }
    }

    @Test
    fun executionDetailsAllowsTombstoneBlankToken() {
        val json = metaFields()
            .put("periodId", "period-1")
            .put("revision", 1L)
            .put(
                "items",
                JSONArray().put(
                    JSONObject()
                        .put("kind", "pending-refund")
                        .put("transactionId", "refund-purged")
                        .put("originalTransactionId", JSONObject.NULL)
                        .put("amountCents", 100L)
                        .put("date", 0L)
                        .put("categoryId", JSONObject.NULL)
                        .put("accountId", JSONObject.NULL)
                        .put("purpose", JSONObject.NULL)
                        .put("periodId", "period-1")
                        .put("resolution", JSONObject.NULL)
                        .put("status", "unresolved")
                        .put("reason", "refund-purged")
                        .put("sourceToken", "")
                        .put("splitRevision", JSONObject.NULL),
                ),
            )
            .put("total", 1L)
            .put("limit", 50)
            .put("offset", 0)
        val decoded = com.yansuu1.jizhang.repo.FinancialExecutionDetailsResponse.fromJson(json)
        assertEquals(1, decoded.items.size)
        assertEquals("", decoded.items[0].sourceToken)
    }

    // ── Operation replay / request round-trip ──────────────────────────────

    @Test
    fun operationResultDecodesStoredResponse() {
        val stored = JSONObject().put("config", configJson())
        val json = JSONObject()
            .put("operationId", "op-1")
            .put("method", "PUT")
            .put("resource", "/api/v1/financial-planning/config")
            .put("statusCode", 200)
            .put("response", stored)
            .put("committedAt", 1760000000000L)
        val decoded = FinancialOperationResult.fromJson(json)
        assertEquals("op-1", decoded.operationId)
        assertEquals(200, decoded.statusCode)
        assertTrue(decoded.response.has("config"))
    }

    @Test
    fun operationResultRejectsMissingStoredResponse() {
        val json = JSONObject()
            .put("operationId", "op-1")
            .put("method", "PUT")
            .put("resource", "/api/v1/financial-planning/config")
            .put("statusCode", 200)
            .put("committedAt", 1760000000000L)
        assertThrows(IllegalArgumentException::class.java) {
            FinancialOperationResult.fromJson(json)
        }
    }

    @Test
    fun configResponseRejectsUnsafeMappingRevision() {
        val json = configResponseJson().put("mappingRevision", 9007199254740992L)
        assertThrows(IllegalArgumentException::class.java) {
            FinancialConfigResponse.fromJson(json)
        }
    }

    @Test
    fun cycleSerializerOmitsDayForNaturalMonth() {
        val json = FinancialCycle.naturalMonth().toJson()
        assertFalse(json.has("day"))
        assertThrows(IllegalArgumentException::class.java) {
            FinancialCycle(com.yansuu1.jizhang.repo.FinancialCycleKind.NATURAL_MONTH, 5)
        }
    }

    @Test
    fun fundingPurposeMustBeGrowthOrReserve() {
        val json = fundingJson("essentials", 1000L)
        assertThrows(IllegalArgumentException::class.java) {
            FinancialFundingUnavailable.fromJson(json)
        }
    }

    @Test
    fun billPurposeUnknownFinancialPurposeFails() {
        val json = metaFields()
            .put("transactionId", "tx-1")
            .put("transactionToken", "tx-token-1")
            .put("revision", 0L)
            .put("financialPurpose", "spending")
            .put(
                "resolution",
                JSONObject()
                    .put("purpose", JSONObject.NULL)
                    .put("provenance", "unresolved")
                    .put("ruleCategoryId", JSONObject.NULL)
                    .put("mappingRevision", 0L)
                    .put("reason", "not-mapped"),
            )
            .put("periodId", JSONObject.NULL)
        assertThrows(IllegalArgumentException::class.java) {
            FinancialBillPurpose.fromJson(json)
        }
    }

    @Test
    fun safeIntegerBoundaryIsAccepted() {
        val json = configResponseJson()
        json.getJSONObject("config").put("revision", 9007199254740991L)
        val decoded = FinancialConfigResponse.fromJson(json)
        assertEquals(9007199254740991L, decoded.config.revision)
    }

    @Test
    fun doubleValueAboveSafeIntegerFailsInsteadOfRounding() {
        val json = configResponseJson()
        json.getJSONObject("config").put("revision", 9007199254740993.0)
        assertThrows(IllegalArgumentException::class.java) {
            FinancialConfigResponse.fromJson(json)
        }
    }

    @Test
    fun duplicateSelectedSourceIdsAreRejected() {
        assertThrows(IllegalArgumentException::class.java) {
            FinancialPeriodProposal(
                periodId = null,
                expectedRevision = 0L,
                expectedConfigRevision = 0L,
                expectedMappingRevision = 0L,
                selectedSources = listOf(
                    FinancialSourceSelection("sal-1", "token-1"),
                    FinancialSourceSelection("sal-1", "token-2"),
                ),
                mappingPolicy = FinancialMappingPolicy.PRESERVE,
                reason = FinancialPeriodReason.SALARY_CONFIRMATION,
            )
        }
    }

    @Test
    fun unknownEnumWireValueIsRejected() {
        assertThrows(IllegalArgumentException::class.java) {
            FinancialSourceStatus.fromWire("rewritten")
        }
        assertThrows(IllegalArgumentException::class.java) {
            SpendingPurpose.fromWire("growth")
        }
    }

    @Test
    fun replayAllowlistRejectsEncodedTraversalAndCaseChanges() {
        assertTrue(isFinancialReplayResourceAllowed("/api/v1/financial-planning/config"))
        assertTrue(isFinancialReplayResourceAllowed("/api/v1/financial-planning/periods/period-1/reconcile"))
        assertTrue(isFinancialReplayResourceAllowed("/api/v1/salaries"))
        assertTrue(isFinancialReplayResourceAllowed("/api/v1/transactions/tx-1"))
        assertFalse(isFinancialReplayResourceAllowed("/api/v1/financial-planning/periods/%2e%2e/config"))
        assertFalse(isFinancialReplayResourceAllowed("/api/v1/financial-planning/periods/%2E%2E/config"))
        assertFalse(isFinancialReplayResourceAllowed("/api/v1/financial-planning/../config"))
        assertFalse(isFinancialReplayResourceAllowed("/API/v1/financial-planning/config"))
        assertFalse(isFinancialReplayResourceAllowed("/api/v1/auth/login"))
        assertFalse(isFinancialReplayResourceAllowed("/api/v1/financial-planning/config?x=1"))
        assertFalse(isFinancialReplayResourceAllowed("https://example.com/api/v1/financial-planning/config"))
    }

    @Test
    fun singleSalarySourceEndpointDecodesSalarySourceShape() {
        val json = metaFields().put("source", salarySourceJson())
        val decoded = com.yansuu1.jizhang.repo.FinancialSalarySourceResponse.fromJson(json)
        assertEquals("sal-1", decoded.source.salaryId)
        assertEquals("2026-10", decoded.source.proposedGroupMonth)
        assertTrue(decoded.source.selectable)
        assertNull(decoded.source.proposedWindow)

        // A period source snapshot is a different wire shape and must not decode here.
        val wrongShape = metaFields().put("source", sourceSnapshotJson())
        assertThrows(IllegalArgumentException::class.java) {
            com.yansuu1.jizhang.repo.FinancialSalarySourceResponse.fromJson(wrongShape)
        }
    }

    @Test
    fun previewSourcesRequireSourceSnapshotShape() {
        val impact = JSONObject()
            .put("addedSalaryIds", JSONArray().put("sal-1"))
            .put("removedSalaryIds", JSONArray())
            .put("changedSalaryIds", JSONArray())
            .put("mappingChanged", false)
            .put("reclassifiedExpenseCount", 0L)
            .put("reclassifiedGrossCents", 0L)
        val preview = metaFields()
            .put("previewToken", "preview-token-1")
            .put("proposal", proposal().toJson())
            .put("window", windowJson())
            .put("decision", decisionJson())
            .put("sources", JSONArray().put(salarySourceJson()))
            .put("excludedSources", JSONArray())
            .put("previousRevision", 0L)
            .put("warnings", JSONArray())
            .put("impact", impact)
        assertThrows(IllegalArgumentException::class.java) {
            FinancialPreview.fromJson(preview)
        }
    }
}
