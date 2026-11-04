package com.yansuu1.jizhang.repo

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class FinancialPlanRepositoryTest {

    private fun validAnalysisJson(
        reserveTargetCents: Long = 2500000L,
        monthsToTarget: Long? = 17L,
    ): JSONObject {
        val allocations = JSONArray().apply {
            put(JSONObject().put("purpose", "growth").put("percent", 25).put("amountCents", 250000L))
            put(JSONObject().put("purpose", "reserve").put("percent", 15).put("amountCents", 150000L))
            put(JSONObject().put("purpose", "essentials").put("percent", 50).put("amountCents", 500000L))
            put(JSONObject().put("purpose", "joy").put("percent", 10).put("amountCents", 100000L))
        }

        val projection = JSONArray().apply {
            for (m in 1..12) {
                put(
                    JSONObject()
                        .put("month", m)
                        .put("reserveProjectedCents", 150000L * m)
                        .put("growthContributionsCents", 250000L * m)
                        .put("reserveGapCents", maxOf(0L, reserveTargetCents - 150000L * m))
                        .put("reserveSurplusCents", maxOf(0L, 150000L * m - reserveTargetCents))
                        .put("targetReached", 150000L * m >= reserveTargetCents)
                )
            }
        }

        return JSONObject()
            .put("ruleVersion", 1)
            .put("allocations", allocations)
            .put("reserveTargetCents", reserveTargetCents)
            .put("reserveGapCents", reserveTargetCents)
            .put("reserveSurplusCents", 0L)
            .put("reserveProgress", 0.0)
            .put("monthsToTarget", monthsToTarget ?: JSONObject.NULL)
            .put("targetReached", false)
            .put("essentialShortfallCents", 0L)
            .put("monthlyDeficitCents", 0L)
            .put("warnings", JSONArray().apply { put("RESERVE_UNDER_ONE_MONTH") })
            .put("projection", projection)
    }

    private fun validSavedPlanJson(): JSONObject {
        val inputs = JSONObject()
            .put("monthlyIncomeCents", 1000000L)
            .put("essentialMonthlyCents", 500000L)
            .put("reserveBalanceCents", 0L)

        return JSONObject()
            .put("version", 1)
            .put("revision", 1L)
            .put("updatedAt", 1729900000000L)
            .put("inputs", inputs)
            .put("analysis", validAnalysisJson())
    }

    @Test
    fun testValidAnalysisDecoding() {
        val json = validAnalysisJson()
        val analysis = FinancialPlanAnalysis.fromJson(json)

        assertEquals(1, analysis.ruleVersion)
        assertEquals(4, analysis.allocations.size)
        assertEquals("growth", analysis.allocations[0].purpose)
        assertEquals(25, analysis.allocations[0].percent)
        assertEquals(250000L, analysis.allocations[0].amountCents)
        assertEquals("reserve", analysis.allocations[1].purpose)
        assertEquals(15, analysis.allocations[1].percent)
        assertEquals(150000L, analysis.allocations[1].amountCents)
        assertEquals("essentials", analysis.allocations[2].purpose)
        assertEquals(50, analysis.allocations[2].percent)
        assertEquals(500000L, analysis.allocations[2].amountCents)
        assertEquals("joy", analysis.allocations[3].purpose)
        assertEquals(10, analysis.allocations[3].percent)
        assertEquals(100000L, analysis.allocations[3].amountCents)

        assertEquals(2500000L, analysis.reserveTargetCents)
        assertEquals(2500000L, analysis.reserveGapCents)
        assertEquals(0L, analysis.reserveSurplusCents)
        assertEquals(0.0, analysis.reserveProgress, 0.0001)
        assertEquals(17L, analysis.monthsToTarget)
        assertFalse(analysis.targetReached)
        assertEquals(0L, analysis.essentialShortfallCents)
        assertEquals(0L, analysis.monthlyDeficitCents)
        assertEquals(listOf("RESERVE_UNDER_ONE_MONTH"), analysis.warnings)

        assertEquals(12, analysis.projection.size)
        assertEquals(1, analysis.projection[0].month)
        assertEquals(150000L, analysis.projection[0].reserveProjectedCents)
        assertEquals(250000L, analysis.projection[0].growthContributionsCents)
        assertEquals(12, analysis.projection[11].month)
        assertEquals(1800000L, analysis.projection[11].reserveProjectedCents)
        assertEquals(3000000L, analysis.projection[11].growthContributionsCents)
    }

    @Test
    fun testNullMonthsToTargetAllowed() {
        val json = validAnalysisJson(monthsToTarget = null)
        val analysis = FinancialPlanAnalysis.fromJson(json)
        assertNull(analysis.monthsToTarget)
    }

    @Test
    fun testMissingMonthsToTargetFailsClose() {
        val json = validAnalysisJson()
        json.remove("monthsToTarget") // missing key must throw!
        assertThrows(IllegalArgumentException::class.java) {
            FinancialPlanAnalysis.fromJson(json)
        }
    }

    @Test
    fun testMonthsToTargetExceedingIntMaxDecodesSafely() {
        // Backend fixture: I=7, C=1000000000, target=5000000000, monthsToTarget=5000000000 (exceeds Int.MAX_VALUE)
        val largeMonths = 5000000000L
        val json = validAnalysisJson(reserveTargetCents = 5000000000L, monthsToTarget = largeMonths)
        val analysis = FinancialPlanAnalysis.fromJson(json)
        assertEquals(5000000000L, analysis.monthsToTarget)
        assertEquals(5000000000L, analysis.reserveTargetCents)
    }

    @Test
    fun testValidSavedPlanDecoding() {
        val json = validSavedPlanJson()
        val plan = SavedFinancialPlan.fromJson(json)

        assertEquals(1, plan.version)
        assertEquals(1L, plan.revision)
        assertEquals(1729900000000L, plan.updatedAt)
        assertEquals(1000000L, plan.inputs.monthlyIncomeCents)
        assertEquals(500000L, plan.inputs.essentialMonthlyCents)
        assertEquals(0L, plan.inputs.reserveBalanceCents)
        assertNotNull(plan.analysis)
    }

    @Test
    fun testRejectUnsupportedRuleVersion() {
        val json = validAnalysisJson().put("ruleVersion", 2)
        assertThrows(IllegalArgumentException::class.java) {
            FinancialPlanAnalysis.fromJson(json)
        }
    }

    @Test
    fun testRejectUnsupportedPlanVersion() {
        val json = validSavedPlanJson().put("version", 2)
        assertThrows(IllegalArgumentException::class.java) {
            SavedFinancialPlan.fromJson(json)
        }
    }

    @Test
    fun testRejectReorderedOrMissingPurposes() {
        val json = validAnalysisJson()
        val allocs = json.getJSONArray("allocations")
        // Swap growth and reserve
        val temp = allocs.getJSONObject(0)
        allocs.put(0, allocs.getJSONObject(1))
        allocs.put(1, temp)

        assertThrows(IllegalArgumentException::class.java) {
            FinancialPlanAnalysis.fromJson(json)
        }
    }

    @Test
    fun testRejectInvalidAllocationPercent() {
        val json = validAnalysisJson()
        val allocs = json.getJSONArray("allocations")
        allocs.getJSONObject(0).put("percent", 30) // should be 25

        assertThrows(IllegalArgumentException::class.java) {
            FinancialPlanAnalysis.fromJson(json)
        }
    }

    @Test
    fun testRejectProgressOutOfRange() {
        val jsonTooHigh = validAnalysisJson().put("reserveProgress", 1.01)
        assertThrows(IllegalArgumentException::class.java) {
            FinancialPlanAnalysis.fromJson(jsonTooHigh)
        }

        val jsonNegative = validAnalysisJson().put("reserveProgress", -0.01)
        assertThrows(IllegalArgumentException::class.java) {
            FinancialPlanAnalysis.fromJson(jsonNegative)
        }
    }

    @Test
    fun testRejectStringOrTruncatedIntegers() {
        val json = validAnalysisJson()
        json.put("reserveTargetCents", "2500000") // String instead of Number

        assertThrows(IllegalArgumentException::class.java) {
            FinancialPlanAnalysis.fromJson(json)
        }
    }

    @Test
    fun testRejectFloatInIntegralCents() {
        val json = validAnalysisJson()
        json.put("reserveTargetCents", 2500000.5) // Fractional float

        assertThrows(IllegalArgumentException::class.java) {
            FinancialPlanAnalysis.fromJson(json)
        }
    }

    @Test
    fun testRejectUnknownWarning() {
        val json = validAnalysisJson()
        json.put("warnings", JSONArray().apply { put("UNKNOWN_WARNING_CODE") })

        assertThrows(IllegalArgumentException::class.java) {
            FinancialPlanAnalysis.fromJson(json)
        }
    }

    @Test
    fun testRejectDuplicateWarnings() {
        val json = validAnalysisJson()
        json.put("warnings", JSONArray().apply {
            put("RESERVE_UNDER_ONE_MONTH")
            put("RESERVE_UNDER_ONE_MONTH")
        })

        assertThrows(IllegalArgumentException::class.java) {
            FinancialPlanAnalysis.fromJson(json)
        }
    }

    @Test
    fun testRejectNonStringWarningItem() {
        val json = validAnalysisJson()
        json.put("warnings", JSONArray().apply {
            put(123)
        })

        assertThrows(IllegalArgumentException::class.java) {
            FinancialPlanAnalysis.fromJson(json)
        }
    }

    @Test
    fun testRejectProjectionWithWrongMonthCount() {
        val json = validAnalysisJson()
        val proj = json.getJSONArray("projection")
        proj.remove(11) // 11 items instead of 12

        assertThrows(IllegalArgumentException::class.java) {
            FinancialPlanAnalysis.fromJson(json)
        }
    }

    @Test
    fun testSaveRequestSerialization() {
        val req = FinancialPlanSaveRequest(
            expectedRevision = 0L,
            monthlyIncomeCents = 1000000L,
            essentialMonthlyCents = 500000L,
            reserveBalanceCents = 200000L,
        )
        val json = req.toJson()
        assertEquals(0L, json.getLong("expectedRevision"))
        assertEquals(1000000L, json.getLong("monthlyIncomeCents"))
        assertEquals(500000L, json.getLong("essentialMonthlyCents"))
        assertEquals(200000L, json.getLong("reserveBalanceCents"))
    }
}
