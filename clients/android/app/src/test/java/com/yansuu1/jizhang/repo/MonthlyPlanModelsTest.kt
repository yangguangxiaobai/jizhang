package com.yansuu1.jizhang.repo

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class MonthlyPlanModelsTest {
    @Test
    fun decodesTheActualServerTargetsPurposesUnresolvedAndLegacyReference() {
        val view = MonthlyPlanView.fromJson(readyPayload())

        assertEquals(MonthlyPlanState.READY, view.state)
        assertEquals("period-1", view.periodId)
        assertEquals(3L, view.revision)
        assertEquals(10_000L, view.confirmedIncomeCents)
        assertEquals(2_500L, view.targets?.growth)
        assertEquals(1_500L, view.targets?.reserve)
        assertEquals(5_000L, view.targets?.essentials)
        assertEquals(1_000L, view.targets?.joy)
        assertEquals(6_000L, view.summary?.consumptionBudgetCents)
        assertEquals(-1_000L, view.summary?.remainingCents)
        assertEquals(
            listOf(SpendingPurpose.ESSENTIALS, SpendingPurpose.JOY),
            view.purposes.map { it.purpose },
        )
        assertEquals(7_000L, view.categories.first().netCents)
        assertNull(view.categories.last().categoryId)
        assertNull(view.categories.last().categoryName)
        assertEquals(MonthlyPlanCategoryPurpose.UNRESOLVED, view.categories.last().purpose)
        assertEquals(2L, view.unresolved.count)
        assertEquals(1L, view.unresolved.expenseCount)
        assertEquals(1L, view.unresolved.globalUnassignedRefundCount)
        assertEquals(10_000L, view.legacyEnvelope?.totalBudgetCents)
        assertEquals(6_000L, view.legacyEnvelope?.purposeSpendingCeilingCents)
        assertFalse(requireNotNull(view.legacyEnvelope).validatedNestedAllocation)
    }

    @Test
    fun billPurposeOverrideMayHaveNullCategoryIdentity() {
        val payload = readyPayload().apply {
            getJSONArray("categories").getJSONObject(1).put("purpose", "essentials")
        }

        val row = MonthlyPlanView.fromJson(payload).categories.last()
        assertNull(row.categoryId)
        assertNull(row.categoryName)
        assertEquals(MonthlyPlanCategoryPurpose.ESSENTIALS, row.purpose)
    }

    @Test
    fun noPeriodRemainsAnExplicitNonZeroFreeState() {
        val view = MonthlyPlanView.fromJson(noPeriodPayload())

        assertEquals(MonthlyPlanState.NO_PERIOD, view.state)
        assertNull(view.periodId)
        assertNull(view.window)
        assertNull(view.targets)
        assertNull(view.summary)
        assertTrue(view.purposes.isEmpty())
        assertTrue(view.categories.isEmpty())
        assertNull(view.legacyEnvelope)
    }

    @Test
    fun refusesAReadyResponseUsingWrongTargetsKey() {
        val payload = readyPayload().apply {
            put("targets", getJSONObject("targetsCents"))
            remove("targetsCents")
        }
        assertThrows(IllegalArgumentException::class.java) {
            MonthlyPlanView.fromJson(payload)
        }
    }

    @Test
    fun reviewRequiredNeverExposesAReportedPreciseRemaining() {
        val payload = readyPayload().apply {
            getJSONObject("summary").apply {
                put("status", "review-required")
                put("remainingCents", 1234)
            }
            val purposeRows = getJSONArray("purposes")
            for (index in 0 until purposeRows.length()) {
                purposeRows.getJSONObject(index).apply {
                    put("remainingCents", JSONObject.NULL)
                    put("overspendCents", JSONObject.NULL)
                }
            }
        }
        val summary = requireNotNull(MonthlyPlanView.fromJson(payload).summary)
        assertNull(summary.remainingCents)
        assertEquals(1_234L, summary.discardedRemainingCents)
    }

    @Test
    fun emptyStatesRequireExplicitNullsAndCannotHideFacts() {
        for (state in listOf("no-period", "disabled")) {
            for (field in listOf("periodId", "revision", "window", "confirmedIncomeCents", "targetsCents", "summary")) {
                val missing = noPeriodPayload().put("state", state).apply { remove(field) }
                assertThrows("$state missing $field", IllegalArgumentException::class.java) {
                    MonthlyPlanView.fromJson(missing)
                }
                val contradictory = noPeriodPayload().put("state", state).put(field, 1)
                assertThrows("$state non-null $field", IllegalArgumentException::class.java) {
                    MonthlyPlanView.fromJson(contradictory)
                }
            }
            val hiddenRows = noPeriodPayload().put("state", state)
                .put("categories", readyPayload().getJSONArray("categories"))
            assertThrows(IllegalArgumentException::class.java) { MonthlyPlanView.fromJson(hiddenRows) }
            val hiddenUnresolved = noPeriodPayload().put("state", state).apply {
                getJSONObject("unresolved").put("count", 1)
            }
            assertThrows(IllegalArgumentException::class.java) { MonthlyPlanView.fromJson(hiddenUnresolved) }
        }
    }

    @Test
    fun refusesAliasesWrappersAndMissingCalculatedAt() {
        for (wrapper in listOf("monthlyPlan", "monthlyPlanView", "plan")) {
            assertThrows(IllegalArgumentException::class.java) {
                MonthlyPlanView.fromJson(JSONObject().put(wrapper, readyPayload()))
            }
        }
        val windowAlias = readyPayload().apply {
            getJSONObject("window").apply { put("start", remove("from")) }
        }
        assertThrows(IllegalArgumentException::class.java) { MonthlyPlanView.fromJson(windowAlias) }
        val targetAlias = readyPayload().apply {
            getJSONObject("targetsCents").apply { put("growthCents", remove("growth")) }
        }
        assertThrows(IllegalArgumentException::class.java) { MonthlyPlanView.fromJson(targetAlias) }
        for (payload in listOf(readyPayload(), noPeriodPayload())) {
            payload.remove("calculatedAt")
            assertThrows(IllegalArgumentException::class.java) { MonthlyPlanView.fromJson(payload) }
        }
    }

    private fun readyPayload(): JSONObject = JSONObject(
        """
        {
          "state":"ready",
          "periodId":"period-1",
          "revision":3,
          "window":{"from":1791561600000,"to":1793462400000,"timeZone":"Asia/Shanghai","label":"2026-10-10 ~ 2026-11-01"},
          "confirmedIncomeCents":10000,
          "targetsCents":{"growth":2500,"reserve":1500,"essentials":5000,"joy":1000},
          "summary":{"consumptionBudgetCents":6000,"confirmedNetSpentCents":7000,"remainingCents":-1000,"status":"exact"},
          "purposes":[
            {"purpose":"essentials","budgetCents":5000,"grossCents":10000,"refundCents":3000,"netCents":7000,"remainingCents":-2000,"overspendCents":2000},
            {"purpose":"joy","budgetCents":1000,"grossCents":0,"refundCents":0,"netCents":0,"remainingCents":1000,"overspendCents":0}
          ],
          "categories":[
            {"categoryId":"cat-1","categoryName":"住房","purpose":"essentials","grossCents":10000,"refundCents":3000,"netCents":7000},
            {"categoryId":null,"categoryName":null,"purpose":"unresolved","grossCents":500,"refundCents":0,"netCents":500}
          ],
          "unresolved":{"reasons":["unresolved-purpose"],"count":2,"expenseCount":1,"grossCents":500,"attributedRefundCents":0,"netCents":500,"linkedRefundCount":0,"linkedRefundUnresolvedCents":0,"globalUnassignedRefundCount":1,"globalUnassignedRefundCents":100},
          "calculatedAt":1793000000000,
          "legacyEnvelopeReference":{"mode":"legacy-reference","contract":"legacy-gross","totalBudgetCents":10000,"mappedBudgetCents":{"essentials":0,"joy":0,"unresolved":0},"purposeSpendingCeilingCents":6000,"differenceCents":4000,"legacyWindow":{"start":1791561600000,"end":1793462400000},"windowMatches":true,"validatedNestedAllocation":false}
        }
        """.trimIndent(),
    )

    private fun noPeriodPayload(): JSONObject = JSONObject(
        """
        {
          "state":"no-period","periodId":null,"revision":null,"window":null,
          "confirmedIncomeCents":null,"targetsCents":null,"summary":null,"purposes":[],"categories":[],
          "unresolved":{"reasons":[],"count":0,"expenseCount":0,"grossCents":0,"attributedRefundCents":0,"netCents":0,"linkedRefundCount":0,"linkedRefundUnresolvedCents":0,"globalUnassignedRefundCount":0,"globalUnassignedRefundCents":0},
          "calculatedAt":1793000000000,"legacyEnvelopeReference":null
        }
        """.trimIndent(),
    )
}
